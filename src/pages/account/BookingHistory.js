import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile, getCurrentUser } from '../../firebase/auth.js';
import { getTransactions } from '../../services/tokenService.js';
import { getCollection, where } from '../../firebase/db.js';
import { formatDate } from '../../utils/date.js';
import { accountLayout, initAccountNav } from '../../components/account/AccountLayout.js';
import { confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { invoicePdfLink } from '../../services/invoiceService.js';

const cancelBookingFn = httpsCallable(functions, 'cancelBookingWithRefund');
const cancelPendingCreditOrderFn = httpsCallable(functions, 'cancelPendingCreditOrder');

// Customer-facing reservation history.
//
// Two tabs:
//   Upcoming — bookings with status in [upcoming, active]
//              + open token-purchase rows where the balance hasn't been
//              fully consumed (treated as "credits ready to use")
//   Past     — bookings completed/cancelled + token transactions of any type
//
// All data is read client-side and filtered locally; the volumes here are
// per-user and small (a few dozen rows even for heavy users).

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
};

export default async function BookingHistory(container) {
  const locale = getLocale();
  const profile = getUserProfile();
  const uid = getCurrentUser()?.uid;

  updateMeta({
    title: `${t('account.bookings')} — ManGO Parking`,
    description: t('account.bookingsSubtitle'),
    lang: locale,
  });

  // pendingOrders for this customer — pay-at-pickup credit packs that
  // haven't been collected yet. Surface them so the user can pay online
  // later (via the /pay link in their email) or cancel from the same
  // history page. Match by customerData.customerId (Firestore rules let
  // the user read pendingOrders by id, but for the listing we filter
  // client-side with the existing customerId index).
  const [transactions, bookings, pendingOrders] = await Promise.all([
    profile ? getTransactions(profile.id, 100).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('bookings', where('customerId', '==', uid)).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('pendingOrders', where('customerData.customerId', '==', uid)).catch(() => []) : Promise.resolve([]),
  ]);

  // Pay-at-pickup credit packs still awaiting payment — distinct from
  // bookings because no booking doc exists for credit purchases.
  const pendingCreditOrders = pendingOrders
    .filter((o) => o.orderType === 'credits'
      && o.paymentMethod === 'pay-at-pickup'
      && o.paymentStatus !== 'paid'
      && o.status !== 'cancelled')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  // Sort everything newest-first by their respective timestamps.
  const upcomingBookings = bookings
    .filter(b => b.status === 'upcoming' || b.status === 'active')
    .sort((a, b) => String(a.startDate || a.dropoffAt || '').localeCompare(String(b.startDate || b.dropoffAt || '')));

  const pastBookings = bookings
    .filter(b => b.status === 'completed' || b.status === 'cancelled')
    .sort((a, b) => String(b.completedAt || b.endDate || b.startDate || '').localeCompare(String(a.completedAt || a.endDate || a.startDate || '')));

  const txSorted = [...transactions].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

  const content = `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.bookings')}</h1>
        <p class="text-dim text-[16px]">${t('account.bookingsSubtitle')}</p>
      </div>
      <a href="${localePath('/booking')}" class="hidden sm:inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.reserveNow')}</a>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 flex-wrap" data-tabs>
      <button data-tab="upcoming" class="px-4 py-3 rounded-xl bg-blueberry text-white text-[14px] font-semibold">${t('account.tabUpcoming')}</button>
      <button data-tab="past" class="px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors">${t('account.tabPast')}</button>
    </div>

    <!-- Upcoming -->
    <div data-pane="upcoming">
      ${pendingCreditOrders.map(o => renderPendingCreditOrder(o, locale)).join('')}
      ${upcomingBookings.length > 0
        ? upcomingBookings.map(b => renderBookingRow(b, locale)).join('')
        : (pendingCreditOrders.length === 0
            ? `<p class="text-dim text-center py-8">${t('account.upcomingNone')}</p>`
            : '')}
    </div>

    <!-- Past (hidden initially) -->
    <div data-pane="past" class="hidden">
      ${(pastBookings.length + txSorted.length) > 0
        ? `
          ${pastBookings.map(b => renderBookingRow(b, locale)).join('')}
          ${txSorted.map(tx => renderTransaction(tx, locale)).join('')}
        `
        : `<p class="text-dim text-center py-8">${t('account.pastNone')}</p>`}
    </div>

    <div class="sm:hidden mt-6">
      <a href="${localePath('/booking')}" class="block text-center bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.reserveNow')}</a>
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

  // Tab toggle
  delegate(page, 'click', '[data-tab]', (e, btn) => {
    const tab = btn.dataset.tab;
    page.querySelectorAll('[data-tab]').forEach(b => {
      b.className = b.dataset.tab === tab
        ? 'px-4 py-3 rounded-xl bg-blueberry text-white text-[14px] font-semibold'
        : 'px-4 py-3 rounded-xl bg-frost text-dim text-[14px] hover:bg-frost-deep transition-colors';
    });
    page.querySelectorAll('[data-pane]').forEach(p => {
      p.classList.toggle('hidden', p.dataset.pane !== tab);
    });
  });

  // Self-service cancel for a pending pay-at-pickup credit order. No
  // money has moved; the callable just flips status to cancelled.
  delegate(page, 'click', '[data-cancel-order]', async (e, btn) => {
    const orderId = btn.dataset.cancelOrder;
    const ok = await confirmModal(t('account.cancelOrderConfirm'), {
      confirmText: t('account.cancelOrder'),
      cancelText: t('account.cancelBookingNo'),
      danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = t('account.cancelling');
    try {
      await cancelPendingCreditOrderFn({ orderId });
      showToast(t('account.cancelOrderOk'), 'success');
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = t('account.cancelOrder');
      showToast(err?.message || t('common.error'), 'error');
    }
  });

  // Self-service cancel — confirms, calls the cancelBookingWithRefund
  // callable, then reloads the page to reflect the new status (and any
  // released spot on /admin/capacity if the user happens to look).
  // Keys are namespaced as `cancelBooking*` to avoid colliding with the
  // legacy subscription-cancel strings under the same `account` block.
  delegate(page, 'click', '[data-cancel-booking]', async (e, btn) => {
    const bookingId = btn.dataset.cancelBooking;
    const ok = await confirmModal(t('account.cancelBookingConfirm'), {
      confirmText: t('account.cancelBooking'),
      cancelText: t('account.cancelBookingNo'),
      danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = t('account.cancelling');
    try {
      const res = await cancelBookingFn({ bookingId });
      const outcome = res?.data?.refundOutcome || 'none';
      // Tailor the success toast to the refund branch so customers know
      // whether to expect a wire/visit or just an updated reservation.
      const msg = outcome === 'netopia-pending'
        ? t('account.cancelBookingOkRefundNetopia')
        : outcome === 'cash-pending'
          ? t('account.cancelBookingOkRefundCash')
          : t('account.cancelBookingOk');
      showToast(msg, 'success');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = t('account.cancelBooking');
      showToast(err?.message || t('common.error'), 'error');
    }
  });

  container.appendChild(page);
}

function renderBookingRow(b, locale) {
  const dropoff = b.dropoffAt || b.startDate;
  const pickup = b.pickupAt || b.endDate;
  const isLT = b.type === 'longTerm';
  const badgeCls = b.status === 'active' ? 'bg-leaf/10 text-leaf'
    : b.status === 'completed' ? 'bg-frost text-charcoal/60'
    : b.status === 'cancelled' ? 'bg-red-100 text-red-600'
    : 'bg-blueberry/10 text-blueberry';
  // Cancel is allowed only for upcoming bookings; refund branch is decided
  // server-side so we don't show different copy here.
  const canCancel = b.status === 'upcoming';
  // SmartBill document links (v1.2 Phase 5): fiscal invoice when auto-issued
  // (online-paid), otherwise the proforma; a storno link joins on cancellation.
  const sb = b.smartbill || {};
  const docLinks = [
    sb.invoice?.number ? { doc: 'invoice', label: t('invoice.download') }
      : (sb.proforma?.number && !sb.proformaDeleted) ? { doc: 'proforma', label: t('invoice.downloadProforma') }
      : null,
    sb.storno?.number ? { doc: 'storno', label: t('invoice.downloadStorno') } : null,
  ].filter(Boolean)
    .map((l) => `<a href="${invoicePdfLink({ bookingId: b.id, doc: l.doc })}" target="_blank" rel="noopener" class="text-blueberry hover:underline text-[13px] font-semibold">${l.label}</a>`)
    .join('');
  return `
    <div class="card-solid rounded-2xl p-5 mb-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blueberry/10 text-blueberry">${isLT ? t('account.bookingLongterm') : t('account.bookingCredit')}</span>
            <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeCls}">${t('admin.' + (b.status || 'upcoming'))}</span>
            ${b.code ? `<span class="text-[12px] font-mono text-dim">${b.code}</span>` : ''}
          </div>
          <p class="text-[14px] text-charcoal">
            <span class="font-mono font-bold">${b.licensePlate || '—'}</span>
            · ${t('account.arrivingOn')} <span class="font-medium">${formatDate(dropoff, locale)}</span>
            · ${t('account.leavingOn')} <span class="font-medium">${formatDate(pickup, locale)}</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          ${typeof b.totalPrice === 'number' ? `<p class="font-mono font-semibold text-[15px]">${b.totalPrice} ${t('common.lei')}</p>` : ''}
          ${docLinks}
          ${canCancel ? `<button data-cancel-booking="${b.id}" class="text-red-500 hover:text-red-600 text-[13px] font-semibold underline-offset-2 hover:underline transition-colors">${t('account.cancelBooking')}</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// Pay-at-pickup credit packs awaiting payment. The /pay link reopens the
// online Netopia flow for the same orderId; "Anulează" calls the
// cancelPendingCreditOrder callable.
function renderPendingCreditOrder(o, locale) {
  const qty = o.quantity || '?';
  const amount = o.amount ? `${Number(o.amount)} ${t('common.lei')}` : '';
  const plate = o.customerData?.licensePlate || '';
  return `
    <div class="card-solid rounded-2xl p-5 mb-3 border border-mango/40">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mango/15 text-charcoal">${t('account.pendingCreditOrder')}</span>
            <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/10 text-danger">${t('checkins.payUnpaid')}</span>
            ${o.id ? `<span class="text-[12px] font-mono text-dim">${o.id.slice(0, 8)}</span>` : ''}
          </div>
          <p class="text-[14px] text-charcoal">
            <span class="font-mono font-bold">${plate || '—'}</span>
            · ${qty} ${t('credit.plural')}
            ${amount ? `· <span class="font-mono">${amount}</span>` : ''}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          ${o.smartbill?.proforma?.number && !o.smartbill?.proformaDeleted ? `<a href="${invoicePdfLink({ orderId: o.id, doc: 'proforma' })}" target="_blank" rel="noopener" class="text-blueberry hover:underline text-[13px] font-semibold">${t('invoice.downloadProforma')}</a>` : ''}
          <a href="${localePath('/pay')}?orderId=${encodeURIComponent(o.id)}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[13px] px-4 py-2 rounded-xl transition-colors">${t('account.payNow')}</a>
          <button data-cancel-order="${o.id}" class="text-red-500 hover:text-red-600 text-[13px] font-semibold underline-offset-2 hover:underline transition-colors">${t('account.cancelOrder')}</button>
        </div>
      </div>
    </div>
  `;
}

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
            <p class="font-semibold text-[15px]">${t('credit.type' + tx.type.charAt(0).toUpperCase() + tx.type.slice(1))}</p>
            <p class="text-dim text-[13px]">${formatDate(tx.timestamp, locale)}${tx.licensePlate ? ` · ${tx.licensePlate}` : ''}</p>
          </div>
        </div>
        <span class="text-[12px] font-bold ${typeCls} px-3 py-1 rounded-full capitalize">${tx.type}</span>
      </div>
    </div>
  `;
}
