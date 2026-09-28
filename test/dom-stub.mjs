/**
 * Shared headless DOM/window stubs for Node-based tests/benches.
 * (Extracted from smoke-test.mjs, round 7)
 */
// ---------------------------------------------------------------------------
// DOM / window stubs
// ---------------------------------------------------------------------------
const ctx2dStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray((w || 256) * (h || 256) * 4), width: w || 256, height: h || 256 });
    if (k === 'putImageData' || k === 'drawImage') return () => {};
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 256, height: 256 };
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    value: '1.0',
    checked: true,
    disabled: false,
    parentNode: null,
    children: [],
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: (c) => { c.parentNode = el; el.children.push(c); return c; },
    removeChild: (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => ctx2dStub,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  };
  if (tag === 'canvas') { el.width = 256; el.height = 256; }
  return el;
}

const elementRegistry = new Map();
const getElementById = (id) => {
  if (!elementRegistry.has(id)) elementRegistry.set(id, makeEl('div', id));
  return elementRegistry.get(id);
};

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  performance,
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
};
global.self = global.window;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => null, maxTouchPoints: 0 },
    configurable: true,
    writable: true,
  });
} catch (e) {
  // navigator already defined and immutable - leave as is
}
global.document = {
  getElementById,
  createElement: (tag) => makeEl(tag),
  createTextNode: (t) => ({ textContent: t }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  body: makeEl('body'),
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
export {};
