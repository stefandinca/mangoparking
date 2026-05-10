// Unified shuttle-driver / admin check-in dashboard.
//
// Three live sections on one page:
//   1. Currently parked  — longTerm bookings with status='active' AND
//                           activeCheckIns/* (credit sessions)
//   2. Expected today    — longTerm bookings with status='upcoming' whose
//                           startDate is within the next 24h; paid flag.
//   3. Pending payment   — pendingOrders awaiting cash/card at the lot
//                           (paymentMethod='pay-at-pickup' + paymentStatus='unpaid').
//
// All three subscribe to Firestore in real time so a second admin tab
// auto-refreshes when an action is taken from another device.

import { AdminLayout, initAdminNav } from '../../components/admin/AdminLayout.js';
import { html, qs, delegate } from '../../utils/dom.js';
import { t, getLocale } from '../../i18n/index.js';
import { updateMeta } from '../../utils/seo.js';
import { subscribeCollection, where } from '../../firebase/db.js';
import { showToast } from '../../components/core/Toast.js';
import { openModal } from '../../components/core/Modal.js';
import { checkInBooking, checkOutBooking } from '../../services/bookingService.js';
import { useToken, checkOut as creditCheckOut } from '../../services/tokenService.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config.js';
import { formatTime } from '../../utils/date.js';
import { isValidLicensePlate } from '../../utils/validators.js';

const adminMarkOrderPaidFn = httpsCallable(functions, 'adminMarkOrderPaid');
const grantCreditsForCashFn = httpsCallable(functions, 'grantCreditsForCash');

// Format an ISO timestamp as "HH:MM" today, "ieri HH:MM" yesterday, "DD/MM HH:MM" older.
function fmtMoment(iso, locale) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86_400_000);
  const startOfD = new Date(d); startOfD.setHours(0, 0, 0, 0);
  const time = formatTime(d, locale);
  if (startOfD.getTime() === today.getTime()) return time;
  if (startOfD.getTime() === yesterday.getTime()) return `${locale === 'ro' ? 'ieri' : 'yesterday'} ${time}`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

function plateBadge(plate) {
  return `<span class="font-mono font-bold text-[15px] tracking-wider">${plate || '—'}</span>`;
}

function typeBadge(type) {
  if (type === 'longTerm') return `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blueberry/10 text-blueberry">${t('checkins.typeLongTerm')}</span>`;
  if (type === 'credit') return `<span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mango/15 text-charcoal">${t('checkins.typeCredit')}</span>`;
  return `<span class="text-[11px] uppercase tracking-wider text-dim">${type || '—'}</span>`;
}

function paidBadge(status) {
  if (status === 'paid' || status === undefined) {
    // Treat missing field as paid (legacy docs before paymentStatus existed)
    return `<span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-leaf/10 text-leaf">●&nbsp;${t('checkins.paid')}</span>`;
  }
  return `<span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-danger/10 text-danger">●&nbsp;${t('checkins.unpaid')}</span>`;
}

export default function AdminCheckIns(container) {
  const locale = getLocale();
  updateMeta({ title: `${t('checkins.pageTitle')} — Admin`, lang: locale });

  // ── Live state ──────────────────────────────────────────────────────
  let bookings = [];          // bookings.status in ['upcoming', 'active']
  let activeCheckIns = [];    // activeCheckIns/*
  let pendingOrders = [];     // pendingOrders pay-at-pickup unpaid

  // ── Initial scaffold ────────────────────────────────────────────────
  const page = AdminLayout('/admin/checkins', `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="font-heading text-3xl font-bold tracking-tight text-blueberry-deep">${t('checkins.pageTitle')}</h1>
        <p class="text-dim text-[15px] mt-1">${t('checkins.pageSubtitle')}</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button data-action="walkin" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">${t('checkins.walkInBtn')}</button>
        <button data-action="grant" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] px-4 py-2.5 rounded-xl transition-colors">${t('checkins.grantBtn')}</button>
      </div>
    </div>

    <!-- Section 1: currently parked -->
    <section class="mb-8">
      <h2 class="font-heading font-bold text-lg text-charcoal mb-3 flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-leaf animate-pulse"></span>
        ${t('checkins.activeNow')}
        <span data-active-count class="text-dim text-[14px] font-medium">(0)</span>
      </h2>
      <div data-active-grid class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
    </section>

    <!-- Section 2: expected today -->
    <section class="mb-8">
      <h2 class="font-heading font-bold text-lg text-charcoal mb-3 flex items-center gap-2">
        ${t('checkins.expectedToday')}
        <span data-expected-count class="text-dim text-[14px] font-medium">(0)</span>
      </h2>
      <div data-expected-grid class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
    </section>

    <!-- Section 3: pending payment -->
    <section>
      <h2 class="font-heading font-bold text-lg text-charcoal mb-3 flex items-center gap-2">
        ${t('checkins.pendingPayment')}
        <span data-pending-count class="text-dim text-[14px] font-medium">(0)</span>
      </h2>
      <div data-pending-grid class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3"></div>
    </section>
  `);

  container.appendChild(page);
  initAdminNav(page);

  // ── Row renderers ───────────────────────────────────────────────────
  function activeRow(row) {
    const { kind, code, plate, type, checkinAt, key } = row;
    return `
      <div class="card-solid rounded-2xl p-4 flex flex-col gap-2" data-row data-kind="${kind}" data-key="${key}" data-plate="${plate || ''}">
        <div class="flex items-center justify-between gap-2">
          ${plateBadge(plate)}
          ${typeBadge(type)}
        </div>
        ${code ? `<p class="text-[12px] font-mono text-dim">${code}</p>` : ''}
        <p class="text-[13px] text-charcoal/70">${t('checkins.checkedInAt')} <span class="font-medium">${fmtMoment(checkinAt, locale)}</span></p>
        <button data-action="checkout" class="mt-1 bg-blueberry-deep hover:bg-blueberry-hover text-white font-semibold text-[13px] px-3 py-2 rounded-lg transition-colors">${t('checkins.checkOut')}</button>
      </div>
    `;
  }

  function expectedRow(b) {
    const paid = b.paymentStatus !== 'unpaid';
    return `
      <div class="card-solid rounded-2xl p-4 flex flex-col gap-2" data-row data-kind="booking" data-key="${b.id}" data-plate="${b.licensePlate}">
        <div class="flex items-center justify-between gap-2">
          ${plateBadge(b.licensePlate)}
          ${typeBadge(b.type)}
        </div>
        ${b.code ? `<p class="text-[12px] font-mono text-dim">${b.code}</p>` : ''}
        <p class="text-[13px] text-charcoal/70">${t('checkins.expectedAt')} <span class="font-medium">${fmtMoment(b.dropoffAt || b.startDate, locale)}</span></p>
        <div class="flex items-center justify-between gap-2 mt-1">
          ${paidBadge(b.paymentStatus)}
          ${paid
            ? `<button data-action="checkin" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[13px] px-3 py-1.5 rounded-lg transition-colors">${t('checkins.checkIn')}</button>`
            : `<button data-action="markpaid" data-order-id="${b.paymentId || ''}" class="bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[13px] px-3 py-1.5 rounded-lg transition-colors">${t('checkins.markPaid')}</button>`
          }
        </div>
      </div>
    `;
  }

  function pendingOrderRow(o) {
    const plate = o.customerData?.licensePlate || '—';
    return `
      <div class="card-solid rounded-2xl p-4 flex flex-col gap-2" data-row data-kind="pendingOrder" data-key="${o.id}" data-plate="${plate}">
        <div class="flex items-center justify-between gap-2">
          ${plateBadge(plate)}
          <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-mango/15 text-charcoal">${o.quantity || '?'} ${t('checkins.credits')}</span>
        </div>
        <p class="text-[13px] text-charcoal/70">${o.customerData?.name || '—'} · ${o.customerData?.email || ''}</p>
        <p class="text-[12px] text-dim">${o.amount ? `${o.amount} lei` : ''}</p>
        <button data-action="markpaid" data-order-id="${o.id}" class="mt-1 bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[13px] px-3 py-2 rounded-lg transition-colors">${t('checkins.markPaid')}</button>
      </div>
    `;
  }

  // ── Section re-renders ──────────────────────────────────────────────
  function renderActive() {
    // Compose unified list: long-term active bookings + credit-type active
    // bookings + activeCheckIns/* (credit sessions without a booking doc).
    const activeRows = [];

    for (const b of bookings) {
      if (b.status !== 'active') continue;
      activeRows.push({
        kind: 'booking',
        key: b.id,
        code: b.code,
        plate: b.licensePlate,
        type: b.type,
        checkinAt: b.checkinTimestamp || b.startDate,
      });
    }
    // activeCheckIns may reference a booking via balanceDocId; we render
    // them as standalone rows since the dashboard's main signal is the
    // plate itself (not which doc represents the session).
    for (const ck of activeCheckIns) {
      // Skip if a credit-type booking already covers the same plate to
      // avoid duplicates.
      if (activeRows.some((r) => r.plate === ck.licensePlate)) continue;
      activeRows.push({
        kind: 'activeCheckIn',
        key: ck.id,
        code: null,
        plate: ck.licensePlate,
        type: 'credit',
        checkinAt: ck.checkinTime,
      });
    }
    // Sort: newest check-in first.
    activeRows.sort((a, b) => (b.checkinAt || '').localeCompare(a.checkinAt || ''));

    const grid = qs('[data-active-grid]', page);
    grid.innerHTML = activeRows.length === 0
      ? `<p class="col-span-full text-center text-dim py-6">${t('checkins.noneActive')}</p>`
      : activeRows.map(activeRow).join('');
    qs('[data-active-count]', page).textContent = `(${activeRows.length})`;
  }

  function renderExpected() {
    // 24h window ahead, status='upcoming'.
    const windowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expected = bookings
      .filter((b) => b.status === 'upcoming')
      .filter((b) => {
        const ts = new Date(b.dropoffAt || b.startDate).getTime();
        return Number.isFinite(ts) && ts >= now - windowMs && ts <= now + windowMs;
      })
      .sort((a, b) => (a.dropoffAt || a.startDate || '').localeCompare(b.dropoffAt || b.startDate || ''));

    const grid = qs('[data-expected-grid]', page);
    grid.innerHTML = expected.length === 0
      ? `<p class="col-span-full text-center text-dim py-6">${t('checkins.noneExpected')}</p>`
      : expected.map(expectedRow).join('');
    qs('[data-expected-count]', page).textContent = `(${expected.length})`;
  }

  function renderPending() {
    const grid = qs('[data-pending-grid]', page);
    grid.innerHTML = pendingOrders.length === 0
      ? `<p class="col-span-full text-center text-dim py-6">${t('checkins.nonePending')}</p>`
      : pendingOrders.map(pendingOrderRow).join('');
    qs('[data-pending-count]', page).textContent = `(${pendingOrders.length})`;
  }

  // ── Subscriptions ───────────────────────────────────────────────────
  const unsubs = [];

  // bookings: status in [upcoming, active]. Firestore doesn't allow
  // 'in' with 2 values cheaply for live subscriptions in our wrapper,
  // so subscribe broadly and filter client-side. Volume is tiny.
  unsubs.push(subscribeCollection('bookings', (rows) => {
    bookings = rows.filter((b) => b.status === 'upcoming' || b.status === 'active');
    renderActive();
    renderExpected();
  }));

  unsubs.push(subscribeCollection('activeCheckIns', (rows) => {
    activeCheckIns = rows;
    renderActive();
  }));

  unsubs.push(subscribeCollection('pendingOrders', (rows) => {
    pendingOrders = rows.filter(
      (o) => o.paymentMethod === 'pay-at-pickup' && o.paymentStatus !== 'paid' && o.status !== 'paid'
    );
    renderPending();
  }, where('paymentMethod', '==', 'pay-at-pickup')));

  // Empty paint while data loads.
  renderActive();
  renderExpected();
  renderPending();

  // ── Action handlers ─────────────────────────────────────────────────
  delegate(page, 'click', '[data-action]', async (e, target) => {
    const action = target.dataset.action;
    const row = target.closest('[data-row]');
    if (action === 'walkin') return openWalkInDialog();
    if (action === 'grant') return openGrantDialog();
    if (!row) return;

    const kind = row.dataset.kind;
    const key = row.dataset.key;
    const plate = row.dataset.plate;

    target.disabled = true;
    try {
      if (action === 'checkin') {
        // Long-term booking check-in. No spot assignment yet (left manual
        // via /admin/capacity); the row flips to "active" in real time.
        await checkInBooking(key, null);
        showToast(t('checkins.toastCheckedIn'), 'success');
      } else if (action === 'checkout') {
        if (kind === 'booking') {
          await checkOutBooking(key);
        } else if (kind === 'activeCheckIn') {
          await creditCheckOut(plate);
        }
        showToast(t('checkins.toastCheckedOut'), 'success');
      } else if (action === 'markpaid') {
        const orderId = target.dataset.orderId;
        if (!orderId) {
          showToast(t('checkins.errorNoOrderId'), 'error');
          return;
        }
        await openMarkPaidDialog(orderId);
      }
    } catch (err) {
      console.error('Check-in dashboard action failed:', err);
      showToast(err?.message || t('common.error'), 'error');
    } finally {
      target.disabled = false;
    }
  });

  // ── Dialogs ─────────────────────────────────────────────────────────
  function openMarkPaidDialog(orderId) {
    return new Promise((resolve) => {
      const body = html`<div class="space-y-4">
        <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.markPaid')}</h3>
        <p class="text-[14px] text-charcoal/80">${t('checkins.markPaidPrompt')}</p>
        <div class="grid grid-cols-2 gap-2">
          <button data-pay="cash" class="bg-leaf hover:bg-leaf/90 text-white font-semibold text-[14px] py-3 rounded-xl transition-colors">${t('checkins.payCash')}</button>
          <button data-pay="card" class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] py-3 rounded-xl transition-colors">${t('checkins.payCard')}</button>
        </div>
      </div>`;
      const modal = openModal(body, { onClose: () => resolve() });
      body.querySelectorAll('[data-pay]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const paidBy = btn.dataset.pay;
          btn.disabled = true;
          btn.textContent = t('common.loading');
          try {
            await adminMarkOrderPaidFn({ orderId, paidBy });
            showToast(t('checkins.toastMarkedPaid'), 'success');
            modal.close();
            resolve();
          } catch (err) {
            console.error(err);
            showToast(err?.message || t('common.error'), 'error');
            btn.disabled = false;
            btn.textContent = paidBy === 'cash' ? t('checkins.payCash') : t('checkins.payCard');
          }
        });
      });
    });
  }

  function openGrantDialog() {
    const form = html`<form class="space-y-3" data-grant-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.grantTitle')}</h3>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPlate')} *</label>
        <input name="plate" required placeholder="B 123 ABC" autocomplete="off" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] uppercase font-mono focus:outline-none focus:border-blueberry">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldQty')} *</label>
          <input name="quantity" type="number" min="1" max="100" required value="1" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPaidBy')}</label>
          <select name="paidBy" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
            <option value="cash">${t('checkins.payCash')}</option>
            <option value="card">${t('checkins.payCard')}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPayerEmail')}</label>
        <input name="payerEmail" type="email" placeholder="optional" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      </div>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPayerName')}</label>
        <input name="payerName" placeholder="optional" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
      </div>
      <button type="submit" class="w-full bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[14px] py-3 rounded-xl transition-colors mt-2">${t('checkins.grantSubmit')}</button>
    </form>`;
    const modal = openModal(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const plate = fd.get('plate').toUpperCase().trim();
      if (!isValidLicensePlate(plate)) {
        showToast(t('checkins.errorInvalidPlate'), 'error');
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('common.loading');
      try {
        await grantCreditsForCashFn({
          plate,
          quantity: Number(fd.get('quantity')),
          paidBy: fd.get('paidBy'),
          payerEmail: fd.get('payerEmail') || '',
          payerName: fd.get('payerName') || '',
        });
        showToast(t('checkins.toastGranted'), 'success');
        modal.close();
      } catch (err) {
        console.error(err);
        showToast(err?.message || t('common.error'), 'error');
        btn.disabled = false;
        btn.textContent = t('checkins.grantSubmit');
      }
    });
  }

  function openWalkInDialog() {
    const form = html`<form class="space-y-3" data-walkin-form>
      <h3 class="font-heading font-bold text-xl text-blueberry-deep">${t('checkins.walkInTitle')}</h3>
      <p class="text-[13px] text-charcoal/70">${t('checkins.walkInHint')}</p>
      <div>
        <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPlate')} *</label>
        <input name="plate" required placeholder="B 123 ABC" autocomplete="off" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] uppercase font-mono focus:outline-none focus:border-blueberry">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldQty')}</label>
          <input name="quantity" type="number" min="1" max="100" value="1" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] font-mono focus:outline-none focus:border-blueberry">
        </div>
        <div>
          <label class="block text-[13px] font-medium text-charcoal/70 mb-1">${t('checkins.fieldPaidBy')}</label>
          <select name="paidBy" class="w-full px-4 py-2.5 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-blueberry">
            <option value="cash">${t('checkins.payCash')}</option>
            <option value="card">${t('checkins.payCard')}</option>
          </select>
        </div>
      </div>
      <button type="submit" class="w-full bg-mango hover:bg-mango-hover text-charcoal font-semibold text-[14px] py-3 rounded-xl transition-colors mt-2">${t('checkins.walkInSubmit')}</button>
    </form>`;
    const modal = openModal(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const plate = fd.get('plate').toUpperCase().trim();
      const quantity = Number(fd.get('quantity'));
      if (!isValidLicensePlate(plate)) {
        showToast(t('checkins.errorInvalidPlate'), 'error');
        return;
      }
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('common.loading');
      try {
        // Step 1 — grant the credits (creates/updates tokenBalances/plate_X)
        const result = await grantCreditsForCashFn({
          plate,
          quantity,
          paidBy: fd.get('paidBy'),
        });
        const balanceDocId = result?.data?.balanceDocId;
        if (!balanceDocId) throw new Error('Grant succeeded but no balance ID returned');
        // Step 2 — use a token + create activeCheckIns/{plate}
        await useToken(balanceDocId, plate);
        showToast(t('checkins.toastWalkInDone'), 'success');
        modal.close();
      } catch (err) {
        console.error(err);
        showToast(err?.message || t('common.error'), 'error');
        btn.disabled = false;
        btn.textContent = t('checkins.walkInSubmit');
      }
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────────────
  return () => {
    unsubs.forEach((u) => { try { u(); } catch { /* noop */ } });
  };
}
