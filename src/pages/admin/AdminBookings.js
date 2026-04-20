import { html, delegate } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { lookupByPlate, useToken, checkOut, refundToken, getAllRecentTransactions } from '../../services/tokenService.js';
import { getDocument } from '../../firebase/db.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { showToast } from '../../components/core/Toast.js';
import { formatDate } from '../../utils/date.js';

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
  checkout: 'bg-purple-100 text-purple-600',
};

function renderTransaction(tx, locale) {
  const time = tx.timestamp ? formatDate(tx.timestamp, locale) : '—';
  const typeCls = TYPE_STYLES[tx.type] || 'bg-gray-100 text-gray-600';
  const qty = tx.type === 'use' ? tx.quantity : `+${tx.quantity}`;
  return `
    <div class="flex items-center gap-4 px-6 py-4">
      <span class="font-mono text-[13px] text-dim w-28 shrink-0">${time}</span>
      <span class="text-[12px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${typeCls}">${t('token.type' + tx.type.charAt(0).toUpperCase() + tx.type.slice(1))}</span>
      <span class="font-mono font-semibold text-[15px] w-12 text-center">${qty}</span>
      <span class="text-[14px] text-dim truncate">${tx.licensePlate || '—'}</span>
    </div>`;
}

export default async function AdminBookings(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.bookings')} — Admin — Mango Parking`, description: t('admin.bookingsSubtitle') });

  const recentTx = await getAllRecentTransactions(50).catch(() => []);

  const page = AdminLayout('/admin/bookings', `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('token.management')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('token.managementSubtitle')}</p>
          </div>
        </div>

        <!-- Plate Search -->
        <div class="card-solid rounded-2xl p-6 mb-6">
          <div class="flex gap-3">
            <input type="text" data-plate-input placeholder="${t('token.searchPlate')}" class="flex-1 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase font-mono">
            <button data-search-plate class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-3 rounded-xl transition-colors">${t('account.searchBtn')}</button>
          </div>
        </div>

        <!-- Customer Result -->
        <div data-customer-result class="hidden mb-6"></div>

        <!-- Recent Transactions -->
        <div>
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('token.recentAll')}</h2>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60" data-tx-list>
              ${recentTx.length > 0 ? recentTx.map(tx => renderTransaction(tx, locale)).join('') : `<div class="px-6 py-8 text-center text-dim">${t('token.noTransactions')}</div>`}
            </div>
          </div>
        </div>
  `);

  let currentCustomer = null;
  let currentCheckedIn = false;

  async function renderCustomerResult(customer) {
    const el = page.querySelector('[data-customer-result]');
    if (!customer) {
      el.innerHTML = `<div class="card-solid rounded-2xl p-6 text-center text-dim">${t('token.noCustomerFound')}</div>`;
      el.classList.remove('hidden');
      return;
    }
    currentCustomer = customer;
    const plate = (customer.plates || [])[0] || '';
    const checkInDoc = plate ? await getDocument('activeCheckIns', plate.toUpperCase().replace(/[\s-]/g, '')).catch(() => null) : null;
    currentCheckedIn = !!checkInDoc;
    const assignedSpot = checkInDoc?.spotId || null;

    const checkedInBadge = currentCheckedIn
      ? `<span class="inline-flex items-center gap-1.5 text-[13px] font-bold bg-leaf/10 text-leaf px-3 py-1 rounded-full"><span class="w-2 h-2 rounded-full bg-leaf animate-pulse"></span>${locale === 'ro' ? 'Parcat' : 'Parked'}${assignedSpot ? ` — ${assignedSpot}` : ''}</span>`
      : `<span class="text-[13px] text-dim">${locale === 'ro' ? 'Nu este parcat' : 'Not parked'}</span>`;

    el.innerHTML = `
      <div class="card-solid rounded-2xl p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-heading font-bold text-lg">${t('token.customerInfo')}</h3>
          ${checkedInBadge}
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div>
            <p class="text-dim text-[13px] mb-1">${t('booking.name')}</p>
            <p class="font-semibold">${customer.displayName || '—'}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('booking.email')}</p>
            <p class="font-semibold text-[14px]">${customer.email || '—'}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('token.plateLabel')}</p>
            <p class="font-mono font-semibold">${(customer.plates || []).join(', ') || '—'}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('token.balance')}</p>
            <p class="font-heading font-bold text-3xl text-mango">${customer.balance ?? 0}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-3">
          <button data-use-token class="bg-leaf text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors ${currentCheckedIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-leaf/85'}" ${currentCheckedIn ? 'disabled' : ''}>${t('token.useOneToken')}</button>
          <button data-checkout class="bg-blue-500 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors ${!currentCheckedIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-600'}" ${!currentCheckedIn ? 'disabled' : ''}>Check Out</button>
          <div class="flex gap-2 items-center">
            <input type="number" data-refund-qty min="1" value="1" class="w-20 px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono text-center focus:outline-none focus:border-mango/40">
            <button data-refund-token class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('token.refundTokens')}</button>
          </div>
        </div>
      </div>
    `;
    el.classList.remove('hidden');
  }

  // Search
  delegate(page, 'click', '[data-search-plate]', async () => {
    const input = page.querySelector('[data-plate-input]');
    const plate = input?.value?.trim();
    if (!plate) return;
    try {
      const result = await lookupByPlate(plate);
      renderCustomerResult(result);
    } catch (err) {
      console.error(err);
      renderCustomerResult(null);
    }
  });

  // Enter key on search input
  const plateInput = page.querySelector('[data-plate-input]');
  if (plateInput) {
    plateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') page.querySelector('[data-search-plate]')?.click();
    });
  }

  // Prevent double-clicks on async actions
  let actionBusy = false;
  const spinner = '<svg class="w-4 h-4 animate-spin inline-block ml-1" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>';

  function setBtnLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.origText = btn.innerHTML;
      btn.innerHTML = btn.textContent.trim() + spinner;
      btn.classList.add('opacity-70');
    } else {
      btn.innerHTML = btn.dataset.origText || btn.innerHTML;
      btn.classList.remove('opacity-70');
    }
  }

  // Use token (check-in)
  delegate(page, 'click', '[data-use-token]', async () => {
    if (actionBusy) return;
    if (!currentCustomer || currentCustomer.balance < 1) {
      showToast(t('token.insufficientBalance'), 'error');
      return;
    }
    actionBusy = true;
    setBtnLoading(page.querySelector('[data-use-token]'), true);
    try {
      await useToken(currentCustomer.id, (currentCustomer.plates || [])[0] || '');
      currentCustomer.balance -= 1;
      await renderCustomerResult(currentCustomer);
      showToast(t('token.tokenUsed'), 'success');
    } catch (err) {
      if (err.message === 'ALREADY_CHECKED_IN') {
        showToast(locale === 'ro' ? 'Vehiculul este deja parcat!' : 'Vehicle is already checked in!', 'error');
      } else {
        console.error(err);
        showToast(t('common.error'), 'error');
      }
    } finally {
      actionBusy = false;
    }
  });

  // Check out
  delegate(page, 'click', '[data-checkout]', async () => {
    if (actionBusy) return;
    if (!currentCustomer) return;
    actionBusy = true;
    setBtnLoading(page.querySelector('[data-checkout]'), true);
    const plate = (currentCustomer.plates || [])[0] || '';
    try {
      await checkOut(plate);
      await renderCustomerResult(currentCustomer);
      showToast(locale === 'ro' ? 'Check-out realizat! Capacitate actualizată.' : 'Checked out! Capacity updated.', 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    } finally {
      actionBusy = false;
    }
  });

  // Refund
  delegate(page, 'click', '[data-refund-token]', async () => {
    if (!currentCustomer) return;
    const qty = parseInt(page.querySelector('[data-refund-qty]')?.value || '0');
    if (qty < 1) return;
    try {
      await refundToken(currentCustomer.id, qty);
      currentCustomer.balance += qty;
      renderCustomerResult(currentCustomer);
      showToast(t('token.tokenRefunded'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  initAdminNav(page);
  container.appendChild(page);
}
