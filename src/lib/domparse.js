// @ts-check
/**
 * Conversão das linhas cruas do DOM (tier só-texto) em Items normalizados.
 */
import { hexOf, sliceByIds } from './range.js';

/** @typedef {import('./messages.js').RawRow} RawRow */
/** @typedef {import('./messages.js').Item} Item */
/** @typedef {import('./messages.js').ItemType} ItemType */

/**
 * [hora:min( AM|PM)?, a/b/aaaa|a.b.aaaa] resto
 * \s cobre o espaço estreito (U+202F) que o Chrome usa antes de AM/PM.
 */
const PRE_RE = /^\s*\[(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?,\s*(\d{1,2})[./](\d{1,2})[./](\d{4})\]\s?([\s\S]*)$/;

/**
 * Lê o atributo data-pre-plain-text do WhatsApp Web.
 * Com AM/PM → mês/dia/ano; sem → dia/mês/ano. t = unix seconds de hora LOCAL.
 * @param {string} pre ex. '[09:41, 14/10/2026] Fulano: '
 * @returns {{t: number, author: string} | null}
 */
export function parsePrePlainText(pre) {
  const m = PRE_RE.exec(pre || '');
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3] ? m[3].toUpperCase() : '';
  const a = Number(m[4]);
  const b = Number(m[5]);
  const y = Number(m[6]);
  const [mon, day] = ampm ? [a, b] : [b, a];
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'P' ? 12 : 0);
  }
  if (h > 23 || min > 59 || mon < 1 || mon > 12 || day < 1) return null;
  const date = new Date(y, mon - 1, day, h, min);
  if (date.getMonth() !== mon - 1 || date.getDate() !== day) return null;
  const author = m[7].replace(/:\s*$/, '').trim();
  return { t: Math.floor(date.getTime() / 1000), author };
}

/**
 * Tipo e nota de uma linha no modo texto (mídia é ignorada, legenda preservada).
 * @param {RawRow} r
 * @returns {{type: ItemType, note: string}}
 */
function classify(r) {
  if (r.hasPtt) return { type: 'other', note: 'áudio ignorado (modo texto)' };
  if (r.hasDoc) return { type: 'other', note: 'documento ignorado (modo texto)' };
  if (r.hasImg) return { type: 'other', note: 'imagem ignorada (modo texto)' };
  if ((r.text || '').trim()) return { type: 'text', note: '' };
  return { type: 'other', note: 'mensagem sem texto' };
}

/**
 * Ordena as linhas por domIndex, recorta entre as âncoras (inclusivo, troca se invertidas)
 * e converte em Items. Linhas sem pre legível herdam t da anterior do recorte (0 se não há).
 * @param {RawRow[]} rows
 * @param {string} startId
 * @param {string} endId
 * @returns {{items: Item[], startFound: boolean, endFound: boolean}}
 */
export function domRowsToItems(rows, startId, endId) {
  const sorted = rows.map((r) => ({ ...r, id: r.dataId })).sort((a, b) => a.domIndex - b.domIndex);
  const { items: slice, startFound, endFound } = sliceByIds(sorted, startId, endId);
  let lastT = 0;
  /** @type {Item[]} */
  const items = slice.map((r) => {
    const fromMe = r.dataId.startsWith('true_');
    const parsed = parsePrePlainText(r.pre);
    const t = parsed ? parsed.t : lastT;
    lastT = t;
    const author = fromMe ? 'Eu' : parsed ? parsed.author : '?';
    return {
      id: r.dataId,
      hex: hexOf(r.dataId),
      t,
      author,
      fromMe,
      ...classify(r),
      text: r.text || '',
      filename: '',
      mime: '',
      durationSec: 0,
      sizeBytes: 0,
      pageCount: 0,
      quotedHex: '',
      quotedText: '',
    };
  });
  return { items, startFound, endFound };
}
