// Which SmartBill document a moment in a booking's life produces.
//
// Pure policy, no I/O — the *issuing* lives in index.js (`smartbillIssueSafe`),
// only the decision lives here. It earned its own module because the rule is
// the client's rather than ours and it has moved twice in a month, each time
// across several call sites where nothing could test it:
//
//   2026-08-05 (decision 1b) — money collected on the POS gets a fiscal
//     invoice, on the same footing as an online card payment. Prompted by a
//     month of card takings with no invoices in SmartBill, because desk card
//     had been filed with cash under the earlier "all pay-at-location is
//     manual" rule. It REPLACES rather than supplements: a card desk sale
//     issues an invoice instead of a proforma, so there is no stray estimate
//     to reconcile against.
//
//   2026-09-04 — a reservation that has not been paid for gets NO document.
//     The proforma used to be raised the moment a pay-at-pickup booking was
//     made; it was never emailed, never shown in the app, and deleted again
//     whenever the reservation expired, cancelled or no-showed. Twenty of the
//     fifty-four issued on that flow were created and destroyed without ever
//     documenting a transaction. The document now follows the money: it is
//     raised when the money is actually collected, for the amount actually
//     collected. Online orders are untouched — their proforma is the payment
//     request that precedes the card charge and becomes the fiscal invoice
//     when the IPN confirms.
//
// Covered by functions/test/fiscalDoc.test.js.

/**
 * What money collected AT THE DESK produces (decision 1b above).
 * Cash keeps a proforma only — its fiscal invoice is still raised manually.
 */
export function deskDocKind(paidBy) {
  return paidBy === 'card' ? 'invoice' : 'proforma';
}

/**
 * The `smartbill.*` key an APPENDED desk document lands under (overstay
 * charges, extension top-ups — several can accumulate on one booking).
 */
export function deskExtraField(paidBy) {
  return paidBy === 'card' ? 'extraInvoices' : 'extraProformas';
}

/**
 * The document a reservation produces at the moment it is CREATED, before
 * anything else has happened to it.
 *
 * @param {string} paymentMethod  'online' | 'pay-at-pickup' | 'admin' | 'broker'
 * @param {string|null} paidBy    how the desk took the money, when it just did
 *                                ('cash' | 'card' | 'later' | 'broker' | null)
 * @returns {'proforma'|'invoice'|null}  null = issue nothing
 */
export function orderTimeDocKind({ paymentMethod, paidBy = null }) {
  // The broker (ParkVia, Parkos…) bills the customer; no money passes through
  // us, so there is nothing for us to document.
  if (paidBy === 'broker' || paymentMethod === 'broker') return null;
  // Nothing collected yet → nothing to document. The desk raises the document
  // when it takes the money (see collectionDocs).
  if (paymentMethod === 'pay-at-pickup' || paidBy === 'later') return null;
  // A desk sale has the money in hand already.
  if (paidBy) return deskDocKind(paidBy);
  // An online order: the proforma is the payment request.
  return 'proforma';
}

/**
 * What a desk COLLECTION produces, given what the order already carries.
 *
 * `hasLiveProforma` is the load-bearing input. Orders created online — and
 * every pay-at-pickup order predating 2026-09-04 — still carry an order-time
 * proforma, and must not be given a second one.
 *
 * @returns {{deleteProforma: boolean, issueProforma: boolean, issueInvoice: boolean}}
 */
export function collectionDocs({ paidBy, collected, hasLiveProforma = false, discounted = false }) {
  const took = Number(collected) > 0;

  // A full waiver: nothing changed hands, and SmartBill rejects a zero total
  // anyway. Any proforma still standing is a demand for money nobody will pay.
  if (!took) {
    return { deleteProforma: !!hasLiveProforma, issueProforma: false, issueInvoice: false };
  }

  // A proforma raised at the list price is wrong once the desk discounts —
  // replace it with one for what was actually taken.
  const stale = !!hasLiveProforma && !!discounted;

  return {
    deleteProforma: stale,
    // Cash: the proforma IS this sale's document. Raise one unless a correct
    // one already stands.
    issueProforma: stale || (deskDocKind(paidBy) === 'proforma' && !hasLiveProforma),
    issueInvoice: paidBy === 'card',
  };
}
