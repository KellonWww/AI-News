import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const now = new Date().toISOString();
const categories = ['news', 'projects', 'skills', 'models', 'tips', 'apps', 'dev'];
const fixture = {
  schemaVersion: 1,
  generatedAt: now,
  sources: [
    {
      id: 'test-source',
      name: 'Fixture Source',
      homepage: 'https://example.com',
      status: 'ok',
      lastSuccessAt: now,
      itemCount: 28,
      error: null,
    },
  ],
  items: Array.from({ length: 28 }, (_, i) => ({
    id: 'test-' + i,
    title:
      i === 0 ? 'How to build a useful AI project' : 'Test signal ' + String(i).padStart(2, '0'),
    summary: 'Test-only content for deterministic interaction checks.',
    url: 'https://example.com/news/' + i,
    sourceId: 'test-source',
    sourceName: 'Fixture Source',
    categories: [categories[i % 7]],
    tags: ['test'],
    publishedAt: new Date(Date.now() - i * 12 * 3600000).toISOString(),
    updatedAt: null,
    collectedAt: now,
    rankScore: 100 - i,
    metricValue: i % 7 === 1 ? 1000 + i * 30 : null,
    metricPrev: i % 7 === 1 ? 1000 : null,
    metricLabel: i % 7 === 1 ? 'stars' : null,
  })),
};
async function mock(page, data = fixture) {
  await page.route('**/data/feed.json', (route) => route.fulfill({ json: data }));
  await page.goto('./');
  await expect(page.locator('#feed-grid')).toHaveAttribute('aria-busy', 'false');
}

test('real snapshot loads under the GitHub Pages project subpath without missing assets or runtime errors', async ({
  page,
}) => {
  const errors = [];
  const bad = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().startsWith('http://127.0.0.1') && r.status() >= 400) bad.push(r.url());
  });
  await page.goto('./');
  await expect(page.locator('.news-card').first()).toBeVisible();
  await expect(page.locator('#updated-at')).toContainText('快照生成于');
  expect(errors).toEqual([]);
  expect(bad).toEqual([]);
  for (const link of await page
    .locator('.card-title')
    .evaluateAll((nodes) => nodes.map((n) => ({ href: n.href, rel: n.rel, target: n.target })))) {
    expect(link.href).toMatch(/^https:\/\//);
    expect(link.rel).toContain('noopener');
    expect(link.target).toBe('_blank');
  }
});
test('category, search, time filter and clear can be combined', async ({ page }) => {
  await mock(page);
  await page.locator('[data-category="skills"]').click();
  await expect(page.locator('.news-card')).toHaveCount(4);
  await page.locator('#search').fill('Test signal 02');
  await expect(page.locator('.news-card')).toHaveCount(1);
  await page.locator('#time-filter').selectOption('1');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选，查看全部' }).click();
  await expect(page.locator('.news-card')).toHaveCount(12);
  await expect(page.locator('#search')).toHaveValue('');
});
test('pagination appends results and category changes reset the page size', async ({ page }) => {
  await mock(page);
  await page.locator('#load-more').click();
  await expect(page.locator('.news-card')).toHaveCount(24);
  await page.locator('[data-category="news"]').click();
  await expect(page.locator('.news-card')).toHaveCount(4);
  await page.locator('[data-category="all"]').click();
  await expect(page.locator('.news-card')).toHaveCount(12);
});
test('sorting shows ranking disclaimer', async ({ page }) => {
  await mock(page);
  await page.locator('#sort').selectOption('hot');
  await expect(page.locator('#sort-note')).toBeVisible();
  await page.locator('#sort').selectOption('latest');
  await expect(page.locator('#sort-note')).toBeHidden();
});
test('growth sort leads with the biggest star delta and sinks metric-less items', async ({
  page,
}) => {
  await mock(page);
  await page.locator('#sort').selectOption('growth');
  await expect(page.locator('#sort-note')).toContainText('涨星最快');
  // deltas are i*30 on i ∈ {1,8,15,22} → biggest first, everything else sinks
  await expect(page.locator('.news-card').first().locator('h3')).toContainText('Test signal 22');
  await expect(page.locator('.metric-delta')).toHaveCount(4);
  await expect(page.locator('.metric-delta').first()).toHaveText('+660');
  await expect(page.locator('.news-card').nth(4).locator('.metric-delta')).toHaveCount(0);
});
test('editor note renders from the feed and stays hidden without one', async ({ page }) => {
  await mock(page);
  await expect(page.locator('#editor-note')).toBeHidden();
  const data = structuredClone(fixture);
  data.editorNote = { date: '2026-10-06', text: '看点：开源持续发力。' };
  await mock(page, data);
  await expect(page.locator('#editor-note')).toBeVisible();
  await expect(page.locator('#editor-note')).toHaveText('看点：开源持续发力。');
});
test('static snapshots keep cloud-only entries hidden', async ({ page }) => {
  await mock(page);
  await expect(page.locator('#nav-archive')).toBeHidden();
  await expect(page.locator('#nav-stats')).toBeHidden();
});
test('bookmark persists after reload and can be removed from saved view', async ({ page }) => {
  await mock(page);
  await page.locator('.news-card .save-button').first().click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.reload();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.locator('.top-nav [data-action="saved"]').click();
  await expect(page.locator('.news-card')).toHaveCount(1);
  await page.locator('.news-card .save-button').click();
  await expect(page.locator('.empty-state h3')).toContainText('收藏');
  await expect(page.locator('#saved-count')).toHaveText('0');
});
test('theme follows system initially, toggles, and persists across reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mock(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-label', '切换浅色模式');
});
test('source dialog opens and escape closes it', async ({ page }) => {
  await mock(page);
  await page.locator('#edition-status').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#source-list')).toContainText('Fixture Source');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});
test('partial failure and stale snapshot are visible', async ({ page }) => {
  const data = structuredClone(fixture);
  data.generatedAt = '2025-01-01T00:00:00Z';
  data.sources[0].status = 'error';
  data.sources[0].error = 'Network unavailable';
  await mock(page, data);
  await expect(page.locator('#health-notice')).toContainText('36 小时');
  await page.locator('#edition-status').click();
  await expect(page.locator('#source-list')).toContainText('Network unavailable');
  await expect(page.locator('.source-status')).toContainText('暂未同步');
});
test('failed first load offers a working retry', async ({ page }) => {
  let fail = true;
  await page.route('**/data/feed.json', (route) =>
    fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.fulfill({ json: fixture }),
  );
  await page.goto('./');
  await expect(page.locator('.empty-state')).toContainText('信号暂时没有抵达');
  fail = false;
  await page.locator('.empty-state button').click();
  await expect(page.locator('.news-card')).toHaveCount(12);
});
test('malicious feed text is inert and unsafe URLs reject the snapshot', async ({ page }) => {
  const data = structuredClone(fixture);
  data.items[0].title = '<img src=x onerror="window.injected=true">';
  await mock(page, data);
  await expect(page.locator('.card-title').first()).toContainText('<img');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(await page.locator('.news-card img').count()).toBe(0);
  data.items[0].url = 'javascript:alert(1)';
  await page.reload();
  await expect(page.locator('.empty-state')).toContainText('信号暂时没有抵达');
});
test('corrupt or blocked storage does not prevent rendering', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('signal-saved', '{bad');
    localStorage.setItem('signal-theme', 'invalid');
  });
  await mock(page);
  await expect(page.locator('#saved-count')).toHaveText('0');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.locator('.news-card .save-button').first().click();
  await expect(page.locator('#toast')).toContainText('无法持久保存');
});
test('empty valid feed has an honest empty state', async ({ page }) => {
  await mock(page, { ...fixture, items: [] });
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('#load-more')).toBeHidden();
});
test('mobile widths never overflow and reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mock(page);
  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  expect(
    await page
      .locator('.hero-paper .live-dot')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});
test('keyboard search shortcut and dialog accessibility', async ({ page }) => {
  await mock(page);
  await page.keyboard.press('/');
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('#edition-status').click();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'sources-title');
  await page.keyboard.press('Escape');
  await expect(page.locator('#edition-status')).toBeFocused();
});
test('light and dark views pass automated WCAG A/AA checks', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mock(page);
  let result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
  await page.locator('#theme-toggle').click();
  await page.waitForTimeout(350);
  result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('reading progress follows scrolling without blocking content', async ({ page }) => {
  await mock(page);
  const progress = page.locator('.reading-progress');
  await expect(progress).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
  await expect
    .poll(() =>
      progress.evaluate((el) =>
        Number(getComputedStyle(el).transform.split('(')[1]?.split(',')[0]),
      ),
    )
    .toBeGreaterThan(0.9);
  await expect(page.locator('.site-header')).toHaveClass(/is-scrolled/);
});
test('pointer decoration respects touch and reduced-motion preferences', async ({
  page,
  isMobile,
}) => {
  await mock(page);
  const hero = page.locator('.hero');
  await hero.hover();
  if (!isMobile) await expect(hero).toHaveClass(/pointer-active/);
  else await expect(hero).not.toHaveClass(/pointer-active/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(hero).not.toHaveClass(/pointer-active/);
  expect(
    await page
      .locator('.hero-paper .live-dot')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  expect(
    await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    ),
  ).toBe(0);
  await expect(page.locator('.news-card').first()).toBeVisible();
});

test('entity tags and China focus combine, clear and preserve keyboard focus', async ({ page }) => {
  const data = structuredClone(fixture);
  data.items[0].title = 'ChatGPT 发布编程教程';
  data.items[1].title = 'DeepSeek 新模型';
  data.items[2].title = 'Qwen3 Agent Skills';
  await mock(page, data);
  await expect(page.locator('#featured .topic-tag').first()).toHaveText('ChatGPT');
  await page.locator('#china-filter').click();
  await expect(page.locator('.news-card')).toHaveCount(2);
  await page.locator('#feed-grid [data-tag="DeepSeek"]').click();
  await expect(page.locator('.news-card')).toHaveCount(1);
  await expect(page.locator('#active-tag')).toBeFocused();
  await page.locator('[data-category="skills"]').click();
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.locator('#active-tag').click();
  await expect(page.locator('.news-card')).toHaveCount(1);
  await page.locator('#clear-filters').click();
  await expect(page.locator('.news-card')).toHaveCount(12);
  await expect(page.locator('#china-filter')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#active-tag')).toBeHidden();
});

test('editorial layout keeps the signal artwork, local font and responsive reading index', async ({
  page,
}) => {
  await mock(page);
  await expect(page.locator('.hero-wordmark')).toHaveText('signal.');
  await expect(page.locator('.signal-art svg')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Outfit'))).toBe(true);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    const index = await page.locator('.discover-index').boundingBox();
    const content = await page.locator('.discover-content').boundingBox();
    expect(index).not.toBeNull();
    expect(content).not.toBeNull();
    if (width === 1440) expect(content.x).toBeGreaterThan(index.x + index.width);
    else expect(content.y).toBeGreaterThan(index.y + index.height);
  }
});

test('Ctrl+F opens centered site search and submits synchronized results', async ({ page }) => {
  await mock(page);
  await page.locator('#theme-toggle').focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Control+f');
  const dialog = page.locator('#search-dialog');
  const input = page.locator('#search-modal-input');
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  await expect
    .poll(async () => {
      const centered = await dialog.boundingBox();
      return Math.abs(centered.y + centered.height / 2 - viewport.height / 2);
    })
    .toBeLessThan(2);
  await input.fill('Test signal 02');
  await expect(page.locator('#search')).toHaveValue('Test signal 02');
  await expect(page.locator('#search-feedback')).toContainText('1 条');
  await page.keyboard.press('Control+f');
  await expect(input).toHaveValue('Test signal 02');
  expect(await input.evaluate((el) => el.selectionEnd - el.selectionStart)).toBe(14);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('.news-card')).toHaveCount(1);
  await expect(page.locator('.news-card')).toContainText('Test signal 02');
});

test('search supports Command+F, empty results, Escape, backdrop and click entry', async ({
  page,
}) => {
  await mock(page);
  await page.locator('#search').fill('Test signal 02');
  await page.keyboard.press('Meta+f');
  const dialog = page.locator('#search-dialog');
  const input = page.locator('#search-modal-input');
  await expect(input).toHaveValue('Test signal 02');
  await input.fill('no-matching-signal');
  await expect(page.locator('#search-feedback')).toContainText('0 条');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('.search-shortcut').click();
  await expect(input).toHaveValue('no-matching-signal');
  await input.fill('');
  await expect(page.locator('#search-feedback')).toContainText('28 条');
  await page.mouse.click(2, 2);
  await expect(dialog).toBeHidden();
  await expect(page.locator('.search-shortcut')).toBeFocused();
});

test('modal search preserves filters and does not interrupt another dialog', async ({ page }) => {
  await mock(page);
  await page.locator('[data-category="skills"]').click();
  await page.keyboard.press('Control+f');
  await page.locator('#search-modal-input').fill('Test signal 02');
  await expect(page.locator('#search-feedback')).toContainText('1 条');
  await page.getByRole('button', { name: '关闭搜索', exact: true }).click();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search-modal-input')).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.locator('#account-button').click();
  await expect(page.locator('#account-dialog')).toBeVisible();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await expect(page.locator('#account-dialog')).toBeVisible();
});

test('site search dialog is translated and accessible in both themes', async ({ page }) => {
  await mock(page);
  await page.locator('#language-toggle').click();
  await page.keyboard.press('Control+f');
  await expect(page.getByRole('dialog', { name: 'Site search' })).toBeVisible();
  await expect(page.locator('#search-modal-input')).toHaveAttribute(
    'placeholder',
    'Search projects, models, ideas…',
  );
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  }
});

test('glass surfaces keep opaque article reading and both search entries work', async ({
  page,
}) => {
  await mock(page);
  for (const selector of ['.site-header', '.discover-index', '.lens-surface']) {
    const filter = await page
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(filter).toContain('blur(');
  }
  expect(
    await page.locator('.discover-content').evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toBe('none');
  await page.locator('.header-search').click();
  await expect(page.locator('#search-modal-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.header-search')).toBeFocused();
  await page.locator('.search-shortcut').click();
  await expect(page.locator('#search-modal-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('#language-toggle').click();
  await expect(page.locator('.hero-subtitle')).toHaveText('From the world of AI,a daily dispatch.');
  await expect(page.locator('.section-number')).toHaveText('Your AI reading room');
});

test('edition separates recent stories from newly created tools and ignores old pushes', async ({
  page,
}) => {
  const data = structuredClone(fixture);
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  data.items = [
    {
      ...fixture.items[0],
      id: 'story',
      title: 'Recent source-backed story',
      url: 'https://example.com/story',
    },
    {
      ...fixture.items[1],
      id: 'new-tool',
      title: 'org/new-tool',
      url: 'https://example.com/new-tool',
      publishedAt: now,
    },
    {
      ...fixture.items[1],
      id: 'old-tool',
      title: 'Old popular repository',
      url: 'https://example.com/old-tool',
      publishedAt: old,
      updatedAt: now,
      metricValue: 999999,
    },
    {
      ...fixture.items[0],
      id: 'old-story',
      title: 'Old story pushed today',
      url: 'https://example.com/old-story',
      publishedAt: old,
      updatedAt: now,
    },
  ];
  await mock(page, data);
  await expect(page.locator('#featured')).toContainText('Recent source-backed story');
  await expect(page.locator('#trending')).toContainText('new-tool');
  await expect(page.locator('#trending')).not.toContainText('Old popular repository');
  await expect(page.locator('#paper-list')).not.toContainText('Old story pushed today');
  await expect(page.locator('#paper-foot')).toContainText('本期精选 2 条');
  await expect(page.locator('.news-card')).toHaveCount(4);
  await expect(page.locator('.reader-guide')).toHaveCount(0);
  await page.locator('#language-toggle').click();
  await expect(page.locator('.reader-guide')).toHaveCount(0);
  await expect(page.locator('#paper-foot')).toContainText('This edition: 2 picks');
});

test('stale-only editions are not padded while the full library remains readable', async ({
  page,
}) => {
  const data = structuredClone(fixture);
  data.items = data.items.map((item) => ({
    ...item,
    publishedAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: now,
  }));
  await mock(page, data);
  await expect(page.locator('#featured')).toContainText('近 7 天没有可核实发布日期');
  await expect(page.locator('#trending')).toContainText('近 30 天暂无新建工具');
  await expect(page.locator('#paper-foot')).toContainText('本期精选 0 条');
  await expect(page.locator('.news-card')).toHaveCount(12);
});

test('theme settings support system preference, explicit choices, and live system changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mock(page);
  await page.locator('#theme-settings').click();
  await expect(page.locator('[data-theme-choice="system"]')).toBeFocused();
  await expect(page.locator('[data-theme-choice="system"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-panel')).toBeHidden();
  await expect(page.locator('#theme-settings')).toBeFocused();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme-settings').click();
  await page.locator('[data-theme-choice="system"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('signal-theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#theme-settings').click();
  await expect(page.locator('[data-theme-choice="system"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('theme panel supports keyboard navigation, escape, outside click, and focus dismissal', async ({
  page,
}) => {
  await mock(page);
  const settings = page.locator('#theme-settings');
  await settings.focus();
  await page.keyboard.press('ArrowDown');
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Home');
  await expect(page.locator('[data-theme-choice="dark"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-theme-choice="light"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('[data-theme-choice="system"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-theme-choice="dark"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#theme-panel')).toBeHidden();
  await expect(settings).toBeFocused();
  await settings.click();
  await page.locator('#hero-title').click();
  await expect(page.locator('#theme-panel')).toBeHidden();
  await settings.click();
  await page.locator('#language-toggle').focus();
  await expect(page.locator('#theme-panel')).toBeHidden();
});

test('theme reveal starts at the toggle and cleans up after animation', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await mock(page);
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-transition', 'true');
  const reveal = await page.evaluate(() => {
    const root = document.documentElement;
    const bounds = document.querySelector('#theme-toggle').getBoundingClientRect();
    return {
      x: parseFloat(root.style.getPropertyValue('--theme-x')),
      y: parseFloat(root.style.getPropertyValue('--theme-y')),
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      animation: getComputedStyle(root, '::view-transition-new(root)').animationName,
    };
  });
  expect(reveal.x).toBeCloseTo(reveal.centerX, 0);
  expect(reveal.y).toBeCloseTo(reveal.centerY, 0);
  expect(reveal.animation).toBe('theme-reveal');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await expect(page.locator('.theme-toggle-icon')).toHaveAttribute('data-mode', 'dark');
  const meta = await page.evaluate(() => ({
    actual: document.querySelector('meta[name="theme-color"]').content,
    expected: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  }));
  expect(meta.actual).toBe(meta.expected);
});

test('rapid theme toggles keep the final intent without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await mock(page);
  await page.evaluate(() => {
    const toggle = document.querySelector('#theme-toggle');
    for (let i = 0; i < 7; i++) toggle.click();
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  expect(await page.evaluate(() => localStorage.getItem('signal-theme'))).toBe('dark');
  await page.evaluate(() => {
    const toggle = document.querySelector('#theme-toggle');
    toggle.click();
    toggle.click();
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('theme switching falls back without View Transitions or with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await mock(page);
  await page.evaluate(() => {
    window.themeTransitionCalls = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      window.themeTransitionCalls++;
      return start(...args);
    };
  });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => window.themeTransitionCalls)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    document.startViewTransition = undefined;
  });
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
});

test('theme settings remain translated and usable when storage is blocked', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mock(page);
  await page.locator('#language-toggle').click();
  await expect(page.locator('#theme-settings')).toHaveAttribute('aria-label', 'Theme settings');
  await page.locator('#theme-settings').click();
  await expect(page.locator('#theme-panel')).toContainText('Follow system');
  await expect(page.locator('#theme-panel')).toContainText('Nightfall');
  await page.evaluate(() => {
    Storage.prototype.setItem = Storage.prototype.removeItem = () => {
      throw new Error('blocked');
    };
  });
  await page.locator('[data-theme-choice="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#toast')).toContainText('cannot save your preference');
  await page.locator('#theme-settings').click();
  await page.locator('[data-theme-choice="system"]').click();
  await expect(page.locator('#toast')).toContainText('cannot save your preference');
});
