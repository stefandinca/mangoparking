import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { checkIcon, starIcon, planeIcon, peopleIcon, shuttleIcon } from '../../components/widgets/icons.js';
import { initCarousel } from '../../components/widgets/Carousel.js';
import { updateMeta, setStructuredData } from '../../utils/seo.js';
import { TOTAL_CAPACITY, SITE_URL, CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS, GOOGLE_REVIEWS_URL } from '../../utils/constants.js';
import { subscribeCapacity } from '../../services/capacityService.js';
import { getShuttleSchedule, getUpcomingDepartures, getRouteKey } from '../../services/shuttleService.js';
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
      ? 'Parcare securizată lângă Aeroportul Henri Coandă Otopeni. Cumpără credite, parchează flexibil. Microbuz gratuit, securitate 24/7.'
      : 'Secure parking near Henri Coandă Otopeni Airport. Buy credits, park flexibly. Free shuttle, 24/7 security.',
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
      { '@type': 'LocationFeatureSpecification', name: '24/7 Security', value: true },
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

  // Initial capacity values (will be updated by real-time subscription)
  const MOCK_CAPACITY = 0;
  const MOCK_NEXT_SHUTTLE = '--:--';
  const MOCK_SHUTTLE_DEST = '...';
  const capacityPct = 0;

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
              <a href="${localePath('/booking/long-term')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[17px] px-8 py-4 rounded-2xl transition-all duration-200 text-left sm:text-center shadow-sm hover:shadow-md">${t('funnel.longTerm.cta')}</a>
              <a href="${localePath('/booking/credits')}" class="bg-white border-2 border-blueberry hover:bg-blueberry/5 text-blueberry font-semibold text-[17px] px-8 py-4 rounded-2xl transition-all duration-200 text-left sm:text-center shadow-sm hover:shadow-md">${t('funnel.commuter.cta')}</a>
            </div>

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">${t('hero.shuttleFreeValue')}</p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.shuttleFree')}</p>
              </div>
              <div class="w-px h-8 bg-frost-deep hidden sm:block"></div>
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">24/7</p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.security')}</p>
              </div>
            </div>
          </div>

          <div class="lg:col-span-5 relative hidden lg:block">
            <div class="relative w-full aspect-square max-w-md mx-auto">
              <div class="absolute inset-8 rounded-[32px] overflow-hidden shadow-2xl">
                <img src="https://images.unsplash.com/photo-1568738009519-52d1bad47858?q=80&w=774&auto=format&fit=crop" alt="Secure gated parking" class="img-cover" loading="eager">
              </div>
              <img src="/images/logo.png" alt="" aria-hidden="true" class="absolute -bottom-6 -left-6 w-40 h-40 object-contain drop-shadow-2xl rotate-[-8deg] pointer-events-none select-none" />

              <div class="absolute top-4 right-0 glass rounded-2xl p-5 shadow-lg w-48">
                <p class="text-[11px] font-mono uppercase text-dim tracking-[0.15em] mb-2">${t('hero.nextShuttle')}</p>
                <p class="font-heading font-bold text-3xl tracking-tight font-mono" data-next-shuttle>${MOCK_NEXT_SHUTTLE}</p>
                <p class="text-dim text-xs mt-1">→ ${MOCK_SHUTTLE_DEST}</p>
              </div>

              <div class="absolute bottom-0 right-0 glass rounded-2xl p-5 shadow-lg w-48">
                <p class="text-[11px] font-mono uppercase text-dim tracking-[0.15em] mb-2">${t('hero.fromPrice')}</p>
                <div class="flex items-baseline gap-1">
                  <span class="font-heading font-bold text-3xl tracking-tight">29</span>
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('howItWorks.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('howItWorks.title')}</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-6">
          ${[
            { num: '01', title: t('howItWorks.step1Title'), desc: t('howItWorks.step1Desc'), img: 'https://images.unsplash.com/photo-1520088096110-20308c23a3cd?q=80&w=1740&auto=format&fit=crop' },
            { num: '02', title: t('howItWorks.step2Title'), desc: t('howItWorks.step2Desc'), img: 'https://images.unsplash.com/photo-1559050695-edde77c73609?w=600&auto=format&fit=crop&q=60' },
            { num: '03', title: t('howItWorks.step3Title'), desc: t('howItWorks.step3Desc'), img: 'https://images.unsplash.com/photo-1574113230879-84d1bb15d277?q=80&w=872&auto=format&fit=crop' },
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('pricing.label')}</p>
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('amenities.label')}</p>
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('shuttle.label')}</p>
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('reviews.label')}</p>
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
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('faq.label')}</p>
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
        <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3 text-center">${t('gallery.label')}</p>
        <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep text-center">${t('gallery.title')}</h2>
      </div>
      <div class="flex gap-4 px-6 max-w-7xl mx-auto">
        <div class="flex-1 rounded-2xl overflow-hidden h-64 md:h-80">
          <img src="https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?w=800&q=80" alt="Organized parking" class="img-cover hover:scale-105 transition-transform duration-700" loading="lazy">
        </div>
        <div class="flex-1 rounded-2xl overflow-hidden h-64 md:h-80 hidden sm:block">
          <img src="https://images.unsplash.com/photo-1494515843206-f3117d3f51b7?w=800&q=80" alt="Airplane" class="img-cover hover:scale-105 transition-transform duration-700" loading="lazy">
        </div>
        <div class="flex-1 rounded-2xl overflow-hidden h-64 md:h-80 hidden md:block">
          <img src="https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=800&q=80" alt="Security camera" class="img-cover hover:scale-105 transition-transform duration-700" loading="lazy">
        </div>
        <div class="flex-1 rounded-2xl overflow-hidden h-64 md:h-80 hidden lg:block">
          <img src="https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=800&q=80" alt="Airport terminal" class="img-cover hover:scale-105 transition-transform duration-700" loading="lazy">
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="py-20">
      <div class="max-w-5xl mx-auto px-6">
        <div class="rounded-[32px] shadow-lg relative min-h-[400px] flex items-center bg-blueberry-deep overflow-hidden">
          <img src="/images/logo.png" alt="" aria-hidden="true" class="absolute -right-10 -bottom-10 w-80 h-80 object-contain rotate-[8deg] pointer-events-none select-none hidden md:block" />
          <div class="relative z-10 p-6 sm:p-10 md:p-16 max-w-lg">
            <h2 class="font-heading text-3xl md:text-4xl font-bold tracking-[-0.02em] mb-4 text-white">${t('cta.title')}</h2>
            <p class="text-white/70 text-[16px] mb-8">${t('cta.subtitle')}</p>
            <div class="flex flex-col sm:flex-row gap-3">
              <a href="${localePath('/booking')}" class="bg-white hover:bg-frost text-blueberry-deep font-semibold text-[16px] px-10 py-4 rounded-2xl transition-all duration-200 shadow-md text-center">${t('cta.book')}</a>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(CONTACT_ADDRESS)}" target="_blank" rel="noopener" class="border-2 border-white/40 hover:bg-white/10 text-white font-semibold text-[16px] px-10 py-4 rounded-2xl transition-all duration-200 text-center">${t('cta.directions')}</a>
            </div>
          </div>
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

  // "Starting from" price badges in the pricing preview section
  Promise.all([getLongTermRates(), getTokenPacks()]).then(([rates, packs]) => {
    const longFrom = rates?.tiers?.length ? Math.min(...rates.tiers.map(t => t.perDay)) : null;
    const creditsFrom = packs?.length
      ? Math.min(...packs.map(p => p.price / Math.max(p.quantity, 1)))
      : null;
    const longEl = page.querySelector('[data-long-from]');
    const creditsEl = page.querySelector('[data-credits-from]');
    if (longEl && longFrom != null) longEl.textContent = longFrom;
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

  // Real-time capacity subscription
  const unsubCapacity = subscribeCapacity((cap) => {
    const badge = page.querySelector('[data-capacity-badge]');
    const number = page.querySelector('[data-capacity-number]');
    const bar = page.querySelector('[data-capacity-bar]');
    if (badge) badge.textContent = t('hero.badge', { count: cap.available });
    if (number) number.textContent = cap.available;
    if (bar) bar.style.width = (cap.total > 0 ? Math.round((cap.occupied / cap.total) * 100) : 0) + '%';
  });

  // Fetch shuttle schedule and populate widgets
  getShuttleSchedule().then(schedule => {
    const upcoming = getUpcomingDepartures(schedule, 4);

    // Update next shuttle widget
    const nextShuttleEl = page.querySelector('[data-next-shuttle]');
    if (nextShuttleEl && upcoming.length > 0) {
      nextShuttleEl.textContent = upcoming[0].departureTime;
      const destEl = nextShuttleEl.nextElementSibling;
      if (destEl) destEl.textContent = '→ ' + t('shuttle.' + getRouteKey(upcoming[0].route));
    }

    // Update shuttle table
    const rowsContainer = page.querySelector('[data-shuttle-rows]');
    if (rowsContainer) {
      rowsContainer.innerHTML = upcoming.map((row, i) => {
        const statusClass = i === 0 ? 'bg-mango/10 text-mango' : 'bg-frost text-dim';
        const statusText = i === 0 ? t('shuttle.boarding') : t('shuttle.next');
        return `
          <div class="shuttle-row grid grid-cols-3 items-center px-4 sm:px-8 py-5">
            <span class="text-[15px] font-medium">${t('shuttle.' + getRouteKey(row.route))}</span>
            <span class="text-[15px] text-center font-mono font-medium">${row.departureTime}</span>
            <span class="text-right"><span class="text-[12px] font-bold ${statusClass} px-3 py-1 rounded-full">${statusText}</span></span>
          </div>`;
      }).join('');
    }
  }).catch(() => {});

  // Return cleanup
  return () => {
    unsubCapacity();
    carouselCleanups.forEach((fn) => fn && fn());
  };
}
