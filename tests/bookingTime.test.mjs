// Overstay / deadline / per-credit math — the client-side money helpers
// behind the check-in board's overdue tab and the overstay-charge dialog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE_THRESHOLD_MS, bucharestDate, bucharestCutoffMs,
  pickupDeadlineMs, perCreditPrice, overstayInfo, fmtDateTime,
} from '../src/utils/bookingTime.js';

const H = 3_600_000;
const DAY = 86_400_000;

test('bucharestCutoffMs: 20:00 local across DST', () => {
  // Winter (+02): 20:00 Bucharest = 18:00 UTC.
  assert.equal(
    bucharestCutoffMs('2026-01-15T10:00:00Z', 20),
    Date.parse('2026-01-15T18:00:00Z'),
  );
  // Summer (+03): 20:00 Bucharest = 17:00 UTC.
  assert.equal(
    bucharestCutoffMs('2026-07-15T10:00:00Z', 20),
    Date.parse('2026-07-15T17:00:00Z'),
  );
  assert.equal(bucharestCutoffMs(null), null);
  assert.equal(bucharestCutoffMs('garbage'), null);
});

test('bucharestDate: instant → lot-local calendar day', () => {
  // 22:30 UTC in winter is already the next Bucharest day.
  assert.equal(bucharestDate('2026-01-15T22:30:00Z'), '2026-01-16');
  assert.equal(bucharestDate('2026-07-15T10:00:00Z'), '2026-07-15');
});

test('pickupDeadlineMs: long-term uses the scheduled pick-up, commuter the 20:00 cutoff', () => {
  const lt = { type: 'longTerm', pickupAt: '2026-07-20T09:00:00Z' };
  assert.equal(pickupDeadlineMs(lt), Date.parse('2026-07-20T09:00:00Z'));

  const commuter = { type: 'credit', checkinTimestamp: '2026-07-15T06:00:00Z' };
  assert.equal(pickupDeadlineMs(commuter), Date.parse('2026-07-15T17:00:00Z')); // 20:00 +03

  assert.equal(pickupDeadlineMs({ type: 'longTerm' }), null);
});

test('overstayInfo: null within the 2h grace, then whole days at the booking rate', () => {
  const pickup = Date.parse('2026-07-20T09:00:00Z');
  // Drop-off is exactly 5x24h before the pick-up, so the days the customer
  // bought run out at the same instant the pick-up grace does — the one case
  // where the two possible anchors agree.
  const b = {
    type: 'longTerm',
    dropoffAt: '2026-07-15T09:00:00Z',
    pickupAt: '2026-07-20T09:00:00Z',
    days: 5,
    totalPrice: 250,
  };

  // 1h59m late — still inside the grace.
  assert.equal(overstayInfo(b, 0, pickup + OVERDUE_THRESHOLD_MS - 60_000), null);
  // 2h01m late — 1 day owed at 250/5 = 50 lei.
  assert.deepEqual(
    overstayInfo(b, 0, pickup + OVERDUE_THRESHOLD_MS + 60_000),
    { daysLate: 1, perDay: 50, amount: 50 },
  );
  // 2 days + grace + 1h late — 3rd day starts (ceil).
  assert.deepEqual(
    overstayInfo(b, 0, pickup + OVERDUE_THRESHOLD_MS + 2 * DAY + H),
    { daysLate: 3, perDay: 50, amount: 150 },
  );
});

// ── Regression: overstay must agree with the pricing engine ──────────────
// Reported 2026-09-04 for LT-VARZW and LT-HXT69. Both were quoted a 20-lei
// overstay they did not owe, because the charge was measured from the
// SCHEDULED PICK-UP while the price is measured from the DROP-OFF. The gap
// between the two is exactly the slack that rounding the stay up to a whole
// day already sold the customer.

// The app's billing rule, restated here on purpose rather than imported: a
// test that shares a helper with the code under test cannot catch that helper
// being wrong. Mirrors functions/src/pricingValidate.js + roTime.js deriveDays.
const BILLING_GRACE_MS = 2 * 60 * 60 * 1000;
function paidDaysBetween(fromIso, toIso) {
  const span = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.max(1, Math.ceil((span - BILLING_GRACE_MS) / DAY));
}

test('overstayInfo: nothing is owed until the days the customer paid for run out', () => {
  // LT-VARZW / LT-HXT69: dropped off 23 Aug 05:00, booked pick-up 29 Aug 17:45
  // local. 6d12h45m rounds up to 7 billing days at 139 lei, so the customer
  // bought parking through 30 Aug 07:00 local — 11h15m past the pick-up time.
  const b = {
    type: 'longTerm',
    dropoffAt: '2026-08-23T02:00:00.000Z',
    pickupAt: '2026-08-29T14:45:00.000Z',
    days: 7,
    totalPrice: 139,
  };
  assert.equal(paidDaysBetween(b.dropoffAt, b.pickupAt), b.days);  // premise

  // Left at 01:31 local on 30 Aug: 7h46m past the booked pick-up, still inside
  // the 7th day they paid for. This is what was wrongly billed 20 lei.
  assert.equal(overstayInfo(b, 0, Date.parse('2026-08-29T22:31:34Z')), null);
  // A minute before the 7 paid days elapse — still nothing owed.
  assert.equal(overstayInfo(b, 0, Date.parse('2026-08-30T03:59:00Z')), null);
  // A minute after — the 8th day has genuinely started.
  assert.deepEqual(
    overstayInfo(b, 0, Date.parse('2026-08-30T04:01:00Z')),
    { daysLate: 1, perDay: 20, amount: 20 },
  );
});

test('overstayInfo: extra days never disagree with what the pricer would bill', () => {
  const b = {
    type: 'longTerm',
    dropoffAt: '2026-08-23T02:00:00.000Z',
    pickupAt: '2026-08-29T14:45:00.000Z',
    days: 7,
    totalPrice: 139,
  };
  // Sweep hour by hour across the booked pick-up and the next three days.
  const from = Date.parse(b.pickupAt) - 6 * H;
  for (let now = from; now <= from + 4 * DAY; now += H) {
    const billed = paidDaysBetween(b.dropoffAt, new Date(now).toISOString());
    const owed = Math.max(0, billed - b.days);
    const info = overstayInfo(b, 0, now);
    assert.equal(info ? info.daysLate : 0, owed,
      `at ${new Date(now).toISOString()} the pricer bills ${billed} days`);
  }
});

test('overstayInfo: falls back to the pick-up anchor when the drop-off is unusable', () => {
  // Legacy/broker rows can reach the board without a parseable drop-off. Better
  // to keep the old (over-eager) estimate than to stop charging overstays.
  const pickup = Date.parse('2026-07-20T09:00:00Z');
  const b = { type: 'longTerm', pickupAt: '2026-07-20T09:00:00Z', days: 5, totalPrice: 250 };
  assert.equal(overstayInfo(b, 0, pickup + OVERDUE_THRESHOLD_MS - 60_000), null);
  assert.deepEqual(
    overstayInfo(b, 0, pickup + OVERDUE_THRESHOLD_MS + 60_000),
    { daysLate: 1, perDay: 50, amount: 50 },
  );
});

test('overstayInfo: commuters valued at the per-credit price', () => {
  const b = { type: 'credit', checkinTimestamp: '2026-07-15T06:00:00Z' };
  const deadline = Date.parse('2026-07-15T17:00:00Z');
  assert.deepEqual(
    overstayInfo(b, 35, deadline + OVERDUE_THRESHOLD_MS + 60_000),
    { daysLate: 1, perDay: 35, amount: 35 },
  );
});

test('perCreditPrice: cheapest active pack rate, rounded', () => {
  assert.equal(perCreditPrice([
    { price: 400, quantity: 10 },  // 40/credit
    { price: 175, quantity: 5 },   // 35/credit — cheapest
  ]), 35);
  assert.equal(perCreditPrice([{ price: 0, quantity: 5 }]), 0);
  assert.equal(perCreditPrice([]), 0);
  assert.equal(perCreditPrice(null), 0);
});

test('fmtDateTime: Bucharest-pinned rendering, em-dash on empty', () => {
  // 2026-07-15T07:00Z = 10:00 Bucharest summer time.
  assert.match(fmtDateTime('2026-07-15T07:00:00Z', 'ro'), /15\.07\.26.*10:00/);
  assert.equal(fmtDateTime(null, 'ro'), '—');
  // Firestore Timestamp shape goes through anyToIso, not toString.
  assert.match(fmtDateTime({ seconds: 1752570000, nanoseconds: 0 }, 'ro'), /\d{2}\.\d{2}\.\d{2}/);
});
