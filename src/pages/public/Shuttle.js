import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getTrainSchedule, getPopularFlights } from '../../services/shuttleService.js';
import { shuttleIcon } from '../../components/widgets/icons.js';

export default async function Shuttle(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Program Shuttle — ManGO Parking' : 'Shuttle Schedule — ManGO Parking',
    description: locale === 'ro'
      ? 'Microbuz gratuit ManGO Parking, la cerere — te ducem la aeroport și la gară când sosești.'
      : 'Free ManGO Parking shuttle, on demand — we take you to the airport and train station when you arrive.',
    lang: locale,
  });

  const trains = await getTrainSchedule();
  const flights = getPopularFlights();

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-32 pb-20">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-16">
          <p class="text-[12px] font-mono uppercase text-mango-deep tracking-[0.2em] mb-3">${t('shuttle.label')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-4">${t('shuttle.pageTitle')}</h1>
          <p class="text-dim text-[17px] max-w-lg mx-auto">${t('shuttle.pageSubtitle')}</p>
        </div>

        <!-- Free shuttle (on-demand) -->
        <div class="mb-12">
          <h2 class="font-heading text-xl font-bold mb-4">${t('shuttle.homeHeading')}</h2>
          <div class="card-solid rounded-3xl p-8 md:p-10 flex flex-col sm:flex-row items-start gap-5">
            <div class="w-12 h-12 rounded-2xl bg-mango/15 flex items-center justify-center shrink-0">${shuttleIcon.replace('class="w-5 h-5"', 'class="w-6 h-6 text-blueberry-deep"')}</div>
            <div>
              <p class="font-heading font-bold text-xl text-blueberry-deep mb-2">${t('shuttle.onDemandTitle')}</p>
              <p class="text-dim text-[16px] leading-relaxed">${t('shuttle.onDemandBody')}</p>
            </div>
          </div>
        </div>

        <!-- Train Schedule -->
        <div class="mb-12">
          <h2 class="font-heading text-xl font-bold mb-4">${t('shuttle.trainSchedule')}</h2>
          <div class="card-solid rounded-3xl overflow-hidden">
            <div class="grid grid-cols-2 text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-4 sm:px-8 py-4 border-b border-frost-deep">
              <span>${t('shuttle.direction')}</span>
              <span class="text-right">${t('shuttle.time')}</span>
            </div>
            <div class="divide-y divide-frost-deep/60">
              ${trains.map(tr => `
                <div class="shuttle-row grid grid-cols-2 items-center px-4 sm:px-8 py-4">
                  <span class="text-[15px] font-medium">${tr.direction === 'to_bucharest' ? (locale === 'ro' ? 'Spre București' : 'To Bucharest') : (locale === 'ro' ? 'Din București' : 'From Bucharest')}</span>
                  <span class="text-[15px] text-right font-mono font-medium">${tr.departureTime}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Popular Flights -->
        <div>
          <h2 class="font-heading text-xl font-bold mb-4">${t('shuttle.flightsToday')}</h2>
          <div class="card-solid rounded-3xl overflow-hidden">
            <div class="grid grid-cols-2 sm:grid-cols-4 text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-4 sm:px-8 py-4 border-b border-frost-deep">
              <span>${t('shuttle.flight')}</span>
              <span class="hidden sm:block">${t('shuttle.destination')}</span>
              <span class="hidden sm:block">${t('shuttle.airline')}</span>
              <span class="text-right">${t('shuttle.time')}</span>
            </div>
            <div class="divide-y divide-frost-deep/60">
              ${flights.map(f => `
                <div class="shuttle-row grid grid-cols-2 sm:grid-cols-4 items-center px-4 sm:px-8 py-4">
                  <span class="text-[15px] font-mono font-medium">${f.flight}</span>
                  <span class="text-[15px] hidden sm:block">${f.destination}</span>
                  <span class="text-[15px] text-dim hidden sm:block">${f.airline}</span>
                  <span class="text-[15px] text-right font-mono">${f.time}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);

  // Auto-refresh every 60s
  const interval = setInterval(async () => {
    // In production, this would re-fetch from Firestore
  }, 60000);

  return () => clearInterval(interval);
}
