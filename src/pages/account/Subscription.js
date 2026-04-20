import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getUserProfile } from '../../firebase/auth.js';
import { checkIcon } from '../../components/widgets/icons.js';
import { accountLayout, initAccountNav, NAV_ICONS } from '../../components/account/AccountLayout.js';
import { alertModal, confirmModal } from '../../components/core/Modal.js';

/* ── Mock subscription (set to null to test "no subscription" state) ── */
const MOCK_SUBSCRIPTION = {
  plan: 'Commuter Monthly',
  price: '500 lei/mo',
  status: 'active',
  startDate: '2026-02-01',
  renewDate: '2026-04-01',
  vehicle: 'B 123 ABC',
};

function renderActiveSub(sub, locale) {
  const loc = locale === 'ro' ? 'ro-RO' : 'en-GB';
  const dateFmt = { day: 'numeric', month: 'long', year: 'numeric' };

  return `
    <!-- Status header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.subscription')}</h1>
        <p class="text-dim text-[16px]">${t('account.subManage')}</p>
      </div>
      <span class="text-[12px] font-bold bg-leaf/10 text-leaf px-3 py-1 rounded-full">${t('account.statusActive')}</span>
    </div>

    <!-- Plan card -->
    <div class="card-solid rounded-2xl p-6 mb-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <p class="text-[12px] font-mono uppercase text-dim tracking-[0.12em] mb-2">${t('account.currentPlan')}</p>
          <h2 class="font-heading font-bold text-2xl tracking-tight mb-1">${sub.plan}</h2>
          <div class="flex items-baseline gap-1.5">
            <span class="font-heading font-bold text-3xl tracking-tight text-mango">${sub.price.split('/')[0]}</span>
            <span class="text-dim text-sm">/${sub.price.split('/')[1]}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4 text-[15px]">
          <div>
            <p class="text-dim text-[13px] mb-1">${t('account.startDate')}</p>
            <p class="font-semibold">${new Date(sub.startDate).toLocaleDateString(loc, dateFmt)}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('account.renewDate')}</p>
            <p class="font-semibold">${new Date(sub.renewDate).toLocaleDateString(loc, dateFmt)}</p>
          </div>
          <div>
            <p class="text-dim text-[13px] mb-1">${t('account.vehicleLabel')}</p>
            <p class="font-semibold">${sub.vehicle}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Features -->
    <div class="card-solid rounded-2xl p-6 mb-6">
      <h3 class="font-heading font-bold text-lg mb-4">${t('account.planIncludes')}</h3>
      <ul class="space-y-3">
        ${t('account.subFeatures').map(f => `
          <li class="flex items-center gap-2.5 text-[15px]">
            <span class="text-leaf">${checkIcon}</span>
            <span>${f}</span>
          </li>
        `).join('')}
      </ul>
    </div>

    <!-- Actions -->
    <div class="flex flex-col sm:flex-row gap-3">
      <button class="bg-charcoal hover:bg-charcoal-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-all duration-200 shadow-sm" data-action="renew">${t('account.renewNow')}</button>
      <button class="bg-frost hover:bg-frost-deep text-dim font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors duration-200" data-action="pause">${t('account.pauseSub')}</button>
      <button class="text-danger hover:text-danger/80 font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors duration-200" data-action="cancel">${t('account.cancelSub')}</button>
    </div>
  `;
}

function renderNoSub() {
  return `
    <div class="mb-8">
      <h1 class="font-heading text-3xl font-bold tracking-tight mb-1">${t('account.subscription')}</h1>
      <p class="text-dim text-[16px]">${t('account.noSubYet')}</p>
    </div>

    <!-- CTA card -->
    <div class="card-solid rounded-2xl p-8 text-center max-w-lg">
      <div class="w-16 h-16 rounded-2xl bg-mango/10 flex items-center justify-center mx-auto mb-5">
        ${NAV_ICONS.sub.replace('class="w-5 h-5"', 'class="w-8 h-8 text-mango"')}
      </div>
      <h2 class="font-heading font-bold text-xl mb-2">${t('account.subCtaTitle')}</h2>
      <p class="text-dim text-[15px] leading-relaxed mb-6 max-w-sm mx-auto">${t('account.subCtaDesc')}</p>
      <a href="${localePath('/commuter')}" class="inline-block bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[15px] px-8 py-3 rounded-xl transition-all duration-200 shadow-md">${t('account.subCtaBtn')}</a>
    </div>
  `;
}

export default function Subscription(container) {
  const locale = getLocale();

  updateMeta({
    title: `${t('account.subscription')} — Mango Parking`,
    description: t('account.subManage'),
    lang: locale,
  });

  const hasSub = MOCK_SUBSCRIPTION !== null;
  const content = hasSub ? renderActiveSub(MOCK_SUBSCRIPTION, locale) : renderNoSub();

  const page = html`<div>
    <div data-navbar></div>
    <section class="pt-28 pb-16">
      <div class="max-w-7xl mx-auto px-6">
        ${accountLayout('/account/subscription', content)}
      </div>
    </section>
    <div data-footer></div>
  </div>`;

  page.querySelector('[data-navbar]').replaceWith(Navbar());
  page.querySelector('[data-footer]').replaceWith(Footer());

  initAccountNav(page);

  // Action button handlers (mock)
  delegate(page, 'click', '[data-action]', async (e, btn) => {
    const action = btn.dataset.action;
    if (action === 'renew') {
      await alertModal(t('account.renewConfirm'), { type: 'success' });
    } else if (action === 'pause') {
      await alertModal(t('account.pauseConfirm'), { type: 'warning' });
    } else if (action === 'cancel') {
      const confirmed = await confirmModal(t('account.cancelConfirm'), { danger: true, confirmText: t('account.cancelSub') });
      if (confirmed) {
        await alertModal(t('account.cancelDone'), { type: 'info' });
      }
    }
  });

  container.appendChild(page);
}
