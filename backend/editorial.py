"""Deterministic edition selection; mirrored by src/data.mjs selectEdition."""
from util import canonical_url, epoch_ms

DAY_MS = 86400000


def is_resource(item):
    if item['sourceId'] in ('qbitai', 'hf-blog', 'github-blog'):
        return False
    return any(c in ('projects', 'skills', 'models', 'apps') for c in item['categories'])


def select_edition(items, now_ms):
    seen = set()

    def recent(item, days):
        value = item.get('publishedAt')
        if not isinstance(value, str):
            return False
        try:
            ts = epoch_ms(value)
        except ValueError:
            return False
        return now_ms - days * DAY_MS <= ts <= now_ms

    def pick(candidates, limit):
        counts = {}
        result = []
        technical = 0
        for item in candidates:
            url = canonical_url(item['url'])
            count = counts.get(item['sourceId'], 0)
            if not url or url in seen or count >= 2 or ('dev' in item['categories'] and technical >= 3):
                continue
            if 'dev' in item['categories']:
                technical += 1
            seen.add(url)
            counts[item['sourceId']] = count + 1
            result.append(item)
            if len(result) == limit:
                break
        return result

    news = sorted(
        (i for i in items if not is_resource(i) and recent(i, 7)),
        key=lambda i: (-epoch_ms(i['publishedAt']), i['id']),
    )
    tools = sorted(
        (i for i in items if is_resource(i) and recent(i, 30)),
        key=lambda i: (-epoch_ms(i['publishedAt']), -i['rankScore'], i['id']),
    )
    return {'news': pick(news, 7), 'tools': pick(tools, 3)}
