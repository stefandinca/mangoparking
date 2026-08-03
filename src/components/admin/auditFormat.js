// Shared rendering helpers for auditLog rows.
//
// Used by BOTH the dashboard's short "recent activity" summary and the full
// /admin/audit history, so one action never reads two different ways. Before
// this the two pages carried near-duplicate ACTION_STYLES maps and only the
// dashboard had human-readable descriptions — the audit table dumped raw JSON.
//
// Row shape comes from auditService.getAuditLog / listAuditRange:
//   { action, entityId, entityType, entity, user, newValueObj, timestamp }

import { anyToIso } from '../../utils/date.js';

export const ACTION_STYLES = {
  booking_checkin: 'bg-leaf/10 text-leaf',
  booking_checkout: 'bg-blue-100 text-blue-600',
  booking_created: 'bg-mango/10 text-mango',
  booking_cancelled: 'bg-red-100 text-red-500',
  booking_refunded: 'bg-mango/10 text-mango',
  booking_edited: 'bg-purple-100 text-purple-600',
  booking_repriced: 'bg-yellow-100 text-yellow-700',
  booking_amended: 'bg-yellow-100 text-yellow-700',
  booking_no_show: 'bg-red-100 text-red-500',
  spot_updated: 'bg-purple-100 text-purple-600',
  shuttle_updated: 'bg-purple-100 text-purple-600',
  shuttle_delay: 'bg-orange-100 text-orange-600',
  pricing_updated: 'bg-yellow-100 text-yellow-700',
  addon_updated: 'bg-yellow-100 text-yellow-700',
  online_discount_updated: 'bg-yellow-100 text-yellow-700',
  opening_hours_updated: 'bg-yellow-100 text-yellow-700',
  subscription_created: 'bg-mango/10 text-mango',
  subscription_cancelled: 'bg-red-100 text-red-500',
  token_purchase: 'bg-leaf/10 text-leaf',
  token_used: 'bg-blue-100 text-blue-600',
  token_checkout: 'bg-purple-100 text-purple-600',
  token_refund: 'bg-mango/10 text-mango',
  token_pack_created: 'bg-yellow-100 text-yellow-700',
  token_pack_updated: 'bg-yellow-100 text-yellow-700',
  order_marked_paid: 'bg-leaf/10 text-leaf',
  order_marked_unpaid: 'bg-red-100 text-red-500',
  cashbook_closed: 'bg-blueberry/10 text-blueberry',
  cash_handover: 'bg-blueberry/10 text-blueberry',
  admin_credits_granted: 'bg-mango/10 text-mango',
  admin_user_created: 'bg-blueberry/10 text-blueberry',
  admin_user_deleted: 'bg-red-100 text-red-500',
  admin_invite_sent: 'bg-blueberry/10 text-blueberry',
  admin_role_changed: 'bg-blueberry/10 text-blueberry',
  review_created: 'bg-purple-100 text-purple-600',
  review_updated: 'bg-purple-100 text-purple-600',
  review_deleted: 'bg-red-100 text-red-500',
  transfer_created: 'bg-mango/10 text-mango',
  transfer_updated: 'bg-purple-100 text-purple-600',
  transfer_status: 'bg-blue-100 text-blue-600',
  transfer_deleted: 'bg-red-100 text-red-500',
  parkvia_noshow_reported: 'bg-orange-100 text-orange-600',
  parkvia_cancel_needs_review: 'bg-orange-100 text-orange-600',
  // Legacy/generic action names from older rows.
  check_in: 'bg-leaf/10 text-leaf',
  check_out: 'bg-blue-100 text-blue-600',
  create: 'bg-mango/10 text-mango',
  update: 'bg-purple-100 text-purple-600',
  cancel: 'bg-red-100 text-red-500',
  dispatch: 'bg-indigo-100 text-indigo-600',
  pricing: 'bg-yellow-100 text-yellow-700',
  login: 'bg-gray-100 text-gray-600',
};

export function actionStyle(action) {
  return ACTION_STYLES[action] || 'bg-gray-100 text-gray-600';
}

// ── Per-actor activity (the /admin/users?uid= profile) ────────────────────

/**
 * Is this audit row an action performed BY the given person?
 *
 * Rows identify their actor two ways — `actorUid` on server writes, and
 * `userId`/`userEmail` on client writes (auditService resolves the latter
 * into `user`). Both must match or a staff member's client-written actions
 * (spot flips, check-in/out, review edits) would go missing from their
 * profile. Email comparison is case-insensitive: rows predate the
 * lowercase-at-write convention.
 */
export function isActorRow(row, { uid, email } = {}) {
  if (!row) return false;
  if (uid && row.actorUid === uid) return true;
  if (!email || !row.user) return false;
  return String(row.user).toLowerCase() === String(email).toLowerCase();
}

/**
 * Headline counters on the profile. Anything not listed still counts toward
 * the total, which is why there is no "other" tile.
 */
export const ACTOR_STAT_TILES = [
  { key: 'checkins', actions: ['booking_checkin', 'check_in'] },
  { key: 'checkouts', actions: ['booking_checkout', 'check_out'] },
  { key: 'reservations', actions: ['booking_created'] },
  { key: 'payments', actions: ['order_marked_paid', 'admin_credits_granted'] },
];

/** Count rows whose action falls in `actions`. */
export function countActions(rows, actions) {
  return rows.filter((r) => actions.includes(r.action)).length;
}

// ── Date-range presets for the /admin/audit window bar ────────────────────
// Kept here (a DOM-free module) rather than inside the page so the boundary
// math is unit-testable: it decides which rows the Firestore query returns.

export const RANGE_PRESETS = { today: 0, '7d': 6, '30d': 29 };   // days back, today inclusive

/** YYYY-MM-DD for "today" at the lot, not on the staff member's device. */
export function bucharestToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
}

/** Shift a YYYY-MM-DD by whole days. Anchored at noon UTC so a DST jump
 *  can't roll the result onto the neighbouring day. */
export function shiftDay(ymd, deltaDays) {
  const ms = Date.parse(`${ymd}T12:00:00Z`) + deltaDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A window ('today' | '7d' | '30d' | [fromDay, toDay]) → the inclusive ISO
 * instants bounding those Europe/Bucharest calendar days.
 * `toIso` is …23:59:59 local, so the last day is fully included.
 */
export function windowToIso(win, toIsoFn, now = new Date()) {
  const today = bucharestToday(now);
  const [fromDay, toDay] = Array.isArray(win)
    ? [win[0], win[1]]
    : [shiftDay(today, -(RANGE_PRESETS[win] ?? 0)), today];
  return {
    fromDay,
    toDay,
    fromIso: toIsoFn(`${fromDay} 00:00:00`),
    toIso: toIsoFn(`${toDay} 23:59:59`),
  };
}

export function actionLabel(action) {
  return String(action || '').replace(/_/g, ' ');
}

/**
 * Audit timestamps render pinned to Europe/Bucharest, like every other admin
 * board — a staff device in another timezone must not shift when an action
 * is recorded as having happened.
 */
export function fmtAuditTime(iso, locale) {
  iso = anyToIso(iso);
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  });
}

/**
 * Friendly per-action message. Pulls fields from the row's value object
 * (client rows: newValue; server rows: payload) and falls back to the entity
 * id. The alternative — dumping raw `{old} → {new}` JSON — is unreadable for
 * non-engineers, which is the whole point of this feed.
 */
export function describeAction(item, locale, entityCode = '') {
  const a = item.action;
  const nv = item.newValueObj || {};
  const id = item.entityId || '';
  // How a row refers to its entity. Prefer a human booking code (LT-/CR-…):
  // the caller's override first (the reservation detail knows its booking),
  // then a code recorded in the row itself — a raw doc-id fragment reads
  // like a second, confusing code format and is only the last resort.
  const idShort = entityCode || nv.code || (id ? id.slice(0, 8) : '');
  const ro = locale === 'ro';

  switch (a) {
    case 'booking_checkin':
      return ro
        ? `Check-in rezervare ${idShort}${nv.spotId ? ` la locul ${nv.spotId}` : ''}`
        : `Booking ${idShort} checked in${nv.spotId ? ` at spot ${nv.spotId}` : ''}`;
    case 'booking_checkout':
      return ro ? `Check-out rezervare ${idShort}` : `Booking ${idShort} checked out`;
    case 'booking_created':
      return ro
        ? `Rezervare nouă${nv.code ? ` (${nv.code})` : ''}`
        : `New booking${nv.code ? ` (${nv.code})` : ''}`;
    case 'booking_cancelled':
      return ro ? `Rezervare anulată ${idShort}` : `Booking ${idShort} cancelled`;
    case 'booking_refunded':
      return ro
        ? `Rambursare ${idShort}${nv.amount ? ` (${nv.amount} lei)` : ''}`
        : `Refund ${idShort}${nv.amount ? ` (${nv.amount} lei)` : ''}`;
    case 'spot_updated':
      return ro
        ? `Loc ${id} → ${nv.status || '?'}`
        : `Spot ${id} → ${nv.status || '?'}`;
    case 'token_purchase':
      return ro
        ? `Achiziție credite${nv.quantity ? ` (${nv.quantity})` : ''}${nv.licensePlate ? ` pentru ${nv.licensePlate}` : ''}`
        : `Credit purchase${nv.quantity ? ` (${nv.quantity})` : ''}${nv.licensePlate ? ` for ${nv.licensePlate}` : ''}`;
    case 'token_used':
      return ro
        ? `Credit folosit${nv.licensePlate ? ` pentru ${nv.licensePlate}` : ''}`
        : `Credit used${nv.licensePlate ? ` for ${nv.licensePlate}` : ''}`;
    case 'token_refund':
      return ro ? 'Rambursare credit' : 'Credit refunded';
    case 'token_pack_created':
      return ro ? 'Pachet credite creat' : 'Token pack created';
    case 'token_pack_updated':
      return ro ? 'Pachet credite actualizat' : 'Token pack updated';
    case 'order_marked_paid':
      return ro
        ? `Plată marcată${nv.paidBy ? ` (${nv.paidBy === 'admin-cash' ? 'numerar' : 'card'})` : ''}`
        : `Payment marked${nv.paidBy ? ` (${nv.paidBy === 'admin-cash' ? 'cash' : 'card'})` : ''}`;
    case 'order_marked_unpaid':
      return ro ? 'Plată anulată' : 'Payment reversed';
    case 'admin_credits_granted':
      return ro
        ? `Credite acordate cu numerar${nv.licensePlate ? ` pentru ${nv.licensePlate}` : ''}`
        : `Cash credits granted${nv.licensePlate ? ` for ${nv.licensePlate}` : ''}`;
    case 'admin_user_created':
      return ro
        ? `Cont creat${nv.email ? ` (${nv.email})` : ''}`
        : `User created${nv.email ? ` (${nv.email})` : ''}`;
    case 'admin_user_deleted':
      return ro
        ? `Cont șters${nv.email ? ` (${nv.email})` : ''}`
        : `User deleted${nv.email ? ` (${nv.email})` : ''}`;
    case 'admin_invite_sent':
      return ro
        ? `Invitație trimisă${nv.email ? ` la ${nv.email}` : ''}`
        : `Invite sent${nv.email ? ` to ${nv.email}` : ''}`;
    case 'booking_edited': {
      // updateBookingDetails now records the before-values of the changed
      // keys, so name the fields rather than dumping the patch.
      const fields = Object.keys(nv || {}).filter((k) => k !== 'updatedAt');
      const names = {
        contact: ro ? 'contact' : 'contact',
        licensePlate: ro ? 'număr' : 'plate',
        dropoffAt: ro ? 'dată sosire' : 'drop-off',
        pickupAt: ro ? 'dată plecare' : 'pick-up',
        days: ro ? 'zile' : 'days',
        notes: ro ? 'notițe' : 'notes',
        passengers: ro ? 'pasageri' : 'passengers',
        flightNumberDropoff: ro ? 'zbor sosire' : 'drop-off flight',
        flightNumberPickup: ro ? 'zbor retur' : 'return flight',
      };
      const list = fields.map((f) => names[f] || f).join(', ');
      return ro
        ? `Rezervare modificată${list ? ` (${list})` : ''}`
        : `Reservation edited${list ? ` (${list})` : ''}`;
    }
    case 'booking_repriced':
      return ro
        ? `Rezervare re-tarifată${nv.newTotal != null ? ` → ${nv.newTotal} lei` : ''}`
        : `Reservation repriced${nv.newTotal != null ? ` → ${nv.newTotal} lei` : ''}`;
    case 'booking_reprice_email_requested':
      return ro ? 'Cerere de plată trimisă (prelungire)' : 'Extension payment request emailed';
    case 'booking_extension_settled':
      return ro
        ? `Prelungire încasată${nv.chargedAmount != null ? ` (${nv.chargedAmount} lei)` : ''}`
        : `Extension settled${nv.chargedAmount != null ? ` (${nv.chargedAmount} lei)` : ''}`;
    case 'booking_overstay_charged':
      return ro
        ? `Depășire încasată${nv.amount != null ? ` (${nv.amount} lei)` : ''}`
        : `Overstay charged${nv.amount != null ? ` (${nv.amount} lei)` : ''}`;
    case 'booking_checkout_refund_resolved':
      return ro ? 'Refund parțial rezolvat' : 'Partial refund resolved';
    case 'booking_no_show':
      return ro ? 'Marcată no-show' : 'Marked as no-show';
    case 'booking_amended':
      return ro ? 'Rezervare actualizată de broker' : 'Amended by the broker';
    case 'parkvia_noshow_reported':
      return ro ? 'No-show raportat către ParkVia' : 'No-show reported to ParkVia';
    case 'parkvia_cancel_needs_review':
      return ro ? 'Anulare ParkVia — necesită verificare' : 'ParkVia cancellation needs review';
    case 'pricing_updated':
      return ro ? 'Tarife actualizate' : 'Pricing updated';
    case 'shuttle_updated':
      return ro ? 'Program microbuz actualizat' : 'Shuttle schedule updated';
    default:
      return `${actionLabel(a)} ${idShort}`.trim();
  }
}
