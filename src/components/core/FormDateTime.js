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
import { getLocale, t } from '../../i18n/index.js';

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
  // When the user finishes this picker, auto-open the input whose `name`
  // matches `stepToNext`. Drives the step-through wizard UX (drop-off →
  // pick-up auto-advance) without a custom modal.
  stepToNext = '',
  // Optional small step badge ("1", "2") shown via wrapping markup if the
  // caller chooses to render labels around the field — purely informational
  // for accessibility, not enforced here.
  step = '',
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
    stepToNext ? `data-step-to-next="${stepToNext}"` : '',
    step ? `data-step="${step}"` : '',
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
    const stepToNext = input.dataset.stepToNext || '';
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
      // Force the themed picker on mobile — by default flatpickr swaps in
      // the browser's native datetime-local widget on phones, which clashes
      // with the rest of the booking form. Our CSS handles a touch-friendly
      // layout; the native one looked nothing like the desktop picker.
      disableMobile: true,
      minDate: input.dataset.min || undefined,
      maxDate: input.dataset.max || undefined,
      minuteIncrement: 15,
      defaultDate: input.value || undefined,
      onReady: (_dates, _str, instance) => {
        // Inject an in-picker "Next step / Done" button. Two problems
        // solved at once:
        //   1. On mobile (and to a lesser extent desktop) the only way
        //      to confirm a date+time was to tap outside the picker —
        //      counterintuitive and easy to mis-tap.
        //   2. The step-through chaining (drop-off → pick-up) was
        //      indirect: pick a time → tap outside → next picker opens.
        //      Now there's an explicit "Pasul următor" button.
        injectConfirmButton(instance, stepToNext);
      },
      onClose: stepToNext
        ? (selectedDates, dateStr) => {
            // Step-through wizard: when this picker closes with a value,
            // auto-open the named "next" picker. Small timeout lets the
            // current overlay finish closing first.
            if (!dateStr) return;
            setTimeout(() => {
              const next = (scope.querySelector || document.querySelector).call(
                scope,
                `input[name="${stepToNext}"]`
              );
              const nextFp = next?.[INSTANCE_KEY];
              if (nextFp) nextFp.open();
            }, 120);
          }
        : undefined,
    });
    input[INSTANCE_KEY] = fp;
  });
}

// Append a single "Next step / Done" button to the flatpickr calendar
// container. Idempotent — checks for an existing button on re-init.
function injectConfirmButton(instance, stepToNext) {
  if (!instance?.calendarContainer) return;
  const existing = instance.calendarContainer.querySelector('.flatpickr-mp-confirm');
  if (existing) existing.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'flatpickr-mp-confirm';
  btn.textContent = stepToNext
    ? t('picker.nextStep')
    : t('picker.done');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    instance.close();
  });
  instance.calendarContainer.appendChild(btn);
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
