// @ts-check
import { describe, it, expect } from 'vitest';
// Sem @types/node no projeto: os módulos do Node entram como any.
// @ts-ignore
import { readFileSync } from 'node:fs';
// @ts-ignore
import vm from 'node:vm';

const CODE = readFileSync(new URL('../src/content/dom-fallback.js', import.meta.url), 'utf8');

// Nós falsos mínimos: texto (nodeType 3) e elemento (nodeType 1) com childNodes.
/** @param {string} v */
const txt = (v) => ({ nodeType: 3, nodeValue: v, childNodes: [] });
/** @param {string} tag @param {Record<string, string>} attrs @param {any[]} [kids] */
const el = (tag, attrs, kids = []) => ({
  nodeType: 1,
  tagName: tag.toUpperCase(),
  childNodes: kids,
  /** @param {string} k */ getAttribute: (k) => (k in attrs ? attrs[k] : null),
  // innerText real ignora o alt das <img>: simula isso.
  get innerText() {
    /** @param {any} n @returns {string} */
    const walk = (n) => (n.nodeType === 3 ? n.nodeValue : n.tagName === 'BR' ? '\n' : n.tagName === 'IMG' ? '' : n.childNodes.map(walk).join(''));
    return walk(this);
  },
});

/** @param {any} textSpan */
function rowWith(textSpan) {
  return {
    /** @param {string} s */
    querySelector: (s) => (s === 'span.selectable-text' ? textSpan : null),
  };
}

function load() {
  class HTMLElement {}
  /** @type {any} */
  const ctx = vm.createContext({ HTMLElement });
  vm.runInContext(CODE, ctx);
  return /** @type {(row: any, id: string, i: number) => any} */ (ctx.__waTasksRowFromEl);
}

describe('dom-fallback.js: texto da linha', () => {
  it('mensagem só com emoji (<img alt>) vira o próprio emoji', () => {
    const fn = load();
    const span = el('span', { class: 'selectable-text' }, [el('img', { alt: '✅', src: 'data:x' })]);
    expect(fn(rowWith(span), 'id1', 0).text).toBe('✅');
  });

  it('emoji no meio do texto é preservado, e <br> vira quebra de linha', () => {
    const fn = load();
    const span = el('span', { class: 'selectable-text' }, [
      el('span', {}, [txt('feito '), el('img', { alt: '👍' }), txt(' ok')]),
      el('br', {}),
      txt('  linha 2  '),
    ]);
    expect(fn(rowWith(span), 'id1', 0).text).toBe('feito 👍 ok\n  linha 2');
  });

  it('sem span.selectable-text o texto é vazio', () => {
    const fn = load();
    expect(fn(rowWith(null), 'id1', 3)).toMatchObject({ dataId: 'id1', domIndex: 3, text: '' });
  });
});
