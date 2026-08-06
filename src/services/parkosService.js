// Client wrappers for the Parkos auto-import integration.
// Admin diagnostics only — the import itself runs server-side on a schedule
// (pollParkosBookings) and on demand via parkosSyncNow. See
// documentation/features/parkos.md.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

const parkosHealthcheckFn = httpsCallable(functions, 'parkosHealthcheck');
const parkosSyncNowFn = httpsCallable(functions, 'parkosSyncNow');

// Admin-only. Confirms Parkos is wired up: returns
// { configured, reachable, sampleCount, merchantId, merchantName, merchantFound,
//   lastSyncAt, lastResult, error }.
// Returns { configured: false } when the Parkos credentials aren't set yet.
export async function parkosHealthcheck() {
  const res = await parkosHealthcheckFn();
  return res.data;
}

// Staff-level. Runs one import pass on demand and returns the summary
// { configured, imported, linked, skipped, cancelled, amended, errors }, or
// { configured: false } when Parkos isn't configured.
export async function parkosSyncNow() {
  const res = await parkosSyncNowFn();
  return res.data;
}
