import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { loginWithEmail, loginWithGoogle } from '../../firebase/auth.js';
import { mergeGuestDataForCurrentUser } from '../../services/userMergeService.js';
import { navigate } from '../../router/index.js';
import { updateMeta } from '../../utils/seo.js';
import { html, qs } from '../../utils/dom.js';
import { showToast } from '../../components/core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { isValidEmail } from '../../utils/validators.js';

const requestPasswordResetFn = httpsCallable(functions, 'requestPasswordReset');

const FIREBASE_ERROR_MAP = {
  'auth/invalid-email': 'auth.errors.invalidEmail',
  'auth/wrong-password': 'auth.errors.wrongPassword',
  'auth/user-not-found': 'auth.errors.userNotFound',
  'auth/invalid-credential': 'auth.errors.wrongPassword',
  'auth/too-many-requests': 'auth.errors.wrongPassword',
};

export default function Login(container) {
  const locale = getLocale();

  updateMeta({
    title: locale === 'ro'
      ? 'Autentificare — ManGO Parking'
      : 'Login — ManGO Parking',
    description: locale === 'ro'
      ? 'Autentifică-te în contul tău ManGO Parking.'
      : 'Sign in to your ManGO Parking account.',
    lang: locale,
  });

  const page = html`<div>
    <div data-navbar></div>

    <section class="min-h-screen flex items-center justify-center pt-24 pb-16 px-6">
      <div class="w-full max-w-md">
        <div class="glass rounded-3xl p-8 md:p-10 shadow-lg">
          <!-- Header -->
          <div class="text-center mb-8">
            <img src="/images/logo.png" alt="ManGO Parking" class="w-20 h-20 object-contain mx-auto mb-2" />
            <p class="text-dim text-[12px] tracking-wide mb-4">— safe &amp; smart parking —</p>
            <h1 class="font-heading text-2xl font-bold tracking-tight">${t('auth.login')}</h1>
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

          <!-- Email form -->
          <form data-login-form class="space-y-4">
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.email')} *</label>
              <input type="email" name="email" required placeholder="name@example.com" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('auth.password')} *</label>
              <input type="password" name="password" required placeholder="••••••••" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors">
            </div>

            <!-- Error message -->
            <div data-error class="hidden text-danger text-[14px] text-center bg-danger/5 rounded-xl px-4 py-2.5"></div>

            <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] px-6 py-3.5 rounded-2xl transition-all duration-200 shadow-md hover:shadow-lg">
              ${t('auth.loginBtn')}
            </button>
          </form>

          <!-- Forgot password — collapses into an inline form -->
          <div class="text-center mt-4">
            <button type="button" data-forgot-toggle class="text-dim hover:text-charcoal text-[13px] underline transition-colors">${t('forgot.link')}</button>
          </div>

          <div data-forgot-panel class="hidden mt-4 p-4 rounded-2xl bg-frost border border-frost-deep">
            <p class="text-[13px] text-charcoal/70 mb-3">${t('forgot.hint')}</p>
            <form data-forgot-form class="space-y-3">
              <input name="email" type="email" required placeholder="${t('forgot.emailLabel')}" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
              <div data-forgot-msg class="text-[13px] min-h-[1em]"></div>
              <div class="flex gap-2 justify-end">
                <button type="button" data-forgot-cancel class="px-4 py-2 rounded-xl bg-white text-charcoal/70 font-semibold text-[13px] hover:bg-frost-deep transition-colors border border-frost-deep">${t('forgot.cancel')}</button>
                <button type="submit" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[13px] px-4 py-2 rounded-xl transition-colors">${t('forgot.submit')}</button>
              </div>
            </form>
          </div>

          <!-- Register link -->
          <p class="text-center text-dim text-[14px] mt-6">
            ${t('auth.noAccount')} <a href="${localePath('/register')}" class="text-mango hover:text-mango-hover font-semibold transition-colors">${t('auth.registerLink')}</a>
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
  function showError(code) {
    const key = FIREBASE_ERROR_MAP[code] || 'auth.errors.wrongPassword';
    errorEl.textContent = t(key);
    errorEl.classList.remove('hidden');
  }
  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  // Email login
  const form = page.querySelector('[data-login-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const email = form.email.value.trim();
    const password = form.password.value;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await loginWithEmail(email, password);
      // Reconcile any prior guest activity tied to this email — runs
      // best-effort, login still succeeds if it fails.
      await mergeGuestDataForCurrentUser();
      navigate(localePath('/account'));
    } catch (err) {
      showError(err.code);
      btn.disabled = false;
      btn.textContent = t('auth.loginBtn');
    }
  });

  // Forgot password toggle + submit
  const forgotToggle = qs('[data-forgot-toggle]', page);
  const forgotPanel = qs('[data-forgot-panel]', page);
  const forgotForm = qs('[data-forgot-form]', page);
  const forgotCancel = qs('[data-forgot-cancel]', page);
  const forgotMsg = qs('[data-forgot-msg]', page);

  forgotToggle.addEventListener('click', () => {
    forgotPanel.classList.toggle('hidden');
    if (!forgotPanel.classList.contains('hidden')) {
      forgotMsg.textContent = '';
      // Prefill from the login email if the user has typed it, then focus.
      const emailInput = forgotForm.querySelector('input[name=email]');
      if (form.email.value && !emailInput.value) emailInput.value = form.email.value;
      emailInput.focus();
    }
  });
  forgotCancel.addEventListener('click', () => forgotPanel.classList.add('hidden'));

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailVal = String(new FormData(forgotForm).get('email') || '').trim();
    if (!isValidEmail(emailVal)) {
      forgotMsg.textContent = t('forgot.error');
      forgotMsg.className = 'text-danger text-[13px] min-h-[1em]';
      return;
    }
    const btn = forgotForm.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await requestPasswordResetFn({ email: emailVal });
      forgotMsg.textContent = t('forgot.sent');
      forgotMsg.className = 'text-leaf text-[13px] min-h-[1em]';
      showToast(t('forgot.sent'), 'success');
    } catch (err) {
      console.error('requestPasswordReset', err);
      forgotMsg.textContent = t('forgot.error');
      forgotMsg.className = 'text-danger text-[13px] min-h-[1em]';
    } finally {
      btn.disabled = false;
      btn.textContent = t('forgot.submit');
    }
  });

  // Google login
  const googleBtn = page.querySelector('[data-google-btn]');
  googleBtn.addEventListener('click', async () => {
    clearError();
    try {
      await loginWithGoogle();
      await mergeGuestDataForCurrentUser();
      navigate(localePath('/account'));
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showError(err.code);
      }
    }
  });

  container.appendChild(page);
}
