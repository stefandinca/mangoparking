// Client wrappers for the SmartBill fiscal-invoicing integration (v1.2).
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';
import { INVOICE_PDF_URL } from '../utils/constants.js';

// Build a download URL for a SmartBill document PDF, served by the invoicePdf
// proxy function. Pass exactly one of bookingId / orderId / txId; `doc` is
// 'invoice' | 'proforma' | 'storno' (server defaults to invoice-else-proforma).
export function invoicePdfLink({ bookingId, orderId, txId, doc } = {}) {
  const q = new URLSearchParams();
  if (bookingId) q.set('booking', bookingId);
  else if (orderId) q.set('order', orderId);
  else if (txId) q.set('tx', txId);
  if (doc) q.set('doc', doc);
  return `${INVOICE_PDF_URL}/?${q.toString()}`;
}

const smartbillHealthcheckFn = httpsCallable(functions, 'smartbillHealthcheck');
const smartbillTestIssueFn = httpsCallable(functions, 'smartbillTestIssue');

// Admin-only. Confirms the SmartBill account is wired: returns
// { ready, series, taxes, hasExpectedVat, expectedVatPercent }.
// Throws (functions error) when the secrets aren't set or the account rejects us.
export async function smartbillHealthcheck() {
  const res = await smartbillHealthcheckFn();
  return res.data;
}

// Admin-only Phase 2 pre-flight. Issues a real proforma + a draft fiscal
// invoice from a sample payload, then deletes both, to confirm SmartBill
// accepts our payload shape. Returns { ok, proforma:{...}, invoice:{...} }.
// A `STRAY` field on either sub-object means a test document was left behind.
export async function smartbillTestIssue() {
  const res = await smartbillTestIssueFn();
  return res.data;
}
