// Reservation detail modal — a focused, read-only view of one booking.
//
// Opened by clicking a reservation number/code. Shows the reservation data plus
// WHO created it and when ("Reservation made by Oana on <date>") — resolving the
// creator's uid to a name — and links through to the customer's profile (the
// shared user-detail modal). Reusable anywhere a booking object is on hand.

import { html, qs, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { openModal } from '../core/Modal.js';
import { getDocument } from '../../firebase/db.js';
import { openUserDetail } from './UserDetailModal.js';
import { invoicePdfLink } from '../../services/invoiceService.js';

function fmt(iso, locale) {
  if (!iso) return '—';
  const dateOnly = typeof iso === 'string' && iso.length <= 10;
  try {
    const d = new Date(dateOnly ? iso + 'T00:00:00' : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: 'short', year: 'numeric',
      ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit' }),
      timeZone: 'Europe/Bucharest',
    });
  } catch { return String(iso); }
}

const STATUS_CLS = {
  upcoming: 'bg-blueberry/10 text-blueberry',
  active: 'bg-leaf/10 text-leaf',
  completed: 'bg-charcoal/10 text-charcoal/70',
  cancelled: 'bg-red-100 text-red-600',
  'no-show': 'bg-red-100 text-red-600',
  paid: 'bg-leaf/10 text-leaf',
  unpaid: 'bg-mango/10 text-mango',
  'refund-pending': 'bg-mango/10 text-mango',
  refunded: 'bg-charcoal/10 text-charcoal/70',
};
function badge(value) {
  if (!value) return '';
  const cls = STATUS_CLS[value] || 'bg-charcoal/10 text-charcoal/70';
  return `<span class="inline-block text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full ${cls}">${escapeHtml(value)}</span>`;
}

function row(label, valueHtml) {
  if (valueHtml == null || valueHtml === '' || valueHtml === '—') return '';
  return `<div class="flex justify-between gap-4 py-1.5 border-b border-frost-deep/60 last:border-0">
    <span class="text-[13px] text-dim shrink-0">${escapeHtml(label)}</span>
    <span class="text-[13px] text-charcoal text-right break-words min-w-0">${valueHtml}</span>
  </div>`;
}

// "Reservation made by {name} on {date}" — resolves the creator uid to a name.
// A booking's `createdBy` is only ever written by the staff-only
// adminCreateLongtermBooking callable, so whoever it points to IS a staff
// member: resolve their uid to a name with NO role gating (gating on the role
// field was too strict — a legacy/changed/missing role dropped a legitimate
// creator to the generic "made by staff" label). Only fall back to the source
// when there's no createdBy, or the account no longer resolves to a name.
async function creatorLine(b, locale) {
  const when = fmt(b.createdAt, locale);
  if (b.createdBy) {
    const u = await getDocument('users', b.createdBy).catch(() => null);
    const name = u && (u.displayName || u.email);
    if (name) return t('bookingDetail.madeByStaff', { name, date: when });
    return t('bookingDetail.madeByStaffGeneric', { date: when });
  }
  if (b.source === 'admin' || b.source === 'broker' || b.paidBy === 'admin-cash' || b.paidBy === 'admin-card') {
    return t('bookingDetail.madeByStaffGeneric', { date: when });
  }
  return t('bookingDetail.madeOnline', { date: when });
}

// SmartBill document links for the row() list — invoice (+ number), storno,
// and the proforma while it still exists. Empty string → row() hides itself.
function smartbillLinks(b) {
  const esc = escapeHtml;
  const sb = b.smartbill || {};
  const link = (doc, label, blk) =>
    `<a href="${esc(invoicePdfLink({ bookingId: b.id, doc }))}" target="_blank" rel="noopener" class="text-blueberry hover:underline">${esc(label)} <span class="font-mono">${esc(String(blk.series || ''))}${esc(String(blk.number || ''))}</span></a>`;
  return [
    sb.invoice?.number ? link('invoice', t('invoice.download'), sb.invoice) : '',
    sb.storno?.number ? link('storno', t('invoice.downloadStorno'), sb.storno) : '',
    (sb.proforma?.number && !sb.proformaDeleted) ? link('proforma', t('invoice.downloadProforma'), sb.proforma) : '',
  ].filter(Boolean).join(' · ');
}

export function openBookingDetail(booking) {
  const b = booking || {};
  const locale = getLocale();
  const esc = escapeHtml;
  const typeLabel = b.type === 'credit' ? t('bookingDetail.typeCredit')
    : b.type === 'longTerm' ? t('bookingDetail.typeLongterm')
    : (b.type || '—');
  const start = b.dropoffAt || b.startDate;
  const end = b.pickupAt || b.endDate;
  const period = start ? `${fmt(start, locale)} → ${fmt(end, locale)}` : '';
  const hasCustomerRef = !!(b.customerId || b.contact?.email);
  const customerVal = hasCustomerRef
    ? `<button type="button" data-view-customer class="text-blueberry hover:underline text-right">${esc(b.contact?.name || b.contact?.email || '—')}</button>`
    : esc(b.contact?.name || '—');

  const body = html`
    <div>
      <div class="flex items-start justify-between gap-4 mb-4">
        <div class="min-w-0">
          <h2 class="font-heading text-xl font-bold text-blueberry-deep">${t('bookingDetail.title')}</h2>
          <p class="text-[13px] text-dim font-mono mt-0.5">${esc(b.code || b.id || '—')}</p>
        </div>
        <button type="button" data-close class="w-9 h-9 rounded-xl bg-frost hover:bg-frost-deep text-charcoal/70 flex items-center justify-center transition-colors shrink-0" aria-label="${esc(t('common.close'))}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="rounded-xl bg-frost border border-frost-deep px-4 py-3 mb-4">
        <p data-creator class="text-[13px] text-charcoal">${esc(t('common.loading'))}</p>
      </div>

      <div>
        ${row(t('bookingDetail.customer'), customerVal)}
        ${row(t('bookingDetail.phone'), b.contact?.phone ? `<a href="tel:${esc(b.contact.phone)}" class="text-blueberry hover:underline">${esc(b.contact.phone)}</a>` : '')}
        ${row(t('bookingDetail.email'), b.contact?.email ? esc(b.contact.email) : '')}
        ${row(t('bookingDetail.plate'), `<span class="font-mono">${esc(b.licensePlate || '—')}</span>`)}
        ${row(t('bookingDetail.passengers'), b.passengers != null ? String(b.passengers) : '')}
        ${row(t('bookingDetail.type'), esc(typeLabel))}
        ${row(t('bookingDetail.period'), esc(period))}
        ${row(t('bookingDetail.flightDropoff'), b.flightNumberDropoff ? `<span class="font-mono">${esc(b.flightNumberDropoff)}</span>` : '')}
        ${row(t('bookingDetail.flightPickup'), b.flightNumberPickup ? `<span class="font-mono">${esc(b.flightNumberPickup)}</span>` : '')}
        ${row(t('bookingDetail.status'), badge(b.status))}
        ${row(t('bookingDetail.payment'), badge(b.paymentStatus))}
        ${row(t('bookingDetail.total'), b.totalPrice != null ? `${Number(b.totalPrice)} ${esc(t('common.lei'))}` : '')}
        ${row(t('bookingDetail.checkedIn'), b.checkinTimestamp ? esc(fmt(b.checkinTimestamp, locale)) : '')}
        ${row(t('bookingDetail.checkedOut'), b.completedAt ? esc(fmt(b.completedAt, locale)) : '')}
        ${row(t('invoice.documents'), smartbillLinks(b))}
        ${b.notes ? row(t('bookingDetail.notes'), esc(b.notes)) : ''}
      </div>

      ${hasCustomerRef ? `<div class="mt-5 flex justify-end">
        <button type="button" data-view-customer class="text-[13px] text-blueberry hover:underline font-semibold">${esc(t('bookingDetail.viewCustomer'))}</button>
      </div>` : ''}
    </div>
  `;

  const { close, contentEl } = openModal(body);
  qs('[data-close]', contentEl)?.addEventListener('click', close);

  creatorLine(b, locale).then((line) => {
    const el = qs('[data-creator]', contentEl);
    if (el) el.textContent = line;
  }).catch(() => { /* leave the loading text */ });

  contentEl.querySelectorAll('[data-view-customer]').forEach((btn) => {
    btn.addEventListener('click', () => {
      close();
      openUserDetail({ customerId: b.customerId || null, email: b.contact?.email || null, displayName: b.contact?.name || '' });
    });
  });
}
