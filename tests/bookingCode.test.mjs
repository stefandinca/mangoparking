// Reservation display codes: staff must always see LT-/CR-… — never a raw
// Firestore doc id (the "aTUFw5tp" class of confusion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingCodePrefix, generateBookingCode, bookingDisplayCode } from '../src/utils/bookingCode.js';

test('bookingCodePrefix: per-type prefixes', () => {
  assert.equal(bookingCodePrefix('longTerm'), 'LT');
  assert.equal(bookingCodePrefix('credit'), 'CR');
  assert.equal(bookingCodePrefix('anything-else'), 'MNG');
});

test('generateBookingCode: shape and safe alphabet (no I/O/0/1)', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateBookingCode('longTerm');
    assert.match(code, /^LT-[A-HJ-NP-Z2-9]{5}$/);
  }
});

test('bookingDisplayCode: a stored code always wins', () => {
  assert.equal(bookingDisplayCode({ id: 'aTUFw5tp9xyz', code: 'LT-BW7XN' }), 'LT-BW7XN');
});

test('bookingDisplayCode: derives a stable LT-/CR- pseudo-code from the doc id', () => {
  assert.equal(bookingDisplayCode({ id: 'aTUFw5tp9xyz', type: 'longTerm' }), 'LT-ATUFW');
  assert.equal(bookingDisplayCode({ id: 'aTUFw5tp9xyz', type: 'credit' }), 'CR-ATUFW');
  assert.equal(bookingDisplayCode({ id: 'aTUFw5tp9xyz' }), 'LT-ATUFW'); // type defaults to longTerm
});

test('bookingDisplayCode: empty inputs → empty string, never a crash', () => {
  assert.equal(bookingDisplayCode(null), '');
  assert.equal(bookingDisplayCode({}), '');
  assert.equal(bookingDisplayCode({ id: '' }), '');
});
