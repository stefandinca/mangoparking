// /auth/finish-signup — landing page for admin-invite magic links.
//
// Flow:
//   1. Admin invites email X → adminSendInvite mints a sign-in-with-email
//      link pointing here.
//   2. User clicks the link in their inbox. The current URL contains the
//      magic-link query params Firebase Auth uses (apiKey, oobCode, mode=
//      signIn, lang, …) — we feed them to `signInWithEmailLink`.
//   3. Once signed in, finishInviteSignup stamps role + displayName from
//      pendingInvites/{email}.
//   4. We then prompt the user to set a password (so they can log in
//      next time without the magic link). Firebase requires a recent-
//      auth credential for updatePassword; we have that from the link
//      sign-in above.

import { html, qs } from '../../utils/dom.js';
import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { auth } from '../../firebase/config.js';
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
  updatePassword,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { navigate } from '../../router/index.js';
import { mergeGuestDataForCurrentUser } from '../../services/userMergeService.js';

const finishInviteSignupFn = httpsCallable(functions, 'finishInviteSignup');

const STORAGE_KEY = 'mango.invite.email';

export default function FinishSignup(container) {
  const locale = getLocale();
  updateMeta({
    title: `${t('finishSignup.title')} — ManGO Parking`,
    description: t('finishSignup.hint'),
    lang: locale,
  });

  const page = html`<div>
    <div data-navbar></div>
    <section class="min-h-screen flex items-center justify-center pt-24 pb-16 px-6">
      <div class="w-full max-w-md">
        <div class="bg-white rounded-3xl p-8 md:p-10 shadow-lg border border-frost-deep">
          <div class="text-center mb-6">
            <img src="/images/logo.png" alt="ManGO Parking" class="w-16 h-16 object-contain mx-auto mb-2" />
            <h1 class="font-heading text-2xl font-bold tracking-tight text-blueberry-deep">${t('finishSignup.title')}</h1>
            <p class="text-dim text-[14px] mt-1">${t('finishSignup.hint')}</p>
          </div>
          <div data-shell>
            <div class="text-center py-6 text-dim text-[14px]">${t('finishSignup.completing')}</div>
          </div>
        </div>
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());
  container.appendChild(page);

  const shell = qs('[data-shell]', page);
  void run(shell);
}

async function run(shell) {
  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) {
    shell.innerHTML = errorBlock(t('finishSignup.invalidLink'));
    return;
  }

  // Email comes from the query param (we put it there in adminSendInvite).
  // If absent, ask the user (some email clients strip it).
  const params = new URLSearchParams(window.location.search);
  let email = params.get('email') || window.localStorage.getItem(STORAGE_KEY) || '';

  if (!email) {
    email = await promptForEmail(shell);
    if (!email) return;
  }

  try {
    await signInWithEmailLink(auth, email, href);
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('signInWithEmailLink failed:', err);
    shell.innerHTML = errorBlock(t('finishSignup.invalidLink'));
    return;
  }

  // Stamp role + displayName from pendingInvites. Non-fatal if it fails.
  try {
    await finishInviteSignupFn({});
  } catch (err) {
    console.warn('finishInviteSignup:', err?.message);
  }

  // Link any guest data made before the account existed — plate balances and
  // bookings matching this email. Login/Register already do this; without it
  // an invited customer (the usual follow-up to a staff-created reservation)
  // never sees their earlier reservations in the profile. Email-link sign-in
  // counts as verified, so the merge's email_verified gate passes.
  await mergeGuestDataForCurrentUser();

  renderPasswordForm(shell);
}

function promptForEmail(shell) {
  return new Promise((resolve) => {
    shell.innerHTML = `
      <form data-email-form class="space-y-4">
        <p class="text-dim text-[14px]">${t('finishSignup.emailPrompt')}</p>
        <input name="email" type="email" required class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
        <button type="submit" class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('common.continue') || 'Continue'}</button>
      </form>
    `;
    qs('[data-email-form]', shell).addEventListener('submit', (e) => {
      e.preventDefault();
      const value = String(new FormData(e.currentTarget).get('email') || '').trim();
      resolve(value);
    });
  });
}

function renderPasswordForm(shell) {
  shell.innerHTML = `
    <form data-pw-form class="space-y-4">
      <p class="font-heading font-semibold text-blueberry-deep text-[15px]">${t('finishSignup.setPassword')}</p>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('finishSignup.passwordLabel')}</label>
        <input name="password" type="password" required minlength="8" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('finishSignup.passwordConfirmLabel')}</label>
        <input name="confirm" type="password" required minlength="8" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
      </div>
      <div data-err class="text-danger text-[13px] hidden"></div>
      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('finishSignup.submit')}</button>
    </form>
  `;

  const form = qs('[data-pw-form]', shell);
  const errEl = qs('[data-err]', shell);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const fd = new FormData(form);
    const pw = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    if (pw.length < 8) {
      errEl.textContent = t('finishSignup.weakError');
      errEl.classList.remove('hidden');
      return;
    }
    if (pw !== confirm) {
      errEl.textContent = t('finishSignup.mismatchError');
      errEl.classList.remove('hidden');
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('not-signed-in');
      await updatePassword(user, pw);
      shell.innerHTML = `<div class="text-center py-6 text-leaf text-[14px]">${t('finishSignup.success')}</div>`;
      setTimeout(() => navigate(localePath('/account')), 1200);
    } catch (err) {
      console.error('updatePassword failed:', err);
      errEl.textContent = t('finishSignup.genericError');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('finishSignup.submit');
    }
  });
}

function errorBlock(message) {
  return `
    <div class="text-center">
      <div class="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 4.5h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </div>
      <p class="text-charcoal text-[15px] mb-6">${message}</p>
      <a href="${localePath('/login')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('auth.login')}</a>
    </div>
  `;
}
