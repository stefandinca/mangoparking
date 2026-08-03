// Broker recognition, client side — and a drift guard against the server copy.
//
// The rule is deliberately duplicated (`src/utils/brokerBooking.js` for the
// admin UI, `functions/src/brokerBooking.js` for the email senders) because
// functions/ is a separate package outside the vite build. Both files are
// dependency-free, so this suite imports BOTH and asserts they agree on every
// fixture — if someone edits one, this fails instead of the two silently
// disagreeing about what counts as a broker booking.
//
// Why it matters on the client: the edit dialog relaxes email/phone for broker
// bookings (the broker often supplies neither, which made the dialog
// unsaveable). Getting the predicate wrong either re-breaks that or drops the
// contact requirement on ordinary bookings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBrokerBooking as client } from '../src/utils/brokerBooking.js';
import { isBrokerBooking as server } from '../functions/src/brokerBooking.js';

// [label, booking, expected]
const CASES = [
  ['ParkVia import / desk broker entry (full doc)', {
    source: 'broker', paidBy: 'broker', paymentMethod: 'broker',
    paymentStatus: 'paid', brokerName: 'ParkVia',
  }, true],
  ['broker by source only', { source: 'broker' }, true],
  ['broker by paidBy only', { paidBy: 'broker' }, true],
  ['broker by paymentMethod only', { paymentMethod: 'broker' }, true],
  ['broker by name only', { brokerName: 'Parkos' }, true],
  ['broker not marked paid', {
    source: 'broker', paidBy: null, paymentStatus: 'unpaid',
  }, true],

  ['online web booking', {
    source: 'web', paidBy: 'netopia', paymentMethod: 'online', paymentStatus: 'paid',
  }, false],
  ['pay-at-pickup web booking', {
    source: 'web', paidBy: null, paymentMethod: 'pay-at-pickup', paymentStatus: 'unpaid',
  }, false],
  ['desk cash sale', {
    source: 'admin', paidBy: 'admin-cash', paymentStatus: 'paid',
  }, false],
  ['walk-in', { source: 'walk-in', paidBy: 'admin-card' }, false],
  ['credit check-in', { source: 'admin', type: 'credit', paidBy: null }, false],

  ['null brokerName does not flip it', { source: 'web', brokerName: null }, false],
  ['blank brokerName does not flip it', { source: 'web', brokerName: '' }, false],
  ['whitespace brokerName does not flip it', { source: 'web', brokerName: '   ' }, false],

  ['empty object', {}, false],
  ['null', null, false],
  ['undefined', undefined, false],
];

for (const [label, booking, expected] of CASES) {
  test(`isBrokerBooking: ${label} → ${expected}`, () => {
    assert.equal(client(booking), expected);
  });
}

test('client and server copies never disagree', () => {
  for (const [label, booking] of CASES) {
    assert.equal(
      client(booking), server(booking),
      `client/server drift on fixture: ${label}`,
    );
  }
});
