import { GlobalWindow } from 'happy-dom';

const win = new GlobalWindow({ url: 'http://localhost:3000' });

globalThis.window = win as any;
globalThis.document = win.document as any;
globalThis.HTMLElement = win.HTMLElement as any;
globalThis.HTMLButtonElement = win.HTMLButtonElement as any;
globalThis.Element = win.Element as any;
globalThis.Node = win.Node as any;

try {
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  });
} catch {
  (globalThis as any).navigator = win.navigator;
}

globalThis.getComputedStyle = ((el: any) => {
  const style = win.getComputedStyle(el);
  return new Proxy(style, {
    get(target, prop) {
      if (prop === 'animationName') return 'none';
      return (target as any)[prop];
    },
  });
}) as any;
globalThis.MutationObserver = win.MutationObserver as any;
globalThis.ResizeObserver = win.ResizeObserver as any;
globalThis.NodeFilter = win.NodeFilter as any;
globalThis.Event = win.Event as any;
globalThis.CustomEvent = win.CustomEvent as any;
globalThis.KeyboardEvent = win.KeyboardEvent as any;
globalThis.MouseEvent = win.MouseEvent as any;
globalThis.FocusEvent = win.FocusEvent as any;
globalThis.requestAnimationFrame = ((cb: any) => setTimeout(cb, 0)) as any;
globalThis.cancelAnimationFrame = ((id: any) => clearTimeout(id)) as any;

export { win };
