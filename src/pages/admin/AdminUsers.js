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
import { buildUsersExport } from '../../services/userExportService.js';
import { buildCsv, downloadCsv, todayStamp } from '../../utils/csv.js';

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

    <input data-filter type="search" placeholder="${t('admin.usersSearch')}"
      class="w-full max-w-md mb-6 px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">

    <div data-rows>
      <div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">…</div>
    </div>
  `);

  initAdminNav(page);
  container.appendChild(page);

  const rows = qs('[data-rows]', page);
  const filterInput = qs('[data-filter]', page);

  filterInput.addEventListener('input', (e) => {
    filter = String(e.target.value || '').toLowerCase();
    render();
  });
  qs('[data-create]', page).addEventListener('click', () => openCreateModal(reload));
  qs('[data-invite]', page).addEventListener('click', () => openInviteModal(reload));
  qs('[data-export]', page).addEventListener('click', exportCsv);

  // Users currently shown (respects the search box) — shared by render + export
  // so the CSV matches exactly what the admin is looking at.
  function currentFiltered() {
    return users.filter((u) => {
      if (!filter) return true;
      const hay = `${u.email || ''} ${u.displayName || ''}`.toLowerCase();
      return hay.includes(filter);
    });
  }

  // Bulk invoice export: identity + lifetime spend totals, one row per user.
  // Aggregates all bookings + credit purchases once inside buildUsersExport.
  async function exportCsv(e) {
    const btn = e.currentTarget;
    // Invoicing is for customers only — exclude staff (admin/agent/driver, incl.
    // the legacy 'staff' alias). The per-user modal export can still export any
    // account you explicitly open.
    const list = currentFiltered().filter((u) => normalizeRole(u.role) === 'customer');
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

  function render() {
    const currentUid = getCurrentUser()?.uid;
    const filtered = currentFiltered();
    if (filtered.length === 0) {
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-dim text-[14px]">${t('admin.usersEmpty')}</div>`;
      return;
    }

    // Group by role; render in fixed order so admins always appear first.
    const groups = ROLE_ORDER.map((role) => ({
      role,
      members: filtered.filter((u) => normalizeRole(u.role) === role),
    })).filter((g) => g.members.length > 0);

    rows.innerHTML = groups.map((g) => `
      <section class="mb-6">
        <header class="flex items-baseline justify-between mb-2 px-1">
          <h2 class="font-heading text-[15px] font-bold text-blueberry-deep uppercase tracking-wider">
            ${t(`admin.usersGroup.${g.role}`)}
          </h2>
          <span class="text-[12px] text-dim font-mono">${g.members.length}</span>
        </header>
        <div class="bg-white rounded-2xl border border-frost-deep overflow-hidden">
          <table class="w-full text-[14px]">
            <thead class="bg-frost text-charcoal/70 text-[12px] uppercase tracking-wider">
              <tr>
                <th class="text-left px-4 py-3">${t('admin.usersCol.name')}</th>
                <th class="text-left px-4 py-3">${t('admin.usersCol.email')}</th>
                <th class="text-left px-4 py-3">${t('admin.usersCol.createdAt')}</th>
                <th class="text-left px-4 py-3">${t('admin.usersRoleLabel')}</th>
                <th class="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              ${g.members.map((u) => {
                const isSelf = u.id === currentUid;
                const safeName = escapeHtml(u.displayName || u.email || '—');
                const currentRole = normalizeRole(u.role);
                return `
                  <tr class="border-t border-frost-deep">
                    <td class="px-4 py-3">
                      <button data-action="view" data-uid="${escapeHtml(u.id)}" class="text-left font-medium text-blueberry hover:text-blueberry-hover hover:underline transition-colors">${escapeHtml(u.displayName || u.email || '—')}</button>${isSelf ? ` <span class="text-[11px] text-dim ml-1">${t('admin.usersYou')}</span>` : ''}
                    </td>
                    <td class="px-4 py-3 font-mono text-[13px]">${escapeHtml(u.email || '—')}</td>
                    <td class="px-4 py-3 text-dim">${fmtDate(u.createdAt)}</td>
                    <td class="px-4 py-3">
                      ${isSelf
                        ? `<span class="text-[13px] text-dim">${t('admin.usersRole.' + currentRole)}</span>`
                        : `<select data-action="role-change" data-uid="${escapeHtml(u.id)}" data-current="${currentRole}" class="px-2 py-1 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-mango/40">
                            ${ROLE_ORDER.map((r) => `<option value="${r}" ${r === currentRole ? 'selected' : ''}>${t('admin.usersRole.' + r)}</option>`).join('')}
                          </select>`}
                    </td>
                    <td class="px-4 py-3 text-right">
                      ${isSelf
                        ? ''
                        : `<button data-action="delete" data-uid="${escapeHtml(u.id)}" data-name="${safeName}" data-email="${escapeHtml(u.email || '')}" class="text-[12px] text-danger hover:underline">${t('admin.usersDelete')}</button>`}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `).join('');
  }

  async function reload() {
    try {
      users = await getCollection('users');
      users.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      render();
    } catch (err) {
      console.error('AdminUsers: load failed', err);
      rows.innerHTML = `<div class="bg-white rounded-2xl border border-frost-deep text-center py-10 text-danger text-[14px]">${t('admin.usersError')}</div>`;
    }
  }

  reload();
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
