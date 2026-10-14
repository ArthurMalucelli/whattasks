// @ts-check
/** @typedef {import('./messages.js').RawMsg} RawMsg */
/** @typedef {import('./messages.js').Item} Item */
/** @typedef {import('./messages.js').ItemType} ItemType */

/** Tipos de sistema/ruído que não viram Item. */
const DISCARDED = new Set([
  'e2e_notification', 'gp2', 'notification_template', 'reaction', 'call_log', 'ciphertext', 'protocol',
]);

/** @type {Record<string, string>} Observação fixa por tipo que vira 'other'. */
const OTHER_NOTES = {
  video: 'vídeo não lido',
  ptv: 'vídeo curto não lido',
  sticker: 'figurinha',
  poll_creation: 'enquete não lida',
  location: 'localização',
  vcard: 'contato compartilhado',
  revoked: 'mensagem apagada',
};

/**
 * Normaliza uma RawMsg (Store) em Item; null se a mensagem deve ser descartada.
 * @param {RawMsg} raw
 * @returns {Item | null}
 */
export function toItem(raw) {
  if (DISCARDED.has(raw.type)) return null;
  const { type, note } = classify(raw);
  return {
    id: raw.id,
    hex: raw.hex,
    t: Number(raw.t) || 0,
    author: raw.authorName || (raw.fromMe ? 'Eu' : '?'),
    fromMe: !!raw.fromMe,
    type,
    text: textOf(raw),
    filename: raw.filename || '',
    mime: raw.mimetype || '',
    durationSec: Number(raw.duration) || 0,
    sizeBytes: Number(raw.size) || 0,
    pageCount: Number(raw.pageCount) || 0,
    quotedHex: raw.quotedHex || '',
    quotedText: raw.quotedText || '',
    note,
  };
}

/**
 * Texto enviado ao modelo: body só pra 'chat', caption pra mídia (body de mídia é thumbnail).
 * View-once nunca leva conteúdo: o remetente marcou como efêmero e a note diz "não lida".
 * @param {RawMsg} raw
 * @returns {string}
 */
function textOf(raw) {
  if (raw.isViewOnce) return '';
  return raw.type === 'chat' ? (raw.body ?? '') : (raw.caption ?? '');
}

/**
 * Decide ItemType e a observação pro payload.
 * @param {RawMsg} raw
 * @returns {{type: ItemType, note: string}}
 */
function classify(raw) {
  if (raw.isViewOnce) return other('visualização única não lida');
  switch (raw.type) {
    case 'chat': return { type: 'text', note: '' };
    case 'ptt': return { type: 'ptt', note: '' };
    case 'audio': return { type: 'audio', note: '' };
    case 'image': return { type: 'image', note: '' };
    case 'document':
      if (raw.mimetype === 'application/pdf') return { type: 'document', note: '' };
      return other(raw.filename ? `anexo "${raw.filename}" não lido` : 'anexo não lido');
    default: {
      if (Object.hasOwn(OTHER_NOTES, raw.type)) return other(OTHER_NOTES[raw.type]);
      return other(`tipo "${raw.type}" não suportado`);
    }
  }
}

/**
 * @param {string} note
 * @returns {{type: ItemType, note: string}}
 */
function other(note) {
  return { type: 'other', note };
}
