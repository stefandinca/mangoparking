// Pure date-utility tests: anyToIso normalization and the Europe/Bucharest
// wall-clock ↔ instant converters every booking path depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyToIso, bucharestLocalToIso, isoToBucharestLocal, daysBetween } from '../src/utils/date.js';

test('anyToIso: strings pass through untouched', () => {
  assert.equal(anyToIso('2026-05-08T06:37:55.520Z'), '2026-05-08T06:37:55.520Z');
  assert.equal(anyToIso('2026-05-08'), '2026-05-08');
});

test('anyToIso: Firestore Timestamp shapes normalize to the same instant', () => {
  const want = new Date(1778224675520).toISOString();
  assert.equal(anyToIso({ seconds: 1778224675, nanoseconds: 520000000 }), want);
  assert.equal(anyToIso({ _seconds: 1778224675, _nanoseconds: 520000000 }), want);
  assert.equal(anyToIso({ toDate: () => new Date(1778224675520) }), want);
});

test('anyToIso: Date instances and millis', () => {
  const d = new Date('2026-05-08T06:37:55.520Z');
  assert.equal(anyToIso(d), d.toISOString());
  assert.equal(anyToIso(d.getTime()), d.toISOString());
});

test('anyToIso: null/empty/garbage → null', () => {
  assert.equal(anyToIso(null), null);
  assert.equal(anyToIso(undefined), null);
  assert.equal(anyToIso(''), null);
  assert.equal(anyToIso({ foo: 1 }), null);
  assert.equal(anyToIso(new Date('nope')), null);
  assert.equal(anyToIso(NaN), null);
});

test('bucharestLocalToIso: winter (+02) and summer (+03) offsets', () => {
  assert.equal(bucharestLocalToIso('2026-01-15 10:00'), '2026-01-15T08:00:00.000Z');
  assert.equal(bucharestLocalToIso('2026-07-15 10:00'), '2026-07-15T07:00:00.000Z');
});

test('bucharestLocalToIso: T separator and date-only forms parse', () => {
  assert.equal(bucharestLocalToIso('2026-01-15T10:00'), '2026-01-15T08:00:00.000Z');
  assert.equal(bucharestLocalToIso('2026-01-15'), '2026-01-14T22:00:00.000Z'); // Bucharest midnight
  assert.equal(bucharestLocalToIso('garbage'), null);
  assert.equal(bucharestLocalToIso(''), null);
});

test('wall-clock round-trips survive both DST switch days', () => {
  // 2026 EU DST: spring forward Mar 29 (03:00→04:00), fall back Oct 25 (04:00→03:00).
  const values = [
    '2026-01-15 10:00',
    '2026-07-15 10:00',
    '2026-03-29 12:00', // after the spring switch
    '2026-03-29 02:30', // just before the skipped hour
    '2026-10-25 12:00', // after the fall switch
    '2026-10-25 03:30', // ambiguous (occurs twice) — must still display 03:30
  ];
  for (const v of values) {
    assert.equal(isoToBucharestLocal(bucharestLocalToIso(v)), v, `round-trip of ${v}`);
  }
});

test('isoToBucharestLocal: legacy date-only strings mean Bucharest midnight', () => {
  assert.equal(isoToBucharestLocal('2026-05-08'), '2026-05-08 00:00');
  assert.equal(isoToBucharestLocal(''), '');
  assert.equal(isoToBucharestLocal('garbage'), '');
});

test('daysBetween: ceil with a 1-day minimum', () => {
  assert.equal(daysBetween('2026-01-01T10:00:00Z', '2026-01-03T10:00:00Z'), 2);
  assert.equal(daysBetween('2026-01-01T10:00:00Z', '2026-01-03T11:00:00Z'), 3);
  assert.equal(daysBetween('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z'), 1);
  assert.equal(daysBetween('2026-01-03T10:00:00Z', '2026-01-01T10:00:00Z'), 1);
});
