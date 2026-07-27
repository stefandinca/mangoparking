import { showToast } from '../components/core/Toast.js';

/**
 * Copy text and toast the outcome.
 *
 * `navigator.clipboard` was inlined at four call sites (promotions codes,
 * account vouchers, the homepage address); this centralises it and, more
 * usefully, handles the failure path — the API rejects on a non-secure origin
 * or when the document isn't focused, which silently did nothing before.
 */
export async function copyText(value, successMessage) {
  const text = String(value ?? '');
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) showToast(successMessage, 'success');
    return true;
  } catch (err) {
    console.warn('clipboard write failed:', err?.message);
    // Legacy fallback — still the only thing that works on an http:// origin.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok && successMessage) showToast(successMessage, 'success');
      return ok;
    } catch {
      return false;
    }
  }
}
