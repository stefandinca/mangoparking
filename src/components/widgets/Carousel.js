// Lightweight, dependency-free carousel for the vanilla SPA.
//
// Markup contract (write the slides yourself, this only wires behaviour):
//   <div data-carousel>
//     <div data-carousel-track class="flex gap-4 overflow-x-auto snap-x snap-mandatory no-scrollbar">
//       <div class="snap-center shrink-0 w-[85%] ...">…slide…</div>
//       …
//     </div>
//     <div data-carousel-dots class="flex justify-center gap-2 mt-4"></div>
//   </div>
//
// initCarousel(root):
//   • builds one dot per slide and keeps the active dot in sync with scroll
//   • click a dot → smooth-scrolls that slide into view
//   • if the track doesn't overflow (e.g. all slides fit on desktop), the
//     dots are hidden — so the same markup is a plain row on large screens
//     and a swipeable carousel on small ones.

export function initCarousel(root) {
  if (!root) return () => {};
  const track = root.querySelector('[data-carousel-track]');
  const dotsWrap = root.querySelector('[data-carousel-dots]');
  if (!track) return () => {};
  const slides = Array.from(track.children);
  if (!slides.length) return () => {};

  const overflowing = () => track.scrollWidth - track.clientWidth > 4;

  // Build dots.
  if (dotsWrap) {
    dotsWrap.innerHTML = slides
      .map((_, i) => `<button type="button" data-carousel-dot="${i}" aria-label="${i + 1}" class="w-2 h-2 rounded-full bg-frost-deep transition-all"></button>`)
      .join('');
  }
  const dots = dotsWrap ? Array.from(dotsWrap.querySelectorAll('[data-carousel-dot]')) : [];

  function activeIndex() {
    // Nearest slide to the track's current scroll position.
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((s, i) => {
      const mid = s.offsetLeft + s.offsetWidth / 2;
      const d = Math.abs(mid - center);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function syncDots() {
    if (!dots.length) return;
    const show = overflowing();
    dotsWrap.classList.toggle('hidden', !show);
    if (!show) return;
    const active = activeIndex();
    dots.forEach((d, i) => {
      const on = i === active;
      d.classList.toggle('bg-blueberry', on);
      d.classList.toggle('w-5', on);
      d.classList.toggle('bg-frost-deep', !on);
      d.classList.toggle('w-2', !on);
    });
  }

  let raf = null;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; syncDots(); });
  };
  track.addEventListener('scroll', onScroll, { passive: true });

  dotsWrap?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-carousel-dot]');
    if (!btn) return;
    const i = Number(btn.dataset.carouselDot);
    const slide = slides[i];
    if (slide) {
      track.scrollTo({ left: slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2, behavior: 'smooth' });
    }
  });

  const onResize = () => syncDots();
  window.addEventListener('resize', onResize);

  syncDots();

  // Cleanup handle for pages that want it.
  return () => {
    track.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
  };
}
