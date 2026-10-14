// @ts-check
// DOM falso mínimo pros testes de lógica pura que recebem `document` (mesmo estilo do selector.test.js).
// Suporta: tag, #id, .classe, [attr], [attr="v"], [attr^="v"], [attr$="v"], [attr*="v"], descendente e lista com vírgula.

/** @param {string} compound */
function parseCompound(compound) {
  const m = /^([a-z]+)?(.*)$/i.exec(compound) || [];
  const tag = m[1] ? m[1].toLowerCase() : '';
  const rest = m[2] || '';
  /** @type {Array<(el: any) => boolean>} */
  const tests = [];
  if (tag) tests.push((el) => el.tag === tag);
  const re = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([\^$*]?=)"([^"]*)")?\]/g;
  let t;
  while ((t = re.exec(rest))) {
    const [, id, cls, attr, op, val] = t;
    if (id) tests.push((el) => el.getAttribute('id') === id);
    else if (cls) tests.push((el) => (el.getAttribute('class') || '').split(/\s+/).includes(cls));
    else if (attr) {
      tests.push((el) => {
        if (!el.hasAttribute(attr)) return false;
        const v = el.getAttribute(attr);
        if (!op) return true;
        if (op === '=') return v === val;
        if (op === '^=') return v.startsWith(val);
        if (op === '$=') return v.endsWith(val);
        return v.includes(val);
      });
    }
  }
  return (/** @type {any} */ el) => tests.every((f) => f(el));
}

/** @param {any} el @param {string} selector */
export function matches(el, selector) {
  return selector.split(',').some((part) => {
    const comps = part.trim().split(/\s+/).map(parseCompound);
    if (!comps[comps.length - 1](el)) return false;
    let i = comps.length - 2;
    let anc = el.parent;
    while (i >= 0 && anc) { if (comps[i](anc)) i--; anc = anc.parent; }
    return i < 0;
  });
}

export class FakeEl {
  /** @param {string} tag @param {Record<string, string>} [attrs] */
  constructor(tag, attrs = {}) {
    this.tag = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    /** @type {Map<string, string>} */ this.attrs = new Map(Object.entries(attrs));
    /** @type {FakeEl[]} */ this.children = [];
    /** @type {FakeEl|null} */ this.parent = null;
    /** @type {Record<string, string>} estilo computado devolvido pelo getComputedStyle falso */
    this.computed = {};
    /** @type {{left: number, top: number, width: number, height: number}} caixa na tela (getBoundingClientRect falso) */
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  get parentElement() { return this.parent; }
  get parentNode() { return this.parent; }
  get nextSibling() { const p = this.parent; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  /** @param {string} k */ getAttribute(k) { return this.attrs.has(k) ? /** @type {string} */ (this.attrs.get(k)) : null; }
  /** @param {string} k */ hasAttribute(k) { return this.attrs.has(k); }
  /** @param {string} k @param {string} v */ setAttribute(k, v) { this.attrs.set(k, v); }
  /** @param {FakeEl} c */ appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; }
  /** @param {FakeEl} c @param {FakeEl|null} ref */
  insertBefore(c, ref) { c.remove(); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  /** @param {FakeEl|null} other */
  contains(other) { let e = other; while (e) { if (e === this) return true; e = e.parent; } return false; }
  /** @returns {FakeEl[]} */
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  /** @param {string} s */ querySelectorAll(s) { return this.descendants().filter((e) => matches(e, s)); }
  /** @param {string} s */ querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  /** @param {string} s */ matches(s) { return matches(this, s); }
  /** @param {string} s */
  closest(s) { let e = /** @type {FakeEl|null} */ (/** @type {any} */ (this)); while (e) { if (matches(e, s)) return e; e = e.parent; } return null; }
}

/**
 * Árvore a partir de [tag, attrs, ...filhos].
 * @param {[string, Record<string, string>?, ...any[]]} spec
 * @returns {any}
 */
export function h(spec) {
  const [tag, attrs, ...kids] = spec;
  const el = new FakeEl(tag, attrs || {});
  for (const k of kids) el.appendChild(h(k));
  return el;
}

/** @param {FakeEl} body @returns {any} */
export function fakeDocument(body) {
  const html = new FakeEl('html');
  html.appendChild(body);
  return {
    documentElement: html,
    body,
    /** @param {string} s */ querySelector: (s) => html.querySelector(s),
    /** @param {string} s */ querySelectorAll: (s) => html.querySelectorAll(s),
    /** @param {string} tag */ createElement: (tag) => new FakeEl(tag),
  };
}

/** window falso: getComputedStyle lê `el.computed`. */
export const fakeWindow = {
  /** @param {any} el */
  getComputedStyle: (el) => ({ width: el.computed.width || 'auto', height: el.computed.height || 'auto', borderRadius: el.computed.borderRadius || '' }),
};
