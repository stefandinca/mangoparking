// Unit tests for the ParkVia (ParkCloud) import mapper — the one piece of the
// scaffold with real logic. Run: `cd functions && npm test`.
//
// ⚠️ The sample XML below is a PLACEHOLDER shaped like a plausible ParkCloud
// reservation. Once the real ParkCloud Operator API schema is known, update
// BOTH this fixture and the field paths in parkvia.js → mapParkviaBookingToImport,
// then re-run this test. These assertions are what pin the mapping contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStringPromise } from 'xml2js';
import {
  mapParkviaBookingToImport,
  deriveDays,
  toIso,
  parkviaRefDocId,
} from '../src/parkvia.js';

// A single reservation node, as it would arrive after parseStringPromise with
// { explicitArray: false } (single-element nodes collapse to plain values).
const SAMPLE_XML = `
<booking>
  <bookingReference>PV-100245</bookingReference>
  <vehicleRegistration>b 123 xyz</vehicleRegistration>
  <arrivalDateTime>2026-08-01T06:30:00Z</arrivalDateTime>
  <departureDateTime>2026-08-05T22:15:00Z</departureDateTime>
  <totalPrice>184.50</totalPrice>
  <customerName>Ion Popescu</customerName>
  <customerEmail>Ion.Popescu@example.com</customerEmail>
  <customerPhone>+40 720 000 111</customerPhone>
  <status>Confirmed</status>
</booking>`;

test('maps a well-formed ParkCloud reservation to import params', async () => {
  const parsed = await parseStringPromise(SAMPLE_XML, { explicitArray: false, trim: true });
  const imp = mapParkviaBookingToImport(parsed.booking);

  assert.equal(imp.ref, 'PV-100245');
  assert.equal(imp.plate, 'B123XYZ', 'plate is upper-cased with spaces/hyphens stripped');
  assert.equal(imp.dropoffAt, '2026-08-01T06:30:00.000Z');
  assert.equal(imp.pickupAt, '2026-08-05T22:15:00.000Z');
  assert.equal(imp.totalPrice, 184.5);
  assert.equal(imp.brokerName, 'ParkVia');
  assert.equal(imp.rawStatus, 'active');
  assert.deepEqual(imp.contact, {
    name: 'Ion Popescu',
    email: 'ion.popescu@example.com',   // lower-cased
    phone: '+40 720 000 111',
  });
  // 4d ~16h span, 2h grace applied once → ceil ≈ 5 billing days.
  assert.equal(imp.days, 5);
});

test('flags a cancelled reservation via rawStatus', async () => {
  const xml = SAMPLE_XML.replace('<status>Confirmed</status>', '<status>Cancelled</status>');
  const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
  const imp = mapParkviaBookingToImport(parsed.booking);
  assert.equal(imp.rawStatus, 'cancelled');
});

test('throws on a missing booking reference', () => {
  assert.throws(() => mapParkviaBookingToImport({ vehicleRegistration: 'B1XYZ' }), /reference/);
});

test('throws on a missing plate', () => {
  assert.throws(
    () => mapParkviaBookingToImport({ bookingReference: 'PV-1', arrivalDateTime: '2026-08-01T06:00:00Z', departureDateTime: '2026-08-02T06:00:00Z' }),
    /plate/,
  );
});

test('throws on missing/invalid dates', () => {
  assert.throws(
    () => mapParkviaBookingToImport({ bookingReference: 'PV-1', vehicleRegistration: 'B1XYZ' }),
    /dates/,
  );
});

test('deriveDays: 2h grace applied once, minimum 1', () => {
  // days = ceil((span - 2h) / 24h), min 1.
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T09:00:00Z'), 1, '25h → 1 day (within 24h+grace)');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T10:00:00Z'), 1, '26h → exactly 1 day');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-02T12:00:00Z'), 2, '28h → 2 days');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-03T10:00:00Z'), 2, '50h → 2 days');
  assert.equal(deriveDays('2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z'), 1, 'sub-day → 1');
  assert.equal(deriveDays('bad', 'worse'), 1, 'unparseable → 1');
});

test('toIso normalises parseable datetimes and rejects junk', () => {
  assert.equal(toIso('2026-08-01T06:30:00Z'), '2026-08-01T06:30:00.000Z');
  assert.equal(toIso(''), '');
  assert.equal(toIso('not-a-date'), '');
});

test('parkviaRefDocId strips Firestore-illegal characters', () => {
  assert.equal(parkviaRefDocId('PV/100/245'), 'PV_100_245');
  assert.equal(parkviaRefDocId('a.b#c$d[e]'), 'a_b_c_d_e_');
});
