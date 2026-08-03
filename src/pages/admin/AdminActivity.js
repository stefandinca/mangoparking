// /admin/activity — two views of scheduled reservation activity:
//   • Upcoming: a forward-looking feed of everything due in the next 48 hours —
//     cars to check IN (upcoming long-term at drop-off) or OUT (active at
//     pick-up) and airport transfers (a round-trip contributes two events, its
//     outbound at pick-up and its return at the return time).
//   • History: the same event types over an admin-chosen date range, shown as
//     collapsed rows that expand to the full reservation/transfer details.
//
// Commuter (credit) check-ins are excluded from both — they're walk-up /
// same-day with no scheduled time.

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { escapeHtml, delegate } from '../../utils/dom.js';
import { t, getLocale, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeCollection } from '../../firebase/db.js';
import { navigate } from '../../router/index.js';
import { openUserDetail } from '../../components/admin/UserDetailModal.js';
import { reservationCodeHtml, wireReservationLinks } from '../../components/admin/reservationLink.js';
import { flightDayKey, enhanceFlightWarnings } from '../../services/flightStatusService.js';
import { phoneLinkHtml, returnFlightHtml } from '../../components/admin/rowCells.js';
import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';

const WINDOW_MS = 48 * 60 * 60 * 1000;

// ── Date helpers (Europe/Bucharest day grouping) ─────────────────────────
function fmtTime(iso, locale) {
  try {
    return new Date(iso).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
    });
  } catch { return '—'; }
}
function fmtDate(iso, locale) {
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Bucharest',
    });
  } catch { return '—'; }
}
function fmtDateTime(iso, locale) {
  if (!iso) return '';
  return `${fmtDate(iso, locale)} ${fmtTime(iso, locale)}`;
}
function bucharestDate(iso) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  } catch { return String(iso); }
}
// Browser-local calendar day (YYYY-MM-DD) of an instant. Matches how the
// check-ins page builds its custom window range (local midnight boundaries),
// so linking with this day guarantees the clicked event falls inside it.
function localDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(iso, locale) {
  const day = bucharestDate(iso);
  const todayKey = bucharestDate(new Date().toISOString());
  const tomorrowKey = bucharestDate(new Date(Date.now() + 86_400_000).toISOString());
  if (day === todayKey) return t('activity.today');
  if (day === tomorrowKey) return t('activity.tomorrow');
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      weekday: 'long', day: '2-digit', month: 'short', timeZone: 'Europe/Bucharest',
    });
  } catch { return day; }
}
// Absolute day label for history groups (no today/tomorrow shorthand).
function historyDayLabel(iso, locale) {
  try {
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Bucharest',
    });
  } catch { return bucharestDate(iso); }
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// ── Status badge (shared) ────────────────────────────────────────────────
const STATUS_CLS = {
  upcoming: 'bg-blueberry/10 text-blueberry',
  active: 'bg-leaf/10 text-leaf',
  completed: 'bg-charcoal/10 text-charcoal/70',
  cancelled: 'bg-red-100 text-red-600',
  'no-show': 'bg-red-100 text-red-600',
  scheduled: 'bg-blueberry/10 text-blueberry',
};
function statusBadge(status) {
  if (!status) return '';
  const label = t(`activity.status.${status === 'no-show' ? 'noshow' : status}`) || status;
  const cls = STATUS_CLS[status] || 'bg-charcoal/10 text-charcoal/70';
  return `<span class="inline-block text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls}">${escapeHtml(label)}</span>`;
}

// A customer name that opens their profile (shared user-detail modal). Renders
// a plain span when there's nothing to resolve (no account id and no email).
function nameSpan(name, customerId, email, cls) {
  const label = escapeHtml(name || email || '—');
  if (!customerId && !email) return `<span class="${cls}">${label}</span>`;
  return `<span data-user-link data-uid="${escapeHtml(customerId || '')}" data-email="${escapeHtml(email || '')}" class="${cls} hover:text-blueberry hover:underline cursor-pointer">${label}</span>`;
}

// Empty flight-warning slot for an upcoming booking event — the enhancer fills
// it with a delayed/cancelled badge. Check-in watches the DEPARTURE flight,
// check-out the ARRIVAL flight; the event's own timestamp is the flight day.
function flightSlotEvent(e) {
  if (e.kind !== 'checkin' && e.kind !== 'checkout') return '';
  const isArrival = e.kind === 'checkout';
  const flight = isArrival ? e.booking.flightNumberPickup : e.booking.flightNumberDropoff;
  if (!flight) return '';
  const day = flightDayKey(e.at);
  if (!day) return '';
  return `<span class="ml-auto shrink-0" data-flight-warn data-flight="${escapeHtml(flight)}" data-flight-date="${day}" data-flight-dir="${isArrival ? 'arrival' : 'departure'}"></span>`;
}

// Phone + return flight, shown on every row so staff can call and see the
// inbound flight without opening anything.
//
// These live OUTSIDE the row's <button>: an <a> inside a <button> is invalid
// HTML (interactive content nested in interactive content) and its click would
// be swallowed by the row's navigate-to-check-ins handler. Keeping them as
// siblings makes the phone independently dialable and the row still clickable.
function rowMetaHtml({ phone, flight }) {
  const cells = [
    returnFlightHtml(flight, { className: 'hidden sm:inline-flex' }),
    phoneLinkHtml(phone, { icon: true }),
  ].filter(Boolean);
  if (!cells.length) return '';
  return `<span class="shrink-0 flex items-center gap-3 pr-3">${cells.join('')}</span>`;
}

// ── Upcoming event rows (click → check-ins deep-link; name → profile) ─
function eventRow(e, locale) {
  const time = fmtTime(e.at, locale);
  const rowCls = 'card-solid rounded-xl flex items-center hover:bg-frost transition-colors';
  const btnCls = 'flex-1 min-w-0 p-3 flex items-center gap-3 text-left';
  if (e.kind === 'checkin' || e.kind === 'checkout') {
    const b = e.booking;
    const isCheckin = e.kind === 'checkin';
    const cls = isCheckin ? 'bg-leaf/10 text-leaf' : 'bg-blueberry/10 text-blueberry';
    const label = isCheckin ? t('activity.kindCheckin') : t('activity.kindCheckout');
    return `
      <div class="${rowCls}">
        <button type="button" data-go="${isCheckin ? 'checkin' : 'checkout'}" data-at="${escapeHtml(e.at)}" data-focus="${escapeHtml(b.id)}" class="${btnCls}">
          <span class="font-mono text-[14px] font-semibold text-charcoal w-12 shrink-0">${time}</span>
          <span class="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${cls} shrink-0">${label}</span>
          <span class="font-mono text-[13px] text-charcoal shrink-0">${escapeHtml(b.licensePlate || '—')}</span>
          ${nameSpan(b.contact?.name || b.contact?.email, b.customerId, b.contact?.email, 'text-[13px] text-dim truncate')}
          ${flightSlotEvent(e)}
        </button>
        ${rowMetaHtml({ phone: b.contact?.phone, flight: b.flightNumberPickup })}
      </div>`;
  }
  const tr = e.transfer;
  const isReturn = e.kind === 'transfer-return';
  const label = isReturn ? t('activity.kindTransferReturn') : t('activity.kindTransferOut');
  const place = isReturn ? (tr.returnTo || tr.pickupAddress || '') : (tr.pickupAddress || '');
  return `
    <div class="${rowCls}">
      <button type="button" data-go="transfers" data-at="${escapeHtml(e.at)}" data-focus="${escapeHtml(tr.id)}" class="${btnCls}">
        <span class="font-mono text-[14px] font-semibold text-charcoal w-12 shrink-0">${time}</span>
        <span class="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-mango/15 text-charcoal shrink-0">${label}</span>
        ${nameSpan(tr.contactName, null, tr.email, 'text-[13px] text-charcoal truncate')}
        <span class="text-[12px] text-dim truncate hidden sm:inline">${escapeHtml(place)}</span>
      </button>
      ${rowMetaHtml({ phone: tr.phone, flight: tr.returnFlightNumber })}
    </div>`;
}

// ── History rows (collapsed <details>, expand → full detail) ─────────────
function detailLine(label, valueHtml) {
  if (valueHtml == null || valueHtml === '' || valueHtml === '—') return '';
  return `<div class="flex justify-between gap-4 py-1 border-b border-frost-deep/50 last:border-0">
    <span class="text-[12px] text-dim shrink-0">${escapeHtml(label)}</span>
    <span class="text-[13px] text-charcoal text-right break-words min-w-0">${valueHtml}</span>
  </div>`;
}
// Shared with the check-in board (rowCells.js). The old local version put the
// raw value in the href; spaces and dashes break some dialers.
const telLink = (phone) => phoneLinkHtml(phone);
function bookingDetailHtml(b, locale) {
  const esc = escapeHtml;
  const start = b.dropoffAt || b.startDate;
  const end = b.pickupAt || b.endDate;
  const period = start ? `${fmtDateTime(start, locale)} → ${fmtDateTime(end, locale)}` : '';
  return [
    detailLine(t('activity.detailCustomer'), nameSpan(b.contact?.name, b.customerId, b.contact?.email, 'text-blueberry')),
    detailLine(t('activity.detailPhone'), telLink(b.contact?.phone)),
    detailLine(t('activity.detailEmail'), b.contact?.email ? esc(b.contact.email) : ''),
    detailLine(t('activity.detailPlate'), `<span class="font-mono">${esc(b.licensePlate || '—')}</span>`),
    detailLine(t('activity.detailBooking'), reservationCodeHtml(b)),
    detailLine(t('activity.detailPeriod'), esc(period)),
    detailLine(t('activity.detailStatus'), statusBadge(b.status)),
    detailLine(t('activity.detailTotal'), b.totalPrice != null ? `${Number(b.totalPrice)} ${esc(t('common.lei'))}` : ''),
    detailLine(t('activity.detailCheckedIn'), b.checkinTimestamp ? esc(fmtDateTime(b.checkinTimestamp, locale)) : ''),
    detailLine(t('activity.detailCheckedOut'), b.completedAt ? esc(fmtDateTime(b.completedAt, locale)) : ''),
  ].join('');
}
function transferDetailHtml(tr, isReturn, locale) {
  const esc = escapeHtml;
  const pax = [
    Number(tr.adults) ? `${Number(tr.adults)} ${t('transfers.adults')}` : '',
    Number(tr.children) ? `${Number(tr.children)} ${t('transfers.children')}` : '',
  ].filter(Boolean).join(' · ');
  const status = isReturn ? (tr.returnStatus || 'scheduled') : (tr.status || 'scheduled');
  return [
    detailLine(t('activity.detailCustomer'), nameSpan(tr.contactName, null, tr.email, 'text-blueberry')),
    detailLine(t('activity.detailPhone'), telLink(tr.phone)),
    detailLine(t('activity.detailEmail'), tr.email ? esc(tr.email) : ''),
    detailLine(t('transfers.pickupAddress'), esc(tr.pickupAddress || '')),
    detailLine(t('transfers.pickupAt'), esc(fmtDateTime(tr.pickupAt, locale))),
    detailLine(t('transfers.flightNumber'), tr.flightNumber ? `<span class="font-mono">${esc(tr.flightNumber)}</span>` : ''),
    detailLine(t('activity.detailPassengers'), esc(pax)),
    tr.transferType === 'roundtrip' ? detailLine(t('transfers.returnAt'), esc(fmtDateTime(tr.returnAt, locale))) : '',
    detailLine(t('activity.detailStatus'), statusBadge(status)),
    detailLine(t('transfers.price'), tr.price ? esc(tr.price) : ''),
    detailLine(t('transfers.groupNotes'), tr.groupNotes ? esc(tr.groupNotes) : ''),
  ].join('');
}
function historyRow(e, locale) {
  const time = fmtTime(e.at, locale);
  const isBooking = e.kind === 'checkin' || e.kind === 'checkout';
  let badgeCls, label, plate, nameHtml, status, detail, meta;
  const nameCls = 'text-[13px] text-dim truncate flex-1 min-w-0';
  if (isBooking) {
    const b = e.booking;
    const isCheckin = e.kind === 'checkin';
    badgeCls = isCheckin ? 'bg-leaf/10 text-leaf' : 'bg-blueberry/10 text-blueberry';
    label = isCheckin ? t('activity.kindCheckin') : t('activity.kindCheckout');
    plate = `<span class="font-mono text-[13px] text-charcoal shrink-0">${escapeHtml(b.licensePlate || '—')}</span>`;
    nameHtml = nameSpan(b.contact?.name || b.contact?.email, b.customerId, b.contact?.email, nameCls);
    status = b.status;
    detail = bookingDetailHtml(b, locale);
    meta = rowMetaHtml({ phone: b.contact?.phone, flight: b.flightNumberPickup });
  } else {
    const tr = e.transfer;
    const isReturn = e.kind === 'transfer-return';
    badgeCls = 'bg-mango/15 text-charcoal';
    label = isReturn ? t('activity.kindTransferReturn') : t('activity.kindTransferOut');
    plate = '';
    nameHtml = nameSpan(tr.contactName, null, tr.email, nameCls);
    status = isReturn ? (tr.returnStatus || 'scheduled') : (tr.status || 'scheduled');
    detail = transferDetailHtml(tr, isReturn, locale);
    meta = rowMetaHtml({ phone: tr.phone, flight: tr.returnFlightNumber });
  }
  return `
    <details class="group card-solid rounded-xl overflow-hidden">
      <summary class="list-none cursor-pointer p-3 flex items-center gap-3 hover:bg-frost transition-colors">
        <span class="font-mono text-[14px] font-semibold text-charcoal w-12 shrink-0">${time}</span>
        <span class="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${badgeCls} shrink-0">${label}</span>
        ${plate}
        ${nameHtml}
        ${meta}
        ${statusBadge(status)}
        <svg class="w-4 h-4 text-dim shrink-0 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </summary>
      <div class="px-3 pb-3 pt-1 border-t border-frost-deep">${detail}</div>
    </details>`;
}

const CAL_ICON = `<svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal/40" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 9h16.5M5.25 5.25h13.5A1.5 1.5 0 0 1 20.25 6.75v12A1.5 1.5 0 0 1 18.75 20.25H5.25A1.5 1.5 0 0 1 3.75 18.75v-12A1.5 1.5 0 0 1 5.25 5.25z"/></svg>`;

function tabCls(on) {
  return `px-4 py-2 rounded-xl text-[14px] font-semibold transition-colors ${on ? 'bg-blueberry text-white' : 'bg-white text-charcoal/70 hover:bg-frost border border-frost-deep'}`;
}
function presetCls(on) {
  return `px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${on ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost border border-frost-deep'}`;
}

export default function AdminActivity(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.activity')} — Admin — ManGO Parking`, description: t('activity.subtitle'), lang: locale });

  let bookings = [];
  let transfers = [];
  let unsubB = null;
  let unsubT = null;

  const params = new URLSearchParams(window.location.search);
  let activeTab = params.get('tab') === 'history' ? 'history' : 'upcoming';

  // History range state — default to the last 7 days (inclusive of today).
  let histPreset = 7;
  let histFrom = startOfDay(new Date(Date.now() - 6 * 86_400_000));
  let histTo = endOfDay(new Date());
  let histFp = null;

  const page = AdminLayout('/admin/activity', `
    <div class="mb-5">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.activity')}</h1>
      <p class="text-dim text-[15px] mt-1">${t('activity.subtitle')}</p>
    </div>
    <div class="flex gap-2 mb-5">
      <button type="button" data-tab="upcoming" class="${tabCls(activeTab === 'upcoming')}">${t('activity.tabUpcoming')}</button>
      <button type="button" data-tab="history" class="${tabCls(activeTab === 'history')}">${t('activity.tabHistory')}</button>
    </div>
    <div data-activity-body></div>
  `);
  initAdminNav(page);
  container.appendChild(page);

  const bodyEl = page.querySelector('[data-activity-body]');

  // ── Upcoming feed (next 48h) ──
  function buildEvents() {
    const now = Date.now();
    const end = now + WINDOW_MS;
    const inWin = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms >= now && ms <= end; };
    const events = [];
    for (const b of bookings) {
      if (b.type === 'credit') continue;
      const dropoff = b.dropoffAt || b.startDate;
      const pickup = b.pickupAt || b.endDate;
      if (b.status === 'upcoming' && dropoff && inWin(dropoff)) events.push({ at: dropoff, kind: 'checkin', booking: b });
      if (b.status === 'active' && pickup && inWin(pickup)) events.push({ at: pickup, kind: 'checkout', booking: b });
    }
    for (const tr of transfers) {
      if (tr.pickupAt && (tr.status || 'scheduled') === 'scheduled' && inWin(tr.pickupAt)) events.push({ at: tr.pickupAt, kind: 'transfer-out', transfer: tr });
      if (tr.transferType === 'roundtrip' && tr.returnAt && (tr.returnStatus || 'scheduled') === 'scheduled' && inWin(tr.returnAt)) events.push({ at: tr.returnAt, kind: 'transfer-return', transfer: tr });
    }
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return events;
  }

  function renderUpcoming() {
    if (histFp) { try { histFp.destroy(); } catch { /* noop */ } histFp = null; }
    const events = buildEvents();
    if (!events.length) {
      bodyEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('activity.empty')}</div>`;
      return;
    }
    const groups = [];
    let cur = null;
    for (const e of events) {
      const dayKey = bucharestDate(e.at);
      if (!cur || cur.dayKey !== dayKey) { cur = { dayKey, label: dayLabel(e.at, locale), items: [] }; groups.push(cur); }
      cur.items.push(e);
    }
    bodyEl.innerHTML = groups.map((g) => `
      <div class="mb-6">
        <h2 class="text-[12px] font-mono uppercase tracking-wider text-dim mb-2">${g.label} <span class="text-charcoal/30">· ${g.items.length}</span></h2>
        <div class="space-y-2">${g.items.map((e) => eventRow(e, locale)).join('')}</div>
      </div>
    `).join('');
    // Flag delayed/cancelled flights on the rendered rows (dormant until a
    // flight API key is configured; memoised across re-renders).
    enhanceFlightWarnings(bodyEl);
  }

  // ── History (chosen date range, all statuses, expandable) ──
  function buildHistoryEvents() {
    const fromMs = histFrom.getTime();
    const toMs = histTo.getTime();
    const inRange = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms >= fromMs && ms <= toMs; };
    const events = [];
    for (const b of bookings) {
      if (b.type === 'credit') continue;
      const dropoff = b.dropoffAt || b.startDate;
      const pickup = b.pickupAt || b.endDate;
      if (dropoff && inRange(dropoff)) events.push({ at: dropoff, kind: 'checkin', booking: b });
      if (pickup && inRange(pickup)) events.push({ at: pickup, kind: 'checkout', booking: b });
    }
    for (const tr of transfers) {
      if (tr.pickupAt && inRange(tr.pickupAt)) events.push({ at: tr.pickupAt, kind: 'transfer-out', transfer: tr });
      if (tr.transferType === 'roundtrip' && tr.returnAt && inRange(tr.returnAt)) events.push({ at: tr.returnAt, kind: 'transfer-return', transfer: tr });
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); // newest first
    return events;
  }

  function updateHistPresets() {
    bodyEl.querySelectorAll('[data-hist-preset]').forEach((btn) => {
      btn.className = presetCls(Number(btn.dataset.histPreset) === histPreset);
    });
  }

  function renderHistoryRows() {
    const rowsEl = bodyEl.querySelector('[data-hist-rows]');
    if (!rowsEl) return;
    const events = buildHistoryEvents();
    if (!events.length) {
      rowsEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('activity.historyEmpty')}</div>`;
      return;
    }
    const groups = [];
    let cur = null;
    for (const e of events) {
      const dayKey = bucharestDate(e.at);
      if (!cur || cur.dayKey !== dayKey) { cur = { dayKey, label: historyDayLabel(e.at, locale), items: [] }; groups.push(cur); }
      cur.items.push(e);
    }
    rowsEl.innerHTML = groups.map((g) => `
      <div class="mb-6">
        <h2 class="text-[12px] font-mono uppercase tracking-wider text-dim mb-2">${escapeHtml(g.label)} <span class="text-charcoal/30">· ${g.items.length}</span></h2>
        <div class="space-y-2">${g.items.map((e) => historyRow(e, locale)).join('')}</div>
      </div>
    `).join('');
  }

  function mountHistPicker() {
    const input = bodyEl.querySelector('[data-hist-range]');
    if (!input) return;
    if (histFp) { try { histFp.destroy(); } catch { /* noop */ } histFp = null; }
    histFp = flatpickr(input, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: locale === 'en' ? 'M j, Y' : 'j M Y',
      locale: locale === 'ro' ? Romanian : 'default',
      defaultDate: [histFrom, histTo],
      maxDate: 'today',
      onClose: (dates) => {
        if (dates.length === 2) {
          histFrom = startOfDay(dates[0]);
          histTo = endOfDay(dates[1]);
          histPreset = null; // a custom range clears the preset highlight
          updateHistPresets();
          renderHistoryRows();
        }
      },
    });
  }

  function renderHistory() {
    // Build the shell (range bar + rows container) once; on data updates we
    // refresh only the rows so the flatpickr instance isn't churned.
    if (!bodyEl.querySelector('[data-hist-rows]')) {
      bodyEl.innerHTML = `
        <div class="mb-5 flex flex-wrap items-center gap-2">
          <span class="text-[12px] uppercase tracking-wider text-dim font-mono mr-1">${t('activity.rangeLabel')}</span>
          <button type="button" data-hist-preset="7" class="${presetCls(histPreset === 7)}">${t('activity.last7')}</button>
          <button type="button" data-hist-preset="30" class="${presetCls(histPreset === 30)}">${t('activity.last30')}</button>
          <span class="relative inline-flex items-center">
            ${CAL_ICON}
            <input type="text" data-hist-range placeholder="${t('activity.rangeCustom')}"
              class="pl-3 pr-9 py-1.5 rounded-lg text-[13px] font-semibold cursor-pointer bg-white text-charcoal/70 hover:bg-frost border border-frost-deep min-w-[210px] focus:outline-none">
          </span>
        </div>
        <div data-hist-rows></div>`;
      mountHistPicker();
    }
    updateHistPresets();
    renderHistoryRows();
  }

  function applyPreset(days) {
    histPreset = days;
    histTo = endOfDay(new Date());
    histFrom = startOfDay(new Date(Date.now() - (days - 1) * 86_400_000));
    if (histFp) histFp.setDate([histFrom, histTo], false); // no triggerChange → no onClose loop
    updateHistPresets();
    renderHistoryRows();
  }

  function renderTabs() {
    page.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.className = tabCls(btn.dataset.tab === activeTab);
    });
  }

  function render() {
    renderTabs();
    if (activeTab === 'history') renderHistory();
    else renderUpcoming();
  }

  unsubB = subscribeCollection('bookings', (rows) => { bookings = rows; render(); });
  unsubT = subscribeCollection('transfers', (rows) => { transfers = rows; render(); });
  render();

  // Tab switch — sync the URL so refresh/back keeps the view.
  delegate(page, 'click', '[data-tab]', (_e, btn) => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;
    activeTab = tab;
    const url = new URL(window.location.href);
    if (tab === 'history') url.searchParams.set('tab', 'history');
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url.pathname + url.search);
    render();
  });

  // History range presets.
  delegate(page, 'click', '[data-hist-preset]', (_e, btn) => applyPreset(Number(btn.dataset.histPreset)));

  // Client name (anywhere in either tab) → open their profile.
  delegate(page, 'click', '[data-user-link]', (e, el) => {
    e.preventDefault();  // also stops the <details> summary from toggling
    e.stopPropagation();
    openUserDetail({ customerId: el.dataset.uid || null, email: el.dataset.email || null, displayName: el.textContent.trim() });
  });

  // Reservation number → the full record in Istoric.
  wireReservationLinks(page);

  // Upcoming rows: jump to the relevant check-in tab, scoped to the clicked
  // event's day, and ask that page to scroll to + highlight the reservation.
  // A click on the name / reservation-number is handled above — skip it here.
  delegate(page, 'click', '[data-go]', (e, btn) => {
    if (e.target.closest('[data-user-link], [data-reservation-link]')) return;
    const goParams = new URLSearchParams({ tab: btn.dataset.go });
    const day = localDayKey(btn.dataset.at);
    if (day) goParams.set('window', `${day}..${day}`);
    if (btn.dataset.focus) goParams.set('focus', btn.dataset.focus);
    navigate(`${localePath('/admin/checkins')}?${goParams.toString()}`);
  });

  return () => {
    if (unsubB) unsubB();
    if (unsubT) unsubT();
    if (histFp) { try { histFp.destroy(); } catch { /* noop */ } histFp = null; }
  };
}
