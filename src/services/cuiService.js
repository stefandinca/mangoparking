// Client wrapper for the future `lookupCui` Cloud Function.
//
// The function itself is part of the Phase A infra wave (it wraps ANAF's
// public PlatitorTvaRest endpoint). Until that's deployed, this wrapper
// resolves to { error: 'unavailable' } so the BillingFields form falls
// back gracefully to manual entry — the user never sees a broken state.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config.js';

export async function lookupCui(cui) {
  if (!cui) return { error: 'empty' };
  const normalized = String(cui).trim().toUpperCase().replace(/^RO\s*/, '');
  try {
    const fn = httpsCallable(functions, 'lookupCui');
    const result = await fn({ cui: normalized });
    return result.data || { error: 'empty-response' };
  } catch (err) {
    // Function not deployed yet, network blip, or ANAF returned 404 —
    // any of these collapse to "no autofill"; manual entry still works.
    console.warn('CUI lookup unavailable:', err?.message || err);
    return { error: 'unavailable' };
  }
}
