import { html, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { getCollection, where } from '../../firebase/db.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { userNameButton, wireUserLinks } from '../../components/admin/UserDetailModal.js';
import { reservationCodeHtml, wireReservationLinks } from '../../components/admin/reservationLink.js';
import { bookingDisplayCode } from '../../utils/bookingCode.js';

const adminMarkRefundedFn = httpsCallable(functions, 'adminMarkRefunded');
const adminResendRefundEmailFn = httpsCallable(functions, 'adminResendRefundEmail');
const adminResolvePendingRefundFn = httpsCallable(functions, 'adminResolvePendingRefund');

const HISTORY_DAYS = 90;

// Only a booking with a captured payment can be refunded. These are the
// `paidBy` channels where money actually changed hands (online, or cash/card
// collected at the desk). Unpaid "cash on arrival" (pay-at-pickup) bookings
// have `paidBy: null` — nothing to refund — and must not appear in the queue.
const PAID_CHANNELS = new Set(['netopia', 'admin-cash', 'admin-card']);

const NETOPIA_ADMIN_URL = 'https://admin.netopia-payments.com/';

// /admin/refunds — manual refund queue.
//
// Bookings flagged `paymentStatus: 'refund-pending'` (set by
// `cancelBookingWithRefund` when a paid booking is cancelled) live here
// until an admin processes the refund. For Netopia-paid bookings the
// admin clicks through to Netopia's panel, issues the refund there, then
// returns and marks the row as refunded. For admin-cash/card the cash
// goes back at the lot. Either way the customer gets a refund-issued
// email on "Mark refunded".
//
// This is an interim solution until v1.4 lands the v2 REST integration
// (auto-refund at cancel time) — see documentation/v.1.4_netopia_v2_migration.md.

function fmtDateTime(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function fmtDate(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function paidByLabel(paidBy) {
  switch (paidBy) {
    case 'netopia':     return t('refunds.paidByNetopia');
    case 'admin-cash':  return t('refunds.paidByCash');
    case 'admin-card':  return t('refunds.paidByCard');
    default:            return paidBy || '—';
  }
}

// Recommends the right refund channel based on how the booking was paid.
// Netopia online → must be refunded via Netopia panel. Cash → return
// cash at the lot. Card terminal → void on the POS terminal.
function suggestedVia(paidBy) {
  if (paidBy === 'netopia')    return 'netopia-panel';
  if (paidBy === 'admin-cash') return 'cash-returned';
  if (paidBy === 'admin-card') return 'card-terminal';
  return 'netopia-panel';
}

function refundedViaLabel(via) {
  switch (via) {
    case 'netopia-panel':  return t('refunds.viaNetopiaPanel');
    case 'cash-returned':  return t('refunds.viaCash');
    case 'card-terminal':  return t('refunds.viaCardTerminal');
    default:               return via || '—';
  }
}

function emailStatusBadge(refundEmail) {
  const status = refundEmail?.status;
  if (status === 'sent') {
    return `<span class="inline-flex items-center gap-1 text-[12px] font-semibold text-leaf"><span class="inline-block w-1.5 h-1.5 rounded-full bg-leaf"></span>${t('refunds.emailSent')}</span>`;
  }
  if (status === 'failed') {
    return `<span class="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600" title="${escapeHtml(refundEmail.lastError || '')}"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>${t('refunds.emailFailed')}</span>`;
  }
  return `<span class="inline-flex items-center gap-1 text-[12px] font-semibold text-dim"><span class="inline-block w-1.5 h-1.5 rounded-full bg-charcoal/30"></span>${t('refunds.emailUnknown')}</span>`;
}

function rowHtml(b, locale) {
  const paidBy = b.paidBy || '—';
  const code = bookingDisplayCode(b);
  const isNetopia = paidBy === 'netopia';
  return `
    <tr class="border-t border-frost-deep">
      <td class="px-4 py-3 text-[13px]">${reservationCodeHtml(b)}</td>
      <td class="px-4 py-3 text-[13px] font-mono">${escapeHtml(b.licensePlate || '—')}</td>
      <td class="px-4 py-3 text-[13px]">${userNameButton({ customerId: b.customerId, email: b.contact?.email, name: b.contact?.name || b.contact?.email })}</td>
      <td class="px-4 py-3 text-[13px] text-dim">${fmtDate(b.cancelledAt, locale)}</td>
      <td class="px-4 py-3 text-[13px]">${escapeHtml(paidByLabel(paidBy))}</td>
      <td class="px-4 py-3 text-[14px] font-mono font-semibold text-right">${Number(b.totalPrice || 0)} ${t('common.lei')}</td>
      <td class="px-4 py-3 text-right">
        <div class="inline-flex items-center gap-2">
          ${isNetopia ? `
            <a href="${NETOPIA_ADMIN_URL}" target="_blank" rel="noopener" class="text-[12px] text-blueberry hover:underline font-semibold">${t('refunds.openInNetopia')}</a>
          ` : ''}
          <button type="button" data-mark-refunded="${escapeHtml(b.id)}" data-paidby="${escapeHtml(paidBy)}" data-amount="${Number(b.totalPrice || 0)}" data-code="${escapeHtml(code)}" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[12px] px-3 py-1.5 rounded-lg transition-colors">${t('refunds.markRefunded')}</button>
        </div>
      </td>
    </tr>
  `;
}

export default async function AdminRefunds(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('refunds.pageTitle')} — Admin — ManGO Parking`,
    description: t('refunds.subtitle'),
    lang: locale,
  });

  const sinceIso = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [pendingRaw, refundedAll, partialRaw] = await Promise.all([
    getCollection('bookings', where('paymentStatus', '==', 'refund-pending')).catch(() => []),
    getCollection('bookings', where('paymentStatus', '==', 'refunded')).catch(() => []),
    // Partial refunds owed from a check-out-date shortening — the booking is
    // still active/completed, so these don't carry paymentStatus 'refund-pending'.
    getCollection('bookings', where('pendingRefundAmount', '>', 0)).catch(() => []),
  ]);
  // Drop anything that was never actually paid — there's nothing to refund.
  // (The cancel path already routes unpaid cancels to 'cancelled'; this also
  // hides any legacy refund-pending rows left without a captured payment.)
  const pending = pendingRaw.filter((b) => PAID_CHANNELS.has(b.paidBy));
  pending.sort((a, b) => String(b.cancelledAt || '').localeCompare(String(a.cancelledAt || '')));

  // History: refunds in the last HISTORY_DAYS, newest first.
  const history = refundedAll
    .filter((b) => (b.refundedAt || '') >= sinceIso)
    .sort((a, b) => String(b.refundedAt || '').localeCompare(String(a.refundedAt || '')));

  const partial = partialRaw
    .filter((b) => Number(b.pendingRefundAmount) > 0)
    .sort((a, b) => String(b.pendingRefundCreatedAt || '').localeCompare(String(a.pendingRefundCreatedAt || '')));

  const totalAmount = pending.reduce((acc, b) => acc + (Number(b.totalPrice) || 0), 0);
  const failedCount = history.filter((b) => b.refundEmail?.status === 'failed').length;

  const historyRowHtml = (b) => {
    const code = bookingDisplayCode(b);
    const failed = b.refundEmail?.status === 'failed';
    return `
      <tr class="border-t border-frost-deep">
        <td class="px-4 py-3 text-[13px]">${reservationCodeHtml(b)}</td>
        <td class="px-4 py-3 text-[13px] font-mono">${escapeHtml(b.licensePlate || '—')}</td>
        <td class="px-4 py-3 text-[13px]">${userNameButton({ customerId: b.customerId, email: b.contact?.email, name: b.contact?.name || b.contact?.email })}</td>
        <td class="px-4 py-3 text-[13px] text-dim">${fmtDateTime(b.refundedAt, locale)}</td>
        <td class="px-4 py-3 text-[13px]">${escapeHtml(refundedViaLabel(b.refundedVia))}</td>
        <td class="px-4 py-3 text-[14px] font-mono font-semibold text-right">${Number(b.totalPrice || 0)} ${t('common.lei')}</td>
        <td class="px-4 py-3">${emailStatusBadge(b.refundEmail)}</td>
        <td class="px-4 py-3 text-right">
          <button type="button" data-resend-email="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}" class="${failed ? 'bg-mango hover:bg-mango-hover text-charcoal' : 'bg-frost hover:bg-frost-deep text-charcoal/80'} font-semibold text-[12px] px-3 py-1.5 rounded-lg transition-colors">${t('refunds.resendEmail')}</button>
        </td>
      </tr>
    `;
  };

  const historyHtml = history.length === 0 ? '' : `
    <section class="mt-12">
      <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 class="font-heading text-2xl font-bold tracking-tight text-blueberry-deep">${t('refunds.historyTitle')}</h2>
          <p class="text-dim text-[13px] mt-1">${t('refunds.historySubtitle', { days: HISTORY_DAYS, count: history.length })}</p>
        </div>
        ${failedCount > 0 ? `<span class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded-full"><span class="inline-block w-1.5 h-1.5 rounded-full bg-red-500"></span>${t('refunds.failedCount', { count: failedCount })}</span>` : ''}
      </div>
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('refunds.code')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.plate')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.customer')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.refundedAt')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.refundedVia')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.amount')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.emailStatus')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.actions')}</th>
              </tr>
            </thead>
            <tbody>${history.map(historyRowHtml).join('')}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  const partialRowHtml = (b) => {
    const code = bookingDisplayCode(b);
    const amt = Number(b.pendingRefundAmount || 0);
    return `
      <tr class="border-t border-frost-deep">
        <td class="px-4 py-3 text-[13px]">${reservationCodeHtml(b)}</td>
        <td class="px-4 py-3 text-[13px] font-mono">${escapeHtml(b.licensePlate || '—')}</td>
        <td class="px-4 py-3 text-[13px]">${userNameButton({ customerId: b.customerId, email: b.contact?.email, name: b.contact?.name || b.contact?.email })}</td>
        <td class="px-4 py-3 text-[13px] text-dim">${escapeHtml(paidByLabel(b.paidBy))}</td>
        <td class="px-4 py-3 text-[14px] font-mono font-semibold text-right">${amt} ${t('common.lei')}</td>
        <td class="px-4 py-3 text-right">
          <button type="button" data-resolve-checkout-refund="${escapeHtml(b.id)}" data-paidby="${escapeHtml(b.paidBy || '')}" data-amount="${amt}" data-code="${escapeHtml(code)}" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[12px] px-3 py-1.5 rounded-lg transition-colors">${t('refunds.markRefunded')}</button>
        </td>
      </tr>`;
  };

  const partialHtml = partial.length === 0 ? '' : `
    <section class="mt-12">
      <div class="mb-4">
        <h2 class="font-heading text-2xl font-bold tracking-tight text-blueberry-deep">${t('refunds.partialTitle')}</h2>
        <p class="text-dim text-[13px] mt-1">${t('refunds.partialSubtitle')}</p>
      </div>
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('refunds.code')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.plate')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.customer')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.paidVia')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.amount')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.actions')}</th>
              </tr>
            </thead>
            <tbody>${partial.map(partialRowHtml).join('')}</tbody>
          </table>
        </div>
      </div>
    </section>`;

  const tableHtml = pending.length === 0
    ? `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('refunds.emptyQueue')}</div>`
    : `
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('refunds.code')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.plate')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.customer')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.cancelledAt')}</th>
                <th class="px-4 py-3 font-medium">${t('refunds.paidVia')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.amount')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('refunds.actions')}</th>
              </tr>
            </thead>
            <tbody>${pending.map((b) => rowHtml(b, locale)).join('')}</tbody>
          </table>
        </div>
      </div>
    `;

  const content = `
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('refunds.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('refunds.subtitle')}</p>
      </div>
      <div class="text-right">
        <p class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('refunds.totalPending')}</p>
        <p class="font-mono font-bold text-2xl text-mango">${totalAmount} ${t('common.lei')}</p>
        <p class="text-[12px] text-dim mt-1">${pending.length} ${pending.length === 1 ? t('refunds.bookingSingular') : t('refunds.bookingPlural')}</p>
      </div>
    </div>

    <div class="bg-mango/5 border border-mango/30 rounded-2xl px-5 py-4 mb-6 text-[13px] text-charcoal/80">
      <p class="font-semibold text-charcoal mb-1">${t('refunds.howToTitle')}</p>
      <ol class="list-decimal list-inside space-y-0.5">
        <li>${t('refunds.howToStep1')}</li>
        <li>${t('refunds.howToStep2')}</li>
        <li>${t('refunds.howToStep3')}</li>
      </ol>
    </div>

    ${tableHtml}

    ${partialHtml}

    ${historyHtml}
  `;

  const page = AdminLayout('/admin/refunds', content);
  initAdminNav(page);
  wireUserLinks(page);
  // Refund rows are all historical (cancelled / refund-pending / refunded), so
  // the reservation code opens the read-only detail modal rather than the
  // check-in page (which has no row for them).
  wireReservationLinks(page, (id) => [...pending, ...partial, ...history].find((b) => b.id === id));
  container.appendChild(page);

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mark-refunded]');
    if (!btn || btn.disabled) return;
    const bookingId = btn.dataset.markRefunded;
    const paidBy = btn.dataset.paidby;
    const code = btn.dataset.code;
    const amount = btn.dataset.amount;
    await openMarkRefundedDialog({ bookingId, paidBy, code, amount });
  });

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-resend-email]');
    if (!btn || btn.disabled) return;
    const bookingId = btn.dataset.resendEmail;
    const code = btn.dataset.code;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = t('common.loading');
    try {
      const res = await adminResendRefundEmailFn({ bookingId });
      const recipient = res?.data?.recipient || '';
      showToast(t('refunds.resendOk', { code, recipient }), 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error('adminResendRefundEmail', err);
      showToast(err?.message || t('common.error'), 'error');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  // Resolve a partial refund owed from a check-out-date shortening. The money
  // movement is manual (like the main queue); this just clears the flag + audits.
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-resolve-checkout-refund]');
    if (!btn || btn.disabled) return;
    const bookingId = btn.dataset.resolveCheckoutRefund;
    const paidBy = btn.dataset.paidby;
    const amount = btn.dataset.amount;
    const code = btn.dataset.code;
    const ok = await confirmModal(t('refunds.partialConfirm', { amount, code }), { confirmText: t('refunds.markRefunded') });
    if (!ok) return;
    btn.disabled = true;
    try {
      await adminResolvePendingRefundFn({ bookingId, refundedVia: suggestedVia(paidBy) });
      showToast(t('refunds.partialResolved', { amount }), 'success');
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      console.error('adminResolvePendingRefund', err);
      showToast(err?.message || t('common.error'), 'error');
      btn.disabled = false;
    }
  });
}

function openMarkRefundedDialog({ bookingId, paidBy, code, amount }) {
  return new Promise((resolve) => {
    const defaultVia = suggestedVia(paidBy);
    const form = html`<form class="space-y-4" data-refund-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('refunds.confirmTitle')}</h3>
      <div class="bg-frost rounded-xl px-4 py-3 text-[13px]">
        <div class="flex justify-between"><span class="text-dim">${t('refunds.code')}</span><span class="font-mono">${escapeHtml(code)}</span></div>
        <div class="flex justify-between mt-1"><span class="text-dim">${t('refunds.amount')}</span><span class="font-mono font-semibold">${amount} ${t('common.lei')}</span></div>
        <div class="flex justify-between mt-1"><span class="text-dim">${t('refunds.paidVia')}</span><span>${escapeHtml(paidByLabel(paidBy))}</span></div>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('refunds.refundedVia')} *</label>
        <div class="space-y-2">
          <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-frost-deep cursor-pointer hover:bg-frost/50">
            <input type="radio" name="refundedVia" value="netopia-panel" ${defaultVia === 'netopia-panel' ? 'checked' : ''} class="accent-mango">
            <span class="text-[14px]">${t('refunds.viaNetopiaPanel')}</span>
          </label>
          <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-frost-deep cursor-pointer hover:bg-frost/50">
            <input type="radio" name="refundedVia" value="cash-returned" ${defaultVia === 'cash-returned' ? 'checked' : ''} class="accent-mango">
            <span class="text-[14px]">${t('refunds.viaCash')}</span>
          </label>
          <label class="flex items-center gap-2 px-3 py-2 rounded-lg border border-frost-deep cursor-pointer hover:bg-frost/50">
            <input type="radio" name="refundedVia" value="card-terminal" ${defaultVia === 'card-terminal' ? 'checked' : ''} class="accent-mango">
            <span class="text-[14px]">${t('refunds.viaCardTerminal')}</span>
          </label>
        </div>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('refunds.notesOptional')}</label>
        <input name="notes" type="text" placeholder="${escapeHtml(t('refunds.notesPlaceholder'))}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry">
      </div>

      <p class="text-[12px] text-dim">${t('refunds.confirmHint')}</p>

      <button type="submit" class="w-full bg-leaf hover:bg-leaf/90 text-white font-semibold text-[15px] py-3 rounded-xl transition-colors">${t('refunds.confirmButton')}</button>
    </form>`;
    const modal = openModal(form, { onClose: () => resolve() });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const refundedVia = form.refundedVia.value;
      const notes = form.notes.value.trim();
      if (!refundedVia) {
        showToast(t('common.error'), 'error');
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('common.loading');
      try {
        await adminMarkRefundedFn({ bookingId, refundedVia, notes });
        showToast(t('refunds.markedToast'), 'success');
        modal.close();
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        console.error('adminMarkRefunded', err);
        showToast(err?.message || t('common.error'), 'error');
        btn.disabled = false;
        btn.textContent = t('refunds.confirmButton');
      }
    });
  });
}
