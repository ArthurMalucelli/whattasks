// @ts-check
/**
 * Utilitários puros de recorte de intervalo de mensagens por id.
 */

/**
 * Chave curta de uma mensagem: token de índice 2 do id serializado.
 * 'false_5511999@c.us_3EB0ABCDEF' → '3EB0ABCDEF'
 * 'false_1203630@g.us_3EB0ABCDEF_5511999@c.us' → '3EB0ABCDEF'
 * @param {string} id
 * @returns {string}
 */
export function hexOf(id) {
  const parts = id.split('_');
  return parts.length >= 3 ? parts[2] : id;
}

/**
 * Ids presentes no DOM mas ausentes no Store, na ordem do DOM, sem duplicatas.
 * @param {string[]} storeIds
 * @param {string[]} domIds
 * @returns {string[]}
 */
export function diffIds(storeIds, domIds) {
  const known = new Set(storeIds);
  /** @type {Set<string>} */
  const out = new Set();
  for (const id of domIds) if (!known.has(id)) out.add(id);
  return [...out];
}

/**
 * Recorte inclusivo entre duas âncoras, em itens já em ordem cronológica.
 * Se start vier depois de end, as âncoras são trocadas (swapped: true).
 * Se alguma âncora faltar, items é [] e as flags dizem qual foi achada.
 * @template {{id: string}} T
 * @param {T[]} items
 * @param {string} startId
 * @param {string} endId
 * @returns {{items: T[], startFound: boolean, endFound: boolean, swapped: boolean}}
 */
export function sliceByIds(items, startId, endId) {
  const a = items.findIndex((it) => it.id === startId);
  const b = items.findIndex((it) => it.id === endId);
  const startFound = a !== -1;
  const endFound = b !== -1;
  if (!startFound || !endFound) return { items: [], startFound, endFound, swapped: false };
  const swapped = a > b;
  const [lo, hi] = swapped ? [b, a] : [a, b];
  return { items: items.slice(lo, hi + 1), startFound, endFound, swapped };
}
