import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { getTransactions } from '../../services/tokenService.js';
import { formatDate } from '../../utils/date.js';
import { accountLayout, initAccountNav } from '../../components/account/AccountLayout.js';

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
};

function renderTransaction(tx, locale) {
  const typeCls = TYPE_STYLES[tx.type] || 'bg-gray-100 text-gray-600';
  const qty = tx.type === 'use' ? tx.quantity : `+${tx.quantity}`;
  return `
    <div class="card-solid rounded-2xl p-5 mb-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-frost flex items-center justify-center">
            <span class="font-mono font-bold text-[14px] text-dim">${qty}</span>
          </div>
          <div>
            <p class="font-semibold text-[15px]">${t('token.type' + tx.type.charAt(0).toUpperCase() + tx.type.slice(1))}</p>
            <p class="text-dim text-[13px]">${formatDate(tx.timestamp, locale)}${tx.licensePlate ? ` · ${tx.licensePlate}` : ''}</p>
          </div>
        </div>
        <span class="text-[12px] font-bold ${typeCls} px-3 py-1 rounded-full capitalize">${tx.type}</span>
      </div>
    </div>
  `;
}

export default async function BookingHistory(container) {
  const locale = getLocale();
  const profile = getUserProfile();

  updateMeta({
    title: `${t('account.bookings')} — Mango Parking`,
    description: t('account.bookingsSubtitle'),
    lang: locale,
  });

  const transactions = profile
    ? await getTransactions(profile.id, 100).catch(() => [])
    : [];

  const txRows = transactions.map(tx => renderTransaction(tx, locale)).join('');

  const content = `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.bookings')}</h1>
        <p class="text-dim text-[16px]">${t('account.bookingsSubtitle')}</p>
      </div>
      <a href="${localePath('/booking')}" class="hidden sm:inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('token.buyMore')}</a>
    </div>

    <!-- Filter tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      ${['all', 'purchase', 'use', 'refund'].map((f, i) => {
        const label = f === 'all' ? t('token.filterAll') : t('token.filter' + f.charAt(0).toUpperCase() + f.slice(1));
        const cls = i === 0
          ? 'px-4 py-3 rounded-xl bg-blueberry text-white text-[14px] font-semibold'
          : 'px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors';
        return `<button class="${cls}" data-filter="${f}">${label}</button>`;
      }).join('')}
    </div>

    <!-- Transaction list -->
    <div data-tx-list>
      ${txRows || `<p class="text-dim text-center py-8">${t('token.noTransactions')}</p>`}
    </div>

    <!-- Mobile CTA -->
    <div class="sm:hidden mt-6">
      <a href="${localePath('/booking')}" class="block text-center bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('token.buyMore')}</a>
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account/bookings', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  // Filter logic
  delegate(page, 'click', '[data-filter]', (e, btn) => {
    const filter = btn.dataset.filter;
    page.querySelectorAll('[data-filter]').forEach(b => {
      b.className = b.dataset.filter === filter
        ? 'px-4 py-3 rounded-xl bg-blueberry text-white text-[14px] font-semibold'
        : 'px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors';
    });
    const list = page.querySelector('[data-tx-list]');
    const filtered = filter === 'all' ? transactions : transactions.filter(tx => tx.type === filter);
    list.innerHTML = filtered.map(tx => renderTransaction(tx, locale)).join('') || `<p class="text-dim text-center py-8">${t('token.noTransactions')}</p>`;
  });

  container.appendChild(page);
}
