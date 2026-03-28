import { html, delegate } from '../../utils/dom.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { getAllTokenPacks, createTokenPack, updateTokenPack, deleteTokenPack } from '../../services/tokenService.js';
import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { showToast } from '../../components/core/Toast.js';
import { confirmModal } from '../../components/core/Modal.js';

export default async function AdminPricing(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('admin.pricing')} — Admin — Mango Parking`, description: t('admin.pricingSubtitle') });

  let packs = await getAllTokenPacks().catch(() => []);
  const deletedIds = new Set();

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
          <button data-delete-pack="${p.id || `new-${idx}`}" class="text-red-400 hover:text-red-600 text-[13px] font-semibold transition-colors">${t('token.deletePack')}</button>
        </td>
      </tr>
    `;
  }

  const page = AdminLayout('/admin/pricing', `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 class="font-heading text-3xl font-bold tracking-tight text-charcoal">${t('token.packManagement')}</h1>
            <p class="text-dim text-[15px] mt-1">${t('token.packManagementSubtitle')}</p>
          </div>
          <button data-save-packs class="bg-mango hover:bg-mango-hover text-white font-semibold text-[14px] px-6 py-3 rounded-xl transition-colors shadow-sm">${t('admin.saveChanges')}</button>
        </div>

        <div class="card-solid rounded-2xl overflow-hidden mb-6">
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b border-frost-deep bg-frost/50 text-[12px] font-mono uppercase tracking-wider text-dim">
                  <th class="px-4 py-3">${t('token.packName')}</th>
                  <th class="px-4 py-3">${t('token.packNameRo')}</th>
                  <th class="px-4 py-3">${t('token.packQty')}</th>
                  <th class="px-4 py-3">${t('token.packPrice')}</th>
                  <th class="px-4 py-3 text-center">${t('token.packActive')}</th>
                  <th class="px-4 py-3">${t('token.packOrder')}</th>
                  <th class="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody data-packs-body>
                ${packs.map((p, i) => renderPackRow(p, i)).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <button data-add-pack class="bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('token.addPack')}</button>
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
    const confirmed = await confirmModal(t('token.confirmDelete'), { danger: true, confirmText: t('common.delete') });
    if (!confirmed) return;
    if (!rowId.startsWith('new-')) deletedIds.add(rowId);
    const row = page.querySelector(`[data-row-id="${rowId}"]`);
    row?.remove();
  });

  // Save
  delegate(page, 'click', '[data-save-packs]', async () => {
    const rows = page.querySelectorAll('[data-packs-body] tr');
    try {
      // Delete removed packs
      for (const id of deletedIds) {
        await deleteTokenPack(id);
      }

      // Create or update each row
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

      showToast(t('token.packSaved'), 'success');
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  });

  initAdminNav(page);
  container.appendChild(page);
}
