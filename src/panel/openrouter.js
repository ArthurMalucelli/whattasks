// @ts-check
/**
 * Wrappers finos pro OpenRouter. Nunca lançam: devolvem {ok:false, error} com texto em PT-BR.
 * Corpo/parsing ficam em ../lib/requests.js. A rede vem injetada (`http`): fetch direto na
 * sidebar/janela, ou pedido ao background quando o painel roda dentro do WhatsApp.
 */
import { CHAT_URL, STT_URL, authHeaders, buildSttRequest, parseChatResponse, parseSttResponse } from '../lib/requests.js';

const STT_TIMEOUT_MS = 75_000;
const CHAT_TIMEOUT_MS = 300_000;
const RETRY_DELAY_MS = 2_000;

/** @typedef {import('../lib/job.js').SttError} SttError */
/** @typedef {import('../lib/http.js').HttpRequest} HttpRequest */
/** @typedef {import('../lib/http.js').HttpResponse} HttpResponse */
/** @typedef {(req: HttpRequest) => Promise<HttpResponse>} Http */
/** @typedef {{ok: true, text: string, cost: number} | ({ok: false, error: string} & SttError)} SttResult */
/** @typedef {{ok: true, text: string, finishReason: string, cost: number, provider: string} | {ok: false, error: string, cost?: number}} ChatResult */

/**
 * Erro de fetch → tipo + frase legível. Job abortado (abort('cancel'|'chat'|'tab') rejeita com a
 * string do motivo, não com AbortError) sempre vira 'cancelado'.
 * @param {unknown} err
 * @param {number} ms   timeout usado
 * @param {AbortSignal | undefined} signal  signal do job (sem o timeout)
 * @returns {{kind: 'timeout'|'abort'|'network'|'unknown', message: string}}
 */
function classifyError(err, ms, signal) {
  const e = /** @type {any} */ (err);
  if (signal?.aborted || (e && e.name === 'AbortError')) return { kind: 'abort', message: 'cancelado' };
  if (e && e.name === 'TimeoutError') return { kind: 'timeout', message: `tempo esgotado (${ms / 1000} s) esperando o OpenRouter` };
  if (e instanceof TypeError) return { kind: 'network', message: 'falha de rede: sem conexão com o OpenRouter' };
  return { kind: 'unknown', message: `erro inesperado: ${e && e.message ? e.message : String(e)}` };
}

/**
 * POST JSON. Lança só erro de rede/timeout/abort; HTTP != 2xx volta como {status, json|null, text}.
 * @param {Http} http
 * @param {string} url
 * @param {string} apiKey
 * @param {unknown} body
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<HttpResponse>}
 */
function postJson(http, url, apiKey, body, timeoutMs, signal) {
  return http({ url, method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body), timeoutMs, signal });
}

/**
 * Converte a resposta HTTP no resultado do parser, incluindo status e corpo quando não é JSON útil.
 * @template {{ok: boolean}} T
 * @param {{status: number, json: any, text: string}} r
 * @param {(json: any) => T} parse
 * @returns {T | {ok: false, error: string}}
 */
function interpret(r, parse) {
  if (r.json && typeof r.json === 'object') {
    const parsed = parse(r.json);
    if (!parsed.ok && r.status >= 400) {
      // mantém os outros campos do parser (ex.: cost do chat)
      return /** @type {any} */ ({ ...parsed, ok: false, error: `HTTP ${r.status}: ${/** @type {any} */ (parsed).error}` });
    }
    if (parsed.ok && r.status >= 400) return { ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 2000)}` };
    return parsed;
  }
  return { ok: false, error: `HTTP ${r.status}: ${r.text.slice(0, 2000) || '(corpo vazio)'}` };
}

/**
 * Transcreve um áudio (base64) com um modelo de STT.
 * @param {{apiKey: string, model: string, base64: string, format: string, signal?: AbortSignal, http: Http}} opts
 * @returns {Promise<SttResult>}
 */
export async function transcribe({ apiKey, model, base64, format, signal, http }) {
  try {
    const r = await postJson(http, STT_URL, apiKey, buildSttRequest({ model, base64, format }), STT_TIMEOUT_MS, signal);
    const res = interpret(r, parseSttResponse);
    if (res.ok) return res;
    // status do corpo (json.error.code) quando o HTTP veio 200 com erro dentro
    const code = Number(r.json?.error?.code);
    const status = r.status >= 400 ? r.status : (code >= 400 ? code : r.status);
    return { ok: false, error: res.error, kind: status >= 400 ? 'http' : 'parse', status };
  } catch (err) {
    const e = classifyError(err, STT_TIMEOUT_MS, signal);
    return { ok: false, error: e.message, kind: e.kind, status: 0 };
  }
}

/** Espera `ms` (resolve antes se o signal abortar). @param {number} ms @param {AbortSignal | undefined} signal */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(undefined); }, { once: true });
  });
}

/**
 * Chat completion com 1 retry em 429/5xx/erro de rede (não em timeout nem cancelamento).
 * @param {{apiKey: string, body: Record<string, any>, signal?: AbortSignal, http: Http}} opts
 * @returns {Promise<ChatResult>}
 */
export async function complete({ apiKey, body, signal, http }) {
  /** @type {ChatResult} */
  let last = { ok: false, error: 'não executado' };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS, signal);
      if (signal?.aborted) return { ok: false, error: 'cancelado' };
    }
    try {
      const r = await postJson(http, CHAT_URL, apiKey, body, CHAT_TIMEOUT_MS, signal);
      last = interpret(r, parseChatResponse);
      if (last.ok || !(r.status === 429 || r.status >= 500)) return last;
    } catch (err) {
      const e = classifyError(err, CHAT_TIMEOUT_MS, signal);
      last = { ok: false, error: e.message };
      if (e.kind === 'timeout' || e.kind === 'abort') return last;
    }
  }
  return last;
}
