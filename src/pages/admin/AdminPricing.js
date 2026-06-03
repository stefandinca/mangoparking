import { html, delegate, escapeHtml } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllTokenPacks, createTokenPack, updateTokenPack, deleteTokenPack } from '../../services/tokenService.js';
import { getLongTermRates, saveLongTermRates, getCommuterPolicy, saveCommuterPolicy } from '../../services/longTermService.js';
import { getOnlineDiscountPercent, saveOnlineDiscountPercent } from '../../services/discountService.js';
import {
  listSeasonalPeriods,
  createSeasonalPeriod,
  updateSeasonalPeriod,
  deleteSeasonalPeriod,
  findOverlap,
} from '../../services/seasonalRatesService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { openModal, confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';

// Combined pricing + rates page. Hosts four data sections that admins
// edit together: credit packs, longterm tiered rates, commuter (late
// pickup) policy, and the online-vs-pay-at-pickup discount %. Each
// section has its own Save button so changes can be staged and pushed
// independently.

export default async function AdminPricing(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.pricing')} — Admin — Mango Parking`, description: t('admin.pricingSubtitle') });

  const [packs, rates, policy, discount, seasonalPeriods] = await Promise.all([
    getAllTokenPacks().catch(() => []),
    getLongTermRates().catch(() => ({ tiers: [] })),
    getCommuterPolicy().catch(() => ({ latePickupDailyRate: 0 })),
    getOnlineDiscountPercent().catch(() => 0),
    listSeasonalPeriods().catch(() => []),
  ]);
  let periods = seasonalPeriods.slice();
  const deletedIds = new Set();
  let working = JSON.parse(JSON.stringify(rates));
  let workingPolicy = { ...policy };
  let workingDiscount = discount;

  function renderPackRow(p, idx) {
    return `
      <tr data-row-id="${p.id || `new-${idx}`}" class="border-b border-frost-deep/60 last:border-0">
        <td class="px-4 py-3"><input type="text" data-field="name" value="${p.name || ''}" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40"></td>
        <td class="px-4 py-3"><input type="text" data-field="nameRo" value="${p.nameRo || ''}" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40"></td>
        <td class="px-4 py-3"><input type="number" data-field="quantity" value="${p.quantity || 0}" min="1" class="w-20 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono text-center focus:outline-none focus:border-mango/40"></td>
        <td class="px-4 py-3"><input type="number" data-field="price" value="${p.price || 0}" min="0" class="w-24 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono text-center focus:outline-none focus:border-mango/40"></td>
        <td class="px-4 py-3 text-center">
          <button data-toggle-active="${p.id || `new-${idx}`}" class="w-10 h-6 rounded-full transition-colors ${p.active !== false ? 'bg-leaf' : 'bg-gray-300'}">
            <div class="w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${p.active !== false ? 'translate-x-5' : 'translate-x-1'}"></div>
          </button>
        </td>
        <td class="px-4 py-3"><input type="number" data-field="sortOrder" value="${p.sortOrder ?? idx}" min="0" class="w-16 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono text-center focus:outline-none focus:border-mango/40"></td>
        <td class="px-4 py-3">
          <button data-delete-pack="${p.id || `new-${idx}`}" class="text-red-400 hover:text-red-600 text-[13px] font-semibold transition-colors">${t('credit.deletePack')}</button>
        </td>
      </tr>
    `;
  }

  const tierRow = (tier, i) => `
    <div class="grid grid-cols-12 gap-3 items-end" data-tier-row data-index="${i}">
      <div class="col-span-3">
        <label class="block text-[12px] text-dim mb-1">${t('rates.minDays')}</label>
        <input type="number" min="1" data-field="minDays" value="${tier.minDays}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[15px]">
      </div>
      <div class="col-span-3">
        <label class="block text-[12px] text-dim mb-1">${t('rates.maxDays')}</label>
        <input type="number" min="1" data-field="maxDays" value="${tier.maxDays ?? ''}" placeholder="${t('rates.maxDaysUnlimited')}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[15px]">
      </div>
      <div class="col-span-4">
        <label class="block text-[12px] text-dim mb-1">${t('rates.perDay')}</label>
        <input type="number" min="0" step="1" data-field="perDay" value="${tier.perDay}" class="w-full px-3 py-2 rounded-xl border border-frost-deep bg-white text-[15px] font-mono">
      </div>
      <div class="col-span-2">
        <button type="button" data-remove-tier class="w-full px-3 py-2 rounded-xl text-danger hover:bg-danger/5 text-[14px] font-semibold transition-colors">${t('rates.removeTier')}</button>
      </div>
    </div>
  `;

  const page = AdminLayout('/admin/pricing', `
        <div class="mb-8">
          <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('admin.pricing')}</h1>
          <p class="text-dim text-[15px] mt-1">${t('admin.pricingSubtitle')}</p>
        </div>

        <!-- Credit packs -->
        <section class="mb-10">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h2 class="font-heading font-bold text-xl text-blueberry-deep">${t('credit.packManagement')}</h2>
            <button data-save-packs class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors shadow-sm">${t('admin.saveChanges')}</button>
          </div>
          <p class="text-dim text-[14px] mb-4">${t('credit.packManagementSubtitle')}</p>

          <div class="card-solid rounded-2xl overflow-hidden mb-4">
            <div class="overflow-x-auto">
              <table class="w-full text-left">
                <thead>
                  <tr class="border-b border-frost-deep bg-frost text-[12px] font-mono uppercase tracking-wider text-dim">
                    <th class="px-4 py-3">${t('credit.packName')}</th>
                    <th class="px-4 py-3">${t('credit.packNameRo')}</th>
                    <th class="px-4 py-3">${t('credit.packQty')}</th>
                    <th class="px-4 py-3">${t('credit.packPrice')}</th>
                    <th class="px-4 py-3 text-center">${t('credit.packActive')}</th>
                    <th class="px-4 py-3">${t('credit.packOrder')}</th>
                    <th class="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody data-packs-body>
                  ${packs.map((p, i) => renderPackRow(p, i)).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <button data-add-pack class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('credit.addPack')}</button>
        </section>

        <!-- Long-term tiers -->
        <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
          <h2 class="font-heading font-bold text-xl text-blueberry-deep mb-1">${t('rates.longTermRates')}</h2>
          <p class="text-dim text-[14px] mb-5">${t('rates.longTermRatesHelp')}</p>
          <div class="space-y-3" data-tiers>
            ${working.tiers.map((tt, i) => tierRow(tt, i)).join('')}
          </div>
          <button type="button" data-add-tier class="mt-4 text-blueberry hover:text-blueberry-hover font-semibold text-[14px]">${t('rates.addTier')}</button>
        </section>

        <!-- Seasonal pricing -->
        <section class="card-solid rounded-3xl p-6 md:p-8 mb-6" data-seasonal-section>
          <div class="flex flex-wrap items-center justify-between gap-3 mb-1">
            <h2 class="font-heading font-bold text-xl text-blueberry-deep">${t('seasonal.title')}</h2>
            <button type="button" data-add-period class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-4 py-2 rounded-xl transition-colors">${t('seasonal.addPeriod')}</button>
          </div>
          <p class="text-dim text-[14px] mb-5">${t('seasonal.help')}</p>
          <div class="space-y-3" data-periods-list></div>
        </section>

        <!-- Commuter policy -->
        <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
          <h2 class="font-heading font-bold text-xl text-blueberry-deep mb-1">${t('rates.commuterPolicy')}</h2>
          <p class="text-dim text-[14px] mb-5">${t('rates.latePickupHelp')}</p>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('rates.latePickupRate')}</label>
          <input type="number" min="0" step="1" data-late-rate value="${workingPolicy.latePickupDailyRate}" class="w-48 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] font-mono">
        </section>

        <!-- Online discount -->
        <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
          <h2 class="font-heading font-bold text-xl text-blueberry-deep mb-1">${t('discount.settingsTitle')}</h2>
          <p class="text-dim text-[14px] mb-5">${t('discount.settingsHint')}</p>
          <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('discount.settingsLabel')}</label>
          <input type="number" min="0" max="50" step="1" data-discount-pct value="${workingDiscount}" class="w-48 px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] font-mono">
        </section>

        <div class="flex justify-end">
          <button data-save-rates class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-8 py-3 rounded-xl shadow-md transition-colors">${t('rates.saveChanges')}</button>
        </div>
  `);

  let newPackIdx = packs.length;

  // Active toggle
  delegate(page, 'click', '[data-toggle-active]', (e, btn) => {
    const isActive = btn.classList.contains('bg-leaf');
    btn.classList.toggle('bg-leaf', !isActive);
    btn.classList.toggle('bg-gray-300', isActive);
    const dot = btn.querySelector('div');
    dot.classList.toggle('translate-x-5', !isActive);
    dot.classList.toggle('translate-x-1', isActive);
  });

  // Add pack
  delegate(page, 'click', '[data-add-pack]', () => {
    const tbody = page.querySelector('[data-packs-body]');
    const newPack = { id: null, name: '', nameRo: '', quantity: 5, price: 100, active: true, sortOrder: newPackIdx };
    const temp = document.createElement('template');
    temp.innerHTML = renderPackRow(newPack, newPackIdx);
    tbody.appendChild(temp.content.firstElementChild);
    newPackIdx++;
  });

  // Delete pack
  delegate(page, 'click', '[data-delete-pack]', async (e, btn) => {
    const rowId = btn.dataset.deletePack;
    const confirmed = await confirmModal(t('credit.confirmDelete'), { danger: true, confirmText: t('common.delete') });
    if (!confirmed) return;
    if (!rowId.startsWith('new-')) deletedIds.add(rowId);
    const row = page.querySelector(`[data-row-id="${rowId}"]`);
    row?.remove();
  });

  // Save packs
  delegate(page, 'click', '[data-save-packs]', async (e, btn) => {
    const rows = page.querySelectorAll('[data-packs-body] tr');
    btn.disabled = true;
    try {
      for (const id of deletedIds) {
        await deleteTokenPack(id);
      }
      for (const row of rows) {
        const rowId = row.dataset.rowId;
        const data = {
          name: row.querySelector('[data-field="name"]').value,
          nameRo: row.querySelector('[data-field="nameRo"]').value,
          quantity: parseInt(row.querySelector('[data-field="quantity"]').value) || 1,
          price: parseInt(row.querySelector('[data-field="price"]').value) || 0,
          active: row.querySelector('[data-toggle-active]')?.classList.contains('bg-leaf') ?? true,
          sortOrder: parseInt(row.querySelector('[data-field="sortOrder"]').value) || 0,
        };
        if (rowId.startsWith('new-')) {
          await createTokenPack(data);
        } else {
          await updateTokenPack(rowId, data);
        }
      }
      showToast(t('credit.packSaved'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Longterm tiers wiring ───────────────────────────────────────────
  const tiersEl = page.querySelector('[data-tiers]');

  function rebindTier(row) {
    row.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => {
        const index = Number(row.dataset.index);
        const field = input.dataset.field;
        const raw = input.value.trim();
        working.tiers[index][field] = field === 'maxDays' && raw === '' ? null : Number(raw);
      });
    });
  }
  page.querySelectorAll('[data-tier-row]').forEach(rebindTier);

  page.querySelector('[data-add-tier]').addEventListener('click', () => {
    const nextMin = (working.tiers[working.tiers.length - 1]?.maxDays || 0) + 1;
    working.tiers.push({ minDays: nextMin, maxDays: null, perDay: 29 });
    const tmp = document.createElement('div');
    tmp.innerHTML = tierRow(working.tiers[working.tiers.length - 1], working.tiers.length - 1);
    const row = tmp.firstElementChild;
    tiersEl.appendChild(row);
    rebindTier(row);
  });

  delegate(page, 'click', '[data-remove-tier]', (_e, btn) => {
    const row = btn.closest('[data-tier-row]');
    const index = Number(row.dataset.index);
    working.tiers.splice(index, 1);
    tiersEl.innerHTML = working.tiers.map((tt, i) => tierRow(tt, i)).join('');
    tiersEl.querySelectorAll('[data-tier-row]').forEach(rebindTier);
  });

  page.querySelector('[data-late-rate]').addEventListener('input', (e) => {
    workingPolicy.latePickupDailyRate = Number(e.target.value) || 0;
  });

  page.querySelector('[data-discount-pct]').addEventListener('input', (e) => {
    workingDiscount = Number(e.target.value) || 0;
  });

  page.querySelector('[data-save-rates]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await Promise.all([
        saveLongTermRates(working),
        saveCommuterPolicy(workingPolicy),
        saveOnlineDiscountPercent(workingDiscount),
      ]);
      showToast(t('rates.saved'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Seasonal pricing wiring ─────────────────────────────────────────
  const periodsListEl = page.querySelector('[data-periods-list]');

  function formatDateRange(start, end) {
    const fmt = (d) => {
      if (!d) return '—';
      try {
        return new Date(d + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'ro-RO', {
          day: '2-digit', month: 'short', year: 'numeric',
        });
      } catch { return d; }
    };
    return `${fmt(start)} → ${fmt(end)}`;
  }

  function tiersSummary(tiers) {
    if (!Array.isArray(tiers) || !tiers.length) return '—';
    return tiers.map((tt) => {
      const range = tt.maxDays ? `${tt.minDays}–${tt.maxDays}` : `${tt.minDays}+`;
      return `${range}d: ${tt.perDay} lei`;
    }).join(' · ');
  }

  function periodCardHtml(p) {
    const statusBadge = p.active
      ? `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-leaf/10 text-leaf">${t('seasonal.active')}</span>`
      : `<span class="text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-dim">${t('seasonal.inactive')}</span>`;
    return `
      <div class="border border-frost-deep rounded-2xl p-4 bg-white" data-period-id="${escapeHtml(p.id || '')}">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-heading font-bold text-[15px] text-blueberry-deep">${escapeHtml(p.name || '—')}</h3>
              ${statusBadge}
            </div>
            <p class="text-[13px] text-dim font-mono mt-0.5">${formatDateRange(p.startDate, p.endDate)}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button type="button" data-edit-period="${escapeHtml(p.id)}" class="text-[13px] text-blueberry hover:underline font-semibold">${t('common.edit')}</button>
            <button type="button" data-delete-period="${escapeHtml(p.id)}" class="text-[13px] text-red-500 hover:underline font-semibold">${t('common.delete')}</button>
          </div>
        </div>
        <p class="text-[13px] text-charcoal/70 font-mono">${tiersSummary(p.tiers)}</p>
      </div>
    `;
  }

  function renderPeriodsList() {
    if (!periods.length) {
      periodsListEl.innerHTML = `<div class="text-center py-6 text-dim text-[14px]">${t('seasonal.empty')}</div>`;
      return;
    }
    periodsListEl.innerHTML = periods
      .slice()
      .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
      .map(periodCardHtml).join('');
  }
  renderPeriodsList();

  function openPeriodModal(existing = null) {
    const isEdit = !!existing;
    const initial = existing || {
      name: '',
      startDate: '',
      endDate: '',
      active: true,
      tiers: working.tiers.map((tt) => ({ ...tt })),  // seed from current defaults
    };
    const tierInputs = (tiers) => tiers.map((tt, i) => `
      <div class="grid grid-cols-12 gap-2 items-end" data-modal-tier-row data-idx="${i}">
        <div class="col-span-3">
          <label class="block text-[11px] text-dim mb-0.5">${t('rates.minDays')}</label>
          <input type="number" min="1" name="minDays_${i}" value="${tt.minDays}" class="w-full px-2 py-1.5 rounded-lg border border-frost-deep bg-white text-[14px]">
        </div>
        <div class="col-span-3">
          <label class="block text-[11px] text-dim mb-0.5">${t('rates.maxDays')}</label>
          <input type="number" min="1" name="maxDays_${i}" value="${tt.maxDays ?? ''}" placeholder="${t('rates.maxDaysUnlimited')}" class="w-full px-2 py-1.5 rounded-lg border border-frost-deep bg-white text-[14px]">
        </div>
        <div class="col-span-4">
          <label class="block text-[11px] text-dim mb-0.5">${t('rates.perDay')}</label>
          <input type="number" min="0" step="1" name="perDay_${i}" value="${tt.perDay}" class="w-full px-2 py-1.5 rounded-lg border border-frost-deep bg-white text-[14px] font-mono">
        </div>
        <div class="col-span-2">
          <button type="button" data-modal-remove-tier class="w-full px-2 py-1.5 rounded-lg text-danger hover:bg-danger/5 text-[13px] font-semibold">${t('rates.removeTier')}</button>
        </div>
      </div>
    `).join('');

    const form = html`<form class="space-y-4" data-period-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${isEdit ? t('seasonal.editTitle') : t('seasonal.addTitle')}</h3>

      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('seasonal.fieldName')} *</label>
        <input name="name" type="text" required value="${escapeHtml(initial.name || '')}" placeholder="${escapeHtml(t('seasonal.namePlaceholder'))}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('seasonal.fieldStart')} *</label>
          <input name="startDate" type="date" required value="${escapeHtml(initial.startDate || '')}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('seasonal.fieldEnd')} *</label>
          <input name="endDate" type="date" required value="${escapeHtml(initial.endDate || '')}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
        </div>
      </div>

      <label class="flex items-center gap-2.5 text-[14px] text-charcoal/80 cursor-pointer">
        <input type="checkbox" name="active" ${initial.active ? 'checked' : ''} class="accent-mango w-4 h-4">
        <span>${t('seasonal.fieldActive')}</span>
      </label>

      <div>
        <p class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('seasonal.tiersTitle')} *</p>
        <div class="space-y-2" data-modal-tiers>${tierInputs(initial.tiers)}</div>
        <button type="button" data-modal-add-tier class="mt-2 text-blueberry hover:text-blueberry-hover font-semibold text-[13px]">+ ${t('rates.addTier')}</button>
      </div>

      <p class="text-[12px] text-dim">${t('seasonal.overlapHint')}</p>

      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] py-3 rounded-xl transition-colors">${isEdit ? t('common.save') : t('seasonal.addPeriod')}</button>
    </form>`;

    const modal = openModal(form);
    let modalTiers = initial.tiers.map((tt) => ({ ...tt }));

    const tiersWrap = form.querySelector('[data-modal-tiers]');

    function rerenderModalTiers() {
      tiersWrap.innerHTML = tierInputs(modalTiers);
    }

    form.querySelector('[data-modal-add-tier]').addEventListener('click', () => {
      const last = modalTiers[modalTiers.length - 1];
      const nextMin = last?.maxDays ? last.maxDays + 1 : (last?.minDays || 0) + 7;
      modalTiers.push({ minDays: nextMin, maxDays: null, perDay: last?.perDay || 49 });
      rerenderModalTiers();
    });

    form.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modal-remove-tier]');
      if (!btn) return;
      const row = btn.closest('[data-modal-tier-row]');
      const idx = Number(row.dataset.idx);
      modalTiers.splice(idx, 1);
      rerenderModalTiers();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Re-read tiers from inputs so manual edits land in `modalTiers`.
      const liveTiers = [];
      tiersWrap.querySelectorAll('[data-modal-tier-row]').forEach((row, i) => {
        const minDays = Number(row.querySelector(`[name="minDays_${i}"]`)?.value) || 0;
        const maxRaw = row.querySelector(`[name="maxDays_${i}"]`)?.value.trim();
        const maxDays = maxRaw === '' ? null : Number(maxRaw);
        const perDay = Number(row.querySelector(`[name="perDay_${i}"]`)?.value) || 0;
        liveTiers.push({ minDays, maxDays, perDay });
      });

      const candidate = {
        name: form.name.value.trim(),
        startDate: form.startDate.value,
        endDate: form.endDate.value,
        active: form.active.checked,
        tiers: liveTiers,
      };

      // Basic validation.
      if (!candidate.name) { showToast(t('seasonal.errorName'), 'error'); return; }
      if (!candidate.startDate || !candidate.endDate) { showToast(t('seasonal.errorDates'), 'error'); return; }
      if (candidate.startDate > candidate.endDate) { showToast(t('seasonal.errorRange'), 'error'); return; }
      if (!candidate.tiers.length) { showToast(t('seasonal.errorTiers'), 'error'); return; }
      const badTier = candidate.tiers.find((tt) => !tt.minDays || tt.perDay == null);
      if (badTier) { showToast(t('seasonal.errorTiers'), 'error'); return; }

      // Overlap check against existing periods (excluding self on edit).
      const conflict = findOverlap(periods, candidate, existing?.id || null);
      if (conflict) {
        showToast(t('seasonal.errorOverlap', { name: conflict.name }), 'error');
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      try {
        if (existing) {
          await updateSeasonalPeriod(existing.id, candidate);
          periods = periods.map((p) => p.id === existing.id ? { ...p, ...candidate } : p);
        } else {
          const newId = await createSeasonalPeriod(candidate);
          periods.push({ id: newId, ...candidate });
        }
        showToast(t('seasonal.saved'), 'success');
        renderPeriodsList();
        modal.close();
      } catch (err) {
        console.error(err);
        showToast(err?.message || t('common.error'), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? t('common.save') : t('seasonal.addPeriod');
      }
    });
  }

  delegate(page, 'click', '[data-add-period]', () => {
    openPeriodModal(null);
  });

  delegate(page, 'click', '[data-edit-period]', (_e, btn) => {
    const id = btn.dataset.editPeriod;
    const p = periods.find((x) => x.id === id);
    if (p) openPeriodModal(p);
  });

  delegate(page, 'click', '[data-delete-period]', async (_e, btn) => {
    const id = btn.dataset.deletePeriod;
    const p = periods.find((x) => x.id === id);
    if (!p) return;
    const ok = await confirmModal(t('seasonal.deleteConfirm', { name: p.name }), {
      danger: true, confirmText: t('common.delete'),
    });
    if (!ok) return;
    try {
      await deleteSeasonalPeriod(id);
      periods = periods.filter((x) => x.id !== id);
      renderPeriodsList();
      showToast(t('seasonal.deleted'), 'success');
    } catch (err) {
      console.error(err);
      showToast(err?.message || t('common.error'), 'error');
    }
  });

  initAdminNav(page);
  container.appendChild(page);
}
