// Site-wide floating WhatsApp button.
//
// Mounted once at boot from main.js, outside the #app container so it
// survives every route render. Hidden on admin routes — the router
// fires `app-rendered` after each navigation, which is when we re-evaluate
// visibility. Mobile already has a WhatsApp button in the Footer contact
// bar, so the FAB is desktop-only (md+) to avoid the duplicate.

import { CONTACT_PHONE } from '../../utils/constants.js';
import { t, onLocaleChange, stripLocale } from '../../i18n/index.js';
import { whatsappIcon } from '../widgets/icons.js';

const PHONE_DIGITS = CONTACT_PHONE.replace(/[^\d]/g, '');

let fab = null;

function isAdminRoute() {
  return stripLocale(window.location.pathname).startsWith('/admin');
}

function refresh() {
  if (!fab) return;
  // On admin routes, force-hide overriding the responsive md:flex.
  // Otherwise let the className do its job (hidden on mobile, flex on md+).
  if (isAdminRoute()) {
    fab.style.display = 'none';
  } else {
    fab.style.removeProperty('display');
  }
  fab.href = `https://wa.me/${PHONE_DIGITS}?text=${encodeURIComponent(t('whatsapp.message'))}`;
  fab.setAttribute('aria-label', t('whatsapp.label'));
}

export function mountWhatsAppFab() {
  if (fab) return fab;
  fab = document.createElement('a');
  fab.target = '_blank';
  fab.rel = 'noopener noreferrer';
  fab.className = [
    'fixed right-6 bottom-6 z-40',
    'hidden md:flex',
    'w-14 h-14 rounded-full',
    'bg-leaf hover:bg-leaf/90 text-white',
    'shadow-lg hover:shadow-xl',
    'items-center justify-center',
    'transition-all duration-200 hover:scale-105',
  ].join(' ');
  fab.innerHTML = whatsappIcon;
  document.body.appendChild(fab);

  refresh();
  window.addEventListener('app-rendered', refresh);
  window.addEventListener('popstate', refresh);
  onLocaleChange(refresh);
  return fab;
}
