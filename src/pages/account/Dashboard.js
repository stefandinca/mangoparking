import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { navigate } from '../../router/index.js';

/* ── Sidebar links shared across all account pages ── */
const ACCOUNT_NAV = [
  { path: '/account',              icon: 'dashboard', labelKey: 'account.dashboard' },
  { path: '/account/bookings',     icon: 'bookings',  labelKey: 'account.bookings' },
  { path: '/account/subscription', icon: 'sub',       labelKey: 'account.subscription' },
  { path: '/account/vehicles',     icon: 'vehicles',  labelKey: 'account.vehicles' },
  { path: '/account/loyalty',      icon: 'loyalty',   labelKey: 'account.loyalty' },
];

const NAV_ICONS = {
  dashboard: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"/></svg>`,
  bookings: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>`,
  sub: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>`,
  vehicles: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M3.375 14.25c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125m0-4.5V6.375c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v8.25"/></svg>`,
  loyalty: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>`,
};

function accountSidebar(activePath) {
  return ACCOUNT_NAV.map(link => {
    const isActive = link.path === activePath;
    const cls = isActive
      ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[15px] transition-colors'
      : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost hover:text-charcoal text-[15px] transition-colors';
    return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
  }).join('');
}

function accountLayout(activePath, contentHtml) {
  const activeLabel = ACCOUNT_NAV.find(l => l.path === activePath)?.labelKey || 'account.dashboard';
  return `
    <!-- Mobile nav dropdown -->
    <div class="md:hidden mb-6">
      <button data-account-nav-toggle class="flex items-center justify-between w-full card-solid rounded-2xl px-5 py-3.5 text-[15px] font-semibold transition-colors">
        <span>${t(activeLabel)}</span>
        <svg data-chevron class="w-4 h-4 text-dim transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
      </button>
      <div class="hidden card-solid rounded-2xl mt-2 p-2 space-y-0.5" data-account-nav-dropdown>
        ${ACCOUNT_NAV.map(link => {
          const isActive = link.path === activePath;
          const cls = isActive
            ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[14px]'
            : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost text-[14px] transition-colors';
          return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
        }).join('')}
      </div>
    </div>

    <div class="flex gap-4 md:gap-8">
      <!-- Sidebar (desktop) -->
      <aside class="hidden md:block w-56 flex-shrink-0">
        <div class="card-solid rounded-2xl p-3 space-y-1 sticky top-28">
          ${accountSidebar(activePath)}
        </div>
      </aside>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        ${contentHtml}
      </div>
    </div>
  `;
}

/* ── Mock data ── */
const MOCK_ACTIVE_BOOKING = {
  id: 'BK-2026-0042',
  zone: 'A',
  spot: 'A-17',
  vehicle: 'B 123 ABC',
  checkIn: '2026-03-01T08:30',
  checkOut: '2026-03-08T18:00',
  status: 'active',
};

const MOCK_NEXT_SHUTTLE = { time: '14:30', dest: 'Terminal Aeroport', minutesAway: 12 };

const MOCK_RECENT_BOOKING = {
  id: 'BK-2026-0038',
  zone: 'B',
  spot: 'B-05',
  vehicle: 'IF 99 XYZ',
  checkIn: '2026-02-10T09:00',
  checkOut: '2026-02-17T17:00',
};

export default function Dashboard(container) {
  const locale = getLocale();
  const profile = getUserProfile();
  const displayName = profile?.displayName || 'User';
  const points = profile?.loyaltyPoints ?? 240;
  const tier = profile?.loyaltyTier ?? 'bronze';

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
        <p class="font-heading font-bold text-2xl tracking-tight">1</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.totalBookings')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">12</p>
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
    <div class="card-solid rounded-2xl p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-heading font-bold text-lg">${t('account.currentBooking')}</h2>
        <span class="text-[12px] font-bold bg-leaf/10 text-leaf px-3 py-1 rounded-full">${t('account.statusActive')}</span>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-[15px]">
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.bookingId')}</p>
          <p class="font-semibold font-mono">${MOCK_ACTIVE_BOOKING.id}</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.spotLabel')}</p>
          <p class="font-semibold">${MOCK_ACTIVE_BOOKING.spot} (${t('account.zone')} ${MOCK_ACTIVE_BOOKING.zone})</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.vehicleLabel')}</p>
          <p class="font-semibold">${MOCK_ACTIVE_BOOKING.vehicle}</p>
        </div>
        <div>
          <p class="text-dim text-[13px] mb-1">${t('account.checkOut')}</p>
          <p class="font-semibold">${new Date(MOCK_ACTIVE_BOOKING.checkOut).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>
    </div>

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
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${MOCK_NEXT_SHUTTLE.time}</p>
            <p class="text-dim text-[14px]">→ ${MOCK_NEXT_SHUTTLE.dest}</p>
            <p class="text-mango text-[13px] font-semibold mt-0.5">${t('account.inMinutes', { min: MOCK_NEXT_SHUTTLE.minutesAway })}</p>
          </div>
        </div>
      </div>

      <!-- Quick re-book -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-3">${t('account.quickRebook')}</h3>
        <p class="text-dim text-[14px] mb-4">${t('account.recentTrip')}: <span class="font-semibold text-charcoal">${MOCK_RECENT_BOOKING.spot}</span> — ${MOCK_RECENT_BOOKING.vehicle}</p>
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

  // Toggle account mobile nav dropdown
  const navToggle = page.querySelector('[data-account-nav-toggle]');
  const navDropdown = page.querySelector('[data-account-nav-dropdown]');
  if (navToggle && navDropdown) {
    navToggle.addEventListener('click', () => {
      navDropdown.classList.toggle('hidden');
      navToggle.querySelector('[data-chevron]').classList.toggle('rotate-180');
    });
  }

  container.appendChild(page);
}
