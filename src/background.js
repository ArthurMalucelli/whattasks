// @ts-check
// Background (event page no Firefox/Zen, service worker no Chrome).
// - Clique no ícone da barra: com o WhatsApp Web na aba ativa, abre/fecha o card dentro da página
//   (overlay.js); fora dele, a sidebar (Firefox: sidebarAction.toggle, síncrono dentro do gesto;
//   Chrome: sidePanel.open); sem nenhum dos dois, abre o WhatsApp Web.
// - Mensagens do painel dentro da página (ver src/lib/bgRouter.js): STORE (executeScript no MAIN
//   world da própria aba, por operação), FETCH/FETCH_ABORT (OpenRouter), OPEN_WINDOW, KEEPALIVE.
import { route, actionPlan } from './lib/bgRouter.js';
import { BG } from './lib/messages.js';
import { storeStatus, storeCollect, storeMedia, storeDiag } from './panel/store-calls.js';

const api = /** @type {any} */ (globalThis).browser ?? /** @type {any} */ (chrome);
const WA_URL = 'https://web.whatsapp.com/';

function openPanelWindow() {
  return api.windows.create({ url: api.runtime.getURL('src/panel/panel.html'), type: 'popup', width: 460, height: 900 });
}

/** @type {import('./lib/bgRouter.js').RouterDeps} */
const deps = {
  storeFns: { storeStatus, storeCollect, storeMedia, storeDiag },
  executeScript: (opts) => api.scripting.executeScript(opts),
  fetch: (input, init) => fetch(input, init),
  openWindow: openPanelWindow,
  inflight: new Map(),
};

// Envelope {ok, result|error} + sendResponse/return true: funciona igual no Firefox e no Chrome.
api.runtime.onMessage.addListener((/** @type {any} */ msg, /** @type {any} */ sender, /** @type {(r: any) => void} */ sendResponse) => {
  const p = route(msg, sender, deps);
  if (!p) return false;
  p.then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});

const hasSidePanel = !!(api.sidePanel && typeof api.sidePanel.open === 'function');
const hasSidebar = !!(api.sidebarAction && typeof api.sidebarAction.toggle === 'function');

if (api.sidePanel && typeof api.sidePanel.setPanelBehavior === 'function') {
  // O clique no ícone decide (card na página ou side panel): o Chrome não abre o painel sozinho.
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error);
}

api.action.onClicked.addListener((/** @type {any} */ tab) => {
  const plan = actionPlan(tab, { sidebar: hasSidebar || hasSidePanel });
  if (plan === 'overlay') {
    // Content script ausente (aba aberta antes de instalar/recarregar a extensão): cai na janela.
    api.tabs.sendMessage(tab.id, { name: BG.TOGGLE_PANEL }).catch(() => openPanelWindow().catch(console.error));
  } else if (plan === 'sidebar') {
    // Chamadas síncronas, ainda dentro do gesto do usuário.
    if (hasSidebar) api.sidebarAction.toggle();
    else api.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
  } else {
    api.tabs.create({ url: WA_URL }).catch(console.error);
  }
});
