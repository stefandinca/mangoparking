import { html } from '../../utils/dom.js';
import { t, localePath, altLocalePath, getLocale } from '../../i18n/index.js';
import { getCurrentUser, getUserProfile, logout } from '../../firebase/auth.js';
import { navigate, getCurrentPath } from '../../router/index.js';

export function Navbar() {
  const user = getCurrentUser();
  const profile = getUserProfile();
  const isAdminUser = profile?.role === 'admin' || profile?.role === 'staff';
  const currentFullPath = window.location.pathname;
  const altPath = altLocalePath(currentFullPath);
  const langSwitch = t('langSwitch');

  const el = html`
    <nav class="fixed top-0 w-full z-50">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
        <div class="glass-strong rounded-2xl px-4 sm:px-6 h-14 flex items-center justify-between shadow-sm">
          <a href="${localePath('/')}" class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-mango flex items-center justify-center shadow-sm">
              <span class="text-white font-heading font-bold text-sm">M</span>
            </div>
            <span class="font-heading font-bold text-[16px] tracking-tight">Mango Parking</span>
          </a>
          <div class="hidden md:flex items-center gap-8 text-[14px] font-medium text-charcoal/40">
            <a href="${localePath('/')}" class="hover:text-charcoal transition-colors duration-200">${t('nav.howItWorks')}</a>
            <a href="${localePath('/pricing')}" class="hover:text-charcoal transition-colors duration-200">${t('nav.pricing')}</a>
            <a href="${localePath('/shuttle')}" class="hover:text-charcoal transition-colors duration-200">${t('nav.shuttle')}</a>
            <a href="${localePath('/about')}" class="hover:text-charcoal transition-colors duration-200">${t('nav.faq')}</a>
          </div>
          <div class="flex items-center gap-3">
            <a href="${altPath}" class="text-[12px] font-mono text-charcoal/30 hover:text-charcoal/60 transition-colors px-2 py-1 rounded-lg border border-transparent hover:border-frost-deep" data-lang-switch>${langSwitch}</a>
            ${user
              ? `<div class="flex items-center gap-2">
                  ${isAdminUser ? `<a href="${localePath('/admin')}" class="text-[13px] text-mango font-medium hover:text-mango-hover transition-colors">${t('nav.admin')}</a>` : ''}
                  <a href="${localePath('/account')}" class="text-[13px] text-charcoal/50 font-medium hover:text-charcoal transition-colors">${t('nav.account')}</a>
                  <button data-logout class="text-[13px] text-charcoal/30 hover:text-charcoal/50 transition-colors">${t('account.logout')}</button>
                </div>`
              : `<a href="${localePath('/login')}" class="text-[13px] text-charcoal/50 font-medium hover:text-charcoal transition-colors hidden sm:block">${t('nav.login')}</a>`
            }
            <a href="${localePath('/booking')}" class="hidden sm:inline-block bg-charcoal hover:bg-charcoal/85 text-white text-[14px] font-semibold px-5 py-2 rounded-xl transition-all duration-200 shadow-sm">${t('nav.bookNow')}</a>
            <button data-mobile-toggle class="md:hidden text-charcoal/60 hover:text-charcoal">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Mobile menu -->
      <div class="mobile-nav fixed inset-0 bg-white/95 backdrop-blur-xl z-50 pt-20 px-8 hidden" data-mobile-menu>
        <button data-mobile-close class="absolute top-6 right-6 p-2 text-charcoal/40 hover:text-charcoal">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <div class="space-y-1 text-lg font-heading font-semibold">
          <a href="${localePath('/')}" class="block py-3 px-2">${t('nav.howItWorks')}</a>
          <a href="${localePath('/pricing')}" class="block py-3 px-2">${t('nav.pricing')}</a>
          <a href="${localePath('/shuttle')}" class="block py-3 px-2">${t('nav.shuttle')}</a>
          <a href="${localePath('/commuter')}" class="block py-3 px-2">Commuter</a>
          <a href="${localePath('/about')}" class="block py-3 px-2">${t('nav.faq')}</a>
          <a href="${localePath('/contact')}" class="block py-3 px-2">${t('footer.contact')}</a>
          <hr class="border-frost-deep">
          ${user
            ? `${isAdminUser ? `<a href="${localePath('/admin')}" class="block py-3 px-2">${t('nav.admin')}</a>` : ''}
               <a href="${localePath('/account')}" class="block py-3 px-2">${t('nav.account')}</a>`
            : `<a href="${localePath('/login')}" class="block py-3 px-2">${t('nav.login')}</a>`
          }
          <a href="${localePath('/booking')}" class="block py-3 px-2 text-mango">${t('nav.bookNow')}</a>
        </div>
      </div>
    </nav>
  `;

  // Mobile menu toggle
  const mobileToggle = el.querySelector('[data-mobile-toggle]');
  const mobileMenu = el.querySelector('[data-mobile-menu]');
  const mobileClose = el.querySelector('[data-mobile-close]');

  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      mobileMenu.classList.remove('hidden');
      requestAnimationFrame(() => mobileMenu.classList.add('open'));
    });

    const closeMenu = () => {
      mobileMenu.classList.remove('open');
      setTimeout(() => mobileMenu.classList.add('hidden'), 300);
    };

    mobileClose?.addEventListener('click', closeMenu);
    mobileMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });
  }

  // Logout
  const logoutBtn = el.querySelector('[data-logout]');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logout();
      navigate(localePath('/'));
    });
  }

  return el;
}
