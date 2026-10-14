// @ts-check
/**
 * Roteamento das mensagens que o background atende (lógica pura, deps injetadas; ver src/background.js).
 * Usado quando o painel roda dentro do WhatsApp: STORE executa uma função de store-calls.js no MAIN
 * world da própria aba (por operação, nada fica injetado), FETCH faz a chamada ao OpenRouter.
 */
import { BG } from './messages.js';
import { fetchJson, errorToResponse } from './http.js';

const WA_PREFIX = 'https://web.whatsapp.com/';
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 600_000;

/**
 * @typedef {Object} RouterDeps
 * @property {Record<string, (...args: any[]) => any>} storeFns  funções de store-calls.js por nome
 * @property {(opts: {target: {tabId: number}, world: 'MAIN', func: (...args: any[]) => any, args: any[]}) => Promise<Array<{result?: any}>>} executeScript
 * @property {typeof fetch} fetch
 * @property {() => Promise<unknown>} openWindow
 * @property {Map<string, AbortController>} inflight  fetches em andamento por id (FETCH_ABORT)
 */

/**
 * Só https://openrouter.ai/ (porta padrão, sem usuário/senha).
 * @param {unknown} url
 */
export function isAllowedFetchUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === 'openrouter.ai' && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * @param {any} msg
 * @param {{tab?: {id?: number, url?: string}}} sender
 * @param {RouterDeps} deps
 * @returns {Promise<any> | undefined}  undefined = mensagem que não é do background (outro listener cuida)
 */
export function route(msg, sender, deps) {
  if (!msg || typeof msg.name !== 'string') return undefined;
  switch (msg.name) {
    case BG.STORE: return store(msg, sender, deps);
    case BG.FETCH: return doFetch(msg, deps);
    case BG.FETCH_ABORT: {
      const c = typeof msg.id === 'string' ? deps.inflight.get(msg.id) : undefined;
      if (c) c.abort('cancel');
      return Promise.resolve(!!c);
    }
    case BG.OPEN_WINDOW: return deps.openWindow().then(() => true);
    case BG.KEEPALIVE: return Promise.resolve(true);
    default: return undefined;
  }
}

/**
 * @param {any} msg
 * @param {{tab?: {id?: number, url?: string}}} sender
 * @param {RouterDeps} deps
 */
async function store(msg, sender, deps) {
  const fn = typeof msg.fn === 'string' && Object.prototype.hasOwnProperty.call(deps.storeFns, msg.fn) ? deps.storeFns[msg.fn] : null;
  if (!fn) throw new Error(`função desconhecida: ${String(msg.fn)}`);
  const tab = sender && sender.tab;
  if (!tab || typeof tab.id !== 'number') throw new Error('STORE sem aba de origem');
  if (typeof tab.url === 'string' && !tab.url.startsWith(WA_PREFIX)) throw new Error('STORE só roda na aba do WhatsApp Web');
  const args = Array.isArray(msg.args) ? msg.args : [];
  const results = await deps.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: fn, args });
  return results && results[0] ? results[0].result : undefined;
}

/**
 * @param {any} msg
 * @param {RouterDeps} deps
 */
async function doFetch(msg, deps) {
  if (!isAllowedFetchUrl(msg.url)) throw new Error(`URL não permitida: ${String(msg.url).slice(0, 200)}`);
  const ms = Number(msg.timeoutMs);
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  const id = typeof msg.id === 'string' ? msg.id : '';
  const ctrl = new AbortController();
  if (id) deps.inflight.set(id, ctrl);
  try {
    return await fetchJson(deps.fetch, {
      url: msg.url,
      method: typeof msg.method === 'string' ? msg.method : 'GET',
      headers: msg.headers && typeof msg.headers === 'object' ? msg.headers : undefined,
      body: typeof msg.body === 'string' ? msg.body : undefined,
      timeoutMs,
      signal: ctrl.signal,
    });
  } catch (err) {
    return errorToResponse(err);
  } finally {
    if (id && deps.inflight.get(id) === ctrl) deps.inflight.delete(id);
  }
}

/**
 * O que o clique no ícone da barra faz.
 * @param {{id?: number, url?: string} | undefined} tab  aba ativa (url só vem com permissão de host)
 * @param {{sidebar: boolean}} caps  sidebar = sidebarAction (Firefox) ou sidePanel.open (Chrome)
 * @returns {'overlay'|'sidebar'|'open-wa'}
 */
export function actionPlan(tab, caps) {
  if (tab && typeof tab.id === 'number' && typeof tab.url === 'string' && tab.url.startsWith(WA_PREFIX)) return 'overlay';
  return caps.sidebar ? 'sidebar' : 'open-wa';
}
