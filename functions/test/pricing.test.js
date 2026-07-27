// Pure core of the server-authoritative long-term pricer
// (src/pricingValidate.js): billing-day derivation with the 2h grace, tier
// selection, seasonal-period matching on the Bucharest-local pickup day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingDays, tierForDays, findActivePeriod, bucharestDay } from '../src/pricingValidate.js';

const H = 3_600_000;
const DAY = 86_400_000;
const t0 = Date.parse('2026-07-01T09:00:00Z');

test('billingDays: 2h grace forgives a late pick-up before charging a day', () => {
  assert.equal(billingDays(t0, t0 + DAY), 1);
  assert.equal(billingDays(t0, t0 + DAY + 2 * H), 1);       // exactly the grace — still 1 day
  assert.equal(billingDays(t0, t0 + DAY + 2 * H + 60_000), 2); // one minute past it — 2nd day
  assert.equal(billingDays(t0, t0 + 30 * 60_000), 1);       // sub-day stay is 1 day minimum
});

test('billingDays: invalid or inverted ranges are 0', () => {
  assert.equal(billingDays(t0, t0), 0);
  assert.equal(billingDays(t0, t0 - DAY), 0);
  assert.equal(billingDays(NaN, t0), 0);
});

const TIERS = [
  { minDays: 1, maxDays: 3, perDay: 60 },
  { minDays: 4, maxDays: 7, perDay: 50 },
  { minDays: 8, maxDays: null, perDay: 40 },
];

test('tierForDays: boundary days land in the right tier', () => {
  assert.equal(tierForDays(1, TIERS).perDay, 60);
  assert.equal(tierForDays(3, TIERS).perDay, 60);
  assert.equal(tierForDays(4, TIERS).perDay, 50);
  assert.equal(tierForDays(7, TIERS).perDay, 50);
  assert.equal(tierForDays(8, TIERS).perDay, 40);
  assert.equal(tierForDays(365, TIERS).perDay, 40); // null maxDays = open-ended
});

test('tierForDays: uncovered day count falls back to the last tier', () => {
  const gappy = [{ minDays: 1, maxDays: 3, perDay: 60 }, { minDays: 8, maxDays: null, perDay: 40 }];
  assert.equal(tierForDays(5, gappy).perDay, 40); // the documented catch-all behavior
});

test('findActivePeriod: inclusive date-range match, inactive periods skipped', () => {
  const periods = [
    { id: 'off', active: false, startDate: '2026-07-01', endDate: '2026-07-31' },
    { id: 'summer', active: true, startDate: '2026-07-01', endDate: '2026-07-31' },
  ];
  assert.equal(findActivePeriod(periods, '2026-07-01')?.id, 'summer'); // inclusive start
  assert.equal(findActivePeriod(periods, '2026-07-31')?.id, 'summer'); // inclusive end
  assert.equal(findActivePeriod(periods, '2026-08-01'), null);
  assert.equal(findActivePeriod(periods, null), null);
  assert.equal(findActivePeriod([{ active: true }], '2026-07-15'), null); // missing dates
});

test('bucharestDay: pickup buckets to the lot-local day, not UTC', () => {
  // 23:30 UTC in summer = 02:30 next day in Bucharest.
  assert.equal(bucharestDay('2026-07-14T23:30:00Z'), '2026-07-15');
  assert.equal(bucharestDay('2026-01-15T10:00:00Z'), '2026-01-15');
  assert.equal(bucharestDay('garbage'), null);
  assert.equal(bucharestDay(null), null);
});
