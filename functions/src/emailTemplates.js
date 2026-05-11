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
  'signup-welcome-ro':              null,   // TODO: set Brevo ID
  'signup-welcome-en':              null,
  'password-reset-ro':              null,
  'password-reset-en':              null,
  'admin-invite-ro':                null,
  'admin-invite-en':                null,

  // Reservations
  'booking-longterm-confirm-ro':    null,
  'booking-longterm-confirm-en':    null,

  // Credit packs
  'credit-purchase-ro':             null,
  'credit-purchase-en':             null,
  'credit-used-ro':                 null,
  'credit-used-en':                 null,
  'low-credit-warning-ro':          null,
  'low-credit-warning-en':          null,

  // Reminders (scheduled)
  'reminder-checkin-24h-ro':        null,
  'reminder-checkin-24h-en':        null,
  'reminder-checkout-24h-ro':       null,
  'reminder-checkout-24h-en':       null,
  'reminder-commuter-7pm-ro':       null,
  'reminder-commuter-7pm-en':       null,
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
