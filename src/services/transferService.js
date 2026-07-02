// Door-to-airport transfers — admin/staff-managed private airport transfers.
//
// A transfer is a passenger pickup from a home address to Henri Coandă (and,
// for round trips, back). Staff record requests they take by phone/WhatsApp.
// No money is moved here — the optional `price` is a free-text note only — so,
// like reviews/contact messages, these are written directly from the client
// (gated by isStaff() in firestore.rules), not through a Cloud Function.
//
// Schema for `transfers/{id}`:
//   contactName        string   — passenger / contact "nume prenume"
//   phone              string
//   email              string
//   pickupAddress      string   — home pickup address
//   pickupAt           string   — ISO; pickup date + time
//   transferType       'oneway' | 'roundtrip'
//   flightNumber       string   — outbound flight no.
//   adults             number   — ≥1
//   children           number
//   infantsInArms      number   — children held in arms
//   holdLuggage        number   — checked bags
//   cabinLuggage       number   — hand luggage
//   returnAt           string   — ISO or '' (round-trip only)
//   returnFlightNumber string   — round-trip only
//   returnTo           string   — round-trip only (defaults to pickupAddress)
//   price              string   — free-text note, e.g. "150 lei"
//   groupNotes         string   — special/oversized luggage, disability, etc.
//   status             'scheduled' | 'completed' | 'cancelled'  — OUTBOUND leg
//   returnStatus       'scheduled' | 'completed' | 'cancelled'  — return leg (round-trip)
//   createdBy          uid
//   createdAt/updatedAt serverTimestamp (added by db helpers)

import {
  addDocument, updateDocument, removeDocument,
} from '../firebase/db.js';
import { auditLog } from './auditService.js';
import { getCurrentUser } from '../firebase/auth.js';

const COLLECTION = 'transfers';
const STATUSES = ['scheduled', 'completed', 'cancelled'];

// Round to a non-negative integer; anything invalid becomes 0.
function toCount(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Shape raw form input into the stored document. Round-trip-only fields are
// blanked for one-way transfers so an edit from round-trip → one-way doesn't
// leave a stale return leg behind.
function normalize(data) {
  const roundtrip = data.transferType === 'roundtrip';
  return {
    contactName: String(data.contactName || '').trim(),
    phone: String(data.phone || '').trim(),
    email: String(data.email || '').trim(),
    pickupAddress: String(data.pickupAddress || '').trim(),
    pickupAt: data.pickupAt || '',
    transferType: roundtrip ? 'roundtrip' : 'oneway',
    flightNumber: String(data.flightNumber || '').trim(),
    adults: Math.max(1, toCount(data.adults) || 1),
    children: toCount(data.children),
    infantsInArms: toCount(data.infantsInArms),
    holdLuggage: toCount(data.holdLuggage),
    cabinLuggage: toCount(data.cabinLuggage),
    returnAt: roundtrip ? (data.returnAt || '') : '',
    returnFlightNumber: roundtrip ? String(data.returnFlightNumber || '').trim() : '',
    returnTo: roundtrip ? String(data.returnTo || '').trim() : '',
    price: String(data.price || '').trim(),
    groupNotes: String(data.groupNotes || '').trim(),
  };
}

export async function createTransfer(data) {
  const doc = normalize(data);
  const id = await addDocument(COLLECTION, {
    ...doc,
    status: 'scheduled',        // outbound leg
    returnStatus: 'scheduled',  // return leg (only acted on for round trips)
    createdBy: getCurrentUser()?.uid || null,
  });
  await auditLog('transfer_created', 'transfer', id, null, doc);
  return id;
}

export async function updateTransfer(id, data) {
  const patch = normalize(data);
  await updateDocument(COLLECTION, id, patch);
  await auditLog('transfer_updated', 'transfer', id, null, patch);
}

// Sets the status of a single leg. `leg` is 'out' (outbound, the default and
// the only leg a one-way transfer has) or 'return' (the round-trip return leg,
// stored separately so it can be completed/cancelled independently).
export async function setTransferStatus(id, status, leg = 'out') {
  const next = STATUSES.includes(status) ? status : 'scheduled';
  const field = leg === 'return' ? 'returnStatus' : 'status';
  await updateDocument(COLLECTION, id, { [field]: next });
  await auditLog('transfer_status', 'transfer', id, null, { status: next, leg });
}

export async function deleteTransfer(id) {
  await removeDocument(COLLECTION, id);
  await auditLog('transfer_deleted', 'transfer', id, null, null);
}
