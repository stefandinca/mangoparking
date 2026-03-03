import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';

/* ── Sidebar (shared pattern) ── */
const ACCOUNT_NAV = [
  { path: '/account',              icon: 'dashboard', labelKey: 'account.dashboard' },
  { path: '/account/bookings',     icon: 'bookings',  labelKey: 'account.bookings' },
  { path: '/account/subscription', icon: 'sub',       labelKey: 'account.subscription' },
  { path: '/account/vehicles',     icon: 'vehicles',  labelKey: 'account.vehicles' },
  { path: '/account/loyalty',      icon: 'loyalty',   labelKey: 'account.loyalty' },
];

const NAV_ICONS = {
  dashboard: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm0 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm0 9.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"/></svg>`,
  bookings: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>`,
  sub: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"/></svg>`,
  vehicles: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M3.375 14.25c-.621 0-1.125.504-1.125 1.125v2.25c0 .621.504 1.125 1.125 1.125m0-4.5V6.375c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125v8.25"/></svg>`,
  loyalty: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>`,
};

function accountSidebar(activePath) {
  return ACCOUNT_NAV.map(link => {
    const isActive = link.path === activePath;
    const cls = isActive
      ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[15px] transition-colors'
      : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost hover:text-charcoal text-[15px] transition-colors';
    return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
  }).join('');
}

function accountLayout(activePath, contentHtml) {
  const activeLabel = ACCOUNT_NAV.find(l => l.path === activePath)?.labelKey || 'account.dashboard';
  return `
    <div class="md:hidden mb-6">
      <button data-account-nav-toggle class="flex items-center justify-between w-full card-solid rounded-2xl px-5 py-3.5 text-[15px] font-semibold transition-colors">
        <span>${t(activeLabel)}</span>
        <svg data-chevron class="w-4 h-4 text-dim transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
      </button>
      <div class="hidden card-solid rounded-2xl mt-2 p-2 space-y-0.5" data-account-nav-dropdown>
        ${ACCOUNT_NAV.map(link => {
          const isActive = link.path === activePath;
          const cls = isActive
            ? 'flex items-center gap-3 px-4 py-3 rounded-xl bg-mango/10 text-mango font-semibold text-[14px]'
            : 'flex items-center gap-3 px-4 py-3 rounded-xl text-dim hover:bg-frost text-[14px] transition-colors';
          return `<a href="${localePath(link.path)}" class="${cls}">${NAV_ICONS[link.icon]}<span>${t(link.labelKey)}</span></a>`;
        }).join('')}
      </div>
    </div>
    <div class="flex gap-4 md:gap-8">
      <aside class="hidden md:block w-56 flex-shrink-0">
        <div class="card-solid rounded-2xl p-3 space-y-1 sticky top-28">
          ${accountSidebar(activePath)}
        </div>
      </aside>
      <div class="flex-1 min-w-0">${contentHtml}</div>
    </div>
  `;
}

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

  // Toggle account mobile nav dropdown
  const navToggle = page.querySelector('[data-account-nav-toggle]');
  const navDropdown = page.querySelector('[data-account-nav-dropdown]');
  if (navToggle && navDropdown) {
    navToggle.addEventListener('click', () => {
      navDropdown.classList.toggle('hidden');
      navToggle.querySelector('[data-chevron]').classList.toggle('rotate-180');
    });
  }

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
