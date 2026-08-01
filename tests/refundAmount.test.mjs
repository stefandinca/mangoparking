// Refund arithmetic — what a cancelled booking is actually owed back.
//
// The bug this guards: the admin refund queue read `booking.totalPrice` (the
// GROSS list price) instead of the charged amount on the linked order, so
// every discounted or voucher booking was refunded for more than the customer
// ever paid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundDueFrom, needsOrderLookup } from '../src/utils/refundAmount.js';

test('refundDueFrom: prefers the charged order amount over the gross total', () => {
  // 10% online discount: listed 500, charged 450.
  const booking = { totalPrice: 500, paymentId: 'ord_1' };
  assert.equal(refundDueFrom(booking, { amount: 450 }), 450);
});

test('refundDueFrom: a voucher-covered booking refunds only what was taken', () => {
  // 300 list, 100 voucher → 200 charged. Refunding 300 would gift 100 lei.
  const booking = { totalPrice: 300, paymentId: 'ord_2' };
  assert.equal(refundDueFrom(booking, { amount: 200 }), 200);
});

test('refundDueFrom: falls back to totalPrice for desk sales with no order', () => {
  // adminCreateLongtermBooking (cash at the desk) skips pendingOrders, so the
  // booking's own total IS the charged amount.
  assert.equal(refundDueFrom({ totalPrice: 240, paymentId: null }), 240);
});

test('refundDueFrom: falls back to totalPrice when the order is unreadable', () => {
  assert.equal(refundDueFrom({ totalPrice: 240, paymentId: 'ord_3' }, null), 240);
});

test('refundDueFrom: a server-pinned refundAmount always wins', () => {
  // Stamped by cancelBookingWithRefund — the decision of record.
  const booking = { totalPrice: 500, refundAmount: 450, paymentId: 'ord_4' };
  assert.equal(refundDueFrom(booking, { amount: 999 }), 450);
});

test('refundDueFrom: refundedAmount takes precedence over refundAmount', () => {
  // Once processed, what was actually returned is authoritative.
  const booking = { totalPrice: 500, refundAmount: 450, refundedAmount: 400 };
  assert.equal(refundDueFrom(booking), 400);
});

test('refundDueFrom: adds extensions and overstay fees actually collected', () => {
  // adminRepriceBooking does NOT fold an extension into totalPrice, so a full
  // refund owes the base charge plus both accumulators.
  const booking = { totalPrice: 500, paymentId: 'ord_5', extensionPrice: 90, latePrice: 49 };
  assert.equal(refundDueFrom(booking, { amount: 450 }), 450 + 90 + 49);
});

test('refundDueFrom: ignores a zero or negative order amount', () => {
  // A 0-amount order means nothing was captured through it; don't let it
  // zero out a booking that carries a real total.
  assert.equal(refundDueFrom({ totalPrice: 300, paymentId: 'o' }, { amount: 0 }), 300);
  assert.equal(refundDueFrom({ totalPrice: 300, paymentId: 'o' }, { amount: -50 }), 300);
});

test('refundDueFrom: never returns a negative amount', () => {
  assert.equal(refundDueFrom({ totalPrice: -100 }), 0);
});

test('refundDueFrom: rounds to whole lei', () => {
  assert.equal(refundDueFrom({ totalPrice: 0, paymentId: 'o' }, { amount: 449.4 }), 449);
  assert.equal(refundDueFrom({ totalPrice: 0, paymentId: 'o' }, { amount: 449.6 }), 450);
});

test('refundDueFrom: tolerates missing/garbage input', () => {
  assert.equal(refundDueFrom(null), 0);
  assert.equal(refundDueFrom({}), 0);
  assert.equal(refundDueFrom({ totalPrice: 'abc' }), 0);
});

test('needsOrderLookup: only rows without a pinned figure and with an order', () => {
  assert.equal(needsOrderLookup({ paymentId: 'ord_1' }), true);
  // Already pinned server-side — no read needed.
  assert.equal(needsOrderLookup({ paymentId: 'ord_1', refundAmount: 450 }), false);
  assert.equal(needsOrderLookup({ paymentId: 'ord_1', refundedAmount: 450 }), false);
  // Desk sale — nothing to fetch.
  assert.equal(needsOrderLookup({ paymentId: null, totalPrice: 240 }), false);
  assert.equal(needsOrderLookup({}), false);
  assert.equal(needsOrderLookup(null), false);
});
