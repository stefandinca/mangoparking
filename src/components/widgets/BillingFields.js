// PF/PJ billing fields — reusable block for booking forms + account profile.
//
// PF (Persoană fizică) captures: idType (CNP/CI/Passport), idNumber, first +
// last name, personal address.
// PJ (Persoană juridică) captures: everything PF captures (legal rep) PLUS
// company name, CUI, Reg.Com (optional), company address. The CUI input
// debounces a call to the `lookupCui` Cloud Function (ANAF wrapper) and
// prefills name + address + regCom on success. The user can always edit.
//
// Usage:
//   1. inject billingFieldsHtml(initial) into your form template
//   2. after mount: wireBillingToggle(formScope)
//   3. on submit: readBilling(formScope) → billing object OR { error }

import { t } from '../../i18n/index.js';
import { setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import {
  isValidCui, isValidRegCom, required,
  isValidCnp, isValidCiSeries, isValidPassport,
} from '../../utils/validators.js';
import { lookupCui } from '../../services/cuiService.js';

const ID_TYPES = ['CNP', 'CI', 'PASSPORT'];

function validateIdNumber(idType, value) {
  if (idType === 'CNP') return isValidCnp(value);
  if (idType === 'CI') return isValidCiSeries(value);
  if (idType === 'PASSPORT') return isValidPassport(value);
  return false;
}

export function billingFieldsHtml(initial = {}) {
  const type = initial.type === 'PJ' ? 'PJ' : 'PF';
  const isPJ = type === 'PJ';
  const idType = ID_TYPES.includes(initial.idType) ? initial.idType : 'CNP';

  const idTypeOptions = ID_TYPES.map((opt) => `
    <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 cursor-pointer transition-colors ${idType === opt ? 'border-blueberry bg-blueberry/5' : 'border-frost-deep'}">
      <input type="radio" name="billingIdType" value="${opt}" class="accent-blueberry w-4 h-4" ${idType === opt ? 'checked' : ''}>
      <span class="text-[13px] font-medium">${t('billing.idType.' + opt.toLowerCase())}</span>
    </label>
  `).join('');

  return `
    <div class="card-solid rounded-2xl p-6" data-billing-block>
      <h3 class="font-heading font-bold text-lg text-blueberry-deep mb-4">${t('billing.title')}</h3>

      <div class="grid grid-cols-2 gap-2 mb-5" data-billing-type-toggle>
        <label class="flex items-center justify-center gap-2 py-3 rounded-xl border-2 cursor-pointer transition-colors ${type === 'PF' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
          <input type="radio" name="billingType" value="PF" class="accent-mango w-4 h-4" ${type === 'PF' ? 'checked' : ''}>
          <span class="text-[14px] font-medium">${t('billing.typePF')}</span>
        </label>
        <label class="flex items-center justify-center gap-2 py-3 rounded-xl border-2 cursor-pointer transition-colors ${type === 'PJ' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
          <input type="radio" name="billingType" value="PJ" class="accent-mango w-4 h-4" ${type === 'PJ' ? 'checked' : ''}>
          <span class="text-[14px] font-medium">${t('billing.typePJ')}</span>
        </label>
      </div>

      <!-- Personal block — shown for BOTH PF and PJ (legal-rep details for PJ) -->
      <div class="space-y-3">
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-2">${t('billing.idType.label')}</label>
          <div class="grid grid-cols-3 gap-2" data-billing-id-type>${idTypeOptions}</div>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5"><span data-billing-id-label>${t('billing.idType.' + idType.toLowerCase())}</span> *</label>
          <input type="text" name="billingIdNumber" value="${initial.idNumber || ''}" autocomplete="off" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.firstName')} *</label>
            <input type="text" name="billingFirstName" value="${initial.firstName || ''}" autocomplete="given-name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
          </div>
          <div>
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.lastName')} *</label>
            <input type="text" name="billingLastName" value="${initial.lastName || ''}" autocomplete="family-name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
          </div>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.personalAddress')} *</label>
          <input type="text" name="billingPersonalAddress" value="${initial.personalAddress || ''}" autocomplete="street-address" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <!-- PJ-only block — company fields with CUI autofill -->
      <div class="space-y-3 mt-5 pt-5 border-t border-frost-deep ${isPJ ? '' : 'hidden'}" data-billing-pj-fields>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.cui')} *</label>
          <div class="relative">
            <input type="text" name="billingCui" value="${initial.cui || ''}" placeholder="RO12345678" autocomplete="off" class="w-full px-4 py-3 pr-10 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry" data-billing-cui-input>
            <span class="hidden absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blueberry/30 border-t-blueberry animate-spin" data-billing-cui-spinner></span>
          </div>
          <p class="hidden text-[12px] text-leaf mt-1" data-billing-cui-hint>${t('billing.cuiAutofilled')}</p>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.companyName')} *</label>
          <input type="text" name="billingCompanyName" value="${initial.companyName || ''}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.regCom')}</label>
          <input type="text" name="billingRegCom" value="${initial.regCom || ''}" placeholder="J40/123/2020" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
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

  // PF / PJ master toggle.
  const toggleWrap = block.querySelector('[data-billing-type-toggle]');
  const pjFields = block.querySelector('[data-billing-pj-fields]');
  if (toggleWrap && pjFields) {
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
  }

  // ID-type sub-toggle (CNP / CI / Passport) — repaint the active label
  // border and update the input label so it matches the chosen ID type.
  const idTypeWrap = block.querySelector('[data-billing-id-type]');
  const idLabel = block.querySelector('[data-billing-id-label]');
  if (idTypeWrap) {
    idTypeWrap.addEventListener('change', (e) => {
      const radio = e.target;
      if (!radio.matches('input[name="billingIdType"]')) return;
      idTypeWrap.querySelectorAll('label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-blueberry', inp.checked);
        lbl.classList.toggle('bg-blueberry/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
      if (idLabel) idLabel.textContent = t('billing.idType.' + radio.value.toLowerCase());
    });
  }

  // CUI autofill — debounce 600ms after typing stops, then hit ANAF wrapper.
  const cuiInput = block.querySelector('[data-billing-cui-input]');
  const spinner = block.querySelector('[data-billing-cui-spinner]');
  const hint = block.querySelector('[data-billing-cui-hint]');
  if (cuiInput) {
    let debounceTimer = null;
    cuiInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      hint?.classList.add('hidden');
      debounceTimer = setTimeout(async () => {
        const value = cuiInput.value.trim();
        if (!isValidCui(value)) return;
        spinner?.classList.remove('hidden');
        const result = await lookupCui(value);
        spinner?.classList.add('hidden');
        if (result.error) return;
        const set = (name, val) => {
          const el = block.querySelector(`[name="${name}"]`);
          if (el && val && !el.value.trim()) el.value = val;
        };
        set('billingCompanyName', result.companyName);
        set('billingCompanyAddress', result.address);
        set('billingRegCom', result.regCom);
        hint?.classList.remove('hidden');
      }, 600);
    });
  }

  // Clear error styling as the user edits any field.
  [
    'billingIdNumber', 'billingFirstName', 'billingLastName', 'billingPersonalAddress',
    'billingCompanyName', 'billingCui', 'billingRegCom', 'billingCompanyAddress',
  ].forEach((n) => {
    clearErrorOnInput(block.querySelector(`[name="${n}"]`));
  });
}

// Read + validate. Returns the billing object on success or { error } on
// failure. Field-level errors are highlighted in-place; caller decides
// whether to also surface a toast.
export function readBilling(scope) {
  const block = scope.querySelector('[data-billing-block]');
  if (!block) return { error: 'Missing billing block' };

  const get = (name) => block.querySelector(`[name="${name}"]`);
  const valueOf = (name) => get(name)?.value?.trim() || '';

  const typeRadios = block.querySelectorAll('input[name="billingType"]');
  const type = [...typeRadios].find((r) => r.checked)?.value === 'PJ' ? 'PJ' : 'PF';

  const idTypeRadios = block.querySelectorAll('input[name="billingIdType"]');
  const idType = [...idTypeRadios].find((r) => r.checked)?.value || 'CNP';

  const idNumber = valueOf('billingIdNumber');
  const firstName = valueOf('billingFirstName');
  const lastName = valueOf('billingLastName');
  const personalAddress = valueOf('billingPersonalAddress');

  const errors = [];
  const checks = [
    [get('billingIdNumber'), validateIdNumber(idType, idNumber), 'billing.errors.idNumber'],
    [get('billingFirstName'), required(firstName), 'billing.errors.firstName'],
    [get('billingLastName'), required(lastName), 'billing.errors.lastName'],
    [get('billingPersonalAddress'), required(personalAddress), 'billing.errors.personalAddress'],
  ];

  if (type === 'PJ') {
    const companyName = valueOf('billingCompanyName');
    const cui = valueOf('billingCui');
    const regCom = valueOf('billingRegCom');
    const companyAddress = valueOf('billingCompanyAddress');
    checks.push(
      [get('billingCompanyName'), required(companyName), 'billing.errors.companyName'],
      [get('billingCui'), isValidCui(cui), 'billing.errors.cui'],
      [get('billingRegCom'), isValidRegCom(regCom), 'billing.errors.regCom'],
      [get('billingCompanyAddress'), required(companyAddress), 'billing.errors.companyAddress'],
    );
  }

  for (const [input, ok, errKey] of checks) {
    setFieldError(input, !ok);
    if (!ok) errors.push(t(errKey));
  }
  if (errors.length) return { error: errors[0] };

  const result = { type, idType, idNumber, firstName, lastName, personalAddress };
  if (type === 'PJ') {
    result.companyName = valueOf('billingCompanyName');
    result.cui = valueOf('billingCui');
    result.regCom = valueOf('billingRegCom');
    result.companyAddress = valueOf('billingCompanyAddress');
  }
  return result;
}
