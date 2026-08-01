// How much a booking is owed back — the one place that rule lives.
//
// `booking.totalPrice` is the GROSS list price. The amount actually charged is
// on the linked `pendingOrders` doc (`amount`), already net of the online
// discount and any voucher. Reading totalPrice hands the customer back money
// that was never taken — by the whole discount, on every discounted or
// voucher booking. Three admin surfaces (refund queue, refund dialog, the
// dashboard's pending-total tile) each made that mistake independently, which
// is why the rule is centralised here.
//
// The server pins the figure when the money decision is made — `refundAmount`
// at cancel time, `refundedAmount` once processed (both written by
// functions/src/index.js, which applies this same rule server-side via
// `resolveChargedAmount`). Those always win; the derivation below only covers
// bookings cancelled before those fields shipped.
//
// Kept DOM- and Firebase-free so the arithmetic is unit-testable under
// `node --test` (same reason as utils/bookingTime.js). The order fetch that
// feeds it lives in services/bookingService.js → `attachRefundDue`.

/**
 * The refund owed for one booking.
 *
 * @param {object} booking  the bookings doc
 * @param {object|null} order  its linked pendingOrders doc, when available
 * @returns {number} whole lei, never negative
 *
 * Precedence: server-pinned figure → charged amount on the order → the
 * booking's own total (desk sales never create an order). Extensions and
 * overstay fees are real money collected on top, tracked in their own
 * accumulators because `adminRepriceBooking` deliberately does not fold an
 * extension back into totalPrice — so a full refund owes those too.
 */
export function refundDueFrom(booking, order = null) {
  if (!booking) return 0;

  const pinned = Number(booking.refundedAmount ?? booking.refundAmount);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;

  const charged = Number(order?.amount);
  const base = Number.isFinite(charged) && charged > 0
    ? charged
    : (Number(booking.totalPrice) || 0);

  const total = base
    + (Number(booking.extensionPrice) || 0)
    + (Number(booking.latePrice) || 0);

  return Math.max(0, Math.round(total));
}

/**
 * Does this booking need its linked order fetched before the amount is known?
 * False when a server-pinned figure is already on the doc, or when there is no
 * order to fetch — lets callers bound the read count to just the rows that
 * genuinely need one.
 */
export function needsOrderLookup(booking) {
  if (!booking?.paymentId) return false;
  return !(Number(booking.refundedAmount ?? booking.refundAmount) > 0);
}
