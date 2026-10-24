import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { canonicalUrl, isoDate, validateFeed, itemTime } from '../src/data.mjs';

export const MAX_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});
export function plainText(value, max = 240) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#39);/g,
      (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' })[n],
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function date(value, now) {
  const d = isoDate(value);
  return d && Date.parse(d) <= Date.parse(now) + 86400000 ? d : null;
}
function base(source, url, title, now, index) {
  const safe = canonicalUrl(url);
  const clean = plainText(title, 240);
  if (!safe || !clean) return null;
  return {
    id: createHash('sha256').update(safe).digest('hex').slice(0, 20),
    title: clean,
    url: safe,
    sourceId: source.id,
    sourceName: source.name,
    summary: '',
    categories: [],
    tags: [],
    publishedAt: null,
    updatedAt: null,
    collectedAt: now,
    metricLabel: null,
    metricValue: null,
    rankScore: Math.max(0, 100 - index * 3),
  };
}
export function normalizeGithub(payload, source, now) {
  if (!payload || !Array.isArray(payload.items) || payload.incomplete_results === true)
    throw new Error('GitHub 返回不完整或无效数据');
  return payload.items.flatMap((r, index) => {
    if (r.archived || r.fork || r.private) return [];
    if (
      source.kind === 'github-org' &&
      (!date(r.pushed_at, now) || Date.parse(r.pushed_at) < Date.parse(now) - 30 * 86400000)
    )
      return [];
    const i = base(source, r.html_url, r.full_name, now, index);
    if (!i) return [];
    return [
      {
        ...i,
        summary: plainText(r.description) || '该项目暂未提供描述，访问仓库了解详情。',
        categories:
          source.id === 'github-skills'
            ? ['skills']
            : source.id === 'github-apps'
              ? ['apps']
              : ['projects'],
        tags: (Array.isArray(r.topics) ? r.topics : [])
          .filter((t) => typeof t === 'string')
          .slice(0, 4),
        publishedAt: date(r.created_at, now),
        updatedAt: date(r.pushed_at, now),
        metricLabel: 'stars',
        metricValue: Number.isFinite(r.stargazers_count) ? Math.max(0, r.stargazers_count) : null,
      },
    ];
  });
}
export function normalizeHf(payload, source, now) {
  if (!Array.isArray(payload)) throw new Error('Hugging Face 返回无效数据');
  const models = source.id === 'hf-models';
  return payload.flatMap((r, index) => {
    const id = r.id || r.modelId;
    if (typeof id !== 'string' || !/^[\w.\-/]+$/.test(id)) return [];
    const i = base(
      source,
      'https://huggingface.co/' + (models ? '' : 'spaces/') + id,
      id,
      now,
      index,
    );
    if (!i) return [];
    const task =
      typeof r.pipeline_tag === 'string'
        ? r.pipeline_tag
        : typeof r.sdk === 'string'
          ? r.sdk
          : null;
    return [
      {
        ...i,
        summary:
          plainText(r.cardData?.short_description || r.cardData?.description || '') ||
          (models
            ? '来自 Hugging Face 热门模型榜。查看模型卡、适用任务与使用限制。'
            : '来自 Hugging Face Spaces 的 AI 应用。前往原站体验，可用性以作者维护为准。'),
        categories: [models ? 'models' : 'apps'],
        tags: [
          task,
          ...(Array.isArray(r.tags)
            ? r.tags.filter((t) => typeof t === 'string' && !t.includes(':')).slice(0, 2)
            : []),
        ].filter(Boolean),
        publishedAt: date(r.createdAt, now),
        updatedAt: date(r.lastModified, now),
        metricLabel: models ? 'downloads' : 'likes',
        metricValue: models
          ? Number.isFinite(r.downloads)
            ? Math.max(0, r.downloads)
            : null
          : Number.isFinite(r.likes)
            ? Math.max(0, r.likes)
            : null,
      },
    ];
  });
}
// Deliberately conservative: community popularity alone does not imply developer relevance.
const TECH_TOPIC =
  /\b(php|java|javascript|typescript|python|rust|golang|go|zig|swift|kotlin|ruby|rails|react|vue|angular|svelte|node\.?js|deno|bun|linux|unix|windows|android|ios|macos|docker|kubernetes|k8s|postgres\w*|mysql|sqlite|redis|mongodb|sql|database|compiler|compilers|programming|software|developer|developers|coding|code|git|github|gitlab|open.source|api|sdk|npm|pypi|package|dependency|dependencies|security|vulnerability|cve|rce|webassembly|wasm|browser|browsers|cloud|server|servers|distributed|debugging|performance|benchmark|benchmarks|llm|llms|agent|agents|ai)\b|开源|编程|开发|程序员|框架|数据库|编译|语言|漏洞|供应链|容器|云原生|中间件|运维|架构|故障|宕机|回滚|复盘|浏览器|许可证|模型|代码|算法|线程|内存|缓存|性能|内核|构建|依赖|版本|发布|升级|更新/i;
const TECH_NOISE =
  /决赛|大赛|入围|获奖|报名|征文|沙龙|直播预告|赞助|招商|生态合作|招聘|求职|找工作|求助|求推荐|求购|拼车|合租|转让|优惠码|邀请码|推广|抽奖|引流|\b(hiring|who is hiring|ask hn:|satire|satirical)\b/i;
export function keepTechnical(title, summary = '', tags = []) {
  return (
    !TECH_NOISE.test(title + ' ' + tags.join(' ')) &&
    TECH_TOPIC.test(title + ' ' + summary + ' ' + tags.join(' '))
  );
}
const communitySummary =
  '社区讨论线索，不等于官方确认；日期为帖子创建时间，原文与完整上下文见讨论页。';
export function normalizeCommunity(payload, source, now) {
  if (!Array.isArray(payload)) throw new Error('社区返回无效数据');
  return payload.slice(0, 30).flatMap((r, index) => {
    if (!r || typeof r !== 'object') return [];
    const hn = source.kind === 'hn';
    if (
      hn &&
      (r.type !== 'story' || r.deleted || r.dead || !Number.isSafeInteger(r.id) || r.id <= 0)
    )
      return [];
    const tags = Array.isArray(r.tags)
      ? r.tags.filter((t) => typeof t === 'string').slice(0, 4)
      : [];
    const summary = plainText(hn ? r.text : r.description);
    if (!keepTechnical(plainText(r.title), summary, tags)) return [];
    const url = hn ? 'https://news.ycombinator.com/item?id=' + r.id : r.comments_url;
    const i = base(source, url, r.title, now, index);
    if (
      !i ||
      (hn
        ? new URL(i.url).hostname !== 'news.ycombinator.com'
        : new URL(i.url).hostname !== 'lobste.rs')
    )
      return [];
    const publishedAt = date(
      hn && Number.isFinite(r.time) && r.time > 0 && r.time < 8640000000000
        ? new Date(r.time * 1000).toISOString()
        : !hn
          ? r.created_at
          : null,
      now,
    );
    if (
      !publishedAt ||
      Date.parse(publishedAt) > Date.parse(now) ||
      Date.parse(publishedAt) < Date.parse(now) - 7 * 86400000
    )
      return [];
    return [
      {
        ...i,
        categories: ['dev'],
        tags: ['社区讨论', ...tags],
        summary: summary ? plainText(summary, 140) + ' · ' + communitySummary : communitySummary,
        publishedAt,
        metricLabel: 'points',
        metricValue: Number.isFinite(r.score) ? Math.max(0, r.score) : null,
      },
    ];
  });
}
export async function fetchHackerNews(source, now) {
  const ids = JSON.parse(await fetchText(source.url));
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error('Hacker News 榜单无效');
  const records = [];
  // 12 details + the index, each with <=3 attempts: <=39 subrequests even under retries.
  // Stop on network failure so an incomplete refresh cannot replace the previous source snapshot.
  for (const id of [...new Set(ids)].slice(0, 12)) {
    records.push(
      JSON.parse(await fetchText('https://hacker-news.firebaseio.com/v0/item/' + id + '.json')),
    );
  }
  return normalizeCommunity(records, source, now);
}

export function normalizeRss(text, source, now) {
  if (
    typeof text !== 'string' ||
    /<!DOCTYPE|<!ENTITY/i.test(text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')) ||
    XMLValidator.validate(text) !== true
  )
    throw new Error('RSS 不是安全有效的 XML');
  const doc = parser.parse(text);
  const raw = doc.rss?.channel?.item ?? doc.feed?.entry;
  if (!raw) throw new Error('RSS 缺少文章条目');
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.slice(0, 30).flatMap((r, index) => {
    const links = Array.isArray(r.link) ? r.link : [r.link];
    const link = links.find(
      (l) => typeof l === 'string' || (l && (!l['@_rel'] || l['@_rel'] === 'alternate')),
    );
    const url = typeof link === 'string' ? link : link?.['@_href'];
    const title = typeof r.title === 'string' ? r.title : r.title?.['#text'];
    const i = base(source, url, title, now, index);
    if (!i) return [];
    const rawSummary = r.description ?? r.summary ?? r.content ?? '';
    const summary = plainText(typeof rawSummary === 'string' ? rawSummary : rawSummary['#text']);
    const textForRules = i.title.toLowerCase();
    if (source.tech && !keepTechnical(i.title, summary)) return [];
    const categories = source.tech ? ['dev'] : ['news'];
    if (!source.tech && source.id === 'github-blog') categories.push('dev');
    if (
      !source.tech &&
      /\b(how to|guide|tips|tutorial|learn|skills|best practices|build|building)\b/.test(
        textForRules,
      )
    )
      categories.push('tips');
    if (
      !source.tech &&
      /\b(model|models|release|releases|introducing|llm)\b|模型|大模型/.test(textForRules)
    )
      categories.push('models');
    const publishedAt = date(r.pubDate ?? r.published ?? (source.tech ? null : r.updated), now);
    if (publishedAt && Date.parse(publishedAt) < Date.parse(now) - 30 * 86400000) return [];
    return [
      {
        ...i,
        summary: summary || '查看来源原文，了解完整背景与细节。',
        categories,
        tags: [
          source.authorPosts
            ? '社区文章'
            : source.community
              ? '社区讨论'
              : source.media
                ? '媒体报道'
                : '官方博客',
        ],
        publishedAt,
        updatedAt: date(r.updated, now),
        rankScore: Math.max(0, 95 - index * 3),
      },
    ];
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UPSTREAM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// The static collector persists this map outside public assets between invocations.
export const sourceCooldowns = new Map();
export async function fetchText(
  url,
  { headers = {}, fetchImpl = fetch, sleepImpl = sleep, timeout = 15000, attempts = 3 } = {},
) {
  const host = new URL(url).hostname;
  const cooldown = sourceCooldowns.get(host);
  if (cooldown?.until > Date.now()) {
    const error = new Error('源站冷却中，暂停至 ' + new Date(cooldown.until).toISOString());
    error.retryable = false;
    throw error;
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    let delay = 500 * 2 ** attempt;
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'Signal-AI-News/1.0 (+public-news-aggregator)', ...headers },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const retryable = [408, 500, 502, 503, 504].includes(response.status);
        const raw = response.headers.get('retry-after');
        if (raw) {
          const seconds = Number(raw);
          delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
          delay = Number.isFinite(delay) ? Math.max(0, delay) : UPSTREAM_COOLDOWN_MS;
        }
        await response.body?.cancel();
        if ([403, 429].includes(response.status)) {
          const until = Date.now() + Math.max(UPSTREAM_COOLDOWN_MS, delay);
          sourceCooldowns.set(host, { until, status: response.status });
          console.warn(
            'collection alert:',
            host,
            'HTTP',
            response.status,
            'paused until',
            new Date(until).toISOString(),
          );
        }
        const error = new Error('HTTP ' + response.status);
        error.retryable = retryable && delay <= 10000;
        throw error;
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel();
        const error = new Error('响应超过 2MB');
        error.retryable = false;
        throw error;
      }
      if (!response.body) throw new Error('响应为空');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) {
            await reader.cancel();
            const error = new Error('响应超过 2MB');
            error.retryable = false;
            throw error;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (attempt === attempts - 1 || error.retryable === false) throw error;
      await sleepImpl(delay);
    }
  }
  throw new Error('请求失败');
}
export function deduplicate(items) {
  const map = new Map();
  for (const item of items) {
    const url = canonicalUrl(item.url);
    if (!url) continue;
    const existing = map.get(url);
    if (existing) {
      const newer =
        Date.parse(item.collectedAt) >= Date.parse(existing.collectedAt) ? item : existing;
      map.set(url, {
        ...newer,
        categories: [...new Set([...existing.categories, ...item.categories])],
      });
    } else map.set(url, item);
  }
  return [...map.values()].sort((a, b) => itemTime(b) - itemTime(a)).slice(0, 500);
}
export function mergeResults(previous, results, now) {
  if (!results.some((r) => r.ok && r.items.length))
    throw new Error('全部来源采集失败；未覆盖上次快照。');
  const old = previous?.items ?? [];
  const items = [];
  const sources = [];
  for (const result of results) {
    const source = result.source;
    const oldSource = previous?.sources?.find((s) => s.id === source.id);
    const successful = result.ok && result.items.length > 0;
    let next = successful ? result.items : old.filter((i) => i.sourceId === source.id);
    if (successful && source.kind === 'rss')
      next = [
        ...old.filter(
          (i) =>
            i.sourceId === source.id &&
            i.publishedAt &&
            Date.parse(i.publishedAt) >= Date.parse(now) - 30 * 86400000,
        ),
        ...next,
      ];
    next = deduplicate(next);
    items.push(...next);
    sources.push({
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      status: successful ? 'ok' : 'error',
      lastSuccessAt: successful ? now : (oldSource?.lastSuccessAt ?? null),
      itemCount: next.length,
      error: successful ? null : plainText(result.error || '本次没有有效条目', 180),
    });
  }
  const merged = deduplicate(items);
  for (const source of sources)
    source.itemCount = merged.filter((i) => i.sourceId === source.id).length;
  return validateFeed({ schemaVersion: 1, generatedAt: now, sources, items: merged });
}
