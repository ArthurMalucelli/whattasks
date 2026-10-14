// @ts-check
/**
 * Contratos compartilhados entre panel, content script e funções de Store.
 * Content scripts são scripts classic (sem import): usam as mesmas strings literais.
 */

/** Nomes de mensagem panel ⇄ content script (chrome.tabs.sendMessage / chrome.runtime.sendMessage). */
export const MSG = Object.freeze({
  PING: 'PING',
  PICK_START: 'PICK_START',
  PICK_CANCEL: 'PICK_CANCEL',
  COLLECT_DOM: 'COLLECT_DOM',
  PICKED: 'PICKED',
  PICK_CANCELLED: 'PICK_CANCELLED',
  CHAT_CHANGED: 'CHAT_CHANGED',
  /** data-icon do trilho de ícones do WhatsApp (linha "trilho" do Diagnóstico) */
  RAIL_INFO: 'RAIL_INFO',
});

/**
 * Mensagens pro background (chrome.runtime.sendMessage), usadas quando o painel roda DENTRO do
 * WhatsApp (overlay): o content script não tem chrome.scripting nem pode fazer fetch com as permissões
 * da extensão. Resposta sempre no envelope {ok: true, result} | {ok: false, error}.
 * TOGGLE_PANEL vai do background pro overlay.js (clique no ícone da barra com o WhatsApp aberto).
 */
export const BG = Object.freeze({
  STORE: 'STORE',
  FETCH: 'FETCH',
  FETCH_ABORT: 'FETCH_ABORT',
  OPEN_WINDOW: 'OPEN_WINDOW',
  KEEPALIVE: 'KEEPALIVE',
  TOGGLE_PANEL: 'TOGGLE_PANEL',
});

/**
 * Nome da porta que o panel abre enquanto está aberto: chrome.tabs.connect(tabId, { name: PANEL_PORT }).
 * Quando a última porta fecha, o content script cancela a seleção e para o MutationObserver.
 */
export const PANEL_PORT = 'wa-tasks-panel';

/**
 * Mensagem crua devolvida por storeCollect (main world), um objeto simples por mensagem.
 * @typedef {Object} RawMsg
 * @property {string} id            id serializado (igual ao data-id da linha)
 * @property {string} hex           token de índice 2 do id (chave curta da mensagem)
 * @property {number} t             unix seconds
 * @property {boolean} fromMe
 * @property {string} type          'chat' | 'ptt' | 'audio' | 'image' | 'video' | 'ptv' | 'document' | 'sticker' | 'revoked' | 'poll_creation' | 'location' | 'vcard' | 'e2e_notification' | 'gp2' | 'notification_template' | 'reaction' | 'call_log' | 'ciphertext' | ...
 * @property {string} body          texto (em mídia é thumbnail base64: NÃO usar como texto)
 * @property {string} caption       legenda de mídia
 * @property {string} filename
 * @property {string} mimetype
 * @property {number|string} duration  segundos (pode vir como string)
 * @property {number} size          bytes
 * @property {number} pageCount
 * @property {boolean} isViewOnce
 * @property {string} quotedHex     hex da mensagem citada ('' se não cita)
 * @property {string} quotedText    até 120 chars da mensagem citada ('' se não cita)
 * @property {string} authorName    'Eu' se fromMe, senão nome resolvido do contato ou número
 */

/**
 * Linha do DOM serializada pelo dom-fallback.js (tier só-texto).
 * @typedef {Object} RawRow
 * @property {string} dataId
 * @property {number} domIndex      ordem de aparição no DOM (crescente = mais recente)
 * @property {string} pre           data-pre-plain-text, ex. "[09:41, 14/10/2026] Fulano: " ('' se não houver)
 * @property {string} text          texto do span.selectable-text, emoji <img alt> incluso ('' se não houver)
 * @property {boolean} hasPtt
 * @property {boolean} hasDoc
 * @property {boolean} hasImg
 */

/** @typedef {'text'|'ptt'|'audio'|'document'|'image'|'other'} ItemType */

/**
 * Mensagem normalizada, consumida por payload/budget/render.
 * @typedef {Object} Item
 * @property {string} id
 * @property {string} hex
 * @property {number} t             unix seconds
 * @property {string} author        'Eu' ou nome
 * @property {boolean} fromMe
 * @property {ItemType} type
 * @property {string} text          texto da mensagem ou legenda da mídia
 * @property {string} filename
 * @property {string} mime
 * @property {number} durationSec
 * @property {number} sizeBytes
 * @property {number} pageCount
 * @property {string} quotedHex
 * @property {string} quotedText
 * @property {string} note          observação pro payload quando type === 'other' ('' caso contrário)
 */

/**
 * Resultado de uma transcrição ou download de mídia, indexado por item.id.
 * @typedef {{ok: true, text: string} | {ok: false, error: string}} TranscriptResult
 * @typedef {{ok: true, mime: string, base64: string, bytes: number} | {ok: false, error: string, stage?: string}} MediaResult
 */
