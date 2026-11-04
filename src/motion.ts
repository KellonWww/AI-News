/** Keep reading progress and scrolled navigation state without decorative motion. */
export function initMotion() {
  const progress = document.querySelector<HTMLElement>('.reading-progress');
  const header = document.querySelector<HTMLElement>('.site-header');
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (progress)
      progress.style.transform =
        'scaleX(' + (max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0) + ')';
    header?.classList.toggle('is-scrolled', scrollY > 20);
  };
  // Filtering and loading change document height even when the scroll position is unchanged.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  new ResizeObserver(schedule).observe(document.body);
  schedule();
}
