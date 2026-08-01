// Is this reservation prepaid through a third-party broker?
//
// Both broker routes — the desk's "Broker / prepaid" option
// (`adminCreateLongtermBooking` with `paidBy: 'broker'`) and the ParkVia
// auto-import (`runParkviaSync`) — go through `createBrokerBookingCore`, which
// stamps `source: 'broker'`, `paidBy: 'broker'`, `paymentMethod: 'broker'`,
// `paymentStatus: 'paid'` and the `brokerName`. Any ONE of those markers is
// enough to recognise the booking, so a doc that predates a field (or was
// hand-patched) still reads as broker.
//
// Why it matters: the money was paid to the broker, at the BROKER's price.
// Such a booking must never be shown the "pay online and save X%" promo (the
// customer owes us nothing and our discount doesn't apply to their
// reservation) nor our `totalPrice` (it isn't the figure they agreed to).
//
// Pure + dependency-free so `functions/test/broker.test.js` can assert the
// guarantee directly against the doc shapes both routes produce.
export function isBrokerBooking(booking) {
  if (!booking) return false;
  return booking.source === 'broker'
    || booking.paidBy === 'broker'
    || booking.paymentMethod === 'broker'
    || !!(typeof booking.brokerName === 'string' && booking.brokerName.trim());
}
