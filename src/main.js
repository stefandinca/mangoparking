import './style.css';
import { initRouter } from './router/index.js';
import { detectLocale, setLocale } from './i18n/index.js';
import { mountWhatsAppFab } from './components/core/WhatsAppFab.js';
import { onAuthChange } from './firebase/auth.js';
import { maybePromptProfileCompletion } from './components/account/ProfileCompletionModal.js';
import { installErrorLogging } from './utils/errorLog.js';

// First thing: uncaught errors / rejections → clientErrors collection
// (in-house monitoring, capped + deduped — see utils/errorLog.js).
installErrorLogging();

// NOTE: the one-time database seeding tool (src/seed.js, gitignored) has been
// de-wired from the app. The site runs on live data, so an in-app `?seed=true`
// path would be a footgun (re-seeding could overwrite/duplicate real records).
// If you ever need to seed a fresh Firebase project, run seed.js from local
// dev (it still exists on the dev machine).

// Initialize locale from the URL (/en/... = EN, else RO).
const locale = detectLocale(window.location.pathname);
setLocale(locale);

// Initialize the History-API router + guards.
initRouter();

// Site-wide WhatsApp floating button (hidden on /admin/*).
mountWhatsAppFab();

// On login / session-restore, prompt incomplete customers to complete their
// profile (name, phone, plate, billing) with a blocking modal before they can
// book. Fires on every auth change; the guard no-ops for staff, guests, and
// already-complete profiles.
onAuthChange((user, profile) => maybePromptProfileCompletion(user, profile));
