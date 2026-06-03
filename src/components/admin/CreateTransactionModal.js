import { html, qs, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { openModal } from '../../components/core/Modal.js';
import { showToast } from '../../components/core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { isValidEmail, isValidLicensePlate } from '../../utils/validators.js';
import { dateTimeFieldHtml, wireDateTime } from '../../components/core/FormDateTime.js';
import { getBalance, lookupByPlate } from '../../services/tokenService.js';

// Reusable "Create transaction" modal.
//
// Originally lived inside AdminTransactions.js (v1.6 + earlier). Lifted
// into a shared component during the v1.7 check-in/check-out redesign
// because the same modal is now the primary entry point for walk-in
// bookings on AdminCheckIns. The Transactions page no longer hosts it.
//
// Two booking types (long-term vs credit pack), two user modes
// (existing user lookup or new-user invite). Optional `autoCheckIn`
// checkbox routes to the v1.7 walk-in path on the server, immediately
// checking the customer in upon creation.
//
// Usage:
//   import { openCreateTransactionModal } from '.../CreateTransactionModal.js';
//   openCreateTransactionModal(users, async () => { /* on success */ });

const adminCreateLongtermBookingFn = httpsCallable(functions, 'adminCreateLongtermBooking');
const grantCreditsForCashFn       = httpsCallable(functions, 'grantCreditsForCash');
const checkInWithCreditsFn        = httpsCallable(functions, 'checkInWithCredits');
const adminSendInviteFn           = httpsCallable(functions, 'adminSendInvite');

// Map server error codes from checkInWithCredits to friendly i18n strings.
function creditCheckInError(err) {
  const msg = String(err?.message || '');
  if (msg.includes('NO_BALANCE')) return t('transactions.errorNoBalance');
  if (msg.includes('INSUFFICIENT_CREDITS')) return t('transactions.errorInsufficientCredits');
  if (msg.includes('ALREADY_CHECKED_IN')) return t('transactions.errorAlreadyCheckedIn');
  return err?.message || t('common.error');
}

// Format a Date as flatpickr's `Y-m-d H:i` value (space separator, no
// seconds, no timezone). Matches the convention used in BookingLongTerm
// so the same submit-side conversion helpers work everywhere.
function toFlatpickrValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function openCreateTransactionModal(users, onDone, { allowWalkIn = true } = {}) {
  const locale = getLocale();
  // Sensible defaults so a walk-in agent doesn't have to fill dates from
  // scratch. Drop-off = now (the customer is at the gate); pick-up = +1
  // day. Agent can change either, but the common case is one click away.
  const now = new Date();
  now.setSeconds(0, 0);
  const inOneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const defaultDropoff = toFlatpickrValue(now);
  const defaultPickup = toFlatpickrValue(inOneDay);
  const body = html`
    <div class="space-y-4">
      <h2 class="font-heading font-bold text-xl text-blueberry-deep">${t('transactions.createTitle')}</h2>

      <!-- Type selector -->
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('transactions.createTypeLabel')}</label>
        <div class="grid grid-cols-2 gap-2" data-type-toggle>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-mango bg-mango/5 cursor-pointer">
            <input type="radio" name="tType" value="longterm" checked class="accent-mango w-4 h-4">
            <span class="text-[13px] font-medium">${t('transactions.createTypeLongterm')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="tType" value="credit" class="accent-mango w-4 h-4">
            <span class="text-[13px] font-medium">${t('transactions.createTypeCredit')}</span>
          </label>
        </div>
      </div>

      <!-- User picker -->
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-2">${t('transactions.createUserLabel')}</label>
        <div class="grid grid-cols-2 gap-2 mb-2" data-mode-toggle>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-blueberry bg-blueberry/5 cursor-pointer">
            <input type="radio" name="userMode" value="existing" checked class="accent-blueberry w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createUserExisting')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-frost-deep cursor-pointer">
            <input type="radio" name="userMode" value="new" class="accent-blueberry w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createUserNew')}</span>
          </label>
        </div>

        <div data-existing-block>
          <input list="users-options-ct" data-user-search type="text"
            placeholder="${t('transactions.createUserSearch')}"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <datalist id="users-options-ct">
            ${users
              .filter(u => u.email)
              .map(u => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.displayName || '')}</option>`)
              .join('')}
          </datalist>
        </div>

        <div data-new-block class="hidden grid grid-cols-2 gap-2">
          <input type="text" name="newName" placeholder="${t('transactions.createNewName')}"
            class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <input type="email" name="newEmail" placeholder="${t('transactions.createNewEmail')}"
            class="px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
        </div>
      </div>

      <!-- Plate -->
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPlate')} *</label>
        <input type="text" name="plate" placeholder="B 123 ABC" required
          class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] uppercase font-mono focus:outline-none focus:border-mango/40">
      </div>

      <!-- Longterm-specific fields -->
      <div data-lt-fields class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createDropoff')} *</label>
            ${dateTimeFieldHtml({ name: 'dropoffAt', value: defaultDropoff, required: true, stepToNext: 'pickupAt' })}
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPickup')} *</label>
            ${dateTimeFieldHtml({ name: 'pickupAt', value: defaultPickup, required: true })}
          </div>
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createTotal')} *</label>
          <input type="number" name="totalPrice" min="1" step="1" required placeholder="120"
            class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
        </div>
      </div>

      <!-- Credit-specific fields (hidden by default) -->
      <div data-cr-fields class="hidden space-y-3">
        ${allowWalkIn ? `
        <!-- Sell new vs. use existing credits -->
        <div class="grid grid-cols-2 gap-2" data-credit-mode-toggle>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-leaf bg-leaf/5 cursor-pointer text-center">
            <input type="radio" name="creditMode" value="sell" checked class="accent-leaf w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createCreditModeSell')}</span>
          </label>
          <label class="flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-frost-deep cursor-pointer text-center">
            <input type="radio" name="creditMode" value="use" class="accent-leaf w-4 h-4">
            <span class="text-[12px] font-medium">${t('transactions.createCreditModeUse')}</span>
          </label>
        </div>
        ` : ''}

        <!-- Sell new credits -->
        <div data-cr-sell class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createQuantity')} *</label>
            <input type="number" name="quantity" min="1" step="1" placeholder="5"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createAmount')} *</label>
            <input type="number" name="amount" min="1" step="1" placeholder="100"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
        </div>

        <!-- Use existing credits (check-in) -->
        <div data-cr-use class="hidden space-y-3">
          <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-frost border border-frost-deep">
            <span class="text-[12px] uppercase tracking-wider text-dim font-mono">${t('transactions.createBalanceLabel')}</span>
            <span data-balance-display class="text-[13px] font-semibold text-charcoal/70">${t('transactions.createBalancePrompt')}</span>
          </div>
          <div>
            <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createCreditsToUse')} *</label>
            <input type="number" name="creditsToUse" min="1" step="1" value="1"
              class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] font-mono focus:outline-none focus:border-mango/40">
          </div>
        </div>
      </div>

      <!-- Paid by (hidden when using existing credits — no money moves) -->
      <div data-paidby-wrap>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1.5">${t('transactions.createPaidBy')}</label>
        <select name="paidBy" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-mango/40">
          <option value="cash">${t('checkins.payCash')}</option>
          <option value="card">${t('checkins.payCard')}</option>
        </select>
      </div>

      ${allowWalkIn ? `
      <!-- Walk-in auto-checkin (v1.7) -->
      <label data-autocheckin-wrap class="flex items-start gap-2.5 text-[14px] text-charcoal/80 cursor-pointer pt-1">
        <input type="checkbox" name="autoCheckIn" class="accent-mango w-4 h-4 mt-0.5">
        <span>${t('checkins.walkInAutoCheckIn')}</span>
      </label>
      ` : ''}

      <div data-err class="text-danger text-[13px] hidden"></div>

      <div class="flex gap-3 justify-end pt-2">
        <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors">${t('common.cancel')}</button>
        <button type="button" data-submit class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${t('transactions.createSubmit')}</button>
      </div>
    </div>
  `;

  const { close, contentEl } = openModal(body);

  // Attach the branded flatpickr to the two datetime inputs. Picker
  // overlays render against document.body via flatpickr's defaults, so
  // they render above the modal without z-index drama.
  wireDateTime(contentEl);

  const typeToggle = qs('[data-type-toggle]', contentEl);
  const ltFields = qs('[data-lt-fields]', contentEl);
  const crFields = qs('[data-cr-fields]', contentEl);
  const crSell = qs('[data-cr-sell]', contentEl);
  const crUse = qs('[data-cr-use]', contentEl);
  const creditModeToggle = qs('[data-credit-mode-toggle]', contentEl);
  const paidbyWrap = qs('[data-paidby-wrap]', contentEl);
  const autoCheckInWrap = qs('[data-autocheckin-wrap]', contentEl);
  const submitBtn = qs('[data-submit]', contentEl);
  const balanceDisplay = qs('[data-balance-display]', contentEl);

  // State readers — the DOM is the single source of truth.
  const getType = () => qs('input[name="tType"]:checked', contentEl).value;
  const getMode = () => qs('input[name="userMode"]:checked', contentEl).value;
  const getCreditMode = () => {
    const el = qs('input[name="creditMode"]:checked', contentEl);
    return el ? el.value : 'sell';
  };
  // True when checking a customer in against credits they already hold —
  // no money moves, so paid-by + auto-check-in + sell fields are hidden.
  const isCreditUse = () => getType() === 'credit' && getCreditMode() === 'use';

  function applyVisibility() {
    const isLT = getType() === 'longterm';
    ltFields.classList.toggle('hidden', !isLT);
    crFields.classList.toggle('hidden', isLT);

    const useExisting = isCreditUse();
    if (crSell) crSell.classList.toggle('hidden', useExisting || isLT);
    if (crUse) crUse.classList.toggle('hidden', !useExisting);
    // Money + walk-in affordances are irrelevant when spending existing credits.
    paidbyWrap?.classList.toggle('hidden', useExisting);
    autoCheckInWrap?.classList.toggle('hidden', useExisting);
    submitBtn.textContent = useExisting
      ? t('transactions.createCheckInSubmit')
      : t('transactions.createSubmit');
  }

  typeToggle.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="tType"]')) return;
    typeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-mango', inp.checked);
      lbl.classList.toggle('bg-mango/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    applyVisibility();
    if (isCreditUse()) refreshBalance();
  });

  creditModeToggle?.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="creditMode"]')) return;
    creditModeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-leaf', inp.checked);
      lbl.classList.toggle('bg-leaf/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
    applyVisibility();
    if (isCreditUse()) refreshBalance();
  });

  // ── Live balance lookup (use-existing mode) ──
  // Resolve by matched customer first, then by plate. Shown so the agent
  // sees "(if they have any)" before attempting the check-in.
  function resolveMatchedCustomerId() {
    const search = String(qs('[data-user-search]', contentEl).value || '').trim().toLowerCase();
    if (!search) return null;
    const matched = users.find(u =>
      (u.email || '').toLowerCase() === search
      || (u.displayName || '').toLowerCase() === search
    );
    return matched ? matched.id : null;
  }

  let balanceToken = 0;
  async function refreshBalance() {
    if (!isCreditUse() || !balanceDisplay) return;
    const plate = String(qs('[name="plate"]', contentEl).value || '').toUpperCase().trim();
    const customerId = getMode() === 'existing' ? resolveMatchedCustomerId() : null;
    if (!plate && !customerId) {
      balanceDisplay.textContent = t('transactions.createBalancePrompt');
      balanceDisplay.className = 'text-[13px] font-semibold text-charcoal/70';
      return;
    }
    const myToken = ++balanceToken;
    balanceDisplay.textContent = t('transactions.createBalanceChecking');
    balanceDisplay.className = 'text-[13px] font-semibold text-dim';
    try {
      let bal = null;
      if (customerId) bal = await getBalance(customerId);
      if (!bal && plate) bal = await lookupByPlate(plate);
      if (myToken !== balanceToken) return; // a newer lookup superseded this one
      const credits = bal ? Number(bal.balance || 0) : 0;
      if (credits > 0) {
        balanceDisplay.textContent = t('transactions.createBalanceCredits', { n: credits });
        balanceDisplay.className = 'text-[13px] font-semibold text-leaf';
      } else {
        balanceDisplay.textContent = t('transactions.createBalanceNone');
        balanceDisplay.className = 'text-[13px] font-semibold text-red-600';
      }
    } catch (err) {
      if (myToken !== balanceToken) return;
      balanceDisplay.textContent = t('transactions.createBalanceNone');
      balanceDisplay.className = 'text-[13px] font-semibold text-red-600';
    }
  }

  let balanceTimer = null;
  const scheduleBalance = () => {
    clearTimeout(balanceTimer);
    balanceTimer = setTimeout(refreshBalance, 350);
  };
  qs('[name="plate"]', contentEl).addEventListener('input', scheduleBalance);
  qs('[data-user-search]', contentEl).addEventListener('input', scheduleBalance);

  applyVisibility();

  const modeToggle = qs('[data-mode-toggle]', contentEl);
  const existingBlock = qs('[data-existing-block]', contentEl);
  const newBlock = qs('[data-new-block]', contentEl);
  modeToggle.addEventListener('change', (e) => {
    if (!e.target.matches('input[name="userMode"]')) return;
    const isExisting = e.target.value === 'existing';
    existingBlock.classList.toggle('hidden', !isExisting);
    newBlock.classList.toggle('hidden', isExisting);
    if (!isExisting) newBlock.classList.add('grid');
    modeToggle.querySelectorAll('label').forEach((lbl) => {
      const inp = lbl.querySelector('input');
      lbl.classList.toggle('border-blueberry', inp.checked);
      lbl.classList.toggle('bg-blueberry/5', inp.checked);
      lbl.classList.toggle('border-frost-deep', !inp.checked);
    });
  });

  qs('[data-cancel]', contentEl).addEventListener('click', close);

  qs('[data-submit]', contentEl).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const errEl = qs('[data-err]', contentEl);
    errEl.classList.add('hidden');

    const type = qs('input[name="tType"]:checked', contentEl).value;
    const mode = qs('input[name="userMode"]:checked', contentEl).value;
    const plate = String(qs('[name="plate"]', contentEl).value || '').toUpperCase().trim();
    const paidBy = qs('[name="paidBy"]', contentEl).value;
    const autoCheckInEl = qs('input[name="autoCheckIn"]', contentEl);
    const autoCheckIn = !!autoCheckInEl?.checked;

    if (!isValidLicensePlate(plate)) {
      errEl.textContent = t('checkins.errorInvalidPlate') || t('common.error');
      errEl.classList.remove('hidden');
      return;
    }

    // ── Credit check-in against an existing balance ──
    // No payer / new-user requirement and no money movement — we just
    // spend credits the customer already holds and put the car on the lot.
    if (type === 'credit' && getCreditMode() === 'use') {
      const creditsRaw = qs('[name="creditsToUse"]', contentEl).value;
      const credits = Number(creditsRaw);
      if (!creditsRaw || !Number.isInteger(credits) || credits <= 0) {
        errEl.textContent = t('transactions.errorMissingCredits');
        errEl.classList.remove('hidden');
        return;
      }
      const matchedCustomerId = mode === 'existing' ? resolveMatchedCustomerId() : null;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const result = await checkInWithCreditsFn({ plate, customerId: matchedCustomerId, credits });
        showToast(t('transactions.createCheckInSuccess', { n: credits }), 'success');
        close();
        onDone?.(result?.data || { checkedIn: true });
      } catch (err) {
        console.error('checkInWithCredits', err);
        errEl.textContent = creditCheckInError(err);
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = t('transactions.createCheckInSubmit');
      }
      return;
    }

    let payerEmail = '';
    let payerName = '';
    let customerId = null;

    if (mode === 'existing') {
      const search = String(qs('[data-user-search]', contentEl).value || '').trim().toLowerCase();
      if (!search) {
        errEl.textContent = t('transactions.createPickUser');
        errEl.classList.remove('hidden');
        return;
      }
      const matched = users.find(u =>
        (u.email || '').toLowerCase() === search
        || (u.displayName || '').toLowerCase() === search
      );
      if (matched) {
        payerEmail = matched.email || '';
        payerName = matched.displayName || '';
        customerId = matched.id;
      } else if (isValidEmail(search)) {
        payerEmail = search;
      } else {
        errEl.textContent = t('transactions.createPickUser');
        errEl.classList.remove('hidden');
        return;
      }
    } else {
      const newName = String(qs('[name="newName"]', contentEl).value || '').trim();
      const newEmail = String(qs('[name="newEmail"]', contentEl).value || '').trim();
      if (!isValidEmail(newEmail)) {
        errEl.textContent = t('admin.usersError');
        errEl.classList.remove('hidden');
        return;
      }
      payerEmail = newEmail;
      payerName = newName;
    }

    btn.disabled = true;
    btn.textContent = '…';

    try {
      let result;
      if (type === 'longterm') {
        const dropoffRaw = qs('[name="dropoffAt"]', contentEl).value;
        const pickupRaw = qs('[name="pickupAt"]', contentEl).value;
        const totalRaw = qs('[name="totalPrice"]', contentEl).value;
        const totalPrice = Number(totalRaw);
        if (!dropoffRaw) throw new Error(t('transactions.errorMissingDropoff'));
        if (!pickupRaw) throw new Error(t('transactions.errorMissingPickup'));
        if (!totalRaw || !Number.isFinite(totalPrice) || totalPrice <= 0) {
          throw new Error(t('transactions.errorMissingTotal'));
        }
        // flatpickr stores values as `YYYY-MM-DD HH:MM` (space, local
        // time); swap the space for T so Date() reliably parses as local.
        const dropoffAt = new Date(String(dropoffRaw).replace(' ', 'T')).toISOString();
        const pickupAt = new Date(String(pickupRaw).replace(' ', 'T')).toISOString();
        if (Date.parse(pickupAt) <= Date.parse(dropoffAt)) {
          throw new Error(t('transactions.errorPickupBeforeDropoff'));
        }
        const days = Math.max(1, Math.ceil((Date.parse(pickupAt) - Date.parse(dropoffAt)) / 86_400_000));
        result = await adminCreateLongtermBookingFn({
          plate, dropoffAt, pickupAt, days, totalPrice,
          payerEmail, payerName, customerId,
          paidBy, autoCheckIn,
        });
      } else {
        const qtyRaw = qs('[name="quantity"]', contentEl).value;
        const amtRaw = qs('[name="amount"]', contentEl).value;
        const quantity = Number(qtyRaw);
        const amount = Number(amtRaw);
        if (!qtyRaw || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(t('transactions.errorMissingQuantity'));
        }
        if (!amtRaw || !Number.isFinite(amount) || amount <= 0) {
          throw new Error(t('transactions.errorMissingAmount'));
        }
        result = await grantCreditsForCashFn({
          plate, quantity, amount,
          payerEmail, payerName,
          paidBy, autoCheckIn,
        });
      }

      if (mode === 'new') {
        try {
          await adminSendInviteFn({ email: payerEmail, displayName: payerName, role: 'customer', locale });
          showToast(t('transactions.createInviteSent'), 'info');
        } catch (err) {
          console.warn('invite send failed (transaction still created):', err?.message);
        }
      }

      const checkedIn = !!result?.data?.checkedIn;
      showToast(
        checkedIn ? t('checkins.walkInDoneCheckedIn') : t('transactions.createSuccess'),
        'success',
      );
      close();
      onDone?.(result?.data || {});
    } catch (err) {
      console.error('createTransaction', err);
      errEl.textContent = err?.message || t('common.error');
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = t('transactions.createSubmit');
    }
  });
}
