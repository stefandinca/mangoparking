/**
 * Convert short locale to Intl locale string
 */
export function intlLocale(locale) {
  return locale === 'ro' ? 'ro-RO' : 'en-GB';
}

// ── Europe/Bucharest wall-clock ↔ instant ────────────────────────────────
// Bookings are FOR the lot in Otopeni, so a picked "10:00" always means
// 10:00 Romanian time — regardless of the timezone of the device making the
// booking. Every path converting a flatpickr wall-clock value ('Y-m-d H:i')
// to a stored ISO instant, and back when prefilling a picker, must use these
// two helpers: going through the device timezone instead shifts the booking
// by the TZ delta for customers abroad or staff devices with a mis-set clock.

const BUCHAREST_TZ = 'Europe/Bucharest';

// UTC offset (minutes) of Europe/Bucharest at a given instant (DST-aware).
function bucharestOffsetMinutes(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: BUCHAREST_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const hour = +p.hour === 24 ? 0 : +p.hour;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * 'YYYY-MM-DD HH:MM' (space or 'T' separator; time optional) understood as
 * Europe/Bucharest wall-clock → full ISO instant. Returns null when
 * unparseable. Also the Safari-safe way to parse picker values (WebKit
 * rejects the space-separated form in `new Date()`).
 */
export function bucharestLocalToIso(localValue) {
  if (!localValue) return null;
  const m = String(localValue).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // Two passes so wall-clock values right after a DST switch resolve with
  // the offset in force at the actual instant, not at the naive guess.
  let off = bucharestOffsetMinutes(new Date(guessUtc));
  off = bucharestOffsetMinutes(new Date(guessUtc - off * 60000));
  return new Date(guessUtc - off * 60000).toISOString();
}

/**
 * ISO instant (or a legacy date-only 'YYYY-MM-DD', taken as Bucharest
 * midnight) → 'YYYY-MM-DD HH:MM' Europe/Bucharest wall-clock — the exact
 * format flatpickr stores with dateFormat 'Y-m-d H:i'. '' when unparseable.
 */
export function isoToBucharestLocal(iso) {
  if (!iso) return '';
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? bucharestLocalToIso(iso) : iso;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE renders 'YYYY-MM-DD HH:MM' with hour12 off and a space separator.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: BUCHAREST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace('T', ' ');
}

/**
 * Format a date for display
 */
export function formatDate(date, locale = 'ro') {
  return new Date(date).toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format time (HH:MM)
 */
export function formatTime(date, locale = 'ro') {
  return new Date(date).toLocaleTimeString(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Calculate days between two dates
 */
export function daysBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Check if a date is today
 */
export function isToday(date) {
  const d = new Date(date);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

/**
 * Get relative time string
 */
export function timeAgo(date, locale = 'ro') {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  const intervals = [
    { label: locale === 'ro' ? 'an' : 'year', seconds: 31536000 },
    { label: locale === 'ro' ? 'lună' : 'month', seconds: 2592000 },
    { label: locale === 'ro' ? 'zi' : 'day', seconds: 86400 },
    { label: locale === 'ro' ? 'oră' : 'hour', seconds: 3600 },
    { label: locale === 'ro' ? 'min' : 'min', seconds: 60 },
  ];
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return locale === 'ro'
        ? `acum ${count} ${interval.label}${count > 1 ? (interval.label === 'lună' ? 'i' : '') : ''}`
        : `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
    }
  }
  return locale === 'ro' ? 'chiar acum' : 'just now';
}
