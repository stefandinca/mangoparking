// Pure booking time/money helpers — deadline, overstay and per-credit math
// shared by the check-in board, the reservation detail and the dialogs in
// components/admin/bookingActions.js (which re-exports them, so pages keep
// importing from there). Lives here, DOM- and Firebase-free, so the money
// math is unit-testable under node --test.

import { anyToIso } from './date.js';

// Grace between the pickup deadline and when a booking reads as overdue /
// starts owing extra days. Mirrored by AdminCheckIns' OVERDUE_THRESHOLD_MS.
export const OVERDUE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// The grace the PRICING engine applies once at the end of a stay — mirrors
// BILLING_GRACE_MS in functions/src/pricingValidate.js, GRACE_MS in
// functions/src/roTime.js, and the local copies in BookingLongTerm.js /
// CreateTransactionModal.js. Numerically the same 2h as OVERDUE_THRESHOLD_MS
// but a different question: that one decides when the board SHOWS a car as
// late, this one decides what the customer is CHARGED. Treating them as
// interchangeable is what let overstayInfo bill days the pricer never would.
export const BILLING_GRACE_MS = 2 * 60 * 60 * 1000;

export function fmtDateTime(iso, locale) {
  iso = anyToIso(iso);
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Pinned to the lot's timezone (matches the admin reservation record and
    // the customer emails) so a staff device with a foreign/mis-set timezone
    // still shows the times the customer was promised.
    return d.toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Bucharest',
    });
  } catch { return iso; }
}

export function bucharestDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Bucharest',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch { return null; }
}

// Europe/Bucharest UTC offset (minutes) at a given instant — anchors the
// commuter 20:00 cutoff to local wall-clock time across DST.
function bucharestOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = +p.hour === 24 ? 0 : +p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Absolute ms for `hour`:00 Europe/Bucharest on the local calendar day of `iso`.
export function bucharestCutoffMs(iso, hour = 20) {
  const day = bucharestDate(iso);
  if (!day) return null;
  const guessUtc = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  if (!Number.isFinite(guessUtc)) return null;
  const off = bucharestOffsetMinutes(new Date(guessUtc));
  return guessUtc - off * 60000;
}

// The instant a booking's 2h overstay grace starts. Long-term: the scheduled
// pick-up. Credit/commuter: 20:00 Europe/Bucharest on the check-in day — the
// end of operating hours (matches the commuter 7PM "overnight fee" reminder).
export function pickupDeadlineMs(b) {
  if (b.type === 'credit') {
    return bucharestCutoffMs(b.checkinTimestamp || b.startDate, 20);
  }
  const pickup = b.pickupAt || b.endDate;
  if (!pickup) return null;
  const ms = new Date(pickup).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Cheapest per-credit price across the active packs (matches BookingCredits'
// custom-quantity rate). Used to value a commuter's overstay days.
export function perCreditPrice(packs) {
  const rates = (packs || [])
    .map((p) => Number(p.price) / Number(p.quantity))
    .filter((r) => Number.isFinite(r) && r > 0);
  return rates.length ? Math.round(Math.min(...rates)) : 0;
}

// The instant a booking stops being covered by what the customer already paid
// and starts owing another day.
//
// Long-term: NOT the scheduled pick-up. The price was derived as
// max(1, ceil((pickup - dropoff - 2h) / 24h)) days measured FROM THE DROP-OFF,
// so the stay is paid up to `dropoff + 2h + days × 24h`. Rounding up means that
// is normally LATER than the booked pick-up — a 6d12h45m stay is sold as 7 days
// and the rest of that 7th day belongs to the customer. Anchoring on the
// pick-up instead billed those hours twice (LT-VARZW / LT-HXT69, 2026-09-04:
// 20 lei demanded 11h15m before the stay had actually run out).
//
// Commuter (credit): 20:00 local on the check-in day plus the same grace —
// there is no drop-off/pick-up span to price against.
function overstayFreeUntilMs(b) {
  if (b.type !== 'credit') {
    const dropoff = Date.parse(anyToIso(b.dropoffAt) || '');
    const days = Number(b.days) || 0;
    if (Number.isFinite(dropoff) && days > 0) {
      return dropoff + BILLING_GRACE_MS + days * 86_400_000;
    }
    // No usable drop-off (a legacy or malformed row): fall back to the pick-up
    // anchor. Over-estimating is better than silently never charging again.
  }
  const dl = pickupDeadlineMs(b);
  return dl == null ? null : dl + OVERDUE_THRESHOLD_MS;
}

// Extra days owed when a car is still on the lot past everything the customer
// paid for, valued at the booking's own daily rate (totalPrice / days). Returns
// null when there is nothing extra to collect. Drives the late-check-out
// warning, so it must never invent a day the pricer would not bill.
// `now` is injectable for tests only — production callers omit it.
export function overstayInfo(b, perCredit = 0, now = Date.now()) {
  const freeUntil = overstayFreeUntilMs(b);
  if (freeUntil == null) return null;
  const overMs = now - freeUntil;
  if (overMs <= 0) return null;
  const daysLate = Math.ceil(overMs / 86_400_000);
  // Long-term: the booking's own daily rate. Commuter: each extra day is
  // another credit, valued at the standard per-credit price.
  let perDay;
  if (b.type === 'credit') {
    perDay = perCredit;
  } else {
    const days = Number(b.days) || 0;
    const total = Number(b.totalPrice) || 0;
    perDay = days > 0 ? Math.round(total / days) : 0;
  }
  return { daysLate, perDay, amount: daysLate * perDay };
}
