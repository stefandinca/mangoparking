import { html } from '../../utils/dom.js';

export function Loader(message = '') {
  return html`
    <div class="flex flex-col items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-frost-deep border-t-mango rounded-full animate-spin mb-4"></div>
      ${message ? `<p class="text-dim text-[15px]">${message}</p>` : ''}
    </div>
  `;
}

export function InlineLoader() {
  return html`<span class="inline-block w-4 h-4 border-2 border-frost-deep border-t-mango rounded-full animate-spin"></span>`;
}
