import { html } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';
import { getUserProfile } from '../../firebase/auth.js';
import { hasPermission, PERM } from '../../utils/permissions.js';

// Each entry pairs a route with the permission its sidebar link requires.
// Roles without that permission won't see the link (and the route guard
// blocks direct URL access anyway — see src/router/routes.js).
const ADMIN_LINKS = [
  { path: '/admin',              labelKey: 'admin.dashboard',    perm: PERM.DASHBOARD,    icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>' },
  { path: '/admin/checkins',     labelKey: 'admin.checkins',     perm: PERM.CHECKINS,     icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
  { path: '/admin/transactions', labelKey: 'admin.transactions', perm: PERM.TRANSACTIONS, icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
  { path: '/admin/cashbook',     labelKey: 'admin.cashbook',     perm: PERM.CASHBOOK,     icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M2.25 5.25v13.5m18-13.5v13.5m-18 0a3 3 0 003 3h12a3 3 0 003-3M2.25 5.25a3 3 0 013-3h12a3 3 0 013 3M12 11.25a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/></svg>' },
  { path: '/admin/refunds',      labelKey: 'admin.refunds',      perm: PERM.REFUNDS,      icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/></svg>' },
  { path: '/admin/vouchers',     labelKey: 'admin.vouchers',     perm: PERM.VOUCHERS,     icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z"/></svg>' },
  { path: '/admin/promotions',   labelKey: 'admin.promotions',   perm: PERM.PROMOTIONS,   icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.34 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' },
  { path: '/admin/capacity',     labelKey: 'admin.capacity',     perm: PERM.CAPACITY,     icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>' },
  { path: '/admin/pricing',      labelKey: 'admin.pricing',      perm: PERM.PRICING,      icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>' },
  { path: '/admin/shuttle',      labelKey: 'admin.shuttle',      perm: PERM.SHUTTLE,      icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M21 14.25h-.008"/></svg>' },
  { path: '/admin/reviews',      labelKey: 'admin.reviews',      perm: PERM.REVIEWS,      icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/></svg>' },
  { path: '/admin/users',        labelKey: 'admin.users',        perm: PERM.USERS,        icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>' },
  { path: '/admin/legal',        labelKey: 'admin.legal',        perm: PERM.LEGAL,        icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>' },
  { path: '/admin/help',         labelKey: 'admin.help',         perm: PERM.HELP,         icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"/></svg>' },
];

function visibleLinks() {
  const role = getUserProfile()?.role;
  return ADMIN_LINKS.filter((link) => hasPermission(role, link.perm));
}

function sidebarLinks(activePath) {
  return visibleLinks().map(link => {
    const isActive = link.path === activePath;
    return `<a href="${localePath(link.path)}" data-link class="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-mango text-charcoal' : 'text-white/50 hover:text-white/80 hover:bg-blueberry'}">
      ${link.icon}
      <span>${t(link.labelKey)}</span>
    </a>`;
  }).join('');
}

/**
 * Create a full admin page layout with sidebar, mobile nav, and content area.
 * Returns a DOM element. Wire mobile nav toggle with `initAdminNav(el)`.
 */
export function AdminLayout(activePath, contentHtml) {
  const activeLabel = ADMIN_LINKS.find(l => l.path === activePath)?.labelKey || 'admin.dashboard';

  return html`<div class="flex min-h-screen bg-frost">
    <!-- Sidebar -->
    <aside class="hidden md:flex w-64 bg-blueberry-deep flex-col shrink-0 sticky top-0 h-screen">
      <div class="p-6 border-b border-white/10">
        <a href="${localePath('/')}" data-link class="flex items-center gap-2.5">
          <img src="/images/logo.png" alt="ManGO Parking" class="w-9 h-9 object-contain" />
          <span class="text-white font-heading font-bold text-lg">${t('admin.mangoAdmin')}</span>
        </a>
      </div>
      <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
        ${sidebarLinks(activePath)}
      </nav>
      <div class="p-4 border-t border-white/10">
        <a href="${localePath('/')}" data-link class="flex items-center gap-2 text-white/40 hover:text-white/70 text-[14px] transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/></svg>
          ${t('admin.backToSite')}
        </a>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto">
      <!-- Mobile admin nav -->
      <div class="md:hidden bg-blueberry-deep">
        <div class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-2">
            <a href="${localePath('/')}" data-link class="shrink-0">
              <img src="/images/logo.png" alt="ManGO Parking" class="w-8 h-8 object-contain" />
            </a>
            <span class="text-white font-heading font-bold text-[15px]">${t('admin.mangoAdmin')}</span>
          </div>
          <button data-admin-nav-toggle class="flex items-center gap-1.5 bg-blueberry px-3 py-2 rounded-lg text-white text-[13px] font-medium transition-colors hover:bg-blueberry-hover">
            <span>${t(activeLabel)}</span>
            <svg data-chevron class="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
          </button>
        </div>
        <div class="hidden border-t border-white/10 px-3 py-2 space-y-0.5" data-admin-nav-dropdown>
          ${visibleLinks().map(link => {
            const isActive = link.path === activePath;
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-mango text-charcoal' : 'text-white/50 hover:text-white/80 hover:bg-blueberry'}">${t(link.labelKey)}</a>`;
          }).join('')}
        </div>
      </div>
      <div class="p-4 md:p-8">
      <div class="max-w-6xl mx-auto" data-admin-content>
        ${contentHtml}
      </div>
      </div>
    </main>
  </div>`;
}

/**
 * Wire the mobile nav toggle on an AdminLayout element.
 */
export function initAdminNav(pageEl) {
  const navToggle = pageEl.querySelector('[data-admin-nav-toggle]');
  const navDropdown = pageEl.querySelector('[data-admin-nav-dropdown]');
  if (navToggle && navDropdown) {
    navToggle.addEventListener('click', () => {
      navDropdown.classList.toggle('hidden');
      navToggle.querySelector('[data-chevron]').classList.toggle('rotate-180');
    });
  }
}
