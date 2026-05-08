import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { t, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getLongTermRates, saveLongTermRates, getCommuterPolicy, saveCommuterPolicy } from '../../services/longTermService.js';
import { getOnlineDiscountPercent, saveOnlineDiscountPercent } from '../../services/discountService.js';
import { showToast } from '../../components/core/Toast.js';

export default async function AdminRates(container) {
  updateMeta({ title: `${t('rates.pageTitle')} — Admin`, lang: getLocale() });

  const [rates, policy, discount] = await Promise.all([getLongTermRates(), getCommuterPolicy(), getOnlineDiscountPercent()]);
  let working = JSON.parse(JSON.stringify(rates));
  let workingPolicy = { ...policy };
  let workingDiscount = discount;

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

  const body = `
    <div class="mb-8">
      <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('rates.pageTitle')}</h1>
      <p class="text-dim mt-1">${t('rates.pageSubtitle')}</p>
    </div>

    <!-- Long-term tiers -->
    <section class="card-solid rounded-3xl p-6 md:p-8 mb-6">
      <h2 class="font-heading font-bold text-xl text-blueberry-deep mb-1">${t('rates.longTermRates')}</h2>
      <p class="text-dim text-[14px] mb-5">${t('rates.longTermRatesHelp')}</p>
      <div class="space-y-3" data-tiers>
        ${working.tiers.map((t, i) => tierRow(t, i)).join('')}
      </div>
      <button type="button" data-add-tier class="mt-4 text-blueberry hover:text-blueberry-hover font-semibold text-[14px]">${t('rates.addTier')}</button>
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

    <!-- Save -->
    <div class="flex justify-end">
      <button data-save-all class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-8 py-3 rounded-xl shadow-md transition-colors">${t('rates.saveChanges')}</button>
    </div>
  `;

  const page = AdminLayout('/admin/rates', body);
  container.appendChild(page);
  initAdminNav(page);

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
    // Re-render tiers list with new indices
    tiersEl.innerHTML = working.tiers.map((t, i) => tierRow(t, i)).join('');
    tiersEl.querySelectorAll('[data-tier-row]').forEach(rebindTier);
  });

  page.querySelector('[data-late-rate]').addEventListener('input', (e) => {
    workingPolicy.latePickupDailyRate = Number(e.target.value) || 0;
  });

  page.querySelector('[data-discount-pct]').addEventListener('input', (e) => {
    workingDiscount = Number(e.target.value) || 0;
  });

  page.querySelector('[data-save-all]').addEventListener('click', async (e) => {
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
}
