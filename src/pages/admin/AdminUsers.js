// /admin/users — admin-only user management.
//
// Lists the users collection client-side (Firestore rules already let an
// admin read every users/* doc). Two ways to add a new user:
//   - Direct create: admin types email + password → adminCreateUser callable
//   - Email invite:  admin types email + role     → adminSendInvite callable
//     The recipient gets a magic link; lands on /auth/finish-signup and
//     sets their own password.
//
// Filter is purely client-side string match — fine at our scale (sub-1k
// users for the foreseeable future).

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { qs, escapeHtml } from '../../utils/dom.js';
import { t, getLocale, localePath } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getCollection } from '../../firebase/db.js';
import { navigate } from '../../router/index.js';
import { showToast } from '../../components/core/Toast.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { getCurrentUser } from '../../firebase/auth.js';
import { isValidEmail } from '../../utils/validators.js';
import { buildUsersExport, buildUserStats } from '../../services/userExportService.js';
import { buildCsv, downloadCsv, todayStamp } from '../../utils/csv.js';
import { listAuditRange } from '../../services/auditService.js';
import { listEntriesBetween, listAllOpenEntries } from '../../services/cashbookService.js';
import { isActorRow, countActions, windowToIso } from '../../components/admin/auditFormat.js';
import { rangeBarHtml, mountRangePicker } from '../../components/admin/ListControls.js';
import { bucharestLocalToIso } from '../../utils/date.js';

const adminCreateUserFn = httpsCallable(functions, 'adminCreateUser');
const adminSendInviteFn = httpsCallable(functions, 'adminSendInvite');
const adminDeleteUserFn = httpsCallable(functions, 'adminDeleteUser');
const adminChangeUserRoleFn = httpsCallable(functions, 'adminChangeUserRole');

const ROLE_ORDER = ['admin', 'agent', 'driver', 'customer'];

// Legacy 'staff' docs render under the 'agent' group, which is the new name.
function normalizeRole(role) {
  if (role === 'staff') return 'agent';
  return ROLE_ORDER.includes(role) ? role : 'customer';
}

// ── Clients tab: sortable lifetime metrics ───────────────────────────────
// Each column pulls one field off the stats map built by buildUserStats().
// `num: false` marks the text/date columns, which sort ascending by default
// (A→Z, oldest→newest) while every count sorts biggest-first — that is what
// "most reservations" means when you click it.
const SORTS = {
  name:          { num: false, get: (u) => (u.displayName || u.email || '').toLowerCase() },
  registered:    { num: false, get: (u) => String(u.createdAt || '') },
  reservations:  { num: true,  get: (u, s) => s.bookings },
  totalPaid:     { num: true,  get: (u, s) => s.totalPaid },
  longestStay:   { num: true,  get: (u, s) => s.longestStay },
  totalDays:     { num: true,  get: (u, s) => s.totalDays },
  creditsUsed:   { num: true,  get: (u, s) => s.creditsUsed },
  cancellations: { num: true,  get: (u, s) => s.cancellations },
  noShows:       { num: true,  get: (u, s) => s.noShows },
  lastActivity:  { num: false, get: (u, s) => String(s.lastActivityAt || '') },
};

// Quick filters. Each is an independent toggle AND-ed with the others, so
// picking two contradictory ones legitimately yields an empty list.
const CHIPS = {
  booked:    (s) => s.bookings > 0,
  neverBook: (s) => s.bookings === 0,
  credits:   (s) => s.creditBalance > 0,
  problems:  (s) => (s.cancellations + s.noShows) > 0,
};

const EMPTY_STATS = {
  bookings: 0, credits: 0, totalPaid: 0, creditsUsed: 0, longestStay: 0,
  totalDays: 0, cancellations: 0, noShows: 0, lastActivityAt: null, creditBalance: 0,
};

// ── Staff tabs: what each person DID in the selected window ──────────────
// Counted off auditLog rows where they are the actor. The action lists mirror
// ACTOR_STAT_TILES (auditFormat.js) so a number here matches the same number
// on that person's profile page rather than quietly disagreeing with it.
const STAFF_ACTIONS = {
  checkins:     ['booking_checkin', 'check_in'],
  checkouts:    ['booking_checkout', 'check_out'],
  reservations: ['booking_created'],
  payments:     ['order_marked_paid', 'admin_credits_granted'],
};

const STAFF_SORTS = {
  name:          { num: false, get: (u) => (u.displayName || u.email || '').toLowerCase() },
  checkins:      { num: true,  get: (u, s) => s.checkins },
  checkouts:     { num: true,  get: (u, s) => s.checkouts },
  reservations:  { num: true,  get: (u, s) => s.reservations },
  payments:      { num: true,  get: (u, s) => s.payments },
  cashCollected: { num: true,  get: (u, s) => s.cashCollected },
  openCash:      { num: true,  get: (u, s) => s.openCash },
  lastActive:    { num: false, get: (u, s) => String(s.lastActiveAt || '') },
};

const EMPTY_STAFF = {
  checkins: 0, checkouts: 0, reservations: 0, payments: 0,
  actions: 0, cashCollected: 0, openCash: 0, lastActiveAt: null,
};

export default async function AdminUsers(container) {
  // /admin/users?uid=… is the single-user profile. The router strips the query
  // before matching, so both views live behind this one route entry — which
  // also keeps the sidebar's "Utilizatori" item highlighted on the profile.
  const uid = new URLSearchParams(window.location.search).get('uid');
  if (uid) {
    const { default: AdminUserProfile } = await import('./AdminUserProfile.js');
    return AdminUserProfile(container, { uid });
  }

  const locale = getLocale();
  updateMeta({ title: `${t('admin.usersTitle')} — Admin`, lang: locale });

  let users = [];
  let filter = '';
  // Which role tab is open. Mirrored into ?tab= so a refresh or a shared link
  // reopens the same view (same trick /admin/website and /admin/transactions
  // use). Defaults to the clients tab — it is the list with the analysis on it
  // and by far the largest population; the three staff tabs are one click away.
  const TABS = ['customer', 'admin', 'agent', 'driver'];
  const tabParam = new URLSearchParams(window.location.search).get('tab');
  let activeTab = TABS.includes(tabParam) ? tabParam : 'customer';
  // Lifetime metrics, keyed by uid. Loaded lazily the first time the clients
  // tab is shown — the staff tabs need none of it, so opening the page to
  // change someone's role costs the users read alone.
  let stats = null;
  let statsError = false;
  let sortKey = 'reservations';
  let sortDir = 'desc';
  const chips = new Set();
  // Staff tabs carry their own sort (different columns) and their own window —
  // "checked in 385 cars" is meaningless without a period, unlike a customer's
  // lifetime value. 30 days by default: ~485 audit rows/month at current
  // volume, comfortably inside listAuditRange's 1000-row cap.
  let staffSortKey = 'checkins';
  let staffSortDir = 'desc';
  let staffWindow = '30d';
  let staffStats = null;
  let staffError = false;
  let staffCapped = false;
  let rangeFp = null;

  const page = AdminLayout('/admin/users', `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.usersTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('admin.usersSubtitle')}</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button data-export class="bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">
          ${t('admin.usersExport.button')}
        </button>
        <button data-create class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">
          ${t('admin.usersCreate')}
        </button>
        <button data-invite class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">
          ${t('admin.usersInvite')}
        </button>
      </div>
    </div>

    <div data-tabs class="flex flex-wrap gap-1.5 mb-4 border-b border-frost-deep"></div>

    <input data-filter type="search" placeholder="${t('admin.usersSearch')}"
      class="w-full max-w-md mb-3 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">

    <div data-chips class="flex flex-wrap gap-2 mb-5"></div>
    <div data-window-bar class="flex flex-wrap items-center gap-2 mb-5"></div>

    <div data-rows>
      <div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">…</div>
    </div>
  `);

  initAdminNav(page);
  container.appendChild(page);

  const rows = qs('[data-rows]', page);
  const filterInput = qs('[data-filter]', page);
  const tabsEl = qs('[data-tabs]', page);
  const chipsEl = qs('[data-chips]', page);
  const windowBarEl = qs('[data-window-bar]', page);

  filterInput.addEventListener('input', (e) => {
    filter = String(e.target.value || '').toLowerCase();
    render();
  });

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn || btn.dataset.tab === activeTab) return;
    activeTab = btn.dataset.tab;
    // replaceState, not a router navigate: the route is unchanged and a
    // pushState per tab click would bury the previous page under history.
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    window.history.replaceState(null, '', url.pathname + url.search);
    ensureStats();
    ensureStaffStats();
    render();
  });

  // Range presets on the staff tabs. Changing the window invalidates the
  // tallies, so they are dropped and refetched.
  page.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-window]');
    if (!btn) return;
    staffWindow = btn.dataset.window;
    staffStats = null;
    ensureStaffStats();
    render();
  });

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-chip]');
    if (!btn) return;
    const key = btn.dataset.chip;
    if (chips.has(key)) chips.delete(key); else chips.add(key);
    render();
  });

  // Sorting: click a header to sort by it, click again to flip direction.
  // Counts open biggest-first (that is what "most reservations" means);
  // names and dates open A→Z / oldest-first.
  rows.addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    const table = activeTab === 'customer' ? SORTS : STAFF_SORTS;
    if (!table[key]) return;
    if (activeTab === 'customer') {
      if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortKey = key; sortDir = table[key].num ? 'desc' : 'asc'; }
    } else if (staffSortKey === key) {
      staffSortDir = staffSortDir === 'desc' ? 'asc' : 'desc';
    } else {
      staffSortKey = key;
      staffSortDir = table[key].num ? 'desc' : 'asc';
    }
    render();
  });
  qs('[data-create]', page).addEventListener('click', () => openCreateModal(reload));
  qs('[data-invite]', page).addEventListener('click', () => openInviteModal(reload));
  qs('[data-export]', page).addEventListener('click', exportCsv);

  const statsFor = (u) => (stats && stats.get(u.id)) || EMPTY_STATS;

  function searchMatch(u) {
    if (!filter) return true;
    return `${u.email || ''} ${u.displayName || ''}`.toLowerCase().includes(filter);
  }

  function usersInTab(tab) {
    return users.filter((u) => normalizeRole(u.role) === tab && searchMatch(u));
  }

  // The clients list exactly as displayed: search + active chips + sort.
  // Shared by render and the CSV export so what you export is what you see.
  function clientList() {
    let list = usersInTab('customer');
    for (const key of chips) {
      const fn = CHIPS[key];
      if (fn) list = list.filter((u) => fn(statsFor(u)));
    }
    const spec = SORTS[sortKey] || SORTS.name;
    const dir = sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = spec.get(a, statsFor(a));
      const vb = spec.get(b, statsFor(b));
      if (spec.num) return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  // Lifetime metrics are only needed by the clients tab, so they are fetched
  // the first time it is shown and cached for the page session. A failure is
  // surfaced, not swallowed into an innocent-looking empty table (BUGS #17).
  const staffFor = (u) => (staffStats && staffStats.get(u.id)) || EMPTY_STAFF;

  function staffList(tab) {
    const list = usersInTab(tab);
    const spec = STAFF_SORTS[staffSortKey] || STAFF_SORTS.name;
    const dir = staffSortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = spec.get(a, staffFor(a));
      const vb = spec.get(b, staffFor(b));
      if (spec.num) return (Number(va) - Number(vb)) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  // Per-staff activity for the selected window. One audit range query plus the
  // cash reads, then everything is tallied in memory — the actor lives on the
  // row under two different field names (server `actorUid` vs client
  // `userEmail`), which one Firestore query can't express, exactly as the
  // profile page and the audit page already handle it.
  let staffPromise = null;
  function ensureStaffStats() {
    if (activeTab === 'customer' || staffStats || staffPromise || !users.length) return;
    const { fromIso, toIso } = windowToIso(staffWindow, bucharestLocalToIso);
    staffPromise = Promise.all([
      listAuditRange({ fromIso, toIso }),
      listEntriesBetween({ fromIso, toIso }),
      // Open cash is a point-in-time fact — money still in someone's drawer
      // right now — so it is deliberately NOT windowed.
      listAllOpenEntries(),
    ]).then(([audit, cashInWindow, openCash]) => {
      staffCapped = !!audit.capped;
      const map = new Map();
      for (const u of users) {
        if (normalizeRole(u.role) === 'customer') continue;
        const mine = audit.rows.filter((r) => isActorRow(r, { uid: u.id, email: u.email }));
        const cash = cashInWindow.filter((c) => c.agentUid === u.id);
        const open = openCash.filter((c) => c.agentUid === u.id);
        const sum = (arr) => arr.reduce((n, c) => n + (Number(c.amount) || 0), 0);
        map.set(u.id, {
          checkins: countActions(mine, STAFF_ACTIONS.checkins),
          checkouts: countActions(mine, STAFF_ACTIONS.checkouts),
          reservations: countActions(mine, STAFF_ACTIONS.reservations),
          payments: countActions(mine, STAFF_ACTIONS.payments),
          actions: mine.length,
          cashCollected: Math.round(sum(cash)),
          openCash: Math.round(sum(open)),
          // Most recent action in the window; the rows come back newest-first.
          lastActiveAt: mine.length ? mine[0].timestamp : null,
        });
      }
      staffStats = map;
      staffError = false;
    }).catch((err) => {
      console.error('AdminUsers: staff stats load failed', err);
      staffError = true;
    }).finally(() => { staffPromise = null; render(); });
    render();
  }

  let statsPromise = null;
  function ensureStats() {
    if (activeTab !== 'customer' || stats || statsPromise) return;
    // No users to aggregate for — settle to an empty map rather than fetching
    // three collections, and so the table shows its empty state instead of
    // sitting on "computing…" forever.
    if (!users.length) { stats = new Map(); return; }
    statsPromise = buildUserStats(users)
      .then((m) => { stats = m; statsError = false; })
      .catch((err) => {
        console.error('AdminUsers: stats load failed', err);
        statsError = true;
      })
      .finally(() => { statsPromise = null; render(); });
    render();
  }

  // Bulk invoice export: identity + lifetime spend totals, one row per user.
  // Aggregates all bookings + credit purchases once inside buildUsersExport.
  async function exportCsv(e) {
    const btn = e.currentTarget;
    // Invoicing is for customers only — which is why the button lives on the
    // clients tab alone. Exports that tab's current view (search + chips), so
    // the CSV matches what the admin is looking at. The per-user modal export
    // can still export any account you explicitly open.
    const list = clientList();
    if (!list.length) { showToast(t('admin.usersExport.empty'), 'info'); return; }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('common.loading');
    try {
      const { headers, rows } = await buildUsersExport(list);
      downloadCsv(`mango-users-${todayStamp()}.csv`, buildCsv(headers, rows));
      showToast(t('admin.usersExport.done', { n: rows.length }), 'success');
    } catch (err) {
      console.error('AdminUsers: export failed', err);
      showToast(err?.message || t('admin.usersError'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // Delegate "view detail" clicks on the name cell → the full profile page
  // (activity for a period + the detail sections). The modal is still used
  // elsewhere (booking rows, capacity tiles) via openUserDetail().
  rows.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-action="view"]');
    if (!viewBtn) return;
    const id = viewBtn.dataset.uid;
    if (id) navigate(localePath(`/admin/users?uid=${encodeURIComponent(id)}`));
  });

  // Delegate delete clicks across all per-role tables.
  rows.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const uid = btn.dataset.uid;
    const name = btn.dataset.name || btn.dataset.email || uid;
    if (!uid) return;
    const ok = await confirmModal(t('admin.usersDeletePrompt', { name }), {
      confirmText: t('admin.usersDeleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await adminDeleteUserFn({ uid });
      showToast(t('admin.usersDeletedToast'), 'success');
      await reload();
    } catch (err) {
      console.error('adminDeleteUser', err);
      showToast(err?.message || t('admin.usersError'), 'error');
      btn.disabled = false;
    }
  });

  // Delegate role-change selects. Confirms before applying to avoid
  // accidental privilege escalations / demotions. Reverts the select on
  // failure or user-cancel so the UI matches server truth.
  rows.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-action="role-change"]');
    if (!sel) return;
    const uid = sel.dataset.uid;
    const previous = sel.dataset.current;
    const next = sel.value;
    if (!uid || next === previous) return;
    const ok = await confirmModal(
      t('admin.usersRoleConfirm', {
        from: t('admin.usersRole.' + previous),
        to: t('admin.usersRole.' + next),
      }),
      { confirmText: t('common.confirm'), danger: next === 'admin' || previous === 'admin' },
    );
    if (!ok) { sel.value = previous; return; }
    sel.disabled = true;
    try {
      await adminChangeUserRoleFn({ uid, role: next });
      showToast(t('admin.usersRoleChangedToast'), 'success');
      await reload();
    } catch (err) {
      console.error('adminChangeUserRole', err);
      showToast(err?.message || t('admin.usersError'), 'error');
      sel.value = previous;
      sel.disabled = false;
    }
  });

  const nfmt = (n) => Number(n || 0).toLocaleString(locale === 'en' ? 'en-GB' : 'ro-RO');
  // A zero is information here ("never booked"), so it is shown rather than
  // dashed out — just dimmed, so the numbers that matter carry the eye.
  const cell = (n, suffix = '') => (Number(n) > 0
    ? `${nfmt(n)}${suffix}`
    : `<span class="text-dim">0${suffix}</span>`);

  function roleCellHtml(u, isSelf) {
    const currentRole = normalizeRole(u.role);
    if (isSelf) return `<span class="text-[13px] text-dim">${t('admin.usersRole.' + currentRole)}</span>`;
    return `<select data-action="role-change" data-uid="${escapeHtml(u.id)}" data-current="${currentRole}" class="px-2 py-1 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-mango/40">
      ${ROLE_ORDER.map((r) => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${t('admin.usersRole.' + r)}</option>`).join('')}
    </select>`;
  }

  function nameCellHtml(u, isSelf) {
    return `<button data-action="view" data-uid="${escapeHtml(u.id)}" class="text-left font-medium text-blueberry hover:text-blueberry-hover hover:underline transition-colors">${escapeHtml(u.displayName || u.email || '—')}</button>${isSelf ? ` <span class="text-[11px] text-dim ml-1">${t('admin.usersYou')}</span>` : ''}`;
  }

  function deleteCellHtml(u, isSelf) {
    if (isSelf) return '';
    return `<button data-action="delete" data-uid="${escapeHtml(u.id)}" data-name="${escapeHtml(u.displayName || u.email || '—')}" data-email="${escapeHtml(u.email || '')}" class="text-[12px] text-danger hover:underline">${t('admin.usersDelete')}</button>`;
  }

  function renderTabs() {
    tabsEl.innerHTML = TABS.map((tab) => {
      const n = users.filter((u) => normalizeRole(u.role) === tab).length;
      const on = tab === activeTab;
      return `<button type="button" data-tab="${tab}" aria-current="${on ? 'page' : 'false'}"
        class="px-4 py-2.5 text-[14px] font-semibold rounded-t-xl border-b-2 -mb-px transition-colors ${on
          ? 'border-mango text-blueberry-deep bg-white'
          : 'border-transparent text-dim hover:text-charcoal'}">
        ${t(`admin.usersGroup.${tab}`)} <span class="ml-1 font-mono text-[12px] ${on ? 'text-charcoal/50' : 'text-dim'}">${n}</span>
      </button>`;
    }).join('');
  }

  function renderChips() {
    // Chips filter on lifetime metrics, so they only apply to the clients tab.
    if (activeTab !== 'customer') { chipsEl.innerHTML = ''; return; }
    chipsEl.innerHTML = Object.keys(CHIPS).map((key) => {
      const on = chips.has(key);
      return `<button type="button" data-chip="${key}" aria-pressed="${on}"
        class="px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors ${on
          ? 'bg-mango border-mango text-charcoal'
          : 'bg-white border-frost-deep text-charcoal/70 hover:border-mango/40'}">
        ${t(`admin.usersChip.${key}`)}
      </button>`;
    }).join('');
  }

  function sortableTh(key, label, { right = false, extra = '' } = {}) {
    const staff = activeTab !== 'customer';
    const on = (staff ? staffSortKey : sortKey) === key;
    const dir = staff ? staffSortDir : sortDir;
    const arrow = on ? (dir === 'desc' ? ' ↓' : ' ↑') : '';
    return `<th data-sort="${key}" role="button" tabindex="0" aria-sort="${on ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}"
      class="px-3 py-3 whitespace-nowrap cursor-pointer select-none hover:text-charcoal ${right ? 'text-right' : 'text-left'} ${on ? 'text-charcoal' : ''} ${extra}">${escapeHtml(label)}${arrow}</th>`;
  }

  function renderStaffTable(tab, currentUid) {
    if (staffError) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-danger text-[14px]">${t('admin.usersStaffError')}</div>`;
      return;
    }
    if (!staffStats) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">${t('admin.usersStaffLoading')}</div>`;
      return;
    }
    const list = staffList(tab);
    if (!list.length) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">${t('admin.usersEmpty')}</div>`;
      return;
    }
    const c = t('admin.usersCol');
    // The role selector sits SECOND, right after the name, not at the far end
    // like on the clients table. Changing a role is the reason to open a staff
    // tab; with ten columns the table is wider than the content area (the
    // sidebar eats 272px, so viewport-based breakpoints over-estimate the room
    // by that much) and a trailing selector ends up off-screen behind a
    // horizontal scroll. Delete stays last — destructive and rarely wanted.
    const lg = 'hidden xl:table-cell';
    // The window is capped, so the counts below it are a floor, not a total —
    // say so rather than let a truncated range read as the whole story.
    const capNote = staffCapped
      ? `<div class="mb-3 text-[13px] text-charcoal/70 bg-mango/10 border border-mango/30 rounded-xl px-4 py-2.5">${t('admin.usersStaffCapped')}</div>`
      : '';
    rows.innerHTML = `${capNote}
      <div class="bg-white rounded-2xl border border-frost-deep overflow-x-auto">
        <table class="w-full text-[14px] min-w-[44rem]">
          <thead class="bg-frost text-charcoal/70 text-[12px] uppercase tracking-wider">
            <tr>
              ${sortableTh('name', c.name)}
              <th class="text-left px-3 py-3">${t('admin.usersRoleLabel')}</th>
              ${sortableTh('checkins', c.checkins, { right: true })}
              ${sortableTh('checkouts', c.checkouts, { right: true })}
              ${sortableTh('reservations', c.reservationsMade, { right: true, extra: lg })}
              ${sortableTh('payments', c.payments, { right: true, extra: lg })}
              ${sortableTh('cashCollected', c.cashCollected, { right: true })}
              ${sortableTh('openCash', c.openCash, { right: true })}
              ${sortableTh('lastActive', c.lastActive, { extra: lg })}
              <th class="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((u) => {
              const s = staffFor(u);
              const isSelf = u.id === currentUid;
              // Cash still in a drawer is the one number worth a colour: it is
              // money the business is owed a reckoning for, not an achievement.
              const openCell = s.openCash > 0
                ? `<span class="font-semibold text-mango-dark">${nfmt(s.openCash)} ${t('common.lei')}</span>`
                : `<span class="text-dim">0</span>`;
              return `<tr class="border-t border-frost-deep">
                <td class="px-3 py-3">
                  ${nameCellHtml(u, isSelf)}
                  <div class="text-[12px] text-dim font-mono">${escapeHtml(u.email || '—')}</div>
                </td>
                <td class="px-3 py-3">${roleCellHtml(u, isSelf)}</td>
                <td class="px-3 py-3 text-right font-mono">${cell(s.checkins)}</td>
                <td class="px-3 py-3 text-right font-mono">${cell(s.checkouts)}</td>
                <td class="px-3 py-3 text-right font-mono ${lg}">${cell(s.reservations)}</td>
                <td class="px-3 py-3 text-right font-mono ${lg}">${cell(s.payments)}</td>
                <td class="px-3 py-3 text-right font-mono whitespace-nowrap">${cell(s.cashCollected, ` ${t('common.lei')}`)}</td>
                <td class="px-3 py-3 text-right font-mono whitespace-nowrap">${openCell}</td>
                <td class="px-3 py-3 text-dim whitespace-nowrap ${lg}">${fmtDate(s.lastActiveAt)}</td>
                <td class="px-3 py-3 text-right">${deleteCellHtml(u, isSelf)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderWindowBar() {
    // Tear the picker down BEFORE its input leaves the DOM — flatpickr mounts
    // its calendar on document.body and an orphan swallows later taps.
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
    if (activeTab === 'customer') { windowBarEl.innerHTML = ''; return; }
    windowBarEl.innerHTML = rangeBarHtml(staffWindow);
    rangeFp = mountRangePicker(windowBarEl, {
      activeWindow: staffWindow,
      locale,
      onPick: (range) => {
        staffWindow = range;
        staffStats = null;
        ensureStaffStats();
        render();
      },
    });
  }

  function renderClientsTable(currentUid) {
    if (statsError) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-danger text-[14px]">${t('admin.usersStatsError')}</div>`;
      return;
    }
    if (!stats) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">${t('admin.usersStatsLoading')}</div>`;
      return;
    }
    const list = clientList();
    if (!list.length) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">${t('admin.usersEmpty')}</div>`;
      return;
    }
    const c = t('admin.usersCol');
    // Eight numeric columns don't fit a laptop, let alone a phone: the four
    // that answer "who is my best customer" stay, the rest appear from lg up.
    // The wrapper scrolls horizontally either way (BUGS #21).
    const lg = 'hidden lg:table-cell';
    rows.innerHTML = `
      <div class="bg-white rounded-2xl border border-frost-deep overflow-x-auto">
        <table class="w-full text-[14px] min-w-[46rem]">
          <thead class="bg-frost text-charcoal/70 text-[12px] uppercase tracking-wider">
            <tr>
              ${sortableTh('name', c.name)}
              ${sortableTh('reservations', c.reservations, { right: true })}
              ${sortableTh('totalPaid', c.totalPaid, { right: true })}
              ${sortableTh('longestStay', c.longestStay, { right: true })}
              ${sortableTh('totalDays', c.totalDays, { right: true, extra: lg })}
              ${sortableTh('creditsUsed', c.creditsUsed, { right: true })}
              ${sortableTh('cancellations', c.cancellations, { right: true, extra: lg })}
              ${sortableTh('noShows', c.noShows, { right: true, extra: lg })}
              ${sortableTh('lastActivity', c.lastActivity, { extra: lg })}
              <th class="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((u) => {
              const s = statsFor(u);
              const isSelf = u.id === currentUid;
              return `<tr class="border-t border-frost-deep">
                <td class="px-3 py-3">
                  ${nameCellHtml(u, isSelf)}
                  <div class="text-[12px] text-dim font-mono">${escapeHtml(u.email || '—')}</div>
                </td>
                <td class="px-3 py-3 text-right font-mono">${cell(s.bookings)}</td>
                <td class="px-3 py-3 text-right font-mono whitespace-nowrap">${cell(s.totalPaid, ` ${t('common.lei')}`)}</td>
                <td class="px-3 py-3 text-right font-mono whitespace-nowrap">${cell(s.longestStay, ` ${t('admin.usersCol.daysShort')}`)}</td>
                <td class="px-3 py-3 text-right font-mono ${lg}">${cell(s.totalDays)}</td>
                <td class="px-3 py-3 text-right font-mono">${cell(s.creditsUsed)}</td>
                <td class="px-3 py-3 text-right font-mono ${lg}">${cell(s.cancellations)}</td>
                <td class="px-3 py-3 text-right font-mono ${lg}">${cell(s.noShows)}</td>
                <td class="px-3 py-3 text-dim whitespace-nowrap ${lg}">${fmtDate(s.lastActivityAt)}</td>
                <td class="px-3 py-3 text-right">${deleteCellHtml(u, isSelf)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function render() {
    const currentUid = getCurrentUser()?.uid;
    renderTabs();
    renderChips();
    renderWindowBar();
    // Invoicing export is customers-only, so it belongs to that tab alone.
    qs('[data-export]', page).classList.toggle('hidden', activeTab !== 'customer');
    if (activeTab === 'customer') renderClientsTable(currentUid);
    else renderStaffTable(activeTab, currentUid);
  }

  async function reload() {
    try {
      users = await getCollection('users');
      users.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      // A role change moves someone between tabs, and their metrics are
      // unaffected — but a delete must not leave a stale entry behind, so the
      // cache is dropped and refetched with the fresh list.
      stats = null;
      staffStats = null;
      render();
      ensureStats();
      ensureStaffStats();
    } catch (err) {
      console.error('AdminUsers: load failed', err);
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-danger text-[14px]">${t('admin.usersError')}</div>`;
    }
  }

  reload();

  // Router cleanup — an orphaned flatpickr calendar lives on document.body and
  // would outlive this page, swallowing taps meant for the next one (the leak
  // fixed in AdminCheckIns, and the reason AdminAudit returns the same).
  return () => {
    if (rangeFp) { try { rangeFp.destroy(); } catch { /* noop */ } rangeFp = null; }
  };
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

function openCreateModal(onDone) {
  const { close, contentEl } = openModal(`
    <h2 class="font-heading text-xl font-bold text-blueberry-deep mb-1">${t('admin.usersCreateTitle')}</h2>
    <p class="text-dim text-[14px] mb-5">${t('admin.usersCreateHint')}</p>
    <form data-create-form class="space-y-4">
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersName')}</label>
        <input name="displayName" type="text" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersEmail')} *</label>
        <input name="email" type="email" required class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersPassword')} *</label>
        <input name="password" type="password" required minlength="8" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
        <p class="text-[12px] text-dim mt-1">${t('admin.usersPasswordHint')}</p>
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersRoleLabel')}</label>
        <select name="role" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          <option value="customer">${t('admin.usersRole.customer')}</option>
          <option value="driver">${t('admin.usersRole.driver')}</option>
          <option value="agent">${t('admin.usersRole.agent')}</option>
          <option value="admin">${t('admin.usersRole.admin')}</option>
        </select>
      </div>
      <div data-err class="text-danger text-[13px] hidden"></div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors">${t('forgot.cancel')}</button>
        <button type="submit" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.usersSubmitCreate')}</button>
      </div>
    </form>
  `);

  const form = qs('[data-create-form]', contentEl);
  const errEl = qs('[data-err]', contentEl);
  qs('[data-cancel]', contentEl).addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const displayName = String(fd.get('displayName') || '').trim();
    const role = String(fd.get('role') || 'customer');
    if (!isValidEmail(email)) {
      errEl.textContent = t('admin.usersError');
      errEl.classList.remove('hidden');
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await adminCreateUserFn({ email, password, displayName, role });
      showToast(t('admin.usersCreatedToast'), 'success');
      close();
      onDone?.();
    } catch (err) {
      console.error('adminCreateUser', err);
      errEl.textContent = err.message || t('admin.usersError');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('admin.usersSubmitCreate');
    }
  });
}

function openInviteModal(onDone) {
  const { close, contentEl } = openModal(`
    <h2 class="font-heading text-xl font-bold text-blueberry-deep mb-1">${t('admin.usersInviteTitle')}</h2>
    <p class="text-dim text-[14px] mb-5">${t('admin.usersInviteHint')}</p>
    <form data-invite-form class="space-y-4">
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersName')}</label>
        <input name="displayName" type="text" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersEmail')} *</label>
        <input name="email" type="email" required class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('admin.usersRoleLabel')}</label>
        <select name="role" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          <option value="customer">${t('admin.usersRole.customer')}</option>
          <option value="driver">${t('admin.usersRole.driver')}</option>
          <option value="agent">${t('admin.usersRole.agent')}</option>
          <option value="admin">${t('admin.usersRole.admin')}</option>
        </select>
      </div>
      <div data-err class="text-danger text-[13px] hidden"></div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors">${t('forgot.cancel')}</button>
        <button type="submit" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('admin.usersSubmitInvite')}</button>
      </div>
    </form>
  `);

  const form = qs('[data-invite-form]', contentEl);
  const errEl = qs('[data-err]', contentEl);
  qs('[data-cancel]', contentEl).addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const fd = new FormData(form);
    const email = String(fd.get('email') || '').trim();
    const displayName = String(fd.get('displayName') || '').trim();
    const role = String(fd.get('role') || 'customer');
    if (!isValidEmail(email)) {
      errEl.textContent = t('admin.usersError');
      errEl.classList.remove('hidden');
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await adminSendInviteFn({ email, displayName, role, locale: getLocale() });
      showToast(t('admin.usersInvitedToast'), 'success');
      close();
      onDone?.();
    } catch (err) {
      console.error('adminSendInvite', err);
      errEl.textContent = err.message || t('admin.usersError');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('admin.usersSubmitInvite');
    }
  });
}
