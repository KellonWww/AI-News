import { enrichItem, isChinaRelated } from './topics.mjs';
/** Shared data contract; kept dependency-free for browser and Node. */
export const CATEGORY_LABELS = Object.freeze({
  news: 'AI 动态',
  projects: '开源项目',
  skills: 'Skills',
  models: '模型动态',
  tips: '实用技巧',
  apps: '趣味应用',
  dev: '技术热点',
});
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export function canonicalUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return null;
  const u = new URL(safe);
  u.hash = '';
  for (const key of [...u.searchParams.keys()])
    if (/^utm_/i.test(key) || ['ref', 'source', 'fbclid', 'gclid'].includes(key))
      u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/$/, '') || '/';
  u.searchParams.sort();
  return u.href;
}
export function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
export function itemTime(item) {
  return Date.parse(item.updatedAt || item.publishedAt || '') || 0;
}
export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function validateFeed(value) {
  const fail = () => {
    throw new Error('数据格式校验失败，请稍后重新加载。');
  };
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !isoDate(value.generatedAt) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.items) ||
    value.items.length > 500 ||
    value.sources.length > 30
  )
    fail();
  const sources = new Set();
  const ids = new Set();
  for (const s of value.sources) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      !s.id ||
      sources.has(s.id) ||
      typeof s.name !== 'string' ||
      !safeUrl(s.homepage) ||
      !['ok', 'error'].includes(s.status) ||
      !Number.isInteger(s.itemCount) ||
      s.itemCount < 0 ||
      !(s.lastSuccessAt === null || isoDate(s.lastSuccessAt)) ||
      !(s.error === null || typeof s.error === 'string')
    )
      fail();
    sources.add(s.id);
  }
  for (const i of value.items) {
    if (
      !i ||
      typeof i.id !== 'string' ||
      !i.id ||
      ids.has(i.id) ||
      typeof i.title !== 'string' ||
      !i.title.trim() ||
      typeof i.summary !== 'string' ||
      typeof i.sourceName !== 'string' ||
      !sources.has(i.sourceId) ||
      !safeUrl(i.url) ||
      !Array.isArray(i.categories) ||
      !i.categories.length ||
      i.categories.some((c) => !Object.hasOwn(CATEGORY_LABELS, c)) ||
      !Array.isArray(i.tags) ||
      i.tags.some((t) => typeof t !== 'string') ||
      !isoDate(i.collectedAt) ||
      !(i.publishedAt === null || isoDate(i.publishedAt)) ||
      !(i.updatedAt === null || isoDate(i.updatedAt)) ||
      !Number.isFinite(i.rankScore) ||
      i.rankScore < 0 ||
      i.rankScore > 100 ||
      !(i.metricValue === null || (Number.isFinite(i.metricValue) && i.metricValue >= 0)) ||
      // metricPrev arrived with growth sorting; static snapshots ship without it
      !(
        i.metricPrev === undefined ||
        i.metricPrev === null ||
        (Number.isFinite(i.metricPrev) && i.metricPrev >= 0)
      ) ||
      !(i.metricLabel === null || typeof i.metricLabel === 'string')
    )
      fail();
    ids.add(i.id);
  }
  if (
    value.editorNote !== undefined &&
    !(
      value.editorNote === null ||
      (value.editorNote &&
        typeof value.editorNote.date === 'string' &&
        typeof value.editorNote.text === 'string' &&
        value.editorNote.text.trim())
    )
  )
    fail();
  return { ...value, items: value.items.map(enrichItem) };
}
export function growthDelta(item) {
  return item.metricValue !== null && item.metricPrev !== null
    ? item.metricValue - item.metricPrev
    : Number.NEGATIVE_INFINITY;
}
export function filterItems(
  items,
  {
    query = '',
    tag = '',
    chinaOnly = false,
    category = 'all',
    days = 0,
    sort = 'latest',
    savedOnly = false,
    saved = new Set(),
    now = Date.now(),
  } = {},
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return items
    .filter(
      (i) =>
        (category === 'all' || i.categories.includes(category)) &&
        (!tag || i.tags.includes(tag)) &&
        (!chinaOnly || isChinaRelated(i)) &&
        (!savedOnly || saved.has(i.id)) &&
        (!days || itemTime(i) >= now - days * 86400000) &&
        terms.every((term) =>
          [
            i.title,
            i.summary,
            i.sourceName,
            ...i.tags,
            ...i.categories.map((c) => CATEGORY_LABELS[c]),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort((a, b) =>
      sort === 'hot'
        ? b.rankScore - a.rankScore || itemTime(b) - itemTime(a) || a.id.localeCompare(b.id)
        : sort === 'growth'
          ? growthDelta(b) - growthDelta(a) || itemTime(b) - itemTime(a) || a.id.localeCompare(b.id)
          : itemTime(b) - itemTime(a) || b.rankScore - a.rankScore || a.id.localeCompare(b.id),
    );
}

/** Repository/model timestamps describe artifacts, not news events. */
export function isResource(item) {
  if (['qbitai', 'hf-blog', 'github-blog'].includes(item.sourceId)) return false;
  return item.categories.some((c) => ['projects', 'skills', 'models', 'apps'].includes(c));
}

/** A small, source-diverse edition. Never pad it with stale or undated entries. */
export function selectEdition(items, now = Date.now()) {
  const day = 86400000;
  const recent = (value, days) => {
    const ts = Date.parse(value || '');
    return Number.isFinite(ts) && ts <= now && ts >= now - days * day;
  };
  const seen = new Set();
  const pick = (candidates, limit) => {
    const sources = new Map();
    const result = [];
    let technical = 0;
    for (const item of candidates) {
      const url = canonicalUrl(item.url);
      const count = sources.get(item.sourceId) || 0;
      if (
        !url ||
        seen.has(url) ||
        count >= 2 ||
        (item.categories.includes('dev') && technical >= 3)
      )
        continue;
      if (item.categories.includes('dev')) technical++;
      seen.add(url);
      sources.set(item.sourceId, count + 1);
      result.push(item);
      if (result.length === limit) break;
    }
    return result;
  };
  const news = pick(
    items
      .filter((i) => !isResource(i) && recent(i.publishedAt, 7))
      .sort(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id),
      ),
    7,
  );
  const tools = pick(
    items
      .filter((i) => isResource(i) && recent(i.publishedAt, 30))
      .sort(
        (a, b) =>
          Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
          b.rankScore - a.rankScore ||
          a.id.localeCompare(b.id),
      ),
    3,
  );
  return { news, tools };
}

/** Reader guidance is category context, never a fabricated product capability. */
export function readingContext(item) {
  if (!isResource(item)) {
    if (item.categories.includes('dev') && item.tags.includes('社区文章'))
      return ['适合开发者', '社区作者经验不等于官方结论；环境、版本与效果请结合原文自行核验。'];
    if (item.categories.includes('dev'))
      return item.tags.includes('社区讨论')
        ? [
            '适合开发者',
            '社区观点不等于官方结论；日期为帖子创建时间，不代表原文发布或事件发生时间。',
          ]
        : ['适合开发者', '关注技术变化及其影响；版本、兼容性和行动建议请核对官方公告。'];
    if (item.categories.includes('tips') || item.categories.includes('dev'))
      return ['适合开发者', '从原文教程了解实现方法；运行环境与步骤以作者说明为准。'];
    return ['关注 AI 动态的读者', '查看原文中的事件、发布时间与信息出处。'];
  }
  if (item.categories.includes('skills'))
    return ['Agent 使用者', '查看技能说明、依赖与权限，再决定是否接入自己的工作流。'];
  if (item.categories.includes('models'))
    return ['模型开发者', '先核对模型卡中的适用任务、许可证与运行要求。'];
  if (item.categories.includes('apps'))
    return ['想体验 AI 的读者', '查看演示与使用条件；可用性和费用以原站为准。'];
  return ['开发者', '结合仓库描述评估用途，再核对安装方法、许可证与维护情况。'];
}
