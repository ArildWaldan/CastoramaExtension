/**
 * Utilitaires DOM partagés pour injection UI.
 */
export const waitForElement = async (selector, timeoutMs = 10000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const element = document.querySelector(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
};

export const createButton = (label, onClick, className = '') => {
  const button = document.createElement('button');
  button.textContent = label;
  button.className = className;
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
};

export const setReactInputValue = (input, value) => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  ['input', 'change', 'blur'].forEach((eventName) => {
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
};
