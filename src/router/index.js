import { routes } from './routes.js';
import { checkGuards } from './guards.js';
import { detectLocale, setLocale, stripLocale, getLocale } from '../i18n/index.js';
import { qs } from '../utils/dom.js';
import { authReady } from '../firebase/auth.js';

let currentCleanup = null;
let currentPath = '';

/**
 * Initialize router
 */
export async function initRouter() {
  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    handleRoute(window.location.pathname);
  });

  // Intercept link clicks for SPA navigation
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    // Skip external links, hash links, and special links
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;
    // Let the browser handle file downloads natively. A `download` anchor (e.g.
    // CSV export) or a blob: URL must not be routed — pushState to a blob: URL
    // throws a SecurityError, and preventDefault would swallow the download.
    if (link.hasAttribute('download') || href.startsWith('blob:')) return;
    // Honor target="_blank" / target="_new" — letting the browser do its
    // thing means legal-page links in the booking flow open in a new tab
    // instead of replacing the in-progress booking page.
    if (link.target && link.target !== '_self') return;
    // Honor modifier-key new-tab gestures (ctrl/cmd-click, middle-click).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
    e.preventDefault();
    navigate(href);
  });

  // Block the initial dispatch until Firebase Auth has rehydrated the
  // persisted session — otherwise guards see currentUser=null on hard
  // refresh and bounce the user to /login. Subsequent in-app navigations
  // skip this wait (the promise is already resolved).
  const app = qs('#app');
  if (app) {
    app.innerHTML = '<div class="min-h-screen flex items-center justify-center"><div class="animate-pulse text-dim">Loading...</div></div>';
  }
  try {
    await authReady;
  } catch (_) { /* fall through — guards will run with whatever state we have */ }

  // Handle redirect param (from 404.html). Reject protocol-relative or
  // absolute external targets to close an open-redirect surface.
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  const safeRedirect = redirect && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : null;
  if (safeRedirect) {
    window.history.replaceState(null, '', safeRedirect);
    handleRoute(safeRedirect);
  } else {
    handleRoute(window.location.pathname);
  }
}

/**
 * Navigate to a path
 */
export function navigate(path, replace = false) {
  if (path === currentPath) return;
  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  handleRoute(path);
}

/**
 * Handle route change
 */
async function handleRoute(fullPath) {
  currentPath = fullPath;

  // Normalize the path before matching:
  //   - strip query string + hash (404.html's ?redirect=… handoff and
  //     Netopia's return URL both carry query strings)
  //   - strip trailing slash (nginx on Plesk 301s /booking/return →
  //     /booking/return/, our routes are declared without trailing slash)
  // Routes are declared without queries/hashes/trailing-slashes so an
  // exact-equality match would otherwise fall through to 404 → home.
  const pathOnly = (fullPath.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/');

  // Detect and set locale from path
  const locale = detectLocale(pathOnly);
  setLocale(locale);

  // Strip locale prefix to match route
  const path = stripLocale(pathOnly);

  // Find matching route
  const route = routes.find((r) => r.path === path);

  if (!route) {
    // 404 — show home page
    navigate(getLocale() === 'en' ? '/en' : '/', true);
    return;
  }

  // Check guards
  const redirect = checkGuards(route.guards);
  if (redirect) {
    navigate(redirect, true);
    return;
  }

  // Cleanup previous page
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  // Show loading
  const app = qs('#app');
  app.innerHTML = '<div class="min-h-screen flex items-center justify-center"><div class="animate-pulse text-dim">Loading...</div></div>';

  try {
    // Lazy load the page module
    const module = await route.component();
    const page = module.default;

    // Clear and render
    app.innerHTML = '';
    const result = await page(app);

    // Store cleanup function if returned
    if (typeof result === 'function') {
      currentCleanup = result;
    }

    // Add page transition class
    app.firstElementChild?.classList.add('page-enter');

    // Scroll to top
    window.scrollTo(0, 0);

    // Fire rendered event for SEO pre-renderer
    window.dispatchEvent(new CustomEvent('app-rendered'));
  } catch (err) {
    console.error('Route error:', err);
    app.innerHTML = `<div class="min-h-screen flex items-center justify-center"><p class="text-danger">Error loading page</p></div>`;
  }
}

/**
 * Get current path (without locale)
 */
export function getCurrentPath() {
  return stripLocale(window.location.pathname);
}
