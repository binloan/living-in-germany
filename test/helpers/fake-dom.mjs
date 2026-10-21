// The smallest DOM the app's modules need to be imported and run in Node (`h()` in src/util.ts and src/busy.ts build elements at load time).
function element(tag) {
  const el = {
    tag, children: [], attrs: {}, style: {}, hidden: false, textContent: '', id: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { el.attrs[k] = v; },
    addEventListener() {},
    append(...kids) { el.children.push(...kids); },
    appendChild(k) { el.children.push(k); return k; },
    removeChild() {},
    get firstChild() { return null; },
    querySelector() { return element('span'); },
  };
  return el;
}
export function installFakeDom() {
  globalThis.document = { createElement: element, createTextNode: (text) => ({ text }) };
}
