import { english } from './translations';
export type Language = 'zh' | 'en';
let language: Language = 'zh';
try {
  if (localStorage.getItem('signal-language') === 'en') language = 'en';
} catch {
  /* Storage is optional. */
}
export const locale = () => (language === 'en' ? 'en-US' : 'zh-CN');
export const currentLanguage = () => language;
const escaped = Object.keys(english)
  .sort((a, b) => b.length - a.length)
  .map((key) =>
    Array.from(key)
      .map((char) => ('\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char))
      .join(''),
  );
const pattern = new RegExp(escaped.join('|'), 'g');
/** Translate only trusted UI literals/templates, before interpolating escaped external data. */
export function ui(copy: string): string {
  return language === 'en' ? copy.replace(pattern, (key) => english[key] ?? key) : copy;
}
function syncDocument() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title =
    language === 'en'
      ? 'signal. AI Daily — Less noise. More to discover.'
      : 'signal. AI 日报 - 少一点噪声，多一点新知';
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      language === 'en'
        ? 'Discover AI news, open-source projects, models, Agent Skills and developer news. Daily picks, linked to the original.'
        : 'signal. AI 日报。每天发现值得关注的 AI 新闻、开源项目、模型、Agent Skills 与开发者技术热点。每日精选，直达原文。',
    );
  document
    .querySelector('link[rel="alternate"]')
    ?.setAttribute('title', language === 'en' ? 'signal. AI Daily' : 'signal. AI 日报');
  const toggle = document.getElementById('language-toggle');
  if (toggle) {
    toggle.textContent = language === 'zh' ? 'EN' : '中文';
    toggle.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
    toggle.setAttribute('lang', language === 'zh' ? 'en' : 'zh-CN');
    toggle.title = language === 'zh' ? 'Switch to English' : '切换为中文';
  }
}
/** Bind only the initial, developer-owned shell. Detached nodes are never restored. */
export function bindShellLanguage(root: HTMLElement) {
  const bindings: (() => void)[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest('script, style, noscript')) continue;
    const original = node.data;
    if (!/[\u3400-\u9fff]/.test(original)) continue;
    bindings.push(() => {
      if (node.isConnected)
        node.data = language === 'zh' ? original : ui(original.replace(/\s+/g, ' '));
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]')) {
    for (const name of ['aria-label', 'placeholder', 'title']) {
      const original = el.getAttribute(name);
      if (original && /[\u3400-\u9fff]/.test(original))
        bindings.push(() => {
          if (el.isConnected) el.setAttribute(name, ui(original));
        });
    }
  }
  const apply = () => {
    bindings.forEach((update) => update());
    syncDocument();
  };
  document.addEventListener('signal:language', apply);
  apply();
}
export function toggleLanguage(): boolean {
  language = language === 'zh' ? 'en' : 'zh';
  let persisted = true;
  try {
    localStorage.setItem('signal-language', language);
  } catch {
    persisted = false;
  }
  document.dispatchEvent(new Event('signal:language'));
  return persisted;
}
