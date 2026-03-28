import { html } from '../../utils/dom.js';
import { t, localePath } from '../../i18n/index.js';

const ADMIN_LINKS = [
  { path: '/admin', labelKey: 'admin.dashboard', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>' },
  { path: '/admin/bookings', labelKey: 'admin.bookings', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>' },
  { path: '/admin/capacity', labelKey: 'admin.capacity', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/></svg>' },
  { path: '/admin/pricing', labelKey: 'admin.pricing', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"/></svg>' },
  { path: '/admin/shuttle', labelKey: 'admin.shuttle', icon: '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h.008M21 14.25h-.008"/></svg>' },
  // MVP: reports and audit hidden
];

function sidebarLinks(activePath) {
  return ADMIN_LINKS.map(link => {
    const isActive = link.path === activePath;
    return `<a href="${localePath(link.path)}" data-link class="flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-colors duration-150 ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">
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
    <aside class="hidden md:flex w-64 bg-charcoal flex-col shrink-0 sticky top-0 h-screen">
      <div class="p-6 border-b border-white/10">
        <a href="${localePath('/')}" data-link class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-mango flex items-center justify-center">
            <span class="text-white font-bold text-sm">M</span>
          </div>
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
      <div class="md:hidden bg-charcoal">
        <div class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-2">
            <a href="${localePath('/')}" data-link class="w-7 h-7 rounded-lg bg-mango flex items-center justify-center shrink-0">
              <span class="text-white font-bold text-xs">M</span>
            </a>
            <span class="text-white font-heading font-bold text-[15px]">${t('admin.mangoAdmin')}</span>
          </div>
          <button data-admin-nav-toggle class="flex items-center gap-1.5 bg-white/10 px-3 py-2 rounded-lg text-white text-[13px] font-medium transition-colors hover:bg-white/15">
            <span>${t(activeLabel)}</span>
            <svg data-chevron class="w-4 h-4 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
          </button>
        </div>
        <div class="hidden border-t border-white/10 px-3 py-2 space-y-0.5" data-admin-nav-dropdown>
          ${ADMIN_LINKS.map(link => {
            const isActive = link.path === activePath;
            return `<a href="${localePath(link.path)}" data-link class="block px-4 py-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}">${t(link.labelKey)}</a>`;
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
