import { addDocument, getCollection, getDocument, orderBy, limit } from '../firebase/db.js';
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

async function resolveActorLabel(uid) {
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

/**
 * Get audit log entries
 */
export async function getAuditLog(limitCount = 50) {
  try {
    const entries = await getCollection('auditLog', orderBy('timestamp', 'desc'), limit(limitCount));
    const rows = entries.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      action: e.action,
      entityType: e.entityType || '',
      entityId: e.entityId || '',
      entity: (e.entityType || '') + ' ' + (e.entityId || ''),
      // Only userEmail is readable as-is. Server rows (actorUid) and older
      // client rows that stored just a userId both get resolved below.
      user: e.userEmail || '',
      actorUid: e.actorUid || e.userId || null,
      oldValueObj: e.oldValue || null,
      newValueObj: e.newValue || e.payload || null,
      details: e.oldValue && e.newValue
        ? JSON.stringify(e.oldValue) + ' → ' + JSON.stringify(e.newValue)
        : e.newValue ? JSON.stringify(e.newValue) : '',
    }));

    // One lookup per DISTINCT actor (a page of rows is typically a handful of
    // people), resolved in parallel and cached across calls.
    const pending = [...new Set(rows.filter(r => !r.user && r.actorUid).map(r => r.actorUid))];
    const labels = new Map(
      await Promise.all(pending.map(async uid => [uid, await resolveActorLabel(uid)])),
    );
    return rows.map(r => ({ ...r, user: r.user || labels.get(r.actorUid) || '' }));
  } catch {
    return [];
  }
}
