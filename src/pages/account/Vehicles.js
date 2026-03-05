import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';

/* ── Mock vehicles (fallback if profile not loaded) ── */
const MOCK_VEHICLES = [
  { plate: 'B 123 ABC', make: 'Volkswagen', model: 'Passat', color: 'Gri', year: 2021 },
  { plate: 'IF 99 XYZ', make: 'Dacia', model: 'Duster', color: 'Alb', year: 2023 },
];

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
            <p class="text-dim text-[14px]">${v.make} ${v.model} &middot; ${v.color} &middot; ${v.year}</p>
          </div>
        </div>
        <button class="text-danger/60 hover:text-danger text-[14px] font-semibold transition-colors" data-remove="${index}">${t('account.remove')}</button>
      </div>
    </div>
  `;
}

export default function Vehicles(container) {
  const locale = getLocale();
  const profile = getUserProfile();
  // Use profile vehicles if available, else mock
  const vehicles = (profile?.vehicles && profile.vehicles.length > 0)
    ? profile.vehicles
    : MOCK_VEHICLES;

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
      ${vehicles.map((v, i) => renderVehicleCard(v, i)).join('')}
    </div>

    <!-- Add vehicle form -->
    <div class="card-solid rounded-2xl p-6">
      <h3 class="font-heading font-bold text-lg mb-5">${t('account.addVehicle')}</h3>
      <form data-add-vehicle class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.licensePlate')}</label>
          <input type="text" name="plate" placeholder="B 000 AAA" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40 focus:ring-2 focus:ring-mango/10 transition-all">
        </div>
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.make')}</label>
          <input type="text" name="make" placeholder="Volkswagen" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40 focus:ring-2 focus:ring-mango/10 transition-all">
        </div>
        <div>
          <label class="text-[13px] text-dim font-medium mb-1 block">${t('account.model')}</label>
          <input type="text" name="model" placeholder="Passat" required
            class="w-full bg-frost border border-frost-deep rounded-xl px-4 py-3 text-[15px] placeholder:text-dim/40 focus:outline-none focus:border-mango/40 focus:ring-2 focus:ring-mango/10 transition-all">
        </div>
        <div class="flex items-end">
          <button type="submit"
            class="w-full bg-charcoal hover:bg-charcoal/85 text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">
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

  // Local mutable copy for UI interactions
  const localVehicles = [...vehicles];

  // Remove vehicle
  delegate(page, 'click', '[data-remove]', (e, btn) => {
    const idx = parseInt(btn.dataset.remove, 10);
    if (confirm(t('account.removeConfirm', { plate: localVehicles[idx]?.plate }))) {
      localVehicles.splice(idx, 1);
      rerenderList();
    }
  });

  // Add vehicle
  const form = page.querySelector('[data-add-vehicle]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const plate = fd.get('plate').trim().toUpperCase();
    const make = fd.get('make').trim();
    const model = fd.get('model').trim();
    if (!plate || !make || !model) return;
    localVehicles.push({ plate, make, model, color: '—', year: new Date().getFullYear() });
    form.reset();
    rerenderList();
  });

  function rerenderList() {
    const list = page.querySelector('[data-vehicle-list]');
    if (localVehicles.length === 0) {
      list.innerHTML = `<p class="text-dim text-center py-8">${t('account.noVehicles')}</p>`;
    } else {
      list.innerHTML = localVehicles.map((v, i) => renderVehicleCard(v, i)).join('');
    }
  }

  container.appendChild(page);
}
