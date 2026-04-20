export const TOTAL_CAPACITY = 110;
export const SITE_NAME = 'Mango Parking';
export const SITE_TAGLINE = 'safe & smart parking';
export const SITE_URL = 'https://mangoparking.ro';
export const LOGO_MASCOT = '/images/logo.png';
export const LOGO_FULL = '/images/logo-full.jpeg';

// ── Contact (public, operating location — the parking lot itself) ──
// Corbeanca is adjacent to Otopeni (~5 km from Henri Coandă Airport); site copy
// still references "Aeroportul Otopeni" as the destination served via shuttle.
export const CONTACT_PHONE = '+40 740 075 380';
export const CONTACT_EMAIL = 'stefan.florea@triorentacar.ro';
export const CONTACT_ADDRESS = 'Strada Radarului nr. 1, Corbeanca, jud. Ilfov';

// ── Legal identifiers (displayed by Netopia/ANPC requirement) ──
// Operator of record — source of truth for Terms/Privacy/GDPR/Delivery/Cancellation and Footer.
// Registered address is in Bacău; the parking itself operates in Otopeni (see CONTACT_ADDRESS).
export const COMPANY_LEGAL_NAME = 'TRIO SERVICES COMPACT SRL';
export const CUI = 'RO32705476';
export const REG_COM = 'J04/79/2014';
export const COMPANY_ADDRESS = 'Str. Castanilor, Nr.1, Sc.B, Ap.13, Bacău, Jud. Bacău';
export const DPO_EMAIL = 'gdpr@mangoparking.ro'; // TODO(launch): dedicated DPO mailbox
export const ANPC_SAL_URL = 'https://anpc.ro/ce-este-sal/';
export const ANPC_SOL_URL = 'https://consumer-redress.ec.europa.eu/index_en';
// Address-based embed — works without an API key and auto-tracks the address string.
export const GOOGLE_MAPS_EMBED = 'https://maps.google.com/maps?q=' + encodeURIComponent('Strada Radarului 1, Corbeanca, Ilfov') + '&output=embed';

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
