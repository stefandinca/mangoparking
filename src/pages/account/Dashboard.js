import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { navigate } from '../../router/index.js';
import { getMyBookings } from '../../services/bookingService.js';
import { getShuttleSchedule, getUpcomingDepartures, getRouteKey } from '../../services/shuttleService.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';

export default async function Dashboard(container) {
  const locale = getLocale();
  const profile = getUserProfile();
  const displayName = profile?.displayName || 'User';
  const points = profile?.loyaltyPoints ?? 0;
  const tier = profile?.loyaltyTier ?? 'bronze';

  // Fetch real data
  const [myBookings, shuttleSchedule] = await Promise.all([
    getMyBookings().catch(() => []),
    getShuttleSchedule().catch(() => []),
  ]);

  const activeBookings = myBookings.filter(b => b.status === 'active');
  const completedBookings = myBookings.filter(b => b.status === 'completed');
  const activeBooking = activeBookings[0] || null;
  const recentBooking = completedBookings[0] || null;
  const upcoming = getUpcomingDepartures(shuttleSchedule, 1);
  const nextShuttle = upcoming[0] || null;

  // Calculate minutes away for next shuttle
  let minutesAway = 0;
  if (nextShuttle) {
    const now = new Date();
    const [h, m] = nextShuttle.departureTime.split(':').map(Number);
    const depTime = new Date(now);
    depTime.setHours(h, m, 0, 0);
    minutesAway = Math.max(0, Math.round((depTime - now) / 60000));
  }

  updateMeta({
    title: `${t('account.dashboard')} — Mango Parking`,
    description: t('account.dashboardSubtitle'),
    lang: locale,
  });

  const tierColors = { bronze: 'text-amber-700 bg-amber-100', silver: 'text-gray-600 bg-gray-200', gold: 'text-yellow-600 bg-yellow-100' };
  const tierCls = tierColors[tier] || tierColors.bronze;

  const content = `
    <!-- Welcome -->
    <div class="mb-8">
      <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.welcome', { name: displayName })}</h1>
      <p class="text-dim text-[16px]">${t('account.dashboardSubtitle')}</p>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.activeBooking')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">${activeBookings.length}</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.totalBookings')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">${myBookings.length}</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.loyaltyPts')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">${points}</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.tier')}</p>
        <span class="inline-block text-[13px] font-bold ${tierCls} px-3 py-1 rounded-full capitalize">${tier}</span>
      </div>
    </div>

    <!-- Active booking card -->
    ${activeBooking ? `
    <div class="card-solid rounded-2xl p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-heading font-bold text-lg">${t('account.currentBooking')}</h2>
        <span class="text-[12px] font-bold bg-leaf/10 text-leaf px-3 py-1 rounded-full">${t('account.statusActive')}</span>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[15px]">
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.bookingId')}</p>
          <p class="font-semibold font-mono">${activeBooking.code || activeBooking.id}</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.spotLabel')}</p>
          <p class="font-semibold">${activeBooking.spotId || '—'}</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.vehicleLabel')}</p>
          <p class="font-semibold">${activeBooking.vehicle?.licensePlate || '—'}</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.checkOut')}</p>
          <p class="font-semibold">${activeBooking.dates?.pickUp ? new Date(activeBooking.dates.pickUp).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
        </div>
      </div>
    </div>` : `
    <div class="card-solid rounded-2xl p-6 mb-6 text-center text-dim">
      <p class="text-[15px]">${t('account.noActiveBooking') || 'No active booking'}</p>
    </div>`}

    <!-- Next shuttle + Quick rebook -->
    <div class="grid md:grid-cols-2 gap-6 mb-6">
      <!-- Next shuttle -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-4">${t('account.nextShuttle')}</h3>
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-mango/10 flex items-center justify-center">
            ${NAV_ICONS.vehicles}
          </div>
          <div>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${nextShuttle ? nextShuttle.departureTime : '--:--'}</p>
            <p class="text-dim text-[14px]">→ ${nextShuttle ? t('shuttle.' + getRouteKey(nextShuttle.route)) : '—'}</p>
            <p class="text-mango text-[13px] font-semibold mt-0.5">${nextShuttle ? t('account.inMinutes', { min: minutesAway }) : ''}</p>
          </div>
        </div>
      </div>

      <!-- Quick re-book -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-3">${t('account.quickRebook')}</h3>
        <p class="text-dim text-[14px] mb-4">${t('account.recentTrip')}: <span class="font-semibold text-charcoal">${recentBooking?.spotId || '—'}</span> — ${recentBooking?.vehicle?.licensePlate || '—'}</p>
        <a href="${localePath('/booking')}" class="inline-block bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.rebookNow')}</a>
      </div>
    </div>

    <!-- Loyalty summary -->
    <div class="card-solid rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-heading font-bold text-lg">${t('account.loyaltySummary')}</h3>
        <a href="${localePath('/account/loyalty')}" class="text-mango text-[14px] font-semibold hover:text-mango-hover transition-colors">${t('account.viewDetails')} →</a>
      </div>
      <div class="flex items-center gap-6">
        <div class="w-20 h-20 rounded-2xl bg-frost flex flex-col items-center justify-center">
          <span class="font-heading font-bold text-2xl tracking-tight">${points}</span>
          <span class="text-[11px] text-dim uppercase tracking-wider">${t('account.points')}</span>
        </div>
        <div>
          <span class="inline-block text-[13px] font-bold ${tierCls} px-3 py-1 rounded-full capitalize mb-1">${tier}</span>
          <p class="text-dim text-[14px]">${t('account.pointsToNext', { pts: 500 - points })}</p>
        </div>
      </div>
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  container.appendChild(page);
}
