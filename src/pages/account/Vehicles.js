import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getCurrentUser } from '../../firebase/auth.js';
import { getDocument, updateDocument } from '../../firebase/db.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';
import { confirmModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';

function renderVehicleCard(v, index) {
  return `
    <div class="card-solid rounded-2xl p-5" data-vehicle-card="${index}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-frost flex items-center justify-center">
            ${NAV_ICONS.vehicles}
          </div>
          <div>
            <p class="font-heading font-bold text-[16px] tracking-tight font-mono">${v.plate}</p>
            <p class="text-dim text-[14px]">${v.make} ${v.model}</p>
          </div>
        </div>
        <button class="text-danger/60 hover:text-danger text-[14px] font-semibold transition-colors" data-remove="${index}">${t('account.remove')}</button>
      </div>
    </div>
  `;
}

export default async function Vehicles(container) {
  const locale = getLocale();
  const uid = getCurrentUser()?.uid;
  const profile = uid ? await getDocument('users', uid).catch(() => null) : null;
  const vehicles = profile?.vehicles || [];

  updateMeta({
    title: `${t('account.vehicles')} — Mango Parking`,
    description: t('account.vehiclesSubtitle'),
    lang: locale,
  });

  const content = `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.vehicles')}</h1>
        <p class="text-dim text-[16px]">${t('account.vehiclesSubtitle')}</p>
      </div>
    </div>

    <!-- Vehicle list -->
    <div class="space-y-3 mb-8" data-vehicle-list>
      ${vehicles.length > 0 ? vehicles.map((v, i) => renderVehicleCard(v, i)).join('') : `<p class="text-dim text-center py-8">${t('account.noVehicles')}</p>`}
    </div>

    <!-- Add vehicle form -->
    <div class="card-solid rounded-2xl p-6">
      <h3 class="font-heading font-bold text-lg mb-5">${t('account.addVehicle')}</h3>
      <form data-add-vehicle class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.licensePlate')}</label>
          <input type="text" name="plate" placeholder="B 000 AAA" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40 uppercase">
        </div>
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.make')}</label>
          <input type="text" name="make" placeholder="Volkswagen" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40">
        </div>
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.model')}</label>
          <input type="text" name="model" placeholder="Passat" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40">
        </div>
        <div class="flex items-end">
          <button type="submit"
            class="w-full bg-charcoal hover:bg-charcoal-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">
            ${t('account.addBtn')}
          </button>
        </div>
      </form>
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account/vehicles', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  const localVehicles = [...vehicles];

  async function saveVehicles() {
    if (!uid) return;
    try {
      await updateDocument('users', uid, { vehicles: localVehicles });
    } catch (err) {
      console.error(err);
      showToast(t('common.error'), 'error');
    }
  }

  function rerenderList() {
    const list = page.querySelector('[data-vehicle-list]');
    if (localVehicles.length === 0) {
      list.innerHTML = `<p class="text-dim text-center py-8">${t('account.noVehicles')}</p>`;
    } else {
      list.innerHTML = localVehicles.map((v, i) => renderVehicleCard(v, i)).join('');
    }
  }

  // Remove vehicle
  delegate(page, 'click', '[data-remove]', async (e, btn) => {
    const idx = parseInt(btn.dataset.remove, 10);
    const plate = localVehicles[idx]?.plate || '';
    const confirmed = await confirmModal(t('account.removeConfirm', { plate }), { danger: true, confirmText: t('account.remove') });
    if (confirmed) {
      localVehicles.splice(idx, 1);
      rerenderList();
      await saveVehicles();
      showToast(locale === 'ro' ? 'Vehicul șters!' : 'Vehicle removed!', 'success');
    }
  });

  // Add vehicle
  const form = page.querySelector('[data-add-vehicle]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const plate = fd.get('plate').trim().toUpperCase();
    const make = fd.get('make').trim();
    const model = fd.get('model').trim();
    if (!plate || !make || !model) return;
    localVehicles.push({ plate, make, model });
    form.reset();
    rerenderList();
    await saveVehicles();
    showToast(locale === 'ro' ? 'Vehicul adăugat!' : 'Vehicle added!', 'success');
  });

  container.appendChild(page);
}
