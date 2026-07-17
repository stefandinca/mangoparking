// PF/PJ billing fields — reusable block for booking forms + account profile.
//
// PF (Persoană fizică) captures: full name (one field), locality (oraș),
// address, and an OPTIONAL CNP. Per client feedback in v1.1 we no longer
// force a CNP/CI/Passport choice — most retail customers just want to pay,
// and only some need fiscal-grade invoicing.
// PJ (Persoană juridică) captures ONLY company info: name, CUI, Reg.Com
// (optional), company address. Romanian fiscal invoicing for legal entities
// doesn't require the rep's personal data — that's what CUI + RegCom are
// for. The CUI input debounces a call to the `lookupCui` Cloud Function
// (ANAF wrapper) and prefills name + address + regCom on success.
//
// Usage:
//   1. inject billingFieldsHtml(initial) into your form template
//   2. after mount: wireBillingToggle(formScope)
//   3. on submit: readBilling(formScope) → billing object OR { error }

import { t } from '../../i18n/index.js';
import { setFieldError, clearErrorOnInput, escapeHtml } from '../../utils/dom.js';
import { isValidCui, isValidRegCom, required, isValidCnp } from '../../utils/validators.js';
import { lookupCui } from '../../services/cuiService.js';

// ── County (Județ) + Locality dropdowns + "outside Romania" ─────────────────
// Shared by this widget's PF/PJ blocks, CreateTransactionModal and the admin
// collect-payment dialog. The invoice needs BOTH county and locality; when the
// customer is outside Romania the checkbox lifts the requirement and the
// server invoices under BUCUREȘTI/BUCUREȘTI (+ CNP 0000000000000 for PF).
// The 13.7k-locality dataset loads lazily as its own chunk on first use.

// CNP stand-in used on foreign customers' invoices/profiles.
export const ABROAD_CNP = '0000000000000';

let roGeoPromise = null;
function loadRoGeo() {
  if (!roGeoPromise) roGeoPromise = import('../../data/roLocalities.js').then((m) => m.default);
  return roGeoPromise;
}

// Diacritic/case-insensitive comparison key — matches stored values (legacy
// free text, ANAF spellings, cedilla-vs-comma diacritics) against the dataset.
const geoKey = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Markup for the abroad checkbox + the two selects. `names` picks the form
// field names so several instances can coexist in one form. Saved values are
// rendered as a provisional <option> so the form is meaningful pre-hydration.
export function geoFieldsHtml(names, { county = '', locality = '', abroad = false, compact = false } = {}) {
  const esc = escapeHtml;
  const inputCls = compact
    ? 'w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40 disabled:opacity-40'
    : 'w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry disabled:opacity-40';
  const label = (key) => (compact ? '' : `<label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t(key)} *</label>`);
  const ph = (key, alwaysStar) => esc(compact || alwaysStar ? `${t(key)} *` : t(key));
  return `
    <label class="flex items-center gap-2 cursor-pointer py-1">
      <input type="checkbox" name="${esc(names.abroad)}" ${abroad ? 'checked' : ''} class="accent-mango w-4 h-4">
      <span class="text-[13px] font-medium text-charcoal/70">${t('billing.abroad')}</span>
    </label>
    <div class="grid grid-cols-2 gap-2">
      <div>
        ${label('billing.county')}
        <select name="${esc(names.county)}" class="${inputCls}" ${abroad ? 'disabled' : ''}>
          <option value="">${ph('billing.county', true)}</option>
          ${county ? `<option value="${esc(county)}" selected>${esc(county)}</option>` : ''}
        </select>
      </div>
      <div>
        ${label('billing.locality')}
        <select name="${esc(names.locality)}" class="${inputCls}" ${abroad ? 'disabled' : ''}>
          <option value="">${ph('billing.locality', true)}</option>
          ${locality ? `<option value="${esc(locality)}" selected>${esc(locality)}</option>` : ''}
        </select>
      </div>
    </div>`;
}

function geoEls(scope, names) {
  return {
    county: scope.querySelector(`select[name="${names.county}"]`),
    locality: scope.querySelector(`select[name="${names.locality}"]`),
    abroad: scope.querySelector(`input[name="${names.abroad}"]`),
  };
}

function fillLocalityOptions(localitySel, list, keepValue) {
  const placeholder = localitySel.querySelector('option[value=""]')?.textContent || '';
  const match = keepValue ? list.find((l) => geoKey(l) === geoKey(keepValue)) : '';
  let htmlStr = `<option value="">${escapeHtml(placeholder)}</option>`
    + list.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  // A saved value outside the dataset (legacy free text) is kept as an extra
  // option rather than silently dropped.
  if (keepValue && !match) htmlStr += `<option value="${escapeHtml(keepValue)}">${escapeHtml(keepValue)}</option>`;
  localitySel.innerHTML = htmlStr;
  localitySel.value = match || keepValue || '';
}

// Hydrate + wire one county/locality/abroad trio. Idempotent per mount.
export async function wireGeoFields(scope, names) {
  const els = geoEls(scope, names);
  if (!els.county || !els.locality) return;
  const data = await loadRoGeo();
  const counties = Object.keys(data);

  const savedCounty = els.county.value;
  const countyMatch = savedCounty ? counties.find((c) => geoKey(c) === geoKey(savedCounty)) : '';
  const countyPh = els.county.querySelector('option[value=""]')?.textContent || '';
  els.county.innerHTML = `<option value="">${escapeHtml(countyPh)}</option>`
    + counties.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  els.county.value = countyMatch || '';

  fillLocalityOptions(els.locality, data[els.county.value] || [], els.locality.value);

  els.county.addEventListener('change', () => {
    fillLocalityOptions(els.locality, data[els.county.value] || [], '');
    setFieldError(els.county, false);
  });
  els.locality.addEventListener('change', () => setFieldError(els.locality, false));
  els.abroad?.addEventListener('change', () => {
    const off = els.abroad.checked;
    els.county.disabled = off;
    els.locality.disabled = off;
    if (off) { setFieldError(els.county, false); setFieldError(els.locality, false); }
  });
}

// Programmatic fill (ANAF autofill, saved-profile prefill). Matches the given
// county/locality against the dataset diacritic-insensitively; an unmatched
// locality is appended as an extra option so the value still round-trips.
export async function setGeoValues(scope, names, { county = '', locality = '', abroad } = {}) {
  const els = geoEls(scope, names);
  if (!els.county || !els.locality) return;
  const data = await loadRoGeo();
  if (typeof abroad === 'boolean' && els.abroad && els.abroad.checked !== abroad) {
    els.abroad.checked = abroad;
    els.abroad.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (county) {
    const match = Object.keys(data).find((c) => geoKey(c) === geoKey(county));
    els.county.value = match || '';
    fillLocalityOptions(els.locality, data[els.county.value] || [], locality);
  } else if (locality) {
    fillLocalityOptions(els.locality, data[els.county.value] || [], locality);
  }
}

// Read the trio. When abroad, county/locality are intentionally blank — the
// server substitutes BUCUREȘTI on the fiscal documents.
export function readGeoFields(scope, names) {
  const els = geoEls(scope, names);
  const abroad = !!els.abroad?.checked;
  return {
    abroad,
    county: abroad ? '' : String(els.county?.value || '').trim(),
    locality: abroad ? '' : String(els.locality?.value || '').trim(),
  };
}

const PF_GEO = { county: 'billingCounty', locality: 'billingLocality', abroad: 'billingAbroad' };
const PJ_GEO = { county: 'billingCompanyCounty', locality: 'billingCompanyLocality', abroad: 'billingCompanyAbroad' };

export function billingFieldsHtml(initial = {}) {
  const type = initial.type === 'PJ' ? 'PJ' : 'PF';
  const isPJ = type === 'PJ';
  // Stored billing is user-controlled text landing inside value="…" — it MUST
  // be escaped, or a crafted companyName in a customer profile executes when
  // an admin opens that customer (UserDetailModal renders this same block).
  const esc = (v) => escapeHtml(v || '');

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

      <!-- Personal block — PF only. PJ invoicing uses company data alone. -->
      <div class="space-y-3 ${isPJ ? 'hidden' : ''}" data-billing-pf-fields>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.name')} *</label>
          <input type="text" name="billingName" value="${esc(initial.name || [initial.firstName, initial.lastName].filter(Boolean).join(' '))}" autocomplete="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        ${geoFieldsHtml(PF_GEO, { county: initial.county, locality: initial.locality, abroad: initial.abroad === true })}
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.cnpOptional')}</label>
          <input type="text" name="billingCnp" value="${esc(initial.cnp)}" autocomplete="off" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.personalAddress')}</label>
          <input type="text" name="billingPersonalAddress" value="${esc(initial.address || initial.personalAddress)}" autocomplete="street-address" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <!-- PJ-only block — company fields with CUI autofill -->
      <div class="space-y-3 ${isPJ ? '' : 'hidden'}" data-billing-pj-fields>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.cui')} *</label>
          <div class="relative">
            <input type="text" name="billingCui" value="${esc(initial.cui)}" placeholder="RO12345678" autocomplete="off" class="w-full px-4 py-3 pr-10 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry" data-billing-cui-input>
            <span class="hidden absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-blueberry/30 border-t-blueberry animate-spin" data-billing-cui-spinner></span>
          </div>
          <p class="hidden text-[12px] text-leaf mt-1" data-billing-cui-hint>${t('billing.cuiAutofilled')}</p>
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.companyName')} *</label>
          <input type="text" name="billingCompanyName" value="${esc(initial.companyName)}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.regCom')} *</label>
          <input type="text" name="billingRegCom" value="${esc(initial.regCom)}" placeholder="J40/123/2020" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        ${geoFieldsHtml(PJ_GEO, { county: initial.county, locality: initial.locality, abroad: initial.abroad === true })}
        <div>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('billing.companyAddress')}</label>
          <input type="text" name="billingCompanyAddress" value="${esc(initial.companyAddress)}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>
    </div>
  `;
}

export function wireBillingToggle(scope) {
  const block = scope.querySelector('[data-billing-block]');
  if (!block) return;

  // Hydrate the county/locality dropdowns (lazy dataset — fire and forget).
  wireGeoFields(block, PF_GEO);
  wireGeoFields(block, PJ_GEO);

  // PF / PJ master toggle. Show personal block for PF, company block for PJ.
  const toggleWrap = block.querySelector('[data-billing-type-toggle]');
  const pjFields = block.querySelector('[data-billing-pj-fields]');
  const pfFields = block.querySelector('[data-billing-pf-fields]');
  if (toggleWrap && pjFields && pfFields) {
    toggleWrap.addEventListener('change', (e) => {
      const radio = e.target;
      if (!radio.matches('input[name="billingType"]')) return;
      const isPJ = radio.value === 'PJ';
      pjFields.classList.toggle('hidden', !isPJ);
      pfFields.classList.toggle('hidden', isPJ);
      toggleWrap.querySelectorAll('label').forEach((lbl) => {
        const inp = lbl.querySelector('input');
        lbl.classList.toggle('border-mango', inp.checked);
        lbl.classList.toggle('bg-mango/5', inp.checked);
        lbl.classList.toggle('border-frost-deep', !inp.checked);
      });
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
        // County + locality land in the dropdowns (diacritic-insensitive
        // match against the dataset); only when nothing is selected yet.
        if (!block.querySelector(`select[name="${PJ_GEO.locality}"]`)?.value) {
          setGeoValues(block, PJ_GEO, { county: result.county, locality: result.locality });
        }
        hint?.classList.remove('hidden');
      }, 600);
    });
  }

  // Clear error styling as the user edits any field.
  [
    'billingName', 'billingLocality', 'billingCnp',
    'billingPersonalAddress',
    'billingCompanyName', 'billingCui', 'billingRegCom', 'billingCompanyLocality', 'billingCompanyAddress',
  ].forEach((n) => {
    clearErrorOnInput(block.querySelector(`[name="${n}"]`));
  });
}

// Read + validate. Returns the billing object on success or { error } on
// failure. Field-level errors are highlighted in-place; caller decides
// whether to also surface a toast.
//
// PF returns: { type:'PF', name, firstName, lastName, locality, county, abroad, address, cnp? }
//   (firstName/lastName are derived from `name` for backward compatibility;
//    abroad:true → county/locality blank + cnp defaults to ABROAD_CNP.)
// PJ returns: { type:'PJ', companyName, cui, regCom, locality, county, abroad, companyAddress }
export function readBilling(scope) {
  const block = scope.querySelector('[data-billing-block]');
  if (!block) return { error: 'Missing billing block' };

  const get = (name) => block.querySelector(`[name="${name}"]`);
  const valueOf = (name) => get(name)?.value?.trim() || '';

  const typeRadios = block.querySelectorAll('input[name="billingType"]');
  const type = [...typeRadios].find((r) => r.checked)?.value === 'PJ' ? 'PJ' : 'PF';

  const errors = [];
  const checks = [];

  if (type === 'PF') {
    const name = valueOf('billingName');
    const geo = readGeoFields(block, PF_GEO);
    const address = valueOf('billingPersonalAddress');
    let cnp = valueOf('billingCnp');

    checks.push([get('billingName'), required(name), 'billing.errors.name']);
    if (!geo.abroad) {
      checks.push(
        [get('billingCounty'), required(geo.county), 'billing.errors.county'],
        [get('billingLocality'), required(geo.locality), 'billing.errors.locality'],
      );
    }
    // CNP is optional — but if filled, it must pass the checksum. Foreign
    // customers have no CNP: abroad defaults it to the 13-zero stand-in
    // (which would fail the checksum, so validation is skipped).
    if (geo.abroad) {
      if (!cnp) cnp = ABROAD_CNP;
    } else if (cnp) {
      checks.push([get('billingCnp'), isValidCnp(cnp), 'billing.errors.cnp']);
    }

    for (const [input, ok, errKey] of checks) {
      setFieldError(input, !ok);
      if (!ok) errors.push(t(errKey));
    }
    if (errors.length) return { error: errors[0] };

    // A single full-name field is captured. We still derive firstName/lastName
    // (first token / the rest) so existing consumers — the admin payer form,
    // user-detail display, future SmartBill — keep working unchanged, and we
    // store the canonical `name` alongside.
    const parts = name.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || name;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    const result = { type, name, firstName, lastName, locality: geo.locality, county: geo.county, abroad: geo.abroad, address };
    if (cnp) result.cnp = cnp;
    return result;
  }

  // PJ
  const companyName = valueOf('billingCompanyName');
  const cui = valueOf('billingCui');
  const regCom = valueOf('billingRegCom');
  const geo = readGeoFields(block, PJ_GEO);
  const companyAddress = valueOf('billingCompanyAddress');

  checks.push(
    [get('billingCompanyName'), required(companyName), 'billing.errors.companyName'],
    [get('billingCui'), isValidCui(cui), 'billing.errors.cui'],
    // regCom is now mandatory for PJ (SmartBill requires it) — must be present
    // AND well-formed (J40/123/2020).
    [get('billingRegCom'), required(regCom) && isValidRegCom(regCom), 'billing.errors.regCom'],
  );
  if (!geo.abroad) {
    checks.push(
      [get('billingCompanyCounty'), required(geo.county), 'billing.errors.county'],
      [get('billingCompanyLocality'), required(geo.locality), 'billing.errors.locality'],
    );
  }

  for (const [input, ok, errKey] of checks) {
    setFieldError(input, !ok);
    if (!ok) errors.push(t(errKey));
  }
  if (errors.length) return { error: errors[0] };

  return { type, companyName, cui, regCom, locality: geo.locality, county: geo.county, abroad: geo.abroad, companyAddress };
}
