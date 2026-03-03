import { html, qs } from '../../utils/dom.js';

export function openModal(content, { onClose } = {}) {
  const overlay = html`
    <div class="fixed inset-0 z-[90] flex items-center justify-center p-4" data-modal-overlay>
      <div class="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" data-modal-bg></div>
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

  qs('[data-modal-bg]', overlay).addEventListener('click', close);

  // Close on Escape
  const handleKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', handleKey);
    }
  };
  document.addEventListener('keydown', handleKey);

  document.body.appendChild(overlay);

  return { close, contentEl };
}
