/**
 * Create DOM element(s) from an HTML string.
 * Returns a single element or a DocumentFragment.
 */
export function html(strings, ...values) {
  const markup = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  const content = template.content;
  return content.children.length === 1 ? content.firstElementChild : content;
}

/**
 * Shortcut to querySelector
 */
export function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Shortcut to querySelectorAll (returns array)
 */
export function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

/**
 * Mount a component into a target element (replaces children)
 */
export function mount(target, component) {
  if (typeof target === 'string') target = qs(target);
  if (!target) return;
  target.innerHTML = '';
  if (typeof component === 'string') {
    target.innerHTML = component;
  } else if (component instanceof Node) {
    target.appendChild(component);
  }
  return target;
}

/**
 * Create an element with attributes and children
 */
export function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') element.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value);
  }
  for (const child of children) {
    if (typeof child === 'string') element.appendChild(document.createTextNode(child));
    else if (child instanceof Node) element.appendChild(child);
  }
  return element;
}

/**
 * Delegate event listener
 */
export function delegate(parent, event, selector, handler) {
  if (typeof parent === 'string') parent = qs(parent);
  parent.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && parent.contains(target)) handler(e, target);
  });
}
