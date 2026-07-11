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

// Also referenced by Modal.js, which destroys any picker mounted inside a
// closing modal via this key (flatpickr calendars live on document.body and
// would otherwise outlive the modal). Keep the two in sync.
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
        // Swap flatpickr's number-spinner time UI for a rentalcars-style
        // horizontal slider (a draggable HH:MM pill).
        injectTimeSlider(instance, dateOnly);
      },
      // Repaint the pill once the calendar is actually visible (its track has
      // no measurable width while hidden), and keep it in step when a day
      // click rebuilds the selection. No-ops on date-only pickers.
      onOpen: (_dates, _str, instance) => instance.__mpSyncTimeSlider?.(),
      onChange: (_dates, _str, instance) => instance.__mpSyncTimeSlider?.(),
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
    // If a preloaded value was filtered out by min/max, flatpickr leaves the
    // raw string in the hidden input while showing an empty field — clear it
    // so an invisible value can never be submitted.
    if (!fp.selectedDates?.length && input.value) input.value = '';
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

// Replace flatpickr's numeric hour/minute spinner with a rentalcars-style
// horizontal time slider: a draggable pill that shows HH:MM and snaps to the
// 15-minute grid. The native <input type=range> underneath keeps it keyboard-
// accessible; the visible pill is a separate element positioned over the
// (invisible) thumb. Only for time-enabled pickers — date-only ones have no
// time to set, so they keep the plain calendar.
const TIME_THUMB_PX = 54; // must match .mp-time-range thumb width in the CSS

function injectTimeSlider(instance, dateOnly) {
  if (dateOnly || !instance?.calendarContainer) return;
  const cc = instance.calendarContainer;
  cc.querySelector('.mp-time-slider')?.remove();
  // Scope the "hide the default spinner" rule to pickers we actually enhanced.
  cc.classList.add('mp-has-time-slider');

  const wrap = document.createElement('div');
  wrap.className = 'mp-time-slider';
  wrap.innerHTML = `
    <span class="mp-time-slider-label">${t('picker.time')}</span>
    <div class="mp-time-slider-track">
      <span class="mp-time-slider-fill"></span>
      <input type="range" class="mp-time-range" min="0" max="1425" step="15" value="600" aria-label="${t('picker.time')}">
      <span class="mp-time-slider-bubble">10:00</span>
    </div>`;

  const track = wrap.querySelector('.mp-time-slider-track');
  const range = wrap.querySelector('.mp-time-range');
  const bubble = wrap.querySelector('.mp-time-slider-bubble');
  const fill = wrap.querySelector('.mp-time-slider-fill');

  const fmt = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // Position the pill (and the blue fill) over the native thumb. The thumb's
  // centre travels between THUMB/2 and trackW − THUMB/2, so mirror that inset.
  // `displayMins` lets the bubble show the TRUE committed time even when the
  // native range value is snapped to the 15-min grid (e.g. a minDate clamp
  // committed 14:37) — the pill must never disagree with the field.
  const paint = (displayMins = Number(range.value)) => {
    const max = Number(range.max) || 1;
    const pct = Number(range.value) / max;
    bubble.textContent = fmt(displayMins);
    const trackW = track.clientWidth || 0;
    const inset = TIME_THUMB_PX / 2;
    const x = inset + pct * Math.max(0, trackW - TIME_THUMB_PX);
    bubble.style.left = `${x}px`;
    fill.style.width = `${x}px`;
  };

  // Pull the current time out of flatpickr into the slider. The range thumb
  // snaps to the 15-min grid, but the bubble shows the committed minutes.
  const syncFromInstance = () => {
    const d = instance.selectedDates?.[0] || new Date();
    const trueMins = Math.min(1439, Math.max(0, d.getHours() * 60 + d.getMinutes()));
    const snapped = Math.min(1425, Math.max(0, Math.round(trueMins / 15) * 15));
    range.value = String(snapped);
    paint(trueMins);
  };
  instance.__mpSyncTimeSlider = syncFromInstance;

  range.addEventListener('input', () => {
    const mins = Number(range.value);
    // Fresh `new Date()` — instance.now is frozen at wire time, so a picker
    // left mounted across midnight would back-date the day.
    const base = instance.selectedDates?.[0]
      ? new Date(instance.selectedDates[0])
      : new Date();
    base.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    // flatpickr FILTERS out-of-range dates in setDate (clearing the whole
    // selection) rather than clamping — dragging the slider below the min
    // time on the min day used to silently wipe the picked date. Clamp here.
    const min = instance.config?.minDate;
    const max = instance.config?.maxDate;
    let target = base;
    if (min && target < min) target = new Date(min);
    if (max && target > max) target = new Date(max);
    // triggerChange=true writes through to the hidden + alt input and fires
    // onChange (which re-syncs the pill to whatever actually committed).
    instance.setDate(target, true);
    paint();
  });

  // Sit above the confirm button when it's there, else at the bottom.
  const confirm = cc.querySelector('.flatpickr-mp-confirm');
  if (confirm) cc.insertBefore(wrap, confirm);
  else cc.appendChild(wrap);

  syncFromInstance();
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
