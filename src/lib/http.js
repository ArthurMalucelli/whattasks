// @ts-check
/**
 * fetch com timeout que devolve {status, json, text}. Usado pelo painel na sidebar/janela (fetch direto)
 * e pelo background quando o painel roda dentro do WhatsApp (o content script pede via mensagem).
 * Erro de rede/timeout/abort REJEITA com o erro original: openrouter.js classifica pelo tipo
 * (TypeError = rede, TimeoutError = prazo, AbortError = cancelado).
 */

/**
 * @typedef {Object} HttpRequest
 * @property {string} url
 * @property {string} [method]
 * @property {Record<string, string>} [headers]
 * @property {string} [body]
 * @property {number} timeoutMs
 * @property {AbortSignal} [signal]
 */
/** @typedef {{status: number, json: any, text: string}} HttpResponse */

/**
 * Signal que aborta no prazo OU quando `signal` aborta.
 * @param {AbortSignal | undefined} signal
 * @param {number} ms
 * @returns {AbortSignal}
 */
export function timeoutSignal(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const any = /** @type {any} */ (AbortSignal).any;
  if (typeof any === 'function') return any([signal, timeout]);
  const ctrl = new AbortController();
  const stop = () => ctrl.abort(signal.aborted ? signal.reason : timeout.reason);
  if (signal.aborted) stop();
  signal.addEventListener('abort', stop, { once: true });
  timeout.addEventListener('abort', stop, { once: true });
  return ctrl.signal;
}

/**
 * @param {typeof fetch} fetchFn
 * @param {HttpRequest} req
 * @returns {Promise<HttpResponse>}
 */
export async function fetchJson(fetchFn, req) {
  const res = await fetchFn(req.url, {
    method: req.method || 'GET',
    headers: req.headers,
    body: req.body,
    signal: timeoutSignal(req.signal, req.timeoutMs),
  });
  const text = await res.text();
  /** @type {any} */
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
  return { status: res.status, json, text };
}

/**
 * Erro do fetch (no background) → resposta serializável com status 0.
 * @param {unknown} err
 * @returns {{status: 0, json: null, text: string, error: string}}
 */
export function errorToResponse(err) {
  const e = /** @type {any} */ (err);
  const isErr = e && typeof e === 'object' && typeof e.message === 'string';
  return { status: 0, json: null, text: isErr ? e.message : String(err), error: isErr && e.name ? String(e.name) : 'Error' };
}

/**
 * Resposta status 0 vinda do background → erro com o mesmo tipo do original.
 * @param {{status: number, text: string, error?: string}} r
 * @returns {Error}
 */
export function responseToError(r) {
  if (r.error === 'TypeError') return new TypeError(r.text);
  const e = new Error(r.text);
  if (r.error) e.name = r.error;
  return e;
}
