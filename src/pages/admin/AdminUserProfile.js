// Admin → user profile (/admin/users?uid=…).
//
// "What did this person DO, in this period." Reached by clicking a name in the
// users list. The period-scoped block counts and lists the actions they
// performed — check-ins, check-outs, reservations created, payments collected,
// refunds — read from `auditLog` where THEY are the actor. Under it sit the
// same read-only detail sections the user modal renders (profile, vehicles,
// billing, credits, vouchers, their bookings + credit ledger), reused from
// UserDetailModal rather than duplicated.
//
// Actor matching: audit rows identify the actor two ways — `actorUid` (server
// writes) or `userId`/`userEmail` (client writes) — so a single Firestore
// query can't cover both. Rather than add two composite indexes, this pulls
// the period once (the same capped range query the audit page uses) and
// filters by actor in memory. Same trade-off, and the cap is surfaced.

import { delegate, escapeHtml, qs } from '../../utils/dom.js';
import { t, getLocale, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getDocument } from '../../firebase/db.js';
import { listAuditRange, AUDIT_RANGE_MAX } from '../../services/auditService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import {
  actionStyle, actionLabel, describeAction, fmtAuditTime,
  RANGE_PRESETS as PRESETS, windowToIso,
  isActorRow, ACTOR_STAT_TILES, countActions,
} from '../../components/admin/auditFormat.js';
import { rangeBarHtml, mountRangePicker, pagerHtml } from '../../components/admin/ListControls.js';
import { renderUserSections } from '../../components/admin/UserDetailModal.js';
import { bucharestLocalToIso } from '../../utils/date.js';
import { normalizeRole } from '../../utils/permissions.js';

const PAGE_SIZE = 25;

function roleBadge(role) {
  const r = normalizeRole(role);
  const styles = {
    admin: 'bg-blueberry/10 text-blueberry',
    agent: 'bg-leaf/10 text-leaf',
    driver: 'bg-mango/15 text-charcoal',
    customer: 'bg-frost-deep text-charcoal/70',
  };
  // Same label source the users list uses for its role column/selector.
  const label = t(`admin.usersRole.${r}`);
  return `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${styles[r] || styles.customer}">${escapeHtml(label)}</span>`;
}

function statTile(labelKey, value) {
  return `
    <div class="bg-white rounded-2xl border border-frost-deep px-5 py-4">
      <p class="font-mono text-[11px] uppercase tracking-[0.12em] text-dim">${escapeHtml(t(labelKey))}</p>
      <p class="font-heading text-3xl font-bold text-blueberry-deep mt-1">${value}</p>
    </div>`;
}

export default async function AdminUserProfile(container, { uid } = {}) {
  const locale = getLocale();
  const params = new URLSearchParams(window.location.search);
  const userId = uid || params.get('uid') || '';

  // ── State ────────────────────────────────────────────────────────────────
  const urlRange = params.get('range') || '';
  const customRange = urlRange.split('..');
  const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  let activeWindow = customRange.length === 2 && customRange.every(isYmd)
    ? customRange
    : (PRESETS[urlRange] !== undefined ? urlRange : '30d');
  let page = 1;
  let rows = [];
  let capped = false;
  let loading = true;
  let rangeFp = null;

  const user = await getDocument('users', userId).catch(() => null);

  updateMeta({
    title: `${user?.displayName || user?.email || t('admin.users')} — Admin — ManGO Parking`,
    description: 'User profile and activity.',
  });

  if (!user) {
    const missing = AdminLayout('/admin/users', `
      <a href="${localePath('/admin/users')}" data-link class="inline-flex items-center gap-1.5 text-[14px] font-semibold text-blueberry hover:underline mb-6">‹ ${t('admin.users')}</a>
      <div class="card-solid rounded-2xl p-10 text-center text-dim">${escapeHtml(t('userProfile.notFound'))}</div>
    `);
    initAdminNav(missing);
    container.appendChild(missing);
    return;
  }

  const pageEl = AdminLayout('/admin/users', `
        <a href="${localePath('/admin/users')}" data-link class="inline-flex items-center gap-1.5 text-[14px] font-semibold text-blueberry hover:underline mb-4">‹ ${escapeHtml(t('admin.users'))}</a>
        <div class="mb-6">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${escapeHtml(user.displayName || user.email || userId)}</h1>
            ${roleBadge(user.role)}
          </div>
          <p class="text-dim text-[15px] mt-1 font-mono">${escapeHtml(user.email || '')}</p>
        </div>

        <h2 class="font-heading font-bold text-lg text-charcoal mb-3">${escapeHtml(t('userProfile.activityTitle'))}</h2>
        <div class="flex flex-wrap items-center gap-2 mb-4" data-window-bar></div>
        <div data-stats class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4"></div>
        <div data-activity class="mb-10"></div>

        <h2 class="font-heading font-bold text-lg text-charcoal mb-3">${escapeHtml(t('userProfile.detailsTitle'))}</h2>
        <div data-sections class="space-y-4"></div>
  `);

  const windowBarEl = qs('[data-window-bar]', pageEl);
  const statsEl = qs('[data-stats]', pageEl);
  const activityEl = qs('[data-activity]', pageEl);
  const sectionsEl = qs('[data-sections]', pageEl);

  function setUrl() {
    const p = new URLSearchParams();
    p.set('uid', userId);
    p.set('range', Array.isArray(activeWindow) ? activeWindow.join('..') : activeWindow);
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  }


  function renderWindowBar() {
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
    windowBarEl.innerHTML = rangeBarHtml(activeWindow);
    rangeFp = mountRangePicker(windowBarEl, {
      activeWindow,
      locale,
      onPick: (range) => { activeWindow = range; page = 1; load(); },
    });
  }

  function renderStats() {
    if (loading) {
      statsEl.innerHTML = `<div class="col-span-full text-[14px] text-dim">${escapeHtml(t('common.loading'))}</div>`;
      return;
    }
    const tiles = ACTOR_STAT_TILES.map(({ key, actions }) =>
      statTile(`userProfile.stat${key.charAt(0).toUpperCase() + key.slice(1)}`,
        countActions(rows, actions)));
    tiles.push(statTile('userProfile.statTotal', rows.length));
    statsEl.innerHTML = tiles.join('');
  }

  function renderActivity() {
    if (loading) {
      activityEl.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${escapeHtml(t('common.loading'))}</div>`;
      return;
    }
    const notice = capped
      ? `<div class="rounded-xl border border-mango/40 bg-mango/10 px-4 py-3 mb-4 text-[13px] text-charcoal/80">${escapeHtml(t('audit.capped', { cap: AUDIT_RANGE_MAX }))}</div>`
      : '';
    if (!rows.length) {
      activityEl.innerHTML = `${notice}<div class="card-solid rounded-2xl p-10 text-center text-dim">${escapeHtml(t('userProfile.noActivity'))}</div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page > pages) page = pages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = rows.slice(start, start + PAGE_SIZE);

    activityEl.innerHTML = `
      ${notice}
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="border-b border-frost-deep">
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.timestamp')}</th>
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.action')}</th>
                <th class="text-left text-[12px] font-mono uppercase tracking-[0.12em] text-dim px-6 py-4">${t('admin.details')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-frost-deep/60">
              ${slice.map(log => `
                <tr class="hover:bg-frost transition-colors">
                  <td class="px-6 py-4 font-mono text-[13px] text-dim whitespace-nowrap">${escapeHtml(fmtAuditTime(log.timestamp, locale))}</td>
                  <td class="px-6 py-4"><span class="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${actionStyle(log.action)}">${escapeHtml(actionLabel(log.action))}</span></td>
                  <td class="px-6 py-4 text-[14px] text-charcoal/80">${escapeHtml(describeAction(log, locale))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${pagerHtml({ page, pages, from: start + 1, to: start + slice.length, total: rows.length })}
      </div>`;
  }

  async function load() {
    loading = true;
    renderWindowBar();
    renderStats();
    renderActivity();
    setUrl();
    const { fromIso, toIso } = windowToIso(activeWindow, bucharestLocalToIso);
    const res = await listAuditRange({ fromIso, toIso });
    rows = res.rows.filter((r) => isActorRow(r, { uid: userId, email: user.email }));
    // `capped` means the RANGE was truncated, so this person's count may be
    // short too — surfaced rather than quietly under-reported.
    capped = res.capped;
    loading = false;
    renderStats();
    renderActivity();
  }

  delegate(pageEl, 'click', '[data-window]', (_e, btn) => {
    activeWindow = btn.dataset.window;
    page = 1;
    load();
  });
  delegate(pageEl, 'click', '[data-page-prev]', () => {
    if (page > 1) { page--; renderActivity(); }
  });
  delegate(pageEl, 'click', '[data-page-next]', () => {
    page++; renderActivity();
  });

  initAdminNav(pageEl);
  container.appendChild(pageEl);
  load();
  // The static detail sections load themselves (balance, vouchers, bookings,
  // credit ledger) — same renderer the user modal uses.
  renderUserSections(user, sectionsEl);

  return () => {
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
  };
}
