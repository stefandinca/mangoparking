import { html, delegate } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { lookupByPlate, useToken, checkOut, refundToken, getAllRecentTransactions } from '../../services/tokenService.js';
import { getRecentBookings, getLongTermRates } from '../../services/longTermService.js';
import { getDocument, addDocument } from '../../firebase/db.js';
import { auditLog } from '../../services/auditService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { showToast } from '../../components/core/Toast.js';
import { formatDate } from '../../utils/date.js';

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
  checkout: 'bg-purple-100 text-purple-600',
  lateFee: 'bg-danger/10 text-danger',
};

function renderTransaction(tx, locale) {
  const time = tx.timestamp ? formatDate(tx.timestamp, locale) : '—';
  const typeCls = TYPE_STYLES[tx.type] || 'bg-gray-100 text-gray-600';
  // Late fee logs the RON amount, not a token quantity.
  const valueCol = tx.type === 'lateFee'
    ? `${tx.feeAmount ?? 0} ${t('common.lei')}`
    : (tx.type === 'use' ? tx.quantity : `+${tx.quantity}`);
  return `
    <div class="flex items-center gap-4 px-6 py-4">
      <span class="font-mono text-[13px] text-dim w-28 shrink-0">${time}</span>
      <span class="text-[12px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${typeCls}">${t('credit.type' + tx.type.charAt(0).toUpperCase() + tx.type.slice(1))}</span>
      <span class="font-mono font-semibold text-[15px] w-20 text-center">${valueCol}</span>
      <span class="text-[14px] text-dim truncate">${tx.licensePlate || '—'}</span>
    </div>`;
}

export default async function AdminBookings(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.bookings')} — Admin — Mango Parking`, description: t('admin.bookingsSubtitle') });

  const [recentTx, recentBookings] = await Promise.all([
    getAllRecentTransactions(50).catch(() => []),
    getRecentBookings(20).catch(() => []),
  ]);
  const longTermBookings = recentBookings.filter(b => b.type === 'longTerm');

  // Format an ISO timestamp as "dd/MM HH:mm" in local time.
  // Falls back to date-only "dd/MM" when only a date string is given.
  function fmtMoment(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const pad = (n) => String(n).padStart(2, '0');
    const datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    const hasTime = iso.length > 10;
    return hasTime ? `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}` : datePart;
  }

  // 2h grace beyond pickup, then a booking is "overtime" — staff should
  // collect an extra long-term day at the lot.
  const OVERTIME_GRACE_MS = 2 * 60 * 60 * 1000;

  function renderBookingRow(b) {
    const fromIso = b.dropoffAt || b.startDate;
    const toIso = b.pickupAt || b.endDate;
    const dateStr = `${fmtMoment(fromIso)} → ${fmtMoment(toIso)}`;
    const statusCls = b.status === 'active' ? 'bg-leaf/10 text-leaf'
      : b.status === 'upcoming' ? 'bg-blue-100 text-blue-600'
      : b.status === 'completed' ? 'bg-gray-100 text-gray-600'
      : 'bg-danger/10 text-danger';
    const pickupMs = b.pickupAt ? new Date(b.pickupAt).getTime() : null;
    const isOvertime = pickupMs
      && b.status !== 'completed'
      && Date.now() > pickupMs + OVERTIME_GRACE_MS;
    return `
      <div class="flex items-center gap-4 px-6 py-4 text-[14px]">
        <span class="font-mono text-[13px] text-dim w-44 shrink-0 truncate">${dateStr}</span>
        <span class="font-mono font-semibold w-28 truncate">${b.licensePlate}</span>
        <span class="text-dim w-20 text-right font-mono">${b.days}${t('common.day')}</span>
        <span class="text-dim w-28 text-right font-mono">${b.totalPrice} lei</span>
        <span class="text-[12px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${statusCls}">${b.status}</span>
        ${isOvertime ? `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/10 text-danger">${t('bookingsAdmin.overtime')}</span>` : ''}
      </div>`;
  }

  const page = AdminLayout('/admin/bookings', `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('credit.management')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('credit.managementSubtitle')}</p>
          </div>
        </div>

        <!-- Plate Search -->
        <div class="card-solid rounded-2xl p-6 mb-6">
          <div class="flex gap-3">
            <input type="text" data-plate-input placeholder="${t('credit.searchPlate')}" class="flex-1 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase font-mono">
            <button data-search-plate class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-6 py-3 rounded-xl transition-colors">${t('account.searchBtn')}</button>
          </div>
        </div>

        <!-- Customer Result -->
        <div data-customer-result class="hidden mb-6"></div>

        <!-- Long-term bookings -->
        <div class="mb-8">
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('bookingsAdmin.tabLongTerm')}</h2>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60">
              ${longTermBookings.length > 0 ? longTermBookings.map(renderBookingRow).join('') : `<div class="px-6 py-8 text-center text-dim">${t('bookingsAdmin.noBookings')}</div>`}
            </div>
          </div>
        </div>

        <!-- Recent credit transactions -->
        <div>
          <h2 class="font-heading font-bold text-lg mb-4 text-charcoal">${t('credit.recentAll')}</h2>
          <div class="card-solid rounded-2xl overflow-hidden">
            <div class="divide-y divide-frost-deep/60" data-tx-list>
              ${recentTx.length > 0 ? recentTx.map(tx => renderTransaction(tx, locale)).join('') : `<div class="px-6 py-8 text-center text-dim">${t('credit.noTransactions')}</div>`}
            </div>
          </div>
        </div>
  `);

  let currentCustomer = null;
  let currentCheckedIn = false;

  async function renderCustomerResult(customer) {
    const el = page.querySelector('[data-customer-result]');
    if (!customer) {
      el.innerHTML = `<div class="card-solid rounded-2xl p-6 text-center text-dim">${t('credit.noCustomerFound')}</div>`;
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
          <h3 class="font-heading font-bold text-lg">${t('credit.customerInfo')}</h3>
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
            <p class="text-dim text-[13px] mb-1">${t('credit.plateLabel')}</p>
            <p class="font-mono font-semibold">${(customer.plates || []).join(', ') || '—'}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('credit.balance')}</p>
            <p class="font-heading font-bold text-3xl text-mango">${customer.balance ?? 0}</p>
          </div>
        </div>
        <div class="flex flex-wrap gap-3">
          <button data-use-credit class="bg-leaf text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors ${currentCheckedIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-leaf/85'}" ${currentCheckedIn ? 'disabled' : ''}>${t('credit.useOneToken')}</button>
          <button data-checkout class="bg-blue-500 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors ${!currentCheckedIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-600'}" ${!currentCheckedIn ? 'disabled' : ''}>Check Out</button>
          <div class="flex gap-2 items-center">
            <input type="number" data-refund-qty min="1" value="1" class="w-20 px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono text-center focus:outline-none focus:border-mango/40">
            <button data-refund-credit class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('credit.refundTokens')}</button>
          </div>
          <button data-late-fee class="ml-auto bg-danger/10 hover:bg-danger/20 text-danger font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('credit.chargeLateFee')}</button>
        </div>
        <p class="text-[12px] text-dim mt-3">${t('credit.lateFeeHint')}</p>
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

  // Use credit (check-in)
  delegate(page, 'click', '[data-use-credit]', async () => {
    if (actionBusy) return;
    if (!currentCustomer || currentCustomer.balance < 1) {
      showToast(t('credit.insufficientBalance'), 'error');
      return;
    }
    actionBusy = true;
    setBtnLoading(page.querySelector('[data-use-credit]'), true);
    try {
      await useToken(currentCustomer.id, (currentCustomer.plates || [])[0] || '');
      currentCustomer.balance -= 1;
      await renderCustomerResult(currentCustomer);
      showToast(t('credit.tokenUsed'), 'success');
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

  // Charge late-pickup fee (commuter who didn't leave by 8 PM).
  // Logs a tokenTransactions doc for accounting; money is collected in
  // person at the lot. Fee = current 1-day long-term tier rate.
  delegate(page, 'click', '[data-late-fee]', async () => {
    if (!currentCustomer) return;
    if (actionBusy) return;
    let rate = 0;
    try {
      const rates = await getLongTermRates();
      rate = rates?.tiers?.[0]?.perDay ?? 0;
    } catch (err) {
      console.error(err);
    }
    if (!rate) {
      showToast(t('common.error'), 'error');
      return;
    }
    const plate = (currentCustomer.plates || [])[0] || '';
    const confirmMsg = t('credit.lateFeeConfirm', { amount: rate });
    if (!window.confirm(confirmMsg)) return;
    actionBusy = true;
    setBtnLoading(page.querySelector('[data-late-fee]'), true);
    try {
      await addDocument('tokenTransactions', {
        customerId: currentCustomer.id || null,
        licensePlate: plate,
        type: 'lateFee',
        quantity: 0,
        feeAmount: rate,
        feeCurrency: 'RON',
        timestamp: new Date().toISOString(),
        source: 'admin-manual',
      });
      await auditLog('late_fee_charged', 'tokenTransactions', plate || 'unknown', null, { plate, amount: rate });
      showToast(t('credit.lateFeeCharged', { amount: rate }), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    } finally {
      actionBusy = false;
      setBtnLoading(page.querySelector('[data-late-fee]'), false);
    }
  });

  // Refund
  delegate(page, 'click', '[data-refund-credit]', async () => {
    if (!currentCustomer) return;
    const qty = parseInt(page.querySelector('[data-refund-qty]')?.value || '0');
    if (qty < 1) return;
    try {
      await refundToken(currentCustomer.id, qty);
      currentCustomer.balance += qty;
      renderCustomerResult(currentCustomer);
      showToast(t('credit.tokenRefunded'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  initAdminNav(page);
  container.appendChild(page);
}
