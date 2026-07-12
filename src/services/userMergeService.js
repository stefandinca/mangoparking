// Bridges guest activity (purchases made before signing up) into the
// authenticated user's account on first login post-signup.
//
// Server-side function `mergeGuestData` does the work — see
// functions/src/index.js. The merge is keyed on the user's auth email
// (compared case-insensitively — legacy docs stored it as typed):
//   - tokenBalances/plate_X with a matching email → merged into
//     tokenBalances/{uid}, then plate-keyed doc deleted
//   - tokenTransactions for the merged plates that still have
//     customerId==null get stamped with uid
//   - bookings with customerId==null and a matching contact.email
//     get stamped with uid
//
// Idempotent — safe to call after every login. Requires a VERIFIED email
// (returns zero counts otherwise). Called from Login, Register and the
// invite-completion page (FinishSignup).

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

export async function mergeGuestDataForCurrentUser() {
  const fn = httpsCallable(functions, 'mergeGuestData');
  try {
    const result = await fn();
    return result.data || { mergedBalance: 0, mergedTransactions: 0, mergedBookings: 0 };
  } catch (err) {
    // Don't surface as user-facing failures — sign-in should still
    // succeed even if the merge fails. Log and return zeros.
    console.warn('mergeGuestData failed:', err);
    return { mergedBalance: 0, mergedTransactions: 0, mergedBookings: 0, error: err.message };
  }
}
