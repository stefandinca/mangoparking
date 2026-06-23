import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate, escapeHtml } from '../../utils/dom.js';
import { checkIcon, starIcon, planeIcon, peopleIcon, shuttleIcon } from '../../components/widgets/icons.js';
import { getGalleryImages } from '../../services/galleryService.js';
import { initCarousel } from '../../components/widgets/Carousel.js';
import { updateMeta, setStructuredData } from '../../utils/seo.js';
import { TOTAL_CAPACITY, SITE_URL, CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS, GOOGLE_REVIEWS_URL, GOOGLE_MAPS_EMBED } from '../../utils/constants.js';
import { subscribeCapacity } from '../../services/capacityService.js';
import { submitContactMessage } from '../../services/contactService.js';
import { isValidEmail, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';
import { getLongTermRates } from '../../services/longTermService.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { getPublishedReviews } from '../../services/reviewService.js';

// Fallback reviews shown when the Firestore reviews collection is empty.
// Once admin adds real ones (via /admin/reviews), those replace these.
const FALLBACK_REVIEWS = [
  { name: 'Andrei P.', type: 'traveler', rating: 5, comment: null },
  { name: 'Maria I.', type: 'traveler', rating: 5, comment: null },
  { name: 'Dan V.', type: 'traveler', rating: 4, comment: null },
];

// Built-in "Our facility" photos, shown until the admin adds gallery images
// (managed under /admin/website). Captions are alt text only.
const FALLBACK_GALLERY = [
  { url: '/images/entrance.jpg', caption: 'ManGO Parking' },
  { url: '/images/bus-2.jpg', caption: 'ManGO shuttle' },
  { url: '/images/parking-1.jpg', caption: 'Parking lot' },
  { url: '/images/bus-3.jpg', caption: 'Airport shuttle' },
];

// One page of gallery cards. `startIndex` makes each card's data-index its
// absolute position in the full list, so the lightbox can navigate across pages.
function galleryImageCards(images, startIndex = 0) {
  return images.map((img, i) => `
    <button type="button" data-gallery-item data-index="${startIndex + i}"
      class="rounded-2xl overflow-hidden h-44 sm:h-56 md:h-64 cursor-pointer group bg-frost-deep block">
      <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.caption || 'ManGO Parking')}" class="img-cover group-hover:scale-105 transition-transform duration-700" loading="lazy">
    </button>
  `).join('');
}

// Page prev/next controls (rendered only when there's more than one page).
function galleryPagerHtml(current, pages) {
  const arrow = (key, d, disabled) => `
    <button type="button" data-gallery-${key} ${disabled ? 'disabled' : ''} aria-label="${escapeHtml(t('gallery.' + key))}"
      class="w-10 h-10 rounded-full bg-frost hover:bg-frost-deep text-charcoal flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>
    </button>`;
  return `
    ${arrow('prev', 'M15.75 19.5L8.25 12l7.5-7.5', current === 0)}
    <span class="text-[14px] text-dim font-mono">${current + 1} / ${pages}</span>
    ${arrow('next', 'M8.25 4.5l7.5 7.5-7.5 7.5', current === pages - 1)}
  `;
}

// Fullscreen lightbox over the full image list with ‹ › navigation (and
// ArrowLeft/Right + Esc). Click the dark backdrop or the × to close.
function openGalleryLightbox(images, startIndex) {
  if (!images?.length) return;
  let idx = Math.max(0, Math.min(startIndex || 0, images.length - 1));
  const single = images.length <= 1;
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[95] flex items-center justify-center p-4 sm:p-12 bg-charcoal/90';
  const navBtn = (key, d) => `
    <button type="button" data-lb-${key} aria-label="${escapeHtml(t('gallery.' + key))}"
      class="${single ? 'hidden ' : ''}absolute ${key === 'prev' ? 'left-3 sm:left-6' : 'right-3 sm:right-6'} top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors z-10">
      <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>
    </button>`;
  overlay.innerHTML = `
    <button type="button" data-lb-close aria-label="${escapeHtml(t('gallery.close'))}" class="absolute top-5 right-5 text-white/80 hover:text-white z-10">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
    ${navBtn('prev', 'M15.75 19.5L8.25 12l7.5-7.5')}
    <img data-lb-img src="" alt="" class="max-w-full max-h-[85vh] rounded-2xl shadow-2xl select-none">
    ${navBtn('next', 'M8.25 4.5l7.5 7.5-7.5 7.5')}
    <p data-lb-caption class="absolute bottom-5 left-0 right-0 text-center text-white/90 text-[14px] px-6"></p>
  `;
  const imgEl = overlay.querySelector('[data-lb-img]');
  const capEl = overlay.querySelector('[data-lb-caption]');
  function show() {
    const im = images[idx];
    imgEl.src = im.url;
    imgEl.alt = im.caption || '';
    capEl.textContent = im.caption || '';
    capEl.classList.toggle('hidden', !im.caption);
  }
  function go(delta) { idx = (idx + delta + images.length) % images.length; show(); }
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-lb-close]').addEventListener('click', close);
  overlay.querySelector('[data-lb-prev]')?.addEventListener('click', (e) => { e.stopPropagation(); go(-1); });
  overlay.querySelector('[data-lb-next]')?.addEventListener('click', (e) => { e.stopPropagation(); go(1); });
  document.addEventListener('keydown', onKey);
  show();
  document.body.appendChild(overlay);
}

function initialsOf(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
}

export default function Home(container) {
  const locale = getLocale();

  // SEO
  updateMeta({
    title: locale === 'ro'
      ? 'ManGO Parking — Parcare Aeroport Otopeni | Credite Parcare Zilnică & Microbuz'
      : 'ManGO Parking — Otopeni Airport Parking | Daily Parking Credits & Shuttle',
    description: locale === 'ro'
      ? 'Parcare securizată lângă Aeroportul Henri Coandă Otopeni. Cumpără credite, parchează flexibil. Microbuz gratuit, acces cu barieră.'
      : 'Secure parking near Henri Coandă Otopeni Airport. Buy credits, park flexibly. Free shuttle, gated access.',
    lang: locale,
    hreflang: { ro: SITE_URL + '/', en: SITE_URL + '/en' },
  });

  // Structured data
  setStructuredData({
    '@context': 'https://schema.org',
    '@type': ['ParkingFacility', 'LocalBusiness'],
    name: 'ManGO Parking',
    description: 'Secure daily parking near Otopeni Airport with free shuttle service. Flexible credit system.',
    url: SITE_URL,
    telephone: CONTACT_PHONE,
    email: CONTACT_EMAIL,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Strada Radarului nr. 1',
      addressLocality: 'Corbeanca',
      addressRegion: 'Ilfov',
      addressCountry: 'RO',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 44.618, longitude: 26.084 },
    openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], opens: '00:00', closes: '23:59' },
    priceRange: '29-49 RON/day',
    amenityFeature: [
      { '@type': 'LocationFeatureSpecification', name: 'Free Shuttle', value: true },
    ],
  });

  // Review texts (from locale)
  const reviewTexts = locale === 'ro'
    ? [
        '"Am lăsat mașina 10 zile. Microbuzul a fost mereu la timp. Mașina era impecabilă la întoarcere. Cea mai bună parcare de la Otopeni."',
        '"Sistemul cu credite e genial. Cumpăr un pachet, parchez oricând. Microbuzul la aeroport e mereu la timp."',
        '"Super profesioniști. Am rezervat la miezul nopții, microbuzul era acolo la 5 dimineața. Voi folosi la fiecare călătorie."',
      ]
    : [
        '"Left my car for 10 days. Shuttle was on time every single time. Car was spotless. The best airport parking experience."',
        '"The credit system is brilliant. Buy a pack, park anytime. Shuttle to the airport is always on time."',
        '"Super professional. Booked at midnight, shuttle was there at 5 AM. Will use again for every trip."',
      ];

  // Initial capacity value (updated by the real-time subscription).
  const MOCK_CAPACITY = 0;

  const page = html`<div>
    ${''/* Navbar is inserted programmatically */}
    <div data-navbar></div>

    <!-- HERO -->
    <section class="min-h-screen flex items-center pt-24 pb-16 relative overflow-hidden bg-frost">
      <div class="max-w-7xl mx-auto px-6 w-full relative z-10">
        <div class="grid lg:grid-cols-12 gap-12 items-center">
          <div class="lg:col-span-7">
            <div class="inline-flex items-center gap-2 bg-white  border border-frost-deep rounded-full px-4 py-1.5 mb-8 shadow-sm">
              <span class="w-2 h-2 rounded-full bg-leaf animate-[pulse_2s_ease-in-out_infinite]"></span>
              <span class="text-charcoal/60 text-[14px] font-medium" data-capacity-badge>${t('hero.badge', { count: MOCK_CAPACITY })}</span>
            </div>

            <h1 class="font-heading text-[clamp(3rem,6vw,5.5rem)] font-bold leading-[1.02] tracking-[-0.03em] mb-6 text-blueberry-deep">
              ${t('hero.title1')}<br>
              <span class="text-mango">${t('hero.title2')}</span>
            </h1>

            <p class="text-[17px] text-dim leading-relaxed max-w-md mb-10">${t('hero.subtitle')}</p>

            <div class="flex flex-col sm:flex-row gap-3 mb-14">
              <a href="${localePath('/booking/long-term')}" class="inline-flex items-center justify-start sm:justify-center gap-2.5 bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[17px] px-8 py-4 rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md">${planeIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 shrink-0"')}${t('funnel.longTerm.cta')}</a>
              <a href="${localePath('/booking/credits')}" class="inline-flex items-center justify-start sm:justify-center gap-2.5 bg-white border-2 border-blueberry hover:bg-blueberry/5 text-blueberry font-semibold text-[17px] px-8 py-4 rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md">${peopleIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 shrink-0"')}${t('funnel.commuter.cta')}</a>
            </div>

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">${t('hero.shuttleFreeValue')}</p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.shuttleFree')}</p>
              </div>
              <div class="w-px h-8 bg-frost-deep hidden sm:block"></div>
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">24/7</p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.access')}</p>
              </div>
            </div>
          </div>

          <div class="lg:col-span-5 relative hidden lg:block">
            <div class="relative w-full aspect-square max-w-md mx-auto">
              <div class="absolute inset-8 rounded-[32px] overflow-hidden shadow-2xl">
                <img src="/images/welcome.jpg" alt="ManGO Parking facility" class="img-cover" loading="eager">
              </div>
              <img src="/images/logo.png" alt="" aria-hidden="true" class="absolute -bottom-6 -left-6 w-40 h-40 object-contain drop-shadow-2xl rotate-[-8deg] pointer-events-none select-none" />

              <div class="absolute top-4 right-0 glass rounded-2xl p-5 shadow-lg w-48">
                <div class="w-9 h-9 rounded-xl bg-mango/15 flex items-center justify-center mb-2.5">${shuttleIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 text-blueberry-deep"')}</div>
                <p class="font-heading font-bold text-[17px] text-blueberry-deep leading-tight">${t('shuttle.onDemandTitle')}</p>
                <p class="text-dim text-[12px] mt-1.5">${t('hero.shuttleFreeValue')} · ${t('hero.shuttleFree')}</p>
              </div>

              <div class="absolute bottom-0 right-0 glass rounded-2xl p-5 shadow-lg w-48">
                <p class="text-[11px] font-mono uppercase text-dim tracking-[0.15em] mb-2">${t('hero.fromPrice')}</p>
                <div class="flex items-baseline gap-1">
                  <span data-long-from class="font-heading font-bold text-3xl tracking-tight">29</span>
                  <span class="text-dim text-sm">${t('hero.leiDay')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="py-16 md:py-28">
      <div class="max-w-7xl mx-auto px-6">
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('howItWorks.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('howItWorks.title')}</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-6">
          ${[
            { num: '01', title: t('howItWorks.step1Title'), desc: t('howItWorks.step1Desc'), img: '/images/parking-1.jpg' },
            { num: '02', title: t('howItWorks.step2Title'), desc: t('howItWorks.step2Desc'), img: '/images/bus.jpg' },
            { num: '03', title: t('howItWorks.step3Title'), desc: t('howItWorks.step3Desc'), img: '/images/gate.jpg' },
          ].map(step => `
            <div class="card-solid rounded-3xl overflow-hidden">
              <div class="h-48 overflow-hidden">
                <img src="${step.img}" alt="${step.title}" class="img-cover hover:scale-105 transition-transform duration-500" loading="lazy">
              </div>
              <div class="p-8">
                <div class="w-12 h-12 rounded-2xl bg-frost flex items-center justify-center mb-6">
                  <span class="font-heading font-bold text-lg text-mango">${step.num}</span>
                </div>
                <h3 class="font-heading font-bold text-xl mb-3 tracking-tight">${step.title}</h3>
                <p class="text-dim text-[16px] leading-relaxed">${step.desc}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- PRICING PREVIEW -->
    <section class="py-28 bg-blueberry-deep rounded-[40px] mx-4 relative overflow-hidden">
      <div class="max-w-7xl mx-auto px-6 relative z-10">
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('pricing.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-white">${t('pricing.title')}</h2>
        </div>
        <div data-carousel="parking" class="max-w-4xl mx-auto">
          <div data-carousel-track class="flex md:grid md:grid-cols-2 gap-6 overflow-x-auto md:overflow-visible snap-x snap-mandatory no-scrollbar pb-2 md:pb-0">
          <!-- Long-term (left) -->
          <div class="snap-center shrink-0 w-[88%] md:w-auto bg-blueberry rounded-3xl p-8 flex flex-col">
            <div class="flex items-center gap-3 mb-6">
              <div class="w-10 h-10 rounded-xl bg-blueberry-deep flex items-center justify-center">
                ${planeIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 text-white"')}
              </div>
              <div>
                <h3 class="text-white font-heading font-bold text-lg">${t('funnel.longTerm.title')}</h3>
                <p class="text-white/70 text-[14px]">${t('funnel.longTerm.tagline')}</p>
              </div>
            </div>
            <p class="text-white/70 text-[12px] font-mono uppercase tracking-wider mb-1">${locale === 'ro' ? 'De la' : 'From'}</p>
            <div class="flex items-baseline gap-1.5 mb-6">
              <span class="font-heading font-bold text-5xl text-white tracking-tight" data-long-from>—</span>
              <span class="text-white/70 text-sm">${t('longTerm.perDay')}</span>
            </div>
            <ul class="space-y-3 mb-8 flex-1">
              ${t('funnel.longTerm.features').map(f => `
                <li class="flex items-center gap-2.5 text-white/90 text-[15px]">
                  <span class="text-leaf">${checkIcon}</span> ${f}
                </li>
              `).join('')}
            </ul>
            <a href="${localePath('/booking/long-term')}" class="block text-center bg-white hover:bg-frost text-blueberry-deep font-semibold text-[16px] py-4 rounded-2xl transition-colors">${t('funnel.longTerm.cta')}</a>
          </div>

          <!-- Commuter / Credits (right) -->
          <div class="snap-center shrink-0 w-[88%] md:w-auto bg-blueberry border-2 border-mango rounded-3xl p-8 flex flex-col relative">
            <div class="absolute -top-3 right-8 bg-mango text-charcoal text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">${t('pricing.onlyAtMango')}</div>
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-xl bg-mango flex items-center justify-center">
                ${peopleIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 text-charcoal"')}
              </div>
              <div>
                <h3 class="text-white font-heading font-bold text-lg">${t('funnel.commuter.title')}</h3>
                <p class="text-white/70 text-[14px]">${t('funnel.commuter.tagline')}</p>
              </div>
            </div>
            <p class="text-white/85 text-[13px] leading-relaxed mb-5">${t('funnel.commuter.description')}</p>
            <p class="text-white/70 text-[12px] font-mono uppercase tracking-wider mb-1">${locale === 'ro' ? 'De la' : 'From'}</p>
            <div class="flex items-baseline gap-1.5 mb-6">
              <span class="font-heading font-bold text-5xl text-white tracking-tight" data-credits-from>—</span>
              <span class="text-white/70 text-sm">${t('longTerm.perDay')}</span>
            </div>
            <ul class="space-y-3 mb-8 flex-1">
              ${t('funnel.commuter.features').map(f => `
                <li class="flex items-center gap-2.5 text-white/90 text-[15px]">
                  <span class="text-mango">${checkIcon}</span> ${f}
                </li>
              `).join('')}
            </ul>
            <a href="${localePath('/booking/credits')}" class="block text-center bg-white hover:bg-frost text-blueberry-deep font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md">${t('funnel.commuter.cta')}</a>
          </div>
          </div>
          <div data-carousel-dots class="flex justify-center gap-2 mt-6 md:hidden"></div>
        </div>
        <p class="text-center mt-8"><a href="${localePath('/pricing')}" class="text-white/25 hover:text-white/50 text-[14px] transition-colors">${t('pricing.viewAll')}</a></p>
      </div>
    </section>

    <!-- AMENITIES -->
    <section class="py-28">
      <div class="max-w-7xl mx-auto px-6">
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('amenities.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('amenities.title')}</h2>
        </div>
        <div data-carousel="amenities" class="max-w-4xl mx-auto">
          <div data-carousel-track class="flex gap-5 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2">
          ${[
            { icon: 'shuttle', label: t('amenities.shuttle'), sub: t('amenities.shuttleSub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M3.375 14.25c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125m0-4.5V6.375c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v8.25"/></svg>` },
            { icon: 'shield', label: t('amenities.security'), sub: t('amenities.securitySub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>` },
            { icon: 'luggage', label: t('amenities.luggage'), sub: t('amenities.luggageSub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38"/></svg>` },
          ].map(a => `
            <div class="snap-center shrink-0 w-[70%] sm:w-[45%] lg:w-[31%] card-solid rounded-2xl p-6 text-center">
              <div class="w-12 h-12 rounded-2xl bg-frost flex items-center justify-center mx-auto mb-4">${a.svg}</div>
              <p class="font-heading font-semibold text-[16px]">${a.label}</p>
              <p class="text-dim text-[14px] mt-1">${a.sub}</p>
            </div>
          `).join('')}
          </div>
          <div data-carousel-dots class="flex justify-center gap-2 mt-6"></div>
        </div>
      </div>
    </section>

    <!-- SHUTTLE (on-demand) -->
    <section class="py-16 md:py-28">
      <div class="max-w-3xl mx-auto px-6">
        <div class="text-center mb-12">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('shuttle.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('shuttle.homeHeading')}</h2>
        </div>
        <div class="card-solid rounded-3xl p-8 md:p-10 flex flex-col sm:flex-row items-start gap-5">
          <div class="w-12 h-12 rounded-2xl bg-mango/15 flex items-center justify-center shrink-0">${shuttleIcon.replace('class="w-5 h-5"', 'class="w-6 h-6 text-blueberry-deep"')}</div>
          <div>
            <p class="font-heading font-bold text-xl text-blueberry-deep mb-2">${t('shuttle.onDemandTitle')}</p>
            <p class="text-dim text-[16px] leading-relaxed">${t('shuttle.onDemandBody')}</p>
          </div>
        </div>
        <p class="mt-6"><a href="${localePath('/shuttle')}" class="text-blueberry hover:text-blueberry-hover text-[14px] font-semibold transition-colors">${t('shuttle.homeLink')}</a></p>
      </div>
    </section>

    <!-- REVIEWS -->
    <section class="py-16 md:py-28">
      <div class="max-w-7xl mx-auto px-6">
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('reviews.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('reviews.title')}</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto" data-reviews-grid>
          <!-- Populated after getPublishedReviews() resolves; uses FALLBACK_REVIEWS until then. -->
        </div>
        <div class="text-center mt-10">
          <a href="${GOOGLE_REVIEWS_URL}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 bg-white border border-frost-deep hover:border-mango text-charcoal font-semibold text-[14px] px-6 py-3 rounded-2xl shadow-sm hover:shadow-md transition-all">
            <svg class="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.997 10.997 0 0012 23z"/><path fill="#FBBC04" d="M5.84 14.1A6.59 6.59 0 015.49 12c0-.73.13-1.44.35-2.1V7.06H2.18A10.997 10.997 0 001 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            ${t('reviews.viewOnGoogle')}
          </a>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="py-16 md:py-28">
      <div class="max-w-2xl mx-auto px-6">
        <div class="text-center mb-14">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('faq.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('faq.title')}</h2>
        </div>
        <div class="space-y-3" data-faq-container>
          ${[1, 2, 3, 4, 5].map(n => `
            <div class="card-solid rounded-2xl overflow-hidden">
              <button class="faq-toggle w-full flex items-center justify-between px-7 py-5 text-left">
                <span class="font-heading font-semibold text-[16px]">${t('faq.q' + n)}</span>
                <span class="text-dim/40 text-xl leading-none transition-transform duration-200" data-icon>+</span>
              </button>
              <div class="faq-body"><div><p class="px-7 pb-5 text-dim text-[15px] leading-relaxed">${t('faq.a' + n)}</p></div></div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- GALLERY -->
    <section class="py-20 overflow-hidden">
      <div class="max-w-7xl mx-auto px-6 mb-12">
        <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3 text-center">${t('gallery.label')}</p>
        <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep text-center">${t('gallery.title')}</h2>
      </div>
      <div class="max-w-7xl mx-auto px-6">
        <div data-gallery class="grid grid-cols-2 md:grid-cols-3 gap-4"></div>
        <div data-gallery-pagination class="flex items-center justify-center gap-4 mt-8"></div>
      </div>
    </section>

    <!-- READY TO PARK -->
    <section class="py-20 bg-frost">
      <div class="max-w-3xl mx-auto px-6">
        <div class="text-center mb-10">
          <h2 class="font-heading text-3xl md:text-4xl font-bold tracking-[-0.02em] mb-3 text-blueberry-deep">${t('cta.title')}</h2>
          <p class="text-dim text-[16px]">${t('cta.subtitle')}</p>
        </div>

        <!-- 1. Book your spot -->
        <a href="${localePath('/booking')}" class="block text-center bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[17px] px-10 py-4 rounded-2xl transition-all duration-200 shadow-md mb-6">${t('cta.book')}</a>

        <!-- 2. Get Directions (map preview) -->
        <div class="card-solid rounded-3xl overflow-hidden mb-6">
          <iframe src="${GOOGLE_MAPS_EMBED}" width="100%" height="240" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="ManGO Parking — ${CONTACT_ADDRESS}"></iframe>
          <div class="p-4">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(CONTACT_ADDRESS)}" target="_blank" rel="noopener" class="block text-center bg-white border-2 border-blueberry hover:bg-blueberry/5 text-blueberry font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('contact.getDirections')} →</a>
          </div>
        </div>

        <!-- 3. Contact info (copy button on the parking address) -->
        <div class="card-solid rounded-3xl p-6 sm:p-8 mb-6">
          <h3 class="font-heading font-bold text-lg mb-5 text-blueberry-deep">${t('contact.info')}</h3>
          <div class="space-y-4">
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.phone')}</p>
              <a href="tel:${CONTACT_PHONE.replace(/\s/g, '')}" class="text-[16px] font-medium hover:text-blueberry transition-colors">${CONTACT_PHONE}</a>
            </div>
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.emailLabel')}</p>
              <a href="mailto:${CONTACT_EMAIL}" class="text-[16px] font-medium hover:text-blueberry transition-colors">${CONTACT_EMAIL}</a>
            </div>
            <div>
              <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-1">${t('contact.address')}</p>
              <div class="flex items-start gap-2">
                <p class="text-[16px] font-medium" data-parking-address>${CONTACT_ADDRESS}</p>
                <button type="button" data-copy-address title="${t('contact.copyAddress')}" aria-label="${t('contact.copyAddress')}" class="shrink-0 p-1.5 -mt-0.5 rounded-lg text-dim hover:text-blueberry hover:bg-frost transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Contact form -->
        <div class="card-solid rounded-3xl p-6 sm:p-8">
          <h3 class="font-heading font-bold text-lg mb-5 text-blueberry-deep">${t('contact.heroTitle')}</h3>
          <form data-home-contact-form class="space-y-4">
            <div class="grid sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.name')} *</label>
                <input type="text" name="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry" required>
              </div>
              <div>
                <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.email')} *</label>
                <input type="email" name="email" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry" required>
              </div>
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.subject')}</label>
              <input type="text" name="subject" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('contact.form.message')} *</label>
              <textarea name="message" rows="4" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry resize-none" required></textarea>
            </div>
            <button type="submit" class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md">${t('contact.form.send')}</button>
            <div data-home-contact-success class="hidden text-leaf text-[15px] text-center font-medium mt-1">${t('contact.form.sent')}</div>
          </form>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  // Mount navbar and footer
  const navSlot = page.querySelector('[data-navbar]');
  navSlot.replaceWith(Navbar());

  const footerSlot = page.querySelector('[data-footer]');
  footerSlot.replaceWith(Footer());

  // FAQ toggle
  delegate(page, 'click', '.faq-toggle', (e, btn) => {
    const body = btn.nextElementSibling;
    const icon = btn.querySelector('[data-icon]');
    const isOpen = body.classList.contains('open');
    page.querySelectorAll('.faq-body').forEach(el => el.classList.remove('open'));
    page.querySelectorAll('[data-icon]').forEach(el => el.textContent = '+');
    if (!isOpen) {
      body.classList.add('open');
      icon.textContent = '−';
    }
  });

  container.appendChild(page);

  // Carousels (amenities + parking cards) — swipeable on small screens, a
  // plain row on desktop (dots auto-hide when the track doesn't overflow).
  const carouselCleanups = Array.from(page.querySelectorAll('[data-carousel]')).map(initCarousel);

  // Copy the parking address to the clipboard (Ready-to-park section).
  const copyBtn = page.querySelector('[data-copy-address]');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_ADDRESS);
      showToast(t('contact.addressCopied'), 'success');
    } catch {
      showToast(t('common.error'), 'error');
    }
  });

  // Contact form in the Ready-to-park section (mirrors the /contact page).
  const homeContactForm = page.querySelector('[data-home-contact-form]');
  homeContactForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(homeContactForm);
    const name = fd.get('name');
    const email = fd.get('email');
    const message = fd.get('message');
    if (!required(name) || !isValidEmail(email) || !required(message)) {
      showToast(t('common.error'), 'error');
      return;
    }
    try {
      await submitContactMessage({ name, email, subject: fd.get('subject') || '', message });
      homeContactForm.reset();
      page.querySelector('[data-home-contact-success]')?.classList.remove('hidden');
      showToast(t('contact.form.sent'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  // "Starting from" price badges in the pricing preview section
  Promise.all([getLongTermRates(), getTokenPacks()]).then(([rates, packs]) => {
    const longFrom = rates?.tiers?.length ? Math.min(...rates.tiers.map(t => t.perDay)) : null;
    const creditsFrom = packs?.length
      ? Math.min(...packs.map(p => p.price / Math.max(p.quantity, 1)))
      : null;
    // Both the hero badge and the pricing-preview section carry
    // [data-long-from], so update every match (not just the first) — keeps the
    // hero's "from N lei" in sync with the real cheapest tier (#23).
    const creditsEl = page.querySelector('[data-credits-from]');
    if (longFrom != null) page.querySelectorAll('[data-long-from]').forEach((el) => { el.textContent = longFrom; });
    if (creditsEl && creditsFrom != null) creditsEl.textContent = Math.round(creditsFrom);
  }).catch(() => {});

  // Reviews — load published from Firestore; fall back to FALLBACK_REVIEWS
  // when none exist yet (admin hasn't added any), so the section never looks
  // broken on a fresh deployment.
  function renderReviews(reviews) {
    const grid = page.querySelector('[data-reviews-grid]');
    if (!grid) return;
    grid.innerHTML = reviews.map((r, i) => {
      const text = r.comment || reviewTexts[i] || '';
      return `
        <div class="card-solid rounded-3xl p-7">
          <div class="flex gap-0.5 mb-4">
            ${Array(5).fill(0).map((_, j) => `<svg class="w-5 h-5 ${j < r.rating ? 'text-mango' : 'text-frost-deep'}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`).join('')}
          </div>
          <p class="text-[15px] text-charcoal/60 leading-relaxed mb-6">${text}</p>
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-full bg-frost flex items-center justify-center text-[12px] font-bold">${initialsOf(r.name)}</div>
            <div>
              <p class="text-[14px] font-semibold">${r.name}</p>
              <p class="text-[12px] text-dim">${t('reviews.' + (r.type || 'traveler'))}</p>
            </div>
          </div>
        </div>`;
    }).join('');
  }
  renderReviews(FALLBACK_REVIEWS);
  getPublishedReviews(3).then(real => {
    if (real?.length) renderReviews(real);
  }).catch(() => {});

  // Facility gallery — admin-managed images (built-in photos until the
  // collection has entries), paginated 6 per page. Clicking opens a lightbox
  // that navigates the full set with ‹ › / arrow keys.
  const GALLERY_PAGE_SIZE = 6;
  const galleryEl = page.querySelector('[data-gallery]');
  const galleryPager = page.querySelector('[data-gallery-pagination]');
  let galleryAll = FALLBACK_GALLERY;
  let galleryPage = 0;

  function renderGalleryPage() {
    const pages = Math.max(1, Math.ceil(galleryAll.length / GALLERY_PAGE_SIZE));
    if (galleryPage > pages - 1) galleryPage = pages - 1;
    const start = galleryPage * GALLERY_PAGE_SIZE;
    galleryEl.innerHTML = galleryImageCards(galleryAll.slice(start, start + GALLERY_PAGE_SIZE), start);
    galleryPager.innerHTML = pages > 1 ? galleryPagerHtml(galleryPage, pages) : '';
  }
  renderGalleryPage();
  getGalleryImages().then((imgs) => {
    if (imgs?.length) { galleryAll = imgs; galleryPage = 0; renderGalleryPage(); }
  }).catch(() => {});

  delegate(page, 'click', '[data-gallery-prev]', () => { if (galleryPage > 0) { galleryPage--; renderGalleryPage(); } });
  delegate(page, 'click', '[data-gallery-next]', () => { galleryPage++; renderGalleryPage(); });
  delegate(page, 'click', '[data-gallery-item]', (_e, btn) => {
    openGalleryLightbox(galleryAll, Number(btn.dataset.index) || 0);
  });

  // Real-time capacity subscription
  const unsubCapacity = subscribeCapacity((cap) => {
    const badge = page.querySelector('[data-capacity-badge]');
    const number = page.querySelector('[data-capacity-number]');
    const bar = page.querySelector('[data-capacity-bar]');
    if (badge) badge.textContent = t('hero.badge', { count: cap.available });
    if (number) number.textContent = cap.available;
    if (bar) bar.style.width = (cap.total > 0 ? Math.round((cap.occupied / cap.total) * 100) : 0) + '%';
  });


  // Return cleanup
  return () => {
    unsubCapacity();
    carouselCleanups.forEach((fn) => fn && fn());
  };
}
