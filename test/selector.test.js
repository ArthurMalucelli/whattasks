// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Sem @types/node no projeto: os módulos do Node entram como any.
// @ts-ignore
import { readFileSync } from 'node:fs';
// @ts-ignore
import vm from 'node:vm';
import { PANEL_PORT } from '../src/lib/messages.js';

const CODE = readFileSync(new URL('../src/content/selector.js', import.meta.url), 'utf8');

// ---------- DOM falso mínimo (só os seletores que o selector.js usa) ----------

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
    else if (cls) tests.push((el) => el.classList.contains(cls));
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
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const comps = part.trim().split(/\s+/).map(parseCompound);
    if (!comps[comps.length - 1](el)) return false;
    let i = comps.length - 2;
    let anc = el.parent;
    while (i >= 0 && anc) { if (comps[i](anc)) i--; anc = anc.parent; }
    return i < 0;
  });
}

class FakeEl {
  /** @param {string} tag @param {Record<string, string>} [attrs] */
  constructor(tag, attrs = {}) {
    this.tag = tag;
    /** @type {Map<string, string>} */ this.attrs = new Map(Object.entries(attrs));
    /** @type {FakeEl[]} */ this.children = [];
    /** @type {FakeEl|null} */ this.parent = null;
    /** @type {Set<string>} */ const cls = new Set();
    this.classList = {
      add: (/** @type {string[]} */ ...c) => c.forEach((x) => cls.add(x)),
      remove: (/** @type {string[]} */ ...c) => c.forEach((x) => cls.delete(x)),
      contains: (/** @type {string} */ c) => cls.has(c),
      toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => { if (on) cls.add(c); else cls.delete(c); return on; },
    };
    this.innerText = '';
    this.textContent = '';
    this.id = attrs.id || '';
  }
  /** @param {string} k */ getAttribute(k) { return this.attrs.has(k) ? /** @type {string} */ (this.attrs.get(k)) : null; }
  /** @param {string} k */ hasAttribute(k) { return this.attrs.has(k); }
  /** @param {string} k @param {string} v */ setAttribute(k, v) { this.attrs.set(k, v); }
  /** @param {FakeEl} c */ appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; }
  /** @param {FakeEl} c @param {FakeEl|null} ref */
  insertBefore(c, ref) { c.remove(); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  get previousElementSibling() { const p = this.parent; if (!p) return null; const i = p.children.indexOf(this); return i > 0 ? p.children[i - 1] : null; }
  get nextElementSibling() { const p = this.parent; if (!p) return null; const i = p.children.indexOf(this); return i >= 0 && i < p.children.length - 1 ? p.children[i + 1] : null; }
  get isConnected() { let e = /** @type {FakeEl|null} */ (/** @type {any} */ (this)); while (e && e.parent) e = e.parent; return !!e && e.tag === 'html'; }
  /** @returns {FakeEl[]} */
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  /** @param {string} s */ querySelectorAll(s) { return this.descendants().filter((e) => matches(e, s)); }
  /** @param {string} s */ querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  /** @param {string} s */ matches(s) { return matches(this, s); }
  /** @param {string} s */
  closest(s) { let e = /** @type {FakeEl|null} */ (/** @type {any} */ (this)); while (e) { if (matches(e, s)) return e; e = e.parent; } return null; }
}

// ---------- ambiente do content script ----------

/** @type {any} */ let env;

/** @param {string} name */
function makeChat(name) {
  const main = new FakeEl('div', { id: 'main' });
  const header = main.appendChild(new FakeEl('header'));
  const title = header.appendChild(new FakeEl('span', { title: name }));
  const list = main.appendChild(new FakeEl('div', { role: 'application' }));
  return { main, title, list };
}

/** @param {string} id @param {string} [text] */
function makeRow(id, text = 'msg ' + id) {
  const row = new FakeEl('div', { role: 'row' });
  const inner = row.appendChild(new FakeEl('div', { 'data-id': id }));
  inner.innerText = text;
  row.innerText = text;
  return row;
}

function setup() {
  const html = new FakeEl('html');
  const body = html.appendChild(new FakeEl('body'));
  const chat = makeChat('Grupo A');
  body.appendChild(chat.main);
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const document = {
    documentElement: html,
    body,
    /** @param {string} s */ querySelector: (s) => html.querySelector(s),
    /** @param {string} s */ querySelectorAll: (s) => html.querySelectorAll(s),
    /** @param {string} id */ getElementById: (id) => html.descendants().find((e) => e.getAttribute('id') === id) || null,
    /** @param {string} tag */ createElement: (tag) => new FakeEl(tag),
    /** @param {string} type @param {Function} fn */ addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };
  /** @type {any[]} */ const observers = [];
  class MutationObserver {
    /** @param {Function} cb */
    constructor(cb) { this.cb = cb; /** @type {any} */ this.target = null; this.connected = false; observers.push(this); }
    /** @param {any} target */ observe(target) { this.target = target; this.connected = true; }
    disconnect() { this.connected = false; }
    /** @param {any[]} records */ fire(records) { if (this.connected) this.cb(records, this); }
  }
  /** @type {Function[]} */ const onMessage = [];
  /** @type {Function[]} */ const onConnect = [];
  const sent = /** @type {any[]} */ ([]);
  const chrome = {
    runtime: {
      /** @type {string|undefined} */ id: 'ext-test',
      sendMessage: vi.fn((/** @type {any} */ m) => { sent.push(m); return Promise.resolve(); }),
      onMessage: { addListener: (/** @type {Function} */ fn) => onMessage.push(fn) },
      onConnect: { addListener: (/** @type {Function} */ fn) => onConnect.push(fn) },
    },
  };
  const rowFromEl = vi.fn((/** @type {any} */ rowEl, /** @type {string} */ dataId, /** @type {number} */ domIndex) => ({
    dataId, domIndex, pre: '', text: rowEl.innerText, hasPtt: false, hasDoc: false, hasImg: false,
  }));
  const clearIntervalSpy = vi.fn((/** @type {any} */ t) => clearInterval(t));
  const ctx = vm.createContext({
    document, chrome, MutationObserver,
    Element: FakeEl, HTMLElement: FakeEl,
    __waTasksRowFromEl: rowFromEl,
    setTimeout: (/** @type {any[]} */ ...a) => /** @type {any} */ (setTimeout)(...a),
    clearTimeout: (/** @type {any} */ t) => clearTimeout(t),
    setInterval: (/** @type {any[]} */ ...a) => /** @type {any} */ (setInterval)(...a),
    clearInterval: clearIntervalSpy,
  });
  vm.runInContext(CODE, ctx);
  /** @param {any} msg */
  const send = (msg) => { let res; onMessage.forEach((fn) => fn(msg, {}, (/** @type {any} */ r) => { res = r; })); return /** @type {any} */ (res); };
  /** @param {string} type @param {any} ev */
  const dispatch = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
  const activeObserver = () => observers.filter((o) => o.connected);
  return { html, body, chat, document, observers, activeObserver, onConnect, sent, rowFromEl, send, dispatch, chrome, clearIntervalSpy, ctx };
}

/** @param {any} target */
function click(target) {
  return { target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  env = setup();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('selector.js: ordem da colheita', () => {
  it('linhas montadas ao rolar pra cima e pra baixo mantêm a ordem cronológica', async () => {
    const { list } = env.chat;
    ['c', 'd'].forEach((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    const top = list.children[0];
    list.insertBefore(makeRow('a'), top);
    list.insertBefore(makeRow('b'), top);
    list.appendChild(makeRow('e'));
    env.activeObserver()[0].fire([{ target: list, addedNodes: [] }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(env.send({ name: 'COLLECT_DOM' }).domIds).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('pinta âncoras e as linhas entre elas', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c', 'd'].map((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[2].children[0]));
    expect(rows.map((r) => r.children[0].classList.contains('wt-anchor'))).toEqual([true, false, true, false]);
    expect(rows.map((r) => r.classList.contains('wt-range'))).toEqual([false, true, false, false]);
  });
});

describe('selector.js: realce no balão, não na linha', () => {
  it('âncoras pintam o balão (data-id ou msg-container); a faixa continua na linha', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c'].map((id) => list.appendChild(makeRow(id)));
    const bubble = rows[2].children[0].appendChild(new FakeEl('div', { 'data-testid': 'msg-container' }));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[2].children[0]));
    expect(rows.map((r) => r.classList.contains('wt-anchor'))).toEqual([false, false, false]);
    expect(rows[0].children[0].classList.contains('wt-anchor')).toBe(true);
    expect(bubble.classList.contains('wt-anchor')).toBe(true);
    expect(rows[2].children[0].classList.contains('wt-anchor')).toBe(false);
    expect(rows.map((r) => r.classList.contains('wt-range'))).toEqual([false, true, false]);
  });
  it('PAINT_OFF apaga o realce sem perder a seleção; PAINT_ON traz de volta', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c'].map((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[2].children[0]));
    expect(env.send({ name: 'PAINT_OFF' })).toEqual({ ok: true });
    expect(rows[0].children[0].classList.contains('wt-anchor')).toBe(false);
    expect(rows[1].classList.contains('wt-range')).toBe(false);
    const ping = env.send({ name: 'PING' });
    expect(ping.startId).toBe('a');
    expect(ping.endId).toBe('c');
    expect(env.send({ name: 'PAINT_ON' })).toEqual({ ok: true });
    expect(rows[0].children[0].classList.contains('wt-anchor')).toBe(true);
    expect(rows[1].classList.contains('wt-range')).toBe(true);
  });
});

describe('selector.js: hover não fica preso e o balão é tingido por dentro', () => {
  it('ao fechar a seleção (segundo clique) nenhuma linha fica com wt-hover', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c'].map((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('mouseover', { target: rows[2].children[0] });
    expect(rows[2].classList.contains('wt-hover')).toBe(true);
    env.dispatch('click', click(rows[2].children[0]));
    expect(rows.map((r) => r.classList.contains('wt-hover'))).toEqual([false, false, false]);
  });
  it('o CSS tinge o balão por dentro com um ::after translúcido (fundo do balão é opaco)', () => {
    env.send({ name: 'PICK_START' });
    const css = String(env.document.getElementById('wa-tasks-style').textContent);
    expect(css).toContain('.wt-anchor::after');
    expect(css).toMatch(/\.wt-anchor\s*\{[^}]*position:\s*relative/);
  });
});

describe('selector.js: faixa pintada pela posição visual, não pela ordem de colheita', () => {
  /** @param {any} row @param {number} top */
  const place = (row, top) => { row.getBoundingClientRect = () => ({ top, left: 0, width: 400, height: 40 }); };
  it('com as duas âncoras na tela, pinta só quem está verticalmente entre elas (DOM fora de ordem)', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c', 'd'].map((id) => list.appendChild(makeRow(id)));
    place(rows[0], 0); place(rows[1], 300); place(rows[2], 100); place(rows[3], 200); // DOM a,b,c,d; tela a,c,d,b
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[3].children[0]));
    // entre a (0) e d (200) na tela só está c (100); pela ordem do DOM seriam b e c
    expect(rows.map((r) => r.classList.contains('wt-range'))).toEqual([false, false, true, false]);
    expect(rows[0].children[0].classList.contains('wt-anchor')).toBe(true);
    expect(rows[3].children[0].classList.contains('wt-anchor')).toBe(true);
  });
  it('com uma âncora fora da tela, usa o horário do data-pre-plain-text', () => {
    const { list } = env.chat;
    const mk = (id, hhmm) => { const r = list.appendChild(makeRow(id)); const pre = new FakeEl('div', { class: 'copyable-text', 'data-pre-plain-text': `[${hhmm}, 14/10/2026] Fulano: ` }); r.children[0].appendChild(pre); return r; };
    const a = mk('a', '10:00'), d = mk('d', '10:20'), b = mk('b', '10:05'), c = mk('c', '10:10'); // DOM: a, d, b, c
    place(a, 0); place(b, 100); place(c, 200); // d sem rect = "não montada"
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(a.children[0]));
    env.dispatch('click', click(d.children[0]));
    // pela ordem do DOM nada ficaria entre a e d; pelo horário, b e c ficam
    expect([a, b, c, d].map((r) => r.classList.contains('wt-range'))).toEqual([false, true, true, false]);
  });
});

describe('selector.js: realce no tema da extensão', () => {
  it('o CSS injetado usa o lilás da coruja, não o verde do WhatsApp', () => {
    env.send({ name: 'PICK_START' });
    const st = env.document.getElementById('wa-tasks-style');
    expect(st).not.toBeNull();
    const css = String(st.textContent).toLowerCase();
    expect(css).toContain('187, 167, 240');
    expect(css).toContain('#bba7f0');
    expect(css).not.toContain('#25d366');
    expect(css).not.toContain('#128c7e');
    expect(css).not.toContain('37, 211, 102');
  });
});

describe('selector.js: Esc', () => {
  it('Esc durante a seleção é consumido (preventDefault + stopPropagation) e avisa PICK_CANCELLED', () => {
    env.send({ name: 'PICK_START' });
    const ev = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    env.dispatch('keydown', ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(env.sent.some((m) => m.name === 'PICK_CANCELLED' && m.payload && m.payload.reason === 'esc')).toBe(true);
    expect(env.send({ name: 'PING' }).picking).toBe(false);
  });

  it('Esc com a seleção já concluída (início e fim) passa direto pro WhatsApp e não cancela', () => {
    const { list } = env.chat;
    const rows = ['a', 'b', 'c'].map((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[2].children[0]));
    const ev = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    env.dispatch('keydown', ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
    expect(env.sent.some((m) => m.name === 'PICK_CANCELLED')).toBe(false);
    const ping = env.send({ name: 'PING' });
    expect(ping.startId).toBe('a');
    expect(ping.endId).toBe('c');
  });

  it('Esc fora da seleção passa direto pro WhatsApp', () => {
    const ev = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    env.dispatch('keydown', ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
  });
});

describe('selector.js: MutationObserver barato', () => {
  it('agrupa mutações (debounce) e não re-serializa linhas já conhecidas', async () => {
    const { list } = env.chat;
    ['a', 'b', 'c'].forEach((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    expect(env.rowFromEl).toHaveBeenCalledTimes(3);
    const obs = env.activeObserver()[0];
    list.appendChild(makeRow('d'));
    for (let i = 0; i < 5; i++) obs.fire([{ target: list, addedNodes: [] }]);
    expect(env.rowFromEl).toHaveBeenCalledTimes(3); // nada síncrono
    await vi.advanceTimersByTimeAsync(200);
    expect(env.rowFromEl).toHaveBeenCalledTimes(4); // só a linha nova
    expect(env.send({ name: 'COLLECT_DOM' }).domIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('linha conhecida que mudou por dentro (ex.: imagem carregou) é re-serializada', async () => {
    const { list } = env.chat;
    const rows = ['a', 'b'].map((id) => list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.rowFromEl.mockClear();
    const img = rows[1].children[0].appendChild(new FakeEl('img', { src: 'blob:x' }));
    env.activeObserver()[0].fire([{ target: rows[1].children[0], addedNodes: [img] }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(env.rowFromEl).toHaveBeenCalledTimes(1);
    expect(env.rowFromEl.mock.calls[0][1]).toBe('b');
  });

  it('fechar o panel (porta desconecta) para a colheita e cancela a seleção', () => {
    env.send({ name: 'PICK_START' });
    /** @type {Function[]} */ const onDisc = [];
    const port = { name: PANEL_PORT, onDisconnect: { addListener: (/** @type {Function} */ fn) => onDisc.push(fn) }, onMessage: { addListener: () => {} } };
    env.onConnect.forEach((/** @type {Function} */ fn) => fn(port));
    expect(onDisc.length).toBe(1);
    onDisc.forEach((fn) => fn(port));
    expect(env.activeObserver()).toEqual([]);
    expect(env.send({ name: 'PING' }).picking).toBe(false);
    expect(env.body.classList.contains('wt-picking')).toBe(false);
  });

  it('o nome da porta no content script (literal) é o PANEL_PORT de messages.js', () => {
    const m = /const PANEL_PORT = '([^']+)'/.exec(CODE);
    expect(m && m[1]).toBe(PANEL_PORT);
  });

  it('porta de outro nome é ignorada', () => {
    env.send({ name: 'PICK_START' });
    /** @type {Function[]} */ const onDisc = [];
    const port = { name: 'outra', onDisconnect: { addListener: (/** @type {Function} */ fn) => onDisc.push(fn) }, onMessage: { addListener: () => {} } };
    env.onConnect.forEach((/** @type {Function} */ fn) => fn(port));
    onDisc.forEach((fn) => fn(port));
    expect(env.activeObserver().length).toBe(1);
  });
});

describe('selector.js: troca de chat', () => {
  it('trocar de chat zera a colheita e não mistura ids dos dois chats', async () => {
    ['a1', 'a2'].forEach((id) => env.chat.list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    expect(env.send({ name: 'PING' }).harvested).toBe(2);
    // WhatsApp troca o #main inteiro ao abrir outro chat.
    env.chat.main.remove();
    const other = makeChat('Grupo B');
    env.body.appendChild(other.main);
    ['b1', 'b2'].forEach((id) => other.list.appendChild(makeRow(id)));
    await vi.advanceTimersByTimeAsync(1000);
    const ping = env.send({ name: 'PING' });
    expect(ping.picking).toBe(false);
    expect(ping.startId).toBe(null);
    expect(env.activeObserver()).toEqual([]);
    expect(env.sent.some((m) => m.name === 'CHAT_CHANGED' && m.payload.chatName === 'Grupo B')).toBe(true);
    expect(env.send({ name: 'COLLECT_DOM' }).domIds).toEqual(['b1', 'b2']);
  });

  it('trocar de chat com a seleção concluída avisa PICK_CANCELLED (o panel descarta a seleção)', async () => {
    const rows = ['a1', 'a2'].map((id) => env.chat.list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.dispatch('click', click(rows[0].children[0]));
    env.dispatch('click', click(rows[1].children[0]));
    expect(env.send({ name: 'PING' }).picking).toBe(false);
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent.some((m) => m.name === 'PICK_CANCELLED' && m.payload && m.payload.reason === 'chat')).toBe(true);
    expect(env.sent.some((m) => m.name === 'CHAT_CHANGED')).toBe(true);
    expect(env.send({ name: 'PING' }).startId).toBe(null);
  });

  it('trocar de chat sem seleção não avisa PICK_CANCELLED', async () => {
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent.some((m) => m.name === 'PICK_CANCELLED')).toBe(false);
    expect(env.sent.some((m) => m.name === 'CHAT_CHANGED')).toBe(true);
  });

  it('#main recriado no mesmo chat: o observer é religado no #main novo', async () => {
    ['a1'].forEach((id) => env.chat.list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.chat.main.remove();
    const again = makeChat('Grupo A');
    env.body.appendChild(again.main);
    await vi.advanceTimersByTimeAsync(1000);
    const live = env.activeObserver();
    expect(live.length).toBe(1);
    expect(live[0].target).toBe(again.main);
    expect(env.send({ name: 'PING' }).picking).toBe(true);
  });
});

describe('selector.js: content script órfão (extensão recarregada)', () => {
  it('sendMessage que lança no poll (contexto invalidado) não derruba o content script', async () => {
    env.chrome.runtime.sendMessage.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
    ['a1', 'a2'].forEach((id) => env.chat.list.appendChild(makeRow(id)));
    env.send({ name: 'PICK_START' });
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.send({ name: 'PING' }).chatName).toBe('Grupo B');
    expect(env.send({ name: 'PING' }).picking).toBe(false);
  });

  it('sem chrome.runtime.id o poll para (clearInterval) e desliga a colheita', async () => {
    env.send({ name: 'PICK_START' });
    expect(env.activeObserver().length).toBe(1);
    delete env.chrome.runtime.id;
    env.chrome.runtime.sendMessage.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.clearIntervalSpy).toHaveBeenCalled();
    expect(env.activeObserver()).toEqual([]);
    env.chrome.runtime.sendMessage.mockClear();
    env.body.appendChild(makeChat('Grupo C').main);
    await vi.advanceTimersByTimeAsync(3000);
    expect(env.chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('selector.js: poll robusto', () => {
  it('exceção dentro do poll não propaga e o poll segue vivo no tick seguinte', async () => {
    const orig = env.document.querySelector;
    env.document.querySelector = () => { throw new Error('DOM em transição'); };
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.clearIntervalSpy).not.toHaveBeenCalled();
    env.document.querySelector = orig;
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.sent.some((m) => m.name === 'CHAT_CHANGED' && m.payload.chatName === 'Grupo B')).toBe(true);
  });
});

describe('selector.js: ponte pro painel dentro da página (__waTasksSelector)', () => {
  /** @returns {any} */
  const bridge = () => env.ctx.__waTasksSelector;

  it('handle responde igual ao listener de mensagens (PING, PICK_START, COLLECT_DOM, PICK_CANCEL)', () => {
    const { list } = env.chat;
    ['a', 'b'].forEach((id) => list.appendChild(makeRow(id)));
    expect(bridge().handle('PING')).toEqual(env.send({ name: 'PING' }));
    expect(bridge().handle('PICK_START')).toEqual({ ok: true });
    expect(env.send({ name: 'PING' }).picking).toBe(true);
    expect(bridge().handle('COLLECT_DOM').domIds).toEqual(['a', 'b']);
    expect(bridge().handle('PICK_CANCEL')).toEqual({ ok: true });
    expect(env.send({ name: 'PING' }).picking).toBe(false);
  });

  it('nome desconhecido: undefined', () => {
    expect(bridge().handle('NADA')).toBe(undefined);
  });

  it('subscribe recebe PICKED/CHAT_CHANGED (e o runtime.sendMessage continua indo pra sidebar)', async () => {
    const got = /** @type {any[]} */ ([]);
    bridge().subscribe((/** @type {any} */ m) => got.push(m));
    const rows = ['a', 'b'].map((id) => env.chat.list.appendChild(makeRow(id)));
    bridge().handle('PICK_START');
    env.dispatch('click', click(rows[0].children[0]));
    expect(got[0]).toMatchObject({ name: 'PICKED', payload: { which: 'start', id: 'a' } });
    expect(env.sent.some((m) => m.name === 'PICKED')).toBe(true);
    env.chat.main.remove();
    env.body.appendChild(makeChat('Grupo B').main);
    await vi.advanceTimersByTimeAsync(1000);
    expect(got.map((m) => m.name)).toEqual(['PICKED', 'PICK_CANCELLED', 'CHAT_CHANGED']);
  });

  it('cancelar a assinatura para a entrega; assinante que lança não derruba os outros', () => {
    const a = vi.fn(() => { throw new Error('quebrado'); });
    const b = vi.fn();
    bridge().subscribe(a);
    const off = bridge().subscribe(b);
    bridge().handle('PICK_START');
    const ev = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    env.dispatch('keydown', ev);
    expect(b).toHaveBeenCalledTimes(1);
    off();
    bridge().handle('PICK_START');
    env.dispatch('keydown', ev);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('com o painel da página assinando, fechar a sidebar (porta) não cancela a seleção', () => {
    const off = bridge().subscribe(() => {});
    bridge().handle('PICK_START');
    /** @type {Function[]} */ const onDisc = [];
    const port = { name: PANEL_PORT, onDisconnect: { addListener: (/** @type {Function} */ fn) => onDisc.push(fn) }, onMessage: { addListener: () => {} } };
    env.onConnect.forEach((/** @type {Function} */ fn) => fn(port));
    onDisc.forEach((fn) => fn(port));
    expect(env.send({ name: 'PING' }).picking).toBe(true);
    off();
    expect(env.send({ name: 'PING' }).picking).toBe(false);
  });

  it('RAIL_INFO devolve os ícones do trilho (função do overlay.js) ou null', () => {
    expect(bridge().handle('RAIL_INFO')).toEqual({ ok: true, icons: null });
    env.ctx.__waTasksRailInfo = () => ['chats-filled', 'community-refreshed-32'];
    expect(bridge().handle('RAIL_INFO')).toEqual({ ok: true, icons: ['chats-filled', 'community-refreshed-32'] });
    expect(env.send({ name: 'RAIL_INFO' })).toEqual({ ok: true, icons: ['chats-filled', 'community-refreshed-32'] });
    env.ctx.__waTasksRailInfo = () => { throw new Error('x'); };
    expect(bridge().handle('RAIL_INFO')).toEqual({ ok: true, icons: null });
  });
});
