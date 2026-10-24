import { ui } from './i18n';
import './theme.css';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'signal-theme';

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function initTheme(toast: (message: string) => void) {
  const root = document.documentElement;
  const picker = document.querySelector<HTMLElement>('#theme-picker')!;
  const toggle = picker.querySelector<HTMLButtonElement>('#theme-toggle')!;
  const settings = picker.querySelector<HTMLButtonElement>('#theme-settings')!;
  const panel = picker.querySelector<HTMLElement>('#theme-panel')!;
  const systemMedia = matchMedia('(prefers-color-scheme: dark)');
  let system = storedTheme() === null;
  let desired: Theme = root.dataset.theme === 'dark' ? 'dark' : 'light';
  let transition: ViewTransition | null = null;
  let revision = 0;

  function sync() {
    const dark = root.dataset.theme === 'dark';
    const label = ui(dark ? '切换浅色模式' : '切换深色模式');
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    picker.querySelector<SVGElement>('.theme-toggle-icon')!.dataset.mode = dark ? 'dark' : 'light';
    picker.querySelector('#theme-name')!.textContent = ui(dark ? '夜航' : '日光');
    picker.querySelector('#theme-system-status')!.textContent = system ? ui(' · 已开启') : '';
    for (const option of panel.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')) {
      const active =
        option.dataset.themeChoice === 'system'
          ? system
          : option.dataset.themeChoice === root.dataset.theme;
      option.setAttribute('aria-pressed', String(active));
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim());
  }

  function setOpen(open: boolean, restoreFocus = false) {
    panel.hidden = !open;
    settings.setAttribute('aria-expanded', String(open));
    if (open) {
      const selected = system
        ? '[data-theme-choice="system"]'
        : '.theme-option[aria-pressed="true"]';
      panel.querySelector<HTMLButtonElement>(selected)?.focus({ preventScroll: true });
    } else if (restoreFocus) {
      settings.focus({ preventScroll: true });
    }
  }

  function persist() {
    try {
      if (system) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, desired);
    } catch {
      toast(ui('主题已切换；当前浏览器无法保存偏好。'));
    }
  }

  function select(next: Theme, followSystem = false, animate = true) {
    const request = ++revision;
    transition?.skipTransition();
    transition = null;
    delete root.dataset.themeTransition;
    desired = next;
    system = followSystem;
    persist();
    const commit = () => {
      // A skipped transition may still run its update callback after a newer selection.
      if (request !== revision) return;
      root.dataset.theme = desired;
      sync();
    };
    const animated =
      animate &&
      next !== root.dataset.theme &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      document.startViewTransition;
    if (!animated) {
      commit();
      return;
    }
    const bounds = toggle.getBoundingClientRect();
    root.style.setProperty('--theme-x', `${bounds.left + bounds.width / 2}px`);
    root.style.setProperty('--theme-y', `${bounds.top + bounds.height / 2}px`);
    const active = document.startViewTransition(() => {
      if (request === revision) root.dataset.themeTransition = 'true';
      commit();
    });
    transition = active;
    const cleanup = () => {
      if (transition !== active) return;
      delete root.dataset.themeTransition;
      transition = null;
    };
    // Resizing or a subsequent click may legitimately skip the reveal.
    void active.ready.catch(() => undefined);
    void active.finished.then(cleanup, cleanup);
  }

  toggle.addEventListener('click', () => {
    setOpen(false);
    select(desired === 'dark' ? 'light' : 'dark');
  });
  settings.addEventListener('click', () => setOpen(Boolean(panel.hidden)));
  settings.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    setOpen(true);
  });
  panel.addEventListener('click', (event) => {
    const choice = (event.target as Element).closest<HTMLButtonElement>('[data-theme-choice]')
      ?.dataset.themeChoice;
    if (!choice) return;
    setOpen(false, true);
    select(
      choice === 'system' ? (systemMedia.matches ? 'dark' : 'light') : (choice as Theme),
      choice === 'system',
    );
  });
  panel.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index +
              (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) +
              options.length) %
            options.length;
    options[next]?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!picker.contains(event.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  picker.addEventListener('focusout', (event) => {
    if (!picker.contains(event.relatedTarget as Node | null)) setOpen(false);
  });
  systemMedia.addEventListener('change', (event) => {
    if (system) select(event.matches ? 'dark' : 'light', true, false);
  });
  sync();
  return { sync };
}
