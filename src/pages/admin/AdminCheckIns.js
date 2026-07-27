// Admin Check-in / Check-out — v1.7 redesign.
//
// Three tabs, each scoped to a specific workflow:
//   1. Check-in — upcoming bookings whose drop-off falls inside the
//      selected window (today / this week / this month). Per-row
//      action: Check-in. Plus Cancel reservation (admin/agent) and
//      Collect payment (when unpaid).
//   2. Check-out — active bookings whose pick-up falls inside the
//      selected window. Per-row action: Check-out.
//   3. Overdue — all active bookings past their pick-up by ≥2 hours.
//      Rows expand on click to show full booking details + actions
//      (Check-out now / Charge overstay / Cancel reservation).
//
// Top of page: a Walk-in CTA that opens the shared create-transaction
// modal (lifted from AdminTransactions), and a quick plate-lookup bar
// for the fast path when an agent knows the plate.
//
// No-show is detected automatically by the `markNoShows` scheduled
// function. No manual UI for it — rows simply drop off the Check-in
// tab when their status flips.

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { delegate, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeCollection, getCollection } from '../../firebase/db.js';
import { showToast } from '../../components/core/Toast.js';
import { confirmModal } from '../../components/core/Modal.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { getUserProfile } from '../../firebase/auth.js';
import { hasPermission, PERM } from '../../utils/permissions.js';
import { bookingDisplayCode } from '../../utils/bookingCode.js';
import { openCreateTransactionModal } from '../../components/admin/CreateTransactionModal.js';
import {
  fmtDateTime, pickupDeadlineMs, perCreditPrice, paymentStatusBadge,
  typeBadge, runBookingAction,
} from '../../components/admin/bookingActions.js';
import { parkviaSyncNow } from '../../services/parkviaService.js';
import { setTransferStatus, deleteTransfer } from '../../services/transferService.js';
import { userNameButton, wireUserLinks } from '../../components/admin/UserDetailModal.js';
import { flightDayKey, enhanceFlightWarnings } from '../../services/flightStatusService.js';
import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';

const OVERDUE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// ── Date helpers ────────────────────────────────────────────────────────







// Returns [startISO, endISO] for the active window. Accepts either a
// preset name ('today' | 'week' | 'month') or a custom range tuple
// already in `[YYYY-MM-DD, YYYY-MM-DD]` form (inclusive on both ends —
// the end day is expanded to next-day-midnight so isInWindow's strict
// `< end` keeps the last day inside the bucket).
function windowRange(window) {
  const fmt = (d) => d.toISOString();
  if (Array.isArray(window) && window.length === 2 && window[0] && window[1]) {
    const start = new Date(window[0] + 'T00:00:00');
    const end = new Date(window[1] + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    return [fmt(start), fmt(end)];
  }
  const now = new Date();
  if (window === 'week') {
    const start = new Date(now);
    const day = start.getDay() || 7; // Mon=1..Sun=7
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return [fmt(start), fmt(end)];
  }
  if (window === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return [fmt(start), fmt(end)];
  }
  // today
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return [fmt(start), fmt(end)];
}

function isInWindow(iso, [startIso, endIso]) {
  if (!iso) return false;
  return iso >= startIso && iso < endIso;
}

// URL window param: presets stay as their key, custom range serializes
// as 'YYYY-MM-DD..YYYY-MM-DD'. Anything else falls back to 'today'.
function parseWindowParam(raw) {
  if (['today', 'week', 'month'].includes(raw)) return raw;
  const m = String(raw || '').match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) return [m[1], m[2]];
  return 'today';
}
function encodeWindow(w) {
  if (Array.isArray(w)) return `${w[0]}..${w[1]}`;
  return w;
}

// Lowercased plate/name/code/email match. Returns true on empty query so
// the filter is identity when search isn't in use.
function matchesSearch(b, q) {
  if (!q) return true;
  const haystacks = [
    b.licensePlate,
    bookingDisplayCode(b),
    b.contact?.name,
    b.contact?.email,
    b.id,
  ];
  return haystacks.some((h) => h && String(h).toLowerCase().includes(q));
}

// Transfers carry no plate/code — match on contact, phone, email, flights and
// pickup address instead. Identity on empty query, like matchesSearch.
function matchesTransferSearch(tr, q) {
  if (!q) return true;
  const haystacks = [
    tr.contactName, tr.phone, tr.email,
    tr.flightNumber, tr.returnFlightNumber, tr.pickupAddress, tr.id,
  ];
  return haystacks.some((h) => h && String(h).toLowerCase().includes(q));
}

function isOverdue(booking) {
  if (booking.status !== 'active') return false;
  // Both types can overstay: long-term past their pick-up, commuters past the
  // 20:00 cutoff on their check-in day. pickupDeadlineMs encodes both.
  const dl = pickupDeadlineMs(booking);
  if (dl == null) return false;
  // Commuters surface the moment they pass the 20:00 operating-hours cutoff
  // (no grace) so staff see who's still on the lot after closing (#17). The
  // extra-day CHARGE keeps the 2h grace (see overstayInfo). Long-term keeps
  // the 2h grace before showing as overdue.
  const grace = booking.type === 'credit' ? 0 : OVERDUE_THRESHOLD_MS;
  return Date.now() > dl + grace;
}

// Which timestamp decides Check-out-tab window membership. A commuter
// (credit) is checked out the day they checked in, so use their check-in
// time (always inside the local "today" window, timezone-safe). Long-term
// bookings use their scheduled pick-up.
function checkoutDate(b) {
  return b.type === 'credit' ? (b.checkinTimestamp || b.startDate) : (b.pickupAt || b.endDate);
}

function hoursOver(booking) {
  const dl = pickupDeadlineMs(booking);
  if (dl == null) return 0;
  return Math.max(0, Math.floor((Date.now() - dl) / 3_600_000));
}


// ── Badges ──────────────────────────────────────────────────────────────
// typeBadge (reservation-type chip) lives in bookingActions.js — shared
// with the edit / check-in / check-out dialogs.

// Outstanding-extension chip — an emailed payment request the client hasn't
// paid yet (adminRepriceBooking paidBy:'email'). Warns staff there's money due.
function owedBadge(b) {
  const owed = Number(b.extensionOwed) || 0;
  if (owed <= 0) return '';
  return `<span class="ml-1 inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-mango/20 text-mango-deep">${escapeHtml(t('checkins.extensionOwed', { amount: owed }))}</span>`;
}

// ── Row builders ────────────────────────────────────────────────────────

function tabPill(key, activeKey, label, count) {
  const isActive = key === activeKey;
  const cls = isActive
    ? 'bg-blueberry text-white'
    : 'bg-frost text-charcoal/70 hover:bg-frost-deep';
  return `<button type="button" data-tab="${key}" class="px-4 py-2 rounded-xl text-[14px] font-semibold transition-colors ${cls}">${label}<span class="ml-1.5 text-[11px] opacity-75">${count}</span></button>`;
}

function windowPill(key, activeKey, label) {
  const isActive = key === activeKey;
  const cls = isActive
    ? 'bg-mango text-charcoal'
    : 'bg-white text-charcoal/70 hover:bg-frost';
  return `<button type="button" data-window="${key}" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${cls}">${label}</button>`;
}

function actionButton({ key, label, variant = 'neutral', dataAttrs = '' }) {
  const styles = {
    neutral: 'bg-frost hover:bg-frost-deep text-charcoal/80',
    primary: 'bg-leaf hover:bg-leaf/90 text-white',
    warning: 'bg-mango hover:bg-mango-hover text-charcoal',
    danger:  'bg-red-100 hover:bg-red-200 text-red-700',
  };
  return `<button type="button" data-action="${key}" ${dataAttrs} class="${styles[variant] || styles.neutral} font-semibold text-[12px] px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">${label}</button>`;
}

// Empty flight-warning slot for a row — the enhancer (flightStatusService)
// fills it with a delayed/cancelled badge after render. Check-in / no-show
// rows watch the DEPARTURE flight (drop-off day); check-out watches the
// ARRIVAL flight (pick-up day). Renders nothing when no flight was recorded.
function flightSlot(b, tab) {
  const isArrival = tab === 'checkout';
  const flight = isArrival ? b.flightNumberPickup : b.flightNumberDropoff;
  if (!flight) return '';
  const day = flightDayKey(isArrival ? (b.pickupAt || b.endDate) : (b.dropoffAt || b.startDate));
  if (!day) return '';
  return `<div class="mt-1" data-flight-warn data-flight="${escapeHtml(flight)}" data-flight-date="${day}" data-flight-dir="${isArrival ? 'arrival' : 'departure'}"></div>`;
}

function rowHtml(b, { tab, locale, canCancel }) {
  const code = bookingDisplayCode(b);
  const dropoff = b.dropoffAt || b.startDate;
  const pickup = b.pickupAt || b.endDate;
  const name = b.contact?.name || b.contact?.email || '—';
  const plate = b.licensePlate || '—';
  const unpaid = b.paymentStatus === 'unpaid';
  const cancellable = ['upcoming', 'active'].includes(b.status)
    && b.paymentStatus !== 'refund-pending'
    && b.paymentStatus !== 'refunded';

  const actions = [];
  if (tab === 'checkin') {
    // Payment-first: only offer Check-in once the booking is paid. Unpaid
    // rows show the Collect button instead (added below); checking in is
    // re-enabled by the live subscription the moment payment is recorded.
    if (!unpaid) {
      actions.push(actionButton({ key: 'checkin', label: t('checkins.actionCheckIn'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
    } else {
      actions.push(`<span class="text-[11px] text-red-600 font-medium self-center mr-1">${t('checkins.collectFirst')}</span>`);
    }
    // Re-send the confirmation email for a not-yet-arrived reservation.
    actions.push(actionButton({ key: 'resend-email', label: t('checkins.resendEmail'), variant: 'neutral', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}"` }));
  } else if (tab === 'checkout') {
    actions.push(actionButton({ key: 'checkout', label: t('checkins.actionCheckOut'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
  }
  // Collect is irrelevant on the no-show tab — the customer never parked.
  if (unpaid && tab !== 'noshow') {
    actions.push(actionButton({ key: 'collect', label: t('checkins.actionCollect'), variant: 'warning', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-order="${escapeHtml(b.paymentId || '')}"` }));
  }
  // Edit contact / logistics / notes — agents/admins, on every booking row.
  if (canCancel) {
    actions.push(actionButton({ key: 'edit', label: t('checkins.actionEdit'), variant: 'neutral', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
  }
  // Cancel belongs on the check-in (not-yet-arrived) tab. On the check-out
  // tab the car is parked — you check it out, you don't cancel the booking.
  if (canCancel && cancellable && tab !== 'checkout') {
    actions.push(actionButton({ key: 'cancel', label: t('checkins.actionCancelReservation'), variant: 'danger', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}"` }));
  }

  const statusCell = tab === 'noshow'
    ? `<span class="text-[12px] uppercase tracking-wider font-mono font-semibold text-red-600">${t('checkins.statusNoShow')}</span>`
    : tab === 'checkin'
      ? `<span class="text-[12px] text-dim">${t('checkins.statusWaiting')}</span>`
      : `<span class="text-[12px] uppercase tracking-wider font-mono font-semibold text-leaf">${t('checkins.statusActive')}</span>`;

  return `
    <tr class="border-t border-frost-deep" data-row data-booking-id="${escapeHtml(b.id)}">
      <td class="px-4 py-3 align-top">
        <div class="text-[13px] font-mono">${fmtDateTime(dropoff, locale)}</div>
        <div class="text-[12px] text-dim font-mono mt-0.5">→ ${fmtDateTime(pickup, locale)}</div>
      </td>
      <td class="px-4 py-3 align-top text-[13px]">
        <div class="mb-1">${typeBadge(b)}${owedBadge(b)}</div>
        <div class="font-medium">${userNameButton({ customerId: b.customerId, email: b.contact?.email, name })}</div>
        <div class="text-[11px] text-dim truncate" title="${escapeHtml(b.contact?.email || '')}">${escapeHtml(b.contact?.email || '')}</div>
        ${b.notes ? `<div class="text-[11px] text-blueberry mt-0.5 flex items-start gap-1 max-w-[16rem]" title="${escapeHtml(b.notes)}"><svg class="w-3 h-3 mt-0.5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg><span class="truncate">${escapeHtml(b.notes)}</span></div>` : ''}
      </td>
      <td class="px-4 py-3 align-top text-[13px] font-mono">${escapeHtml(plate)}</td>
      <td class="px-4 py-3 align-top">${paymentStatusBadge(b)}</td>
      <td class="px-4 py-3 align-top">${statusCell}${flightSlot(b, tab)}</td>
      <td class="px-4 py-3 align-top text-right">
        <div class="inline-flex flex-wrap gap-1.5 justify-end">${actions.join('')}</div>
      </td>
    </tr>
  `;
}

function overdueRowHtml(b, { locale, canCancel }) {
  const code = bookingDisplayCode(b);
  const overHrs = hoursOver(b);
  const severity = overHrs >= 24 ? 'red' : overHrs >= 4 ? 'orange' : 'mango';
  const sevClass = severity === 'red'
    ? 'text-red-600 bg-red-100'
    : severity === 'orange'
      ? 'text-orange-600 bg-orange-100'
      : 'text-mango bg-mango/10';

  const cancellable = b.paymentStatus !== 'refund-pending' && b.paymentStatus !== 'refunded';
  const actions = [
    actionButton({ key: 'checkout', label: t('checkins.actionCheckOut'), variant: 'primary', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }),
    actionButton({ key: 'overstay', label: t('checkins.actionChargeOverstay'), variant: 'warning', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }),
  ];
  if (canCancel) {
    actions.push(actionButton({ key: 'edit', label: t('checkins.actionEdit'), variant: 'neutral', dataAttrs: `data-booking="${escapeHtml(b.id)}"` }));
  }
  if (canCancel && cancellable) {
    actions.push(actionButton({ key: 'cancel', label: t('checkins.actionCancelReservation'), variant: 'danger', dataAttrs: `data-booking="${escapeHtml(b.id)}" data-code="${escapeHtml(code)}"` }));
  }

  const detail = (label, value) => `
    <div class="flex justify-between gap-3 py-1 border-b border-frost-deep/60 last:border-0">
      <span class="text-[12px] text-dim font-mono uppercase tracking-wider">${label}</span>
      <span class="text-[13px] text-charcoal text-right">${value}</span>
    </div>
  `;

  return `
    <div class="card-solid rounded-2xl overflow-hidden mb-3" data-overdue-row data-booking-id="${escapeHtml(b.id)}">
      <button type="button" data-overdue-toggle class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-frost transition-colors text-left">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <span class="font-mono text-[14px] font-bold text-blueberry-deep">${escapeHtml(code)}</span>
          <span class="font-mono text-[14px] text-charcoal">${escapeHtml(b.licensePlate || '—')}</span>
          ${typeBadge(b)}${owedBadge(b)}
          <span class="text-[13px] text-charcoal/70 truncate">${escapeHtml(b.contact?.name || b.contact?.email || '—')}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full ${sevClass}">+${overHrs}h</span>
          ${paymentStatusBadge(b)}
          <svg data-overdue-chevron class="w-4 h-4 text-dim transition-transform" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        </div>
      </button>
      <div class="hidden border-t border-frost-deep px-4 py-4 bg-frost/30" data-overdue-body>
        <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-4">
          ${detail(t('checkins.detailDropoff'), fmtDateTime(b.dropoffAt || b.startDate, locale))}
          ${detail(t('checkins.detailPickup'), fmtDateTime(b.pickupAt || b.endDate, locale))}
          ${detail(t('checkins.detailDays'), String(b.days || '—'))}
          ${detail(t('checkins.detailTotal'), `${Number(b.totalPrice || 0)} ${t('common.lei')}`)}
          ${detail(t('checkins.detailEmail'), escapeHtml(b.contact?.email || '—'))}
          ${detail(t('checkins.detailPhone'), escapeHtml(b.contact?.phone || '—'))}
          ${detail(t('checkins.detailSpot'), escapeHtml(b.spotId || '—'))}
          ${detail(t('checkins.detailPaidBy'), escapeHtml(b.paidBy || '—'))}
        </div>
        ${b.notes ? `<div class="rounded-xl bg-blueberry/5 border border-blueberry/15 px-3 py-2 mb-4 text-[13px] text-charcoal"><span class="text-[11px] uppercase tracking-wider text-dim font-mono">${t('checkins.editNotes')}</span><br>${escapeHtml(b.notes)}</div>` : ''}
        <div class="flex flex-wrap gap-2 justify-end">${actions.join('')}</div>
      </div>
    </div>
  `;
}

// ── Transfer (door-to-airport) builders ──────────────────────────────────

function transferTypeChip(tr) {
  const roundtrip = tr.transferType === 'roundtrip';
  const base = 'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded';
  const carIcon = '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8a1 1 0 001 1h1a1 1 0 001-1v-1h12v1a1 1 0 001 1h1a1 1 0 001-1v-8l-2.08-5.99zM6.5 16a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm11 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM5 11l1.5-4.5h11L19 11H5z"/></svg>';
  const label = roundtrip ? t('transfers.typeRoundtrip') : t('transfers.typeOneway');
  return `<span class="${base} bg-blueberry/10 text-blueberry">${carIcon}${label}</span>`;
}

function transferStatusBadge(status) {
  const s = status || 'scheduled';
  const map = {
    scheduled: ['bg-mango/10 text-mango', t('transfers.statusScheduled')],
    completed: ['bg-leaf/10 text-leaf', t('transfers.statusCompleted')],
    cancelled: ['bg-gray-100 text-dim', t('transfers.statusCancelled')],
  };
  const [cls, label] = map[s] || map.scheduled;
  return `<span class="inline-flex items-center text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls}">${label}</span>`;
}

// A transfer is up to two dated events: the outbound home→airport pickup and,
// for round trips, the airport→home return leg. Surfacing both lets a return
// show up on its OWN date in the Transfers tab (mirrors the activity feed),
// not just the outbound pickup date.
function transferLegs(tr) {
  const legs = [{ leg: 'out', at: tr.pickupAt }];
  if (tr.transferType === 'roundtrip' && tr.returnAt) legs.push({ leg: 'return', at: tr.returnAt });
  return legs;
}

// The "mini dashboard" card: collapsed header (contact · phone · type · leg ·
// time · status); expands to every rubric the client asked for + actions.
// `leg` picks which event this card represents ('out' = pickup, 'return' =
// the round-trip return) so its header time + badge match the tab's date.
function transferCardHtml(tr, { locale, canCancel, leg = 'out' }) {
  const name = tr.contactName || '—';
  const phone = tr.phone || '—';
  const pickup = fmtDateTime(tr.pickupAt, locale);
  const roundtrip = tr.transferType === 'roundtrip';
  const isReturn = roundtrip && leg === 'return';
  const headerTime = fmtDateTime(isReturn ? tr.returnAt : tr.pickupAt, locale);
  const legBadge = roundtrip
    ? `<span class="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${isReturn ? 'bg-blueberry/10 text-blueberry' : 'bg-leaf/10 text-leaf'}">${isReturn ? t('transfers.legReturn') : t('transfers.legOutbound')}</span>`
    : '';
  // Status is per leg: the outbound uses `status`, the return uses `returnStatus`.
  const legStatusVal = isReturn ? (tr.returnStatus || 'scheduled') : (tr.status || 'scheduled');
  const isScheduled = legStatusVal === 'scheduled';
  const legAttr = `data-transfer="${escapeHtml(tr.id)}" data-leg="${leg}"`;

  const detail = (label, value) => `
    <div class="flex justify-between gap-3 py-1 border-b border-frost-deep/60 last:border-0">
      <span class="text-[12px] text-dim font-mono uppercase tracking-wider shrink-0">${label}</span>
      <span class="text-[13px] text-charcoal text-right break-words">${value}</span>
    </div>
  `;

  const pax = [
    `${tr.adults || 1} ${t('transfers.adults')}`,
    tr.children ? `${tr.children} ${t('transfers.children')}` : '',
    tr.infantsInArms ? `${tr.infantsInArms} ${t('transfers.infantsInArms')}` : '',
  ].filter(Boolean).join(' · ');
  const bags = `${tr.holdLuggage || 0} ${t('transfers.holdLuggage')} · ${tr.cabinLuggage || 0} ${t('transfers.cabinLuggage')}`;
  const returnLine = `${escapeHtml(tr.returnTo || tr.pickupAddress || '—')} · ${fmtDateTime(tr.returnAt, locale)}${tr.returnFlightNumber ? ` · ${escapeHtml(tr.returnFlightNumber)}` : ''}`;

  const actions = [
    actionButton({ key: 'transfer-edit', label: t('transfers.actionEdit'), variant: 'neutral', dataAttrs: legAttr }),
  ];
  if (isScheduled) {
    actions.push(actionButton({ key: 'transfer-complete', label: t('transfers.actionComplete'), variant: 'primary', dataAttrs: legAttr }));
    actions.push(actionButton({ key: 'transfer-cancel', label: t('transfers.actionCancel'), variant: 'warning', dataAttrs: legAttr }));
  }
  if (canCancel) {
    actions.push(actionButton({ key: 'transfer-delete', label: t('transfers.actionDelete'), variant: 'danger', dataAttrs: legAttr }));
  }

  return `
    <div class="card-solid rounded-2xl overflow-hidden mb-3" data-transfer-row data-transfer-id="${escapeHtml(tr.id)}">
      <button type="button" data-transfer-toggle class="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-frost transition-colors text-left">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          <span class="font-semibold text-[14px] text-charcoal truncate">${escapeHtml(name)}</span>
          <span class="font-mono text-[13px] text-dim hidden sm:inline">${escapeHtml(phone)}</span>
          ${transferTypeChip(tr)}
          ${legBadge}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[12px] font-mono text-charcoal/70 hidden sm:inline">${headerTime}</span>
          ${transferStatusBadge(legStatusVal)}
          <svg data-transfer-chevron class="w-4 h-4 text-dim transition-transform" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
        </div>
      </button>
      <div class="hidden border-t border-frost-deep px-4 py-4 bg-frost/30" data-transfer-body>
        <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-4">
          ${detail(t('transfers.detailContact'), escapeHtml(name) + (tr.email ? ` · ${escapeHtml(tr.email)}` : ''))}
          ${detail(t('checkins.detailPhone'), escapeHtml(phone))}
          ${detail(t('transfers.detailPickup'), escapeHtml(tr.pickupAddress || '—'))}
          ${detail(t('transfers.pickupAt'), pickup)}
          ${detail(t('transfers.detailFlight'), escapeHtml(tr.flightNumber || '—'))}
          ${detail(t('transfers.passengers'), escapeHtml(pax || '—'))}
          ${detail(t('transfers.luggage'), bags)}
          ${tr.price ? detail(t('transfers.detailPrice'), escapeHtml(tr.price)) : ''}
          ${roundtrip ? detail(t('transfers.detailReturn'), returnLine) : ''}
          ${tr.groupNotes ? detail(t('transfers.detailGroup'), escapeHtml(tr.groupNotes)) : ''}
        </div>
        <p class="text-[12px] text-dim mb-3">${t('transfers.airportNote')}</p>
        <div class="flex flex-wrap gap-2 justify-end">${actions.join('')}</div>
      </div>
    </div>
  `;
}

// ── Page entry ──────────────────────────────────────────────────────────

export default async function AdminCheckIns(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('checkins.pageTitle')} — Admin — ManGO Parking`, description: t('checkins.subtitle'), lang: locale });

  const profile = getUserProfile();
  const role = profile?.role || 'customer';
  const canCancel = hasPermission(role, PERM.REFUNDS);

  // Initial state from URL — preserves tab, window, and search across
  // reloads. Window can be 'today' | 'week' | 'month' or a custom
  // 'YYYY-MM-DD..YYYY-MM-DD' range string.
  const params = new URLSearchParams(window.location.search);
  let activeTab = params.get('tab') || 'checkin';
  if (!['checkin', 'checkout', 'overdue', 'noshow', 'transfers'].includes(activeTab)) activeTab = 'checkin';
  const rawWindow = params.get('window') || 'today';
  let activeWindow = parseWindowParam(rawWindow);
  let searchQuery = (params.get('q') || '').trim().toLowerCase();
  let rangeFp = null; // live custom-range flatpickr (destroyed before each window-bar rebuild)
  // Deep-link from the activity feed: scroll to + flash this reservation once
  // its row renders. Data loads async AND a later snapshot can rebuild the tab
  // (which would wipe a one-shot highlight), so we re-apply the flash on every
  // render until a short deadline.
  let focusId = params.get('focus');
  if (focusId && !/^[A-Za-z0-9_-]+$/.test(focusId)) focusId = null;
  let focusScrolled = false;
  let focusUntil = 0;

  // Pull users once for the walk-in modal (matches the AdminTransactions pattern).
  const users = await getCollection('users').catch(() => []);
  // Credit packs → per-credit price, used to value a commuter's overstay days.
  const creditPacks = await getTokenPacks().catch(() => []);
  const creditPerDay = perCreditPrice(creditPacks);

  // Live booking data — single subscription, filtered client-side per tab.
  let bookings = [];
  let unsub = null;
  // Live door-to-airport transfers — own subscription, own tab.
  let transfers = [];
  let unsubTransfers = null;

  const page = AdminLayout('/admin/checkins', `
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('checkins.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('checkins.subtitle')}</p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="button" data-parkvia-sync class="bg-white hover:bg-frost text-blueberry border border-blueberry font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('checkins.syncParkvia')}</button>
        <button type="button" data-walkin class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors shadow-sm">${t('checkins.walkInCta')}</button>
      </div>
    </div>

    <div class="card-solid rounded-2xl p-3 mb-4 flex items-center gap-2">
      <svg class="w-5 h-5 text-dim shrink-0 ml-1" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
      <input type="text" data-search value="${escapeHtml(searchQuery)}" placeholder="${t('checkins.searchPlaceholder')}" class="flex-1 min-w-0 px-2 py-2 bg-transparent text-[15px] focus:outline-none placeholder:text-dim/70">
      <button type="button" data-search-clear class="${searchQuery ? '' : 'hidden'} text-dim hover:text-charcoal p-1.5 rounded-lg hover:bg-frost transition-colors" aria-label="${t('checkins.searchClear')}">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    <div class="flex flex-wrap gap-2 mb-4" data-tabs></div>
    <div class="flex flex-wrap items-center gap-2 mb-4" data-window-bar></div>
    <div data-tab-body></div>
  `);

  initAdminNav(page);
  wireUserLinks(page);
  container.appendChild(page);

  const tabsEl = page.querySelector('[data-tabs]');
  const windowBarEl = page.querySelector('[data-window-bar]');
  const bodyEl = page.querySelector('[data-tab-body]');

  function setUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    if (activeTab === 'overdue') url.searchParams.delete('window');
    else url.searchParams.set('window', encodeWindow(activeWindow));
    if (searchQuery) url.searchParams.set('q', searchQuery);
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url.toString());
  }

  // A non-empty search bypasses the date window — the search box is a global
  // finder. Otherwise a long-term customer arriving a day early is invisible
  // on the Check-out tab even when the agent types their exact plate (the
  // window AND the query both had to match).
  const searchOrWindow = (q, iso, range) => (q ? true : isInWindow(iso, range));

  function counts() {
    const range = windowRange(activeWindow);
    const q = searchQuery;
    const checkin = bookings.filter((b) => b.status === 'upcoming' && searchOrWindow(q, b.dropoffAt || b.startDate, range) && matchesSearch(b, q)).length;
    const checkout = bookings.filter((b) => b.status === 'active' && (b.type === 'credit' || searchOrWindow(q, checkoutDate(b), range)) && matchesSearch(b, q)).length;
    const overdue = bookings.filter((b) => isOverdue(b) && matchesSearch(b, q)).length;
    const noshow = bookings.filter((b) => b.status === 'no-show' && searchOrWindow(q, b.dropoffAt || b.startDate, range) && matchesSearch(b, q)).length;
    // Count each in-window leg (a round-trip contributes its outbound and/or
    // its return depending on which fall in the range) to match the list.
    const transfersCount = transfers.reduce((n, tr) => (
      matchesTransferSearch(tr, q)
        ? n + transferLegs(tr).filter((lg) => searchOrWindow(q, lg.at, range)).length
        : n
    ), 0);
    return { checkin, checkout, overdue, noshow, transfers: transfersCount };
  }

  function renderTabs() {
    const { checkin, checkout, overdue, noshow, transfers: transfersCount } = counts();
    tabsEl.innerHTML = [
      tabPill('checkin', activeTab, t('checkins.tabCheckIn'), checkin),
      tabPill('checkout', activeTab, t('checkins.tabCheckOut'), checkout),
      tabPill('overdue', activeTab, t('checkins.tabOverdue'), overdue),
      tabPill('noshow', activeTab, t('checkins.tabNoShow'), noshow),
      tabPill('transfers', activeTab, t('checkins.tabTransfers'), transfersCount),
    ].join('');
  }

  function renderWindowBar() {
    // The previous render's flatpickr survives windowBarEl.innerHTML (its
    // calendar hangs off document.body) — destroy it BEFORE the rebuild or
    // every live bookings snapshot leaks one orphaned calendar. Tracked on
    // the page closure because the input node itself is replaced each time.
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
    if (activeTab === 'overdue') {
      windowBarEl.innerHTML = `<p class="text-[13px] text-dim">${t('checkins.overdueSubtitle')}</p>`;
      return;
    }
    // Preset highlight is "off" whenever activeWindow is a custom range —
    // calendar value carries the active state in that case.
    const rangeActive = Array.isArray(activeWindow);
    const presetActive = rangeActive ? null : activeWindow;
    const rangeValue = rangeActive
      ? `${activeWindow[0]} to ${activeWindow[1]}`
      : '';
    // The custom-range control is a flatpickr input styled to read as a
    // button alongside the preset pills (it used to look like a bare text
    // field). Active range = mango like a selected pill; idle = white with
    // a calendar affordance. Shared by the input and flatpickr's altInput.
    const rangeBtnCls = `pl-3 pr-9 py-1.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors min-w-[200px] focus:outline-none ${rangeActive ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost'}`;
    windowBarEl.innerHTML = `
      <span class="text-[12px] uppercase tracking-wider text-dim font-mono mr-1">${t('checkins.windowLabel')}</span>
      ${windowPill('today', presetActive, t('checkins.windowToday'))}
      ${windowPill('week', presetActive, t('checkins.windowWeek'))}
      ${windowPill('month', presetActive, t('checkins.windowMonth'))}
      <span class="text-[12px] text-dim mx-1">${t('checkins.windowOr')}</span>
      <span class="relative inline-flex items-center">
        <svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${rangeActive ? 'text-charcoal/70' : 'text-charcoal/40'}" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 9h16.5M5.25 5.25h13.5A1.5 1.5 0 0 1 20.25 6.75v12A1.5 1.5 0 0 1 18.75 20.25H5.25A1.5 1.5 0 0 1 3.75 18.75v-12A1.5 1.5 0 0 1 5.25 5.25z"/></svg>
        <input type="text" data-range-picker value="${escapeHtml(rangeValue)}" placeholder="${t('checkins.windowCustom')}"
          class="${rangeBtnCls}">
      </span>
    `;
    // (Re-)mount flatpickr range picker.
    const rangeInput = windowBarEl.querySelector('[data-range-picker]');
    if (rangeInput) {
      const fp = flatpickr(rangeInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: locale === 'en' ? 'M j, Y' : 'j M Y',
        altInputClass: `flatpickr-alt-input ${rangeBtnCls}`,
        locale: locale === 'ro' ? Romanian : 'default',
        clickOpens: true,
        allowInput: false,
        defaultDate: Array.isArray(activeWindow) ? activeWindow : null,
        onClose: (dates) => {
          if (dates.length === 2) {
            const fmt = (d) => {
              const pad = (n) => String(n).padStart(2, '0');
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            };
            activeWindow = [fmt(dates[0]), fmt(dates[1])];
            setUrl();
            rerender();
          }
        },
      });
      rangeFp = fp;
    }
  }

  function renderTable(rows) {
    if (!rows.length) {
      return `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('checkins.emptyTab')}</div>`;
    }
    return `
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('checkins.colTimes')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colCustomer')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colPlate')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colPayment')}</th>
                <th class="px-4 py-3 font-medium">${t('checkins.colStatus')}</th>
                <th class="px-4 py-3 font-medium text-right">${t('checkins.colActions')}</th>
              </tr>
            </thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderBody() {
    const q = searchQuery;
    if (activeTab === 'checkin') {
      const range = windowRange(activeWindow);
      const rows = bookings
        .filter((b) => b.status === 'upcoming' && searchOrWindow(q, b.dropoffAt || b.startDate, range) && matchesSearch(b, q))
        .sort((a, b) => String(a.dropoffAt || a.startDate || '').localeCompare(String(b.dropoffAt || b.startDate || '')))
        .map((b) => rowHtml(b, { tab: 'checkin', locale, canCancel }));
      bodyEl.innerHTML = renderTable(rows);
      return;
    }
    if (activeTab === 'checkout') {
      const range = windowRange(activeWindow);
      // An active booking is physically on the lot and must always be
      // checkable-out. Commuters (credit) are bucketed by their check-in day,
      // so a date window would hide one checked in on an earlier day —
      // stranding it "checked in" forever. Always include active credit
      // bookings; keep the window for long-term.
      const rows = bookings
        .filter((b) => b.status === 'active' && (b.type === 'credit' || searchOrWindow(q, checkoutDate(b), range)) && matchesSearch(b, q))
        .sort((a, b) => String(checkoutDate(a) || '').localeCompare(String(checkoutDate(b) || '')))
        .map((b) => rowHtml(b, { tab: 'checkout', locale, canCancel }));
      bodyEl.innerHTML = renderTable(rows);
      return;
    }
    if (activeTab === 'noshow') {
      const range = windowRange(activeWindow);
      const rows = bookings
        .filter((b) => b.status === 'no-show' && searchOrWindow(q, b.dropoffAt || b.startDate, range) && matchesSearch(b, q))
        .sort((a, b) => String(b.dropoffAt || b.startDate || '').localeCompare(String(a.dropoffAt || a.startDate || '')))
        .map((b) => rowHtml(b, { tab: 'noshow', locale, canCancel }));
      if (!rows.length) {
        bodyEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('checkins.noShowEmpty')}</div>`;
        return;
      }
      bodyEl.innerHTML = renderTable(rows);
      return;
    }
    if (activeTab === 'transfers') {
      const range = windowRange(activeWindow);
      // Expand each transfer into its in-window legs so a round-trip appears on
      // both its pickup date (outbound) and its return date (return leg).
      const legRows = [];
      for (const tr of transfers) {
        if (!matchesTransferSearch(tr, q)) continue;
        for (const lg of transferLegs(tr)) {
          if (searchOrWindow(q, lg.at, range)) legRows.push({ tr, leg: lg.leg, at: lg.at });
        }
      }
      legRows.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      if (!legRows.length) {
        bodyEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('transfers.tabEmpty')}</div>`;
        return;
      }
      bodyEl.innerHTML = legRows.map(({ tr, leg }) => transferCardHtml(tr, { locale, canCancel, leg })).join('');
      return;
    }
    // overdue
    const rows = bookings
      .filter((b) => isOverdue(b) && matchesSearch(b, q))
      .sort((a, b) => hoursOver(b) - hoursOver(a))
      .map((b) => overdueRowHtml(b, { locale, canCancel }));
    if (!rows.length) {
      bodyEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('checkins.overdueEmpty')}</div>`;
      return;
    }
    bodyEl.innerHTML = rows.join('');
  }

  // Web Animations API flash with inline colors (not Tailwind utilities):
  // `ring-*` box-shadow doesn't paint on a <tr>, and a faint tint is invisible,
  // so we wash a strong mango over the cells (table rows) or the card. Duration
  // shrinks to the shared deadline so repeated re-applies converge to one fade.
  function flashRow(el, duration) {
    const opts = { duration: Math.max(500, duration), easing: 'ease-out' };
    const wash = [
      { backgroundColor: 'rgba(253,187,48,0.6)' },
      { backgroundColor: 'rgba(253,187,48,0)' },
    ];
    // For a table row the <td>s paint over the <tr>, so wash the cells too.
    const targets = el.tagName === 'TR' ? [el, ...el.querySelectorAll('td')] : [el];
    for (const node of targets) { try { node.animate(wash, opts); } catch { /* no WAAPI */ } }
    if (el.tagName !== 'TR') {
      try {
        el.animate([
          { boxShadow: '0 0 0 3px rgba(253,187,48,0.95)' },
          { boxShadow: '0 0 0 3px rgba(253,187,48,0)' },
        ], opts);
      } catch { /* no WAAPI */ }
    }
  }

  function maybeApplyFocus() {
    if (!focusId) return;
    const el = bodyEl.querySelector(`[data-booking-id="${focusId}"], [data-transfer-id="${focusId}"]`);
    if (!el) return; // not rendered yet — retry on the next render
    if (!focusScrolled) {
      focusScrolled = true;
      focusUntil = Date.now() + 2600;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const remaining = focusUntil - Date.now();
    if (remaining <= 0) { focusId = null; return; } // flashed long enough — stop
    flashRow(el, remaining);
  }

  function rerender() {
    renderTabs();
    renderWindowBar();
    renderBody();
    maybeApplyFocus();
    // Flag delayed/cancelled flights on the freshly-rendered rows (dormant
    // until a flight API key is configured; results are memoised so this is
    // cheap on the frequent live-subscription re-renders).
    enhanceFlightWarnings(bodyEl);
  }

  // ── Subscriptions ──
  // Subscribe once to all bookings; filter per tab in memory. The
  // collection is small at our scale (thousands of rows tops).
  unsub = subscribeCollection('bookings', (rows) => {
    bookings = rows;
    rerender();
  });

  // Door-to-airport transfers — separate collection, drives the Transfers tab.
  unsubTransfers = subscribeCollection('transfers', (rows) => {
    transfers = rows;
    rerender();
  });

  setUrl();
  rerender();

  // ── Tab switcher ──
  delegate(page, 'click', '[data-tab]', (_e, btn) => {
    activeTab = btn.dataset.tab;
    setUrl();
    rerender();
  });

  // ── Window selector ──
  // Picking a preset pill (Today/Week/Month) clears any custom range.
  // The flatpickr range input has its own onClose handler that flips
  // activeWindow back to a tuple.
  delegate(page, 'click', '[data-window]', (_e, btn) => {
    activeWindow = btn.dataset.window;
    setUrl();
    rerender();
  });

  // ── Overdue accordion ──
  delegate(page, 'click', '[data-overdue-toggle]', (_e, btn) => {
    const wrap = btn.closest('[data-overdue-row]');
    const body = wrap.querySelector('[data-overdue-body]');
    const chev = btn.querySelector('[data-overdue-chevron]');
    body.classList.toggle('hidden');
    chev?.classList.toggle('rotate-180');
  });

  // ── Transfer card accordion ──
  delegate(page, 'click', '[data-transfer-toggle]', (_e, btn) => {
    const wrap = btn.closest('[data-transfer-row]');
    const body = wrap.querySelector('[data-transfer-body]');
    const chev = btn.querySelector('[data-transfer-chevron]');
    body.classList.toggle('hidden');
    chev?.classList.toggle('rotate-180');
  });

  // ── Transfer actions (edit / complete / cancel / delete) ──
  // Separate from the booking row actions: transfer buttons carry
  // `data-transfer` (not `data-booking`), so the booking handler no-ops on them.
  delegate(page, 'click', '[data-action^="transfer-"]', async (_e, btn) => {
    const action = btn.dataset.action;
    const id = btn.dataset.transfer;
    if (!id) return;
    const tr = transfers.find((x) => x.id === id);
    if (!tr) return;
    // Which leg the button belongs to (round-trip return vs outbound). Complete
    // / cancel act on that leg only; edit / delete act on the whole record.
    const leg = btn.dataset.leg === 'return' ? 'return' : 'out';
    const legLabel = tr.transferType === 'roundtrip'
      ? (leg === 'return' ? t('transfers.legReturn') : t('transfers.legOutbound'))
      : '';
    const who = legLabel ? `${tr.contactName || '—'} (${legLabel})` : (tr.contactName || '—');
    btn.disabled = true;
    try {
      if (action === 'transfer-edit') {
        openCreateTransactionModal(users, (result) => {
          if (result?.transfer) { activeTab = 'transfers'; setUrl(); }
          rerender();
        }, { editTransfer: tr });
      } else if (action === 'transfer-complete') {
        await setTransferStatus(id, 'completed', leg);
        showToast(t('transfers.statusToast'), 'success');
      } else if (action === 'transfer-cancel') {
        const ok = await confirmModal(t('transfers.cancelConfirm', { name: who }), {
          danger: true, confirmText: t('transfers.actionCancel'),
        });
        if (!ok) return;
        await setTransferStatus(id, 'cancelled', leg);
        showToast(t('transfers.statusToast'), 'success');
      } else if (action === 'transfer-delete') {
        const ok = await confirmModal(t('transfers.deleteConfirm', { name: tr.contactName || '—' }), {
          danger: true, confirmText: t('transfers.actionDelete'),
        });
        if (!ok) return;
        await deleteTransfer(id);
        showToast(t('transfers.deletedToast'), 'success');
      }
    } catch (err) {
      console.error(action, err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── ParkVia on-demand sync — the same pass the 15-min scheduler runs.
  // The board subscribes to `bookings` live, so freshly imported reservations
  // appear on the tabs without a reload; the toast just summarises the pass.
  delegate(page, 'click', '[data-parkvia-sync]', async (_e, btn) => {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('common.loading');
    try {
      const r = await parkviaSyncNow();
      if (!r || r.configured === false) { showToast(t('parkvia.notConfigured'), 'error'); return; }
      const detail = t('parkvia.syncResult', {
        imported: r.imported ?? 0,
        cancelled: r.cancelled ?? 0,
        errors: r.errors ?? 0,
      });
      showToast(`${t('parkvia.syncDone')} — ${detail}`, (r.errors ?? 0) > 0 ? 'error' : 'success');
    } catch (err) {
      console.error('parkviaSyncNow', err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  // ── Reservations CTA (long-term / credit walk-in, or door-to-airport) ──
  delegate(page, 'click', '[data-walkin]', () => {
    openCreateTransactionModal(users, (result) => {
      if (result?.transfer) {
        activeTab = 'transfers';
        setUrl();
      } else if (result?.checkedIn) {
        activeTab = 'checkout';
        setUrl();
      }
      // Subscription will refresh the list within seconds; force one
      // pass of rerender so the UI is responsive immediately.
      rerender();
    });
  });

  // ── Row actions ──
  delegate(page, 'click', '[data-action]', async (_e, btn) => {
    const bookingId = btn.dataset.booking;
    if (!bookingId) return;
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    btn.disabled = true;
    try {
      // Shared with the reservation detail view — see bookingActions.js. The
      // live bookings snapshot re-renders the rows, so no onDone is needed.
      await runBookingAction(
        { action: btn.dataset.action, booking, dataset: btn.dataset },
        { locale, creditPerDay },
      );
    } finally {
      btn.disabled = false;
    }
  });

  // ── Search filter ──
  // Live filter across plate / customer name / email / booking code.
  // Debounce keeps re-renders snappy on long lists.
  const searchInput = page.querySelector('[data-search]');
  const searchClearBtn = page.querySelector('[data-search-clear]');
  let searchTimer = null;
  searchInput?.addEventListener('input', (e) => {
    const v = String(e.target.value || '').trim().toLowerCase();
    searchQuery = v;
    searchClearBtn?.classList.toggle('hidden', !v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { setUrl(); rerender(); }, 120);
  });
  searchClearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClearBtn.classList.add('hidden');
    setUrl();
    rerender();
  });

  // Tear down the bookings listener when the router navigates away (it calls
  // the returned cleanup before rendering the next route). Replaces the old
  // popstate-only teardown, which leaked on pushState/SPA-link navigation.
  return () => {
    if (unsub) unsub();
    if (unsubTransfers) unsubTransfers();
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
  };
}





