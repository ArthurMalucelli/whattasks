// @ts-check
// Entrada do panel.html (sidebar do Firefox/Zen, side panel do Chrome, janela própria e demo).
// O card e toda a orquestração vivem em app.js; aqui só se escolhe o platform.
import { mountPanel } from './app.js';
import { createExtPlatform } from './platform-ext.js';

/** ?demo=1, ou página aberta fora da extensão (file://, servidor local): sem chrome.tabs. */
function isDemo() {
  const g = /** @type {any} */ (globalThis);
  return new URLSearchParams(location.search).get('demo') === '1' || typeof g.chrome === 'undefined' || !g.chrome.tabs;
}

const demo = isDemo();
mountPanel(document.body, demo ? null : createExtPlatform(), {
  demo,
  open: new URLSearchParams(location.search).get('open') === '1',
  done: new URLSearchParams(location.search).get('done') === '1',
  popup: new URLSearchParams(location.search).get('done') === '1',
}).catch((err) => { console.error(err); });
