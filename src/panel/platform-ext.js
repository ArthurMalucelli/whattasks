// @ts-check
/**
 * Platform do painel numa página da extensão (sidebar do Firefox/Zen, side panel do Chrome, janela
 * própria). Comportamento de sempre: executeScript no MAIN world da aba do WhatsApp, fetch direto,
 * tabs.sendMessage pro selector.js e uma porta aberta enquanto o painel vive.
 */
import { PANEL_PORT } from '../lib/messages.js';
import { pickWhatsAppTab, REQUIRED_ORIGINS } from '../lib/job.js';
import { fetchJson } from '../lib/http.js';
import { storeStatus, storeCollect, storeMedia, storeDiag } from './store-calls.js';

const WA_PREFIX = 'https://web.whatsapp.com/';
const PANEL_URL = 'src/panel/panel.html';

/** @typedef {import('./platform.js').Platform} Platform */

/** @type {Record<string, (...args: any[]) => any>} */
const STORE_FNS = { storeStatus, storeCollect, storeMedia, storeDiag };

/** @returns {Platform} */
export function createExtPlatform() {
  /** última aba do WhatsApp achada (padrão de storeCall/contentSend sem tabId) */
  /** @type {number|null} */
  let lastTabId = null;
  /** @type {{port: chrome.runtime.Port|null, tabId: number|null}} */
  const link = { port: null, tabId: null };

  /** @param {number|undefined} tabId */
  function tabOf(tabId) {
    const id = tabId ?? lastTabId;
    if (id === null || id === undefined) throw new Error('sem aba do WhatsApp');
    return id;
  }

  return {
    kind: 'ext',
    async storeCall(fnName, args = [], tabId) {
      const func = Object.prototype.hasOwnProperty.call(STORE_FNS, fnName) ? STORE_FNS[fnName] : null;
      if (!func) throw new Error(`função desconhecida: ${fnName}`);
      const results = await chrome.scripting.executeScript(/** @type {any} */ ({ target: { tabId: tabOf(tabId) }, world: 'MAIN', func, args }));
      return /** @type {any} */ (results)[0]?.result;
    },
    httpJson: (req) => fetchJson(fetch, req),
    storageGet: (keys) => chrome.storage.local.get(/** @type {any} */ (keys)),
    storageSet: (obj) => chrome.storage.local.set(obj),
    storageRemove: (keys) => chrome.storage.local.remove(keys),
    /** Aba do WhatsApp Web: ativa na janela atual, senão ativa em qualquer janela, senão a mais recente. */
    async findWhatsAppTab() {
      const tabs = await chrome.tabs.query({ url: WA_PREFIX + '*' }).catch(() => []);
      let currentWindowId;
      try { currentWindowId = (await chrome.windows.getCurrent()).id; } catch { currentWindowId = undefined; }
      const tab = pickWhatsAppTab(tabs, currentWindowId);
      lastTabId = tab && tab.id !== undefined ? tab.id : null;
      return tab;
    },
    contentSend: (name, payload, tabId) => Promise.resolve().then(() => chrome.tabs.sendMessage(tabOf(tabId), payload === undefined ? { name } : { name, payload })),
    onContentEvent(cb) {
      /** @param {any} msg @param {chrome.runtime.MessageSender} sender */
      const fn = (msg, sender) => {
        if (msg && typeof msg.name === 'string') cb(msg, sender.tab ? sender.tab.id : undefined);
        return false;
      };
      chrome.runtime.onMessage.addListener(fn);
      return () => chrome.runtime.onMessage.removeListener(fn);
    },
    /** Chrome concede host_permissions na instalação; no Firefox/Zen elas podem estar pendentes. */
    async hasRequiredOrigins() {
      const perms = /** @type {any} */ (chrome).permissions;
      if (!perms || !perms.contains) return true;
      try { return await perms.contains({ origins: [...REQUIRED_ORIGINS] }); } catch { return true; }
    },
    requestOrigins() {
      // permissions.request precisa ser chamado dentro do gesto, antes de qualquer await.
      const perms = /** @type {any} */ (chrome).permissions;
      if (!perms || !perms.request) return Promise.resolve(true);
      return perms.request({ origins: [...REQUIRED_ORIGINS] });
    },
    openWindow: () => chrome.windows.create({ url: chrome.runtime.getURL(PANEL_URL), type: 'popup', width: 460, height: 900 }).catch(() => {}),
    /** Mantém uma porta aberta com o content script da aba (reconecta ao trocar de aba). */
    keepAlive(tabId) {
      if (link.port && link.tabId === tabId) return;
      try { link.port?.disconnect(); } catch { /* já fechada */ }
      link.port = null;
      link.tabId = null;
      try {
        const port = chrome.tabs.connect(tabId, { name: PANEL_PORT });
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (link.port === port) { link.port = null; link.tabId = null; }
        });
        link.port = port;
        link.tabId = tabId;
      } catch { /* content script ausente: o PING já avisou */ }
    },
    onTabActivity(h) {
      chrome.tabs.onActivated.addListener(() => h.activated());
      chrome.tabs.onUpdated.addListener((tabId, info, tab) => h.updated(tabId, info.status, !!tab.active));
    },
  };
}
