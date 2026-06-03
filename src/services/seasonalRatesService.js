// Seasonal pricing — admin-defined date windows that override the
// default long-term tier table. Stored in collection `seasonalPricing`.
//
// Doc shape:
//   {
//     name: 'Crăciun 2026',
//     startDate: 'YYYY-MM-DD',   // inclusive
//     endDate:   'YYYY-MM-DD',   // inclusive
//     active:    true,
//     tiers: [{ minDays, maxDays|null, perDay }, ...],
//     createdAt, updatedAt, updatedBy
//   }
//
// Locked design decisions (v1.5):
//   • Pick-up date determines the period for the entire booking.
//   • Each period defines its own full tier table.
//   • Overlapping active periods are rejected at save time.

import {
  getCollection,
  getDocument,
  addDocument,
  updateDocument,
  removeDocument,
  orderBy,
} from '../firebase/db.js';
import { auditLog } from './auditService.js';

const COLLECTION = 'seasonalPricing';

export async function listSeasonalPeriods() {
  return getCollection(COLLECTION, orderBy('startDate', 'asc')).catch(() => []);
}

export async function getSeasonalPeriod(id) {
  return getDocument(COLLECTION, id);
}

export async function createSeasonalPeriod(data) {
  const nowIso = new Date().toISOString();
  const id = await addDocument(COLLECTION, { ...data, createdAt: nowIso, updatedAt: nowIso });
  await auditLog('seasonal_period_created', COLLECTION, id, null, data);
  return id;
}

export async function updateSeasonalPeriod(id, patch) {
  const nowIso = new Date().toISOString();
  await updateDocument(COLLECTION, id, { ...patch, updatedAt: nowIso });
  await auditLog('seasonal_period_updated', COLLECTION, id, null, patch);
}

export async function deleteSeasonalPeriod(id) {
  await removeDocument(COLLECTION, id);
  await auditLog('seasonal_period_deleted', COLLECTION, id, null, null);
}

// Return the active period whose [startDate, endDate] range contains `dateStr`
// (YYYY-MM-DD). Periods are sorted by startDate so the first match wins —
// since overlaps are disallowed at save time, there's at most one match.
export function findPeriodForDate(periods, dateStr) {
  if (!dateStr) return null;
  const day = String(dateStr).slice(0, 10);
  for (const p of periods) {
    if (!p.active) continue;
    if (!p.startDate || !p.endDate) continue;
    if (day >= p.startDate && day <= p.endDate) return p;
  }
  return null;
}

// Return the effective tier set for `dateStr`. Falls back to `defaultRates`
// (the settings/longTermRates doc) when no seasonal period applies.
export function getEffectiveRates(periods, dateStr, defaultRates) {
  const period = findPeriodForDate(periods, dateStr);
  if (period && Array.isArray(period.tiers) && period.tiers.length) {
    return { tiers: period.tiers, period };
  }
  return { tiers: defaultRates?.tiers || [], period: null };
}

// Validate a candidate period against existing ones. Returns the first
// conflicting period or null. Skips inactive periods on both sides — an
// inactive period doesn't block scheduling.
export function findOverlap(periods, candidate, excludeId = null) {
  if (!candidate?.active) return null;
  if (!candidate.startDate || !candidate.endDate) return null;
  if (candidate.startDate > candidate.endDate) {
    // Invalid range — caller surfaces a different error.
    return null;
  }
  for (const p of periods) {
    if (!p.active) continue;
    if (excludeId && p.id === excludeId) continue;
    if (!p.startDate || !p.endDate) continue;
    // Date strings in YYYY-MM-DD compare lexicographically as dates.
    const overlap = candidate.startDate <= p.endDate && candidate.endDate >= p.startDate;
    if (overlap) return p;
  }
  return null;
}
