import './style.css';
import { initRouter } from './router/index.js';
import { detectLocale, setLocale } from './i18n/index.js';
import { seedDatabase } from './seed.js';
import { loginWithGoogle, onAuthChange } from './firebase/auth.js';
import { mountWhatsAppFab } from './components/core/WhatsAppFab.js';

// Expose seed function globally for console use
window.seedDatabase = seedDatabase;

// Auto-seed if ?seed=true in URL — requires Google login first
const params = new URLSearchParams(window.location.search);
if (params.get('seed') === 'true') {
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center">
        <h1 class="font-heading text-2xl font-bold mb-4">Database Seed</h1>
        <p class="text-dim mb-6" id="seed-status">Sign in with Google first, then we'll seed the database.</p>
        <button id="seed-login" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold px-8 py-3 rounded-2xl transition-colors">Sign in with Google & Seed</button>
      </div>
    </div>
  `;
  document.getElementById('seed-login').addEventListener('click', async () => {
    const statusEl = document.getElementById('seed-status');
    const btnEl = document.getElementById('seed-login');
    try {
      statusEl.textContent = 'Signing in...';
      btnEl.disabled = true;
      await loginWithGoogle();
      statusEl.textContent = 'Signed in! Seeding database...';
      await seedDatabase();
      statusEl.textContent = '✅ Seed complete! Redirecting...';
      setTimeout(() => {
        window.history.replaceState(null, '', '/');
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error(err);
      statusEl.textContent = '❌ Error: ' + err.message;
      btnEl.disabled = false;
    }
  });
} else {
  // Initialize locale from URL
  const locale = detectLocale(window.location.pathname);
  setLocale(locale);

  // Initialize router
  initRouter();

  // Site-wide WhatsApp floating button (hidden on /admin/*).
  mountWhatsAppFab();
}
