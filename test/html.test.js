// @ts-check
import { describe, it, expect } from 'vitest';
import { tokenize, buildFragment } from '../src/lib/html.js';

describe('tokenize', () => {
  it('tags, atributos com aspas e texto', () => {
    expect(tokenize('<div id="a" class="b c">oi <b>x</b></div>')).toEqual([
      { type: 'open', tag: 'div', attrs: [['id', 'a'], ['class', 'b c']], void: false },
      { type: 'text', text: 'oi ' },
      { type: 'open', tag: 'b', attrs: [], void: false },
      { type: 'text', text: 'x' },
      { type: 'close', tag: 'b' },
      { type: 'close', tag: 'div' },
    ]);
  });

  it('atributo booleano vira valor vazio; aspas simples e > dentro do valor', () => {
    expect(tokenize(`<button hidden title='a > b' data-x="1">`)).toEqual([
      { type: 'open', tag: 'button', attrs: [['hidden', ''], ['title', 'a > b'], ['data-x', '1']], void: false },
    ]);
  });

  it('elementos vazios (input, img, br) e auto-fechados', () => {
    const t = tokenize('<input type="text"><img src="x.png" alt=""><br/><span/>');
    expect(t.map((x) => [x.type, /** @type {any} */ (x).tag, /** @type {any} */ (x).void])).toEqual([
      ['open', 'input', true], ['open', 'img', true], ['open', 'br', true], ['open', 'span', true],
    ]);
  });

  it('entidades no texto e nos atributos', () => {
    expect(tokenize('<p title="&quot;x&quot; &amp; y">a &lt; b &gt; c &#39;d&#39;</p>')).toEqual([
      { type: 'open', tag: 'p', attrs: [['title', '"x" & y']], void: false },
      { type: 'text', text: "a < b > c 'd'" },
      { type: 'close', tag: 'p' },
    ]);
  });

  it('texto só de espaço com quebra de linha (indentação) some; espaço simples fica', () => {
    expect(tokenize('<a>\n  </a><b> </b>').filter((x) => x.type === 'text')).toEqual([{ type: 'text', text: ' ' }]);
  });

  it('comentários são ignorados', () => {
    expect(tokenize('<!-- nada --><i></i>').map((x) => x.type)).toEqual(['open', 'close']);
  });
});

/** Documento falso que grava a árvore criada. */
function recDoc() {
  /** @param {string} tag */
  const node = (tag) => ({
    tag,
    /** @type {Record<string, string>} */ attrs: {},
    /** @type {any[]} */ kids: [],
    /** @param {string} k @param {string} v */ setAttribute(k, v) { this.attrs[k] = v; },
    /** @param {any} c */ appendChild(c) { this.kids.push(c); return c; },
  });
  return {
    /** @param {string} tag */ createElement: (tag) => node(tag),
    createDocumentFragment: () => node('#fragment'),
    /** @param {string} text */ createTextNode: (text) => ({ text }),
  };
}

describe('buildFragment', () => {
  it('monta a árvore com createElement/setAttribute (sem innerHTML)', () => {
    const frag = /** @type {any} */ (buildFragment(/** @type {any} */ (recDoc()), '<main class="card"><h2 id="t">Oi</h2><input id="i" hidden></main>'));
    const main = frag.kids[0];
    expect(main.tag).toBe('main');
    expect(main.attrs).toEqual({ class: 'card' });
    expect(main.kids[0].tag).toBe('h2');
    expect(main.kids[0].kids[0].text).toBe('Oi');
    expect(main.kids[1].attrs).toEqual({ id: 'i', hidden: '' });
    expect(main.kids[1].kids).toEqual([]);
  });

  it('fechamento que não bate com a abertura lança', () => {
    expect(() => buildFragment(/** @type {any} */ (recDoc()), '<div><span></div>')).toThrow(/span/);
    expect(() => buildFragment(/** @type {any} */ (recDoc()), '<div>')).toThrow(/div/);
  });
});
