"""Data collection — Python port of scripts/collect.mjs + collector-core.mjs.

Runs inside the Worker (cron or POST /api/sync). Outbound HTTP uses the
runtime-provided `requests` on these cold paths only, never on /api/feed.
"""
import asyncio
import json
import math
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlencode, urlsplit

from db import chunk, db_all, db_batch, db_run, env_get, get_meta, multirow_insert, set_meta
from collection_safety import (
    COLLECTION_TIMEOUT_SECONDS, LOCK_TTL_MS, MANUAL_INTERVAL_MS, UPSTREAM_COOLDOWN_MS,
    check_upstream, claim_window, cool_upstream, release_window, retry_seconds, window_end,
)
from topics import enrich_item, is_china_related, search_text
from util import (
    canonical_url,
    date_within,
    epoch_ms,
    iso_date,
    item_id,
    item_time,
    now_iso,
    plain_text,
)

MAX_BYTES = 2 * 1024 * 1024
USER_AGENT = 'Signal-AI-News/1.0 (+public-news-aggregator)'
RETRYABLE_STATUS = {408, 500, 502, 503, 504}
DAY_MS = 86400000
GLOBAL_ITEM_CAP = 500

# ---------------------------------------------------------------------------
# Source definitions (port of collect.mjs; `recent` recomputed per run)


def _gh_query(q):
    return 'https://api.github.com/search/repositories?' + urlencode(
        {'q': q, 'sort': 'stars', 'order': 'desc', 'per_page': '30'}
    )


def build_sources(now_ms=None):
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    recent = now_iso(now_ms - 30 * DAY_MS)[:10]
    sources = [
        {
            'id': 'qbitai',
            'name': '量子位 · AI 媒体',
            'homepage': 'https://www.qbitai.com',
            'kind': 'rss',
            'media': True,
            'url': 'https://www.qbitai.com/feed',
        }
    ]
    for org in ('deepseek-ai', 'QwenLM', 'MoonshotAI', 'zai-org'):
        sources.append(
            {
                'id': 'cn-official-' + org,
                'name': org + ' · 官方开源',
                'homepage': 'https://github.com/' + org,
                'kind': 'github-org',
                'url': 'https://api.github.com/orgs/' + org + '/repos?sort=pushed&per_page=20',
            }
        )
    sources += [
        {
            'id': 'github-projects',
            'name': 'GitHub',
            'homepage': 'https://github.com/topics/llm',
            'kind': 'github',
            'url': _gh_query('topic:llm created:>=' + recent + ' archived:false fork:false stars:>50'),
        },
        {
            'id': 'github-skills',
            'name': 'GitHub Skills',
            'homepage': 'https://github.com/topics/agent-skills',
            'kind': 'github',
            'url': _gh_query('topic:agent-skills created:>=' + recent + ' archived:false fork:false stars:>5'),
        },
        {
            'id': 'github-apps',
            'name': 'GitHub Demos',
            'homepage': 'https://github.com/topics/gradio',
            'kind': 'github',
            'url': _gh_query(
                'topic:gradio created:>=' + recent + ' archived:false fork:false stars:>50 -repo:gradio-app/gradio'
            ),
        },
        {
            'id': 'hf-models',
            'name': 'Hugging Face Models',
            'homepage': 'https://huggingface.co/models',
            'kind': 'hf',
            'url': 'https://huggingface.co/api/models?sort=trendingScore&limit=30&full=true',
        },
        {
            'id': 'hf-spaces',
            'name': 'Hugging Face Spaces',
            'homepage': 'https://huggingface.co/spaces',
            'kind': 'hf',
            'url': 'https://huggingface.co/api/spaces?sort=trendingScore&limit=30&full=true',
        },
        {
            'id': 'hf-blog',
            'name': 'Hugging Face Blog',
            'homepage': 'https://huggingface.co/blog',
            'kind': 'rss',
            'url': 'https://huggingface.co/blog/feed.xml',
        },
        {
            'id': 'github-blog',
            'name': 'GitHub Blog',
            'homepage': 'https://github.blog/ai-and-ml/',
            'kind': 'rss',
            'url': 'https://github.blog/ai-and-ml/feed/',
        },
    ]
    sources += [
        {'id': 'oschina', 'name': '开源中国 · 技术资讯', 'homepage': 'https://www.oschina.net/news',
         'kind': 'rss', 'tech': True, 'media': True, 'url': 'https://www.oschina.net/news/rss'},
        {'id': 'hacker-news', 'name': 'Hacker News · 社区讨论', 'homepage': 'https://news.ycombinator.com',
         'kind': 'hn', 'tech': True, 'community': True, 'url': 'https://hacker-news.firebaseio.com/v0/topstories.json'},
        {'id': 'lobsters', 'name': 'Lobsters · 社区讨论', 'homepage': 'https://lobste.rs',
         'kind': 'lobsters', 'tech': True, 'community': True, 'url': 'https://lobste.rs/hottest.json'},
        {'id': 'v2ex-tech', 'name': 'V2EX · 技术讨论', 'homepage': 'https://www.v2ex.com/?tab=tech',
         'kind': 'rss', 'tech': True, 'community': True, 'url': 'https://www.v2ex.com/feed/tab/tech.xml'},
        {'id': 'dev-community', 'name': 'DEV Community · 技术文章', 'homepage': 'https://dev.to',
         'kind': 'rss', 'tech': True, 'authorPosts': True, 'url': 'https://dev.to/feed'},
        {'id': 'meituan-tech', 'name': '美团技术团队 · 官方博客', 'homepage': 'https://tech.meituan.com',
         'kind': 'rss', 'tech': True, 'url': 'https://tech.meituan.com/feed/'},
    ]
    return sources


def source_order():
    # Any positive timestamp works — ids are date-independent; 0 would make
    # now_iso() compute a negative epoch, which Windows datetime rejects.
    return [s['id'] for s in build_sources(1759737600000)]


# ---------------------------------------------------------------------------
# Outbound HTTP (port of fetchText)


class FetchError(Exception):
    def __init__(self, message, retryable=True, status=None, cooldown_ms=0):
        super().__init__(message)
        self.retryable = retryable
        self.status = status
        self.cooldown_ms = cooldown_ms


def _parse_retry_after(raw, fallback_ms):
    if not raw:
        return fallback_ms
    try:
        seconds = float(raw)
        return max(0, int(seconds * 1000)) if math.isfinite(seconds) else fallback_ms
    except (ValueError, OverflowError):
        parsed = iso_date(raw)
        return max(0, epoch_ms(parsed) - int(time.time() * 1000)) if parsed else fallback_ms


def _http_fetch(url, init):
    """Platform fetch via FFI. Importing the Python HTTP stack (requests +
    urllib3 + friends) costs more CPU than the free-plan 10ms budget allows
    on a cold isolate, so outbound calls go straight to the runtime's fetch.
    Returns an awaitable; monkeypatched in tests."""
    import js
    from pyodide.ffi import to_js

    options = dict(init)
    options['signal'] = js.AbortSignal.timeout(options.pop('timeoutMs', 15000))
    return js.fetch(url, to_js(options, dict_converter=js.Object.fromEntries))


async def _default_sleep(seconds):
    import asyncio

    await asyncio.sleep(seconds)


def _header_get(headers, name):
    try:
        value = headers.get(name)
    except Exception:  # noqa: BLE001 — missing header is not an error
        return ''
    return str(value) if value is not None else ''


async def fetch_text(url, headers=None, timeout=15, attempts=3, sleep=_default_sleep):
    """Async port of fetchText() on js.fetch. Raises FetchError after final attempt."""
    last_error = None
    for attempt in range(attempts):
        delay_ms = 500 * 2 ** attempt
        try:
            response = await _http_fetch(url, {
                'method': 'GET',
                'timeoutMs': timeout * 1000,
                'headers': {'User-Agent': USER_AGENT, **(headers or {})},
            })
            status = int(response.status)
            if status != 200:
                if status in (403, 429):
                    cooldown_ms = _parse_retry_after(_header_get(response.headers, 'retry-after'), UPSTREAM_COOLDOWN_MS)
                    raise FetchError('HTTP ' + str(status), False, status, max(UPSTREAM_COOLDOWN_MS, cooldown_ms))
                retryable = status in RETRYABLE_STATUS
                delay_ms = _parse_retry_after(_header_get(response.headers, 'retry-after'), delay_ms)
                raise FetchError('HTTP ' + str(status), retryable and delay_ms <= 10000)
            length = _header_get(response.headers, 'content-length')
            if length and length.isdigit() and int(length) > MAX_BYTES:
                raise FetchError('响应超过 2MB', retryable=False)
            body = await response.text()
            if len(body) > MAX_BYTES:
                raise FetchError('响应超过 2MB', retryable=False)
            return body
        except FetchError as error:
            last_error = error
            if attempt == attempts - 1 or not error.retryable:
                raise
            await sleep(delay_ms / 1000)
        except Exception as error:  # network layer: mirror JS (retry until attempts exhausted)
            last_error = FetchError(str(error), retryable=True)
            if attempt == attempts - 1:
                raise last_error
            await sleep(delay_ms / 1000)
    raise last_error or FetchError('请求失败')


# ---------------------------------------------------------------------------
# Normalization (port of collector-core.mjs)


def _base(source, url, title, now, index):
    safe = canonical_url(url)
    clean = plain_text(title, 240)
    if not safe or not clean:
        return None
    return {
        'id': item_id(safe),
        'title': clean,
        'url': safe,
        'sourceId': source['id'],
        'sourceName': source['name'],
        'summary': '',
        'categories': [],
        'tags': [],
        'publishedAt': None,
        'updatedAt': None,
        'collectedAt': now,
        'metricLabel': None,
        'metricValue': None,
        'metricPrev': None,
        'rankScore': max(0, 100 - index * 3),
    }


_TECH_TOPIC = re.compile('\\b(php|java|javascript|typescript|python|rust|golang|go|zig|swift|kotlin|ruby|rails|react|vue|angular|svelte|node\\.?js|deno|bun|linux|unix|windows|android|ios|macos|docker|kubernetes|k8s|postgres\\w*|mysql|sqlite|redis|mongodb|sql|database|compiler|compilers|programming|software|developer|developers|coding|code|git|github|gitlab|open.source|api|sdk|npm|pypi|package|dependency|dependencies|security|vulnerability|cve|rce|webassembly|wasm|browser|browsers|cloud|server|servers|distributed|debugging|performance|benchmark|benchmarks|llm|llms|agent|agents|ai)\\b|开源|编程|开发|程序员|框架|数据库|编译|语言|漏洞|供应链|容器|云原生|中间件|运维|架构|故障|宕机|回滚|复盘|浏览器|许可证|模型|代码|算法|线程|内存|缓存|性能|内核|构建|依赖|版本|发布|升级|更新', re.I | re.ASCII)
_TECH_NOISE = re.compile('决赛|大赛|入围|获奖|报名|征文|沙龙|直播预告|赞助|招商|生态合作|招聘|求职|找工作|求助|求推荐|求购|拼车|合租|转让|优惠码|邀请码|推广|抽奖|引流|\\b(hiring|who is hiring|ask hn:|satire|satirical)\\b', re.I | re.ASCII)
_COMMUNITY_SUMMARY = '社区讨论线索，不等于官方确认；日期为帖子创建时间，原文与完整上下文见讨论页。'


def keep_technical(title, summary='', tags=()):
    tag_text = ' '.join(tags)
    return not _TECH_NOISE.search(title + ' ' + tag_text) and bool(
        _TECH_TOPIC.search(title + ' ' + summary + ' ' + tag_text)
    )


def normalize_community(payload, source, now):
    if not isinstance(payload, list):
        raise ValueError('社区返回无效数据')
    result = []
    for index, record in enumerate(payload[:30]):
        if not isinstance(record, dict):
            continue
        hn = source['kind'] == 'hn'
        rid = record.get('id')
        if hn and (record.get('type') != 'story' or record.get('deleted') or record.get('dead')
                   or type(rid) is not int or not 0 < rid <= 9007199254740991):
            continue
        raw_tags = record.get('tags')
        tags = [t for t in raw_tags if isinstance(t, str)][:4] if isinstance(raw_tags, list) else []
        summary = plain_text(record.get('text') if hn else record.get('description'))
        if not keep_technical(plain_text(record.get('title')), summary, tags):
            continue
        url = 'https://news.ycombinator.com/item?id=' + str(rid) if hn else record.get('comments_url')
        item = _base(source, url, record.get('title'), now, index)
        if not item:
            continue
        if urlsplit(item['url']).hostname != ('news.ycombinator.com' if hn else 'lobste.rs'):
            continue
        value = record.get('created_at')
        if hn:
            seconds = record.get('time')
            if type(seconds) not in (int, float) or not 0 < seconds < 8640000000000:
                continue
            value = now_iso(int(seconds * 1000))
        published_at = date_within(value, now)
        if not published_at or not epoch_ms(now) - 7 * DAY_MS <= epoch_ms(published_at) <= epoch_ms(now):
            continue
        score = record.get('score')
        item.update({
            'categories': ['dev'], 'tags': ['社区讨论'] + tags,
            'summary': plain_text(summary, 140) + ' · ' + _COMMUNITY_SUMMARY if summary else _COMMUNITY_SUMMARY,
            'publishedAt': published_at, 'metricLabel': 'points',
            'metricValue': max(0, score) if type(score) in (int, float) else None,
        })
        result.append(item)
    return result


def normalize_github(payload, source, now):
    items = (payload or {}).get('items')
    if not isinstance(items, list) or (payload or {}).get('incomplete_results') is True:
        raise ValueError('GitHub 返回不完整或无效数据')
    result = []
    for index, repo in enumerate(items):
        if repo.get('archived') or repo.get('fork') or repo.get('private'):
            continue
        if source['kind'] == 'github-org':
            pushed = date_within(repo.get('pushed_at'), now)
            if not pushed or epoch_ms(pushed) < epoch_ms(now) - 30 * DAY_MS:
                continue
        item = _base(source, repo.get('html_url'), repo.get('full_name'), now, index)
        if not item:
            continue
        item['summary'] = plain_text(repo.get('description')) or '该项目暂未提供描述，访问仓库了解详情。'
        item['categories'] = (
            ['skills'] if source['id'] == 'github-skills' else ['apps'] if source['id'] == 'github-apps' else ['projects']
        )
        topics = repo.get('topics')
        item['tags'] = [t for t in (topics if isinstance(topics, list) else []) if isinstance(t, str)][:4]
        item['publishedAt'] = date_within(repo.get('created_at'), now)
        item['updatedAt'] = date_within(repo.get('pushed_at'), now)
        item['metricLabel'] = 'stars'
        stars = repo.get('stargazers_count')
        item['metricValue'] = max(0, stars) if isinstance(stars, (int, float)) else None
        result.append(item)
    return result


def normalize_hf(payload, source, now):
    if not isinstance(payload, list):
        raise ValueError('Hugging Face 返回无效数据')
    models = source['id'] == 'hf-models'
    result = []
    for index, record in enumerate(payload):
        rid = record.get('id') or record.get('modelId')
        if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_.\-/]+', rid):
            continue
        item = _base(
            source,
            'https://huggingface.co/' + ('' if models else 'spaces/') + rid,
            rid,
            now,
            index,
        )
        if not item:
            continue
        card = record.get('cardData') or {}
        summary = plain_text(card.get('short_description') or card.get('description') or '')
        item['summary'] = summary or (
            '来自 Hugging Face 热门模型榜。查看模型卡、适用任务与使用限制。'
            if models
            else '来自 Hugging Face Spaces 的 AI 应用。前往原站体验，可用性以作者维护为准。'
        )
        item['categories'] = ['models' if models else 'apps']
        task = record.get('pipeline_tag') if isinstance(record.get('pipeline_tag'), str) else (
            record.get('sdk') if isinstance(record.get('sdk'), str) else None
        )
        raw_tags = [t for t in (record.get('tags') or []) if isinstance(t, str) and ':' not in t][:2]
        item['tags'] = [t for t in ([task] + raw_tags) if t]
        item['publishedAt'] = date_within(record.get('createdAt'), now)
        item['updatedAt'] = date_within(record.get('lastModified'), now)
        item['metricLabel'] = 'downloads' if models else 'likes'
        value = record.get('downloads') if models else record.get('likes')
        item['metricValue'] = max(0, value) if isinstance(value, (int, float)) else None
        result.append(item)
    return result


_CDATA_RE = re.compile(r'<!\[CDATA\[[\s\S]*?\]\]>')
_DANGER_RE = re.compile(r'<!DOCTYPE|<!ENTITY', re.I)
_TIPS_RE = re.compile(r'\b(how to|guide|tips|tutorial|learn|skills|best practices|build|building)\b')
_MODELS_RE = re.compile(r'\b(model|models|release|releases|introducing|llm)\b|模型|大模型')


def _local(tag):
    return tag.rsplit('}', 1)[-1] if '}' in tag else tag


def _children(element, name):
    return [child for child in element if _local(child.tag) == name]


def _child(element, name):
    found = _children(element, name)
    return found[0] if found else None


def _first_child(element, names):
    """First present tag among `names`. Never relies on Element truthiness:
    an Element with no children is falsy, which would break `or` chains."""
    for name in names:
        found = _child(element, name)
        if found is not None:
            return found
    return None


def normalize_rss(text, source, now):
    if not isinstance(text, str) or _DANGER_RE.search(_CDATA_RE.sub('', text)):
        raise ValueError('RSS 不是安全有效的 XML')
    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise ValueError('RSS 不是安全有效的 XML') from error
    channel = _child(root, 'channel')
    if _local(root.tag) == 'rss' and channel is not None:
        raw_entries = _children(channel, 'item')
    elif _local(root.tag) == 'feed':
        raw_entries = _children(root, 'entry')
    else:
        raise ValueError('RSS 缺少文章条目')
    result = []
    for index, entry in enumerate(raw_entries[:30]):
        # Link selection: prefer rel=alternate (or absent rel) with href; fall back to text link.
        links = _children(entry, 'link')
        url = None
        for link in links:
            rel = link.get('rel')
            href = link.get('href')
            if href and (not rel or rel == 'alternate'):
                url = href
                break
        if url is None:
            for link in links:
                if link.text and link.text.strip():
                    url = link.text.strip()
                    break
        title_el = _child(entry, 'title')
        title = title_el.text if title_el is not None else None
        item = _base(source, url, title, now, index)
        if not item:
            continue
        summary_el = _first_child(entry, ('description', 'summary', 'content'))
        summary = plain_text(summary_el.text if summary_el is not None else '')
        text_for_rules = item['title'].lower()
        if source.get('tech') and not keep_technical(item['title'], summary):
            continue
        categories = ['dev'] if source.get('tech') else ['news']
        if not source.get('tech') and source['id'] == 'github-blog':
            categories.append('dev')
        if not source.get('tech') and _TIPS_RE.search(text_for_rules):
            categories.append('tips')
        if not source.get('tech') and _MODELS_RE.search(text_for_rules):
            categories.append('models')
        published_el = _first_child(entry, ('pubDate', 'published') if source.get('tech') else ('pubDate', 'published', 'updated'))
        published_at = date_within(published_el.text if published_el is not None else None, now)
        if published_at and epoch_ms(published_at) < epoch_ms(now) - 30 * DAY_MS:
            continue
        item['summary'] = summary or '查看来源原文，了解完整背景与细节。'
        item['categories'] = categories
        item['tags'] = ['社区文章'] if source.get('authorPosts') else ['社区讨论'] if source.get('community') else ['媒体报道'] if source.get('media') else ['官方博客']
        item['publishedAt'] = published_at
        updated_el = _child(entry, 'updated')
        item['updatedAt'] = date_within(updated_el.text if updated_el is not None else None, now)
        item['rankScore'] = max(0, 95 - index * 3)
        result.append(item)
    return result


# ---------------------------------------------------------------------------
# D1 write path

# Cross-source dupes (e.g. a cn-official repo also matched by github search)
# resolve keep-first: the upsert only fires for the owning source.
_ITEM_CONFLICT = (
    'ON CONFLICT(id) DO UPDATE SET '
    + ', '.join(
        col + ' = excluded.' + col
        for col in [
            'title', 'url', 'summary', 'source_id', 'source_name', 'published_at', 'updated_at',
            'collected_at', 'item_ts', 'rank_score', 'metric_label', 'metric_value', 'metric_prev',
            'is_china', 'search_text',
        ]
    )
    + ' WHERE excluded.source_id = items.source_id AND excluded.collected_at >= items.collected_at'
)
_ITEM_COLUMNS = [
    'id', 'title', 'url', 'summary', 'source_id', 'source_name',
    'published_at', 'updated_at', 'collected_at', 'item_ts',
    'rank_score', 'metric_label', 'metric_value', 'metric_prev', 'is_china', 'search_text',
]
_ITEM_ROWS_PER_STMT = 6  # 6 × 16 = 96 params, under D1's 100 cap — a 17th column must drop this to 5

# Source row must exist BEFORE item rows (items.source_id FK); item_count is
# refreshed by a trailing UPDATE once this source's items are in place.
_SOURCE_UPSERT = (
    'INSERT INTO sources (id, name, homepage, status, last_success_at, item_count, error) '
    "VALUES (?, ?, ?, 'ok', ?, 0, NULL) "
    'ON CONFLICT(id) DO UPDATE SET name = excluded.name, homepage = excluded.homepage, '
    "status = 'ok', last_success_at = excluded.last_success_at, error = NULL"
)
_SOURCE_COUNT_REFRESH = (
    'UPDATE sources SET item_count = (SELECT COUNT(*) FROM items WHERE source_id = sources.id) '
    'WHERE id = ?'
)


def _item_row(item):
    return (
        item['id'], item['title'], item['url'], item['summary'], item['sourceId'], item['sourceName'],
        item['publishedAt'], item['updatedAt'], item['collectedAt'], item_time(item),
        item['rankScore'], item['metricLabel'], item['metricValue'], item.get('metricPrev'),
        1 if is_china_related(item) else 0, search_text(item),
    )


async def write_source_success(env, source, items, now, now_ms):
    """Replace one source's rows inside a single batch transaction (plan §6)."""
    enriched = [enrich_item(dict(item)) for item in items]
    # Source row first (items.source_id FK), counts refreshed last.
    statements = [(_SOURCE_UPSERT, (source['id'], source['name'], source['homepage'], now))]

    if source['kind'] == 'rss':
        cutoff = now_iso(now_ms - 30 * DAY_MS)
        old_rows = await db_all(
            env,
            'SELECT id FROM items WHERE source_id = ? '
            'AND published_at IS NOT NULL AND published_at >= ?',
            (source['id'], cutoff),
        )
        keep = {item['id'] for item in enriched} | {row['id'] for row in old_rows}
        old_all = await db_all(env, 'SELECT id FROM items WHERE source_id = ?', (source['id'],))
        doomed = [row['id'] for row in old_all if row['id'] not in keep]
        for group in chunk(doomed, 90):
            statements.append(
                ('DELETE FROM items WHERE id IN (' + ','.join('?' * len(group)) + ')', tuple(group))
            )
    else:
        # Growth tracking: grab the previous metric before this source's rows
        # are deleted, so the re-insert can carry metric_prev (the ON CONFLICT
        # clause can't — the old rows are already gone by the time it runs).
        prev = {row['id']: row['metric_value'] for row in await db_all(
            env, 'SELECT id, metric_value FROM items WHERE source_id = ?', (source['id'],),
        )}
        for item in enriched:
            item['metricPrev'] = prev.get(item['id'])
        statements.append(('DELETE FROM items WHERE source_id = ?', (source['id'],)))

    for group in chunk(enriched, _ITEM_ROWS_PER_STMT):
        statements.append((multirow_insert('items', _ITEM_COLUMNS, len(group), _ITEM_CONFLICT),
                           tuple(v for item in group for v in _item_row(item))))

    cat_rows = [(item['id'], cat) for item in enriched for cat in item['categories']]
    for group in chunk(cat_rows, 50):
        statements.append((
            'INSERT OR IGNORE INTO item_categories (item_id, category) VALUES '
            + ','.join('(?, ?)' for _ in group),
            tuple(v for row in group for v in row),
        ))
    tag_rows = [(item['id'], tag) for item in enriched for tag in item['tags']]
    for group in chunk(tag_rows, 50):
        statements.append((
            'INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES '
            + ','.join('(?, ?)' for _ in group),
            tuple(v for row in group for v in row),
        ))

    statements.append((_SOURCE_COUNT_REFRESH, (source['id'],)))
    await db_batch(env, statements)
    return len(enriched)


async def mark_source_error(env, source, message):
    """Failure downgrade: keep old rows, only flip status/error."""
    await db_run(
        env,
        'INSERT INTO sources (id, name, homepage, status, last_success_at, item_count, error) '
        "VALUES (?, ?, ?, 'error', NULL, 0, ?) "
        "ON CONFLICT(id) DO UPDATE SET status = 'error', error = excluded.error",
        (source['id'], source['name'], source['homepage'], message[:200]),
    )


def parse_json(text):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError('返回的不是有效 JSON') from error


def _collect_headers(source, env):
    headers = {}
    if source['url'].startswith('https://api.github.com/'):
        headers['Accept'] = 'application/vnd.github+json'
        token = env_get(env, 'GITHUB_TOKEN')
        if token:
            headers['Authorization'] = 'Bearer ' + token
    return headers


async def collect_source(env, source, now):
    """Fetch + normalize one source (cold paths only)."""
    if source['kind'] == 'hn':
        ids = parse_json(await fetch_text(source['url']))
        if not isinstance(ids, list) or not ids or any(type(i) is not int or not 0 < i <= 9007199254740991 for i in ids):
            raise ValueError('Hacker News 榜单无效')
        records = []
        # At most 39 subrequests including retries; failure retains the old source snapshot.
        for rid in list(dict.fromkeys(ids))[:12]:
            records.append(parse_json(await fetch_text('https://hacker-news.firebaseio.com/v0/item/' + str(rid) + '.json')))
        return normalize_community(records, source, now)
    text = await fetch_text(source['url'], _collect_headers(source, env))
    kind = source['kind']
    if kind == 'rss':
        return normalize_rss(text, source, now)
    payload = parse_json(text)
    if kind in ('github', 'github-org'):
        # Org repos endpoints return a bare array; search returns {items: [...]}.
        if kind == 'github-org' and isinstance(payload, list):
            payload = {'items': payload}
        return normalize_github(payload, source, now)
    if kind == 'lobsters':
        return normalize_community(payload, source, now)
    if kind == 'hf':
        return normalize_hf(payload, source, now)
    raise ValueError('未知源类型 ' + kind)


async def _select_sources(env, sources):
    """Honor explicit `only`; otherwise apply COLLECT_SOURCES_PER_RUN cursor batching."""
    per_run = int(env_get(env, 'COLLECT_SOURCES_PER_RUN', '0') or 0)
    if per_run <= 0 or per_run >= len(sources):
        return sources, None
    cursor = int(await get_meta(env, 'collect_cursor', '0') or 0)
    picks = [sources[(cursor + i) % len(sources)] for i in range(per_run)]
    return picks, (cursor + per_run) % len(sources)


async def run_collection(env, only=None, allow_cursor=True, now_ms=None, manual=False):
    """Cron and authenticated manual sync share a cross-isolate lease."""
    lease = await claim_window(env, 'collection_lock', LOCK_TTL_MS)
    if lease is None:
        return {'skipped': 'busy', 'retryAfter': retry_seconds(await window_end(env, 'collection_lock'))}
    try:
        if manual:
            permit = await claim_window(env, 'manual_sync_limit', MANUAL_INTERVAL_MS)
            if permit is None:
                return {'skipped': 'rate_limited', 'retryAfter': retry_seconds(await window_end(env, 'manual_sync_limit'))}
        # Bound the owner's lifetime below the lease TTL, including digest work.
        return await asyncio.wait_for(
            _run_collection(env, only, allow_cursor, now_ms), COLLECTION_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        print('collection alert: collection timed out')
        return {'error': 'collection_timeout'}
    finally:
        await release_window(env, 'collection_lock', lease)


async def _run_collection(env, only=None, allow_cursor=True, now_ms=None):
    """Entry point for cron and POST /api/sync (now_ms injectable for tests)."""
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    now = now_iso(now_ms)
    sources = build_sources(now_ms)
    cycle_complete = False
    if only:
        wanted = set(only)
        sources = [s for s in sources if s['id'] in wanted]
    elif allow_cursor:
        sources, next_cursor = await _select_sources(env, sources)
        if next_cursor is not None:
            await set_meta(env, 'collect_cursor', str(next_cursor))
            cycle_complete = next_cursor == 0

    results = []
    ok_count = 0
    for source in sources:
        try:
            until = await check_upstream(env, source['url'])
            if until:
                message = '源站冷却中，暂停至 ' + now_iso(until)
                await mark_source_error(env, source, message)
                results.append({'id': source['id'], 'ok': False, 'skipped': 'cooldown', 'error': message})
                continue
            items = await collect_source(env, source, now)
            count = await write_source_success(env, source, items, now, now_ms)
            results.append({'id': source['id'], 'ok': True, 'count': count})
            ok_count += 1
        except Exception as error:  # noqa: BLE001 — one bad source must not kill the run
            message = str(error) or error.__class__.__name__
            if isinstance(error, FetchError) and error.status in (403, 429):
                until = await cool_upstream(env, source['url'], error.cooldown_ms, error.status)
                message += '；暂停至 ' + now_iso(until)
            await mark_source_error(env, source, message)
            results.append({'id': source['id'], 'ok': False, 'error': message[:200]})

    if ok_count:
        await db_batch(
            env,
            [
                # Global 500-item cap: drop the oldest tail, then refresh counts.
                ('DELETE FROM items WHERE id IN (SELECT id FROM items '
                 'ORDER BY item_ts DESC, rank_score DESC, id LIMIT -1 OFFSET 500)', ()),
                ('UPDATE sources SET item_count = (SELECT COUNT(*) FROM items WHERE source_id = sources.id)', ()),
            ],
        )
        await set_meta(env, 'generated_at', now)

    status = {'ranAt': now, 'ok': ok_count, 'failed': len(sources) - ok_count, 'sources': results}
    await set_meta(env, 'sync_status', json.dumps(status, ensure_ascii=False, separators=(',', ':')))
    if cycle_complete:
        # The 18-source cycle just wrapped (≈ Beijing 08:05): snapshot the
        # front page, draft the editor's note, send the daily digest — each
        # step independently guarded inside run_digest.
        try:
            from digest import run_digest

            status.update(await run_digest(env, now_ms))
        except Exception as error:  # noqa: BLE001 — best-effort only
            print('digest failed:', error)
    return status
