export const TOTAL_CAPACITY = 110;
export const SITE_NAME = 'Mango Parking';
export const SITE_TAGLINE = 'safe & smart parking';
export const SITE_URL = 'https://mangoparking.ro';
export const LOGO_MASCOT = '/images/logo.png';
export const LOGO_FULL = '/images/logo-full.jpeg';

// ── Contact (public, operating location — Otopeni parking) ──
export const CONTACT_PHONE = '+40 721 000 000'; // TODO(launch): publish real support line
export const CONTACT_EMAIL = 'contact@mangoparking.ro'; // TODO(launch): confirm MX + mailbox is live
export const CONTACT_ADDRESS = 'Str. Exemplu 42, Otopeni, Ilfov'; // TODO(launch): real street/number of the parking lot

// ── Legal identifiers (displayed by Netopia/ANPC requirement) ──
// Operator of record — source of truth for Terms/Privacy/GDPR/Delivery/Cancellation and Footer.
// Registered address is in Bacău; the parking itself operates in Otopeni (see CONTACT_ADDRESS).
export const COMPANY_LEGAL_NAME = 'TRIO SERVICES COMPACT SRL';
export const CUI = 'RO32705476';
export const REG_COM = 'J04/79/2014';
export const COMPANY_ADDRESS = 'Str. Castanilor, Nr.1, Sc.B, Ap.13, Bacău, Jud. Bacău';
export const DPO_EMAIL = 'gdpr@mangoparking.ro'; // TODO(launch): dedicated DPO mailbox
export const ANPC_SAL_URL = 'https://anpc.ro/ce-este-sal/';
export const ANPC_SOL_URL = 'https://ec.europa.eu/consumers/odr/';
export const GOOGLE_MAPS_EMBED = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2843.8!2d26.085!3d44.572!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDTCsDM0JzE5LjIiTiAyNsKwMDUnMDYuMCJF!5e0!3m2!1sen!2sro!4v1';

export const LOYALTY_TIERS = {
  bronze: { min: 0, max: 499, discount: 0, label: 'Bronze' },
  silver: { min: 500, max: 999, discount: 5, label: 'Silver' },
  gold: { min: 1000, max: Infinity, discount: 10, label: 'Gold' },
};

export const BOOKING_STATUSES = ['upcoming', 'active', 'completed', 'cancelled'];
export const SPOT_STATUSES = ['available', 'occupied', 'reserved', 'maintenance'];
export const ZONES = ['A', 'B', 'C', 'D'];

export const TOKEN_HOURS = { start: 6, end: 20 }; // 6AM–8PM
export const TOKEN_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
