import { Navbar } from '../../components/core/Navbar.js';
import { Footer } from '../../components/core/Footer.js';
import { t, localePath, getLocale } from '../../i18n/index.js';
import { html, delegate, setFieldError, clearErrorOnInput } from '../../utils/dom.js';
import { updateMeta } from '../../utils/seo.js';
import { getTokenPacks } from '../../services/tokenService.js';
import { startNetopiaPayment } from '../../services/netopiaService.js';
import { getOnlineDiscountPercent, originalFromOnline } from '../../services/discountService.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../../components/widgets/BillingFields.js';
import { getMyVoucher } from '../../services/voucherService.js';
import { getCurrentUser, getUserProfile } from '../../firebase/auth.js';
import { getDocument, updateDocument } from '../../firebase/db.js';
import { isValidEmail, isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { showToast } from '../../components/core/Toast.js';

export default async function Booking(container) {
  const locale = getLocale();
  updateMeta({
    title: locale === 'ro' ? 'Cumpără Credite — Mango Parking' : 'Buy Credits — Mango Parking',
    description: locale === 'ro'
      ? 'Cumpără credite de parcare la Aeroportul Otopeni. Plată online, microbuz gratuit.'
      : 'Buy parking credits at Otopeni Airport. Pay online, free shuttle included.',
    lang: locale,
  });

  const packs = await getTokenPacks().catch(() => []);
  const discount = await getOnlineDiscountPercent().catch(() => 0);
  const user = getCurrentUser();
  const voucher = user ? await getMyVoucher().catch(() => null) : null;
  const profile = user ? await getDocument('users', user.uid).catch(() => getUserProfile()) : null;
  const profileVehicles = profile?.vehicles || [];

  let selectedPack = null;
  let customQty = 0;
  let confirmed = false;
  let resultBalance = 0;
  let processing = false;

  // Find best value (highest qty pack)
  const bestPack = packs.reduce((best, p) => (!best || p.quantity > best.quantity) ? p : best, null);

  function getSelectedQty() {
    return selectedPack ? selectedPack.quantity : (customQty || 0);
  }

  function getSelectedPrice() {
    if (selectedPack) return selectedPack.price;
    if (customQty > 0 && packs.length > 0) {
      // Use cheapest per-credit rate from packs
      const rates = packs.map(p => p.price / p.quantity);
      return Math.round(customQty * Math.min(...rates));
    }
    return 0;
  }

  function render() {
    const page = html`<div>
      <div data-navbar></div>
      <section class="pt-32 pb-20">
        <div class="max-w-3xl mx-auto px-6">
          <h1 class="font-heading text-4xl md:text-5xl font-bold tracking-[-0.02em] text-blueberry-deep mb-4">${t('credit.pageTitle')}</h1>
          ${confirmed ? renderConfirmation() : renderForm()}
        </div>
      </section>
      <div data-footer></div>
    </div>`;

    page.querySelector('[data-navbar]').replaceWith(Navbar());
    page.querySelector('[data-footer]').replaceWith(Footer());
    return page;
  }

  function renderConfirmation() {
    return `
      <div class="card-solid rounded-3xl p-10 text-center">
        <div class="w-16 h-16 rounded-full bg-leaf/10 flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        </div>
        <h2 class="font-heading text-2xl font-bold mb-2">${t('credit.confirmed')}</h2>
        <p class="text-dim text-[15px] mb-6">${t('credit.confirmMessage')}</p>
        <div class="bg-frost rounded-2xl px-8 py-5 inline-block mb-6">
          <p class="text-dim text-[13px] mb-1">${t('credit.balanceAfter')}</p>
          <span class="font-mono font-bold text-3xl tracking-wider">${resultBalance}</span>
          <span class="text-dim text-[15px] ml-1">${t('credit.plural')}</span>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="${localePath('/')}" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${t('booking.backHome')}</a>
          <button data-new-purchase class="glass font-semibold text-[15px] px-6 py-3 rounded-xl hover:bg-white transition-colors">${t('credit.newPurchase')}</button>
        </div>
      </div>
    `;
  }

  function renderForm() {
    const packCards = packs.map(p => {
      const isBest = p.id === bestPack?.id;
      const isSelected = selectedPack?.id === p.id;
      const name = locale === 'ro' && p.nameRo ? p.nameRo : p.name;
      return `
        <button data-pack-id="${p.id}" class="relative card-solid rounded-2xl p-6 text-left transition-all duration-200 border-[3px] ${isSelected ? 'border-mango shadow-lg ring-2 ring-mango/20' : 'border-transparent hover:border-mango/30'}">
          ${isSelected ? `<div class="absolute top-4 right-4 w-7 h-7 rounded-full bg-mango flex items-center justify-center"><svg class="w-4 h-4 text-charcoal" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>` : ''}
          ${isBest && !isSelected ? `<span class="absolute -top-3 right-4 text-[11px] font-bold bg-mango text-charcoal px-3 py-1 rounded-full">${t('credit.bestValue')}</span>` : ''}
          <p class="font-heading font-bold text-2xl mb-1">${p.quantity} <span class="text-[16px] font-normal text-dim">${t('credit.plural')}</span></p>
          ${(() => {
            const orig = originalFromOnline(p.price, discount);
            if (orig != null && orig !== p.price) {
              return `<p class="font-mono text-[13px] text-dim line-through">${orig} lei</p>
                <p data-price class="font-mono text-lg font-semibold ${isSelected ? 'text-mango' : 'text-charcoal/70'}">${p.price} lei</p>`;
            }
            return `<p data-price class="font-mono text-lg font-semibold ${isSelected ? 'text-mango' : 'text-charcoal/70'}">${p.price} lei</p>`;
          })()}
        </button>
      `;
    }).join('');

    return `
      <!-- Pack selection -->
      <div class="mb-8">
        <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.selectPack')}</h3>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${packCards}
        </div>
      </div>

      <form data-purchase-form class="space-y-6">
        <!-- Vehicle -->
        <div class="card-solid rounded-2xl p-6">
          <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.vehicleInfo')}</h3>
          ${user && profileVehicles.length > 0 ? `
          <div class="space-y-2 mb-4" data-vehicle-options>
            ${profileVehicles.map((v, i) => `
              <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-frost-deep hover:border-mango/30 cursor-pointer transition-colors ${i === 0 ? 'border-mango bg-mango/5' : ''}">
                <input type="radio" name="vehicleChoice" value="${i}" class="accent-mango w-4 h-4" ${i === 0 ? 'checked' : ''}>
                <span class="font-mono font-semibold text-[15px]">${v.plate}</span>
                <span class="text-dim text-[14px]">${v.make} ${v.model}</span>
              </label>
            `).join('')}
            <label class="flex items-center gap-3 p-3 rounded-xl border-2 border-frost-deep hover:border-mango/30 cursor-pointer transition-colors">
              <input type="radio" name="vehicleChoice" value="new" class="accent-mango w-4 h-4">
              <span class="text-[15px] font-medium">${locale === 'ro' ? '+ Vehicul nou' : '+ New vehicle'}</span>
            </label>
          </div>
          <div class="grid md:grid-cols-2 gap-4 hidden" data-new-vehicle-fields>
          ` : `
          <div class="grid md:grid-cols-2 gap-4" data-new-vehicle-fields>
          `}
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.licensePlate')} *</label>
              <input type="text" name="licensePlate" placeholder="B 123 ABC" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 uppercase">
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.makeModel')}</label>
              <input type="text" name="makeModel" placeholder="Dacia Logan" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40">
            </div>
          </div>
        </div>

        <!-- Contact Info -->
        ${user ? `
        <div class="card-solid rounded-2xl p-6">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-heading font-semibold text-lg">${t('booking.contactInfo')}</h3>
            <a href="${localePath('/account')}" class="text-mango text-[13px] font-semibold hover:text-mango-hover transition-colors">${t('common.edit')} →</a>
          </div>
          <div class="flex flex-wrap gap-x-6 gap-y-1 text-[15px] text-dim">
            <span>${profile?.displayName || '—'}</span>
            <span>${profile?.email || '—'}</span>
            ${profile?.phone ? `<span>${profile.phone}</span>` : ''}
          </div>
          <input type="hidden" name="name" value="${profile?.displayName || ''}">
          <input type="hidden" name="email" value="${profile?.email || ''}">
          <input type="hidden" name="phone" value="${profile?.phone || ''}">
        </div>
        ` : `
        <div class="card-solid rounded-2xl p-6">
          <h3 class="font-heading font-semibold text-lg mb-4">${t('booking.contactInfo')}</h3>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.name')} *</label>
              <input type="text" name="name" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
            </div>
            <div>
              <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.phone')} *</label>
              <input type="tel" name="phone" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
            </div>
          </div>
          <div class="mt-4">
            <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${t('booking.email')} *</label>
            <input type="email" name="email" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40" required>
          </div>
        </div>
        `}

        <!-- Billing (PF/PJ) -->
        ${billingFieldsHtml(profile?.billing)}

        <!-- Summary -->
        <div class="card-solid rounded-2xl p-6" data-summary>
          <h3 class="font-heading font-semibold text-lg mb-4">${t('credit.summary')}</h3>
          <div data-price-summary>
            ${(() => {
              if (!selectedPack) return `<p class="text-dim/60">${t('credit.selectPack')}</p>`;
              const orig = originalFromOnline(selectedPack.price, discount);
              const showAnchor = orig != null && orig !== selectedPack.price;
              const voucherActive = voucher && voucher.status === 'unused' && selectedPack.price > voucher.amount;
              return `
                <div class="flex justify-between items-center mb-1"><span>${selectedPack.quantity} ${t('credit.plural')}</span>
                  <div class="text-right">
                    ${showAnchor ? `<div class="font-mono text-[13px] text-dim line-through leading-none">${orig} lei</div>` : ''}
                    <div class="font-mono font-semibold">${selectedPack.price} lei</div>
                    ${showAnchor ? `<div class="text-[10px] font-bold uppercase tracking-wider text-leaf mt-0.5">${t('discount.online', { percent: discount })}</div>` : ''}
                  </div>
                </div>
                ${voucherActive ? `<p class="text-[13px] text-mango mt-2">${t('voucher.applied', { amount: voucher.amount })}</p>` : ''}`;
            })()}
          </div>
        </div>

        <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[16px] py-4 rounded-2xl transition-colors shadow-md disabled:opacity-50" ${!selectedPack ? 'disabled' : ''}>
          ${processing ? t('credit.processing') : t('credit.payNow')}
        </button>
      </form>
    `;
  }

  function updateSummary(pageEl) {
    const summary = pageEl.querySelector('[data-price-summary]');
    if (!summary) return;
    const qty = getSelectedQty();
    const price = getSelectedPrice();
    if (qty > 0) {
      summary.innerHTML = `
        <div class="flex justify-between mb-2"><span>${qty} ${t('credit.plural')}</span><span class="font-mono font-semibold">${price} lei</span></div>
      `;
    } else {
      summary.innerHTML = `<p class="text-dim/60">${t('credit.selectPack')}</p>`;
    }
    const btn = pageEl.querySelector('[type="submit"]');
    if (btn) btn.disabled = qty <= 0;
  }

  const page = render();
  container.appendChild(page);

  function bindEvents(pageEl) {
    // Pack selection
    delegate(pageEl, 'click', '[data-pack-id]', (e, btn) => {
      const packId = btn.dataset.packId;
      selectedPack = packs.find(p => p.id === packId) || null;
      customQty = 0;
      // Update selected styles
      pageEl.querySelectorAll('[data-pack-id]').forEach(card => {
        const isSel = card.dataset.packId === packId;
        card.classList.toggle('border-mango', isSel);
        card.classList.toggle('shadow-lg', isSel);
        card.classList.toggle('ring-2', isSel);
        card.classList.toggle('ring-mango/20', isSel);
        card.classList.toggle('border-transparent', !isSel);
        // Toggle checkmark
        const existing = card.querySelector('[data-check]');
        if (isSel && !existing) {
          card.insertAdjacentHTML('afterbegin', `<div data-check class="absolute top-4 right-4 w-7 h-7 rounded-full bg-mango flex items-center justify-center"><svg class="w-4 h-4 text-charcoal" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>`);
        } else if (!isSel && existing) {
          existing.remove();
        }
        // Toggle price color
        const price = card.querySelector('[data-price]');
        if (price) {
          price.classList.toggle('text-mango', isSel);
          price.classList.toggle('text-charcoal/70', !isSel);
        }
      });
      updateSummary(pageEl);
    });

    // Vehicle radio toggle (show/hide new vehicle fields)
    const vehicleOptions = pageEl.querySelector('[data-vehicle-options]');
    const newVehicleFields = pageEl.querySelector('[data-new-vehicle-fields]');
    if (vehicleOptions && newVehicleFields) {
      vehicleOptions.addEventListener('change', (e) => {
        const radio = e.target;
        if (!radio.matches('input[name="vehicleChoice"]')) return;
        const isNew = radio.value === 'new';
        newVehicleFields.classList.toggle('hidden', !isNew);
        // Style the selected label
        vehicleOptions.querySelectorAll('label').forEach(lbl => {
          const inp = lbl.querySelector('input');
          lbl.classList.toggle('border-mango', inp.checked);
          lbl.classList.toggle('bg-mango/5', inp.checked);
          lbl.classList.toggle('border-frost-deep', !inp.checked);
        });
      });
    }

    // New purchase button
    delegate(pageEl, 'click', '[data-new-purchase]', () => {
      confirmed = false;
      selectedPack = null;
      customQty = 0;
      resultBalance = 0;
      processing = false;
      container.innerHTML = '';
      const newPage = render();
      container.appendChild(newPage);
      bindEvents(newPage);
    });

    // Form submit
    const form = pageEl.querySelector('[data-purchase-form]');
    if (!form) return;

    // Clear red field-error state as the user edits any input.
    ['licensePlate', 'name', 'phone', 'email', 'makeModel'].forEach(n => {
      const input = form.elements[n];
      if (input) clearErrorOnInput(input);
    });

    // Wire PF/PJ toggle for the billing block (idempotent — safe across re-renders).
    wireBillingToggle(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (processing) return;

      const fd = new FormData(form);
      const name = fd.get('name');
      const phone = fd.get('phone');
      const email = fd.get('email');

      // Resolve license plate from saved vehicle or new input
      let licensePlate = fd.get('licensePlate');
      const vehicleChoice = fd.get('vehicleChoice');
      if (user && profileVehicles.length > 0 && vehicleChoice !== 'new' && vehicleChoice != null) {
        const idx = parseInt(vehicleChoice, 10);
        licensePlate = profileVehicles[idx]?.plate || licensePlate;
      }

      // Validate everything up-front so we can highlight all bad fields at once.
      const errors = [];
      if (!user) {
        const nameOk = required(name);
        const phoneOk = isValidPhone(phone);
        const emailOk = isValidEmail(email);
        setFieldError(form.elements.name, !nameOk);
        setFieldError(form.elements.phone, !phoneOk);
        setFieldError(form.elements.email, !emailOk);
        if (!nameOk) errors.push(t('booking.errors.name'));
        if (!phoneOk) errors.push(t('booking.errors.phone'));
        if (!emailOk) errors.push(t('booking.errors.email'));
      }
      const plateOk = !!licensePlate && isValidLicensePlate(licensePlate);
      if (!plateOk && form.elements.licensePlate) setFieldError(form.elements.licensePlate, true);
      if (!plateOk) errors.push(t('booking.errors.plate'));
      if (errors.length) {
        showToast(errors[0], 'error');
        return;
      }

      const billing = readBilling(form);
      if (billing.error) {
        showToast(billing.error, 'error');
        return;
      }

      const qty = getSelectedQty();
      const packId = selectedPack?.id || null;
      if (qty <= 0) { showToast(t('credit.selectPack'), 'error'); return; }

      processing = true;
      const btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = t('credit.processing'); }

      // Save the new vehicle to the user's profile BEFORE redirecting.
      // The Netopia handoff navigates away from the SPA, so anything we
      // want persisted must happen here. Even if the user cancels payment,
      // the saved vehicle is harmless (they can remove it from /account/vehicles).
      if (user && licensePlate) {
        const normalizedPlate = licensePlate.toUpperCase().trim();
        const alreadySaved = profileVehicles.some(v => v.plate.toUpperCase().replace(/[\s-]/g, '') === normalizedPlate.replace(/[\s-]/g, ''));
        if (!alreadySaved) {
          const makeModel = fd.get('makeModel') || '';
          const [make, ...rest] = makeModel.split(' ');
          profileVehicles.push({ plate: normalizedPlate, make: make || '', model: rest.join(' ') || '' });
          await updateDocument('users', user.uid, { vehicles: profileVehicles }).catch(() => {});
        }
      }

      const voucherIdToSend = (voucher && voucher.status === 'unused' && getSelectedPrice() > voucher.amount)
        ? voucher.userId
        : null;

      try {
        await startNetopiaPayment({
          orderType: 'credits',
          packId,
          quantity: qty,
          packPrice: getSelectedPrice(),
          voucherId: voucherIdToSend,
          customerData: {
            customerId: user?.uid || null,
            licensePlate,
            name,
            email,
            phone,
            billing,
          },
        });
        // Browser is navigating to Netopia — nothing else to do.
      } catch (err) {
        console.error(err);
        showToast(t('common.error'), 'error');
        processing = false;
        if (btn) { btn.disabled = false; btn.textContent = t('credit.payNow'); }
      }
    });
  }

  bindEvents(page);
}
