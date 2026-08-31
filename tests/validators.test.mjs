// Form validators: contact + Romanian fiscal identity shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEmail, isValidPhone, isValidLicensePlate,
  isValidCui, isValidRegCom, isValidCnp,
  sanitizeFlightNumber, sanitizePassengerCount, sanitizeBrokerName,
  sanitizeCollectedAmount,
} from '../src/utils/validators.js';

test('isValidEmail', () => {
  assert.ok(isValidEmail('a@b.ro'));
  assert.ok(!isValidEmail('a@b'));
  assert.ok(!isValidEmail('a b@c.ro'));
  assert.ok(!isValidEmail(null));
});

test('isValidPhone: E.164 and legacy Romanian local formats', () => {
  assert.ok(isValidPhone('+40722123456'));
  assert.ok(isValidPhone('+40 722 123 456'));
  assert.ok(isValidPhone('0722123456'));   // legacy mobile
  assert.ok(isValidPhone('0212345678'));   // legacy Bucharest landline
  assert.ok(!isValidPhone('12345'));
  assert.ok(!isValidPhone('+0722123456')); // country code can't start with 0
});

test('isValidLicensePlate: broad European acceptance after normalization', () => {
  assert.ok(isValidLicensePlate('B 123 ABC'));
  assert.ok(isValidLicensePlate('IF-01-XYZ'));
  assert.ok(isValidLicensePlate('AB12CDE'));   // UK style
  assert.ok(!isValidLicensePlate('AB!'));      // too short + symbol
  assert.ok(!isValidLicensePlate(''));
});

test('isValidCui: optional RO prefix, 2-10 digits', () => {
  assert.ok(isValidCui('RO12345678'));
  assert.ok(isValidCui('12345678'));
  assert.ok(isValidCui('ro 123456'));
  assert.ok(!isValidCui('R012'));      // letter O vs zero typo
  assert.ok(!isValidCui(''));
});

test('isValidRegCom: legacy slashed shape, optional field', () => {
  assert.ok(isValidRegCom('J01/123/2020'));
  assert.ok(isValidRegCom('F40/12/2024'));
  assert.ok(isValidRegCom(''));        // optional
  assert.ok(!isValidRegCom('J1-123-2020'));
});

test('isValidRegCom: new separator-less ONRC format (Law 265/2022)', () => {
  // Registrations issued since the ONRC switch carry a single run of digits
  // with no slashes — our own registration, J2014000079041, is this shape.
  // Rejecting it made the mandatory PJ Reg. Com. field impossible to fill.
  assert.ok(isValidRegCom('J2014000079041'));
  assert.ok(isValidRegCom('J2023001234567'));
  assert.ok(isValidRegCom('F2024000012345'));
  assert.ok(isValidRegCom('j2014000079041'));            // case-insensitive
  assert.ok(isValidRegCom('  J2014000079041  '));        // pasted with padding
  assert.ok(isValidRegCom('J 2014 000079041'));          // pasted with spacing
});

test('isValidRegCom: still refuses what is not a registration number', () => {
  assert.ok(!isValidRegCom('2014000079041'));   // no register letter
  assert.ok(!isValidRegCom('J12345'));          // too short for either format
  assert.ok(!isValidRegCom('J2014/000079041')); // neither shape
  assert.ok(!isValidRegCom('JABCDEFGHIJKLM'));  // letters, not digits
});

test('isValidCnp: weighted mod-11 check digit', () => {
  // 1800101221144: male, born 1980-01-01, valid check digit per the
  // 279146358279 weight table (sum=136 → 136 % 11 = 4).
  assert.ok(isValidCnp('1800101221144'));
  assert.ok(!isValidCnp('1800101221145')); // check digit off by one
  assert.ok(!isValidCnp('123'));
  assert.ok(!isValidCnp(null));
});

// ── Trip info: flight number + passenger count ───────────────────────────
// These mirror sanitizeFlight / sanitizePassengers in functions/src/index.js.
// The edit dialog writes them client-side (updateBookingDetails is a staff
// rules-allowed write, not a callable), so the client copy is what actually
// lands in Firestore for an edit — it has to match the create path exactly or
// the same booking ends up with two different shapes depending on how it was
// last touched.

test('sanitizeFlightNumber: upper-cases and collapses whitespace', () => {
  assert.equal(sanitizeFlightNumber('ro201'), 'RO201');
  assert.equal(sanitizeFlightNumber('  ro  201  '), 'RO 201');
  assert.equal(sanitizeFlightNumber('W6\t3251'), 'W6 3251');
});

test('sanitizeFlightNumber: caps at 12 characters', () => {
  assert.equal(sanitizeFlightNumber('ABCDEFGHIJKLMNOP'), 'ABCDEFGHIJKL');
  assert.equal(sanitizeFlightNumber('ABCDEFGHIJKL').length, 12);
});

test('sanitizeFlightNumber: empty-ish input clears the field (null)', () => {
  // null is how staff remove a flight the customer cancelled.
  assert.equal(sanitizeFlightNumber(''), null);
  assert.equal(sanitizeFlightNumber('   '), null);
  assert.equal(sanitizeFlightNumber(null), null);
  assert.equal(sanitizeFlightNumber(undefined), null);
});

test('sanitizePassengerCount: accepts 1..10', () => {
  assert.equal(sanitizePassengerCount(1), 1);
  assert.equal(sanitizePassengerCount(10), 10);
  assert.equal(sanitizePassengerCount('4'), 4);
});

test('sanitizePassengerCount: rejects out-of-range and non-numbers → null', () => {
  assert.equal(sanitizePassengerCount(0), null);
  assert.equal(sanitizePassengerCount(11), null);
  assert.equal(sanitizePassengerCount(-3), null);
  assert.equal(sanitizePassengerCount(''), null);      // the "—" option
  assert.equal(sanitizePassengerCount(null), null);
  assert.equal(sanitizePassengerCount('abc'), null);
});

test('sanitizePassengerCount: floors a fractional value', () => {
  assert.equal(sanitizePassengerCount(3.7), 3);
  // Floor before the range check — 10.9 is still within range.
  assert.equal(sanitizePassengerCount(10.9), 10);
});

test('sanitizeBrokerName: trims, blank clears to null', () => {
  assert.equal(sanitizeBrokerName('  ParkVia '), 'ParkVia');
  assert.equal(sanitizeBrokerName('Parkos'), 'Parkos');
  // Uncapped and case-preserving on purpose — brokers name themselves, and
  // this mirrors createBrokerBookingCore exactly.
  assert.equal(sanitizeBrokerName('holiday extras'), 'holiday extras');
  assert.equal(sanitizeBrokerName(''), null);
  assert.equal(sanitizeBrokerName('   '), null);
  assert.equal(sanitizeBrokerName(null), null);
  assert.equal(sanitizeBrokerName(undefined), null);
});

// ── Desk collection amount (discount / giveaway at collect time) ─────────
// Mirrors the guards in adminMarkOrderPaid. The server re-applies its own
// copy against pendingOrders.amount, so these two must not drift.

test('sanitizeCollectedAmount: accepts anything from 0 up to the amount due', () => {
  assert.equal(sanitizeCollectedAmount(220, 220), 220);
  assert.equal(sanitizeCollectedAmount(100, 220), 100);
  // 0 is the whole point — that is how a reservation gets given away.
  assert.equal(sanitizeCollectedAmount(0, 220), 0);
  assert.equal(sanitizeCollectedAmount('0', 220), 0);
  assert.equal(sanitizeCollectedAmount('150', 220), 150);
});

test('sanitizeCollectedAmount: refuses more than is owed', () => {
  // Over-collecting is a re-price or an overstay, not a collection.
  assert.equal(sanitizeCollectedAmount(221, 220), null);
  assert.equal(sanitizeCollectedAmount(1000, 220), null);
});

test('sanitizeCollectedAmount: refuses negatives and non-numbers', () => {
  assert.equal(sanitizeCollectedAmount(-1, 220), null);
  assert.equal(sanitizeCollectedAmount('abc', 220), null);
  assert.equal(sanitizeCollectedAmount(NaN, 220), null);
  assert.equal(sanitizeCollectedAmount(Infinity, 220), null);
});

test('sanitizeCollectedAmount: blank is "nothing typed", never a silent zero', () => {
  // Number('') is 0, so an empty field would otherwise waive the booking.
  assert.equal(sanitizeCollectedAmount('', 220), null);
  assert.equal(sanitizeCollectedAmount('   ', 220), null);
  assert.equal(sanitizeCollectedAmount(null, 220), null);
  assert.equal(sanitizeCollectedAmount(undefined, 220), null);
});

test('sanitizeCollectedAmount: rounds to whole lei', () => {
  assert.equal(sanitizeCollectedAmount(99.4, 220), 99);
  assert.equal(sanitizeCollectedAmount(99.6, 220), 100);
  // Rounding must not sneak past the ceiling.
  assert.equal(sanitizeCollectedAmount(220.6, 220), null);
});

test('sanitizeCollectedAmount: an unusable due figure blocks any override', () => {
  assert.equal(sanitizeCollectedAmount(10, NaN), null);
  assert.equal(sanitizeCollectedAmount(10, undefined), null);
  assert.equal(sanitizeCollectedAmount(10, ''), null);
  assert.equal(sanitizeCollectedAmount(10, -5), null);
});
