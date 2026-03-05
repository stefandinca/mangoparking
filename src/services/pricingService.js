import { getCollection, getDocument, updateDocument, addDocument } from '../firebase/db.js';
import { auditLog } from './auditService.js';

// Fallback pricing tiers (used when Firestore is not available)
const DEFAULT_TIERS = [
  { id: 'tier-1', type: 'traveler', minDays: 1, maxDays: 3, pricePerDay: 49, order: 1 },
  { id: 'tier-2', type: 'traveler', minDays: 4, maxDays: 7, pricePerDay: 39, order: 2 },
  { id: 'tier-3', type: 'traveler', minDays: 8, maxDays: 14, pricePerDay: 34, order: 3 },
  { id: 'tier-4', type: 'traveler', minDays: 15, maxDays: 30, pricePerDay: 29, order: 4 },
  { id: 'tier-5', type: 'traveler', minDays: 31, maxDays: 999, pricePerDay: 25, order: 5 },
];

const DEFAULT_ADDONS = [
  { id: 'addon-wash', name: 'Car Wash', nameRo: 'Spălătorie Auto', price: 50, type: 'one_time' },
  { id: 'addon-covered', name: 'Covered Spot', nameRo: 'Loc Acoperit', price: 15, type: 'per_day' },
  { id: 'addon-ev', name: 'EV Charging', nameRo: 'Încărcare EV', price: 20, type: 'per_day' },
];

const COMMUTER_RATE = 500;

/**
 * Get pricing tiers
 */
export async function getPricingTiers() {
  try {
    const tiers = await getCollection('pricingTiers');
    return tiers.length > 0 ? tiers.sort((a, b) => a.order - b.order) : DEFAULT_TIERS;
  } catch {
    return DEFAULT_TIERS;
  }
}

/**
 * Get add-ons
 */
export async function getAddOns() {
  try {
    const addons = await getCollection('addOns');
    return addons.length > 0 ? addons : DEFAULT_ADDONS;
  } catch {
    return DEFAULT_ADDONS;
  }
}

/**
 * Get commuter rate
 */
export async function getCommuterRate() {
  try {
    const settings = await getDocument('settings', 'global');
    return settings?.commuterMonthlyRate || COMMUTER_RATE;
  } catch {
    return COMMUTER_RATE;
  }
}

/**
 * Calculate price for a traveler booking
 */
export async function calculatePrice(days, addOns = [], { tiers: prefetchedTiers, addons: prefetchedAddons } = {}) {
  const tiers = prefetchedTiers || await getPricingTiers();
  const allAddons = prefetchedAddons || await getAddOns();

  // Find matching tier
  const tier = tiers.find((t) => days >= t.minDays && days <= t.maxDays) || tiers[tiers.length - 1];
  const basePrice = tier.pricePerDay * days;

  // Calculate add-on costs
  let addOnTotal = 0;
  for (const addonId of addOns) {
    const addon = allAddons.find((a) => a.id === addonId);
    if (addon) {
      addOnTotal += addon.type === 'per_day' ? addon.price * days : addon.price;
    }
  }

  return {
    pricePerDay: tier.pricePerDay,
    days,
    basePrice,
    addOnTotal,
    total: basePrice + addOnTotal,
    tier: `${tier.minDays}-${tier.maxDays}`,
  };
}

/**
 * Update an add-on (admin)
 */
export async function updateAddOn(addonId, data) {
  const old = await getDocument('addOns', addonId);
  await updateDocument('addOns', addonId, data);
  await auditLog('addon_updated', 'addOn', addonId, old, data);
}

/**
 * Update a pricing tier (admin)
 */
export async function updateTier(tierId, data) {
  const old = await getDocument('pricingTiers', tierId);
  await updateDocument('pricingTiers', tierId, data);
  await auditLog('pricing_updated', 'pricingTier', tierId, old, data);
}
