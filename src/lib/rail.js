// @ts-check
/**
 * Trilho de ícones à esquerda do WhatsApp Web (Conversas, Status, Canais, Comunidades, Meta AI…).
 * Lógica pura usada pelo overlay.js: onde entra o botão da extensão e com que tamanho.
 * Dois caminhos: pelos nomes de data-icon conhecidos (rápido, quando o WhatsApp mantém os nomes) e, se
 * eles falharem, pela geometria (a coluna de botões com ícone colada na borda esquerda da tela).
 * Recebe `document`/`window` por parâmetro (testável com DOM falso).
 */

/** Ícones que identificam o trilho, em ordem de preferência. */
export const RAIL_ICON_SELECTOR = [
  '[data-icon="chats-filled"]',
  '[data-icon="chats-outline"]',
  '[data-icon="chats"]',
  '[data-icon*="community"]',
  '[data-icon*="status"]',
  '[data-icon*="calls"]',
].join(', ');

/**
 * Item clicável do trilho. Não só <button>: o WhatsApp já usou div[role=tab], <a> e afins; com o seletor
 * estreito, `icon.closest()` não achava nada e o trilho real caía no botão flutuante.
 */
const BUTTON_SEL = 'button, [role="button"], [role="tab"], [role="link"], a';
/** Ícones nessas áreas não são do trilho (lista de chats, chat aberto, a própria extensão). */
const EXCLUDE_SEL = '#pane-side, #main, [data-wa-tasks]';
/** Botão de Conversas: a semente do trilho (o primeiro item dele). */
const CHATS_SEL = '[data-icon="chats-filled"], [data-icon="chats-outline"], [data-icon="chats"]';
/** Contêiner semântico do trilho, quando o WhatsApp usa um. */
const RAIL_ROOT_SEL = 'header, nav, [role="navigation"]';
/** O trilho nunca engloba a coluna de chats nem o chat aberto. */
const FORBIDDEN_SEL = '#side, #main, #pane-side';
/** Botões do trilho ficam empilhados na mesma coluna: |left - left da semente| até isto. */
const SAME_COLUMN_PX = 32;
const DEFAULT_SIZE = 40;
const MIN_SIZE = 32;
const MAX_SIZE = 64;
const MAX_RAIL_ICONS = 40;

/**
 * Candidatos do caminho por geometria: qualquer coisa com cara de item clicável. O filtro de tamanho (28–96 px)
 * e o "o de fora ganha" descartam os wrappers grandes demais e os ícones soltos dentro do item.
 */
const GEO_CANDIDATE_SEL = `${BUTTON_SEL}, [tabindex], [aria-label]`;
/** Ícone dentro do candidato. */
const GEO_ICON_SEL = '[data-icon], svg';
/** Fora do trilho: lista de chats, coluna de chats, chat aberto, a própria extensão. */
const GEO_EXCLUDE_SEL = '#pane-side, #side, #main, [data-wa-tasks]';
/** O trilho fica colado na borda esquerda: left na tela abaixo disto. */
const GEO_MAX_LEFT = 140;
const GEO_MIN_SIZE = 28;
const GEO_MAX_SIZE = 96;
/** Mesma coluna: |left - mediana| até isto. */
const GEO_COLUMN_PX = 12;
/** Divisória entre grupos: distância entre topos consecutivos acima de N × a altura mediana. */
const GEO_GAP_FACTOR = 1.6;
/** O grupo de cima (Conversas, Status, Canais, Comunidades…) tem pelo menos isto de botões. */
const GEO_MIN_GROUP = 3;

/**
 * @typedef {{left: number, top: number, width: number, height: number}} Rect
 * @typedef {{innerHeight?: number, getComputedStyle?: unknown}} RailWindow  só innerHeight é lido (o `window` real ou o falso dos testes)
 * @typedef {Object} RailOptions
 * @property {(el: Element) => number} [measureLeft]  borda esquerda na tela (overlay.js: getBoundingClientRect().left);
 *   sem ela, o recorte é só pela estrutura do DOM
 * @property {(el: Element) => Rect | null} [rect]  caixa na tela pro caminho por geometria
 *   (padrão: el.getBoundingClientRect())
 * @property {RailWindow} [win]  window pro caminho por geometria quando chamado via findRailAnchor/railInfo
 */

/**
 * Elemento grande demais pra ser (parte d)o trilho: o documento, o body ou algo que contém #side/#main/#pane-side.
 * @param {ParentNode} doc
 * @param {Element} el
 */
function tooBroad(doc, el) {
  const d = /** @type {any} */ (doc);
  if (el === d.body || el === d.documentElement) return true;
  return el.matches(FORBIDDEN_SEL) || !!el.querySelector(FORBIDDEN_SEL);
}

/**
 * Região do trilho em volta da semente: o header/nav/[role=navigation] mais próximo, se não for amplo demais;
 * senão o ancestral mais alto da semente que ainda não engloba a coluna de chats nem o chat aberto.
 * @param {ParentNode} doc
 * @param {Element} seed
 * @returns {Element}
 */
function railRegion(doc, seed) {
  const sem = seed.closest(RAIL_ROOT_SEL);
  if (sem && !tooBroad(doc, sem)) return sem;
  /** @type {Element} */
  let region = seed;
  while (region.parentElement && !tooBroad(doc, region.parentElement)) region = region.parentElement;
  return region;
}

/** @param {number} n */
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Botões do trilho reconhecidos, em ordem do documento, sem repetição, recortados à região da semente (o botão
 * de Conversas, senão o primeiro reconhecido) e, com `measureLeft`, à coluna dela. Assim gavetas de Status,
 * Canais e Comunidades abertas ao lado (fora de #pane-side) não entram.
 * @param {ParentNode} doc
 * @param {RailOptions} [opts]
 * @returns {{buttons: Element[], region: Element|null, seedLeft: number}}
 */
function railScope(doc, opts = {}) {
  /** @type {Element[]} */
  const all = [];
  doc.querySelectorAll(RAIL_ICON_SELECTOR).forEach((icon) => {
    if (icon.closest(EXCLUDE_SEL)) return;
    const btn = icon.closest(BUTTON_SEL);
    if (btn && !all.includes(btn)) all.push(btn);
  });
  if (!all.length) return { buttons: [], region: null, seedLeft: NaN };
  const seed = all.find((b) => b.querySelector(CHATS_SEL)) || all[0];
  const region = railRegion(doc, seed);
  let buttons = all.filter((b) => region.contains(b));
  const measure = opts.measureLeft;
  let seedLeft = NaN;
  if (measure) {
    seedLeft = measure(seed);
    if (finite(seedLeft)) {
      buttons = buttons.filter((b) => {
        const x = measure(b);
        return !finite(x) || Math.abs(x - seedLeft) <= SAME_COLUMN_PX;
      });
    }
  }
  return { buttons, region, seedLeft };
}

/**
 * Menor ancestral comum dos elementos (null se não houver).
 * @param {Element[]} els
 * @returns {Element|null}
 */
function commonAncestor(els) {
  let anc = els[0] ? els[0].parentElement : null;
  while (anc && !els.every((e) => anc && anc.contains(e))) anc = anc.parentElement;
  return anc;
}

/**
 * Lista do trilho (ancestral comum dos botões), ou null se só há 1 botão ou se o ancestral é amplo demais.
 * @param {ParentNode} doc
 * @param {Element[]} buttons
 */
function railList(doc, buttons) {
  if (buttons.length < 2) return null;
  const list = commonAncestor(buttons);
  return list && !tooBroad(doc, list) ? list : null;
}

/**
 * Sobe do botão até o filho direto da lista comum dos botões (o "item"), pra o botão novo entrar na mesma
 * lista dos vizinhos; sem lista (1 botão só ou ancestral amplo demais), é o próprio botão.
 * @param {ParentNode} doc
 * @param {Element[]} buttons
 * @param {Element} target
 */
function itemOf(doc, buttons, target) {
  const list = railList(doc, buttons);
  if (!list) return target;
  /** @type {Element} */
  let item = target;
  while (item.parentElement && item.parentElement !== list) item = item.parentElement;
  return item;
}

/**
 * Caminho por nome: o item das Comunidades quando existe, senão o do último botão reconhecido pelos
 * data-icon conhecidos. null = nenhum nome conhecido no trilho.
 * @param {ParentNode} doc
 * @param {RailOptions} [opts]
 * @returns {Element|null}
 */
export function findRailAnchorByName(doc, opts) {
  const { buttons } = railScope(doc, opts);
  if (!buttons.length) return null;
  const community = buttons.find((b) => b.querySelector('[data-icon*="community"]'));
  return itemOf(doc, buttons, community || buttons[buttons.length - 1]);
}

/** @param {number[]} xs */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** @param {Element} el @returns {Rect|null} */
function defaultRect(el) {
  const anyEl = /** @type {any} */ (el);
  if (typeof anyEl.getBoundingClientRect !== 'function') return null;
  const r = anyEl.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Coluna do trilho medida na tela: botões com ícone, colados à esquerda, de tamanho de botão, fora da lista
 * de chats/chat aberto/extensão, na mesma coluna (mediana do left ± 12 px), em ordem de cima pra baixo,
 * divididos em grupos onde a distância entre topos passa de 1,6 × a altura mediana.
 * @param {ParentNode} doc
 * @param {RailWindow | null | undefined} win
 * @param {RailOptions} [opts]
 * @returns {Element[][]}  grupos (vazio = sem coluna)
 */
function railColumn(doc, win, opts = {}) {
  const measure = opts.rect || defaultRect;
  const vh = win && finite(/** @type {number} */ (win.innerHeight)) ? /** @type {number} */ (win.innerHeight) : Infinity;
  /** @type {Array<{el: Element, r: Rect}>} */
  let cands = [];
  doc.querySelectorAll(GEO_CANDIDATE_SEL).forEach((el) => {
    if (el.closest(GEO_EXCLUDE_SEL) || !el.querySelector(GEO_ICON_SEL)) return;
    const r = measure(el);
    if (!r || ![r.left, r.top, r.width, r.height].every(finite)) return;
    if (r.left >= GEO_MAX_LEFT || r.top >= vh || r.top + r.height <= 0) return;
    if (r.width < GEO_MIN_SIZE || r.width > GEO_MAX_SIZE || r.height < GEO_MIN_SIZE || r.height > GEO_MAX_SIZE) return;
    cands.push({ el, r });
  });
  // Candidato dentro de outro (div[role=button] > button): fica o de fora.
  cands = cands.filter((c) => !cands.some((o) => o !== c && o.el.contains(c.el)));
  if (!cands.length) return [];
  const midLeft = median(cands.map((c) => c.r.left));
  const col = cands.filter((c) => Math.abs(c.r.left - midLeft) <= GEO_COLUMN_PX).sort((a, b) => a.r.top - b.r.top);
  const gap = GEO_GAP_FACTOR * median(col.map((c) => c.r.height));
  /** @type {Element[][]} */
  const groups = [];
  col.forEach((c, i) => {
    if (i === 0 || c.r.top - col[i - 1].r.top > gap) groups.push([]);
    groups[groups.length - 1].push(c.el);
  });
  return groups;
}

/**
 * Caminho por geometria (quando os nomes de data-icon mudaram): o último botão do primeiro grupo da coluna
 * do trilho (depois de Comunidades, antes da divisória do Meta AI/grupo de baixo), subindo até o item da
 * lista. Exige 3+ botões no primeiro grupo; senão null.
 * @param {ParentNode} doc
 * @param {RailWindow | null | undefined} win  innerHeight descarta o que está fora da tela
 * @param {RailOptions} [opts]  `rect` injeta a medida (testes)
 * @returns {Element|null}
 */
export function findRailAnchorByGeometry(doc, win, opts = {}) {
  const groups = railColumn(doc, win, opts);
  const first = groups[0];
  if (!first || first.length < GEO_MIN_GROUP) return null;
  return itemOf(doc, first, first[first.length - 1]);
}

/**
 * Elemento depois do qual o botão da extensão entra: pelos nomes conhecidos (ganham quando existem), senão
 * pela geometria. null = sem trilho.
 * @param {ParentNode} doc
 * @param {RailOptions} [opts]
 * @returns {Element|null}
 */
export function findRailAnchor(doc, opts = {}) {
  const byName = findRailAnchorByName(doc, opts);
  const byGeo = findRailAnchorByGeometry(doc, opts.win, opts);
  if (!byGeo) return byName;
  if (!byName) return byGeo;
  // Nome é só desempate: só vale se estiver na mesma coluna que o trilho achado por geometria.
  const ln = anchorLeft(byName, opts);
  const lg = anchorLeft(byGeo, opts);
  if (ln === null || lg === null) return byName;
  return Math.abs(ln - lg) <= SAME_COLUMN_PX && !(typeof byName.closest === 'function' && byName.closest(FORBIDDEN_SEL)) ? byName : byGeo;
}

/**
 * Borda esquerda medida de uma âncora (o botão de dentro, senão ela mesma); null sem medidor.
 * @param {Element} el
 * @param {RailOptions} opts
 * @returns {number|null}
 */
function anchorLeft(el, opts) {
  const probe = (typeof el.querySelector === 'function' && el.querySelector(BUTTON_SEL)) || el;
  if (opts.rect) { const r = opts.rect(probe) || opts.rect(el); if (r && Number.isFinite(r.left)) return r.left; }
  if (opts.measureLeft) { const m = opts.measureLeft(probe); if (Number.isFinite(m)) return m; }
  return null;
}

/**
 * Rótulo curto da âncora pro log do overlay: o data-icon de dentro, senão o aria-label (dela ou de dentro),
 * senão a tag.
 * @param {Element|null} el
 * @returns {string}
 */
export function describeAnchor(el) {
  if (!el) return '(nenhuma)';
  const icon = el.matches('[data-icon]') ? el : el.querySelector('[data-icon]');
  if (icon) return `data-icon=${icon.getAttribute('data-icon')}`;
  const labeled = el.matches('[aria-label]') ? el : el.querySelector('[aria-label]');
  if (labeled) return `aria-label=${labeled.getAttribute('aria-label')}`;
  return `<${el.tagName.toLowerCase()}>`;
}

/**
 * data-icon dos ícones do trilho (pro Diagnóstico refinar os seletores com dado real). null = não achou.
 * O contêiner é o pai da lista comum (pega os grupos de cima e de baixo), sem sair da região do trilho.
 * @param {ParentNode} doc
 * @param {RailOptions} [opts]
 * @returns {string[]|null}
 */
export function railInfo(doc, opts = {}) {
  const { buttons, region, seedLeft } = railScope(doc, opts);
  if (!buttons.length || !region) return railInfoByGeometry(doc, opts);
  const parent = buttons[0].parentElement;
  const list = railList(doc, buttons) || (parent && region.contains(parent) ? parent : region);
  const up = list.parentElement;
  const root = up && region.contains(up) ? up : list;
  const measure = opts.measureLeft;
  /** @type {string[]} */
  const icons = [];
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.closest(EXCLUDE_SEL)) return;
    if (measure && finite(seedLeft)) {
      const x = measure(el);
      if (finite(x) && Math.abs(x - seedLeft) > SAME_COLUMN_PX) return;
    }
    const v = el.getAttribute('data-icon') || '';
    if (v && !icons.includes(v) && icons.length < MAX_RAIL_ICONS) icons.push(v);
  });
  return icons;
}

/**
 * data-icon da coluna do trilho medida (todos os grupos, de cima pra baixo); null = sem coluna.
 * @param {ParentNode} doc
 * @param {RailOptions} opts
 * @returns {string[]|null}
 */
function railInfoByGeometry(doc, opts) {
  const groups = railColumn(doc, opts.win, opts);
  if (!groups.length) return null;
  /** @type {string[]} */
  const icons = [];
  for (const b of groups.flat()) {
    const found = b.matches('[data-icon]') ? [b] : Array.from(b.querySelectorAll('[data-icon]'));
    for (const el of found) {
      const v = el.getAttribute('data-icon') || '';
      if (v && !icons.includes(v) && icons.length < MAX_RAIL_ICONS) icons.push(v);
    }
  }
  return icons;
}

/** Máximo de entradas do dump bruto (console). */
const MAX_DUMP = 20;

/**
 * @typedef {Object} RailDumpEntry
 * @property {string} icon  valor do data-icon
 * @property {string} role  role do [role] mais próximo ('' se nenhum)
 * @property {string} roleTag  tag desse elemento ('' se nenhum)
 * @property {string} label  aria-label do [aria-label] mais próximo ('' se nenhum)
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {string} path  últimos 3 níveis (tag, [role=x], [tabindex]) até o ícone
 */

/** @param {Element} el */
function segment(el) {
  const role = el.getAttribute('role');
  return el.tagName.toLowerCase() + (role ? `[role=${role}]` : '') + (el.hasAttribute('tabindex') ? '[tabindex]' : '');
}

/**
 * Dado bruto pro log quando o trilho não é reconhecido: todo [data-icon] com left na tela < 140, fora de
 * #pane-side/#main/extensão, com o [role] e o [aria-label] mais próximos, a caixa e o caminho no DOM.
 * Dá o formato real do DOM pra próxima rodada de seletores. Até 20 entradas.
 * @param {ParentNode} doc
 * @param {RailOptions} [opts]  `rect` injeta a medida (testes)
 * @returns {RailDumpEntry[]}
 */
export function railDump(doc, opts = {}) {
  const measure = opts.rect || defaultRect;
  /** @type {RailDumpEntry[]} */
  const out = [];
  for (const el of Array.from(doc.querySelectorAll('[data-icon]'))) {
    if (out.length >= MAX_DUMP) break;
    if (el.closest(EXCLUDE_SEL)) continue;
    const r = measure(el);
    if (!r || ![r.left, r.top, r.width, r.height].every(finite) || r.left >= GEO_MAX_LEFT) continue;
    const roleEl = el.closest('[role]');
    const labelEl = el.closest('[aria-label]');
    /** @type {string[]} */
    const path = [];
    for (let e = /** @type {Element|null} */ (el); e && path.length < 3; e = e.parentElement) path.unshift(segment(e));
    out.push({
      icon: el.getAttribute('data-icon') || '',
      role: roleEl ? roleEl.getAttribute('role') || '' : '',
      roleTag: roleEl ? roleEl.tagName.toLowerCase() : '',
      label: labelEl ? labelEl.getAttribute('aria-label') || '' : '',
      left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
      path: path.join('>'),
    });
  }
  return out;
}

/**
 * Uma linha por entrada do railDump, pro console.
 * @param {RailDumpEntry[]} entries
 * @returns {string}
 */
export function formatRailDump(entries) {
  if (!entries.length) return '(nenhum [data-icon] com left < 140 fora de #pane-side/#main)';
  return entries.map((e) =>
    `${e.icon} role=${e.role || '-'}<${e.roleTag || '-'}> label="${e.label}" @${e.left},${e.top} ${e.width}x${e.height} ${e.path}`).join('\n');
}

/** @param {unknown} v */
function px(v) {
  const n = typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

/**
 * Tamanho do botão novo, copiado do vizinho (o próprio elemento se for botão, senão o botão de dentro).
 * Valores ilegíveis viram 40 px; o resto fica entre 32 e 64 px.
 * @param {Element|null} el
 * @param {{getComputedStyle: (el: Element) => {width: string, height: string}}} win
 * @returns {{width: number, height: number}}
 */
export function buttonSizeFrom(el, win) {
  if (!el) return { width: DEFAULT_SIZE, height: DEFAULT_SIZE };
  const btn = el.matches(BUTTON_SEL) ? el : (el.querySelector(BUTTON_SEL) || el);
  const cs = win.getComputedStyle(btn);
  return { width: px(cs.width), height: px(cs.height) };
}

/**
 * border-radius do botão vizinho (o próprio elemento se for botão, senão o de dentro); vazio ou 0 vira 50%.
 * @param {Element|null} el
 * @param {{getComputedStyle: (el: Element) => {borderRadius?: string}}} win
 * @returns {string}
 */
export function buttonRadiusFrom(el, win) {
  if (!el) return '50%';
  const btn = el.matches(BUTTON_SEL) ? el : (el.querySelector(BUTTON_SEL) || el);
  const v = String(win.getComputedStyle(btn).borderRadius || '').trim();
  return v && parseFloat(v) > 0 ? v : '50%';
}
