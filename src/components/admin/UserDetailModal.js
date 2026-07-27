// Admin "user detail" modal — opened from the /admin/users name cell.
//
// Given a users/{uid} doc (already loaded by AdminUsers), it pulls together
// everything tied to that account and shows it in one read-only panel:
//   - profile + contact (from the user doc itself)
//   - saved vehicles + billing identity (fields on the user doc)
//   - credit balance            tokenBalances/{uid}
//   - credit transactions       tokenTransactions where customerId == uid
//   - bookings                  bookings where customerId == uid (+ contact.email)
//   - vouchers                  promoVouchers assigned + legacy vouchers/{uid}
//                               (voucherRedemptions used to flag "spent" promos)
//
// The shared core/Modal openModal() is capped at max-w-lg which is too tight
// for this many sections, so this builds its own wider overlay (same
// backdrop-click / Escape behaviour).

import { html, qs, escapeHtml } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { getCollection, getDocument, where, orderBy, limit } from '../../firebase/db.js';
import { getBalance, getTransactions } from '../../services/tokenService.js';
import { showToast } from '../core/Toast.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { getUserProfile } from '../../firebase/auth.js';
import { billingFieldsHtml, wireBillingToggle, readBilling } from '../widgets/BillingFields.js';
import { isValidPhone, isValidLicensePlate, required } from '../../utils/validators.js';
import { phoneField, phoneValue } from '../core/PhoneField.js';
import { listVouchers } from '../../services/promoVoucherService.js';
import { buildSingleUserExport } from '../../services/userExportService.js';
import { buildCsv, downloadCsv, todayStamp, slugify } from '../../utils/csv.js';
import { reservationCodeHtml, wireReservationLinks } from './reservationLink.js';

const adminUpdateUserProfileFn = httpsCallable(functions, 'adminUpdateUserProfile');
const adminGrantCreditsFn = httpsCallable(functions, 'adminGrantCredits');
const adminDeductCreditsFn = httpsCallable(functions, 'adminDeductCredits');
const adminAssignVoucherFn = httpsCallable(functions, 'adminAssignVoucher');

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return String(iso); }
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch { return String(iso); }
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('ro-RO')} RON`;
}

const TX_TYPE_KEYS = {
  purchase: 'credit.typePurchase',
  use: 'credit.typeUse',
  refund: 'credit.typeRefund',
  lateFee: 'credit.typeLateFee',
  adjustment: 'credit.typeAdjustment',
  extension: 'transactions.typeExtension',
};
function txTypeLabel(type) {
  return TX_TYPE_KEYS[type] ? t(TX_TYPE_KEYS[type]) : (type || '—');
}

const STATUS_CLS = {
  upcoming: 'bg-blueberry/10 text-blueberry',
  active: 'bg-leaf/10 text-leaf',
  completed: 'bg-gray-100 text-dim',
  cancelled: 'bg-red-100 text-red-500',
  'no-show': 'bg-red-100 text-red-500',
  paid: 'bg-leaf/10 text-leaf',
  unpaid: 'bg-mango/10 text-mango',
  'refund-pending': 'bg-mango/10 text-mango',
  refunded: 'bg-gray-100 text-dim',
};

function badge(value) {
  if (!value) return '—';
  const cls = STATUS_CLS[value] || 'bg-gray-100 text-dim';
  return `<span class="inline-block text-[11px] uppercase tracking-wider font-mono font-semibold px-2 py-0.5 rounded-full ${cls}">${escapeHtml(value)}</span>`;
}

function row(label, valueHtml) {
  return `
    <div class="flex justify-between gap-4 py-1.5 border-b border-frost-deep/60 last:border-0">
      <span class="text-[13px] text-dim shrink-0">${label}</span>
      <span class="text-[13px] text-charcoal text-right break-words min-w-0">${valueHtml}</span>
    </div>`;
}

function sectionCard(title, count, innerHtml) {
  const counter = count != null ? `<span class="text-[12px] text-dim font-mono">${count}</span>` : '';
  return `
    <section class="bg-white rounded-2xl border border-frost-deep p-4">
      <header class="flex items-baseline justify-between mb-3">
        <h3 class="font-heading text-[14px] font-bold text-blueberry-deep uppercase tracking-wider">${title}</h3>
        ${counter}
      </header>
      ${innerHtml}
    </section>`;
}

function emptyLine() {
  return `<p class="text-[13px] text-dim">${t('admin.usersDetail.none')}</p>`;
}

// ── Section renderers ──

function profileHtml(u) {
  const d = t('admin.usersDetail');
  const email = u.email
    ? `<a href="mailto:${escapeHtml(u.email)}" class="text-blueberry hover:underline font-mono">${escapeHtml(u.email)}</a>`
    : '—';
  const phone = u.phone
    ? `<a href="tel:${escapeHtml(u.phone)}" class="text-blueberry hover:underline">${escapeHtml(u.phone)}</a>`
    : '—';
  return sectionCard(d.profile, null, `
    ${row(d.email, email)}
    ${row(d.phone, phone)}
    ${row(d.role, escapeHtml(t('admin.usersRole.' + (u.role === 'staff' ? 'agent' : (u.role || 'customer'))) || u.role || '—'))}
    ${row(d.createdAt, escapeHtml(fmtDateTime(u.createdAt)))}
    ${row(d.locale, escapeHtml((u.locale || '—').toUpperCase()))}
    ${row(d.uid, `<span class="font-mono text-[12px]">${escapeHtml(u.id || '—')}</span>`)}
  `);
}

// Same normalization the server uses (normalizePlate) so plates from different
// sources dedupe: uppercase, strip spaces and hyphens.
function normPlate(p) {
  return String(p == null ? '' : p).toUpperCase().replace(/[\s-]/g, '');
}

// `extraPlates` are plates seen on this customer's reservations / credit
// balances that aren't (yet) saved as a vehicle. Shown display-only, tagged, so
// the plate is visible in this section immediately — before addPlateToProfile /
// mergeGuestData persist it to users.vehicles (which only happens on a new
// booking or the customer's next login).
function vehiclesHtml(u, extraPlates = []) {
  const saved = Array.isArray(u.vehicles) ? u.vehicles : [];
  const savedNorm = new Set(saved.map((v) => normPlate(typeof v === 'string' ? v : v?.plate)));
  const extra = [...new Set(extraPlates.map(normPlate))].filter((p) => p && !savedNorm.has(p));
  const count = saved.length + extra.length;
  if (!count) return sectionCard(t('admin.usersDetail.vehicles'), 0, emptyLine());

  const savedItems = saved.map((v) => {
    const plate = typeof v === 'string' ? v : (v.plate || '');
    const meta = typeof v === 'object'
      ? [v.make, v.model].filter(Boolean).join(' ')
      : '';
    return `
      <li class="flex items-center justify-between gap-3 py-1.5 border-b border-frost-deep/60 last:border-0">
        <span class="font-mono font-semibold text-[13px] text-charcoal">${escapeHtml(plate || '—')}</span>
        ${meta ? `<span class="text-[12px] text-dim">${escapeHtml(meta)}</span>` : ''}
      </li>`;
  }).join('');
  const extraItems = extra.map((plate) => `
      <li class="flex items-center justify-between gap-3 py-1.5 border-b border-frost-deep/60 last:border-0">
        <span class="font-mono font-semibold text-[13px] text-charcoal">${escapeHtml(plate)}</span>
        <span class="text-[11px] text-dim italic">${escapeHtml(t('admin.usersDetail.plateFromBookings'))}</span>
      </li>`).join('');

  return sectionCard(t('admin.usersDetail.vehicles'), count, `<ul>${savedItems}${extraItems}</ul>`);
}

function billingHtml(u) {
  const b = u.billing;
  const d = t('admin.usersDetail');
  if (!b || typeof b !== 'object' || Object.keys(b).length === 0) {
    return sectionCard(d.billing, null, emptyLine());
  }
  const lines = [];
  if (b.type) lines.push(row(d.billingType, escapeHtml(b.type)));
  const name = b.companyName || [b.firstName, b.lastName].filter(Boolean).join(' ') || b.name;
  if (name) lines.push(row(d.billingName, escapeHtml(name)));
  if (b.cui) lines.push(row('CUI', escapeHtml(b.cui)));
  if (b.regCom) lines.push(row('Reg. Com.', escapeHtml(b.regCom)));
  if (b.cnp) lines.push(row('CNP', escapeHtml(b.cnp)));
  const address = b.companyAddress || b.address || [b.locality].filter(Boolean).join(', ');
  if (address) lines.push(row(d.billingAddress, escapeHtml(address)));
  return sectionCard(d.billing, null, lines.join('') || emptyLine());
}

function balanceHtml(balance, canGrant = false) {
  const d = t('admin.usersDetail');
  const grantBtn = canGrant
    ? `<button type="button" data-grant-credits class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[13px] py-2 rounded-lg transition-colors">${escapeHtml(d.grantCredits)}</button>`
    : '';
  if (!balance) {
    const actions = canGrant ? `<div class="mt-3">${grantBtn}</div>` : '';
    return sectionCard(d.balance, null, `${emptyLine()}${actions}`);
  }
  const plates = Array.isArray(balance.plates) && balance.plates.length
    ? balance.plates.map((p) => `<span class="font-mono">${escapeHtml(p)}</span>`).join(', ')
    : '—';
  // Remove is only offered when there's a balance to take from — the server
  // floors at 0, but showing it on an empty balance is pointless.
  const removeBtn = (canGrant && Number(balance.balance || 0) > 0)
    ? `<button type="button" data-remove-credits class="bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-[13px] py-2 rounded-lg transition-colors">${escapeHtml(d.removeCredits)}</button>`
    : '';
  const actions = canGrant
    ? `<div class="mt-3 grid ${removeBtn ? 'grid-cols-2' : 'grid-cols-1'} gap-2">${grantBtn}${removeBtn}</div>`
    : '';
  return sectionCard(d.balance, null, `
    ${row(d.balanceLabel, `<span class="font-bold text-blueberry-deep">${Number(balance.balance || 0)}</span>`)}
    ${row(d.totalPurchased, escapeHtml(String(balance.totalPurchased ?? 0)))}
    ${row(d.plates, plates)}
    ${actions}
  `);
}

// Wire the "Grant credits" / "Remove credits" actions inside the balance card.
// Delegated on the (persistent) balance slot so it survives the card ↔ form
// swaps. Grant adds free credits via adminGrantCredits; remove deducts them via
// adminDeductCredits (floored at 0 server-side). Neither moves cash.
function wireGrantCredits(body, user, initialBalance) {
  const slot = qs('[data-balance-slot]', body);
  if (!slot) return;
  const d = t('admin.usersDetail');
  let balance = initialBalance;

  slot.addEventListener('click', (e) => {
    if (e.target.closest('[data-grant-credits]')) openForm('grant');
    else if (e.target.closest('[data-remove-credits]')) openForm('remove');
    else if (e.target.closest('[data-grant-cancel]')) slot.innerHTML = balanceHtml(balance, true);
  });

  function openForm(mode) {
    const isRemove = mode === 'remove';
    const qtyLabel = isRemove ? d.removeQuantity : d.grantQuantity;
    const confirmLabel = isRemove ? d.removeConfirm : d.grantConfirm;
    const confirmCls = isRemove ? 'bg-red-500 hover:bg-red-600' : 'bg-leaf hover:bg-leaf/90';
    const focusCls = isRemove ? 'focus:border-red-400' : 'focus:border-leaf';
    slot.innerHTML = sectionCard(d.balance, null, `
      <form data-grant-form class="space-y-3">
        <div>
          <label class="block text-[13px] text-dim mb-1">${escapeHtml(qtyLabel)}</label>
          <input name="qty" type="number" min="1" step="1" value="1" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] font-mono focus:outline-none ${focusCls}">
        </div>
        <div>
          <label class="block text-[13px] text-dim mb-1">${escapeHtml(d.grantNote)}</label>
          <input name="note" type="text" placeholder="${escapeHtml(d.grantNotePlaceholder)}" class="w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] focus:outline-none ${focusCls}">
        </div>
        <p data-grant-err class="hidden text-[13px] text-red-500"></p>
        <div class="flex gap-2 justify-end">
          <button type="button" data-grant-cancel class="px-3 py-2 rounded-lg bg-frost text-charcoal/70 font-semibold text-[13px] hover:bg-frost-deep transition-colors">${escapeHtml(d.grantCancel)}</button>
          <button type="submit" class="${confirmCls} text-white font-semibold text-[13px] px-4 py-2 rounded-lg transition-colors">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>
    `);
    const form = qs('[data-grant-form]', slot);
    const errEl = qs('[data-grant-err]', slot);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const qty = Number(qs('[name="qty"]', slot).value);
      const note = qs('[name="note"]', slot).value.trim();
      if (!Number.isInteger(qty) || qty <= 0) {
        errEl.textContent = d.grantErrorQty; errEl.classList.remove('hidden'); return;
      }
      const submitBtn = qs('[data-grant-form] button[type="submit"]', slot);
      submitBtn.disabled = true;
      submitBtn.textContent = t('common.loading');
      try {
        if (isRemove) {
          const res = await adminDeductCreditsFn({ customerId: user.id, quantity: qty, note });
          const newBal = res?.data?.balance;
          const removed = res?.data?.removed ?? qty;
          balance = {
            ...(balance || { plates: [], totalPurchased: 0 }),
            balance: newBal != null ? newBal : Math.max(0, Number(balance?.balance || 0) - qty),
          };
          slot.innerHTML = balanceHtml(balance, true);
          showToast(t('admin.usersDetail.removeSuccess', { n: removed }), 'success');
        } else {
          const res = await adminGrantCreditsFn({ customerId: user.id, quantity: qty, note });
          const newBal = res?.data?.balance;
          balance = {
            ...(balance || { plates: [], totalPurchased: 0 }),
            balance: newBal != null ? newBal : (Number(balance?.balance || 0) + qty),
            totalPurchased: Number(balance?.totalPurchased || 0) + qty,
          };
          slot.innerHTML = balanceHtml(balance, true);
          showToast(t('admin.usersDetail.grantSuccess', { n: qty }), 'success');
        }
      } catch (err) {
        console.error('credit adjust', err);
        errEl.textContent = err?.message || t('common.error');
        errEl.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = confirmLabel;
      }
    });
  }
}

function vouchersHtml(promos, redemptionsByCode, legacy, canManage = false) {
  const d = t('admin.usersDetail');
  const cards = [];
  for (const v of promos) {
    const used = redemptionsByCode.has(v.code);
    const val = v.type === 'percent' ? `${v.value}%`
      : v.type === 'days' ? `${v.value} ${d.daysUnit}`
      : v.type === 'credits' ? `+${v.value} ${d.creditsUnit}`
      : fmtMoney(v.value);
    const removeBtn = canManage
      ? `<button type="button" data-voucher-remove="${escapeHtml(v.code)}" class="ml-2 text-[11px] text-red-500 hover:text-red-600 hover:underline shrink-0">${escapeHtml(d.voucherRemove)}</button>`
      : '';
    cards.push(`
      <li class="flex items-center justify-between gap-3 py-1.5 border-b border-frost-deep/60 last:border-0">
        <span class="min-w-0">
          <span class="font-mono font-semibold text-[13px] text-blueberry-deep">${escapeHtml(v.code)}</span>
          <span class="text-[12px] text-dim ml-2">${escapeHtml(v.name || '')}</span>
        </span>
        <span class="shrink-0 text-[13px] text-charcoal flex items-center">${val} ${used ? badge('used') : (v.active === false ? badge('inactive') : badge('active'))}${removeBtn}</span>
      </li>`);
  }
  if (legacy) {
    cards.push(`
      <li class="flex items-center justify-between gap-3 py-1.5 border-b border-frost-deep/60 last:border-0">
        <span class="text-[13px] text-charcoal">${escapeHtml(d.legacyVoucher)}</span>
        <span class="shrink-0 text-[13px]">${fmtMoney(legacy.amount)} ${badge(legacy.status === 'unused' ? 'active' : 'used')}</span>
      </li>`);
  }
  const count = promos.length + (legacy ? 1 : 0);
  const assignRow = canManage
    ? `<div data-voucher-assign class="mt-3 pt-3 border-t border-frost-deep/60">
        <button type="button" data-voucher-assign-open class="text-[13px] text-blueberry hover:underline font-semibold">${escapeHtml(d.voucherAssignOpen)}</button>
      </div>`
    : '';
  if (!count) return sectionCard(d.vouchers, 0, `${emptyLine()}${assignRow}`);
  return sectionCard(d.vouchers, count, `<ul>${cards.join('')}</ul>${assignRow}`);
}

// Wire assign/remove of private promo vouchers on the user record (admin only).
// Delegated on the (persistent) vouchers slot so it survives re-renders. Assign
// picks from the private vouchers not already on this user; both actions call
// the adminAssignVoucher callable (mutates promoVouchers.assignedUserIds).
function wireVouchers(body, user, promos, redemptionsByCode, legacy) {
  const slot = qs('[data-vouchers-slot]', body);
  if (!slot) return;
  const d = t('admin.usersDetail');
  let assigned = [...promos];
  let allPrivate = null; // lazy-loaded list of private vouchers

  const rerender = () => { slot.innerHTML = vouchersHtml(assigned, redemptionsByCode, legacy, true); };

  slot.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-voucher-remove]');
    const openAssign = e.target.closest('[data-voucher-assign-open]');
    const doAssign = e.target.closest('[data-voucher-assign-confirm]');
    const cancelAssign = e.target.closest('[data-voucher-assign-cancel]');

    if (rm) {
      const code = rm.dataset.voucherRemove;
      rm.disabled = true;
      try {
        await adminAssignVoucherFn({ code, customerId: user.id, assign: false });
        assigned = assigned.filter((v) => v.code !== code);
        rerender();
        showToast(t('admin.usersDetail.voucherRemoved', { code }), 'success');
      } catch (err) {
        console.error('adminAssignVoucher remove', err);
        showToast(err?.message || t('common.error'), 'error');
      }
      return;
    }

    if (openAssign) {
      const wrap = qs('[data-voucher-assign]', slot);
      if (wrap) wrap.innerHTML = `<p class="text-[13px] text-dim">${escapeHtml(t('common.loading'))}</p>`;
      try {
        if (!allPrivate) {
          const all = await listVouchers();
          allPrivate = all.filter((v) => v.visibility === 'private');
        }
        const assignedCodes = new Set(assigned.map((v) => v.code));
        const options = allPrivate.filter((v) => !assignedCodes.has(v.code));
        if (!options.length) {
          if (wrap) wrap.innerHTML = `<p class="text-[13px] text-dim">${escapeHtml(d.voucherNonePrivate)}</p>`;
          return;
        }
        const opts = options
          .map((v) => `<option value="${escapeHtml(v.code)}">${escapeHtml(v.code)}${v.name ? ' — ' + escapeHtml(v.name) : ''}</option>`)
          .join('');
        if (wrap) wrap.innerHTML = `
          <div class="flex gap-2 items-center">
            <select data-voucher-select class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry">${opts}</select>
            <button type="button" data-voucher-assign-confirm class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[13px] px-3 py-2 rounded-lg transition-colors shrink-0">${escapeHtml(d.voucherAssignConfirm)}</button>
            <button type="button" data-voucher-assign-cancel class="px-3 py-2 rounded-lg bg-frost text-charcoal/70 font-semibold text-[13px] hover:bg-frost-deep transition-colors shrink-0">${escapeHtml(d.grantCancel)}</button>
          </div>`;
      } catch (err) {
        console.error('listVouchers', err);
        if (wrap) wrap.innerHTML = `<p class="text-[13px] text-red-500">${escapeHtml(err?.message || t('common.error'))}</p>`;
      }
      return;
    }

    if (cancelAssign) { rerender(); return; }

    if (doAssign) {
      const sel = qs('[data-voucher-select]', slot);
      const code = sel?.value;
      if (!code) return;
      doAssign.disabled = true;
      try {
        await adminAssignVoucherFn({ code, customerId: user.id, assign: true });
        const v = (allPrivate || []).find((x) => x.code === code);
        if (v && !assigned.some((x) => x.code === code)) assigned.push(v);
        rerender();
        showToast(t('admin.usersDetail.voucherAssigned', { code }), 'success');
      } catch (err) {
        console.error('adminAssignVoucher assign', err);
        showToast(err?.message || t('common.error'), 'error');
        doAssign.disabled = false;
      }
      return;
    }
  });
}

function bookingsHtml(bookings) {
  const d = t('admin.usersDetail');
  if (!bookings.length) return sectionCard(d.bookings, 0, emptyLine());
  const rows = bookings.map((b) => {
    const start = b.dropoffAt || b.startDate;
    const end = b.pickupAt || b.endDate;
    const dates = start ? `${fmtDate(start)}${end ? ' → ' + fmtDate(end) : ''}` : '—';
    return `
      <tr class="border-t border-frost-deep">
        <td class="px-2 py-2 text-[12px]">${reservationCodeHtml(b)}</td>
        <td class="px-2 py-2 text-[12px] text-dim">${escapeHtml(b.type || '—')}</td>
        <td class="px-2 py-2 font-mono text-[12px] text-charcoal">${escapeHtml(b.licensePlate || '—')}</td>
        <td class="px-2 py-2 text-[12px] text-charcoal whitespace-nowrap">${escapeHtml(dates)}</td>
        <td class="px-2 py-2">${badge(b.status)}</td>
        <td class="px-2 py-2">${badge(b.paymentStatus)}</td>
        <td class="px-2 py-2 text-right text-[12px] text-charcoal whitespace-nowrap">${b.totalPrice != null ? fmtMoney(b.totalPrice) : '—'}</td>
      </tr>`;
  }).join('');
  return sectionCard(d.bookings, bookings.length, `
    <div class="overflow-x-auto -mx-1">
      <table class="w-full text-left">
        <thead class="text-[11px] uppercase tracking-wider text-charcoal/60">
          <tr>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.code}</th>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.type}</th>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.plate}</th>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.dates}</th>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.status}</th>
            <th class="px-2 py-1 font-semibold">${d.bookingCol.payment}</th>
            <th class="px-2 py-1 font-semibold text-right">${d.bookingCol.price}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

function transactionsHtml(txns) {
  const d = t('admin.usersDetail');
  if (!txns.length) return sectionCard(d.transactions, 0, emptyLine());
  const rows = txns.map((tx) => {
    const qty = Number(tx.quantity || 0);
    const qtyCls = qty > 0 ? 'text-leaf' : qty < 0 ? 'text-red-500' : 'text-dim';
    const qtyStr = qty > 0 ? `+${qty}` : String(qty);
    return `
      <tr class="border-t border-frost-deep">
        <td class="px-2 py-2 text-[12px] text-charcoal whitespace-nowrap">${escapeHtml(fmtDateTime(tx.timestamp))}</td>
        <td class="px-2 py-2 text-[12px] text-dim">${escapeHtml(txTypeLabel(tx.type))}</td>
        <td class="px-2 py-2 text-[12px] font-mono ${qtyCls} text-right">${qtyStr}</td>
        <td class="px-2 py-2 text-[12px] font-mono text-charcoal">${escapeHtml(tx.licensePlate || '—')}</td>
      </tr>`;
  }).join('');
  return sectionCard(d.transactions, txns.length, `
    <div class="overflow-x-auto -mx-1">
      <table class="w-full text-left">
        <thead class="text-[11px] uppercase tracking-wider text-charcoal/60">
          <tr>
            <th class="px-2 py-1 font-semibold">${d.txnCol.date}</th>
            <th class="px-2 py-1 font-semibold">${d.txnCol.type}</th>
            <th class="px-2 py-1 font-semibold text-right">${d.txnCol.qty}</th>
            <th class="px-2 py-1 font-semibold">${d.txnCol.plate}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

// ── Public entry ──

export function openUserDetailModal(user) {
  const d = t('admin.usersDetail');
  const headerName = escapeHtml(user.displayName || user.email || user.id || '—');
  // Edit is for the back-office roles that manage clients — admin/agent (incl.
  // the legacy 'staff' alias), matching the adminUpdateUserProfile guard. It
  // needs a real account (uid); a pure-guest booking reference has none.
  const canEdit = ['admin', 'agent', 'staff'].includes(getUserProfile()?.role) && !!user.id;
  // Export (invoice data) needs a back-office role but not an account — a guest
  // record resolved by email still has bookings worth exporting.
  const canExport = ['admin', 'agent', 'staff'].includes(getUserProfile()?.role);

  const overlay = html`
    <div class="fixed inset-0 z-[90] flex items-start sm:items-center justify-center p-4 overflow-y-auto" data-detail-overlay>
      <div class="absolute inset-0 bg-charcoal/60" data-detail-bg></div>
      <div class="relative bg-frost rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto my-4">
        <div class="sticky top-0 z-10 bg-white/95 backdrop-blur-0 border-b border-frost-deep px-6 py-4 flex items-start justify-between gap-4 rounded-t-3xl">
          <div class="min-w-0">
            <h2 data-detail-name class="font-heading text-xl font-bold text-blueberry-deep truncate">${headerName}</h2>
            <p class="text-[13px] text-dim truncate">${escapeHtml(user.email || '')}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${canExport ? `<button data-detail-export class="px-3 h-9 rounded-xl bg-white border border-frost-deep hover:bg-frost text-charcoal font-semibold text-[13px] transition-colors">${escapeHtml(d.export)}</button>` : ''}
            ${canEdit ? `<button data-detail-edit class="px-3 h-9 rounded-xl bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[13px] transition-colors">${escapeHtml(d.editProfile)}</button>` : ''}
            <button data-detail-close class="w-9 h-9 rounded-xl bg-frost hover:bg-frost-deep text-charcoal/70 flex items-center justify-center transition-colors" aria-label="${escapeHtml(d.close)}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div data-detail-body class="p-6 space-y-4">
          <div class="text-center py-10 text-dim text-[14px]">${escapeHtml(d.loading)}</div>
        </div>
      </div>
    </div>
  `;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', handleKey);
  };
  const handleKey = (e) => { if (e.key === 'Escape') close(); };
  qs('[data-detail-bg]', overlay).addEventListener('click', close);
  qs('[data-detail-close]', overlay).addEventListener('click', close);
  document.addEventListener('keydown', handleKey);
  document.body.appendChild(overlay);

  const body = qs('[data-detail-body]', overlay);
  if (canEdit) {
    const refreshHeader = (u) => {
      const h = qs('[data-detail-name]', overlay);
      if (h) h.textContent = u.displayName || u.email || u.id || '—';
    };
    qs('[data-detail-edit]', overlay).addEventListener('click', () => enterEditMode(user, body, refreshHeader));
  }
  if (canExport) {
    qs('[data-detail-export]', overlay).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = t('common.loading');
      try {
        const { headers, rows } = await buildSingleUserExport(user);
        const name = slugify(user.displayName || user.email || user.id);
        downloadCsv(`mango-user-${name}-${todayStamp()}.csv`, buildCsv(headers, rows));
        showToast(d.exportDone, 'success');
      } catch (err) {
        console.error('UserDetailModal: export failed', err);
        showToast(err?.message || t('common.error'), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  }
  loadAndRender(user, body);
  // Reservation codes in the Bookings section: a live one navigates to the
  // check-in page (close this modal first so it doesn't linger over it); a
  // historical one opens the read-only detail modal. No resolver — the handler
  // fetches the booking by id, so the detail modal gets the full record.
  wireReservationLinks(body, null, close);
  return { close };
}

// Replace the read-only profile/vehicles/billing view with an edit form
// (name, phone, vehicles, billing). Saves via the adminUpdateUserProfile
// callable (agents can't client-write another user's doc).
function enterEditMode(user, body, refreshHeader) {
  const d = t('admin.usersDetail');
  const veh = (Array.isArray(user.vehicles) ? user.vehicles : []).map((v) => (typeof v === 'string' ? { plate: v } : (v || {})));
  const inputCls = 'w-full px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry';
  const labelCls = 'block text-[13px] font-medium text-charcoal/70 mb-1';
  const vehRow = (v = {}) => `
    <div class="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center" data-veh-row>
      <input data-veh="plate" value="${escapeHtml(v.plate || '')}" placeholder="${escapeHtml(d.editPlate)}" class="${inputCls} uppercase font-mono">
      <input data-veh="make" value="${escapeHtml(v.make || '')}" placeholder="${escapeHtml(d.editMake)}" class="${inputCls}">
      <input data-veh="model" value="${escapeHtml(v.model || '')}" placeholder="${escapeHtml(d.editModel)}" class="${inputCls}">
      <button type="button" data-veh-remove class="w-8 h-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors" aria-label="${escapeHtml(d.editRemoveVehicle)}">✕</button>
    </div>`;

  body.innerHTML = `
    <form data-edit-profile-form class="space-y-4">
      <section class="bg-white rounded-2xl border border-frost-deep p-4">
        <div class="grid sm:grid-cols-2 gap-3">
          <div><label class="${labelCls}">${escapeHtml(d.editName)}</label><input name="displayName" value="${escapeHtml(user.displayName || '')}" class="${inputCls}"></div>
          <div><label class="${labelCls}">${escapeHtml(d.editPhone)} *</label>${phoneField({ name: 'phone', value: user.phone || '', inputClass: 'flex-1 min-w-0 px-3 py-2 rounded-lg border border-frost-deep bg-white text-[14px] focus:outline-none focus:border-blueberry', selectClass: 'shrink-0 w-[7rem] px-2 py-2 rounded-lg border border-frost-deep bg-white text-[13px] focus:outline-none focus:border-blueberry' })}</div>
        </div>
      </section>
      <section class="bg-white rounded-2xl border border-frost-deep p-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-heading text-[14px] font-bold text-blueberry-deep uppercase tracking-wider">${escapeHtml(d.vehicles)}</h3>
          <button type="button" data-veh-add class="text-[13px] text-blueberry hover:underline font-semibold">${escapeHtml(d.editAddVehicle)}</button>
        </div>
        <div class="space-y-2" data-veh-list>${veh.map(vehRow).join('')}</div>
      </section>
      ${billingFieldsHtml(user.billing)}
      <div data-edit-err class="hidden text-[13px] text-red-500"></div>
      <div class="flex gap-3 justify-end">
        <button type="button" data-edit-cancel class="px-4 py-2.5 rounded-xl bg-frost text-charcoal/70 font-semibold text-[14px] hover:bg-frost-deep transition-colors">${escapeHtml(d.editCancel)}</button>
        <button type="submit" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] px-5 py-2.5 rounded-xl transition-colors">${escapeHtml(d.editSave)}</button>
      </div>
    </form>
  `;
  wireBillingToggle(body);

  const errEl = qs('[data-edit-err]', body);
  const showErr = (m) => { errEl.textContent = m; errEl.classList.remove('hidden'); };
  const vehList = qs('[data-veh-list]', body);
  qs('[data-veh-add]', body).addEventListener('click', () => vehList.insertAdjacentHTML('beforeend', vehRow()));
  vehList.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-veh-remove]');
    if (rm) rm.closest('[data-veh-row]').remove();
  });
  qs('[data-edit-cancel]', body).addEventListener('click', () => loadAndRender(user, body));

  qs('[data-edit-profile-form]', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.classList.add('hidden');
    const displayName = qs('[name="displayName"]', body).value.trim();
    const phone = phoneValue(qs('[name="phone"]', body));
    if (!required(displayName)) return showErr(d.editErrorName);
    if (!isValidPhone(phone)) return showErr(d.editErrorPhone);

    const vehicles = [...body.querySelectorAll('[data-veh-row]')].map((r) => ({
      plate: r.querySelector('[data-veh="plate"]').value.trim().toUpperCase(),
      make: r.querySelector('[data-veh="make"]').value.trim(),
      model: r.querySelector('[data-veh="model"]').value.trim(),
    })).filter((v) => v.plate);
    if (vehicles.some((v) => !isValidLicensePlate(v.plate))) return showErr(d.editErrorPlate);

    // Billing is optional here — only validate if the admin actually entered
    // something; otherwise keep the existing billing unchanged.
    const billing = readBilling(body);
    let billingToSave;
    if (billing.error) {
      const touched = ['billingName', 'billingCompanyName', 'billingCui', 'billingLocality', 'billingPersonalAddress', 'billingCompanyAddress']
        .some((n) => (qs(`[name="${n}"]`, body)?.value || '').trim());
      if (touched) return showErr(billing.error);
      billingToSave = user.billing || {};
    } else {
      billingToSave = billing;
    }

    const submitBtn = qs('[data-edit-profile-form] button[type="submit"]', body);
    submitBtn.disabled = true;
    submitBtn.textContent = t('common.loading');
    try {
      await adminUpdateUserProfileFn({ uid: user.id, displayName, phone, billing: billingToSave, vehicles });
      user.displayName = displayName;
      user.phone = phone;
      user.billing = billingToSave;
      user.vehicles = vehicles;
      refreshHeader(user);
      showToast(d.editSaved, 'success');
      loadAndRender(user, body);
    } catch (err) {
      console.error('adminUpdateUserProfile', err);
      showErr(err?.message || t('common.error'));
      submitBtn.disabled = false;
      submitBtn.textContent = d.editSave;
    }
  });
}

// Exported as renderUserSections: the /admin/users?uid= profile page renders
// the same read-only sections below its activity block, so they stay in sync.
export { loadAndRender as renderUserSections };

async function loadAndRender(user, body) {
  const uid = user.id;
  const email = user.email;

  // Static sections render immediately from the user doc.
  const staticHtml = `
    <div class="grid sm:grid-cols-2 gap-4">
      <div data-profile-slot>${profileHtml(user)}</div>
      <div data-vehicles-slot>${vehiclesHtml(user)}</div>
      ${billingHtml(user)}
      <div data-balance-slot>${sectionCard(t('admin.usersDetail.balance'), null, `<p class="text-[13px] text-dim">${escapeHtml(t('admin.usersDetail.loading'))}</p>`)}</div>
    </div>
    <div data-vouchers-slot></div>
    <div data-bookings-slot></div>
    <div data-transactions-slot></div>
    <div data-detail-error class="hidden text-[13px] text-red-500 text-center pt-2"></div>
  `;
  body.innerHTML = staticHtml;

  // uid-keyed lookups only run for a real account. A guest reference (opened
  // from a booking with no customerId) has uid=null — we'd otherwise query
  // `customerId == null` and pull EVERY guest's rows. Bookings still resolve
  // by email so their history shows.
  const [balance, txns, byId, byEmail, promos, redemptions, legacy] = await Promise.all([
    uid ? getBalance(uid).catch(() => null) : Promise.resolve(null),
    uid ? getTransactions(uid, 50).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('bookings', where('customerId', '==', uid)).catch(() => []) : Promise.resolve([]),
    email ? getCollection('bookings', where('contact.email', '==', email)).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('promoVouchers', where('assignedUserIds', 'array-contains', uid)).catch(() => []) : Promise.resolve([]),
    uid ? getCollection('voucherRedemptions', where('userId', '==', uid)).catch(() => []) : Promise.resolve([]),
    uid ? getDocument('vouchers', uid).catch(() => null) : Promise.resolve(null),
  ]);

  // Merge bookings from both link paths, dedupe by doc id, newest first.
  const seen = new Set();
  const bookings = [];
  for (const b of [...byId, ...byEmail]) {
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    bookings.push(b);
  }
  bookings.sort((a, b) => {
    const ka = a.createdAt || a.dropoffAt || a.startDate || '';
    const kb = b.createdAt || b.dropoffAt || b.startDate || '';
    return String(kb).localeCompare(String(ka));
  });

  // A guest has no users doc — the phone/name they entered live on their
  // booking's `contact`, not a profile. Backfill from the newest booking so
  // the profile card shows them (fixes a blank phone for guest reservations).
  const fromBooking = bookings.find((b) => b.contact?.phone || b.contact?.name);
  if (fromBooking) {
    if (!user.phone && fromBooking.contact.phone) user.phone = fromBooking.contact.phone;
    if (!user.displayName && fromBooking.contact.name) user.displayName = fromBooking.contact.name;
    const pslot = qs('[data-profile-slot]', body);
    if (pslot) pslot.innerHTML = profileHtml(user);
  }

  const redemptionsByCode = new Map();
  for (const r of redemptions) if (r.voucherCode) redemptionsByCode.set(r.voucherCode, r);

  // Granting free credits is an agent/admin action and needs a real account.
  const canGrant = ['admin', 'agent', 'staff'].includes(getUserProfile()?.role) && !!uid;
  qs('[data-balance-slot]', body).innerHTML = balanceHtml(balance, canGrant);
  if (canGrant) wireGrantCredits(body, user, balance);
  // Voucher assign/remove is an admin-only config action (promoVouchers writes
  // are admin-gated in Firestore rules), so it's a tighter gate than canGrant.
  const canManageVouchers = getUserProfile()?.role === 'admin' && !!uid;
  qs('[data-vouchers-slot]', body).innerHTML = vouchersHtml(promos, redemptionsByCode, legacy, canManageVouchers);
  if (canManageVouchers) wireVouchers(body, user, promos, redemptionsByCode, legacy);
  qs('[data-bookings-slot]', body).innerHTML = bookingsHtml(bookings);
  qs('[data-transactions-slot]', body).innerHTML = transactionsHtml(txns);

  // Now that bookings + credit balance have loaded, surface the plates they
  // carry in the Vehicles section (display-only, deduped against saved
  // vehicles) so a guest reservation's plate shows even before it is persisted
  // to users.vehicles.
  const seenPlates = [
    ...bookings.map((b) => b.licensePlate).filter(Boolean),
    ...(balance && Array.isArray(balance.plates) ? balance.plates : []),
  ];
  const vslot = qs('[data-vehicles-slot]', body);
  if (vslot) vslot.innerHTML = vehiclesHtml(user, seenPlates);
}

// ── Open-from-anywhere helpers ──────────────────────────────────────────
// Other admin pages (check-ins, transactions, …) only have a customerId
// and/or a contact email, not the full users/{uid} doc. This resolves the
// reference to a user and opens the same modal. For a guest booking with no
// account, it opens a minimal record (email-only) so their booking history
// still shows.

export async function openUserDetail({ customerId = null, email = null, displayName = '' } = {}) {
  const cid = customerId && String(customerId).trim() ? String(customerId).trim() : null;
  const mail = email && String(email).trim() ? String(email).trim() : null;
  if (!cid && !mail) {
    showToast(t('admin.usersDetail.noRef'), 'info');
    return null;
  }

  let user = null;
  if (cid) {
    user = await getDocument('users', cid).catch(() => null);
    if (user && !user.id) user.id = cid;
  }
  // The customerId may point at the WRONG account: when a staff member creates
  // a booking while signed in (e.g. on the public site on a customer's behalf),
  // the booking's customerId is the staff uid, not the customer's. If the
  // resolved account's email doesn't match the reservation's contact email, it
  // isn't the person the booking is for — resolve by the contact email instead
  // so the modal shows (and lets us edit) the actual customer.
  if (user && mail && user.email && user.email.trim().toLowerCase() !== mail.trim().toLowerCase()) {
    const byMail = (await getCollection('users', where('email', '==', mail)).catch(() => []))[0];
    user = byMail || { id: null, email: mail, displayName: displayName || mail };
  }
  if (!user && mail) {
    const matches = await getCollection('users', where('email', '==', mail)).catch(() => []);
    user = matches[0] || null;
  }
  // No account on file — open a minimal record so bookings-by-email still show.
  if (!user) user = { id: cid, email: mail || '', displayName: displayName || mail || '' };
  return openUserDetailModal(user);
}

// Render a customer name as a clickable element that opens the detail modal.
// Falls back to a plain span when there's nothing to resolve (no id/email).
export function userNameButton({ customerId = null, email = null, name = '', className = '' } = {}) {
  const label = escapeHtml(name || email || '—');
  if (!customerId && !email) return `<span class="${className}">${label}</span>`;
  return `<button type="button" data-user-link data-uid="${escapeHtml(customerId || '')}" data-email="${escapeHtml(email || '')}" class="text-left hover:text-blueberry hover:underline transition-colors cursor-pointer ${className}">${label}</button>`;
}

// Delegate clicks on any [data-user-link] within a scope to the detail modal.
// Idempotent per scope; the listener lives on the page root so it survives
// in-place re-renders of the content below it.
export function wireUserLinks(scopeEl) {
  if (!scopeEl || scopeEl.__userLinksWired) return;
  scopeEl.__userLinksWired = true;
  scopeEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-user-link]');
    if (!el || !scopeEl.contains(el)) return;
    // Don't let the name click bubble to a row-level handler (e.g. the
    // overdue accordion toggle, which also guards against [data-user-link]).
    e.stopPropagation();
    openUserDetail({
      customerId: el.dataset.uid || null,
      email: el.dataset.email || null,
      displayName: el.textContent.trim(),
    });
  });
}
