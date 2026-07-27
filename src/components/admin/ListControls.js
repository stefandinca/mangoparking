// Shared admin list controls: the date-range bar and the pager.
//
// Used by /admin/audit and the user-profile activity block. Kept in one place
// so the two stay visually identical and a styling fix lands in both — the
// pager in particular has a non-obvious constraint: the admin page background
// is `frost`, so a "disabled" button must NOT be frost (it disappears) and an
// enabled one needs a border or it floats. Hence `disabled:` variants over a
// swapped background, and a pager that lives inside a card.
//
// The date math itself is in auditFormat.js (DOM-free, unit-tested).

import { escapeHtml, qs } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';
import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';
// Mounting flatpickr directly means importing its stylesheet directly too —
// elsewhere it arrives via the FormDateTime component (see style.css).
import 'flatpickr/dist/flatpickr.min.css';
import '../../styles/flatpickr-theme.css';
import { bucharestToday } from './auditFormat.js';

const PAGER_BTN = 'px-3 py-1.5 rounded-xl bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white';

function pill(key, activeKey, label) {
  const isActive = key === activeKey;
  const cls = isActive ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost';
  return `<button type="button" data-window="${key}" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${cls}">${label}</button>`;
}

/**
 * Markup for the preset pills + custom-range input.
 * `activeWindow` is 'today' | '7d' | '30d' | [fromDay, toDay].
 * Call mountRangePicker() on the same element afterwards to bring it to life.
 */
export function rangeBarHtml(activeWindow) {
  const isRange = Array.isArray(activeWindow);
  const presetActive = isRange ? null : activeWindow;
  const rangeValue = isRange ? `${activeWindow[0]} to ${activeWindow[1]}` : '';
  const btnCls = rangeInputClass(isRange);
  return `
    <span class="text-[12px] uppercase tracking-wider text-dim font-mono mr-1">${t('audit.rangeLabel')}</span>
    ${pill('today', presetActive, t('audit.rangeToday'))}
    ${pill('7d', presetActive, t('audit.range7d'))}
    ${pill('30d', presetActive, t('audit.range30d'))}
    <span class="text-[12px] text-dim mx-1">${t('audit.rangeOr')}</span>
    <span class="relative inline-flex items-center">
      <svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isRange ? 'text-charcoal/70' : 'text-charcoal/40'}" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 9h16.5M5.25 5.25h13.5A1.5 1.5 0 0 1 20.25 6.75v12A1.5 1.5 0 0 1 18.75 20.25H5.25A1.5 1.5 0 0 1 3.75 18.75v-12A1.5 1.5 0 0 1 5.25 5.25z"/></svg>
      <input type="text" data-range-picker value="${escapeHtml(rangeValue)}" placeholder="${t('audit.rangeCustom')}" class="${btnCls}">
    </span>
  `;
}

function rangeInputClass(isRange) {
  return `pl-3 pr-9 py-1.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors min-w-[200px] focus:outline-none ${isRange ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost'}`;
}

/**
 * Mount the custom-range flatpickr inside a bar rendered by rangeBarHtml.
 * Returns the instance — the caller MUST destroy it before replacing the bar's
 * markup and on route cleanup, or the calendar (which lives on document.body)
 * is orphaned and swallows taps meant for the next one.
 */
export function mountRangePicker(barEl, { activeWindow, locale, onPick }) {
  const input = qs('[data-range-picker]', barEl);
  if (!input) return null;
  const isRange = Array.isArray(activeWindow);
  return flatpickr(input, {
    mode: 'range',
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: locale === 'en' ? 'M j, Y' : 'j M Y',
    altInputClass: `flatpickr-alt-input ${rangeInputClass(isRange)}`,
    locale: locale === 'ro' ? Romanian : 'default',
    maxDate: bucharestToday(),
    clickOpens: true,
    allowInput: false,
    defaultDate: isRange ? activeWindow : null,
    onClose: (dates) => {
      if (dates.length !== 2) return;
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      onPick([fmt(dates[0]), fmt(dates[1])]);
    },
  });
}

/**
 * Pager footer row. Render it INSIDE the results card (it has a top border and
 * no background of its own). Buttons carry data-page-prev / data-page-next.
 */
export function pagerHtml({ page, pages, from, to, total }) {
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-frost-deep">
      <p class="text-[13px] text-dim">${escapeHtml(t('audit.showingRange', { from, to, total }))}</p>
      <div class="flex items-center gap-2">
        <button type="button" data-page-prev ${page <= 1 ? 'disabled' : ''} class="${PAGER_BTN}">${t('audit.prev')}</button>
        <span class="text-[13px] text-dim font-mono px-1">${escapeHtml(t('audit.pageOf', { page, pages }))}</span>
        <button type="button" data-page-next ${page >= pages ? 'disabled' : ''} class="${PAGER_BTN}">${t('audit.next')}</button>
      </div>
    </div>`;
}
