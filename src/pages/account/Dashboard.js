import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile, getCurrentUser } from '../../firebase/auth.js';
import { updateDocument, getDocument, getCollection, where, orderBy } from '../../firebase/db.js';
import { getBalance, getTransactions } from '../../services/tokenService.js';
import { showToast } from '../../components/core/Toast.js';
import { getShuttleSchedule, getUpcomingDepartures, getRouteKey } from '../../services/shuttleService.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';
import { formatDate } from '../../utils/date.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../../components/widgets/BillingFields.js';
import { getMyVoucher } from '../../services/voucherService.js';

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

  const [balanceDoc, transactions, shuttleSchedule, voucher, upcomingBookings, myPromos, myRedemptions] = await Promise.all([
    uid ? getBalance(uid).catch(() => null) : Promise.resolve(null),
    uid ? getTransactions(uid, 5).catch(() => []) : Promise.resolve([]),
    getShuttleSchedule().catch(() => []),
    uid ? getMyVoucher().catch(() => null) : Promise.resolve(null),
    uid
      ? getCollection('bookings',
          where('customerId', '==', uid),
          where('status', 'in', ['upcoming', 'active'])
        ).then(rows => rows.sort((a, b) => String(a.startDate || a.dropoffAt || '').localeCompare(String(b.startDate || b.dropoffAt || '')))).catch(() => [])
      : Promise.resolve([]),
    uid ? getCollection('promoVouchers', where('assignedUserIds', 'array-contains', uid)).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('voucherRedemptions', where('userId', '==', uid)).catch(() => []) : Promise.resolve([]),
  ]);

  // Count promo vouchers that are usable today: active, in window, not
  // yet redeemed by this user. Drives the dashboard hint card.
  const usedCodes = new Set((myRedemptions || []).map((r) => r.voucherCode).filter(Boolean));
  const todayStr = new Date().toISOString().slice(0, 10);
  const usablePromoCount = (myPromos || []).filter((v) => {
    if (!v.active) return false;
    if (usedCodes.has(v.code)) return false;
    if (v.startDate && todayStr < v.startDate) return false;
    if (v.endDate && todayStr > v.endDate) return false;
    return true;
  }).length;

  // Active credit check-ins for this user's plates — rendered alongside
  // longterm upcoming bookings so the widget reflects every "in-progress"
  // reservation regardless of type.
  const myPlates = (balanceDoc?.plates || []).filter(Boolean);
  const activeCheckIns = myPlates.length > 0
    ? (await Promise.all(myPlates.map(p => getDocument('activeCheckIns', p).catch(() => null)))).filter(Boolean)
    : [];

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
    title: `${t('account.dashboard')} — ManGO Parking`,
    description: t('account.dashboardSubtitle'),
    lang: locale,
  });

  // One-line summary of the saved billing identity, shown in the profile view
  // so customers can see it's on file (it's pre-filled into the booking flow).
  const savedBilling = profile?.billing;
  const billingSummary = (() => {
    const b = savedBilling;
    if (!b || (!b.companyName && !b.name && !b.firstName && !b.lastName && !b.cui)) {
      return locale === 'ro'
        ? 'Necompletate — apasă „Editează” pentru a le adăuga (se precompletează la rezervare).'
        : 'Not set — tap “Edit” to add them (they pre-fill at booking).';
    }
    if (b.type === 'PJ') return [b.companyName, b.cui].filter(Boolean).join(' · ');
    const nm = b.name || [b.firstName, b.lastName].filter(Boolean).join(' ');
    return [nm, b.locality].filter(Boolean).join(' · ');
  })();

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
        <div class="mt-3 pt-3 border-t border-frost-deep">
          <span class="text-dim text-[13px]">${t('billing.title')}</span>
          <p class="font-medium text-[14px]">${billingSummary}</p>
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
        <div class="mb-4">
          ${billingFieldsHtml(profile?.billing)}
        </div>
        <div class="flex gap-2">
          <button type="submit" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('common.save')}</button>
          <button type="button" data-cancel-profile class="text-dim text-[14px] px-4 py-2.5 hover:text-charcoal transition-colors">${t('common.cancel')}</button>
        </div>
      </form>
    </div>

    ${usablePromoCount > 0 ? `
    <!-- Promo voucher hint — links to the full list at /account/vouchers -->
    <a href="${localePath('/account/vouchers')}" class="block rounded-2xl p-5 mb-6 bg-mango/10 border-2 border-mango/30 hover:bg-mango/15 transition-colors flex items-center justify-between gap-4">
      <div class="flex items-center gap-4 min-w-0">
        <div class="w-12 h-12 rounded-xl bg-mango flex items-center justify-center shrink-0">
          <svg class="w-6 h-6 text-charcoal" fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z"/></svg>
        </div>
        <div class="min-w-0">
          <p class="font-heading font-bold text-lg text-blueberry-deep">${t('accountVouchers.hintTitle', { count: usablePromoCount })}</p>
          <p class="text-charcoal/70 text-[14px]">${t('accountVouchers.hintBody')}</p>
        </div>
      </div>
      <span class="text-mango font-mono text-[13px] font-bold shrink-0">${t('accountVouchers.hintCta')} →</span>
    </a>
    ` : ''}

    ${voucher && voucher.status === 'unused' ? `
    <!-- Legacy signup voucher banner (in-flight balances only) -->
    <div class="rounded-2xl p-5 mb-6 bg-mango/10 border-2 border-mango/30 flex items-center gap-4">
      <div class="w-12 h-12 rounded-xl bg-mango flex items-center justify-center shrink-0">
        <svg class="w-6 h-6 text-charcoal" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      </div>
      <div>
        <p class="font-heading font-bold text-lg text-blueberry-deep">${t('voucher.dashboardTitle', { amount: voucher.amount })}</p>
        <p class="text-charcoal/70 text-[14px]">${t('voucher.dashboardHint')}</p>
      </div>
    </div>
    ` : ''}

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

    <!-- Upcoming reservations (longterm + active credit check-ins) -->
    <div class="card-solid rounded-2xl p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-heading font-bold text-lg">${t('account.upcomingTitle')}</h3>
        <a href="${localePath('/account/bookings')}" class="text-mango text-[14px] font-semibold hover:text-mango-hover transition-colors">${t('account.viewDetails')} →</a>
      </div>
      ${(upcomingBookings.length + activeCheckIns.length) > 0 ? `
        <div class="space-y-3">
          ${activeCheckIns.map(ck => renderActiveCheckIn(ck, locale)).join('')}
          ${upcomingBookings.map(b => renderUpcomingBooking(b, locale)).join('')}
        </div>
      ` : `<p class="text-dim text-center py-4">${t('account.upcomingNone')}</p>`}
    </div>

    <!-- Reserve CTAs + Next shuttle -->
    <div class="grid md:grid-cols-3 gap-6 mb-6">
      <!-- Buy credits -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-3">${t('account.reserveCredits')}</h3>
        <p class="text-dim text-[14px] mb-4">${t('credit.rule2')}</p>
        <a href="${localePath('/booking/credits')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-5 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('credit.buyTokens')}</a>
      </div>

      <!-- Reserve longterm -->
      <div class="card-solid rounded-2xl p-6">
        <h3 class="font-heading font-bold text-lg mb-3">${t('account.reserveLongterm')}</h3>
        <p class="text-dim text-[14px] mb-4">${t('longTerm.pageSubtitle')}</p>
        <a href="${localePath('/booking/long-term')}" class="inline-block bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-5 py-3 rounded-xl transition-all duration-200 shadow-sm">${t('account.reserveNow')}</a>
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

  // Wire PF/PJ toggle inside the profile form.
  if (profileForm) wireBillingToggle(profileForm);

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
      const billing = readBilling(profileForm);
      if (billing.error) {
        showToast(billing.error, 'error');
        return;
      }
      try {
        await updateDocument('users', uid, {
          displayName: fd.get('displayName') || '',
          email: fd.get('email') || '',
          phone: fd.get('phone') || '',
          billing,
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

function renderUpcomingBooking(b, locale) {
  const dropoff = b.dropoffAt || b.startDate;
  const pickup = b.pickupAt || b.endDate;
  const active = b.status === 'active';
  const badge = active
    ? `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-leaf/10 text-leaf">${t('account.currentlyParked')}</span>`
    : `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blueberry/10 text-blueberry">${t('account.bookingLongterm')}</span>`;
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-frost-deep last:border-0">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-1">
          ${badge}
          ${b.code ? `<span class="text-[12px] font-mono text-dim">${b.code}</span>` : ''}
        </div>
        <p class="text-[14px] text-charcoal">
          <span class="font-mono font-bold">${b.licensePlate || '—'}</span>
          · ${t('account.arrivingOn')} <span class="font-medium">${formatDate(dropoff, locale)}</span>
          · ${t('account.leavingOn')} <span class="font-medium">${formatDate(pickup, locale)}</span>
        </p>
      </div>
      ${active && b.spotId ? `<p class="text-[12px] text-dim">${t('account.spot')} <span class="font-mono font-semibold">${b.spotId}</span></p>` : ''}
    </div>
  `;
}

function renderActiveCheckIn(ck, locale) {
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-frost-deep last:border-0">
      <div class="min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-leaf/10 text-leaf">${t('account.currentlyParked')}</span>
          <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mango/15 text-charcoal">${t('account.bookingCredit')}</span>
        </div>
        <p class="text-[14px] text-charcoal">
          <span class="font-mono font-bold">${ck.licensePlate || '—'}</span>
          · ${formatDate(ck.checkinTime, locale)}
        </p>
      </div>
      ${ck.spotId ? `<p class="text-[12px] text-dim">${t('account.spot')} <span class="font-mono font-semibold">${ck.spotId}</span></p>` : ''}
    </div>
  `;
}
