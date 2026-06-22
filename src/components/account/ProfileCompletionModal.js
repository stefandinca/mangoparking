// Complete-your-profile gate.
//
// A registered customer must hold a complete profile — name, phone, ≥1 license
// plate, and billing — before they can book or buy credits (email is always set
// from auth). This module provides:
//   • openProfileCompletionModal() — a NON-dismissible modal with the required
//     fields prefilled; the user can't leave until it's saved.
//   • maybePromptProfileCompletion(user, profile) — the auth-hook guard that
//     opens the modal on login / app-load for an incomplete customer.
//   • profileGateCard(onCta) — a blocking card the booking flows render instead
//     of their form, whose CTA opens the same modal.
//
// Staff roles (admin/agent/driver) are exempt — they don't book. Billing reuses
// the shared BillingFields component (form + validation).

import { html, qs, escapeHtml } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';
import { openModal } from '../core/Modal.js';
import { showToast } from '../core/Toast.js';
import { updateDocument } from '../../firebase/db.js';
import { getCurrentUser, getUserProfile, refreshUserProfile } from '../../firebase/auth.js';
import { isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { isProfileComplete } from '../../utils/profileComplete.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../widgets/BillingFields.js';

// Singleton — never stack the gate (the auth hook can fire repeatedly).
let modalOpen = false;

export function openProfileCompletionModal({ onComplete } = {}) {
  if (modalOpen) return;
  modalOpen = true;

  const user = getCurrentUser();
  const profile = getUserProfile() || {};
  const email = profile.email || user?.email || '';
  const v0 = (Array.isArray(profile.vehicles) && profile.vehicles[0]) || {};

  const body = html`
    <form class="space-y-5" data-pc-form>
      <div>
        <h2 class="font-heading font-bold text-2xl text-blueberry-deep mb-1">${t('profileComplete.title')}</h2>
        <p class="text-dim text-[14px]">${t('profileComplete.intro')}</p>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('profileComplete.emailLabel')}</label>
        <input type="email" value="${escapeHtml(email)}" disabled class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-frost text-[15px] text-dim">
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('profileComplete.name')} *</label>
          <input type="text" name="pcName" value="${escapeHtml(profile.displayName || '')}" autocomplete="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('profileComplete.phone')} *</label>
          <input type="tel" name="pcPhone" value="${escapeHtml(profile.phone || '')}" placeholder="07xx xxx xxx" autocomplete="tel" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('profileComplete.plate')} *</label>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input type="text" name="pcPlate" value="${escapeHtml(v0.plate || '')}" placeholder="B 123 ABC" class="px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] uppercase font-mono focus:outline-none focus:border-blueberry">
          <input type="text" name="pcMake" value="${escapeHtml(v0.make || '')}" placeholder="${escapeHtml(t('profileComplete.make'))}" class="px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
          <input type="text" name="pcModel" value="${escapeHtml(v0.model || '')}" placeholder="${escapeHtml(t('profileComplete.model'))}" class="px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      ${billingFieldsHtml(profile.billing)}

      <div data-pc-err class="hidden text-danger text-[13px]"></div>

      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] py-3.5 rounded-xl transition-colors">${t('profileComplete.save')}</button>
    </form>
  `;

  const { close } = openModal(body, { dismissible: false, onClose: () => { modalOpen = false; } });
  wireBillingToggle(body);

  const errEl = qs('[data-pc-err]', body);
  const showErr = (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); };

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');

    const name = qs('[name="pcName"]', body).value.trim();
    const phone = qs('[name="pcPhone"]', body).value.trim();
    const plate = qs('[name="pcPlate"]', body).value.trim().toUpperCase();
    const make = qs('[name="pcMake"]', body).value.trim();
    const model = qs('[name="pcModel"]', body).value.trim();

    if (!required(name)) return showErr(t('profileComplete.errorName'));
    if (!isValidPhone(phone)) return showErr(t('profileComplete.errorPhone'));
    if (!isValidLicensePlate(plate)) return showErr(t('profileComplete.errorPlate'));
    const billing = readBilling(body);
    if (billing.error) return showErr(billing.error);

    const uid = user?.uid;
    if (!uid) return showErr(t('common.error'));

    // Preserve any extra saved vehicles; update/create the first one's plate.
    const vehicles = Array.isArray(profile.vehicles) ? profile.vehicles.map((v) => ({ ...v })) : [];
    if (vehicles.length) vehicles[0] = { ...vehicles[0], plate, make, model };
    else vehicles.push({ plate, make, model });

    const submitBtn = qs('button[type="submit"]', body);
    submitBtn.disabled = true;
    submitBtn.textContent = t('common.loading');
    try {
      await updateDocument('users', uid, { displayName: name, phone, vehicles, billing });
      await refreshUserProfile();
      showToast(t('profileComplete.savedToast'), 'success');
      close();
      onComplete?.();
    } catch (err) {
      console.error('profileComplete save', err);
      showErr(err?.message || t('common.error'));
      submitBtn.disabled = false;
      submitBtn.textContent = t('profileComplete.save');
    }
  });
}

// Auth-hook guard. Opens the gate on login / app-load for an incomplete
// CUSTOMER; staff and complete/guest users are left alone.
export function maybePromptProfileCompletion(user, profile) {
  if (!user) return;
  const role = profile?.role || 'customer';
  if (role !== 'customer') return;
  if (isProfileComplete(profile)) return;
  // Reload on completion so whatever rendered behind the modal (a stale booking
  // gate card, the dashboard's "not set" billing, …) reflects the new profile.
  openProfileCompletionModal({ onComplete: () => window.location.reload() });
}

// Blocking card the booking flows render instead of their form. `onCta` runs
// when the user clicks "Complete profile".
export function profileGateCard(onCta) {
  const card = html`
    <div class="max-w-xl mx-auto card-solid rounded-3xl p-10 text-center my-12">
      <div class="w-16 h-16 rounded-full bg-mango/10 flex items-center justify-center mx-auto mb-6">
        <svg class="w-8 h-8 text-mango" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
      </div>
      <h2 class="font-heading text-2xl font-bold text-blueberry-deep mb-2">${t('profileComplete.gateTitle')}</h2>
      <p class="text-dim text-[15px] mb-6">${t('profileComplete.gateMessage')}</p>
      <button type="button" data-pc-cta class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-8 py-3 rounded-xl transition-colors">${t('profileComplete.gateCta')}</button>
    </div>
  `;
  qs('[data-pc-cta]', card).addEventListener('click', () => onCta?.());
  return card;
}
