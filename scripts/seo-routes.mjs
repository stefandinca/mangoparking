// Per-route SEO data — the single source for the no-browser prerender
// (scripts/prerender.mjs). Titles/descriptions mirror each public page's
// updateMeta() call. EN variants live at /en + path. Keep in sync with the
// pages when their SEO copy changes (SEO copy changes rarely).

export const SITE_URL = process.env.SITE_URL || 'https://www.mangoparking.ro';

// Homepage structured data — mirrors Home.js setStructuredData().
const HOME_JSONLD = {
  '@context': 'https://schema.org',
  '@type': ['ParkingFacility', 'LocalBusiness'],
  name: 'ManGO Parking',
  description: 'Secure daily parking near Otopeni Airport with free shuttle service. Flexible credit system.',
  url: SITE_URL,
  telephone: '+40 769 064 721',
  email: 'rezervari@mangoparking.ro',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Strada Radarului nr. 1',
    addressLocality: 'Corbeanca',
    addressRegion: 'Ilfov',
    addressCountry: 'RO',
  },
  geo: { '@type': 'GeoCoordinates', latitude: 44.618, longitude: 26.084 },
  openingHoursSpecification: {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '00:00', closes: '23:59',
  },
  priceRange: '29-49 RON/day',
  amenityFeature: [
    { '@type': 'LocationFeatureSpecification', name: 'Free Shuttle', value: true },
  ],
};

// Each entry: RO path + per-locale title/description. The EN page is /en+path.
export const ROUTES = [
  {
    path: '/',
    jsonld: HOME_JSONLD,
    ro: {
      title: 'ManGO Parking — Parcare Aeroport Otopeni | Credite Parcare Zilnică & Microbuz',
      description: 'Parcare securizată lângă Aeroportul Henri Coandă Otopeni. Cumpără credite, parchează flexibil. Microbuz gratuit, acces cu barieră.',
    },
    en: {
      title: 'ManGO Parking — Otopeni Airport Parking | Daily Parking Credits & Shuttle',
      description: 'Secure parking near Henri Coandă Otopeni Airport. Buy credits, park flexibly. Free shuttle, gated access.',
    },
  },
  {
    path: '/pricing',
    ro: { title: 'Tarife — ManGO Parking', description: 'Tarife parcare aeroport pe tranșe și parcare navetiști la Aeroportul Otopeni.' },
    en: { title: 'Pricing — ManGO Parking', description: 'Airport parking tiered rates and commuter credits at Otopeni Airport.' },
  },
  {
    path: '/about',
    ro: { title: 'Despre Noi — ManGO Parking', description: 'Despre ManGO Parking — parcare securizată lângă Aeroportul Otopeni cu microbuz gratuit și acces cu barieră.' },
    en: { title: 'About Us — ManGO Parking', description: 'About ManGO Parking — secure parking near Otopeni Airport with free shuttle and gated access.' },
  },
  {
    path: '/contact',
    ro: { title: 'Contact — ManGO Parking', description: 'Contactează ManGO Parking. Telefon, email și indicații către parcarea noastră de lângă Aeroportul Otopeni.' },
    en: { title: 'Contact — ManGO Parking', description: 'Contact ManGO Parking. Phone, email, and directions to our parking near Otopeni Airport.' },
  },
  {
    path: '/shuttle',
    ro: { title: 'Program Shuttle — ManGO Parking', description: 'Microbuz gratuit ManGO Parking, la cerere — te ducem la aeroport și la gară când sosești.' },
    en: { title: 'Shuttle Schedule — ManGO Parking', description: 'Free ManGO Parking shuttle, on demand — we take you to the airport and train station when you arrive.' },
  },
  {
    path: '/promotions',
    ro: { title: 'Promoții — ManGO Parking', description: 'Oferte și promoții la parcarea ManGO de lângă Aeroportul Otopeni.' },
    en: { title: 'Promotions — ManGO Parking', description: 'Deals and promotions at ManGO Parking near Otopeni Airport.' },
  },
  {
    path: '/booking/credits',
    ro: { title: 'Cumpără Credite — ManGO Parking', description: 'Cumpără credite de parcare la Aeroportul Otopeni. Plată online, microbuz gratuit.' },
    en: { title: 'Buy Credits — ManGO Parking', description: 'Buy parking credits at Otopeni Airport. Pay online, free shuttle included.' },
  },
  {
    path: '/booking/long-term',
    ro: { title: 'Parcare de lungă durată — ManGO Parking', description: 'Rezervă parcare de lungă durată la Aeroportul Otopeni. Microbuz gratuit, acces cu barieră.' },
    en: { title: 'Long-term parking — ManGO Parking', description: 'Book long-term parking at Otopeni Airport. Free shuttle, gated access.' },
  },
  {
    path: '/booking',
    ro: { title: 'Rezervă parcare — ManGO Parking', description: 'Alege parcare cu credite zilnice sau de lungă durată la Aeroportul Otopeni.' },
    en: { title: 'Book parking — ManGO Parking', description: 'Choose daily credits or long-term parking at Otopeni Airport.' },
  },
];
