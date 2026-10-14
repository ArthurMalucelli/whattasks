// @ts-check
import { describe, it, expect } from 'vitest';
import { findRailAnchor, findRailAnchorByGeometry, buttonSizeFrom, buttonRadiusFrom, describeAnchor, railInfo, railDump, formatRailDump, RAIL_ICON_SELECTOR } from '../src/lib/rail.js';
import { h, fakeDocument, fakeWindow, FakeEl } from './helpers/fakedom.js';

/** @param {string} icon @param {Record<string, string>} [btnAttrs] @returns {any} */
const item = (icon, btnAttrs = {}) => ['div', { class: 'item' }, ['span', {}, ['button', btnAttrs, ['span', { 'data-icon': icon }]]]];

/** Trilho do WhatsApp Web (2026): grupo de cima, grupo de baixo, lista de chats e o chat aberto. */
function waDom({ top = ['chats-filled', 'status-refreshed', 'newsletter-outline', 'community-refreshed-32', 'meta-ai'], extraPane = true } = {}) {
  const body = h(['body', {},
    ['div', { id: 'app' },
      ['div', { class: 'layout' },
        ['header', { class: 'rail' },
          ['div', { class: 'top' }, ...top.map((i) => item(i))],
          ['div', { class: 'bottom' }, item('settings-refreshed')],
        ],
        ['div', { id: 'pane-side' },
          ['div', { role: 'row' }, ['span', { 'data-icon': 'status-dblcheck' }]],
          ...(extraPane ? [['button', {}, ['span', { 'data-icon': 'calls-filled' }]]] : []),
        ],
        ['div', { id: 'main' }, ['button', {}, ['span', { 'data-icon': 'chats-outline' }]]],
      ],
    ],
  ]);
  return fakeDocument(body);
}

/** @param {any} doc @param {string} icon */
const itemOf = (doc, icon) => doc.querySelector(`[data-icon="${icon}"]`).closest('.item');

describe('findRailAnchor', () => {
  it('âncora = item das Comunidades (o botão novo entra logo depois dele)', () => {
    const doc = waDom();
    expect(findRailAnchor(doc)).toBe(itemOf(doc, 'community-refreshed-32'));
  });

  it('sem Comunidades: depois do último botão reconhecido', () => {
    const doc = waDom({ top: ['chats-filled', 'status-refreshed', 'calls-outline'] });
    expect(findRailAnchor(doc)).toBe(itemOf(doc, 'calls-outline'));
  });

  it('um botão só reconhecido: a âncora é o próprio botão', () => {
    const doc = waDom({ top: ['chats-filled', 'foo'] });
    const btn = doc.querySelector('[data-icon="chats-filled"]').closest('button');
    expect(findRailAnchor(doc)).toBe(btn);
  });

  it('ignora ícones dentro da lista de chats (#pane-side), do chat aberto (#main) e fora de botões', () => {
    const doc = waDom({ top: [] });
    expect(findRailAnchor(doc)).toBe(null);
  });

  it('aceita [role="button"] no lugar de <button>', () => {
    const body = h(['body', {}, ['nav', {},
      ['div', { role: 'button', class: 'a' }, ['span', { 'data-icon': 'chats' }]],
      ['div', { role: 'button', class: 'b' }, ['span', { 'data-icon': 'community-outline' }]],
    ]]);
    const doc = fakeDocument(body);
    expect(findRailAnchor(doc)).toBe(body.querySelector('.b'));
  });

  it('o próprio botão da extensão (data-wa-tasks) não conta como vizinho', () => {
    const doc = waDom({ top: ['chats-filled', 'status-refreshed'] });
    const top = doc.querySelector('.top');
    top.appendChild(h(['div', { 'data-wa-tasks': 'rail-btn' }, ['span', { 'data-icon': 'community-x' }]]));
    expect(findRailAnchor(doc)).toBe(itemOf(doc, 'status-refreshed'));
  });

  it('sem nenhum ícone conhecido: null', () => {
    expect(findRailAnchor(fakeDocument(h(['body', {}, ['div', {}]])))).toBe(null);
  });

  it('gaveta de Status/Comunidades aberta fora de #pane-side: a âncora continua dentro do trilho', () => {
    // #side some quando a aba Status/Comunidades está aberta; a gaveta tem linhas role=button com ícones parecidos.
    const body = h(['body', {},
      ['div', { id: 'app' },
        ['div', { class: 'layout' },
          ['header', { class: 'rail' },
            ['div', { class: 'top' }, ...['chats-filled', 'status-refreshed', 'community-refreshed-32', 'meta-ai'].map((i) => item(i))],
            ['div', { class: 'bottom' }, item('settings-refreshed')],
          ],
          ['div', { class: 'drawer' },
            ['div', { role: 'button', class: 'row' }, ['span', { 'data-icon': 'community-default' }]],
            ['div', { role: 'button', class: 'row' }, ['span', { 'data-icon': 'status-add' }]],
          ],
        ],
      ],
    ]);
    const doc = fakeDocument(body);
    const anchor = findRailAnchor(doc);
    expect(anchor).toBe(itemOf(doc, 'community-refreshed-32'));
    expect(doc.querySelector('.rail').contains(anchor)).toBe(true);
  });

  it('trilho sem header/nav: mede a coluna e descarta botões fora dela', () => {
    const body = h(['body', {},
      ['div', { id: 'app' },
        ['div', { class: 'rail' }, ...['chats-filled', 'status-refreshed', 'community-refreshed-32'].map((i) => item(i))],
        ['div', { class: 'drawer' },
          ['div', { role: 'button', class: 'row' }, ['span', { 'data-icon': 'community-default' }]],
        ],
      ],
    ]);
    const doc = fakeDocument(body);
    /** @param {any} el */
    const measureLeft = (el) => (doc.querySelector('.drawer').contains(el) ? 120 : 8);
    const anchor = findRailAnchor(doc, { measureLeft });
    expect(anchor).toBe(itemOf(doc, 'community-refreshed-32'));
    expect(railInfo(doc, { measureLeft })).toEqual(['chats-filled', 'status-refreshed', 'community-refreshed-32']);
  });

  it('sem header/nav nem medida: não sobe além do ancestral que engloba #main/#side', () => {
    const body = h(['body', {},
      ['div', { id: 'app' },
        ['div', { class: 'rail' }, item('chats-filled')],
        ['div', { id: 'side' }],
        ['div', { class: 'drawer' },
          ['div', { role: 'button', class: 'row' }, ['span', { 'data-icon': 'community-default' }]],
        ],
        ['div', { id: 'main' }],
      ],
    ]);
    const doc = fakeDocument(body);
    const anchor = findRailAnchor(doc);
    // A região do trilho para antes do ancestral que contém #side/#main: a linha da gaveta fica de fora.
    expect(anchor).toBe(doc.querySelector('[data-icon="chats-filled"]').closest('button'));
    expect(/** @type {any} */ (anchor).querySelector('#main')).toBe(null);
  });

  it('o seletor tenta conversas, comunidades, status e chamadas', () => {
    for (const s of ['chats-filled', 'chats-outline', 'chats', 'community', 'status', 'calls']) expect(RAIL_ICON_SELECTOR).toContain(s);
  });
});

describe('railInfo (linha "trilho" do Diagnóstico)', () => {
  it('lista os data-icon do trilho em ordem, sem repetir', () => {
    const doc = waDom();
    doc.querySelector('.top').appendChild(h(item('meta-ai')));
    expect(railInfo(doc)).toEqual(['chats-filled', 'status-refreshed', 'newsletter-outline', 'community-refreshed-32', 'meta-ai', 'settings-refreshed']);
  });

  it('não lista ícones da gaveta aberta ao lado do trilho', () => {
    const doc = waDom({ top: ['chats-filled', 'community-refreshed-32'] });
    doc.querySelector('.layout').appendChild(h(['div', { class: 'drawer' },
      ['div', { role: 'button' }, ['span', { 'data-icon': 'status-add' }]],
    ]));
    expect(railInfo(doc)).toEqual(['chats-filled', 'community-refreshed-32', 'settings-refreshed']);
  });

  it('trilho não encontrado: null', () => {
    expect(railInfo(waDom({ top: [] }))).toBe(null);
  });
});

describe('buttonSizeFrom', () => {
  it('copia largura e altura computadas do botão vizinho', () => {
    const b = /** @type {any} */ (new FakeEl('button'));
    b.computed = { width: '40px', height: '44px' };
    expect(buttonSizeFrom(b, fakeWindow)).toEqual({ width: 40, height: 44 });
  });

  it('âncora que é um wrapper: mede o botão de dentro', () => {
    const w = h(['div', {}, ['span', {}, ['button', {}]]]);
    const b = w.querySelector('button');
    b.computed = { width: '48px', height: '48px' };
    expect(buttonSizeFrom(w, fakeWindow)).toEqual({ width: 48, height: 48 });
  });

  it('auto/0/lixo vira 40 px; fora da faixa é limitado a 32–64', () => {
    const b = /** @type {any} */ (new FakeEl('button'));
    expect(buttonSizeFrom(b, fakeWindow)).toEqual({ width: 40, height: 40 });
    b.computed = { width: '0px', height: '300px' };
    expect(buttonSizeFrom(b, fakeWindow)).toEqual({ width: 40, height: 64 });
    b.computed = { width: '12.5px', height: '39.6px' };
    expect(buttonSizeFrom(b, fakeWindow)).toEqual({ width: 32, height: 40 });
  });

  it('sem elemento: 40 × 40', () => {
    expect(buttonSizeFrom(null, fakeWindow)).toEqual({ width: 40, height: 40 });
  });
});

// ---------- trilho por geometria (nomes de data-icon desconhecidos) ----------

/** @typedef {{left: number, top: number, width: number, height: number}} R */

/** Botão de trilho com ícone: svg puro ou span[data-icon] com nome que o seletor por nome não conhece. @param {string} label @param {string} [icon] @returns {any} */
const gbtn = (label, icon) => ['button', { 'aria-label': label }, icon ? ['span', { 'data-icon': icon }] : ['svg', {}]];

/**
 * Trilho com nomes desconhecidos: `top` botões no grupo de cima, divisória, `bottom` no de baixo.
 * Botões de 40 px a cada 48 px; a divisória soma +40 px. Com `wrap`, cada botão fica num div.item.
 * @param {{top?: number, bottom?: number, wrap?: boolean, left?: number}} [o]
 */
function geoDom({ top = 5, bottom = 1, wrap = false, left = 12 } = {}) {
  const names = ['Conversas', 'Status', 'Canais', 'Comunidades', 'Meta AI', 'Extra 1', 'Extra 2'];
  /** @param {any} b */ const wrapIt = (b) => (wrap ? ['div', { class: 'item' }, b] : b);
  const body = h(['body', {},
    ['div', { id: 'app' },
      ['div', { class: 'rail' },
        ['div', { class: 'top' }, ...names.slice(0, top).map((n, i) => wrapIt(gbtn(n, i === 0 ? 'wds-ic-chat-filled' : undefined)))],
        ['div', { class: 'bottom' }, ...Array.from({ length: bottom }, (_, i) => wrapIt(gbtn(`Baixo ${i + 1}`, 'wds-ic-settings')))],
      ],
      ['div', { id: 'side' }, ['button', { class: 'search' }, ['svg', {}]]],
      ['div', { id: 'pane-side' }],
      ['div', { id: 'main' }],
    ],
  ]);
  const doc = fakeDocument(body);
  let y = 10;
  doc.querySelector('.top').querySelectorAll('button').forEach((/** @type {any} */ b) => { b.rect = { left, top: y, width: 40, height: 40 }; y += 48; });
  y += 40;
  doc.querySelector('.bottom').querySelectorAll('button').forEach((/** @type {any} */ b) => { b.rect = { left, top: y, width: 40, height: 40 }; y += 48; });
  const search = doc.querySelector('.search');
  search.rect = { left: 84, top: 70, width: 40, height: 40 };
  return doc;
}

/** @param {any} doc @param {string} label (o DOM falso não aceita espaço dentro de [attr="v"]) */
const byLabel = (doc, label) => doc.querySelectorAll('[aria-label]').find((/** @type {any} */ e) => e.getAttribute('aria-label') === label);

describe('findRailAnchorByGeometry', () => {
  it('trilho 5 + 1: âncora = 5º botão (último do primeiro grupo, antes da divisória)', () => {
    const doc = geoDom();
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI'));
  });

  it('botões dentro de itens: a âncora sobe até o item da lista (o botão novo entra como irmão dos itens)', () => {
    const doc = geoDom({ wrap: true });
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI').parentElement);
  });

  it('primeiro grupo com só 2 botões: null', () => {
    expect(findRailAnchorByGeometry(geoDom({ top: 2, bottom: 3 }), fakeWindow)).toBe(null);
  });

  it('ignora elementos fora da coluna do trilho (left longe da mediana, left >= 140, tamanho fora de 28–96)', () => {
    const doc = geoDom();
    const top = doc.querySelector('.top');
    const stray = h(gbtn('fora da coluna'));
    stray.rect = { left: 60, top: 226, width: 40, height: 40 }; // emendaria o grupo de cima se contasse
    const far = h(gbtn('longe'));
    far.rect = { left: 200, top: 226, width: 40, height: 40 };
    const tiny = h(gbtn('pequeno'));
    tiny.rect = { left: 12, top: 250, width: 20, height: 20 };
    const tall = h(gbtn('alto'));
    tall.rect = { left: 12, top: 250, width: 40, height: 120 };
    for (const e of [stray, far, tiny, tall]) top.appendChild(e);
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI'));
  });

  it('ignora candidatos dentro de #pane-side, #main e da própria extensão', () => {
    const doc = geoDom();
    let y = 250;
    for (const sel of ['#pane-side', '#pane-side', '#main']) {
      const b = h(gbtn('intruso'));
      b.rect = { left: 12, top: y, width: 40, height: 40 };
      y += 48;
      doc.querySelector(sel).appendChild(b);
    }
    const ours = h(['div', { 'data-wa-tasks': 'rail-item' }, gbtn('WhatTasks')]);
    ours.querySelector('button').rect = { left: 12, top: 250, width: 40, height: 40 };
    doc.querySelector('.top').appendChild(ours);
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI'));
  });

  it('só conta botão com ícone (svg ou [data-icon]) e aceita [role="button"] e a[role="link"]', () => {
    const doc = geoDom({ top: 3, bottom: 0 });
    const top = doc.querySelector('.top');
    const noIcon = h(['button', { 'aria-label': 'texto' }, ['span', {}]]);
    noIcon.rect = { left: 12, top: 154, width: 40, height: 40 };
    top.appendChild(noIcon);
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Canais'));
    const link = h(['a', { role: 'link', 'aria-label': 'link' }, ['svg', {}]]);
    link.rect = { left: 12, top: 154, width: 40, height: 40 };
    top.appendChild(link);
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(link);
  });

  it('usa o medidor injetado em opts.rect', () => {
    const doc = geoDom({ top: 4, bottom: 1 });
    /** @type {Map<any, R>} */
    const rects = new Map();
    doc.querySelectorAll('button').forEach((/** @type {any} */ b) => rects.set(b, { ...b.rect }));
    rects.set(byLabel(doc, 'Comunidades'), { left: 12, top: 900, width: 40, height: 40 }); // "medido" lá embaixo
    const anchor = findRailAnchorByGeometry(doc, fakeWindow, { rect: (el) => rects.get(el) || null });
    expect(anchor).toBe(byLabel(doc, 'Canais'));
  });

  it('ignora o que está fora da tela na vertical (win.innerHeight)', () => {
    const doc = geoDom({ top: 5, bottom: 0 });
    expect(findRailAnchorByGeometry(doc, { ...fakeWindow, innerHeight: 200 })).toBe(byLabel(doc, 'Comunidades'));
  });

  it('findRailAnchor cai na geometria quando os nomes não acham nada', () => {
    const doc = geoDom();
    expect(findRailAnchor(doc)).toBe(byLabel(doc, 'Meta AI'));
  });

  it('com nomes conhecidos, o caminho por nome continua ganhando', () => {
    const doc = geoDom();
    byLabel(doc, 'Comunidades').appendChild(h(['span', { 'data-icon': 'community-refreshed-32' }]));
    byLabel(doc, 'Conversas').appendChild(h(['span', { 'data-icon': 'chats-filled' }]));
    expect(findRailAnchor(doc)).toBe(byLabel(doc, 'Comunidades'));
  });
});

describe('trilho com itens que não são <button> (div[role=tab], a sem role, div[tabindex][aria-label])', () => {
  /**
   * Trilho geométrico com o item do tipo dado no lugar de <button>.
   * @param {(label: string) => any} mk
   */
  function nonButtonRail(mk) {
    const names = ['Conversas', 'Status', 'Canais', 'Comunidades', 'Meta AI'];
    const body = h(['body', {},
      ['div', { id: 'app' },
        ['div', { class: 'rail' },
          ['div', { class: 'top' }, ...names.map((n) => ['div', { class: 'item' }, mk(n)])],
          ['div', { class: 'bottom' }, ['div', { class: 'item' }, mk('Baixo')]],
        ],
        ['div', { id: 'pane-side' }],
      ],
    ]);
    const doc = fakeDocument(body);
    let y = 10;
    doc.querySelectorAll('.item').forEach((/** @type {any} */ it, /** @type {number} */ i) => {
      if (i === names.length) y += 40;
      it.children[0].rect = { left: 12, top: y, width: 40, height: 40 };
      y += 48;
    });
    return doc;
  }

  it('div[role="tab"] com svg: geometria acha o 5º item', () => {
    const doc = nonButtonRail((n) => ['div', { role: 'tab', 'aria-label': n }, ['svg', {}]]);
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI').parentElement);
    expect(findRailAnchor(doc)).toBe(byLabel(doc, 'Meta AI').parentElement);
  });

  it('div[tabindex][aria-label] e <a> sem role também contam', () => {
    const d1 = nonButtonRail((n) => ['div', { tabindex: '0', 'aria-label': n }, ['span', { 'data-icon': 'x-' + n.length }]]);
    expect(findRailAnchorByGeometry(d1, fakeWindow)).toBe(byLabel(d1, 'Meta AI').parentElement);
    const d2 = nonButtonRail((n) => ['a', { href: '#', title: n }, ['svg', {}]]);
    expect(findRailAnchorByGeometry(d2, fakeWindow)).toBe(d2.querySelectorAll('.item')[4]);
  });

  it('caminho por nome aceita div[role="tab"] (Comunidades ganha)', () => {
    const doc = nonButtonRail((n) => ['div', { role: 'tab', 'aria-label': n }, ['span', { 'data-icon': n === 'Conversas' ? 'chats-filled' : n === 'Comunidades' ? 'community-refreshed-32' : 'x' }]]);
    expect(findRailAnchor(doc)).toBe(byLabel(doc, 'Comunidades').parentElement);
  });

  it('wrapper grande (> 96 px) com aria-label não engole os itens', () => {
    const doc = nonButtonRail((n) => ['div', { role: 'tab', 'aria-label': n }, ['svg', {}]]);
    const rail = doc.querySelector('.rail');
    rail.setAttribute('aria-label', 'Navegação');
    rail.rect = { left: 0, top: 0, width: 64, height: 600 };
    expect(findRailAnchorByGeometry(doc, fakeWindow)).toBe(byLabel(doc, 'Meta AI').parentElement);
  });
});

describe('railDump (dado bruto quando o trilho não é reconhecido)', () => {
  it('lista [data-icon] colados à esquerda, fora de #pane-side/#main/extensão, com role/tag, aria-label e caixa', () => {
    const body = h(['body', {},
      ['div', { id: 'app' },
        ['div', { class: 'rail' },
          ['div', { role: 'tab', 'aria-label': 'Conversas' }, ['span', { class: 'i1', 'data-icon': 'wds-chat' }]],
          ['span', { class: 'i2', 'data-icon': 'loose' }],
          ['span', { class: 'far', 'data-icon': 'far-right' }],
        ],
        ['div', { id: 'pane-side' }, ['span', { class: 'p', 'data-icon': 'pane-icon' }]],
        ['div', { id: 'main' }, ['span', { class: 'm', 'data-icon': 'main-icon' }]],
        ['div', { 'data-wa-tasks': 'rail-item' }, ['span', { class: 'o', 'data-icon': 'ours' }]],
      ],
    ]);
    const doc = fakeDocument(body);
    body.querySelector('.i1').rect = { left: 20.4, top: 18, width: 24, height: 24 };
    body.querySelector('.i2').rect = { left: 20, top: 70, width: 24, height: 24 };
    body.querySelector('.far').rect = { left: 300, top: 70, width: 24, height: 24 };
    for (const c of ['.p', '.m', '.o']) body.querySelector(c).rect = { left: 20, top: 100, width: 24, height: 24 };
    const dump = railDump(doc);
    expect(dump).toEqual([
      { icon: 'wds-chat', role: 'tab', roleTag: 'div', label: 'Conversas', left: 20, top: 18, width: 24, height: 24, path: 'div>div[role=tab]>span' },
      { icon: 'loose', role: '', roleTag: '', label: '', left: 20, top: 70, width: 24, height: 24, path: 'div>div>span' },
    ]);
    const text = formatRailDump(dump);
    expect(text).toContain('wds-chat role=tab<div> label="Conversas" @20,18 24x24');
    expect(text.split('\n')).toHaveLength(2);
    expect(formatRailDump([])).toBe('(nenhum [data-icon] com left < 140 fora de #pane-side/#main)');
  });

  it('limita a ~20 entradas', () => {
    const body = h(['body', {}, ['div', { class: 'rail' }, ...Array.from({ length: 30 }, (_, i) => ['span', { 'data-icon': 'i' + i }])]]);
    const doc = fakeDocument(body);
    body.querySelectorAll('[data-icon]').forEach((/** @type {any} */ e, /** @type {number} */ i) => { e.rect = { left: 10, top: i * 30, width: 24, height: 24 }; });
    expect(railDump(doc)).toHaveLength(20);
  });
});

describe('railInfo por geometria', () => {
  it('sem nomes conhecidos: lista os data-icon da coluna do trilho em ordem de cima pra baixo', () => {
    const doc = geoDom();
    expect(railInfo(doc)).toEqual(['wds-ic-chat-filled', 'wds-ic-settings']);
  });
});

describe('describeAnchor (log do overlay)', () => {
  it('data-icon de dentro, senão aria-label, senão a tag', () => {
    expect(describeAnchor(h(['div', {}, ['button', { 'aria-label': 'Canais' }, ['span', { 'data-icon': 'newsletter' }]]]))).toBe('data-icon=newsletter');
    expect(describeAnchor(h(['div', {}, ['button', { 'aria-label': 'Canais' }, ['svg', {}]]]))).toBe('aria-label=Canais');
    expect(describeAnchor(h(['div', { 'aria-label': 'Item' }]))).toBe('aria-label=Item');
    expect(describeAnchor(h(['div', {}]))).toBe('<div>');
    expect(describeAnchor(null)).toBe('(nenhuma)');
  });
});

describe('buttonRadiusFrom', () => {
  it('copia o border-radius computado do botão vizinho; vazio ou 0 vira 50%', () => {
    const w = h(['div', {}, ['button', {}]]);
    const b = w.querySelector('button');
    expect(buttonRadiusFrom(w, fakeWindow)).toBe('50%');
    b.computed = { borderRadius: '0px' };
    expect(buttonRadiusFrom(w, fakeWindow)).toBe('50%');
    b.computed = { borderRadius: '12px' };
    expect(buttonRadiusFrom(w, fakeWindow)).toBe('12px');
    expect(buttonRadiusFrom(null, fakeWindow)).toBe('50%');
  });
});

describe('findRailAnchor: nome só vale se a âncora estiver na coluna do trilho', () => {
  it('gaveta aberta com data-icon conhecido fora da coluna não rouba a âncora; cai pra geometria', () => {
    const icons = ['x1', 'x2', 'x3', 'x4', 'x5'];
    const doc = fakeDocument(h(['body', {},
      ['header', { class: 'rail' }, ['div', { class: 'top' }, ...icons.map((i) => item(i))]],
      ['div', { class: 'drawer' }, ['div', { role: 'button' }, ['span', { 'data-icon': 'community-default' }]]],
    ]));
    /** @type {Map<any, {left: number, top: number, width: number, height: number}>} */
    const rects = new Map();
    icons.forEach((i, k) => rects.set(doc.querySelector(`[data-icon="${i}"]`).closest('button'), { left: 8, top: 20 + 56 * k, width: 40, height: 40 }));
    rects.set(doc.querySelector('.drawer [role="button"]'), { left: 120, top: 300, width: 200, height: 48 });
    const rect = (/** @type {any} */ el) => rects.get(el) || null;
    const measureLeft = (/** @type {any} */ el) => (doc.querySelector('.drawer').contains(el) ? 120 : 8);
    const anchor = findRailAnchor(doc, { measureLeft, rect, win: fakeWindow });
    expect(anchor).toBe(itemOf(doc, 'x5'));
  });
  it('sem medidor nenhum (testes antigos), o nome continua valendo', () => {
    const doc = waDom();
    expect(findRailAnchor(doc)).toBe(itemOf(doc, 'community-refreshed-32'));
  });
});
