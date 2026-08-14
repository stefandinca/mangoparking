// Netopia IPN state decisions — the guard that keeps a retried card payment
// from vanishing.
//
// Incident 2026-08-12 (order ord_1786576684010_uuvq16, plate PH28BFI, 124 RON):
// the customer's first card attempt was declined (action 'paid', error 39).
// The non-success branch recorded `status: action` — i.e. 'paid' — which is
// the exact sentinel the idempotency guard used to mean "already fulfilled".
// The customer retried on Netopia's hosted page, the real `confirmed` IPN
// arrived 11 minutes later, and the callback discarded it as a replay. Money
// was taken; no booking, no invoice, nothing for staff to see. The customer
// turned up at the lot two days later and had to be entered by hand.
//
// Two invariants keep that from recurring:
//   1. a failed IPN can never write a status that impersonates fulfilment
//   2. "already fulfilled" requires evidence the success branch actually ran
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFulfilledOrder, failureStatusFor } from '../src/netopia.js';

// ── failureStatusFor ────────────────────────────────────────────────────
test('failureStatusFor never returns the fulfilled sentinel', () => {
  // The exact shape of the incident: Netopia reports the ATTEMPTED action.
  assert.equal(failureStatusFor('paid'), 'failed');
  assert.equal(failureStatusFor('confirmed'), 'failed');
  assert.equal(failureStatusFor('PAID'), 'failed');
});

test('failureStatusFor keeps informative non-success actions', () => {
  assert.equal(failureStatusFor('canceled'), 'canceled');
  assert.equal(failureStatusFor('credit'), 'credit');
});

test('failureStatusFor falls back to failed when the action is absent', () => {
  assert.equal(failureStatusFor(''), 'failed');
  assert.equal(failureStatusFor(null), 'failed');
  assert.equal(failureStatusFor(undefined), 'failed');
});

// ── isFulfilledOrder ────────────────────────────────────────────────────
// Fixtures below are real production doc shapes (pendingOrders, Aug 2026).

test('a fulfilled long-term order short-circuits', () => {
  assert.equal(isFulfilledOrder({
    status: 'paid', paidBy: 'netopia', paymentStatus: 'paid',
    bookingId: 'OJUys9Pmvt5eP0CRjQ65', orderType: 'longTerm',
  }), true);
});

test('a fulfilled credits order short-circuits', () => {
  assert.equal(isFulfilledOrder({
    status: 'paid', paidBy: 'netopia', balanceDocId: 'plate_B123ABC',
    orderType: 'credits',
  }), true);
});

test('May-2026 orders predating paymentStatus/paidBy still count as fulfilled', () => {
  // Nine live orders look like this; a stricter guard would re-fulfil them.
  assert.equal(isFulfilledOrder({
    status: 'paid', bookingId: 'legacy123', orderType: 'longTerm',
  }), true);
});

test('a desk-paid order counts as fulfilled via paidBy', () => {
  assert.equal(isFulfilledOrder({
    status: 'paid', paidBy: 'admin-cash', paymentStatus: 'paid',
    bookingId: 'vAmgBHtbkUbQV4tfpYaF',
  }), true);
});

test('REGRESSION: a declined order must NOT look fulfilled', () => {
  // Verbatim from the incident doc — status 'paid' written by the failure
  // branch, but nothing was ever created. The follow-up `confirmed` IPN has
  // to be allowed through to create the booking.
  const declined = {
    status: 'paid',              // ← written by the old failure branch
    paymentStatus: 'unpaid',
    netopiaErrorCode: '39',
    paidBy: null,
    paidAt: null,
    orderType: 'longTerm',
    amount: 124,
  };
  assert.equal(isFulfilledOrder(declined), false);
});

test('a pay-at-pickup order awaiting repay is not fulfilled', () => {
  // bookingId exists (pre-created, unpaid) but status is still pending —
  // the repay IPN must be processed, not swallowed.
  assert.equal(isFulfilledOrder({
    status: 'pending', paymentMethod: 'pay-at-pickup',
    bookingId: 'PP8jg3r0UhgCw6sNb6DA', paidBy: null,
  }), false);
});

test('unpaid / expired / missing orders are not fulfilled', () => {
  assert.equal(isFulfilledOrder({ status: 'pending' }), false);
  assert.equal(isFulfilledOrder({ status: 'expired', bookingId: 'x' }), false);
  assert.equal(isFulfilledOrder({ status: 'failed' }), false);
  assert.equal(isFulfilledOrder(null), false);
  assert.equal(isFulfilledOrder(undefined), false);
});
