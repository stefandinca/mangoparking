import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile, getCurrentUser } from '../../firebase/auth.js';
import { updateDocument, getDocument } from '../../firebase/db.js';
import { getBalance, getTransactions } from '../../services/tokenService.js';
import { showToast } from '../../components/core/Toast.js';
import { getShuttleSchedule, getUpcomingDepartures, getRouteKey } from '../../services/shuttleService.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';
import { formatDate } from '../../utils/date.js';

const TYPE_STYLES = {
  purchase: 'bg-leaf/10 text-leaf',
  use: 'bg-blue-100 text-blue-600',
  refund: 'bg-mango/10 text-mango',
};

export default async function Dashboard(container) {
  const locale = getLocale();
  const uid = getCurrentUser()?.uid;
  // Fetch fresh profile from Firestore (not cache) so edits show on refresh
  const profile = uid ? await getDocument('users', uid).catch(() => getUserProfile()) : getUserProfile();
  const displayName = profile?.displayName || 'User';

  const [balanceDoc, transactions, shuttleSchedule] = await Promise.all([
    uid ? getBalance(uid).catch(() => null) : Promise.resolve(null),
    uid ? getTransactions(uid, 5).catch(() => []) : Promise.resolve([]),
    getShuttleSchedule().catch(() => []),
  ]);

  const balance = balanceDoc?.balance ?? 0;
  const totalPurchased = balanceDoc?.totalPurchased ?? 0;
  const upcoming = getUpcomingDepartures(shuttleSchedule, 1);
  const nextShuttle = upcoming[0] || null;

  let minutesAway = 0;
  if (nextShuttle) {
    const now = new Date();
    const [h, m] = nextShuttle.departureTime.split(':').map(Number);
    const depTime = new Date(now);
    depTime.setHours(h, m, 0, 0);
    minutesAway = Math.max(0, Math.round((depTime - now) / 60000));
  }

  updateMeta({
    title: `${t('account.dashboard')} — Mango Parking`,
    description: t('account.dashboardSubtitle'),
    lang: locale,
  });

  const content = `
    <!-- Welcome -->
    <div class="mb-8">
      <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.welcome', { name: displayName })}</h1>
      <p class="text-dim text-[16px]">${t('account.dashboardSubtitle')}</p>
    </div>

    <!-- Profile -->
    <div class="card-solid rounded-2xl p-6 mb-8">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-heading font-bold text-lg">${locale === 'ro' ? 'Profilul Meu' : 'My Profile'}</h3>
        <button data-edit-profile class="text-mango text-[13px] font-semibold hover:text-mango-hover transition-colors">${t('common.edit')}</button>
      </div>
      <div data-profile-view>
        <div class="flex flex-wrap gap-x-8 gap-y-2 text-[15px]">
          <div><span class="text-dim text-[13px]">${t('booking.name')}</span><p class="font-medium">${profile?.displayName || '—'}</p></div>
          <div><span class="text-dim text-[13px]">${t('booking.email')}</span><p class="font-medium">${profile?.email || '—'}</p></div>
          <div><span class="text-dim text-[13px]">${t('booking.phone')}</span><p class="font-medium">${profile?.phone || '—'}</p></div>
        </div>
      </div>
      <form data-profile-form class="hidden">
        <div class="grid sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label class="block text-[13px] text-dim mb-1">${t('booking.name')}</label>
            <input type="text" name="displayName" value="${profile?.displayName || ''}" class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          </div>
          <div>
            <label class="block text-[13px] text-dim mb-1">${t('booking.email')}</label>
            <input type="email" name="email" value="${profile?.email || ''}" class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          </div>
          <div>
            <label class="block text-[13px] text-dim mb-1">${t('booking.phone')}</label>
            <input type="tel" name="phone" value="${profile?.phone || ''}" class="w-full px-3 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
          </div>
        </div>
        <div class="flex gap-2">
          <button type="submit" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('common.save')}</button>
          <button type="button" data-cancel-profile class="text-dim text-[14px] px-4 py-2.5 hover:text-charcoal transition-colors">${t('common.cancel')}</button>
        </div>
      </form>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('credit.balance')}</p>
        <p class="font-heading font-bold text-3xl tracking-tight text-mango">${balance}</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('credit.totalPurchased')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">${totalPurchased}</p>
      </div>
      <div class="card-solid rounded-2xl p-5">
        <p class="text-[11px] sm:text-[12px] leading-tight font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.vehicles')}</p>
        <p class="font-heading font-bold text-2xl tracking-tight">${(balanceDoc?.plates || []).length}</p>
      </div>
    </div>

    <!-- Buy more + Next shuttle -->
    <div class="grid md:grid-cols-2 gap-6 mb-6">
      <!-- Buy more tokens -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-3">${t('credit.buyMore')}</h3>
        <p class="text-dim text-[14px] mb-4">${t('credit.rule2')} — ${t('credit.rule1')}</p>
        <a href="${localePath('/booking')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('credit.buyTokens')}</a>
      </div>

      <!-- Next shuttle -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-4">${t('account.nextShuttle')}</h3>
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-2xl bg-mango/10 flex items-center justify-center">
            ${NAV_ICONS.vehicles}
          </div>
          <div>
            <p class="font-heading font-bold text-2xl tracking-tight font-mono">${nextShuttle ? nextShuttle.departureTime : '--:--'}</p>
            <p class="text-dim text-[14px]">→ ${nextShuttle ? t('shuttle.' + getRouteKey(nextShuttle.route)) : '—'}</p>
            <p class="text-mango text-[13px] font-semibold mt-0.5">${nextShuttle ? t('account.inMinutes', { min: minutesAway }) : ''}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Recent transactions -->
    <div class="card-solid rounded-2xl p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-heading font-bold text-lg">${t('credit.recentTransactions')}</h3>
        <a href="${localePath('/account/bookings')}" class="text-mango text-[14px] font-semibold hover:text-mango-hover transition-colors">${t('account.viewDetails')} →</a>
      </div>
      ${transactions.length > 0 ? `
        <div class="space-y-3">
          ${transactions.map(tx => {
            const typeCls = TYPE_STYLES[tx.type] || 'bg-gray-100 text-gray-600';
            const qty = tx.type === 'use' ? tx.quantity : `+${tx.quantity}`;
            return `
              <div class="flex items-center justify-between py-2">
                <div class="flex items-center gap-3">
                  <span class="text-[12px] font-bold uppercase px-2.5 py-0.5 rounded-full ${typeCls}">${t('credit.type' + tx.type.charAt(0).toUpperCase() + tx.type.slice(1))}</span>
                  <span class="text-dim text-[13px]">${formatDate(tx.timestamp, locale)}</span>
                </div>
                <span class="font-mono font-semibold text-[15px]">${qty}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : `<p class="text-dim text-center py-4">${t('credit.noTransactions')}</p>`}
    </div>
  `;

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  // Profile edit toggle
  const profileView = page.querySelector('[data-profile-view]');
  const profileForm = page.querySelector('[data-profile-form]');

  delegate(page, 'click', '[data-edit-profile]', () => {
    profileView.classList.add('hidden');
    profileForm.classList.remove('hidden');
  });

  delegate(page, 'click', '[data-cancel-profile]', () => {
    profileForm.classList.add('hidden');
    profileView.classList.remove('hidden');
  });

  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(profileForm);
      const uid = getCurrentUser()?.uid;
      if (!uid) return;
      try {
        await updateDocument('users', uid, {
          displayName: fd.get('displayName') || '',
          email: fd.get('email') || '',
          phone: fd.get('phone') || '',
        });
        // Update view
        const vals = profileView.querySelectorAll('p.font-medium');
        if (vals[0]) vals[0].textContent = fd.get('displayName') || '—';
        if (vals[1]) vals[1].textContent = fd.get('email') || '—';
        if (vals[2]) vals[2].textContent = fd.get('phone') || '—';
        profileForm.classList.add('hidden');
        profileView.classList.remove('hidden');
        showToast(locale === 'ro' ? 'Profil actualizat!' : 'Profile updated!', 'success');
      } catch (err) {
        console.error(err);
        showToast(t('common.error'), 'error');
      }
    });
  }

  container.appendChild(page);
}
