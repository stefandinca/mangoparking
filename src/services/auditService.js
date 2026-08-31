import { addDocument, getCollection, getDocument, where, orderBy, limit } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { t } from '../i18n/index.js';

// ── Who performed the action ────────────────────────────────────────────
// auditLog has TWO writer shapes (see documentation/backend/data-model.md):
//   • client (auditLog() below) → userId + userEmail
//   • server (Cloud Functions, admin SDK) → actorUid + payload, NO email
// Server rows are the majority (check-in/out, cancel, refund, cash, credits,
// user admin, ParkVia…), so reading only userEmail/userId rendered every one
// of them as "unknown" in the dashboard activity feed. Resolve the uid to the
// person instead.

// Non-human actors the server stamps instead of a uid.
const SYSTEM_ACTORS = {
  scheduled: 'admin.actorScheduled',   // markNoShows, ParkVia poll, …
  system: 'admin.actorSystem',
  netopia: 'admin.actorNetopia',       // fulfilment driven by the payment IPN
};

// uid → label. Module-level so re-renders and a second admin page in the same
// session don't re-read the same user docs.
const actorLabelCache = new Map();

// Firebase uids are 28 alphanumeric chars. Anything shorter/other is a
// sentinel the code wrote on purpose ('anonymous', and any future one) and is
// already as readable as it is going to get — don't try to look it up.
const looksLikeUid = (v) => /^[A-Za-z0-9]{20,}$/.test(v);

export async function resolveActorLabel(uid) {
  if (!uid) return '';
  // Not cached: the label is locale-dependent and must follow a language switch.
  if (SYSTEM_ACTORS[uid]) return t(SYSTEM_ACTORS[uid]);
  if (!looksLikeUid(uid)) return uid;
  if (actorLabelCache.has(uid)) return actorLabelCache.get(uid);
  let label;
  try {
    const u = await getDocument('users', uid);
    // Email first — it's what client-written rows carry, and the dashboard
    // shortens it to the local part. A deleted account keeps its audit rows
    // but loses the users doc, so fall back to a traceable uid fragment
    // rather than to "unknown".
    label = u?.email || u?.displayName || uid.slice(0, 8);
  } catch {
    label = uid.slice(0, 8);
  }
  actorLabelCache.set(uid, label);
  return label;
}

/**
 * Log an audit entry
 */
export async function auditLog(action, entityType, entityId, oldValue, newValue) {
  const user = getCurrentUser();
  return addDocument('auditLog', {
    action,
    entityType,
    entityId,
    oldValue: oldValue || null,
    newValue: newValue || null,
    userId: user?.uid || 'anonymous',
    userEmail: user?.email || 'anonymous',
    timestamp: new Date().toISOString(),
  });
}

// Shape a raw auditLog doc into the row the admin surfaces render. `user` is
// filled in afterwards by resolveActors — see the note at the top of the file.
function toRow(e) {
  return {
    id: e.id,
    timestamp: e.timestamp,
    action: e.action,
    entityType: e.entityType || '',
    entityId: e.entityId || '',
    entity: (e.entityType || '') + ' ' + (e.entityId || ''),
    // Only userEmail is readable as-is. Server rows (actorUid) and older
    // client rows that stored just a userId both get resolved by resolveActors.
    user: e.userEmail || '',
    actorUid: e.actorUid || e.userId || null,
    oldValueObj: e.oldValue || null,
    newValueObj: e.newValue || e.payload || null,
    details: e.oldValue && e.newValue
      ? JSON.stringify(e.oldValue) + ' → ' + JSON.stringify(e.newValue)
      : e.newValue ? JSON.stringify(e.newValue) : '',
  };
}

// Fill in `user` for rows that only carry a uid. One lookup per DISTINCT
// actor (a page of rows is a handful of people even when it's hundreds of
// rows), resolved in parallel and cached across calls.
async function resolveActors(rows) {
  const pending = [...new Set(rows.filter(r => !r.user && r.actorUid).map(r => r.actorUid))];
  const labels = new Map(
    await Promise.all(pending.map(async uid => [uid, await resolveActorLabel(uid)])),
  );
  return rows.map(r => ({ ...r, user: r.user || labels.get(r.actorUid) || '' }));
}

/**
 * Get the N most recent audit entries (the dashboard's summary feed).
 */
export async function getAuditLog(limitCount = 50) {
  try {
    const entries = await getCollection('auditLog', orderBy('timestamp', 'desc'), limit(limitCount));
    return await resolveActors(entries.map(toRow));
  } catch {
    return [];
  }
}

/**
 * Every audit row for one entity (a booking's own history), newest first,
 * shaped like every other audit surface — actors resolved, `newValueObj` /
 * `oldValueObj` unified across the client (newValue) and server (payload)
 * writer shapes. Feeding RAW docs into describeAction/`row.user` instead
 * rendered generic labels and an empty actor on every server-written row.
 *
 * Equality on a single field → automatic index, no composite needed; sorted
 * client-side because adding orderBy would require one.
 */
export async function listEntityAudit(entityId) {
  if (!entityId) return [];
  try {
    const entries = await getCollection('auditLog', where('entityId', '==', entityId));
    const rows = await resolveActors(entries.map(toRow));
    return rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  } catch {
    return [];
  }
}

// Hard ceiling for a single range query. Deliberately surfaced to the caller
// (`capped`) rather than silently truncating — a range that hits this is
// showing only its newest rows and the UI must say so.
export const AUDIT_RANGE_MAX = 1000;

/**
 * Get audit entries inside a date range, newest first — the /admin/audit
 * history. `fromIso`/`toIso` are inclusive ISO instants.
 *
 * `timestamp` is an ISO string on every writer (client and server), so a
 * lexicographic range works, and because the range and the sort are on the
 * SAME field Firestore needs no composite index for it.
 *
 * Returns `{ rows, capped }`; a failure degrades to an empty, uncapped result
 * so the page renders its empty state instead of breaking.
 */
/**
 * Every audit row in a window authored by ONE person — exact, not a filtered
 * slice of a capped range.
 *
 * `auditLog` records the actor under two mutually exclusive field names
 * (verified over the whole collection: 727 rows carry `actorUid`, 2187 carry
 * `userId`, none carry both and none carry neither), so this runs one query
 * per shape and merges. Each needs its own composite index with `timestamp`
 * — both are declared in firestore.indexes.json.
 *
 * This replaces "pull the range, filter in memory", which under-reported the
 * moment a window exceeded AUDIT_RANGE_MAX — as the 30-day window does today
 * (1,222 rows against a 1,000 cap). Cost here scales with what the PERSON did,
 * not with how busy the lot was.
 *
 * `max` is a safety valve per query, not an expected ceiling.
 */
export async function listActorAuditRange({ uid, fromIso, toIso, max = AUDIT_RANGE_MAX } = {}) {
  if (!uid) return { rows: [], capped: false };
  const range = [];
  if (fromIso) range.push(where('timestamp', '>=', fromIso));
  if (toIso) range.push(where('timestamp', '<=', toIso));
  const tail = [...range, orderBy('timestamp', 'desc'), limit(max)];

  const [server, client] = await Promise.all([
    getCollection('auditLog', where('actorUid', '==', uid), ...tail),
    getCollection('auditLog', where('userId', '==', uid), ...tail),
  ]);

  // The two shapes are disjoint in practice; dedupe anyway so a row that ever
  // carries both can't be counted twice.
  const seen = new Set();
  const merged = [];
  for (const e of [...server, ...client]) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(e);
  }
  merged.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return {
    rows: await resolveActors(merged.map(toRow)),
    capped: server.length >= max || client.length >= max,
  };
}

export async function listAuditRange({ fromIso, toIso, max = AUDIT_RANGE_MAX } = {}) {
  try {
    const constraints = [];
    if (fromIso) constraints.push(where('timestamp', '>=', fromIso));
    if (toIso) constraints.push(where('timestamp', '<=', toIso));
    constraints.push(orderBy('timestamp', 'desc'), limit(max));
    const entries = await getCollection('auditLog', ...constraints);
    return { rows: await resolveActors(entries.map(toRow)), capped: entries.length >= max };
  } catch (err) {
    console.warn('listAuditRange failed:', err?.message);
    return { rows: [], capped: false };
  }
}
