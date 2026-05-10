// Branded date/time picker — wraps flatpickr with mango/blueberry styling.
//
// Why flatpickr: native `<input type="datetime-local">` is ugly, can't be
// styled, opens AM/PM by default in some locales, and only opens on icon
// click on most browsers. flatpickr gives us 24h time, click-anywhere-opens,
// RO locale, and consistent visuals on every browser/device.
//
// Usage from a page template:
//   import { dateTimeFieldHtml, wireDateTime } from '../../components/core/FormDateTime.js';
//   ...
//   ${dateTimeFieldHtml({ name: 'dropoffAt', min: iso, value: iso, required: true })}
//   ...
//   wireDateTime(form);                         // attach pickers within scope
//
// Re-renders pick up the current locale (RO/EN) automatically. If the
// locale changes while the picker is mounted, call wireDateTime(scope)
// again on the same scope — it cleanly tears down + re-inits each picker.

import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';
import 'flatpickr/dist/flatpickr.min.css';
import '../../styles/flatpickr-theme.css';
import { getLocale } from '../../i18n/index.js';

// Renders a hidden text input that flatpickr will enhance. We deliberately
// use `type="text"` (not datetime-local) so the browser's native picker
// can never appear, and flag the element with `data-datetime` so
// `wireDateTime` can find it by selector.
export function dateTimeFieldHtml({
  name,
  value = '',
  min = '',
  max = '',
  required = false,
  dateOnly = false,
  placeholder = '',
  classes = 'w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry',
} = {}) {
  const attrs = [
    `type="text"`,
    `name="${name}"`,
    `data-datetime${dateOnly ? '="date"' : ''}`,
    `class="${classes}"`,
    `value="${value}"`,
    `placeholder="${placeholder}"`,
    `autocomplete="off"`,
    required ? 'required' : '',
    min ? `data-min="${min}"` : '',
    max ? `data-max="${max}"` : '',
  ].filter(Boolean).join(' ');
  return `<input ${attrs}>`;
}

const INSTANCE_KEY = '__fpInstance';

function altFormatFor(locale, dateOnly) {
  if (dateOnly) return locale === 'en' ? 'M j, Y' : 'j M Y';
  return locale === 'en' ? 'M j, Y · H:i' : 'j M Y · H:i';
}

export function wireDateTime(scope = document) {
  const locale = getLocale();
  const inputs = scope.querySelectorAll('input[data-datetime]');
  inputs.forEach((input) => {
    // Tear down any previous instance on this input (re-wire after locale
    // change is the canonical use case).
    if (input[INSTANCE_KEY]) {
      try { input[INSTANCE_KEY].destroy(); } catch { /* noop */ }
      input[INSTANCE_KEY] = null;
    }

    const dateOnly = input.dataset.datetime === 'date';
    const fp = flatpickr(input, {
      enableTime: !dateOnly,
      time_24hr: true,
      dateFormat: dateOnly ? 'Y-m-d' : 'Y-m-d H:i',
      altInput: true,
      altFormat: altFormatFor(locale, dateOnly),
      altInputClass: 'flatpickr-alt-input',
      clickOpens: true,
      allowInput: false,
      locale: locale === 'ro' ? Romanian : 'default',
      minDate: input.dataset.min || undefined,
      maxDate: input.dataset.max || undefined,
      minuteIncrement: 15,
      defaultDate: input.value || undefined,
    });
    input[INSTANCE_KEY] = fp;
  });
}

// Convenience: read the ISO value of a single field (the underlying hidden
// input always stores `Y-m-d H:i`, which we can convert if callers want
// a full ISO string).
export function readDateTime(input) {
  if (!input) return '';
  const fp = input[INSTANCE_KEY];
  if (!fp || !fp.selectedDates?.length) return input.value || '';
  return fp.selectedDates[0].toISOString();
}
