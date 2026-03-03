import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { LOYALTY_TIERS } from '../../utils/constants.js';

/* ── Sidebar (shared pattern) ── */
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
      <aside class="hidden md:block w-56 flex-shrink-0">
        <div class="card-solid rounded-2xl p-3 space-y-1 sticky top-28">
          ${accountSidebar(activePath)}
        </div>
      </aside>
      <div class="flex-1 min-w-0">${contentHtml}</div>
    </div>
  `;
}

/* ── Mock data ── */
const MOCK_POINTS_HISTORY = [
  { date: '2026-03-01', description: 'Booking BK-2026-0042 (7 days)', points: +35, type: 'earn' },
  { date: '2026-02-17', description: 'Booking BK-2026-0038 completed', points: +35, type: 'earn' },
  { date: '2026-02-01', description: 'Subscription renewal bonus', points: +50, type: 'bonus' },
  { date: '2026-01-25', description: 'Booking BK-2026-0031 completed', points: +25, type: 'earn' },
  { date: '2025-12-20', description: 'Referral bonus — Maria I.', points: +100, type: 'bonus' },
  { date: '2025-11-12', description: 'Booking BK-2025-0098 completed', points: +35, type: 'earn' },
  { date: '2025-11-01', description: 'Redeemed: Free car wash', points: -40, type: 'redeem' },
];

const TIER_STYLES = {
  bronze: { badge: 'bg-amber-100 text-amber-700 border-amber-200', bar: 'from-amber-400 to-amber-600', icon: 'text-amber-500' },
  silver: { badge: 'bg-gray-200 text-gray-600 border-gray-300', bar: 'from-gray-400 to-gray-600', icon: 'text-gray-500' },
  gold:   { badge: 'bg-yellow-100 text-yellow-600 border-yellow-200', bar: 'from-yellow-400 to-yellow-600', icon: 'text-yellow-500' },
};

export default function Loyalty(container) {
  const locale = getLocale();
  const loc = locale === 'ro' ? 'ro-RO' : 'en-GB';
  const profile = getUserProfile();
  const points = profile?.loyaltyPoints ?? 240;
  const tier = profile?.loyaltyTier ?? 'bronze';
  const tierInfo = LOYALTY_TIERS[tier];
  const tierStyle = TIER_STYLES[tier] || TIER_STYLES.bronze;

  // Calculate progress to next tier
  const nextTier = tier === 'bronze' ? 'silver' : tier === 'silver' ? 'gold' : null;
  const nextTierInfo = nextTier ? LOYALTY_TIERS[nextTier] : null;
  const progressMax = nextTierInfo ? nextTierInfo.min : tierInfo.max;
  const progressPct = nextTierInfo ? Math.min(100, Math.round((points / progressMax) * 100)) : 100;

  updateMeta({
    title: `${t('account.loyalty')} — Mango Parking`,
    description: t('account.loyaltySubtitle'),
    lang: locale,
  });

  const content = `
    <div class="mb-8">
      <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.loyalty')}</h1>
      <p class="text-dim text-[16px]">${t('account.loyaltySubtitle')}</p>
    </div>

    <!-- Points & Tier -->
    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <!-- Balance card -->
      <div class="card-solid rounded-2xl p-6">
        <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-4">${t('account.pointsBalance')}</p>
        <div class="flex items-center gap-4 mb-5">
          <div class="w-16 h-16 rounded-2xl bg-frost flex items-center justify-center">
            <span class="font-heading font-bold text-3xl tracking-tight">${points}</span>
          </div>
          <div>
            <span class="inline-block text-[13px] font-bold ${tierStyle.badge} border px-3 py-1 rounded-full capitalize">${tierInfo.label}</span>
            ${tierInfo.discount > 0 ? `<p class="text-mango text-[13px] font-semibold mt-1">${tierInfo.discount}% ${t('account.discount')}</p>` : ''}
          </div>
        </div>
        ${nextTierInfo ? `
          <div>
            <div class="flex items-center justify-between text-[13px] mb-2">
              <span class="text-dim">${t('account.progressTo')} <span class="font-semibold capitalize">${nextTierInfo.label}</span></span>
              <span class="font-mono font-semibold">${points} / ${progressMax}</span>
            </div>
            <div class="h-2.5 bg-frost-deep rounded-full overflow-hidden">
              <div class="h-full rounded-full bg-gradient-to-r ${tierStyle.bar} transition-all duration-500" style="width:${progressPct}%"></div>
            </div>
            <p class="text-dim text-[13px] mt-2">${t('account.pointsToNext', { pts: progressMax - points })}</p>
          </div>
        ` : `<p class="text-leaf text-[14px] font-semibold">${t('account.maxTier')}</p>`}
      </div>

      <!-- Tier overview -->
      <div class="card-solid rounded-2xl p-6">
        <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-4">${t('account.allTiers')}</p>
        <div class="space-y-3">
          ${Object.entries(LOYALTY_TIERS).map(([key, info]) => {
            const style = TIER_STYLES[key];
            const isCurrent = key === tier;
            return `
              <div class="flex items-center justify-between p-3 rounded-xl ${isCurrent ? 'bg-frost border border-frost-deep' : ''}">
                <div class="flex items-center gap-3">
                  <span class="w-8 h-8 rounded-lg ${style.badge} flex items-center justify-center">
                    ${NAV_ICONS.loyalty.replace('class="w-5 h-5"', `class="w-4 h-4 ${style.icon}"`)}
                  </span>
                  <div>
                    <p class="font-semibold text-[15px] capitalize">${info.label}</p>
                    <p class="text-dim text-[13px]">${info.min}${info.max === Infinity ? '+' : '–' + info.max} ${t('account.points')}</p>
                  </div>
                </div>
                <div class="text-right">
                  ${info.discount > 0 ? `<span class="text-mango font-semibold text-[15px]">${info.discount}%</span><br>` : ''}
                  ${isCurrent ? `<span class="text-[12px] font-bold bg-mango/10 text-mango px-2 py-0.5 rounded-full">${t('account.currentTier')}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Where's My Car -->
    <div class="card-solid rounded-2xl p-6 mb-8">
      <h3 class="font-heading font-bold text-lg mb-3">${t('account.wheresMyCar')}</h3>
      <p class="text-dim text-[14px] mb-4">${t('account.wheresMyCarDesc')}</p>
      <div class="flex gap-3">
        <input type="text" placeholder="${t('account.enterPlate')}" data-car-search
          class="flex-1 min-w-0 bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40 focus:ring-2 focus:ring-mango/10 transition-all font-mono">
        <button data-car-search-btn
          class="bg-mango hover:bg-mango-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm whitespace-nowrap">
          ${t('account.searchBtn')}
        </button>
      </div>
      <div data-car-result class="mt-4 hidden"></div>
    </div>

    <!-- Points history -->
    <div class="card-solid rounded-2xl p-6">
      <h3 class="font-heading font-bold text-lg mb-5">${t('account.pointsHistory')}</h3>
      <div class="space-y-0 divide-y divide-frost-deep/60">
        ${MOCK_POINTS_HISTORY.map(entry => {
          const isPositive = entry.points > 0;
          const pointsCls = isPositive ? 'text-leaf' : 'text-danger';
          const typeBadge = entry.type === 'bonus'
            ? 'bg-mango/10 text-mango'
            : entry.type === 'redeem'
            ? 'bg-red-50 text-danger'
            : 'bg-frost text-dim';
          return `
            <div class="flex items-center justify-between py-4">
              <div class="flex items-center gap-3 min-w-0">
                <span class="text-[11px] font-bold ${typeBadge} px-2 py-0.5 rounded-full uppercase">${entry.type}</span>
                <div class="min-w-0">
                  <p class="text-[15px] truncate">${entry.description}</p>
                  <p class="text-dim text-[13px]">${new Date(entry.date).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
              <span class="font-heading font-bold text-[16px] flex-shrink-0 ${pointsCls}">${isPositive ? '+' : ''}${entry.points}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account/loyalty', content)}
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

  // "Where's My Car?" search
  const searchInput = page.querySelector('[data-car-search]');
  const searchBtn = page.querySelector('[data-car-search-btn]');
  const resultDiv = page.querySelector('[data-car-result]');

  const doSearch = () => {
    const plate = searchInput.value.trim().toUpperCase();
    if (!plate) return;

    // Mock lookup
    const MOCK_LOCATIONS = {
      'B 123 ABC': { spot: 'A-17', zone: 'A', floor: 'Ground', since: '2026-03-01T08:30' },
      'IF 99 XYZ': null, // not currently parked
    };

    const result = MOCK_LOCATIONS[plate];
    resultDiv.classList.remove('hidden');

    if (result) {
      resultDiv.innerHTML = `
        <div class="bg-leaf/5 border border-leaf/20 rounded-xl p-4">
          <p class="font-semibold text-[15px] mb-1">${t('account.carFound')}</p>
          <p class="text-dim text-[14px]">
            <span class="font-mono font-semibold">${plate}</span> ${t('account.isParkedAt')}
            <span class="font-semibold text-charcoal">${result.spot}</span>
            (${t('account.zone')} ${result.zone})
          </p>
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="bg-frost border border-frost-deep rounded-xl p-4">
          <p class="text-dim text-[15px]">${t('account.carNotFound', { plate })}</p>
        </div>
      `;
    }
  };

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  container.appendChild(page);
}
