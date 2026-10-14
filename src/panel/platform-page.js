// @ts-check
/**
 * Platform do painel DENTRO do WhatsApp Web (overlay.js monta o app.js num Shadow DOM).
 * Roda no mundo isolado do content script: sem chrome.scripting e sem fetch com as permissões da
 * extensão, então STORE e FETCH vão pro background; o selector.js é chamado direto
 * (globalThis.__waTasksSelector, mesmo mundo isolado).
 */
import { BG } from '../lib/messages.js';
import { responseToError } from '../lib/http.js';

/** Intervalo do KEEPALIVE enquanto há FETCH ou STORE em andamento (o background do Firefox/Chrome dorme após ~30 s sem eventos). */
export const KEEPALIVE_MS = 20_000;
const NO_BG = 'sem resposta do background: recarregue a aba do WhatsApp (Cmd+R)';

/** @typedef {import('./platform.js').Platform} Platform */
/** @typedef {{handle: (name: string, payload?: any) => any, subscribe: (cb: (msg: any) => void) => (() => void)}} SelectorBridge */

/**
 * @typedef {Object} PageDeps
 * @property {{sendMessage: (msg: any) => any}} runtime
 * @property {{get: (k: any) => Promise<any>, set: (o: any) => Promise<any>, remove: (k: any) => Promise<any>}} storage
 * @property {() => SelectorBridge | undefined} getSelector
 */

/**
 * @param {PageDeps} [deps]  padrão: chrome.runtime, chrome.storage.local e globalThis.__waTasksSelector
 * @returns {Platform}
 */
export function createPagePlatform(deps) {
  const d = deps || {
    runtime: chrome.runtime,
    storage: chrome.storage.local,
    getSelector: () => /** @type {any} */ (globalThis).__waTasksSelector,
  };
  let seq = 0;
  let inflight = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let keepTimer = null;

  /** @param {any} msg */
  async function call(msg) {
    const resp = await d.runtime.sendMessage(msg);
    if (!resp || typeof resp !== 'object') throw new Error(NO_BG);
    if (!resp.ok) throw new Error(String(resp.error || NO_BG));
    return resp.result;
  }

  /** Avisa o background sem esperar nem falhar (KEEPALIVE, FETCH_ABORT). @param {any} msg */
  function fire(msg) {
    try {
      const p = d.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* contexto invalidado */ }
  }

  function startKeepAlive() {
    inflight++;
    if (keepTimer === null) keepTimer = setInterval(() => fire({ name: BG.KEEPALIVE }), KEEPALIVE_MS);
  }
  function stopKeepAlive() {
    inflight = Math.max(0, inflight - 1);
    if (inflight === 0 && keepTimer !== null) { clearInterval(keepTimer); keepTimer = null; }
  }

  /** @returns {SelectorBridge} */
  function selector() {
    const s = d.getSelector();
    if (!s) throw new Error('content script ausente: recarregue a aba do WhatsApp (Cmd+R)');
    return s;
  }

  return {
    kind: 'page',
    // executeScript no background pode levar até 60 s (storeMedia): mantém o background acordado enquanto espera.
    storeCall(fn, args = []) {
      startKeepAlive();
      return call({ name: BG.STORE, fn, args }).finally(stopKeepAlive);
    },
    httpJson(req) {
      const { signal } = req;
      if (signal && signal.aborted) return Promise.reject(signal.reason);
      const id = `f${Date.now().toString(36)}-${++seq}`;
      startKeepAlive();
      return new Promise((resolve, reject) => {
        let done = false;
        const onAbort = () => {
          if (done) return;
          done = true;
          stopKeepAlive();
          fire({ name: BG.FETCH_ABORT, id });
          reject(/** @type {AbortSignal} */ (signal).reason);
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        call({ name: BG.FETCH, url: req.url, method: req.method, headers: req.headers, body: req.body, timeoutMs: req.timeoutMs, id })
          .then((r) => {
            if (done) return;
            if (r && r.status === 0 && 'error' in r) throw responseToError(r);
            resolve({ status: r.status, json: r.json, text: r.text });
          })
          .catch((err) => { if (!done) reject(err); })
          .finally(() => {
            if (done) return;
            done = true;
            stopKeepAlive();
            if (signal) signal.removeEventListener('abort', onAbort);
          });
      });
    },
    storageGet: (keys) => d.storage.get(keys),
    storageSet: async (obj) => { await d.storage.set(obj); },
    storageRemove: async (keys) => { await d.storage.remove(keys); },
    findWhatsAppTab: () => Promise.resolve({ id: -1 }),
    contentSend: (name, payload) => Promise.resolve().then(() => selector().handle(name, payload)),
    onContentEvent(cb) {
      const s = d.getSelector();
      if (!s) return () => {};
      return s.subscribe((msg) => cb(msg, undefined));
    },
    hasRequiredOrigins: () => Promise.resolve(true),
    requestOrigins: () => Promise.resolve(true),
    openWindow: () => call({ name: BG.OPEN_WINDOW }),
    keepAlive: () => {},
    onTabActivity: () => {},
  };
}
