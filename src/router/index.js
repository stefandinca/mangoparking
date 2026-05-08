import { routes } from './routes.js';
import { checkGuards } from './guards.js';
import { detectLocale, setLocale, stripLocale, getLocale } from '../i18n/index.js';
import { qs } from '../utils/dom.js';

let currentCleanup = null;
let currentPath = '';

/**
 * Initialize router
 */
export function initRouter() {
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
    e.preventDefault();
    navigate(href);
  });

  // Handle redirect param (from 404.html)
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  if (redirect) {
    window.history.replaceState(null, '', redirect);
    handleRoute(redirect);
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
