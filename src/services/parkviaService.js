// Client wrappers for the ParkVia (ParkCloud) auto-import integration.
// Admin diagnostics only — the import itself runs server-side on a schedule
// (pollParkviaBookings) and on demand via parkviaSyncNow. See
// documentation/roadmap/v.1.x_parkvia.md.
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

const parkviaHealthcheckFn = httpsCallable(functions, 'parkviaHealthcheck');
const parkviaSyncNowFn = httpsCallable(functions, 'parkviaSyncNow');

// Admin-only. Confirms ParkCloud is wired up: returns
// { configured, reachable, sampleCount, parkingId, lastSyncAt, lastResult, error }.
// Returns { configured: false } when the ParkCloud credentials aren't set yet.
export async function parkviaHealthcheck() {
  const res = await parkviaHealthcheckFn();
  return res.data;
}

// Admin-only. Runs one import pass on demand and returns the summary
// { configured, imported, skipped, cancelled, amended, errors }, or
// { configured: false } when dormant.
export async function parkviaSyncNow() {
  const res = await parkviaSyncNowFn();
  return res.data;
}
