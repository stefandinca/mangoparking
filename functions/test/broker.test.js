// Broker / prepaid recognition — the guard that keeps the "pay online and
// save X%" promo out of emails to customers who already paid a third party.
//
// Client report (2026-08-01): reservations booked through a broker were being
// emailed our online-payment discount. Those customers owe us nothing and were
// charged the BROKER's price, so the promo — and our own total — are wrong.
//
// The fixtures below are the doc shapes `createBrokerBookingCore` actually
// writes, which is the single primitive behind BOTH broker routes:
//   • manual desk entry  — adminCreateLongtermBooking, paidBy: 'broker'
//   • ParkVia auto-import — runParkviaSync
// If either route ever stops setting these markers, these tests fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBrokerBooking } from '../src/brokerBooking.js';

// Exactly what createBrokerBookingCore writes (see functions/src/index.js).
const brokerCoreDoc = (extra = {}) => ({
  type: 'longTerm',
  status: 'upcoming',
  licensePlate: 'B123ABC',
  totalPrice: 240,
  billing: null,
  paymentId: null,
  paymentMethod: 'broker',
  paymentStatus: 'paid',
  paidBy: 'broker',
  brokerName: 'ParkVia',
  source: 'broker',
  ...extra,
});

test('manual desk broker/prepaid reservation is recognised', () => {
  // adminCreateLongtermBooking with paidBy:'broker' → createBrokerBookingCore
  assert.equal(isBrokerBooking(brokerCoreDoc({ brokerName: 'Parkos' })), true);
});

test('ParkVia auto-imported reservation is recognised', () => {
  // runParkviaSync → createBrokerBookingCore, plus the import trail
  const doc = brokerCoreDoc({
    parkvia: { ref: 'PC90417080', importedAt: '2026-08-01T09:00:00.000Z', lastStatus: 'active' },
    createdBy: 'scheduled',
  });
  assert.equal(isBrokerBooking(doc), true);
});

test('any single broker marker is enough', () => {
  // Defensive: a doc predating a field, or hand-patched, still reads as broker.
  assert.equal(isBrokerBooking({ source: 'broker' }), true);
  assert.equal(isBrokerBooking({ paidBy: 'broker' }), true);
  assert.equal(isBrokerBooking({ paymentMethod: 'broker' }), true);
  assert.equal(isBrokerBooking({ brokerName: 'Parkos' }), true);
});

test('a broker booking stays recognised even if it is not marked paid', () => {
  // The promo must stay suppressed regardless of paymentStatus — that is the
  // whole point of keying on the broker markers instead of on `paid`.
  assert.equal(isBrokerBooking(brokerCoreDoc({ paymentStatus: 'unpaid', paidBy: null })), true);
});

test('ordinary bookings are NOT treated as broker', () => {
  // Online-paid web booking — must keep its normal paid confirmation.
  assert.equal(isBrokerBooking({
    source: 'web', paidBy: 'netopia', paymentMethod: 'online', paymentStatus: 'paid',
  }), false);
  // Pay-at-pickup web booking — SHOULD still get the pay-online promo.
  assert.equal(isBrokerBooking({
    source: 'web', paidBy: null, paymentMethod: 'pay-at-pickup', paymentStatus: 'unpaid',
  }), false);
  // Desk cash sale.
  assert.equal(isBrokerBooking({
    source: 'admin', paidBy: 'admin-cash', paymentMethod: 'admin', paymentStatus: 'paid',
  }), false);
  // Walk-in.
  assert.equal(isBrokerBooking({ source: 'walk-in', paidBy: 'admin-card' }), false);
});

test('a blank brokerName does not make a booking broker', () => {
  // createBrokerBookingCore stores null when no name was typed; other flows
  // may carry '' — neither should flip an ordinary booking.
  assert.equal(isBrokerBooking({ source: 'web', paidBy: 'netopia', brokerName: null }), false);
  assert.equal(isBrokerBooking({ source: 'web', paidBy: 'netopia', brokerName: '' }), false);
  assert.equal(isBrokerBooking({ source: 'web', paidBy: 'netopia', brokerName: '   ' }), false);
});

test('tolerates missing / malformed input', () => {
  assert.equal(isBrokerBooking(null), false);
  assert.equal(isBrokerBooking(undefined), false);
  assert.equal(isBrokerBooking({}), false);
});
