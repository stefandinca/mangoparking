import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { LOYALTY_TIERS } from '../../utils/constants.js';
import { formatDate } from '../../utils/date.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';

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
                  <p class="text-dim text-[13px]">${formatDate(entry.date, locale)}</p>
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

  initAccountNav(page);

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
