// @ts-check
/**
 * Lógica pura do job do side panel: resumo do trecho, o que falta baixar/transcrever,
 * configurações e textos de status. Sem chrome.* nem DOM aqui.
 */
import { DEFAULT_LIMITS } from './budget.js';
import { sliceByIds } from './range.js';

/** @typedef {import('./messages.js').Item} Item */

/**
 * @typedef {Object} Summary
 * @property {number} total
 * @property {number} audios        ptt + audio
 * @property {number} pdfs          type 'document'
 * @property {number} images
 * @property {number} others
 * @property {number} audioMinutes  1 decimal
 */

const BRL_NUM = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRL_MIN = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** @param {number} n */
const num2 = (n) => BRL_NUM.format(Number.isFinite(n) ? n : 0);

/**
 * @param {number} n  USD
 * @returns {string}  'US$ 0,31'
 */
export function formatUsd(n) {
  return `US$ ${num2(n)}`;
}

/** @param {Item} it */
export function needsTranscript(it) {
  return it.type === 'ptt' || it.type === 'audio';
}

/** @param {Item} it */
export function needsMedia(it) {
  return needsTranscript(it) || it.type === 'document' || it.type === 'image';
}

/**
 * @param {Item[]} items
 * @returns {Summary}
 */
export function summarizeItems(items) {
  const s = { total: items.length, audios: 0, pdfs: 0, images: 0, others: 0, audioMinutes: 0 };
  let sec = 0;
  for (const it of items) {
    if (needsTranscript(it)) { s.audios++; sec += it.durationSec || 0; }
    else if (it.type === 'document') s.pdfs++;
    else if (it.type === 'image') s.images++;
    else if (it.type === 'other') s.others++;
  }
  s.audioMinutes = Math.round((sec / 60) * 10) / 10;
  return s;
}

/**
 * @param {number} n @param {string} one @param {string} many
 */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * '142 msgs · 3 áudios · 1 PDF · 2 imagens · ≈ 4,2 min de áudio · ≈ US$ 0,31 (máx. 0,90)'
 * @param {Summary} s
 * @param {{typical: number, max: number}} cost
 * @returns {string}
 */
export function summaryLine(s, cost) {
  const segs = [plural(s.total, 'msg', 'msgs')];
  if (s.audios) segs.push(plural(s.audios, 'áudio', 'áudios'));
  if (s.pdfs) segs.push(plural(s.pdfs, 'PDF', 'PDFs'));
  if (s.images) segs.push(plural(s.images, 'imagem', 'imagens'));
  if (s.audioMinutes > 0) segs.push(`≈ ${BRL_MIN.format(s.audioMinutes)} min de áudio`);
  segs.push(`≈ ${formatUsd(cost.typical)} (máx. ${num2(cost.max)})`);
  return segs.join(' · ');
}

/** @typedef {import('./messages.js').MediaResult} MediaResult */
/** @typedef {import('./messages.js').TranscriptResult} TranscriptResult */
/** @typedef {import('./budget.js').Limits} Limits */
/** @typedef {import('./budget.js').Prices} Prices */

/**
 * Itens que ainda precisam de mídia (sem resultado ok no Map). Áudio que já tem transcrição ok
 * (ex.: veio do cache) não precisa ser baixado: menos download e nenhum recibo de "ouvido".
 * @param {Item[]} items
 * @param {Map<string, MediaResult>} media
 * @param {Map<string, TranscriptResult>} [transcripts]
 * @returns {Item[]}
 */
export function remainingMedia(items, media, transcripts) {
  return items.filter((it) => needsMedia(it) && !media.get(it.id)?.ok
    && !(needsTranscript(it) && transcripts?.get(it.id)?.ok));
}

/**
 * Áudios com mídia ok e ainda sem transcrição ok.
 * @param {Item[]} items
 * @param {Map<string, MediaResult>} media
 * @param {Map<string, TranscriptResult>} transcripts
 * @returns {Item[]}
 */
export function remainingTranscripts(items, media, transcripts) {
  return items.filter((it) => needsTranscript(it) && media.get(it.id)?.ok && !transcripts.get(it.id)?.ok);
}

/**
 * Chaves de cache (t:<id>) dos áudios do trecho, sem duplicatas, pra UMA leitura do storage.
 * @param {Item[]} items
 * @returns {string[]}
 */
export function cachedTranscriptKeys(items) {
  return [...new Set(items.filter(needsTranscript).map((it) => transcriptCacheKey(it.id)))];
}

/**
 * Copia pro Map as transcrições do cache (resultado de chrome.storage.local.get) como ok.
 * Só entradas t:<id> com `text` string; nunca sobrescreve uma transcrição ok já em memória.
 * @param {Map<string, TranscriptResult>} transcripts  alterado no lugar
 * @param {Record<string, any> | null | undefined} stored
 * @returns {Map<string, TranscriptResult>}  o mesmo Map
 */
export function applyCachedTranscripts(transcripts, stored) {
  for (const [key, v] of Object.entries(stored || {})) {
    if (!isTranscriptCacheKey(key) || !v || typeof v.text !== 'string') continue;
    const id = key.slice(2);
    if (!transcripts.get(id)?.ok) transcripts.set(id, { ok: true, text: v.text });
  }
  return transcripts;
}

/**
 * Uma linha por áudio do trecho que ficou sem transcrição: '#n não transcrito: motivo'.
 * Áudio sem resultado nenhum (não processado) não entra.
 * @param {Item[]} items
 * @param {Map<string, TranscriptResult>} transcripts
 * @param {Map<string, MediaResult>} media
 * @returns {string[]}
 */
export function failedTranscriptNotes(items, transcripts, media) {
  /** @type {string[]} */
  const out = [];
  items.forEach((it, i) => {
    if (!needsTranscript(it)) return;
    const tr = transcripts.get(it.id);
    if (tr?.ok) return;
    const m = media.get(it.id);
    if (tr && !tr.ok) out.push(`#${i + 1} não transcrito: ${tr.error}`);
    else if (m && !m.ok) out.push(`#${i + 1} não transcrito: mídia indisponível: ${m.error}`);
  });
  return out;
}

export const AUDIO_RECEIPT_WARNING = 'o remetente pode ver os áudios como ouvidos';

/**
 * Aviso de recibo de "ouvido" (decisão 5 do plano): a linha fixa quando o plano tem áudio e o aviso está ligado.
 * @param {Item[]} items  itens planejados (depois de applyLimits)
 * @param {boolean} enabled
 * @returns {string}  '' quando não se aplica
 */
export function audioReceiptLine(items, enabled) {
  return enabled && items.some(needsTranscript) ? AUDIO_RECEIPT_WARNING : '';
}

// ---------- configurações ----------

/**
 * @typedef {Object} Settings
 * @property {string} apiKey
 * @property {string} model
 * @property {string} sttPrimary
 * @property {string} sttFallback
 * @property {number} maxMessages
 * @property {number} maxAudioMinutesTotal
 * @property {number} maxAudioMinutesEach
 * @property {number} inputPerM
 * @property {number} outputPerM
 * @property {number} sttPerMin
 * @property {number} costCap
 * @property {string} userName
 * @property {boolean} audioReceiptWarning  avisar (e pedir confirmação) quando o trecho tem áudio
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'anthropic/claude-opus-5.5',
  sttPrimary: 'elevenlabs/scribe-v2',
  sttFallback: 'openai/gpt-transcribe',
  maxMessages: 300,
  maxAudioMinutesTotal: 60,
  maxAudioMinutesEach: 8,
  inputPerM: 4,
  outputPerM: 20,
  sttPerMin: 0.0037,
  costCap: 1,
  userName: '',
  audioReceiptWarning: true,
});

const MAX_MESSAGES_RANGE = /** @type {const} */ ([1, 1000]);

/**
 * Número ≥ 0 a partir de number/string (aceita vírgula decimal); senão o default.
 * @param {unknown} v @param {number} dflt
 */
function toNum(v, dflt) {
  if (typeof v === 'string') v = v.trim().replace(',', '.');
  if (v === '' || v === null || v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/**
 * Boolean a partir de boolean ou 'true'/'false'; senão o default.
 * @param {unknown} v @param {boolean} dflt
 */
function toBool(v, dflt) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return dflt;
}

/**
 * Configurações completas a partir do que está salvo (qualquer forma).
 * @param {unknown} stored
 * @returns {Settings}
 */
export function mergeSettings(stored) {
  const src = /** @type {Record<string, unknown>} */ (stored && typeof stored === 'object' ? stored : {});
  /** @type {Record<string, string|number|boolean>} */
  const out = {};
  for (const [key, dflt] of Object.entries(DEFAULT_SETTINGS)) {
    const v = src[key];
    if (typeof dflt === 'number') out[key] = toNum(v, dflt);
    else if (typeof dflt === 'boolean') out[key] = toBool(v, dflt);
    else {
      const s = typeof v === 'string' ? v.trim() : '';
      out[key] = s || (key === 'apiKey' ? '' : dflt);
    }
  }
  const [lo, hi] = MAX_MESSAGES_RANGE;
  out.maxMessages = Math.min(hi, Math.max(lo, Math.round(/** @type {number} */ (out.maxMessages))));
  return /** @type {Settings} */ (/** @type {unknown} */ (out));
}

/** @param {Settings} s @returns {Limits} */
export function limitsFromSettings(s) {
  return { ...DEFAULT_LIMITS, maxAudioMinutesTotal: s.maxAudioMinutesTotal, maxAudioMinutesEach: s.maxAudioMinutesEach };
}

/** @param {Settings} s @returns {Prices} */
export function pricesFromSettings(s) {
  return { inputPerM: s.inputPerM, outputPerM: s.outputPerM, sttPerMin: s.sttPerMin };
}

/**
 * Modelos de STT em ordem: primário, depois o fallback (se for outro modelo). O retry do primário
 * (1x, só em erro transitório) é decidido por sttShouldRetry.
 * @param {Settings} s
 * @returns {string[]}
 */
export function sttModels(s) {
  const out = [s.sttPrimary];
  if (s.sttFallback && s.sttFallback !== s.sttPrimary) out.push(s.sttFallback);
  return out;
}

/** Espera antes do retry do STT primário (ms). */
export const STT_RETRY_DELAY_MS = 2000;

/**
 * Erro estruturado do STT (openrouter.js): `kind` diz de onde veio, `status` é o HTTP (0 sem resposta).
 * @typedef {{kind: 'http'|'timeout'|'network'|'abort'|'parse'|'unknown', status: number}} SttError
 */

/**
 * Vale repetir o primário? Só em erro transitório: timeout, rede ou HTTP 5xx (nunca 4xx nem cancelamento).
 * @param {SttError | null | undefined} err
 * @returns {boolean}
 */
export function sttShouldRetry(err) {
  if (!err) return false;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  return err.kind === 'http' && err.status >= 500;
}

/**
 * O provedor recusou o structured output (response_format/json_schema), devolveu HTTP 400 ou o
 * OpenRouter não achou provedor que aceite os parâmetros (404 'No endpoints found that can handle',
 * quando require_parameters não é satisfeito)?
 * @param {string} error
 * @returns {boolean}
 */
export function isSchemaRejection(error) {
  const e = error || '';
  return /response_format|json_schema|structured|no endpoints found that can handle/i.test(e) || /\bHTTP 400\b/.test(e);
}

/** @type {Array<[RegExp, string]>} */
const AUDIO_FORMATS = [
  [/ogg|opus/, 'ogg'],
  [/mpeg|mp3/, 'mp3'],
  [/mp4|m4a/, 'm4a'],
  [/aac/, 'aac'],
  [/wav/, 'wav'],
  [/webm/, 'webm'],
  [/flac/, 'flac'],
];

/**
 * Formato pro input_audio do STT a partir do mime (default 'ogg', o do PTT).
 * @param {string} mime
 * @returns {string}
 */
export function audioFormat(mime) {
  const m = (mime || '').toLowerCase();
  if (!m.startsWith('audio/')) return 'ogg';
  for (const [re, fmt] of AUDIO_FORMATS) if (re.test(m)) return fmt;
  return 'ogg';
}

/** @param {string} chatId */
export function isGroupChat(chatId) {
  return (chatId || '').endsWith('@g.us');
}

/**
 * Grupo inferido pelos ids das mensagens (tier DOM, sem chatId): id de grupo contém '@g.us'.
 * @param {Array<{id: string}>} items
 * @returns {boolean}
 */
export function isGroupFromIds(items) {
  return items.some((it) => /@g\.us/.test(it.id));
}

// ---------- coleta ----------

const ANCHORS_MSG = 'role de novo pelo trecho e selecione outra vez';

/** Códigos de erro de storeCollect (store-calls.js) → texto em PT-BR. @type {Record<string, string>} */
const STORE_ERRORS = {
  chat_not_found: 'chat não encontrado no Store; recarregue a aba',
  anchor_not_in_chat_msgs: ANCHORS_MSG,
};

/**
 * Bloqueio do limite de mensagens (os dois tiers), ou null se cabe.
 * @param {number} n @param {number} cap
 * @returns {string|null}
 */
export function tooManyMessages(n, cap) {
  return n > cap ? `trecho de ${n} msgs, acima do limite de ${cap}; aumente o limite ou encurte` : null;
}

/**
 * Só os ids do DOM entre as duas âncoras (inclusive, em qualquer ordem); [] se faltar âncora.
 * @param {string[]} domIds
 * @param {string} startId
 * @param {string} endId
 * @returns {string[]}
 */
export function domIdsBetween(domIds, startId, endId) {
  return sliceByIds(domIds.map((id) => ({ id })), startId, endId).items.map((x) => x.id);
}

/**
 * @param {{startFound: boolean, endFound: boolean}} r
 * @returns {string|null}
 */
export function anchorsProblem(r) {
  return r.startFound && r.endFound ? null : ANCHORS_MSG;
}

/**
 * Mensagem de bloqueio da coleta pelo Store, ou null se deu certo.
 * @param {{error: string, startFound: boolean, endFound: boolean, truncated: boolean, total: number}} r
 * @param {number} cap
 * @returns {string|null}
 */
export function storeCollectProblem(r, cap) {
  if (r.error) return STORE_ERRORS[r.error] || `erro no Store: ${r.error}`;
  const anchors = anchorsProblem(r);
  if (anchors) return anchors;
  if (r.truncated) return tooManyMessages(r.total, cap);
  return null;
}

/**
 * @param {number} n  ids vistos no DOM que não estão no Store
 * @returns {string}  '' quando n = 0
 */
export function missingFromStoreWarning(n) {
  if (!n) return '';
  const what = n === 1 ? '1 mensagem vista na tela não está no Store' : `${n} mensagens vistas na tela não estão no Store`;
  return `${what}; role mais devagar e selecione de novo`;
}

/**
 * Notas legíveis dos itens convertidos por applyLimits: '#n: nota'.
 * @param {Array<{id: string, reason: string}>} dropped
 * @param {Item[]} planned  itens já com as notas de applyLimits
 * @returns {string[]}
 */
export function droppedNotes(dropped, planned) {
  return dropped.map((d) => {
    const i = planned.findIndex((it) => it.id === d.id);
    return i < 0 ? d.reason : `#${i + 1}: ${planned[i].note || d.reason}`;
  });
}

// ---------- job ----------

/** @param {string} id */
export function transcriptCacheKey(id) {
  return `t:${id}`;
}

/** @param {string} key */
export function isTranscriptCacheKey(key) {
  return key.startsWith('t:');
}

/**
 * @param {{typical: number}} cost
 * @param {number} cap
 */
export function needsCostConfirm(cost, cap) {
  return cost.typical > cap;
}

/**
 * O que o panel faz com um PICK_CANCELLED do content script (Esc ou troca de chat).
 * Com job rodando, job retomável ou itens já coletados, o trecho fica (o Retomar precisa dele);
 * só a seleção ainda em andamento é zerada.
 * @param {{running: boolean, resumable: boolean, collected: boolean}} s
 * @returns {'keep'|'reset'}
 */
export function pickCancelledAction(s) {
  return s.running || s.resumable || s.collected ? 'keep' : 'reset';
}

/**
 * @param {string} chatName
 * @returns {string}
 */
export const SELECTION_CLEARED_WARNING = (chatName) =>
  `seleção apagada no WhatsApp; os itens coletados continuam válidos ${chatName ? `no chat "${chatName}"` : 'no chat selecionado'}`;

/**
 * Aviso persistente quando o PICK_CANCELLED mantém um trecho já coletado: o realce sumiu do
 * WhatsApp (o chat mudou), mas os previews do panel continuam e o trecho ainda vale naquele chat.
 * Vale também com job rodando: se ele parar por troca de chat, os previews precisam da explicação.
 * @param {{collected: boolean, chatName: string, running?: boolean}} s
 * @returns {string}  '' quando não se aplica
 */
export function pickCancelledWarning(s) {
  return s.collected ? SELECTION_CLEARED_WARNING(s.chatName || '') : '';
}

/**
 * Bloqueio do job: o chat aberto precisa ser o do trecho coletado (rodada nova) ou o do job (Retomar).
 * @param {string} activeChat
 * @param {string} chatName  chat do trecho
 * @param {boolean} isResume
 * @returns {string|null}
 */
export function activeChatProblem(activeChat, chatName, isResume) {
  if (activeChat === chatName) return null;
  return isResume
    ? `volte pro chat ${chatName} e clique Retomar`
    : `o chat ativo mudou: volte pro chat ${chatName} ou selecione de novo`;
}

/**
 * Salvar configurações coleta de novo? Só com as duas âncoras, nenhum item (a coleta foi barrada,
 * ex.: pelo limite de mensagens no Store) e nenhum job rodando. Com itens, o plano é refeito sem coletar.
 * @param {{startId: string|null, endId: string|null, items: number, running: boolean}} s
 * @returns {boolean}
 */
export function needsRecollect(s) {
  return !!s.startId && !!s.endId && s.items === 0 && !s.running;
}

/**
 * A seleção foi feita em outra aba do WhatsApp (o content script desta aba não a conhece)?
 * @param {number|null} selTabId  aba onde a seleção começou (null sem seleção)
 * @param {number} currentTabId
 * @returns {boolean}
 */
export function selectionTabChanged(selTabId, currentTabId) {
  return selTabId !== null && selTabId !== currentTabId;
}

/**
 * Dica abaixo do botão de seleção.
 * @param {{picking: boolean, startId: string|null, endId: string|null, harvested: number}} s
 * @returns {string}
 */
export function pickHint(s) {
  if (s.picking) return s.startId ? 'agora clique na última' : 'clique na primeira mensagem…';
  return s.startId && s.endId ? plural(s.harvested, 'linha vista', 'linhas vistas') : '';
}

/** Prazo de um storeMedia (executeScript pode travar sem nunca resolver). */
export const MEDIA_TIMEOUT_MS = 60_000;
export const MEDIA_TIMEOUT_ERROR = 'timeout 60 s';

/**
 * Promessa que nunca resolve e rejeita com Error('cancelado') quando o signal aborta (na hora, se
 * já abortado). Pra usar num Promise.race com uma chamada que não aceita signal.
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 */
export function abortPromise(signal) {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error('cancelado'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/**
 * A promessa, ou Error(label) se não assentar em `ms`. O timer é limpo quando ela assenta.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  /** @type {Promise<never>} */
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {'media'|'stt'|'chat'} phase
 * @param {number} done
 * @param {number} total
 */
export function phaseLabel(phase, done, total) {
  if (phase === 'media') return `baixando mídia ${done}/${total}`;
  if (phase === 'stt') return `transcrevendo ${done}/${total}`;
  return 'gerando…';
}

/**
 * Texto puro das partes de texto do payload (labels + transcrições), sem anexos.
 * @param {Array<{type: string, text?: string}>} parts
 * @returns {string}
 */
export function plainLabels(parts) {
  return parts.flatMap((p) => (p.type === 'text' && typeof p.text === 'string' ? [p.text] : [])).join('\n');
}

/**
 * Retorno de storeStatus (store-calls.js): `missing` derruba o tier Store, `warnings` não.
 * @typedef {{ready: boolean, loading?: boolean, missing: string[], warnings: string[], chatId: string, chatName: string, waVersion: string}} StoreStatus
 */

/**
 * Linha de status do modo texto (tier DOM).
 * @param {string} missing  o que faltou, já legível
 * @returns {string}
 */
export function domTierLine(missing) {
  return `modo texto: mídia ignorada; módulos do WhatsApp mudaram (faltou: ${missing}). Rode o Diagnóstico.`;
}

/**
 * Linha de status do panel a partir do storeStatus.
 * @param {StoreStatus} st
 * @param {string} activeChat
 * @returns {{text: string, kind: 'ok'|'warn'}}
 */
export function storeStatusLine(st, activeChat) {
  if (st.loading) return { text: 'WhatsApp ainda carregando… aguardando pra ler o Store', kind: 'warn' };
  if (!st.ready) return { text: domTierLine(st.missing.join(', ')), kind: 'warn' };
  const text = `Store pronto · ${activeChat || 'nenhum chat aberto'}`;
  return st.warnings.length ? { text: `${text} · aviso: ${st.warnings.join(', ')}`, kind: 'warn' } : { text, kind: 'ok' };
}

/**
 * @typedef {Object} DiagInput
 * @property {StoreStatus} status
 * @property {{rows: Array<{id: string, found: boolean, type: string, author: string, storeId?: string}>, msgsInStore: number, chatId: string, chatName?: string, lastPttId: string, idFormat?: string, idKeys?: string, error: string}} diag
 * @property {Record<string, any> | null} ping
 * @property {{ok: boolean, mime?: string, bytes?: number, error?: string, stage?: string, base64?: string} | undefined} media
 * @property {string[] | null} [rail]  data-icon do trilho de ícones do WhatsApp (null = não achou; ausente = não perguntado)
 */

/**
 * Relatório legível do Diagnóstico (nunca inclui base64).
 * @param {DiagInput} d
 * @returns {string}
 */
export function diagReport({ status, diag, ping, media, rail }) {
  const lines = [
    `tier: ${status.ready ? 'store' : 'dom'}`,
    `faltando: ${status.missing.length ? status.missing.join(', ') : '(nada)'}`,
    `avisos: ${status.warnings.length ? status.warnings.join(', ') : '(nenhum)'}`,
    `waVersion: ${status.waVersion || '?'}`,
    `chatId: ${diag.chatId || status.chatId || '?'}`,
    `chatName: ${status.chatName || '?'}`,
    `msgsInStore: ${diag.msgsInStore}`,
  ];
  if (diag.error) lines.push(`erro do diag: ${diag.error}`);
  if (diag.idFormat) lines.push(`formato do data-id: ${diag.idFormat}${diag.idKeys ? ` · chaves do id no Store: ${diag.idKeys}` : ''}`);
  lines.push(`linhas visíveis (${diag.rows.length}):`);
  for (const r of diag.rows) {
    lines.push(r.found ? `  ${r.id} → encontrada · ${r.type} · ${r.author}${r.storeId ? ` · store: ${r.storeId}` : ''}` : `  ${r.id} → NÃO encontrada`);
  }
  if (!ping) lines.push('PING: falhou (recarregue a aba do WhatsApp)');
  else {
    const p = ['chatName', 'picking', 'startId', 'endId', 'harvested'].map((k) => `${k}=${String(ping[k])}`);
    lines.push(`PING: ok · ${p.join(' · ')}`);
  }
  if (rail !== undefined) lines.push(`trilho: ${rail && rail.length ? rail.join(', ') : 'não encontrado'}`);
  if (media) {
    const who = diag.lastPttId || '?';
    lines.push(media.ok
      ? `mídia ${who}: ok ${media.mime} · ${media.bytes} bytes`
      : `mídia ${who}: erro ${media.error}${media.stage ? ` (stage ${media.stage})` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Primeiro e último tempo conhecidos (t > 0) do trecho; null se nenhum item tem hora.
 * No modo texto, linhas sem data-pre-plain-text ficam com t=0 e não podem virar "1970" no cabeçalho.
 * @param {Item[]} items
 * @returns {{from: Date, to: Date} | null}
 */
export function knownTimeRange(items) {
  const known = items.filter((it) => Number.isFinite(it.t) && it.t > 0);
  if (!known.length) return null;
  return { from: new Date(known[0].t * 1000), to: new Date(known[known.length - 1].t * 1000) };
}

/** Origens que a extensão precisa (content script no WhatsApp Web e fetch pro OpenRouter). */
export const REQUIRED_ORIGINS = Object.freeze(['https://web.whatsapp.com/*', 'https://openrouter.ai/*']);

/**
 * Escolhe a aba do WhatsApp Web. No Chrome o painel é por janela; no Firefox/Zen ele pode ser a
 * sidebar ou uma janela própria, então "aba ativa da janela atual" não basta.
 * Preferência: ativa na janela atual → ativa em qualquer janela → acessada mais recentemente.
 * @param {Array<{id?: number, url?: string, active?: boolean, windowId?: number, lastAccessed?: number}>} tabs
 * @param {number|undefined} currentWindowId
 */
export function pickWhatsAppTab(tabs, currentWindowId) {
  const wa = tabs.filter((t) => t.id !== undefined && typeof t.url === 'string' && t.url.startsWith('https://web.whatsapp.com/'));
  if (!wa.length) return null;
  return (
    wa.find((t) => t.active && t.windowId === currentWindowId) ||
    wa.find((t) => t.active) ||
    wa.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
  );
}
