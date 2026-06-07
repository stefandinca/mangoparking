import { html, escapeHtml, delegate } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { getCollection, orderBy } from '../../firebase/db.js';
import {
  listVouchers,
  saveVoucher,
  deleteVoucher,
  normalizeCode,
  isValidCodeFormat,
} from '../../services/promoVoucherService.js';

// /admin/vouchers — promo voucher administration.
//
// Each row in the `promoVouchers` collection is a code customers can
// enter at checkout. Admin can create / edit / delete / toggle active.
// The booking flow validates eligibility server-side at pay time
// (see functions/src/pricingValidate.js → resolveVoucher).

function fmtDate(iso, locale) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function valueLabel(v) {
  if (v.type === 'fixed') return `-${v.value} ${t('common.lei')}`;
  if (v.type === 'percent') return `-${v.value}%`;
  if (v.type === 'days') return t('voucher.valueDays', { value: v.value });
  return '—';
}

function statusBadge(v) {
  if (!v.active) {
    return `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-dim">${t('vouchers.statusInactive')}</span>`;
  }
  return `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-leaf/10 text-leaf">${t('vouchers.statusActive')}</span>`;
}

function visibilityBadge(v) {
  const isPublic = v.visibility !== 'private';
  return isPublic
    ? `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-blueberry/10 text-blueberry">${t('vouchers.public')}</span>`
    : `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-mango/10 text-mango">${t('vouchers.private')}</span>`;
}

function voucherRowHtml(v, locale) {
  const cap = Number(v.maxRedemptionsTotal);
  const usage = Number.isFinite(cap) && cap > 0
    ? `${v.redeemedCount || 0} / ${cap}`
    : `${v.redeemedCount || 0}`;
  return `
    <tr class="border-t border-frost-deep" data-voucher-id="${escapeHtml(v.code)}">
      <td class="px-4 py-3">
        <div class="flex flex-col gap-1 min-w-0">
          <span class="font-mono font-bold text-[14px] text-blueberry-deep">${escapeHtml(v.code)}</span>
          <span class="text-[13px] text-charcoal/80 truncate">${escapeHtml(v.name || '—')}</span>
        </div>
      </td>
      <td class="px-4 py-3 font-mono text-[14px] font-semibold text-blueberry">${valueLabel(v)}</td>
      <td class="px-4 py-3 text-[13px] text-dim">${fmtDate(v.startDate, locale)} → ${fmtDate(v.endDate, locale)}</td>
      <td class="px-4 py-3">${statusBadge(v)}</td>
      <td class="px-4 py-3">${visibilityBadge(v)}</td>
      <td class="px-4 py-3 font-mono text-[13px]">${usage}</td>
      <td class="px-4 py-3 text-right">
        <div class="inline-flex items-center gap-2">
          <button type="button" data-edit-voucher="${escapeHtml(v.code)}" class="text-[13px] text-blueberry hover:underline font-semibold">${t('common.edit')}</button>
          <button type="button" data-delete-voucher="${escapeHtml(v.code)}" class="text-[13px] text-red-500 hover:underline font-semibold">${t('common.delete')}</button>
        </div>
      </td>
    </tr>
  `;
}

export default async function AdminVouchers(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('vouchers.pageTitle')} — Admin — ManGO Parking`,
    description: t('vouchers.subtitle'),
    lang: locale,
  });

  // Pre-fetch user list for the private-voucher uid picker — kept small
  // by reading all users and filtering client-side (fine at our scale).
  const [vouchers, users] = await Promise.all([
    listVouchers().catch(() => []),
    getCollection('users', orderBy('createdAt', 'desc')).catch(() => []),
  ]);
  let workingVouchers = vouchers.slice();

  const content = `
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('vouchers.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('vouchers.subtitle')}</p>
      </div>
      <button type="button" data-new-voucher class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors shadow-sm">${t('vouchers.addNew')}</button>
    </div>

    <div data-vouchers-table-wrap></div>
  `;

  const page = AdminLayout('/admin/vouchers', content);
  initAdminNav(page);
  container.appendChild(page);

  const tableWrap = page.querySelector('[data-vouchers-table-wrap]');

  function renderTable() {
    if (!workingVouchers.length) {
      tableWrap.innerHTML = `<div class="card-solid rounded-2xl p-10 text-center text-dim">${t('vouchers.empty')}</div>`;
      return;
    }
    tableWrap.innerHTML = `
      <div class="card-solid rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead class="bg-frost">
              <tr class="text-left text-[12px] font-mono uppercase tracking-wider text-dim">
                <th class="px-4 py-3 font-medium">${t('vouchers.col.code')}</th>
                <th class="px-4 py-3 font-medium">${t('vouchers.col.value')}</th>
                <th class="px-4 py-3 font-medium">${t('vouchers.col.period')}</th>
                <th class="px-4 py-3 font-medium">${t('vouchers.col.status')}</th>
                <th class="px-4 py-3 font-medium">${t('vouchers.col.visibility')}</th>
                <th class="px-4 py-3 font-medium">${t('vouchers.col.usage')}</th>
                <th class="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>${workingVouchers.map((v) => voucherRowHtml(v, locale)).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }
  renderTable();

  delegate(page, 'click', '[data-new-voucher]', () => openVoucherModal(null));
  delegate(page, 'click', '[data-edit-voucher]', (_e, btn) => {
    const code = btn.dataset.editVoucher;
    const v = workingVouchers.find((x) => x.code === code);
    if (v) openVoucherModal(v);
  });
  delegate(page, 'click', '[data-delete-voucher]', async (_e, btn) => {
    const code = btn.dataset.deleteVoucher;
    const v = workingVouchers.find((x) => x.code === code);
    if (!v) return;
    const ok = await confirmModal(t('vouchers.deleteConfirm', { code: v.code }), {
      danger: true, confirmText: t('common.delete'),
    });
    if (!ok) return;
    try {
      await deleteVoucher(code);
      workingVouchers = workingVouchers.filter((x) => x.code !== code);
      renderTable();
      showToast(t('vouchers.deleted'), 'success');
    } catch (err) {
      console.error(err);
      showToast(err?.message || t('common.error'), 'error');
    }
  });

  function openVoucherModal(existing) {
    const isEdit = !!existing;
    const init = existing || {
      code: '',
      name: '',
      active: true,
      type: 'percent',
      value: 10,
      startDate: '',
      endDate: '',
      visibility: 'public',
      assignedUserIds: [],
      maxRedemptionsTotal: '',
      redeemedCount: 0,
    };

    const userOptions = users.map((u) => {
      const checked = init.assignedUserIds?.includes(u.id) ? 'checked' : '';
      const label = u.displayName || u.email || u.id;
      return `
        <label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-frost/50 cursor-pointer text-[13px]">
          <input type="checkbox" name="uid_${u.id}" value="${escapeHtml(u.id)}" ${checked} class="accent-mango">
          <span class="min-w-0 truncate">${escapeHtml(label)}</span>
          ${u.email && u.email !== label ? `<span class="text-dim text-[11px] truncate">${escapeHtml(u.email)}</span>` : ''}
        </label>
      `;
    }).join('');

    const form = html`<form class="space-y-4" data-voucher-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${isEdit ? t('vouchers.editTitle') : t('vouchers.addTitle')}</h3>

      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldCode')} *</label>
          <input name="code" type="text" required value="${escapeHtml(init.code || '')}" ${isEdit ? 'readonly' : ''} placeholder="ex: BLACK50" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono uppercase focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldName')} *</label>
          <input name="name" type="text" required value="${escapeHtml(init.name || '')}" placeholder="${escapeHtml(t('vouchers.namePlaceholder'))}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldType')} *</label>
          <select name="type" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
            <option value="percent" ${init.type === 'percent' ? 'selected' : ''}>${t('vouchers.typePercent')}</option>
            <option value="fixed" ${init.type === 'fixed' ? 'selected' : ''}>${t('vouchers.typeFixed')}</option>
            <option value="days" ${init.type === 'days' ? 'selected' : ''}>${t('vouchers.typeDays')}</option>
          </select>
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldValue')} *</label>
          <input name="value" type="number" min="1" step="1" required value="${init.value || ''}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <p data-days-hint class="text-[12px] text-dim -mt-2 ${init.type === 'days' ? '' : 'hidden'}">${t('vouchers.daysHint')}</p>

      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldStart')} *</label>
          <input name="startDate" type="date" required value="${escapeHtml(init.startDate || '')}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldEnd')} *</label>
          <input name="endDate" type="date" required value="${escapeHtml(init.endDate || '')}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldVisibility')} *</label>
        <div class="grid sm:grid-cols-2 gap-2">
          <label class="flex items-start gap-2 p-3 rounded-xl border-2 cursor-pointer ${init.visibility !== 'private' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
            <input type="radio" name="visibility" value="public" ${init.visibility !== 'private' ? 'checked' : ''} class="accent-mango mt-0.5">
            <div class="min-w-0">
              <p class="text-[14px] font-semibold">${t('vouchers.public')}</p>
              <p class="text-[12px] text-dim">${t('vouchers.publicHint')}</p>
            </div>
          </label>
          <label class="flex items-start gap-2 p-3 rounded-xl border-2 cursor-pointer ${init.visibility === 'private' ? 'border-mango bg-mango/5' : 'border-frost-deep'}">
            <input type="radio" name="visibility" value="private" ${init.visibility === 'private' ? 'checked' : ''} class="accent-mango mt-0.5">
            <div class="min-w-0">
              <p class="text-[14px] font-semibold">${t('vouchers.private')}</p>
              <p class="text-[12px] text-dim">${t('vouchers.privateHint')}</p>
            </div>
          </label>
        </div>
      </div>

      <div data-assignees-wrap class="${init.visibility === 'private' ? '' : 'hidden'}">
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldAssignees')} *</label>
        <input type="search" data-uid-filter placeholder="${escapeHtml(t('vouchers.searchUsers'))}" class="w-full px-3 py-2 mb-2 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry">
        <div class="max-h-48 overflow-y-auto rounded-xl border border-frost-deep bg-white p-1" data-uid-list>${userOptions}</div>
        <p class="text-[12px] text-dim mt-1">${t('vouchers.assigneesHint')}</p>
      </div>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('vouchers.fieldMaxTotal')}</label>
        <input name="maxRedemptionsTotal" type="number" min="1" step="1" value="${init.maxRedemptionsTotal ?? ''}" placeholder="${escapeHtml(t('vouchers.maxUnlimited'))}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
        <p class="text-[12px] text-dim mt-1">${t('vouchers.maxHint')}</p>
      </div>

      <label class="flex items-center gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
        <input type="checkbox" name="active" ${init.active ? 'checked' : ''} class="accent-mango w-4 h-4">
        <span>${t('vouchers.fieldActive')}</span>
      </label>

      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] py-3 rounded-xl transition-colors">${isEdit ? t('common.save') : t('vouchers.addNew')}</button>
    </form>`;

    const modal = openModal(form);

    // Visibility toggle shows/hides assignees block.
    form.querySelectorAll('input[name="visibility"]').forEach((r) => {
      r.addEventListener('change', () => {
        const wrap = form.querySelector('[data-assignees-wrap]');
        wrap.classList.toggle('hidden', form.visibility.value !== 'private');
      });
    });

    // Days-type explainer (long-term only, splittable across bookings).
    form.type.addEventListener('change', () => {
      form.querySelector('[data-days-hint]').classList.toggle('hidden', form.type.value !== 'days');
    });

    // Live filter over the uid checkbox list.
    const uidFilter = form.querySelector('[data-uid-filter]');
    if (uidFilter) {
      uidFilter.addEventListener('input', () => {
        const q = uidFilter.value.trim().toLowerCase();
        form.querySelectorAll('[data-uid-list] label').forEach((lbl) => {
          lbl.style.display = !q || lbl.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }

    // Uppercase the code as the admin types (only when creating).
    if (!isEdit) {
      form.code.addEventListener('input', () => {
        form.code.value = normalizeCode(form.code.value);
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = normalizeCode(form.code.value);
      if (!isValidCodeFormat(code)) {
        showToast(t('vouchers.errorCode'), 'error');
        return;
      }
      const name = form.name.value.trim();
      if (!name) { showToast(t('vouchers.errorName'), 'error'); return; }
      const type = form.type.value;
      const value = Number(form.value.value);
      if (!Number.isFinite(value) || value <= 0) { showToast(t('vouchers.errorValue'), 'error'); return; }
      if (type === 'percent' && value > 100) { showToast(t('vouchers.errorPercent'), 'error'); return; }
      if (type === 'days' && !Number.isInteger(value)) { showToast(t('vouchers.errorDays'), 'error'); return; }
      const startDate = form.startDate.value;
      const endDate = form.endDate.value;
      if (!startDate || !endDate) { showToast(t('vouchers.errorDates'), 'error'); return; }
      if (startDate > endDate) { showToast(t('vouchers.errorRange'), 'error'); return; }
      const visibility = form.visibility.value;
      const assignedUserIds = visibility === 'private'
        ? Array.from(form.querySelectorAll('[data-uid-list] input[type="checkbox"]:checked')).map((cb) => cb.value)
        : [];
      if (visibility === 'private' && !assignedUserIds.length) {
        showToast(t('vouchers.errorAssignees'), 'error');
        return;
      }
      const maxRaw = form.maxRedemptionsTotal.value.trim();
      const maxRedemptionsTotal = maxRaw === '' ? null : Number(maxRaw);
      if (maxRedemptionsTotal != null && (!Number.isFinite(maxRedemptionsTotal) || maxRedemptionsTotal < 1)) {
        showToast(t('vouchers.errorMax'), 'error');
        return;
      }
      const active = form.active.checked;

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      try {
        // On create, refuse if code already exists.
        if (!isEdit && workingVouchers.find((v) => v.code === code)) {
          showToast(t('vouchers.errorCodeTaken', { code }), 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = t('vouchers.addNew');
          return;
        }
        const saved = await saveVoucher({
          code,
          name,
          type,
          value,
          startDate,
          endDate,
          visibility,
          assignedUserIds,
          maxRedemptionsTotal,
          active,
          redeemedCount: existing?.redeemedCount || 0,
          createdAt: existing?.createdAt || undefined,
        });
        // Update in-memory list.
        const idx = workingVouchers.findIndex((v) => v.code === code);
        if (idx >= 0) workingVouchers[idx] = saved;
        else workingVouchers.unshift(saved);
        renderTable();
        showToast(t('vouchers.saved'), 'success');
        modal.close();
      } catch (err) {
        console.error(err);
        showToast(err?.message || t('common.error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? t('common.save') : t('vouchers.addNew');
      }
    });
  }
}
