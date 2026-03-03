import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getShuttleSchedule, getTrainSchedule, getPopularFlights, getRouteKey } from '../../services/shuttleService.js';

export default async function Shuttle(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Program Shuttle — Mango Parking' : 'Shuttle Schedule — Mango Parking',
    description: locale === 'ro'
      ? 'Program naveta gratuită Mango Parking. Curse la fiecare 15 minute către aeroport și gara de tren.'
      : 'Free shuttle schedule from Mango Parking. Runs every 15 minutes to airport and train station.',
    lang: locale,
  });

  const schedule = await getShuttleSchedule();
  const trains = await getTrainSchedule();
  const flights = getPopularFlights();

  const statusColors = {
    boarding: 'bg-mango/10 text-mango',
    next: 'bg-frost text-dim',
    scheduled: 'bg-frost text-dim',
    departed: 'bg-charcoal/10 text-charcoal/40',
    delayed: 'bg-danger/10 text-danger',
    cancelled: 'bg-danger/10 text-danger line-through',
  };

  const page = html`<div>
    <div data-navbar></div>

    <section class="pt-32 pb-20">
      <div class="max-w-4xl mx-auto px-6">
        <div class="text-center mb-16">
          <p class="text-[12px] font-mono uppercase text-mango tracking-[0.2em] mb-3">${t('shuttle.label')}</p>
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] mb-4">${t('shuttle.pageTitle')}</h1>
          <p class="text-dim text-[17px] max-w-lg mx-auto">${t('shuttle.pageSubtitle')}</p>
        </div>

        <!-- Shuttle Schedule -->
        <div class="mb-12">
          <h2 class="font-heading text-xl font-bold mb-4">${t('shuttle.shuttleSchedule')}</h2>
          <div class="card-solid rounded-3xl overflow-hidden">
            <div class="grid grid-cols-3 text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-4 sm:px-8 py-4 border-b border-frost-deep">
              <span>${t('shuttle.route')}</span>
              <span class="text-center">${t('shuttle.departs')}</span>
              <span class="text-right">${t('shuttle.status')}</span>
            </div>
            <div class="divide-y divide-frost-deep/60">
              ${schedule.map((row, i) => {
                const routeKey = getRouteKey(row.route);
                const status = i === 0 ? 'boarding' : (i < 4 ? 'next' : 'scheduled');
                const color = statusColors[status] || statusColors.scheduled;
                const statusLabel = t('shuttle.' + status);
                return `
                  <div class="shuttle-row grid grid-cols-3 items-center px-4 sm:px-8 py-5">
                    <span class="text-[15px] font-medium min-w-0 truncate">${t('shuttle.' + routeKey)}</span>
                    <span class="text-[15px] text-center font-mono font-medium">${row.departureTime}</span>
                    <span class="text-right"><span class="text-[12px] font-bold ${color} px-3 py-1 rounded-full">${statusLabel}</span></span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <p class="text-center text-[13px] text-dim/40 mt-4">${t('shuttle.autoRefresh')}</p>
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
