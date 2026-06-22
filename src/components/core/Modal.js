import { html, qs } from '../../utils/dom.js';
import { t } from '../../i18n/index.js';

// `dismissible` (default true) controls whether the backdrop click and the
// Escape key close the modal. Pass `dismissible: false` for a blocking modal
// the user MUST act on (e.g. the complete-your-profile gate) — it can only be
// closed programmatically via the returned `close()`.
export function openModal(content, { onClose, dismissible = true } = {}) {
  const overlay = html`
    <div class="fixed inset-0 z-[90] flex items-center justify-center p-4" data-modal-overlay>
      <div class="absolute inset-0 bg-charcoal/60" data-modal-bg></div>
      <div class="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-8" data-modal-content></div>
    </div>
  `;

  const contentEl = qs('[data-modal-content]', overlay);
  if (typeof content === 'string') {
    contentEl.innerHTML = content;
  } else if (content instanceof Node) {
    contentEl.appendChild(content);
  }

  const close = () => {
    overlay.remove();
    onClose?.();
  };

  if (dismissible) {
    qs('[data-modal-bg]', overlay).addEventListener('click', close);

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', handleKey);
      }
    };
    document.addEventListener('keydown', handleKey);
  }

  document.body.appendChild(overlay);

  return { close, contentEl };
}

/**
 * Show a styled confirm dialog. Returns a Promise<boolean>.
 */
export function confirmModal(message, { confirmText, cancelText, danger = false } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    const confirmLabel = confirmText || t('common.confirm');
    const cancelLabel = cancelText || t('common.cancel');
    const btnColor = danger
      ? 'bg-red-500 hover:bg-red-600'
      : 'bg-blueberry hover:bg-blueberry-hover';

    const { close, contentEl } = openModal(`
      <div class="text-center">
        <div class="w-14 h-14 rounded-2xl ${danger ? 'bg-red-50' : 'bg-frost'} flex items-center justify-center mx-auto mb-5">
          ${danger
            ? '<svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>'
            : '<svg class="w-7 h-7 text-charcoal/60" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"/></svg>'
          }
        </div>
        <p class="text-[16px] text-charcoal leading-relaxed mb-8">${message}</p>
        <div class="flex gap-3 justify-center">
          <button data-modal-cancel class="px-6 py-3 rounded-xl bg-frost text-charcoal/70 font-semibold text-[15px] hover:bg-frost-deep transition-colors">${cancelLabel}</button>
          <button data-modal-confirm class="${btnColor} text-white font-semibold text-[15px] px-6 py-3 rounded-xl transition-colors">${confirmLabel}</button>
        </div>
      </div>
    `, {
      onClose: () => done(false),
    });

    contentEl.querySelector('[data-modal-cancel]').addEventListener('click', () => { done(false); close(); });
    contentEl.querySelector('[data-modal-confirm]').addEventListener('click', () => { done(true); close(); });
  });
}

/**
 * Show a styled alert dialog. Returns a Promise that resolves when dismissed.
 */
export function alertModal(message, { buttonText, type = 'info' } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const label = buttonText || 'OK';
    const iconMap = {
      info: { bg: 'bg-frost', svg: '<svg class="w-7 h-7 text-charcoal/60" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>' },
      success: { bg: 'bg-leaf/10', svg: '<svg class="w-7 h-7 text-leaf" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
      warning: { bg: 'bg-mango/10', svg: '<svg class="w-7 h-7 text-mango" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>' },
      error: { bg: 'bg-red-50', svg: '<svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0l8.354 14.748zM12 15.75h.007v.008H12v-.008z"/></svg>' },
    };
    const icon = iconMap[type] || iconMap.info;

    const { close, contentEl } = openModal(`
      <div class="text-center">
        <div class="w-14 h-14 rounded-2xl ${icon.bg} flex items-center justify-center mx-auto mb-5">
          ${icon.svg}
        </div>
        <p class="text-[16px] text-charcoal leading-relaxed mb-8">${message}</p>
        <button data-modal-ok class="bg-blueberry hover:bg-blueberry-hover text-white font-semibold text-[15px] px-8 py-3 rounded-xl transition-colors">${label}</button>
      </div>
    `, {
      onClose: () => done(),
    });

    contentEl.querySelector('[data-modal-ok]').addEventListener('click', () => { done(); close(); });
  });
}
