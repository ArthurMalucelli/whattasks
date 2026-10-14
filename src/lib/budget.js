// @ts-check
/**
 * Limites de mídia por request e estimativa de custo.
 * Nunca remove itens da conversa: mídia que não pode ser enviada vira item 'other' com nota.
 */

/** @typedef {import('./messages.js').Item} Item */

/**
 * @typedef {Object} Limits
 * @property {number} maxAudioMinutesTotal
 * @property {number} maxAudioMinutesEach
 * @property {number} maxPdfBytes
 * @property {number} maxPdfPagesTotal
 * @property {number} maxImages
 * @property {number} maxImageBytes
 * @property {number} maxBase64Bytes
 */

/**
 * @typedef {Object} Prices
 * @property {number} inputPerM   USD por 1M tokens de entrada
 * @property {number} outputPerM  USD por 1M tokens de saída
 * @property {number} sttPerMin   USD por minuto de transcrição
 */

/** @typedef {{id: string, reason: string}} Dropped */

const MB = 1024 * 1024;

/** @type {Readonly<Limits>} */
export const DEFAULT_LIMITS = Object.freeze({
  maxAudioMinutesTotal: 60,
  maxAudioMinutesEach: 8,
  maxPdfBytes: 22 * MB,
  maxPdfPagesTotal: 600,
  maxImages: 20,
  maxImageBytes: 10 * MB,
  maxBase64Bytes: 30 * MB,
});

/** USD; Claude Opus 5.5 via OpenRouter; ElevenLabs Scribe v2. @type {Readonly<Prices>} */
export const DEFAULT_PRICES = Object.freeze({ inputPerM: 4, outputPerM: 20, sttPerMin: 0.0037 });

/** @param {Item} it */
const isAudio = (it) => it.type === 'ptt' || it.type === 'audio';

/**
 * Motivo e nota de descarte por item (passo 1), ou null se o item passa.
 * @param {Item} it
 * @param {Limits} limits
 * @returns {{reason: string, note: string} | null}
 */
function perItemRule(it, limits) {
  if (isAudio(it) && it.durationSec > limits.maxAudioMinutesEach * 60) {
    return { reason: 'audio_too_long', note: `áudio longo demais: ${Math.round(it.durationSec / 60)} min` };
  }
  if (it.type === 'document' && it.sizeBytes > limits.maxPdfBytes) {
    return { reason: 'pdf_too_big', note: `PDF não enviado: ${Math.round(it.sizeBytes / MB)} MB` };
  }
  if (it.type === 'image' && it.sizeBytes > limits.maxImageBytes) {
    return { reason: 'image_too_big', note: `imagem não enviada: ${Math.round(it.sizeBytes / MB)} MB` };
  }
  return null;
}

/**
 * Aplica os limites de mídia do request.
 * @param {Item[]} items
 * @param {Limits} [limits]
 * @returns {{items: Item[], dropped: Dropped[], audioMinutes: number, needsAudioConfirm: boolean, unknownPages: number}}
 */
export function applyLimits(items, limits = DEFAULT_LIMITS) {
  const out = items.map((it) => ({ ...it }));
  /** @type {Dropped[]} */
  const dropped = [];

  /** @param {number} i @param {string} reason @param {string} note */
  const convert = (i, reason, note) => {
    out[i] = { ...out[i], type: 'other', note };
    dropped.push({ id: out[i].id, reason });
  };

  // 1. por item
  out.forEach((it, i) => {
    const rule = perItemRule(it, limits);
    if (rule) convert(i, rule.reason, rule.note);
  });

  /** @param {Item['type']} type */
  const indexesOf = (type) => out.flatMap((it, i) => (it.type === type ? [i] : []));

  // 2. limite de quantidade de imagens (mantém as primeiras na ordem do array)
  for (const i of indexesOf('image').slice(limits.maxImages)) {
    convert(i, 'image_limit', `imagem não enviada: limite de ${limits.maxImages} imagens`);
  }

  // 3. limite de páginas somadas dos PDFs
  /** @param {number} i */
  const pagesOf = (i) => out[i].pageCount;
  let docs = indexesOf('document');
  while (sum(docs, pagesOf) > limits.maxPdfPagesTotal) {
    const i = largest(docs, pagesOf);
    convert(i, 'pdf_pages', 'PDF não enviado: limite de páginas no request');
    docs = docs.filter((d) => d !== i);
  }

  // 4. orçamento de base64 (PDFs primeiro, depois imagens; sempre o maior)
  /** @param {number} i */
  const b64Of = (i) => Math.ceil((out[i].sizeBytes * 4) / 3);
  let images = indexesOf('image');
  while (sum(docs, b64Of) + sum(images, b64Of) > limits.maxBase64Bytes) {
    const fromDocs = docs.length > 0;
    const i = largest(fromDocs ? docs : images, b64Of);
    convert(i, 'budget', 'não enviado: limite de tamanho do request');
    if (fromDocs) docs = docs.filter((d) => d !== i);
    else images = images.filter((m) => m !== i);
  }

  const audioMinutes = sumAudioMinutes(out);
  return {
    items: out,
    dropped,
    audioMinutes,
    needsAudioConfirm: audioMinutes > limits.maxAudioMinutesTotal,
    unknownPages: docs.filter((i) => out[i].pageCount === 0).length,
  };
}

/**
 * @param {number[]} idx
 * @param {(i: number) => number} f
 */
function sum(idx, f) {
  return idx.reduce((acc, i) => acc + f(i), 0);
}

/**
 * Índice com maior f(i); em empate, o primeiro na ordem.
 * @param {number[]} idx  não vazio
 * @param {(i: number) => number} f
 */
function largest(idx, f) {
  return idx.reduce((best, i) => (f(i) > f(best) ? i : best));
}

/**
 * Minutos somados dos itens ptt/audio, arredondado a 1 decimal.
 * @param {Item[]} items
 */
function sumAudioMinutes(items) {
  const sec = items.filter(isAudio).reduce((acc, it) => acc + it.durationSec, 0);
  return Math.round((sec / 60) * 10) / 10;
}

const TOKENS_OVERHEAD = 500;
const CHARS_PER_TOKEN = 3.2;
const TOKENS_PER_PAGE = 2000;
const TOKENS_PER_IMAGE = 1600;
const TOKENS_PER_ITEM = 100;
const TYPICAL_OUT = 6000;
const MAX_OUT = 32000;

/** @param {number} x */
const round4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * Estima tokens de entrada e custo (USD) do request, incluindo transcrição de áudio.
 * @param {Item[]} items
 * @param {Prices} [prices]
 * @param {{typicalOut?: number, maxOut?: number}} [opts]
 * @returns {{typical: number, max: number, inputTokens: number, audioMinutes: number}}
 */
export function estimateCost(items, prices = DEFAULT_PRICES, opts = {}) {
  const chars = items.reduce((acc, it) => acc + it.text.length, 0);
  const pages = items.reduce((acc, it) => acc + (it.type === 'document' ? it.pageCount : 0), 0);
  const images = items.filter((it) => it.type === 'image').length;
  const inputTokens =
    TOKENS_OVERHEAD +
    Math.ceil(chars / CHARS_PER_TOKEN) +
    pages * TOKENS_PER_PAGE +
    images * TOKENS_PER_IMAGE +
    items.length * TOKENS_PER_ITEM;
  const audioMinutes = sumAudioMinutes(items);

  /** @param {number} outTokens */
  const cost = (outTokens) =>
    round4(
      (inputTokens / 1e6) * prices.inputPerM + (outTokens / 1e6) * prices.outputPerM + audioMinutes * prices.sttPerMin,
    );

  return {
    typical: cost(opts.typicalOut ?? TYPICAL_OUT),
    max: cost(opts.maxOut ?? MAX_OUT),
    inputTokens,
    audioMinutes,
  };
}
