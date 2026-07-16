// Client wrappers for the SmartBill fiscal-invoicing integration (v1.2).
// Phase 1: only the connection healthcheck exists. Issue / reissue / status
// wrappers land with later phases.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

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
