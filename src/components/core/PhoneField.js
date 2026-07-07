// International phone field — a custom country dial-code dropdown (with real
// SVG flags, so they render on Windows too) next to a national number <input>.
// The input keeps the caller's `name`, so existing form reads (`form.phone`,
// `form.elements.phone`, setFieldError) still target it; read the full E.164
// number with phoneValue(input) at validate/submit time.
//
// Zero per-caller wiring: the markup is a plain string (rendered raw by the
// `html` tag) and a single document-level delegated handler (installed once)
// drives every dropdown on the page. The selected dial code lives in a hidden
// input (`[data-phone-code]`), so phoneValue() reads it exactly like before.
// The default country is Romania (+40); a stored value is split for display
// but the combined value round-trips regardless of how the split lands.

import { escapeHtml } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';
import { flagSvg } from './flagSvg.js';

// [ISO, dial, name]. Sorted alphabetically by country name; Romania (+40) is
// still the default selection (via DEFAULT_DIAL), it's just no longer pinned to
// the top. Names are kept in English (universally recognizable) — the dial code
// is the functional part, so we don't maintain a bilingual country table.
export const DIAL_CODES = [
  ['AL', '355', 'Albania'], ['DZ', '213', 'Algeria'], ['AR', '54', 'Argentina'],
  ['AM', '374', 'Armenia'], ['AU', '61', 'Australia'], ['AT', '43', 'Austria'],
  ['AZ', '994', 'Azerbaijan'], ['BH', '973', 'Bahrain'], ['BY', '375', 'Belarus'],
  ['BE', '32', 'Belgium'], ['BA', '387', 'Bosnia and Herzegovina'], ['BR', '55', 'Brazil'],
  ['BG', '359', 'Bulgaria'], ['CA', '1', 'Canada'], ['CL', '56', 'Chile'],
  ['CN', '86', 'China'], ['CO', '57', 'Colombia'], ['HR', '385', 'Croatia'],
  ['CY', '357', 'Cyprus'], ['CZ', '420', 'Czechia'], ['DK', '45', 'Denmark'],
  ['EG', '20', 'Egypt'], ['EE', '372', 'Estonia'], ['FI', '358', 'Finland'],
  ['FR', '33', 'France'], ['GE', '995', 'Georgia'], ['DE', '49', 'Germany'],
  ['GR', '30', 'Greece'], ['HK', '852', 'Hong Kong'], ['HU', '36', 'Hungary'],
  ['IS', '354', 'Iceland'], ['IN', '91', 'India'], ['ID', '62', 'Indonesia'],
  ['IR', '98', 'Iran'], ['IQ', '964', 'Iraq'], ['IE', '353', 'Ireland'],
  ['IL', '972', 'Israel'], ['IT', '39', 'Italy'], ['JP', '81', 'Japan'],
  ['JO', '962', 'Jordan'], ['KZ', '7', 'Kazakhstan'], ['KE', '254', 'Kenya'],
  ['XK', '383', 'Kosovo'], ['KW', '965', 'Kuwait'], ['LV', '371', 'Latvia'],
  ['LB', '961', 'Lebanon'], ['LY', '218', 'Libya'], ['LI', '423', 'Liechtenstein'],
  ['LT', '370', 'Lithuania'], ['LU', '352', 'Luxembourg'], ['MY', '60', 'Malaysia'],
  ['MT', '356', 'Malta'], ['MX', '52', 'Mexico'], ['MD', '373', 'Moldova'],
  ['MC', '377', 'Monaco'], ['ME', '382', 'Montenegro'], ['MA', '212', 'Morocco'],
  ['NL', '31', 'Netherlands'], ['NZ', '64', 'New Zealand'], ['MK', '389', 'North Macedonia'],
  ['NO', '47', 'Norway'], ['OM', '968', 'Oman'], ['PK', '92', 'Pakistan'],
  ['PH', '63', 'Philippines'], ['PL', '48', 'Poland'], ['PT', '351', 'Portugal'],
  ['QA', '974', 'Qatar'], ['RO', '40', 'Romania'], ['RU', '7', 'Russia'], ['SA', '966', 'Saudi Arabia'],
  ['RS', '381', 'Serbia'], ['SG', '65', 'Singapore'], ['SK', '421', 'Slovakia'],
  ['SI', '386', 'Slovenia'], ['ZA', '27', 'South Africa'], ['KR', '82', 'South Korea'],
  ['ES', '34', 'Spain'], ['SE', '46', 'Sweden'], ['CH', '41', 'Switzerland'],
  ['SY', '963', 'Syria'], ['TW', '886', 'Taiwan'], ['TH', '66', 'Thailand'],
  ['TN', '216', 'Tunisia'], ['TR', '90', 'Turkey'], ['UA', '380', 'Ukraine'],
  ['AE', '971', 'United Arab Emirates'], ['GB', '44', 'United Kingdom'],
  ['US', '1', 'United States'], ['VN', '84', 'Vietnam'],
];

const DEFAULT_DIAL = '40';

function digitsOnly(s) { return String(s ?? '').replace(/\D/g, ''); }

// First ISO code registered for a dial code (some dials are shared, e.g. +1 →
// CA/US, +7 → RU/KZ). Only used to pick which flag the closed button shows.
function isoForDial(dial) {
  return DIAL_CODES.find(([, d]) => d === dial)?.[0] || 'RO';
}

// Build the combined E.164 number from a dial code + a national number as
// typed. Strips a single leading trunk zero (the national-prefix convention
// across RO/DE/FR/NL/GB/…) so "0769…" under +40 becomes +40769….
export function combinePhone(dial, national) {
  // If a full international number was pasted/typed into the national box
  // (leading "+"), use it verbatim instead of prefixing the dial again.
  const natRaw = String(national ?? '').trim();
  if (natRaw.startsWith('+')) {
    const d = digitsOnly(natRaw);
    return d ? `+${d}` : '';
  }
  const nat = digitsOnly(national).replace(/^0/, '');
  const dd = digitsOnly(dial);
  if (!nat || !dd) return '';
  return `+${dd}${nat}`;
}

// Split a stored value into { dial, national } for the two controls. The
// combined value round-trips regardless of how the split lands, so this only
// needs to be good enough for display.
export function parsePhone(value) {
  const raw = String(value ?? '').replace(/[\s-]/g, '');
  if (raw.startsWith('+')) {
    const rest = raw.slice(1);
    // Longest dial-code match wins (so +373… isn't read as +3…).
    const codes = [...new Set(DIAL_CODES.map((x) => x[1]))].sort((a, b) => b.length - a.length);
    for (const d of codes) {
      if (rest.startsWith(d)) return { dial: d, national: rest.slice(d.length) };
    }
    return { dial: DEFAULT_DIAL, national: rest };
  }
  // Local format (e.g. RO 07…) — assume the default country, keep as typed.
  return { dial: DEFAULT_DIAL, national: raw };
}

// A ~15×20px flag chip (rounded, hairline ring) wrapping the inline SVG.
function flagChip(iso) {
  return `<span class="inline-flex shrink-0 w-5 h-[15px] overflow-hidden rounded-[2px] ring-1 ring-black/10">${flagSvg(iso, 'block w-full h-full')}</span>`;
}

function optionsHtml(selectedDial) {
  return DIAL_CODES.map(([iso, d, name]) =>
    `<li role="option" data-phone-option data-dial="${d}" data-iso="${iso}" tabindex="-1"
       class="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-[13px] hover:bg-frost ${d === selectedDial ? 'bg-frost' : ''}">
       ${flagChip(iso)}
       <span class="min-w-0 truncate">${escapeHtml(name)}</span>
       <span class="ml-auto shrink-0 font-mono text-charcoal/60">+${d}</span>
     </li>`
  ).join('');
}

// Renders the dial-code dropdown + national <input> group. `inputClass` /
// `selectClass` let each form match its own styling; `selectClass` is applied
// to the dropdown button (which stands in for the old <select>), and the input
// carries `name`.
export function phoneField({
  name = 'phone', value = '', placeholder = '', required = false,
  inputClass = '', selectClass = '', id = '',
} = {}) {
  installPhoneFieldHandlers();
  const { dial, national } = parsePhone(value);
  const iso = isoForDial(dial);
  const selCls = selectClass
    || 'shrink-0 w-[7rem] px-2 py-3 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry';
  const inCls = inputClass
    || 'flex-1 min-w-0 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry';
  return `
    <div class="flex gap-2" data-phone-field>
      <div class="relative shrink-0">
        <button type="button" data-phone-toggle aria-haspopup="listbox" aria-expanded="false"
          aria-label="${escapeHtml(t('common.phoneCountry'))}"
          class="${selCls} flex items-center gap-1.5 text-left">
          <span data-phone-flag class="inline-flex">${flagChip(iso)}</span>
          <span data-phone-dial class="font-mono">+${dial}</span>
          <svg class="ml-auto w-3 h-3 shrink-0 text-charcoal/50" viewBox="0 0 12 12" fill="none"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <input type="hidden" data-phone-code value="${dial}">
        <div data-phone-panel class="hidden absolute left-0 top-full mt-1 z-50 w-64 max-w-[80vw] rounded-xl border border-frost-deep bg-white shadow-xl overflow-hidden">
          <div class="sticky top-0 bg-white p-2 border-b border-frost-deep">
            <input type="text" data-phone-search inputmode="search"
              placeholder="${escapeHtml(t('common.phoneCountrySearch'))}"
              class="w-full px-3 py-1.5 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry">
          </div>
          <ul role="listbox" data-phone-options class="max-h-56 overflow-y-auto py-1">
            ${optionsHtml(dial)}
          </ul>
          <div data-phone-empty class="hidden px-2.5 py-3 text-[13px] text-charcoal/50 text-center">${escapeHtml(t('common.phoneCountryNone'))}</div>
        </div>
      </div>
      <input ${id ? `id="${escapeHtml(id)}" ` : ''}type="tel"${required ? ' required' : ''} name="${escapeHtml(name)}" data-phone-national inputmode="tel" autocomplete="tel-national" value="${escapeHtml(national)}" placeholder="${escapeHtml(placeholder)}" class="${inCls}">
    </div>`;
}

// ── Dropdown behaviour ──────────────────────────────────────────────────────
// One delegated handler on `document`, installed on first phoneField() render.
// It opens/closes panels, filters on search, and commits a selection — for
// every phone field on the page, with no per-caller wiring.
let handlersInstalled = false;

function closeAllPhonePanels(except) {
  document.querySelectorAll('[data-phone-panel]:not(.hidden)').forEach((panel) => {
    if (panel === except) return;
    panel.classList.add('hidden');
    panel.closest('[data-phone-field]')?.querySelector('[data-phone-toggle]')
      ?.setAttribute('aria-expanded', 'false');
  });
}

function commitPhoneCountry(field, dial, iso) {
  field.querySelector('[data-phone-code]').value = dial;
  const flag = field.querySelector('[data-phone-flag]');
  if (flag) flag.innerHTML = flagChip(iso);
  const dialLabel = field.querySelector('[data-phone-dial]');
  if (dialLabel) dialLabel.textContent = `+${dial}`;
}

function filterPhoneOptions(panel, query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  panel.querySelectorAll('[data-phone-option]').forEach((li) => {
    const hit = !q || li.textContent.toLowerCase().includes(q) || li.dataset.iso.toLowerCase().includes(q);
    li.classList.toggle('hidden', !hit);
    if (hit) shown += 1;
  });
  panel.querySelector('[data-phone-empty]')?.classList.toggle('hidden', shown > 0);
}

function installPhoneFieldHandlers() {
  if (handlersInstalled || typeof document === 'undefined') return;
  handlersInstalled = true;

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest?.('[data-phone-toggle]');
    if (toggle) {
      e.preventDefault();
      const field = toggle.closest('[data-phone-field]');
      const panel = field.querySelector('[data-phone-panel]');
      const willOpen = panel.classList.contains('hidden');
      closeAllPhonePanels(willOpen ? panel : null);
      panel.classList.toggle('hidden', !willOpen);
      toggle.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        const search = panel.querySelector('[data-phone-search]');
        if (search) { search.value = ''; filterPhoneOptions(panel, ''); search.focus(); }
      }
      return;
    }
    const option = e.target.closest?.('[data-phone-option]');
    if (option) {
      const field = option.closest('[data-phone-field]');
      commitPhoneCountry(field, option.dataset.dial, option.dataset.iso);
      closeAllPhonePanels();
      field.querySelector('[data-phone-national]')?.focus();
      return;
    }
    // A click anywhere else (including inside the search box) closes any other
    // open panels; a click truly outside closes them all.
    closeAllPhonePanels(e.target.closest?.('[data-phone-panel]') || null);
  });

  document.addEventListener('input', (e) => {
    const search = e.target.closest?.('[data-phone-search]');
    if (search) filterPhoneOptions(search.closest('[data-phone-panel]'), search.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllPhonePanels(); return; }
    if (e.key === 'Enter') {
      const search = e.target.closest?.('[data-phone-search]');
      if (!search) return;
      e.preventDefault();
      const panel = search.closest('[data-phone-panel]');
      const first = panel.querySelector('[data-phone-option]:not(.hidden)');
      if (first) {
        const field = panel.closest('[data-phone-field]');
        commitPhoneCountry(field, first.dataset.dial, first.dataset.iso);
        closeAllPhonePanels();
        field.querySelector('[data-phone-national]')?.focus();
      }
    }
  });
}

// Reads the full E.164 number from a phone field, given its national <input>
// (the element named `name`). Falls back to the raw value if the input isn't
// wrapped in a phone field (defensive — e.g. a form not yet migrated).
export function phoneValue(input) {
  if (!input) return '';
  const root = input.closest?.('[data-phone-field]');
  if (!root) return String(input.value ?? '').trim();
  const dial = root.querySelector('[data-phone-code]')?.value || DEFAULT_DIAL;
  const national = root.querySelector('[data-phone-national]')?.value || '';
  return combinePhone(dial, national);
}
