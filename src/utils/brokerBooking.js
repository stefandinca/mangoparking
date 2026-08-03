// Is this reservation prepaid through a third-party broker?
//
// Client-side mirror of `functions/src/brokerBooking.js` — the two live in
// separate packages (functions/ is not part of the vite build), so the rule is
// duplicated on purpose. Keep them identical; the server copy is the one with
// the unit tests that pin it to what `createBrokerBookingCore` writes.
//
// Both broker routes — the desk's "Broker / prepaid" option and the ParkVia
// auto-import — produce the same doc: `source: 'broker'`, `paidBy: 'broker'`,
// `paymentMethod: 'broker'`, `paymentStatus: 'paid'`, plus `brokerName`. Any
// ONE marker is enough, so a doc predating a field still reads as broker.
//
// Two things depend on this client-side:
//   • the reservation type chip (typeBadge)
//   • the edit dialog relaxing contact fields the broker never supplied
export function isBrokerBooking(booking) {
  if (!booking) return false;
  return booking.source === 'broker'
    || booking.paidBy === 'broker'
    || booking.paymentMethod === 'broker'
    || !!(typeof booking.brokerName === 'string' && booking.brokerName.trim());
}
