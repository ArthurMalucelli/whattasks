// @ts-check
/**
 * Geometria do card flutuante dentro do WhatsApp (overlay.js): limites de posição/tamanho, arrastar e
 * redimensionar. Lógica pura (sem DOM): o overlay mede, chama estas funções e aplica o resultado.
 */

/**
 * @typedef {{left: number, top: number, width: number, height: number|null}} CardRect  height null = altura automática (conteúdo)
 * @typedef {{width: number, height: number}} Size
 * @typedef {{left: number, top: number, width: number, height: number, x: number, y: number}} PointerStart  caixa medida + ponteiro no pointerdown
 * @typedef {{x: number, y: number}} Point
 */

/** Posição/tamanho padrão: ao lado do trilho, no topo, altura pelo conteúdo. @type {Readonly<CardRect>} */
export const DEFAULT_RECT = Object.freeze({ left: 72, top: 12, width: 360, height: null });
/** @type {Readonly<Size>} */
export const MIN_SIZE = Object.freeze({ width: 300, height: 320 });
const MAX_WIDTH = 720;
/** Folga vertical total (12 px em cima + 12 px embaixo). */
const V_MARGIN = 24;

/** @param {unknown} n */
const num = (n) => typeof n === 'number' && Number.isFinite(n);
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Tamanho máximo pra viewport: 720 × (altura - 24), nunca abaixo do mínimo.
 * @param {Size} viewport
 * @returns {Size}
 */
export function maxSizeFor(viewport) {
  return {
    width: Math.max(MIN_SIZE.width, Math.min(MAX_WIDTH, viewport.width)),
    height: Math.max(MIN_SIZE.height, viewport.height - V_MARGIN),
  };
}

/**
 * Retângulo salvo/pedido → retângulo válido pra viewport atual: tamanho em [min, max] e caixa inteira
 * dentro da tela (com altura automática, o topo reserva a altura mínima). Valores ilegíveis viram o padrão.
 * @param {Partial<CardRect>|null|undefined} rect
 * @param {Size} viewport
 * @param {Size} min
 * @param {Size} max
 * @returns {CardRect}
 */
export function clampRect(rect, viewport, min, max) {
  const r = rect || {};
  const width = clamp(num(r.width) ? /** @type {number} */ (r.width) : DEFAULT_RECT.width, min.width, Math.min(max.width, viewport.width));
  const height = num(r.height) ? clamp(/** @type {number} */ (r.height), min.height, Math.min(max.height, viewport.height)) : null;
  const left = clamp(num(r.left) ? /** @type {number} */ (r.left) : DEFAULT_RECT.left, 0, viewport.width - width);
  const top = clamp(num(r.top) ? /** @type {number} */ (r.top) : DEFAULT_RECT.top, 0, viewport.height - (height === null ? min.height : height));
  return { left, top, width, height };
}

/**
 * Arrastar: posição nova = posição inicial + deslocamento do ponteiro, sem sair da viewport.
 * @param {PointerStart} start
 * @param {Point} pointer
 * @param {Size} viewport
 * @returns {{left: number, top: number}}
 */
export function dragMove(start, pointer, viewport) {
  return {
    left: clamp(start.left + (pointer.x - start.x), 0, viewport.width - start.width),
    top: clamp(start.top + (pointer.y - start.y), 0, viewport.height - start.height),
  };
}

/**
 * Redimensionar pelo canto de baixo à direita: tamanho inicial + deslocamento, em [min, max] e sem
 * passar da borda direita/de baixo da viewport (o mínimo ganha se não couber).
 * @param {PointerStart} start
 * @param {Point} pointer
 * @param {Size} viewport
 * @param {Size} min
 * @param {Size} max
 * @returns {Size}
 */
export function resizeTo(start, pointer, viewport, min, max) {
  return {
    width: clamp(start.width + (pointer.x - start.x), min.width, Math.min(max.width, viewport.width - start.left)),
    height: clamp(start.height + (pointer.y - start.y), min.height, Math.min(max.height, viewport.height - start.top)),
  };
}
