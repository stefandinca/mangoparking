import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { checkIcon, starIcon, planeIcon, clockIcon } from '../../components/widgets/icons.js';
import { updateMeta, setStructuredData } from '../../utils/seo.js';
import { TOTAL_CAPACITY, SITE_URL, CONTACT_PHONE, CONTACT_EMAIL, CONTACT_ADDRESS } from '../../utils/constants.js';
import { subscribeCapacity } from '../../services/capacityService.js';
import { getShuttleSchedule, getUpcomingDepartures, getRouteKey } from '../../services/shuttleService.js';

const MOCK_REVIEWS = [
  { initials: 'AP', name: 'Andrei P.', type: 'traveler', rating: 5 },
  { initials: 'MI', name: 'Maria I.', type: 'traveler', rating: 5 },
  { initials: 'DV', name: 'Dan V.', type: 'traveler', rating: 4 },
];

export default function Home(container) {
  const locale = getLocale();

  // SEO
  updateMeta({
    title: locale === 'ro'
      ? 'Mango Parking — Parcare Aeroport Otopeni | Credite Parcare Zilnică & Shuttle'
      : 'Mango Parking — Otopeni Airport Parking | Daily Parking Credits & Shuttle',
    description: locale === 'ro'
      ? 'Parcare securizată lângă Aeroportul Henri Coandă Otopeni. Cumpără credite, parchează flexibil. Shuttle gratuită, securitate 24/7.'
      : 'Secure parking near Henri Coandă Otopeni Airport. Buy credits, park flexibly. Free shuttle, 24/7 security.',
    lang: locale,
    hreflang: { ro: SITE_URL + '/', en: SITE_URL + '/en' },
  });

  // Structured data
  setStructuredData({
    '@context': 'https://schema.org',
    '@type': ['ParkingFacility', 'LocalBusiness'],
    name: 'Mango Parking',
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
        '"Am lăsat mașina 10 zile. Naveta a fost mereu la timp. Mașina era impecabilă la întoarcere. Cea mai bună parcare de la Otopeni."',
        '"Sistemul cu credite e genial. Cumpăr un pachet, parchez oricând. Naveta la aeroport e mereu la timp."',
        '"Super profesioniști. Am rezervat la miezul nopții, naveta era acolo la 5 dimineața. Voi folosi la fiecare călătorie."',
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
              <a href="${localePath('/booking')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[16px] px-8 py-4 rounded-2xl transition-all duration-200 text-center shadow-sm hover:shadow-md">${t('hero.cta1')}</a>
              <a href="${localePath('/pricing')}" class="glass font-semibold text-[16px] px-8 py-4 rounded-2xl text-center hover:bg-white transition-all duration-200 shadow-sm">${t('hero.cta2')}</a>
            </div>

            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">${TOTAL_CAPACITY}</p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.totalSpots')}</p>
              </div>
              <div class="w-px h-8 bg-frost-deep hidden sm:block"></div>
              <div>
                <p class="font-heading font-bold text-2xl tracking-tight">15<span class="text-dim text-base font-normal"> ${t('common.min')}</span></p>
                <p class="text-[12px] text-dim uppercase tracking-wider mt-0.5">${t('hero.shuttleFreq')}</p>
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

              <div class="absolute top-0 left-0 glass rounded-2xl p-5 shadow-lg w-56">
                <p class="text-[11px] font-mono uppercase text-dim tracking-[0.15em] mb-3">${t('hero.liveCapacity')}</p>
                <div class="flex items-baseline gap-1.5 mb-3">
                  <span class="font-heading font-bold text-4xl tracking-tight" data-capacity-number>${MOCK_CAPACITY}</span>
                  <span class="text-dim text-sm">/ ${TOTAL_CAPACITY}</span>
                </div>
                <div class="h-2 bg-frost-deep rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-gradient-to-r from-leaf to-mango transition-all duration-500" style="width:${capacityPct}%" data-capacity-bar></div>
                </div>
              </div>

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
        <div class="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          <!-- Traveler -->
          <div class="bg-blueberry rounded-3xl p-8 transition-colors duration-300">
            <div class="flex items-center gap-3 mb-8">
              <div class="w-10 h-10 rounded-xl bg-blueberry-deep flex items-center justify-center">
                ${planeIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 text-white/80"')}
              </div>
              <div>
                <h3 class="text-white font-heading font-bold text-lg">${t('pricing.traveler')}</h3>
                <p class="text-white/70 text-[14px]">${t('pricing.travelerSub')}</p>
              </div>
            </div>
            <div class="flex items-baseline gap-1.5 mb-2">
              <span class="font-heading font-bold text-5xl text-white tracking-tight">29</span>
              <span class="text-white/70 text-sm">${t('pricing.leiDay')}</span>
            </div>
            <p class="text-white/70 text-[14px] mb-8">${t('pricing.travelerNote')}</p>
            <ul class="space-y-3 mb-8">
              ${t('pricing.travelerFeatures').map(f => `
                <li class="flex items-center gap-2.5 text-white/90 text-[15px]">
                  <span class="text-leaf">${checkIcon}</span> ${f}
                </li>
              `).join('')}
            </ul>
            <a href="${localePath('/booking')}" class="block text-center bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] py-4 rounded-2xl transition-colors duration-200">${t('pricing.bookNow')}</a>
          </div>
          <!-- Credit Packs -->
          <div class="bg-blueberry border-2 border-mango rounded-3xl p-8 transition-colors duration-300 relative">
            <div class="absolute -top-3 right-8 bg-mango text-charcoal text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">${t('pricing.onlyAtMango')}</div>
            <div class="flex items-center gap-3 mb-8">
              <div class="w-10 h-10 rounded-xl bg-mango/10 flex items-center justify-center">
                ${clockIcon.replace('class="w-5 h-5"', 'class="w-5 h-5 text-mango"')}
              </div>
              <div>
                <h3 class="text-white font-heading font-bold text-lg">${locale === 'ro' ? 'Pachete Credite' : 'Credit Packs'}</h3>
                <p class="text-white/30 text-[14px]">${locale === 'ro' ? 'Luni–Vineri, 6:00 – 20:00' : 'Mon–Fri, 6 AM – 8 PM'}</p>
              </div>
            </div>
            <div class="flex items-baseline gap-1.5 mb-2">
              <span class="font-heading font-bold text-5xl text-white tracking-tight">1</span>
              <span class="text-white/30 text-sm">${locale === 'ro' ? 'credit = 1 zi' : 'credit = 1 day'}</span>
            </div>
            <p class="text-white/20 text-[14px] mb-8">${locale === 'ro' ? 'Cumperi pachete de credite. Folosești oricând, Luni–Vineri.' : 'Buy credit packs. Use anytime, Monday–Friday.'}</p>
            <ul class="space-y-3 mb-8">
              ${[t('credit.rule1'), t('credit.rule2'), t('credit.rule3'), t('credit.rule4')].map(f => `
                <li class="flex items-center gap-2.5 text-white/50 text-[15px]">
                  <span class="text-mango">${checkIcon}</span> ${f}
                </li>
              `).join('')}
            </ul>
            <a href="${localePath('/booking')}" class="block text-center bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] py-4 rounded-2xl transition-colors duration-200 shadow-md">${t('credit.buyTokens')}</a>
          </div>
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
        <div class="grid grid-cols-2 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
          ${[
            { icon: 'shuttle', label: t('amenities.shuttle'), sub: t('amenities.shuttleSub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M3.375 14.25c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125m0-4.5V6.375c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v8.25"/></svg>` },
            { icon: 'shield', label: t('amenities.security'), sub: t('amenities.securitySub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>` },
            { icon: 'luggage', label: t('amenities.luggage'), sub: t('amenities.luggageSub'), svg: `<svg class="w-5 h-5 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38"/></svg>` },
          ].map(a => `
            <div class="card-solid rounded-2xl p-6 text-center">
              <div class="w-12 h-12 rounded-2xl bg-frost flex items-center justify-center mx-auto mb-4">${a.svg}</div>
              <p class="font-heading font-semibold text-[16px]">${a.label}</p>
              <p class="text-dim text-[14px] mt-1">${a.sub}</p>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- SHUTTLE PREVIEW -->
    <section class="py-16 md:py-28">
      <div class="max-w-3xl mx-auto px-6">
        <div class="text-center mb-14">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('shuttle.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('shuttle.title')}</h2>
        </div>
        <div class="card-solid rounded-3xl overflow-hidden">
          <div class="grid grid-cols-3 text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-4 sm:px-8 py-4 border-b border-frost-deep">
            <span>${t('shuttle.route')}</span>
            <span class="text-center">${t('shuttle.departs')}</span>
            <span class="text-right">${t('shuttle.status')}</span>
          </div>
          <div class="divide-y divide-frost-deep/60" data-shuttle-rows>
            <div class="px-4 sm:px-8 py-8 text-center text-dim text-[15px]">...</div>
          </div>
        </div>
        <p class="text-center mt-6"><a href="${localePath('/shuttle')}" class="text-mango hover:text-mango-hover text-[14px] font-semibold transition-colors">${t('shuttle.viewFull')}</a></p>
      </div>
    </section>

    <!-- REVIEWS -->
    <section class="py-16 md:py-28">
      <div class="max-w-7xl mx-auto px-6">
        <div class="text-center mb-20">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('reviews.label')}</p>
          <h2 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep">${t('reviews.title')}</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          ${MOCK_REVIEWS.map((r, i) => `
            <div class="card-solid rounded-3xl p-7">
              <div class="flex gap-0.5 mb-4">
                ${Array(5).fill(0).map((_, j) => `<div class="w-6 h-1 rounded-full ${j < r.rating ? 'bg-mango' : 'bg-frost-deep'}"></div>`).join('')}
              </div>
              <p class="text-[15px] text-charcoal/60 leading-relaxed mb-6">${reviewTexts[i]}</p>
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-full bg-frost flex items-center justify-center text-[12px] font-bold">${r.initials}</div>
                <div>
                  <p class="text-[14px] font-semibold">${r.name}</p>
                  <p class="text-[12px] text-dim">${t('reviews.' + r.type)}</p>
                </div>
              </div>
            </div>
          `).join('')}
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
              <a href="${localePath('/booking')}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-10 py-4 rounded-2xl transition-all duration-200 shadow-md text-center">${t('cta.book')}</a>
              <a href="${localePath('/contact')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-medium text-[16px] px-10 py-4 rounded-2xl transition-all duration-200 text-center">${t('cta.directions')}</a>
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
  return () => { unsubCapacity(); };
}
