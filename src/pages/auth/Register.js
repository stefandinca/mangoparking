import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { registerWithEmail, loginWithGoogle } from '../../firebase/auth.js';
import { ensureSignupVoucher } from '../../services/voucherService.js';
import { navigate } from '../../router/index.js';
import { updateMeta } from '../../utils/seo.js';
import { html } from '../../utils/dom.js';

const FIREBASE_ERROR_MAP = {
  'auth/invalid-email': 'auth.errors.invalidEmail',
  'auth/email-already-in-use': 'auth.errors.emailInUse',
  'auth/weak-password': 'auth.errors.weakPassword',
};

export default function Register(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro'
      ? 'Înregistrare — Mango Parking'
      : 'Register — Mango Parking',
    description: locale === 'ro'
      ? 'Creează un cont Mango Parking pentru a rezerva rapid și a accesa beneficii.'
      : 'Create a Mango Parking account to book quickly and access benefits.',
    lang: locale,
  });

  const page = html`<div>
    <div data-navbar></div>

    <section class="min-h-screen flex items-center justify-center pt-24 pb-16 px-6">
      <div class="w-full max-w-md">
        <div class="glass rounded-3xl p-8 md:p-10 shadow-lg">
          <!-- Header -->
          <div class="text-center mb-8">
            <img src="/images/logo.png" alt="Mango Parking" class="w-20 h-20 object-contain mx-auto mb-2" />
            <p class="text-dim text-[12px] tracking-wide mb-4">— safe &amp; smart parking —</p>
            <h1 class="font-heading text-2xl font-bold tracking-tight">${t('auth.register')}</h1>
          </div>

          <!-- Google button -->
          <button data-google-btn class="w-full flex items-center justify-center gap-3 bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3.5 rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md">
            <svg class="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" opacity=".7"/>
              <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" opacity=".5"/>
              <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" opacity=".8"/>
            </svg>
            ${t('auth.googleBtn')}
          </button>

          <!-- Divider -->
          <div class="flex items-center gap-4 my-6">
            <div class="flex-1 h-px bg-frost-deep"></div>
            <span class="text-dim text-[13px] font-medium uppercase tracking-wider">${t('auth.or')}</span>
            <div class="flex-1 h-px bg-frost-deep"></div>
          </div>

          <!-- Register form -->
          <form data-register-form class="space-y-4">
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.displayName')} *</label>
              <input type="text" name="displayName" required placeholder="${locale === 'ro' ? 'Ion Popescu' : 'John Doe'}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.email')} *</label>
              <input type="email" name="email" required placeholder="name@example.com" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.password')} *</label>
              <input type="password" name="password" required placeholder="••••••••" minlength="6" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.confirmPassword')} *</label>
              <input type="password" name="confirmPassword" required placeholder="••••••••" minlength="6" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>

            <!-- Error message -->
            <div data-error class="hidden text-danger text-[14px] text-center bg-danger/5 rounded-xl px-4 py-2.5"></div>

            <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-6 py-3.5 rounded-2xl transition-all duration-200 shadow-md hover:shadow-lg">
              ${t('auth.registerBtn')}
            </button>
          </form>

          <!-- Login link -->
          <p class="text-center text-dim text-[14px] mt-6">
            ${t('auth.hasAccount')} <a href="${localePath('/login')}" class="text-mango hover:text-mango-hover font-semibold transition-colors">${t('auth.loginLink')}</a>
          </p>
        </div>
      </div>
    </section>

    <div data-footer></div>
  </div>`;

  // Mount navbar and footer
  const navSlot = page.querySelector('[data-navbar]');
  navSlot.replaceWith(Navbar());

  const footerSlot = page.querySelector('[data-footer]');
  footerSlot.replaceWith(Footer());

  // Error display helper
  const errorEl = page.querySelector('[data-error]');
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }
  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  // Register form
  const form = page.querySelector('[data-register-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const displayName = form.displayName.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;

    // Client-side validation
    if (password !== confirmPassword) {
      showError(t('auth.errors.passwordMismatch'));
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await registerWithEmail(email, password, displayName);
      await ensureSignupVoucher().catch(() => {});
      navigate(localePath('/account'));
    } catch (err) {
      const key = FIREBASE_ERROR_MAP[err.code] || 'auth.errors.invalidEmail';
      showError(t(key));
      btn.disabled = false;
      btn.textContent = t('auth.registerBtn');
    }
  });

  // Google sign-up
  const googleBtn = page.querySelector('[data-google-btn]');
  googleBtn.addEventListener('click', async () => {
    clearError();
    try {
      await loginWithGoogle();
      await ensureSignupVoucher().catch(() => {});
      navigate(localePath('/account'));
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        const key = FIREBASE_ERROR_MAP[err.code] || 'auth.errors.invalidEmail';
        showError(t(key));
      }
    }
  });

  container.appendChild(page);
}
