// Cashbook service — reads the per-agent cash ledger (collection
// `cashEntries`) and the generated reports (`cashbookReports`), and
// wraps the close-cashbook callable.
//
// Only CASH entries are tracked. Card payments stay on the source booking
// or pendingOrder doc but never reach the cashbook.

import { getCollection, where, orderBy } from '../firebase/db.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

const recordHandoverFn = httpsCallable(functions, 'recordCashHandover');
const cancelHandoverFn = httpsCallable(functions, 'cancelCashHandover');
const closeCashbookFn = httpsCallable(functions, 'closeCashbook');

// Open (not yet closed) cash entries for one agent. Rules let an agent
// read their own; an admin can read any agent's.
export async function listOpenEntriesForAgent(agentUid) {
  if (!agentUid) return [];
  return getCollection('cashEntries',
    where('agentUid', '==', agentUid),
    where('closedAt', '==', null),
  ).catch(() => []);
}

// All open cash entries across every agent — admin-only path. Firestore
// rules enforce that non-admins can't read these (they'd just get an
// empty array because the rule short-circuits per doc).
export async function listAllOpenEntries() {
  return getCollection('cashEntries',
    where('closedAt', '==', null),
  ).catch(() => []);
}

// All closed entries within a time window, optionally scoped to one agent.
// Used by the historical view + admin overview.
export async function listClosedEntries({ agentUid, days = 30 } = {}) {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const constraints = [where('closedAt', '>=', sinceIso)];
  if (agentUid) constraints.unshift(where('agentUid', '==', agentUid));
  const rows = await getCollection('cashEntries', ...constraints).catch(() => []);
  return rows.sort((a, b) => String(b.paidAt || '').localeCompare(String(a.paidAt || '')));
}

// Past closed reports for one agent (omit agentUid → all reports, admin-side).
export async function listReports({ agentUid, days = 90 } = {}) {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const constraints = [where('generatedAt', '>=', sinceIso)];
  if (agentUid) constraints.unshift(where('agentUid', '==', agentUid));
  const rows = await getCollection('cashbookReports', ...constraints).catch(() => []);
  return rows.sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
}

// Group open entries by agentUid. Returns Map<uid, { agentName, entries }>.
export function groupByAgent(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.agentUid) continue;
    if (!out.has(e.agentUid)) {
      out.set(e.agentUid, { agentName: e.agentName || e.agentUid, entries: [] });
    }
    out.get(e.agentUid).entries.push(e);
  }
  return out;
}

export function groupByDay(entries) {
  const days = new Map();
  for (const e of entries) {
    const day = (e.paidAt || '').slice(0, 10);
    if (!day) continue;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function sumAmount(entries) {
  return entries.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
}

// Handovers belong to an AGENT (the cashbook owner), not necessarily the
// person who recorded them — admins can record on behalf of agents. We
// prefer `forAgentUid` and fall back to `handedBy` for legacy rows that
// were written before that field existed.
function ownerOfHandover(h) {
  return h.forAgentUid || h.handedBy || null;
}

export async function listHandovers({ days = 30, agentUid } = {}) {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const all = await getCollection('cashHandovers', orderBy('handedAt', 'desc')).catch(() => []);
  return all.filter((h) => {
    if (!h.handedAt || h.handedAt < sinceIso) return false;
    if (agentUid && ownerOfHandover(h) !== agentUid) return false;
    return true;
  });
}

export { ownerOfHandover };

export async function recordHandover({ day, amount, handedTo, notes, forAgentUid }) {
  const payload = { day, amount, handedTo, notes };
  if (forAgentUid) payload.forAgentUid = forAgentUid;
  const res = await recordHandoverFn(payload);
  return res?.data || {};
}

export async function cancelHandover(handoverId) {
  const res = await cancelHandoverFn({ handoverId });
  return res?.data || {};
}

// Close the caller's open cashbook (or — admin only — another agent's).
export async function closeCashbook(agentUid) {
  const res = await closeCashbookFn(agentUid ? { agentUid } : {});
  return res?.data || {};
}
