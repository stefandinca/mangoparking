/**
 * Convert short locale to Intl locale string
 */
export function intlLocale(locale) {
  return locale === 'ro' ? 'ro-RO' : 'en-GB';
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
