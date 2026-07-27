// Admin → Jurnal acțiuni (/admin/audit).
//
// The full staff-action history behind the dashboard's short "recent
// activity" summary: who did what, when. Three controls stack:
//   1. a DATE RANGE (today / 7 days / 30 days / custom) — the Firestore query
//   2. action + actor dropdowns, built from what the range actually returned
//   3. a free-text search over the rendered row
// …then the result is paginated client-side.
//
// Why client-side paging: the range query is one indexed read capped at
// AUDIT_RANGE_MAX, and filters must apply across the WHOLE range (a cursor
// page would filter only its own slice, so "action = refund" could show an
// empty page 1 while page 4 has matches). The cap is surfaced in the UI
// rather than silently truncating.

import { html, delegate, escapeHtml, qs } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { listAuditRange, AUDIT_RANGE_MAX } from '../../services/auditService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import {
  actionStyle, actionLabel, describeAction, fmtAuditTime,
  RANGE_PRESETS as PRESETS, bucharestToday, windowToIso,
} from '../../components/admin/auditFormat.js';
import { bucharestLocalToIso } from '../../utils/date.js';
import flatpickr from 'flatpickr';
import { Romanian } from 'flatpickr/dist/l10n/ro.js';
// Mounting flatpickr directly means importing its stylesheet directly too.
// Everywhere else the picker arrives via the FormDateTime component, which
// carries these two imports (see the theming note in style.css) — AdminCheckIns
// drives flatpickr itself but still imports FormDateTime, so it inherits them.
// This page doesn't, and without them the calendar renders completely unstyled.
import 'flatpickr/dist/flatpickr.min.css';
import '../../styles/flatpickr-theme.css';

const PAGE_SIZE = 25;

// Secondary-button styling, matching the rest of the admin (AdminUsers export,
// UserDetailModal, Login): white + frost-deep border, and a disabled state
// expressed with `disabled:` variants rather than a swapped background — a
// frost background would disappear into the frost page.
const PAGER_BTN = 'px-3 py-1.5 rounded-xl bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white';

function pill(key, activeKey, label) {
  const isActive = key === activeKey;
  const cls = isActive ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost';
  return `<button type="button" data-window="${key}" class="px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${cls}">${label}</button>`;
}

export default async function AdminAudit(container) {
  updateMeta({
    title: `${t('admin.auditLog')} — Admin — ManGO Parking`,
    description: 'Staff action history.',
  });

  const locale = getLocale();

  // ── State (mirrored into the URL so a refresh or a shared link lands in the
  // same view) ──────────────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const urlRange = params.get('range') || '';
  const customRange = urlRange.split('..');
  const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  let activeWindow = customRange.length === 2 && customRange.every(isYmd)
    ? customRange
    : (PRESETS[urlRange] !== undefined ? urlRange : '7d');
  let page = Math.max(1, Number(params.get('page')) || 1);
  let search = params.get('q') || '';
  let actionFilter = 'all';
  let userFilter = 'all';

  let rows = [];
  let capped = false;
  let loading = true;
  let rangeFp = null;

  const pageEl = AdminLayout('/admin/audit', `
        <div class="mb-6">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.auditLog')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.auditSubtitle')}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 mb-4" data-window-bar></div>
        <div class="flex flex-col sm:flex-row gap-3 mb-6" data-filter-bar></div>
        <div data-audit-content></div>
  `);

  const windowBarEl = qs('[data-window-bar]', pageEl);
  const filterBarEl = qs('[data-filter-bar]', pageEl);
  const contentEl = qs('[data-audit-content]', pageEl);

  function setUrl() {
    const p = new URLSearchParams();
    p.set('range', Array.isArray(activeWindow) ? activeWindow.join('..') : activeWindow);
    if (page > 1) p.set('page', String(page));
    if (search) p.set('q', search);
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  }

  // ── Filtering + paging (pure, over the loaded range) ──────────────────────
  function visibleRows() {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== 'all' && r.action !== actionFilter) return false;
      if (userFilter !== 'all' && r.user !== userFilter) return false;
      if (!q) return true;
      const hay = `${r.action} ${r.entity} ${r.user} ${describeAction(r, locale)}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderWindowBar() {
    // Tear the picker down BEFORE its input leaves the DOM — flatpickr mounts
    // its calendar on document.body and an orphan swallows later taps.
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }

    const isRange = Array.isArray(activeWindow);
    const presetActive = isRange ? null : activeWindow;
    const rangeValue = isRange ? `${activeWindow[0]} to ${activeWindow[1]}` : '';
    const btnCls = `pl-3 pr-9 py-1.5 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors min-w-[200px] focus:outline-none ${isRange ? 'bg-mango text-charcoal' : 'bg-white text-charcoal/70 hover:bg-frost'}`;

    windowBarEl.innerHTML = `
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

    const rangeInput = qs('[data-range-picker]', windowBarEl);
    if (rangeInput) {
      rangeFp = flatpickr(rangeInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: locale === 'en' ? 'M j, Y' : 'j M Y',
        altInputClass: `flatpickr-alt-input ${btnCls}`,
        locale: locale === 'ro' ? Romanian : 'default',
        maxDate: bucharestToday(),
        clickOpens: true,
        allowInput: false,
        defaultDate: isRange ? activeWindow : null,
        onClose: (dates) => {
          if (dates.length !== 2) return;
          const pad = (n) => String(n).padStart(2, '0');
          const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          activeWindow = [fmt(dates[0]), fmt(dates[1])];
          page = 1;
          load();
        },
      });
    }
  }

  function renderFilterBar() {
    const actions = [...new Set(rows.map(r => r.action))].filter(Boolean).sort();
    const users = [...new Set(rows.map(r => r.user))].filter(Boolean).sort();
    const selectCls = 'px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all';

    filterBarEl.innerHTML = `
      <div class="flex-1 relative">
        <svg class="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-dim" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
        <input type="text" data-audit-search value="${escapeHtml(search)}" placeholder="${t('admin.searchLogs')}"
          class="w-full pl-11 pr-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:ring-2 focus:ring-mango/30 focus:border-mango transition-all">
      </div>
      <select data-audit-action-filter class="${selectCls}">
        <option value="all">${t('admin.allActions')}</option>
        ${actions.map(a => `<option value="${escapeHtml(a)}" ${a === actionFilter ? 'selected' : ''}>${escapeHtml(actionLabel(a))}</option>`).join('')}
      </select>
      <select data-audit-user-filter class="${selectCls}">
        <option value="all">${t('admin.allUsers')}</option>
        ${users.map(u => `<option value="${escapeHtml(u)}" ${u === userFilter ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
      </select>
    `;
  }

  function renderContent() {
    if (loading) {
      contentEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('common.loading')}</div>`;
      return;
    }

    const filtered = visibleRows();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    if (!filtered.length) {
      contentEl.innerHTML = `
        ${capped ? cappedNotice() : ''}
        <div class="card-solid rounded-2xl p-10 text-center text-dim">${t('audit.empty')}</div>`;
      return;
    }

    contentEl.innerHTML = `
      ${capped ? cappedNotice() : ''}
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="border-b border-frost-deep">
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.timestamp')}</th>
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.action')}</th>
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.details')}</th>
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.user')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-frost-deep/60">
              ${slice.map(log => `
                <tr class="hover:bg-frost transition-colors">
                  <td class="px-6 py-4 font-mono text-[13px] text-dim whitespace-nowrap">${escapeHtml(fmtAuditTime(log.timestamp, locale))}</td>
                  <td class="px-6 py-4">
                    <span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${actionStyle(log.action)}">${escapeHtml(actionLabel(log.action))}</span>
                  </td>
                  <td class="px-6 py-4 text-[14px] text-charcoal/80">${escapeHtml(describeAction(log, locale))}</td>
                  <td class="px-6 py-4 font-mono text-[13px] text-dim whitespace-nowrap">${escapeHtml(log.user || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Pager sits INSIDE the card: the admin page background is frost, so
             a bare button row out there has nothing to sit on (and a frost
             "disabled" button is invisible against it). -->
        <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-frost-deep">
          <p class="text-[13px] text-dim">${escapeHtml(t('audit.showingRange', {
            from: start + 1,
            to: start + slice.length,
            total: filtered.length,
          }))}</p>
          <div class="flex items-center gap-2">
            <button type="button" data-page-prev ${page <= 1 ? 'disabled' : ''} class="${PAGER_BTN}">${t('audit.prev')}</button>
            <span class="text-[13px] text-dim font-mono px-1">${escapeHtml(t('audit.pageOf', { page, pages }))}</span>
            <button type="button" data-page-next ${page >= pages ? 'disabled' : ''} class="${PAGER_BTN}">${t('audit.next')}</button>
          </div>
        </div>
      </div>
    `;
  }

  function cappedNotice() {
    return `<div class="rounded-xl border border-mango/40 bg-mango/10 px-4 py-3 mb-4 text-[13px] text-charcoal/80">${escapeHtml(t('audit.capped', { cap: AUDIT_RANGE_MAX }))}</div>`;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    renderWindowBar();
    renderContent();
    setUrl();
    const { fromIso, toIso } = windowToIso(activeWindow, bucharestLocalToIso);
    const res = await listAuditRange({ fromIso, toIso });
    rows = res.rows;
    capped = res.capped;
    // A filter selection that the new range has no rows for would silently
    // show an empty table — drop it instead.
    if (actionFilter !== 'all' && !rows.some(r => r.action === actionFilter)) actionFilter = 'all';
    if (userFilter !== 'all' && !rows.some(r => r.user === userFilter)) userFilter = 'all';
    loading = false;
    renderFilterBar();
    renderContent();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  delegate(pageEl, 'click', '[data-window]', (_e, btn) => {
    activeWindow = btn.dataset.window;
    page = 1;
    load();
  });
  delegate(pageEl, 'click', '[data-page-prev]', () => {
    if (page > 1) { page--; setUrl(); renderContent(); window.scrollTo(0, 0); }
  });
  delegate(pageEl, 'click', '[data-page-next]', () => {
    page++; setUrl(); renderContent(); window.scrollTo(0, 0);
  });
  // Only the table re-renders as you type — the search box lives in the filter
  // bar, which is left alone, so the caret and focus survive.
  delegate(pageEl, 'input', '[data-audit-search]', (_e, input) => {
    search = input.value;
    page = 1;
    setUrl();
    renderContent();
  });
  delegate(pageEl, 'change', '[data-audit-action-filter]', (_e, sel) => {
    actionFilter = sel.value; page = 1; renderContent();
  });
  delegate(pageEl, 'change', '[data-audit-user-filter]', (_e, sel) => {
    userFilter = sel.value; page = 1; renderContent();
  });

  initAdminNav(pageEl);
  container.appendChild(pageEl);
  load();

  // Router cleanup — an orphaned flatpickr calendar lives on document.body
  // and would outlive this page (the leak fixed in AdminCheckIns).
  return () => {
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
  };
}
