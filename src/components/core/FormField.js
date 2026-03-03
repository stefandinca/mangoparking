import { html } from '../../utils/dom.js';

export function FormField({ label, type = 'text', name, value = '', placeholder = '', required = false, error = '', options = null }) {
  if (type === 'select' && options) {
    return html`
      <div class="mb-4">
        <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${label}${required ? ' *' : ''}</label>
        <select name="${name}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors" ${required ? 'required' : ''}>
          ${options.map((opt) => `<option value="${opt.value}" ${opt.value === value ? 'selected' : ''}>${opt.label}</option>`).join('')}
        </select>
        ${error ? `<p class="text-danger text-[13px] mt-1">${error}</p>` : ''}
      </div>
    `;
  }

  if (type === 'textarea') {
    return html`
      <div class="mb-4">
        <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${label}${required ? ' *' : ''}</label>
        <textarea name="${name}" placeholder="${placeholder}" rows="4" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors resize-none" ${required ? 'required' : ''}>${value}</textarea>
        ${error ? `<p class="text-danger text-[13px] mt-1">${error}</p>` : ''}
      </div>
    `;
  }

  return html`
    <div class="mb-4">
      <label class="block text-[14px] font-medium text-charcoal/70 mb-1.5">${label}${required ? ' *' : ''}</label>
      <input type="${type}" name="${name}" value="${value}" placeholder="${placeholder}" class="w-full px-4 py-3 rounded-xl border border-frost-deep bg-white text-[15px] focus:outline-none focus:border-mango/40 transition-colors" ${required ? 'required' : ''}>
      ${error ? `<p class="text-danger text-[13px] mt-1">${error}</p>` : ''}
    </div>
  `;
}
