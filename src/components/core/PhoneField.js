// International phone field — a country dial-code <select> next to a national
// number <input>. The input keeps the caller's `name`, so existing form reads
// (`form.phone`, `form.elements.phone`, setFieldError) still target it; read
// the full E.164 number with phoneValue(input) at validate/submit time.
//
// No JS wiring: the markup is a plain string (rendered raw by the `html` tag),
// and phoneValue() reads the current select + input on demand. The default
// country is Romania (+40); a stored value is split for display but the
// combined value round-trips regardless of how the split lands.

import { escapeHtml } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';

// [ISO, dial, name]. Romania first (default); the rest alphabetical by name.
// Names are kept in English (universally recognizable) — the dial code is the
// functional part, so we don't maintain a bilingual country table.
export const DIAL_CODES = [
  ['RO', '40', 'Romania'],
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
  ['QA', '974', 'Qatar'], ['RU', '7', 'Russia'], ['SA', '966', 'Saudi Arabia'],
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

function optionsHtml(selectedDial) {
  return DIAL_CODES.map(([, d, n]) =>
    `<option value="${d}"${d === selectedDial ? ' selected' : ''}>${escapeHtml(n)} +${d}</option>`
  ).join('');
}

// Renders the dial-code <select> + national <input> group. `inputClass` /
// `selectClass` let each form match its own styling; the input carries `name`.
export function phoneField({
  name = 'phone', value = '', placeholder = '', required = false,
  inputClass = '', selectClass = '', id = '',
} = {}) {
  const { dial, national } = parsePhone(value);
  const selCls = selectClass
    || 'shrink-0 w-[7rem] px-2 py-3 rounded-xl border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry';
  const inCls = inputClass
    || 'flex-1 min-w-0 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry';
  return `
    <div class="flex gap-2" data-phone-field>
      <select data-phone-code aria-label="${escapeHtml(t('common.phoneCountry'))}" class="${selCls}">
        ${optionsHtml(dial)}
      </select>
      <input ${id ? `id="${escapeHtml(id)}" ` : ''}type="tel"${required ? ' required' : ''} name="${escapeHtml(name)}" data-phone-national inputmode="tel" autocomplete="tel-national" value="${escapeHtml(national)}" placeholder="${escapeHtml(placeholder)}" class="${inCls}">
    </div>`;
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
