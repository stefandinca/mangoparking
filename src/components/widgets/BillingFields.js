// PF/PJ billing fields — reusable block for booking forms + account profile.
//
// Customer picks "Persoană fizică" (individual) or "Persoană juridică" (company).
// Company fields appear only when PJ is selected.
//
// Usage:
//   1. inject billingFieldsHtml(initial) into your form template
//   2. after mount: wireBillingToggle(formScope)
//   3. on submit: call readBilling(formScope) → { type, companyName, cui, regCom, companyAddress }
//                 or null if validation fails (errors are highlighted in-place)

import { t } from '../../i18n/index.js';
import { setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import { isValidCui, isValidRegCom, required } from '../../utils/validators.js';

export function billingFieldsHtml(initial = {}) {
  const type = initial.type === 'PJ' ? 'PJ' : 'PF';
  const isPJ = type === 'PJ';
  return `
    <div class="card-solid rounded-2xl p-6" data-billing-block>
      <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('billing.title')}</h3>
      <div class="grid grid-cols-2 gap-2 mb-4" data-billing-type-toggle>
        <label class="flex items-center justify-center gap-2 py-3 rounded-xl border-2 cursor-pointer transition-colors ${type === 'PF' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
          <input type="radio" name="billingType" value="PF" class="accent-mango w-4 h-4" ${type === 'PF' ? 'checked' : ''}>
          <span class="text-[14px] font-medium">${t('billing.typePF')}</span>
        </label>
        <label class="flex items-center justify-center gap-2 py-3 rounded-xl border-2 cursor-pointer transition-colors ${type === 'PJ' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
          <input type="radio" name="billingType" value="PJ" class="accent-mango w-4 h-4" ${type === 'PJ' ? 'checked' : ''}>
          <span class="text-[14px] font-medium">${t('billing.typePJ')}</span>
        </label>
      </div>
      <div class="space-y-3 ${isPJ ? '' : 'hidden'}" data-billing-pj-fields>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.companyName')} *</label>
          <input type="text" name="billingCompanyName" value="${initial.companyName || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.cui')} *</label>
            <input type="text" name="billingCui" value="${initial.cui || ''}" placeholder="RO12345678" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
          </div>
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.regCom')}</label>
            <input type="text" name="billingRegCom" value="${initial.regCom || ''}" placeholder="J40/123/2020" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
          </div>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.companyAddress')} *</label>
          <input type="text" name="billingCompanyAddress" value="${initial.companyAddress || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>
    </div>
  `;
}

export function wireBillingToggle(scope) {
  const block = scope.querySelector('[data-billing-block]');
  if (!block) return;
  const toggleWrap = block.querySelector('[data-billing-type-toggle]');
  const pjFields = block.querySelector('[data-billing-pj-fields]');
  if (!toggleWrap || !pjFields) return;
  toggleWrap.addEventListener('change', (e) => {
    const radio = e.target;
    if (!radio.matches('input[name="billingType"]')) return;
    const isPJ = radio.value === 'PJ';
    pjFields.classList.toggle('hidden', !isPJ);
    toggleWrap.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-mango', inp.checked);
      lbl.classList.toggle('bg-mango/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
  });
  // Also clear field errors on edit.
  ['billingCompanyName', 'billingCui', 'billingRegCom', 'billingCompanyAddress'].forEach((n) => {
    clearErrorOnInput(block.querySelector(`[name="${n}"]`));
  });
}

// Read + validate. Returns the billing object on success, or null when
// validation fails (with error fields highlighted + the first error toasted
// by the caller — caller decides how to surface).
export function readBilling(scope) {
  const block = scope.querySelector('[data-billing-block]');
  if (!block) return { type: 'PF' };
  const radios = block.querySelectorAll('input[name="billingType"]');
  const checked = [...radios].find((r) => r.checked);
  const type = checked?.value === 'PJ' ? 'PJ' : 'PF';
  if (type === 'PF') return { type };

  const get = (name) => block.querySelector(`[name="${name}"]`);
  const companyName = get('billingCompanyName')?.value?.trim() || '';
  const cui = get('billingCui')?.value?.trim() || '';
  const regCom = get('billingRegCom')?.value?.trim() || '';
  const companyAddress = get('billingCompanyAddress')?.value?.trim() || '';

  const errors = [];
  const checks = [
    [get('billingCompanyName'), required(companyName), 'billing.errors.companyName'],
    [get('billingCui'), isValidCui(cui), 'billing.errors.cui'],
    [get('billingRegCom'), isValidRegCom(regCom), 'billing.errors.regCom'],
    [get('billingCompanyAddress'), required(companyAddress), 'billing.errors.companyAddress'],
  ];
  for (const [input, ok, errKey] of checks) {
    setFieldError(input, !ok);
    if (!ok) errors.push(t(errKey));
  }
  if (errors.length) return { error: errors[0] };

  return { type, companyName, cui, regCom, companyAddress };
}
