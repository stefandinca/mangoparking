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
  const b = { type: 'longTerm', pickupAt: '2026-07-20T09:00:00Z', days: 5, totalPrice: 250 };

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
