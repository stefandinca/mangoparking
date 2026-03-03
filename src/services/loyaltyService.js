import { updateDocument, getDocument } from '../firebase/db.js';
import { getCurrentUser } from '../firebase/auth.js';
import { LOYALTY_TIERS } from '../utils/constants.js';

/**
 * Get loyalty tier for a point total
 */
export function getTier(points) {
  if (points >= LOYALTY_TIERS.gold.min) return 'gold';
  if (points >= LOYALTY_TIERS.silver.min) return 'silver';
  return 'bronze';
}

/**
 * Get discount for a tier
 */
export function getDiscount(tier) {
  return LOYALTY_TIERS[tier]?.discount || 0;
}

/**
 * Add loyalty points to current user
 */
export async function addPoints(points) {
  const user = getCurrentUser();
  if (!user) return;
  const profile = await getDocument('users', user.uid);
  if (!profile) return;
  const newTotal = (profile.loyaltyPoints || 0) + points;
  const newTier = getTier(newTotal);
  await updateDocument('users', user.uid, {
    loyaltyPoints: newTotal,
    loyaltyTier: newTier,
  });
}
