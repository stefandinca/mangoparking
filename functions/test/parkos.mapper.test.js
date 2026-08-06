// Unit tests for the Parkos import mapper + poll-window helpers — the pieces
// with real logic. Run: `cd functions && npm test`.
//
// The fixture is a REAL record captured live on 2026-08-06 from
// GET /v1/reservations for merchant 3079 (ManGo Parking), with the customer's
// details replaced. These assertions pin the mapping contract: separate
// date/time halves in Bucharest wall-time, no email field at all, a
// space-separated local-time `cancelled_at` that is only ever read as a
// boolean, and `data` arriving as an object keyed "0","1",… rather than an
// array.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapParkosReservationToImport,
  buildParkosNotes,
  parkosErrorText,
  parkosWindowDays,
  parkosWindowRange,
  parkosRefDocId,
  PARKOS_FEED_MAX_DAYS,
  PARKOS_LOOKBACK_DAYS,
} from '../src/parkos.js';
import { bucharestWallToIso, bucharestDayKey } from '../src/roTime.js';

const SAMPLE = {
  code: 'B2MB6B33',
  name: 'Ion Popescu',
  lang: 'ro',
  phone: '+40 769000111',
  car_brand_model: 'Kia Rio 2',
  car_license_plate: 'ab 06-vit',
  arrival_date: '2026-08-23',
  arrival_time: '23:00',
  departure_date: '2026-08-28',
  departure_time: '10:30',
  flight_departure_nr: '3285',
  flight_return_nr: '3286',
  persons: 5,
  days: 5,
  parking_type: 'shuttle',
  location_type: 'outdoor',
  airport: '',
  products: [],
  fees: [],
  currency: 'RON',
  total_price: 110,
  paid: true,
  merchant: 'ManGo Parking',
  merchant_id: 3079,
  created_at: '2026-07-31T15:07:30.000000Z',
  updated_at: '2026-07-31T15:12:17.000000Z',
  cancelled_at: null,
};

test('maps a real Parkos reservation to import params', () => {
  const imp = mapParkosReservationToImport(SAMPLE);

  assert.equal(imp.ref, 'B2MB6B33');
  assert.equal(imp.plate, 'AB06VIT', 'upper-cased, spaces/hyphens stripped');
  // 2026-08-23 23:00 Bucharest is EEST (+03:00) → 20:00Z the same day. This is
  // the exact pairing verified against a desk-entered twin of another record.
  assert.equal(imp.dropoffAt, '2026-08-23T20:00:00.000Z');
  assert.equal(imp.pickupAt, '2026-08-28T07:30:00.000Z');
  assert.equal(imp.arrivalDay, '2026-08-23', 'Bucharest calendar day, not the UTC one');
  assert.equal(imp.days, 5, "the feed's own billed day count wins");
  assert.equal(imp.totalPrice, 110);
  assert.equal(imp.currency, 'RON');
  assert.equal(imp.paid, true);
  assert.equal(imp.passengers, 5);
  assert.equal(imp.flightNumberDropoff, '3285');
  assert.equal(imp.flightNumberPickup, '3286');
  assert.equal(imp.brokerName, 'Parkos');
  assert.equal(imp.rawStatus, 'active');
  assert.equal(imp.updatedAt, '2026-07-31T15:12:17.000Z');
  assert.deepEqual(imp.contact, {
    name: 'Ion Popescu',
    email: '',                       // Parkos never sends one
    phone: '+40 769000111',
  });
  assert.equal(imp.notes, 'Mașină: Kia Rio 2');
});

test('a non-null cancelled_at is the only cancellation signal', () => {
  // Note the shape: space-separated local time, NOT the ISO-Z of created/updated.
  const imp = mapParkosReservationToImport({ ...SAMPLE, cancelled_at: '2026-06-18 10:49:00' });
  assert.equal(imp.rawStatus, 'cancelled');
  assert.equal(mapParkosReservationToImport({ ...SAMPLE, cancelled_at: '' }).rawStatus, 'active');
  assert.equal(mapParkosReservationToImport(SAMPLE).rawStatus, 'active');
});

test('unpaid reservations surface the amount to collect at the desk', () => {
  const imp = mapParkosReservationToImport({ ...SAMPLE, paid: false, total_price: 250 });
  assert.equal(imp.paid, false);
  assert.equal(imp.totalPrice, 250, 'still the full customer price on the booking');
  assert.match(imp.notes, /de încasat 250 RON la sosire/);
});

test('days falls back to the app billing rule when the feed omits it', () => {
  // 2026-08-23 23:00 → 2026-08-28 10:30 = 4d 11h30, minus the single 2h grace,
  // ceil → 5 — the same answer the feed gives, which is why preferring it is safe.
  assert.equal(mapParkosReservationToImport({ ...SAMPLE, days: null }).days, 5);
  assert.equal(mapParkosReservationToImport({ ...SAMPLE, days: 0 }).days, 5);
});

test('throws on missing code / plate / dates', () => {
  assert.throws(() => mapParkosReservationToImport({}), /code/);
  assert.throws(
    () => mapParkosReservationToImport({ ...SAMPLE, car_license_plate: '' }),
    /plate/,
  );
  assert.throws(
    () => mapParkosReservationToImport({ ...SAMPLE, departure_date: '' }),
    /dates/,
  );
});

test('notes: extras degrade gracefully whatever shape they arrive in', () => {
  const base = { paid: true, totalPrice: 0, currency: 'RON' };
  assert.equal(buildParkosNotes({ ...base, raw: {} }), null, 'nothing to say → no note');
  assert.equal(
    buildParkosNotes({ ...base, raw: { products: [{ name: 'Spălare', price: 50 }] } }),
    'Extra: Spălare (50)',
  );
  assert.equal(
    buildParkosNotes({ ...base, raw: { fees: ['Taxă aeroport'] } }),
    'Extra: Taxă aeroport',
  );
  // Unknown object shape must never render as "[object Object]".
  const odd = buildParkosNotes({ ...base, raw: { products: [{ sku: 'X1' }] } });
  assert.match(odd, /Extra: \{"sku":"X1"\}/);
});

test('bucharestWallToIso: date+time halves, DST-aware', () => {
  assert.equal(bucharestWallToIso('2026-08-23', '23:00'), '2026-08-23T20:00:00.000Z', 'summer = EEST +03:00');
  assert.equal(bucharestWallToIso('2026-01-15', '10:00'), '2026-01-15T08:00:00.000Z', 'winter = EET +02:00');
  assert.equal(bucharestWallToIso('2026-08-23', '9:05:30'), '2026-08-23T06:05:30.000Z', 'single-digit hour + seconds');
  assert.equal(bucharestWallToIso('2026-08-23', ''), '2026-08-22T21:00:00.000Z', 'missing time → local midnight');
  assert.equal(bucharestWallToIso('', '10:00'), '');
  assert.equal(bucharestWallToIso('not-a-date', '10:00'), '');
});

test('bucharestDayKey: the local arrival day, which is what the desk twin shares', () => {
  // 20:00Z in August is 23:00 local the SAME day; 22:00Z is 01:00 the NEXT day.
  assert.equal(bucharestDayKey('2026-08-23T20:00:00.000Z'), '2026-08-23');
  assert.equal(bucharestDayKey('2026-08-23T22:00:00.000Z'), '2026-08-24');
  assert.equal(bucharestDayKey('2026-07-27'), '2026-07-27', 'date-only startDate (legacy desk rows)');
  assert.equal(bucharestDayKey(''), '');
});

test('parkosWindowDays: rolling overlap, stretched over downtime, capped', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  assert.equal(parkosWindowDays(null, now), PARKOS_FEED_MAX_DAYS, 'never synced → the whole feed');
  assert.equal(parkosWindowDays('nonsense', now), PARKOS_FEED_MAX_DAYS);
  assert.equal(parkosWindowDays('2026-08-06T11:45:00Z', now), PARKOS_LOOKBACK_DAYS, 'fresh → the rolling overlap');
  assert.equal(parkosWindowDays('2026-07-27T12:00:00Z', now), 11, '10d gap + 1d margin');
  assert.equal(parkosWindowDays('2020-01-01T00:00:00Z', now), PARKOS_FEED_MAX_DAYS, 'long downtime is capped');
});

test('parkosWindowRange: inclusive dates, and till runs a day past today', () => {
  const now = Date.parse('2026-08-06T12:00:00Z');
  assert.deepEqual(parkosWindowRange(3, now), { from: '2026-08-03', till: '2026-08-07' });
  assert.deepEqual(parkosWindowRange(0, now), { from: '2026-08-06', till: '2026-08-07' });
});

test('parkosErrorText unwraps both documented error envelopes', () => {
  assert.equal(parkosErrorText('{"message":"The route v1/x could not be found."}'),
    'The route v1/x could not be found.');
  assert.equal(parkosErrorText('{"message":{"message":"Price_group_id is required","status_code":404}}'),
    'Price_group_id is required');
  assert.equal(parkosErrorText('<html>502</html>'), '<html>502</html>', 'non-JSON passes through');
});

test('parkosRefDocId strips Firestore-illegal characters', () => {
  assert.equal(parkosRefDocId('PK/100/245'), 'PK_100_245');
  assert.equal(parkosRefDocId('a.b#c$d[e]'), 'a_b_c_d_e_');
});
