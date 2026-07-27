// Admin → reservation detail (/admin/transactions?booking=<id>).
//
// The full record behind a booking: every stored field grouped into cards, the
// money broken out (including what was ACTUALLY charged, read off the linked
// pendingOrders doc — booking.totalPrice is the gross), the fiscal trail, and
// the reservation's own history from auditLog. Actions run through the shared
// bookingActions module, so the check-in board and this page can never drift.
//
// Reached from the reservations tab and from any reservation code (see
// reservationLink.js). The router matches on path only, so this lives behind
// the /admin/transactions route entry — no router change, sidebar stays lit.

import { delegate, escapeHtml, qs } from '../../utils/dom.js';
import { t, getLocale, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getDocument } from '../../firebase/db.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { actionStyle, actionLabel, describeAction, fmtAuditTime } from '../../components/admin/auditFormat.js';
import { runBookingAction, fmtDateTime, perCreditPrice, overstayInfo, reservationStatusLabel } from '../../components/admin/bookingActions.js';
import { listEntityAudit, resolveActorLabel } from '../../services/auditService.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { showToast } from '../../components/core/Toast.js';
import { getUserProfile } from '../../firebase/auth.js';
import { hasPermission, PERM } from '../../utils/permissions.js';
import { copyText } from '../../utils/clipboard.js';
import { bookingDisplayCode } from '../../utils/bookingCode.js';

// ── Small render helpers ─────────────────────────────────────────────────

function card(title, rowsHtml, extra = '') {
  if (!rowsHtml.trim()) return '';
  return `
    <section class="bg-white rounded-2xl border border-frost-deep p-5">
      <h3 class="font-heading text-[13px] font-bold text-blueberry-deep uppercase tracking-wider mb-3">${escapeHtml(title)}</h3>
      <dl class="space-y-1.5">${rowsHtml}</dl>
      ${extra}
    </section>`;
}

// A label/value line. Empty values are dropped so a card only shows what the
// booking actually carries — a broker row has no billing, a web row no ParkVia.
function row(label, value, { mono = false, copy = null } = {}) {
  if (value == null || value === '' || value === '—') return '';
  const copyBtn = copy
    ? `<button type="button" data-copy="${escapeHtml(copy)}" title="${escapeHtml(t('reservations.copy'))}" class="ml-1.5 align-middle text-dim hover:text-blueberry transition-colors"><svg class="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V5a2 2 0 012-2h7a2 2 0 012 2v9a2 2 0 01-2 2h-2M5 8h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2z"/></svg></button>`
    : '';
  return `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1 border-b border-frost-deep/50 last:border-0">
      <dt class="text-[12px] font-mono uppercase tracking-wider text-dim min-w-[9rem]">${escapeHtml(label)}</dt>
      <dd class="text-[14px] text-charcoal flex-1 min-w-0 ${mono ? 'font-mono' : ''}">${escapeHtml(String(value))}${copyBtn}</dd>
    </div>`;
}

function money(n) {
  return n == null || n === '' ? '' : `${Number(n)} ${t('common.lei')}`;
}

const BADGES = {
  upcoming: 'bg-mango/15 text-charcoal', active: 'bg-leaf/10 text-leaf',
  completed: 'bg-blue-100 text-blue-600', cancelled: 'bg-red-100 text-red-500',
  'no-show': 'bg-red-100 text-red-500', paid: 'bg-leaf/10 text-leaf',
  unpaid: 'bg-mango/15 text-charcoal', 'refund-pending': 'bg-mango/15 text-charcoal',
  refunded: 'bg-blue-100 text-blue-600',
};
function badge(v) {
  if (!v) return '';
  return `<span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${BADGES[v] || 'bg-gray-100 text-gray-600'}">${escapeHtml(reservationStatusLabel(v))}</span>`;
}

// ── Edit-history diff ────────────────────────────────────────────────────
// booking_edited rows record the BEFORE values of exactly the keys that
// changed (bookingService.updateBookingDetails), so the timeline can show
// each edit as "field: old → new" instead of only naming what changed.

// updatedAt is noise; startDate/endDate mirror dropoffAt/pickupAt in the patch.
const EDIT_SKIP = new Set(['updatedAt', 'startDate', 'endDate']);

function editFieldLabel(k) {
  const map = {
    'contact.name': t('reservations.customer'),
    'contact.email': t('reservations.email'),
    'contact.phone': t('reservations.phone'),
    licensePlate: t('reservations.plate'),
    dropoffAt: t('reservations.dropoff'),
    pickupAt: t('reservations.pickup'),
    days: t('reservations.days'),
    notes: t('reservations.notes'),
  };
  return map[k] || k;
}

function editValue(k, v, locale) {
  if (v == null || v === '') return '—';
  if (k === 'dropoffAt' || k === 'pickupAt') return fmtDateTime(v, locale);
  return String(v);
}

function editChanges(h, locale) {
  const oldV = h.oldValueObj || {};
  const newV = h.newValueObj || {};
  const out = [];
  for (const k of Object.keys(newV)) {
    if (EDIT_SKIP.has(k)) continue;
    if (k === 'contact') {
      for (const sub of ['name', 'email', 'phone']) {
        const from = oldV.contact?.[sub] ?? '';
        const to = newV.contact?.[sub] ?? '';
        if (String(from) !== String(to)) {
          out.push({ label: editFieldLabel(`contact.${sub}`), from: editValue(sub, from, locale), to: editValue(sub, to, locale) });
        }
      }
      continue;
    }
    const from = oldV[k];
    const to = newV[k];
    if (String(from ?? '') === String(to ?? '')) continue;
    out.push({ label: editFieldLabel(k), from: editValue(k, from, locale), to: editValue(k, to, locale) });
  }
  return out;
}

// Plain-text block for pasting into WhatsApp / a phone call.
function summaryText(b, locale) {
  const lines = [
    `${t('reservations.code')}: ${bookingDisplayCode(b)}`,
    `${t('reservations.customer')}: ${b.contact?.name || '—'}`,
    b.contact?.phone ? `${t('reservations.phone')}: ${b.contact.phone}` : null,
    b.contact?.email ? `${t('reservations.email')}: ${b.contact.email}` : null,
    `${t('reservations.plate')}: ${b.licensePlate || '—'}`,
    `${t('reservations.dropoff')}: ${fmtDateTime(b.dropoffAt || b.startDate, locale)}`,
    `${t('reservations.pickup')}: ${fmtDateTime(b.pickupAt || b.endDate, locale)}`,
    b.totalPrice != null ? `${t('reservations.total')}: ${b.totalPrice} ${t('common.lei')}` : null,
    `${t('reservations.statusLabel')}: ${reservationStatusLabel(b.status)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export default async function AdminReservationDetail(container, { bookingId } = {}) {
  const locale = getLocale();
  const id = bookingId || new URLSearchParams(window.location.search).get('booking') || '';
  const canCancel = hasPermission(getUserProfile()?.role, PERM.REFUNDS);

  let booking = await getDocument('bookings', id).catch(() => null);
  updateMeta({ title: `${(booking && bookingDisplayCode(booking)) || t('reservations.title')} — Admin — ManGO Parking` });

  const backLink = `<a href="${localePath('/admin/transactions?tab=reservations')}" data-link class="inline-flex items-center gap-1.5 text-[14px] font-semibold text-blueberry hover:underline mb-4">‹ ${escapeHtml(t('reservations.title'))}</a>`;

  if (!booking) {
    const missing = AdminLayout('/admin/transactions', `${backLink}
      <div class="card-solid rounded-2xl p-10 text-center text-dim">${escapeHtml(t('reservations.notFound'))}</div>`);
    initAdminNav(missing);
    container.appendChild(missing);
    return;
  }

  const pageEl = AdminLayout('/admin/transactions', `${backLink}
    <div data-detail></div>`);
  const detailEl = qs('[data-detail]', pageEl);

  // Side data: the order (what was actually charged) + this booking's history.
  let order = null;
  let history = [];
  let creditPerDay = 0;
  let createdByLabel = '';

  async function loadSideData() {
    const [ord, hist, packs] = await Promise.all([
      booking.paymentId ? getDocument('pendingOrders', booking.paymentId).catch(() => null) : Promise.resolve(null),
      // Shaped like every other audit surface (actors resolved, value objects
      // unified) — raw docs rendered generic labels and an empty "who" column.
      listEntityAudit(id),
      getTokenPacks().catch(() => []),
    ]);
    order = ord;
    history = hist;
    creditPerDay = perCreditPrice(packs);

    // Who created the booking: the booking_created audit row's actor when one
    // exists (admin / broker / client rows all carry one), else the server-
    // stamped createdBy uid, else the source channel ("Site" ≙ the customer).
    const createdRow = history.find((h) => ['booking_created', 'create'].includes(h.action));
    const rowActor = createdRow?.user && createdRow.user !== 'anonymous' ? createdRow.user : '';
    createdByLabel = rowActor
      || (booking.createdBy ? await resolveActorLabel(booking.createdBy) : '')
      || t(`reservations.source.${booking.source || 'web'}`);
  }

  function actionsHtml() {
    const b = booking;
    const btn = (key, label, variant = 'neutral') => {
      const styles = {
        neutral: 'bg-white border border-frost-deep hover:bg-frost text-charcoal',
        primary: 'bg-leaf hover:bg-leaf/90 text-white',
        warning: 'bg-mango hover:bg-mango-hover text-charcoal',
        danger: 'bg-red-100 hover:bg-red-200 text-red-700',
      };
      return `<button type="button" data-action="${key}" data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(bookingDisplayCode(b))}" data-order="${escapeHtml(b.paymentId || '')}" class="${styles[variant]} font-semibold text-[13px] px-4 py-2 rounded-xl transition-colors">${escapeHtml(label)}</button>`;
    };
    const out = [];
    if (b.status === 'upcoming') out.push(btn('checkin', t('checkins.actionCheckIn'), 'primary'));
    if (b.status === 'active') out.push(btn('checkout', t('checkins.actionCheckOut'), 'primary'));
    if (b.paymentStatus === 'unpaid' && b.paymentId) out.push(btn('collect', t('checkins.actionCollect'), 'warning'));
    if (['upcoming', 'active'].includes(b.status)) out.push(btn('edit', t('checkins.actionEdit')));
    if (b.status === 'active') out.push(btn('overstay', t('checkins.actionChargeOverstay')));
    if (b.status === 'upcoming') out.push(btn('resend-email', t('checkins.resendEmail')));
    if (canCancel && ['upcoming', 'active'].includes(b.status)) out.push(btn('cancel', t('checkins.actionCancelReservation'), 'danger'));
    return out.join('');
  }

  function render() {
    const b = booking;
    const isCredit = b.type === 'credit';
    const charged = order?.amount;
    const over = overstayInfo(b, creditPerDay);

    detailEl.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep font-mono">${escapeHtml(bookingDisplayCode(b))}</h1>
            ${badge(b.status)} ${badge(b.paymentStatus)}
          </div>
          <p class="text-dim text-[15px] mt-1">${escapeHtml(isCredit ? t('checkins.typeCommuter') : t('checkins.typeLongTerm'))} · ${escapeHtml(t(`reservations.source.${b.source || 'web'}`) || b.source || '')}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" data-copy-summary class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[13px] px-4 py-2 rounded-xl transition-colors">${escapeHtml(t('reservations.copySummary'))}</button>
          ${actionsHtml()}
        </div>
      </div>

      <div class="grid lg:grid-cols-2 gap-4 mb-4">
        ${card(t('reservations.cardCustomer'), [
          row(t('reservations.customer'), b.contact?.name, { copy: b.contact?.name }),
          row(t('reservations.phone'), b.contact?.phone, { mono: true, copy: b.contact?.phone }),
          row(t('reservations.email'), b.contact?.email, { mono: true, copy: b.contact?.email }),
          row(t('reservations.plate'), b.licensePlate, { mono: true, copy: b.licensePlate }),
          row(t('reservations.account'), b.customerId ? t('reservations.registered') : t('reservations.guest')),
        ].join(''))}

        ${card(t('reservations.cardStay'), [
          row(t('reservations.dropoff'), fmtDateTime(b.dropoffAt || b.startDate, locale)),
          row(t('reservations.pickup'), fmtDateTime(b.pickupAt || b.endDate, locale)),
          row(t('reservations.days'), b.days),
          row(t('reservations.spot'), b.spotId, { mono: true }),
          row(t('reservations.checkedIn'), b.checkinTimestamp ? fmtDateTime(b.checkinTimestamp, locale) : ''),
          row(t('reservations.checkedOut'), b.completedAt || b.checkoutTimestamp ? fmtDateTime(b.completedAt || b.checkoutTimestamp, locale) : ''),
          row(t('reservations.passengers'), b.passengers),
          row(t('reservations.flightDropoff'), b.flightNumberDropoff, { mono: true }),
          row(t('reservations.flightPickup'), b.flightNumberPickup, { mono: true }),
          over && over.amount > 0 && !b.overstayChargedAt ? row(t('reservations.overstayDue'), money(over.amount)) : '',
        ].join(''))}

        ${card(t('reservations.cardMoney'), [
          row(t('reservations.total'), money(b.totalPrice)),
          // The booking carries the GROSS; the order carries what was charged
          // after the online discount and any voucher. Showing both is the
          // difference between refunding correctly and over-refunding.
          charged != null && Number(charged) !== Number(b.totalPrice) ? row(t('reservations.charged'), money(charged)) : '',
          order?.voucherAmount ? row(t('reservations.voucher'), `${order.promoVoucherCode || ''} −${money(order.voucherAmount)}`) : '',
          row(t('reservations.basePrice'), money(b.basePrice)),
          b.latePrice ? row(t('reservations.latePrice'), money(b.latePrice)) : '',
          b.extensionPrice ? row(t('reservations.extensionPrice'), money(b.extensionPrice)) : '',
          b.extensionOwed ? row(t('reservations.extensionOwed'), money(b.extensionOwed)) : '',
          b.pendingRefundAmount ? row(t('reservations.pendingRefund'), `${money(b.pendingRefundAmount)}${b.pendingRefundReason ? ` — ${b.pendingRefundReason}` : ''}`) : '',
          b.checkoutRefundedAmount ? row(t('reservations.refundedAmount'), money(b.checkoutRefundedAmount)) : '',
        ].join(''))}

        ${card(t('reservations.cardPayment'), [
          row(t('reservations.method'), b.paymentMethod),
          row(t('reservations.paidBy'), b.paidBy),
          row(t('reservations.paidAt'), b.paidAt ? fmtDateTime(b.paidAt, locale) : ''),
          row(t('reservations.orderId'), b.paymentId, { mono: true, copy: b.paymentId }),
          row(t('reservations.refundedAt'), b.refundedAt ? fmtDateTime(b.refundedAt, locale) : ''),
          row(t('reservations.refundedVia'), b.refundedVia),
          row(t('reservations.refundNotes'), b.refundNotes),
          // Fiscal trail — until now there was no way to tell from the app
          // whether SmartBill issued anything for a reservation.
          row(t('reservations.proforma'), b.smartbill?.proforma ? `${b.smartbill.proforma.series} ${b.smartbill.proforma.number}` : ''),
          row(t('reservations.invoice'), b.smartbill?.invoice ? `${b.smartbill.invoice.series} ${b.smartbill.invoice.number}` : ''),
          row(t('reservations.storno'), b.smartbill?.storno ? `${b.smartbill.storno.series} ${b.smartbill.storno.number ?? ''}` : ''),
          row(t('reservations.fiscalStatus'), b.smartbill?.status),
          row(t('reservations.fiscalError'), b.smartbill?.lastError),
        ].join(''))}

        ${card(t('reservations.cardBilling'), [
          row(t('reservations.billingType'), b.billing?.type),
          row(t('reservations.billingName'), b.billing?.name || b.billing?.companyName),
          row(t('reservations.billingCui'), b.billing?.cui, { mono: true, copy: b.billing?.cui }),
          row(t('reservations.billingRegCom'), b.billing?.regCom, { mono: true }),
          row(t('reservations.billingAddress'), b.billing?.address || b.billing?.companyAddress),
          row(t('reservations.billingLocality'), b.billing?.locality),
        ].join(''))}

        ${card(t('reservations.cardOps'), [
          row(t('reservations.broker'), b.brokerName),
          row(t('reservations.parkviaRef'), b.parkvia?.ref, { mono: true, copy: b.parkvia?.ref }),
          row(t('reservations.parkviaStatus'), b.parkvia?.lastStatus),
          row(t('reservations.parkviaNoShow'), b.parkvia?.noShowReportedAt ? fmtDateTime(b.parkvia.noShowReportedAt, locale) : ''),
          row(t('reservations.noShowAt'), b.noShowAt ? fmtDateTime(b.noShowAt, locale) : ''),
          row(t('reservations.createdAt'), b.createdAt ? fmtDateTime(b.createdAt, locale) : ''),
          row(t('reservations.createdBy'), createdByLabel),
          row(t('reservations.confirmEmail'), b.confirmEmailSentAt ? fmtDateTime(b.confirmEmailSentAt, locale) : ''),
          row(t('reservations.reminderCheckin'), b.reminderCheckinSentAt ? fmtDateTime(b.reminderCheckinSentAt, locale) : ''),
          row(t('reservations.reminderCheckout'), b.reminderCheckoutSentAt ? fmtDateTime(b.reminderCheckoutSentAt, locale) : ''),
          row(t('reservations.notes'), b.notes),
        ].join(''))}
      </div>

      <h2 class="font-heading font-bold text-lg text-charcoal mb-3">${escapeHtml(t('reservations.historyTitle'))}</h2>
      ${history.length ? `
        <div class="card-solid rounded-2xl overflow-hidden">
          <div class="divide-y divide-frost-deep/60">
            ${history.map((h) => {
              const changes = h.action === 'booking_edited' ? editChanges(h, locale) : [];
              return `
              <div class="px-6 py-3.5">
                <div class="flex flex-wrap items-center gap-3">
                  <span class="font-mono text-[12px] text-dim w-28 shrink-0">${escapeHtml(fmtAuditTime(h.timestamp, locale))}</span>
                  <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${actionStyle(h.action)}">${escapeHtml(actionLabel(h.action))}</span>
                  <span class="text-[14px] text-charcoal/80 flex-1 min-w-0">${escapeHtml(describeAction(h, locale, bookingDisplayCode(b)))}</span>
                  <span class="text-[12px] text-dim font-mono shrink-0 hidden sm:inline" title="${escapeHtml(h.user || '')}">${escapeHtml((h.user || '').split('@')[0])}</span>
                </div>
                ${changes.length ? `
                <div class="mt-1.5 sm:pl-[7.75rem] space-y-0.5">
                  ${changes.map((c) => `<div class="text-[13px] text-charcoal/60"><span class="font-semibold text-charcoal/80">${escapeHtml(c.label)}:</span> <span class="line-through decoration-charcoal/40">${escapeHtml(c.from)}</span> → <span class="text-charcoal">${escapeHtml(c.to)}</span></div>`).join('')}
                </div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`
      : `<div class="card-solid rounded-2xl p-8 text-center text-dim">${escapeHtml(t('reservations.noHistory'))}</div>`}
    `;
  }

  // ── Events ───────────────────────────────────────────────────────────────
  delegate(pageEl, 'click', '[data-copy]', (_e, btn) => {
    copyText(btn.dataset.copy, t('reservations.copied'));
  });
  delegate(pageEl, 'click', '[data-copy-summary]', () => {
    copyText(summaryText(booking, locale), t('reservations.copiedSummary'));
  });
  delegate(pageEl, 'click', '[data-action]', async (_e, btn) => {
    btn.disabled = true;
    try {
      await runBookingAction(
        { action: btn.dataset.action, booking, dataset: btn.dataset },
        {
          locale,
          creditPerDay,
          // No live subscription here — re-read the booking and its history so
          // the card values and the timeline reflect what just happened.
          onDone: async () => {
            const fresh = await getDocument('bookings', id).catch(() => null);
            if (fresh) booking = fresh;
            await loadSideData();
            render();
          },
        },
      );
    } catch (err) {
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  initAdminNav(pageEl);
  container.appendChild(pageEl);
  render();
  await loadSideData();
  render();
}
