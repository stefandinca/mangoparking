import ro from './ro.js';
import en from './en.js';

const locales = { ro, en };
let currentLocale = 'ro';
const listeners = [];

/**
 * Get current locale
 */
export function getLocale() {
  return currentLocale;
}

/**
 * Set locale and notify listeners
 */
export function setLocale(locale) {
  if (locale === currentLocale || !locales[locale]) return;
  currentLocale = locale;
  document.documentElement.lang = locale;
  listeners.forEach((fn) => fn(locale));
}

/**
 * Detect locale from URL path
 */
export function detectLocale(path) {
  if (path.startsWith('/en/') || path === '/en') {
    return 'en';
  }
  return 'ro';
}

/**
 * Subscribe to locale changes
 */
export function onLocaleChange(callback) {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx > -1) listeners.splice(idx, 1);
  };
}

/**
 * Translate a key with optional params
 * t('hero.badge', { count: 87 }) → "87 locuri disponibile acum"
 */
export function t(key, params = {}) {
  const keys = key.split('.');
  let value = locales[currentLocale];
  for (const k of keys) {
    if (value == null) return key;
    value = value[k];
  }
  if (value == null) return key;
  if (typeof value !== 'string') return value;
  // Interpolate {param}
  return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
}

/**
 * Get the localized path
 * localePath('/booking') → '/booking' for RO, '/en/booking' for EN
 */
export function localePath(path) {
  const clean = path.replace(/^\/(en|ro)/, '').replace(/^\/+/, '/') || '/';
  if (currentLocale === 'en') {
    return clean === '/' ? '/en' : `/en${clean}`;
  }
  return clean;
}

/**
 * Get the alternate locale path (for language switcher)
 */
export function altLocalePath(currentPath) {
  const stripped = currentPath.replace(/^\/(en|ro)/, '').replace(/^\/+/, '/') || '/';
  if (currentLocale === 'ro') {
    return stripped === '/' ? '/en' : `/en${stripped}`;
  }
  return stripped;
}

/**
 * Strip locale prefix from path
 */
export function stripLocale(path) {
  return path.replace(/^\/(en|ro)/, '').replace(/^\/+/, '/') || '/';
}
