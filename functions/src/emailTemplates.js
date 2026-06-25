// Brevo template ID map.
//
// Each .html file in /email-templates/ corresponds to one Brevo template.
// After pasting a file into Brevo's HTML editor and saving, Brevo assigns
// a numeric ID — drop that ID here against the matching name.
//
// The Cloud Functions never reference templates by file name; they use the
// numeric IDs in this map. To rotate a template (e.g. seasonal copy), edit
// it in Brevo and the ID stays the same — no code change needed. Replacing
// an entire template is a Brevo-side action; only update the ID here if
// you actually deleted + recreated.
//
// Resolve by name + locale: `templateId('signup-welcome', 'ro')`.
// Falls back to RO when an EN template is missing (or vice-versa) so a
// missing locale never blocks the send.

const TEMPLATES = {
  // Account
  'signup-welcome-ro':              4,   
  'signup-welcome-en':              5,
  'password-reset-ro':              6,
  'password-reset-en':              7,
  'admin-invite-ro':                8,
  'admin-invite-en':                1,

  // Reservations
  'booking-longterm-confirm-ro':    2,
  'booking-longterm-confirm-en':    9,
  'booking-refunded-ro':            22,
  'booking-refunded-en':            21,

  // Credit packs
  'credit-purchase-ro':             3,
  'credit-purchase-en':             10,
  'credit-used-ro':                 11,
  'credit-used-en':                 12,
  'low-credit-warning-ro':          13,
  'low-credit-warning-en':          14,

  // Vouchers — paste email-templates/voucher-assigned-*.html into Brevo, then
  // drop the numeric IDs here. Until set, the send skips gracefully.
  'voucher-assigned-ro':            23,
  'voucher-assigned-en':            24,
  // Credit gift vouchers — paste email-templates/credit-voucher-assigned-*.html
  // into Brevo and drop the numeric IDs here. Until set, the credit-voucher
  // assignment email falls back to the generic 'voucher-assigned' template
  // (see emails.js onPromoVoucherAssigned).
  'credit-voucher-assigned-ro':     null,
  'credit-voucher-assigned-en':     null,

  // Reminders (scheduled)
  'reminder-checkin-24h-ro':        15,
  'reminder-checkin-24h-en':        16,
  'reminder-checkout-24h-ro':       17,
  'reminder-checkout-24h-en':       18,
  'reminder-commuter-7pm-ro':       19,
  'reminder-commuter-7pm-en':       20,
};

export function templateId(name, locale = 'ro') {
  const primary = TEMPLATES[`${name}-${locale}`];
  if (primary != null) return primary;
  // Fallback to the other locale so a missing template never blocks a send.
  const fallback = locale === 'ro'
    ? TEMPLATES[`${name}-en`]
    : TEMPLATES[`${name}-ro`];
  return fallback ?? null;
}

export function listMissing() {
  return Object.entries(TEMPLATES)
    .filter(([, id]) => id == null)
    .map(([name]) => name);
}
