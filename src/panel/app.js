// @ts-check
// Orquestrador do painel: seleção → coleta → mídia → transcrição → Claude → saída.
// Toda a lógica pura vive em ../lib/*; aqui só estado e DOM. O navegador (abas, Store, rede, storage)
// vem pelo `platform` (ver platform.js): sidebar/janela (platform-ext.js) ou dentro do WhatsApp
// (platform-page.js, montado pelo overlay.js num Shadow DOM). Nenhum chrome.* direto aqui.
import { MSG } from '../lib/messages.js';
import { buildFragment } from '../lib/html.js';
import { toItem } from '../lib/toitem.js';
import { domRowsToItems } from '../lib/domparse.js';
import { runPool } from '../lib/pool.js';
import { applyLimits, estimateCost } from '../lib/budget.js';
import { buildUserContent } from '../lib/payload.js';
import { SYSTEM_TASKS, SYSTEM_BRIEF, TASKS_SCHEMA } from '../lib/prompts.js';
import { parseTasksJson } from '../lib/validate.js';
import { tasksToMarkdown, mdFilename } from '../lib/render.js';
import { buildChatRequest } from '../lib/requests.js';
import {
  DEFAULT_SETTINGS, mergeSettings, limitsFromSettings, pricesFromSettings, sttModels,
  summarizeItems, summaryLine, formatUsd, needsCostConfirm, phaseLabel, plainLabels,
  remainingMedia, remainingTranscripts, audioFormat, isGroupChat, isGroupFromIds, needsTranscript,
  storeCollectProblem, anchorsProblem, missingFromStoreWarning, droppedNotes, tooManyMessages, domIdsBetween,
  transcriptCacheKey, isTranscriptCacheKey, cachedTranscriptKeys, applyCachedTranscripts, failedTranscriptNotes,
  diagReport, storeStatusLine, domTierLine, knownTimeRange,
  sttShouldRetry, STT_RETRY_DELAY_MS, isSchemaRejection, audioReceiptLine, pickCancelledAction, activeChatProblem,
  abortPromise, withTimeout, MEDIA_TIMEOUT_MS, MEDIA_TIMEOUT_ERROR, pickCancelledWarning, needsRecollect,
  selectionTabChanged, pickHint, AUDIO_RECEIPT_WARNING,
} from '../lib/job.js';
import { transcribe, complete, sleep } from './openrouter.js';

/** @typedef {import('../lib/messages.js').Item} Item */
/** @typedef {import('../lib/messages.js').MediaResult} MediaResult */
/** @typedef {import('../lib/messages.js').TranscriptResult} TranscriptResult */
/** @typedef {import('../lib/job.js').Settings} Settings */
/** @typedef {'tasks'|'brief'} Mode */
/** @typedef {'media'|'stt'|'chat'} Phase */
/** @typedef {'chat'|'cancel'|'tab'} AbortWhy */
/** @typedef {import('../lib/job.js').StoreStatus} StoreStatus */
/** @typedef {{text: string, raw: string, mode: Mode|null, cost: string, labels: string, hadAudio: boolean}} Output */
/** @typedef {import('./platform.js').Platform} Platform */
/** @typedef {'storeStatus'|'storeCollect'|'storeMedia'|'storeDiag'} StoreFn */

/**
 * @typedef {Object} MountOptions
 * @property {boolean} [demo]       QA visual: preenche tudo com exemplo e nunca chama o platform
 * @property {boolean} [open]       demo: abre Configurações e Diagnóstico
 * @property {boolean} [done]       demo: só o estado final (sem job em andamento nem erro), pra screenshot
 * @property {boolean} [popup]      dentro do WhatsApp: mostra minimizar/fechar, o miolo do card rola sozinho e não há
 *   link "abrir em janela" (o card arrasta/redimensiona pelo overlay.js)
 * @property {() => void} [onClose]
 * @property {() => void} [onMinimize]
 * @property {(text: string) => void} [onStatus]   texto curto pro "pill" minimizado (fase do job ou status)
 */

const OWL_URL = new URL('owl.png', import.meta.url).href;
const ICON_URL = new URL('../icons/owl-32.png', import.meta.url).href;

/**
 * Markup estático do card (o mesmo na sidebar, na janela, no demo e dentro do WhatsApp).
 * Montado por buildFragment (createElement, sem innerHTML). Os ids são o contrato com o código abaixo.
 */
export const PANEL_HTML = `
<main class="card" id="card">

  <header class="topbar">
    <img class="topbar-owl" src="${ICON_URL}" alt="" width="20" height="20">
    <div id="status" class="status" role="status" aria-live="polite">verificando…</div>
    <div class="win-ctrls">
      <button id="minimizeBtn" type="button" class="icon-btn" title="Minimizar" aria-label="Minimizar" hidden></button>
      <button id="closeBtn" type="button" class="icon-btn" title="Fechar" aria-label="Fechar" hidden></button>
    </div>
  </header>

  <div class="card-body">
  <button id="grantBtn" type="button" class="btn btn-primary btn-xl" hidden>Conceder acesso</button>

  <details id="settings" class="drawer">
    <summary><span class="drawer-icon gear" aria-hidden="true"></span><span class="drawer-title">Configurações</span></summary>
    <div class="drawer-body">
      <h2 class="sheet-title">Configurações</h2>
      <div class="grid">
        <label class="field span-2"><span>Chave OpenRouter</span><input id="set-apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-v1-…"></label>
        <label class="field span-2"><span>Modelo</span><input id="set-model" type="text" spellcheck="false"></label>
        <label class="field span-2"><span>STT principal</span><input id="set-sttPrimary" type="text" spellcheck="false"></label>
        <label class="field span-2"><span>STT reserva</span><input id="set-sttFallback" type="text" spellcheck="false"></label>
        <label class="field"><span>Máx. mensagens</span><input id="set-maxMessages" type="number" min="1" max="1000" step="1"></label>
        <label class="field"><span>Áudio total (min)</span><input id="set-maxAudioMinutesTotal" type="number" min="0" step="1"></label>
        <label class="field"><span>Áudio por msg (min)</span><input id="set-maxAudioMinutesEach" type="number" min="0" step="1"></label>
        <label class="field"><span>US$ / min de STT</span><input id="set-sttPerMin" type="number" min="0" step="any"></label>
        <label class="field"><span>US$ / 1M tokens entrada</span><input id="set-inputPerM" type="number" min="0" step="any"></label>
        <label class="field"><span>US$ / 1M tokens saída</span><input id="set-outputPerM" type="number" min="0" step="any"></label>
        <label class="field"><span>Confirmar acima de (US$)</span><input id="set-costCap" type="number" min="0" step="any"></label>
        <label class="field"><span>Seu nome ("Eu")</span><input id="set-userName" type="text" placeholder="você"></label>
        <label class="toggle span-2"><span>avisar que o remetente pode ver os áudios como ouvidos</span><input id="set-audioReceiptWarning" type="checkbox"></label>
      </div>
      <div class="row two">
        <button id="saveSettings" type="button" class="btn btn-primary btn-sm">Salvar</button>
        <button id="clearCache" type="button" class="btn btn-ghost btn-sm">Limpar cache de transcrições</button>
      </div>
      <div id="settingsMsg" class="note"></div>
    </div>
  </details>

  <section class="block reveal d2" aria-labelledby="h-pick">
    <h2 class="block-head" id="h-pick"><span class="step">01</span>Trecho</h2>
    <div class="row two">
      <button id="pickBtn" type="button" class="btn btn-secondary ico">Selecionar</button>
      <button id="pickCancelBtn" type="button" class="btn btn-ghost">Cancelar seleção</button>
    </div>
    <div id="pickHint" class="hint"></div>
    <div class="range">
      <div id="previewStart" class="preview start" hidden></div>
      <div id="previewEnd" class="preview end" hidden></div>
    </div>
    <div id="summary" class="summary"></div>
    <ul id="warnings" class="warnings"></ul>
  </section>

  <section class="block reveal d3" aria-labelledby="h-run">
    <h2 class="block-head" id="h-run"><span class="step">02</span>Gerar</h2>
    <div class="stack">
      <button id="tasksBtn" type="button" class="btn btn-primary btn-xl ico">Minhas tasks</button>
      <button id="briefBtn" type="button" class="btn btn-primary btn-xl ico">Brief pra IA</button>
    </div>
    <div id="banner" class="banner" hidden></div>
    <div id="meter" class="meter" hidden aria-hidden="true"><span class="meter-fill"></span></div>
    <div id="progress" class="progress" aria-live="polite"></div>
    <div class="row two">
      <button id="resumeBtn" type="button" class="btn btn-secondary ico" hidden>Retomar</button>
      <button id="cancelJobBtn" type="button" class="btn btn-danger ico" hidden>Cancelar job</button>
    </div>
    <ul id="errors" class="errors"></ul>
  </section>

  <section id="result" class="block reveal" aria-labelledby="h-result" hidden>
    <h2 class="block-head" id="h-result"><span class="step">03</span>Resultado</h2>
    <div id="cost" class="cost"></div>
    <pre id="output" class="output" tabindex="0"></pre>
    <div class="row two">
      <button id="copyBtn" type="button" class="btn btn-secondary ico">Copiar</button>
      <button id="downloadBtn" type="button" class="btn btn-secondary ico">Baixar .md</button>
    </div>
    <div class="row links">
      <button id="copyRawBtn" type="button" class="btn-link" hidden>copiar bruto</button>
      <button id="transcriptsBtn" type="button" class="btn-link" hidden>ver transcrições</button>
    </div>
    <pre id="transcriptsOut" class="output small" tabindex="0" hidden></pre>
  </section>

  <details id="diag" class="drawer">
    <summary><span class="drawer-icon pulse" aria-hidden="true"></span><span class="drawer-title">Diagnóstico</span></summary>
    <div class="drawer-body">
      <h2 class="sheet-title">Diagnóstico</h2>
      <div class="row">
        <label class="toggle inline"><input id="diagMedia" type="checkbox"><span>testar download de mídia</span></label>
        <button id="diagBtn" type="button" class="btn btn-secondary btn-sm">Diagnóstico</button>
      </div>
      <pre id="diagOut" class="output small" tabindex="0"></pre>
    </div>
  </details>
  </div>

  <footer class="mascot" aria-label="Ferramentas">
    <button id="settingsIconBtn" type="button" class="dock-btn" title="Configurações" aria-label="Configurações" aria-controls="settings" aria-expanded="false"></button>
    <img class="owl" src="${OWL_URL}" alt="" aria-hidden="true">
    <button id="diagIconBtn" type="button" class="dock-btn" title="Diagnóstico" aria-label="Diagnóstico" aria-controls="diag" aria-expanded="false"></button>
    <button id="windowBtn" type="button" class="btn-link window-link" title="Abrir o painel numa janela própria (útil no Zen)" hidden>abrir em janela</button>
  </footer>

</main>
`;

const CONFIRM_MS = 10_000;
const TZ = 'America/Sao_Paulo';
const TAB_GONE = 'a aba recarregou; selecione de novo';
const RELOAD = 'recarregue a aba do WhatsApp (Cmd+R)';

// ---------- estado ----------

const state = {
  loadingRetries: 0,
  /** @type {Settings} */ settings: { ...DEFAULT_SETTINGS },
  /** @type {number|null} */ tabId: null,
  /** @type {'store'|'dom'|null} */ tier: null,
  /** chat do trecho coletado (vai pro payload) */
  chatName: '',
  chatId: '',
  /** chat aberto agora na aba */
  activeChat: '',
  /** @type {StoreStatus|null} último storeStatus (refaz a linha de status sem executeScript durante o job) */
  storeSt: null,
  selection: {
    /** @type {string|null} */ startId: null,
    /** @type {string|null} */ endId: null,
    previews: { start: '', end: '' },
    harvested: 0,
    picking: false,
    /** @type {number|null} aba onde a seleção começou (outra aba do WhatsApp não a conhece) */ tabId: null,
  },
  /** aviso fixo enquanto o trecho coletado vale mas o realce sumiu do WhatsApp */
  selectionNotice: '',
  /** cada coleta ganha um número; uma coleta superada por outra descarta o resultado */
  collectSeq: 0,
  /** @type {Item[]} */ items: [],
  /** @type {Item[]} */ plannedItems: [],
  /** @type {{typical: number, max: number} | null} */ cost: null,
  /** @type {string[]} */ collectWarnings: [],
  /** @type {string[]} */ warnings: [],
  /** @type {string[]} avisos do último job (ex.: '#3 não transcrito: …') */ jobWarnings: [],
  needsAudioConfirm: false,
  needsReceiptConfirm: false,
  /** bloqueio do plano (limite de mensagens): mostrado no topo dos erros, some quando o plano passa */
  blocked: '',
  /** @type {string[]} */ errors: [],
  /** @type {Map<string, MediaResult>} */ media: new Map(),
  /** @type {Map<string, TranscriptResult>} */ transcripts: new Map(),
  job: {
    /** @type {AbortController|null} */ controller: null,
    /** @type {Mode|null} */ mode: null,
    /** @type {Phase|null} */ phase: null,
    /** @type {AbortWhy|null} */ why: null,
    /** @type {number|null} */ tabId: null,
    /** chat do trecho do job (o Retomar exige que seja o chat aberto) */
    chatName: '',
    /** @type {Item[]} snapshot dos itens do job (o Retomar reusa este, nunca state.plannedItems) */ items: [],
    progress: '',
    resumable: false,
  },
  /** @type {Record<Mode, number>} */ confirmUntil: { tasks: 0, brief: 0 },
  /** @type {Output} */ output: { text: '', raw: '', mode: null, cost: '', labels: '', hadAudio: false },
};

// ---------- DOM ----------

/** @type {Platform} */
let platform;
/** @type {ParentNode} onde o card foi montado (document.body ou o Shadow DOM do overlay) */
let root;
/** @type {MountOptions} */
let opts = {};
let statusText = '';

/** @param {string} id */
const q = (id) => /** @type {HTMLElement|null} */ (root.querySelector('#' + id));
/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (q(id));
const btn = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ ($(id));

function bindElements() {
  return {
  card: $('card'),
  status: $('status'),
  settings: /** @type {HTMLDetailsElement} */ ($('settings')),
  settingsMsg: $('settingsMsg'),
  pickHint: $('pickHint'),
  previewStart: $('previewStart'),
  previewEnd: $('previewEnd'),
  summary: $('summary'),
  warnings: $('warnings'),
  errors: $('errors'),
  banner: $('banner'),
  progress: $('progress'),
  meter: $('meter'),
  result: $('result'),
  cost: $('cost'),
  output: $('output'),
  transcriptsOut: $('transcriptsOut'),
  diagOut: $('diagOut'),
  diagMedia: /** @type {HTMLInputElement} */ ($('diagMedia')),
  pickBtn: btn('pickBtn'),
  grantBtn: btn('grantBtn'),
  windowBtn: btn('windowBtn'),
  pickCancelBtn: btn('pickCancelBtn'),
  tasksBtn: btn('tasksBtn'),
  briefBtn: btn('briefBtn'),
  resumeBtn: btn('resumeBtn'),
  cancelJobBtn: btn('cancelJobBtn'),
  copyBtn: btn('copyBtn'),
  downloadBtn: btn('downloadBtn'),
  copyRawBtn: btn('copyRawBtn'),
  transcriptsBtn: btn('transcriptsBtn'),
  diagBtn: btn('diagBtn'),
  diag: /** @type {HTMLDetailsElement} */ ($('diag')),
  settingsIconBtn: btn('settingsIconBtn'),
  diagIconBtn: btn('diagIconBtn'),
  closeBtn: btn('closeBtn'),
  minimizeBtn: btn('minimizeBtn'),
  };
}
/** @type {ReturnType<typeof bindElements>} */
let el;

/** @type {Record<Mode, string>} */
const MODE_LABEL = { tasks: 'Minhas tasks', brief: 'Brief pra IA' };

/** @param {string} text @param {'ok'|'warn'|'err'|''} [kind] */
function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = 'status' + (kind ? ' ' + kind : '');
  statusText = text;
  notifyStatus();
}

/** Texto do "pill" minimizado: a fase do job quando roda, senão o status. */
function notifyStatus() {
  if (opts.onStatus) opts.onStatus(state.job.progress || statusText);
}

/** @param {HTMLElement} ul @param {string[]} lines */
function renderList(ul, lines) {
  ul.replaceChildren(...lines.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
}

const running = () => state.job.controller !== null;

function renderSelection() {
  const s = state.selection;
  el.pickHint.textContent = pickHint(s);
  el.previewStart.hidden = !s.startId;
  el.previewStart.textContent = s.startId ? `início: ${s.previews.start || '(sem texto)'}` : '';
  el.previewEnd.hidden = !s.endId;
  el.previewEnd.textContent = s.endId ? `fim: ${s.previews.end || '(sem texto)'}` : '';
  el.summary.textContent = state.cost ? summaryLine(summarizeItems(state.plannedItems), state.cost) : '';
  renderList(el.warnings, [state.selectionNotice, ...state.warnings, ...state.jobWarnings].filter(Boolean));
  renderList(el.errors, state.blocked ? [state.blocked, ...state.errors] : state.errors);
}

function renderJob() {
  const busy = running();
  const ready = state.plannedItems.length > 0;
  el.pickBtn.disabled = !state.tier || busy;
  el.pickCancelBtn.disabled = busy || !(state.selection.picking || state.selection.startId);
  for (const mode of /** @type {Mode[]} */ (['tasks', 'brief'])) {
    const b = mode === 'tasks' ? el.tasksBtn : el.briefBtn;
    b.disabled = !ready || busy;
    const confirming = Date.now() < state.confirmUntil[mode];
    b.textContent = confirming && state.cost ? `Confirmar ≈ ${formatUsd(state.cost.typical)}` : MODE_LABEL[mode];
    b.classList.toggle('confirm', confirming);
  }
  el.cancelJobBtn.hidden = !busy;
  el.resumeBtn.hidden = busy || !state.job.resumable;
  el.progress.textContent = state.job.progress;
  el.meter.hidden = !busy;
  el.banner.hidden = !busy;
  el.banner.textContent = ['mantenha este chat aberto e não feche o painel', audioReceiptLine(state.job.items, state.settings.audioReceiptWarning)]
    .filter(Boolean).join('\n');
  notifyStatus();
}

function renderOutput() {
  const o = state.output;
  el.result.hidden = !o.text && !o.labels && !o.cost;
  el.output.textContent = o.text;
  el.cost.textContent = o.cost;
  el.copyBtn.disabled = !o.text;
  el.downloadBtn.disabled = !o.text;
  el.copyRawBtn.hidden = !o.raw;
  el.transcriptsBtn.hidden = !o.labels || !o.hadAudio;
  if (el.transcriptsBtn.hidden) {
    el.transcriptsOut.hidden = true;
    el.transcriptsBtn.textContent = 'ver transcrições';
  }
  el.transcriptsOut.textContent = o.labels;
}

function render() {
  renderSelection();
  renderJob();
  renderOutput();
}

// ---------- platform helpers ----------

/**
 * Executa uma função de store-calls.js no main world da aba e devolve o resultado.
 * @param {number} tabId
 * @param {StoreFn} fn
 * @param {any[]} [args]
 * @returns {Promise<any>}
 */
function inMain(tabId, fn, args = []) {
  return platform.storeCall(fn, args, tabId);
}

/**
 * @param {number} tabId
 * @param {string} name
 * @returns {Promise<any>}
 */
function send(tabId, name) {
  return platform.contentSend(name, undefined, tabId);
}

// ---------- settings ----------

async function loadSettings() {
  const got = await platform.storageGet('settings');
  state.settings = mergeSettings(got.settings);
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const input = /** @type {HTMLInputElement|null} */ (q(`set-${key}`));
    const v = /** @type {any} */ (state.settings)[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v === true;
    else input.value = String(v);
  }
  if (!state.settings.apiKey) el.settings.open = true;
}

async function saveSettings() {
  /** @type {Record<string, string|boolean>} */
  const raw = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const input = /** @type {HTMLInputElement|null} */ (q(`set-${key}`));
    if (input) raw[key] = input.type === 'checkbox' ? input.checked : input.value;
  }
  state.settings = mergeSettings(raw);
  await platform.storageSet({ settings: state.settings });
  el.settingsMsg.textContent = 'salvo';
  await loadSettings();
  // Com job rodando o plano fica como está (o job usa o snapshot dos itens).
  if (state.items.length && !running()) plan();
  // Coleta barrada (ex.: limite de mensagens no Store) com as âncoras ainda marcadas: coleta de novo.
  const { startId, endId } = state.selection;
  const recollect = needsRecollect({ startId, endId, items: state.items.length, running: running() });
  render();
  if (recollect) collect().catch((err) => fail(`erro na coleta: ${errText(err)}`));
}

async function clearTranscriptCache() {
  const all = await platform.storageGet(null);
  const keys = Object.keys(all).filter(isTranscriptCacheKey);
  if (keys.length) await platform.storageRemove(keys);
  el.settingsMsg.textContent = `${keys.length} transcrições removidas do cache`;
}

// ---------- tab / tier ----------

function resetSelection() {
  state.selection = { startId: null, endId: null, previews: { start: '', end: '' }, harvested: 0, picking: false, tabId: null };
  state.selectionNotice = '';
  state.items = [];
  state.plannedItems = [];
  state.cost = null;
  state.collectWarnings = [];
  state.warnings = [];
  state.jobWarnings = [];
  state.needsAudioConfirm = false;
  state.needsReceiptConfirm = false;
  state.blocked = '';
  state.errors = [];
  state.job.resumable = false;
  state.job.items = [];
  state.job.progress = '';
}


/** @param {boolean} [initial] */
async function refresh(initial = false) {
  if (running()) return;
  if (!(await platform.hasRequiredOrigins())) {
    state.tabId = null;
    state.tier = null;
    setStatus('a extensão precisa de acesso ao WhatsApp Web e ao OpenRouter: clique em "Conceder acesso"', 'warn');
    el.grantBtn.hidden = false;
    render();
    return;
  }
  el.grantBtn.hidden = true;
  const tab = await platform.findWhatsAppTab();
  if (!tab || tab.id === undefined) {
    state.tabId = null;
    state.tier = null;
    setStatus('abra o WhatsApp Web numa aba', 'warn');
    render();
    return;
  }
  // Seleção feita em outra aba (mesmo passando por uma aba fora do WhatsApp): o trecho não vale aqui.
  if (selectionTabChanged(state.selection.tabId, tab.id)) resetSelection();
  state.tabId = tab.id;
  /** @type {any} */
  let ping;
  try {
    ping = await send(tab.id, MSG.PING);
  } catch {
    state.tier = null;
    setStatus(RELOAD, 'err');
    render();
    return;
  }
  platform.keepAlive(tab.id);
  if (initial && ping && (ping.picking || ping.startId)) await send(tab.id, MSG.PICK_CANCEL).catch(() => {});
  try {
    const st = await inMain(tab.id, 'storeStatus');
    state.storeSt = st;
    state.activeChat = st.chatName || ping?.chatName || '';
    state.tier = st.loading ? null : (st.ready ? 'store' : 'dom');
    const line = storeStatusLine(st, state.activeChat);
    setStatus(line.text, line.kind);
    // SPA do WhatsApp ainda montando: re-checa sozinho por até ~30 s em vez de cair no modo texto.
    if (st.loading && state.loadingRetries < 10) {
      state.loadingRetries += 1;
      setTimeout(() => { refresh().catch(() => {}); }, 3000);
    } else if (!st.loading) {
      state.loadingRetries = 0;
    }
  } catch (err) {
    state.tier = 'dom';
    state.storeSt = null;
    state.activeChat = ping?.chatName || '';
    setStatus(domTierLine(`executeScript (${errText(err)})`), 'warn');
  }
  render();
}

/** @param {unknown} err */
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}

// ---------- seleção ----------

async function startPick() {
  const tabId = state.tabId;
  if (tabId === null) return;
  resetSelection();
  try {
    await send(tabId, MSG.PICK_START);
  } catch {
    setStatus(RELOAD, 'err');
    render();
    return;
  }
  state.selection.picking = true;
  state.selection.tabId = tabId;
  render();
}

async function cancelPick() {
  if (state.tabId !== null) await send(state.tabId, MSG.PICK_CANCEL).catch(() => {});
  resetSelection();
  render();
}

/** @param {{which: 'start'|'end', id: string, preview: string, harvested: number}} p */
function onPicked(p) {
  const s = state.selection;
  s.harvested = p.harvested;
  if (p.which === 'start') {
    s.startId = p.id;
    s.previews.start = p.preview;
    render();
    return;
  }
  s.endId = p.id;
  s.previews.end = p.preview;
  s.picking = false;
  render();
  collect().catch((err) => fail(`erro na coleta: ${errText(err)}`));
}

/** @param {string} msg */
function fail(msg) {
  state.errors = [msg];
  render();
}

// ---------- coleta ----------

async function collect() {
  const tabId = state.tabId;
  const { startId, endId } = state.selection;
  if (tabId === null || !startId || !endId) return;
  const seq = ++state.collectSeq;
  state.items = [];
  state.plannedItems = [];
  state.cost = null;
  state.collectWarnings = [];
  state.warnings = [];
  state.jobWarnings = [];
  state.blocked = '';
  state.errors = [];
  state.selectionNotice = '';
  // Saída de um trecho anterior nunca fica visível (nem o 'ver transcrições').
  state.output = { text: '', raw: '', mode: null, cost: '', labels: '', hadAudio: false };
  /** A seleção mudou (ex.: PICK_CANCELLED) ou outra coleta começou enquanto esta esperava: descarta o resultado. */
  const stale = () => seq !== state.collectSeq || state.selection.startId !== startId || state.selection.endId !== endId;
  /** @type {any} */
  let dom;
  try {
    dom = await send(tabId, MSG.COLLECT_DOM);
  } catch {
    return fail(TAB_GONE);
  }
  if (stale()) return;
  state.chatName = state.activeChat;
  state.chatId = '';
  /** @type {Item[]} */
  let items;
  if (state.tier === 'store') {
    /** @type {any} */
    let res;
    try {
      // Só os ids entre as âncoras: linhas colhidas fora do trecho não viram aviso de "fora do Store".
      const domIds = domIdsBetween(dom.domIds || [], startId, endId);
      res = await inMain(tabId, 'storeCollect', [startId, endId, domIds, state.settings.maxMessages]);
    } catch {
      return fail(TAB_GONE);
    }
    if (stale()) return;
    const problem = storeCollectProblem(res, state.settings.maxMessages);
    if (problem) return fail(problem);
    if (res.chatName) state.chatName = res.chatName;
    state.chatId = res.chatId || '';
    items = /** @type {Item[]} */ (res.msgs.map(toItem).filter(Boolean));
    const warn = missingFromStoreWarning(res.missingFromStore.length);
    if (warn) state.collectWarnings.push(warn);
  } else {
    const res = domRowsToItems(dom.rows || [], startId, endId);
    const problem = anchorsProblem(res);
    if (problem) return fail(problem);
    items = res.items;
  }
  state.items = items;
  pruneCaches(items);
  plan();
  render();
}

/** Mantém em memória só mídia/transcrições do trecho atual. @param {Item[]} items */
function pruneCaches(items) {
  const ids = new Set(items.map((it) => it.id));
  for (const map of [state.media, state.transcripts]) {
    for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id);
  }
}

/** Aplica limites e estima custo (rodado na coleta e ao salvar configurações, nunca com job rodando). */
function plan() {
  const s = state.settings;
  state.confirmUntil = { tasks: 0, brief: 0 };
  state.jobWarnings = [];
  // Plano novo invalida o Retomar (o snapshot do job não é mais o trecho planejado) e o aviso dele.
  if (state.job.resumable) state.errors = [];
  state.job.resumable = false;
  state.job.items = [];
  // Limite de mensagens vale pros dois tiers (no Store, storeCollect já corta pelo mesmo limite).
  state.blocked = tooManyMessages(state.items.length, s.maxMessages) || '';
  if (state.blocked) {
    state.plannedItems = [];
    state.cost = null;
    state.needsAudioConfirm = false;
    state.needsReceiptConfirm = false;
    state.warnings = [...state.collectWarnings];
    return;
  }
  const limited = applyLimits(state.items, limitsFromSettings(s));
  state.plannedItems = limited.items;
  state.cost = estimateCost(limited.items, pricesFromSettings(s));
  state.needsAudioConfirm = limited.needsAudioConfirm;
  state.warnings = [...state.collectWarnings, ...droppedNotes(limited.dropped, limited.items)];
  if (limited.needsAudioConfirm) state.warnings.push('áudio total acima do limite: confirme');
  if (limited.unknownPages) state.warnings.push(`${limited.unknownPages} PDF(s) sem contagem de páginas: custo pode ser maior`);
  // Recibo de "ouvido" (decisão 5): aviso visível antes de rodar + confirmação em 2 cliques.
  const receipt = audioReceiptLine(limited.items, s.audioReceiptWarning);
  state.needsReceiptConfirm = receipt !== '';
  if (receipt) state.warnings.push(receipt);
}

// ---------- job ----------

/** @param {Mode} mode */
function onModeClick(mode) {
  if (!state.cost || running()) return;
  const mustConfirm = needsCostConfirm(state.cost, state.settings.costCap) || state.needsAudioConfirm || state.needsReceiptConfirm;
  if (mustConfirm && Date.now() >= state.confirmUntil[mode]) {
    state.confirmUntil = { tasks: 0, brief: 0 };
    state.confirmUntil[mode] = Date.now() + CONFIRM_MS;
    setTimeout(renderJob, CONFIRM_MS + 50);
    renderJob();
    return;
  }
  state.confirmUntil = { tasks: 0, brief: 0 };
  runJob(mode);
}

/** @param {Phase} phase @param {number} done @param {number} total */
function setPhase(phase, done, total) {
  state.job.phase = phase;
  state.job.progress = phaseLabel(phase, done, total);
  // Barra fina: fração da fase atual; sem total (ex.: gerando…) fica indeterminada.
  el.meter.classList.toggle('indeterminate', total === 0);
  el.meter.style.setProperty('--p', String(total ? done / total : 0));
  renderJob();
}

/**
 * @param {Mode} mode
 * @param {boolean} [isResume]  Retomar: reusa o snapshot e o chat do job, não state.plannedItems
 */
async function runJob(mode, isResume = false) {
  // Snapshot do trecho: o job inteiro (e o Retomar) usa estes itens, nunca state.plannedItems de novo.
  const items = isResume ? state.job.items : state.plannedItems;
  const chatName = isResume ? state.job.chatName : state.chatName;
  if (state.tabId === null || !items.length || running()) return;
  if (!state.settings.apiKey) {
    openSheet(el.settings);
    return fail('configure a chave da OpenRouter em Configurações');
  }
  const chatProblem = activeChatProblem(state.activeChat, chatName, isResume);
  if (chatProblem) return fail(chatProblem);
  const controller = new AbortController();
  Object.assign(state.job, {
    controller, mode, phase: null, why: null, tabId: state.tabId, chatName, items, resumable: false, progress: '',
  });
  state.errors = [];
  state.jobWarnings = [];
  state.output = { text: '', raw: '', mode: null, cost: '', labels: state.output.labels, hadAudio: state.output.hadAudio };
  render();
  const spent = { stt: 0 };
  try {
    if (await runPhases(items, controller.signal, spent)) await generate(mode, items, controller.signal, spent.stt);
    else state.output.cost = `custo real: ${formatUsd(spent.stt)} (só transcrição)`;
  } catch (err) {
    state.errors.push(`erro inesperado: ${errText(err)}`);
  } finally {
    finishJob();
  }
}

/**
 * Fases 1 (mídia) e 2 (transcrição). false se o job parou; o custo de STT vai somando em `spent`.
 * @param {Item[]} items
 * @param {AbortSignal} signal
 * @param {{stt: number}} spent
 * @returns {Promise<boolean>}
 */
async function runPhases(items, signal, spent) {
  const tabId = /** @type {number} */ (state.job.tabId);
  setPhase('media', 0, 0);

  // Cache de transcrições numa leitura só, ANTES do download: áudio já transcrito não é baixado.
  const keys = cachedTranscriptKeys(items.filter((it) => !state.transcripts.get(it.id)?.ok));
  if (keys.length) {
    try {
      applyCachedTranscripts(state.transcripts, await platform.storageGet(keys));
    } catch { /* sem cache: transcreve de novo */ }
  }
  if (signal.aborted) return stopped();

  // Fase 1: mídia
  const needMedia = remainingMedia(items, state.media, state.transcripts);
  setPhase('media', 0, needMedia.length);
  await runPool(needMedia, 2, async (it) => {
    /** @type {any} */
    let res;
    try {
      // executeScript pode travar sem nunca resolver: corre contra o cancelamento do job e um prazo.
      res = await withTimeout(Promise.race([inMain(tabId, 'storeMedia', [it.id, it.hex]), abortPromise(signal)]), MEDIA_TIMEOUT_MS, MEDIA_TIMEOUT_ERROR);
    } catch (err) {
      // 'cancelado', 'timeout 60 s' ou executeScript rejeitado (recarga de aba vem pelo tabs.onUpdated):
      // falha só este item (ok:false é baixado de novo numa próxima rodada).
      res = { ok: false, error: errText(err) };
    }
    if (res && res.ok) state.media.set(it.id, { ok: true, mime: res.mime, base64: res.base64, bytes: res.bytes });
    else {
      const stage = res && res.stage ? ` (stage ${res.stage})` : '';
      state.media.set(it.id, { ok: false, error: `${(res && res.error) || 'sem resposta'}${stage}` });
    }
  }, signal, (done, total) => setPhase('media', done, total));
  if (signal.aborted) return stopped();

  // Fase 2: transcrição
  const needStt = remainingTranscripts(items, state.media, state.transcripts);
  setPhase('stt', 0, needStt.length);
  await runPool(needStt, 3, async (it) => {
    const r = await transcribeItem(it, signal);
    spent.stt += r.cost;
    if (r.result) state.transcripts.set(it.id, r.result);
  }, signal, (done, total) => setPhase('stt', done, total));
  if (signal.aborted) return stopped();
  state.jobWarnings = failedTranscriptNotes(items, state.transcripts, state.media);
  return true;
}

/**
 * Primário → 1 retry do primário (só erro transitório, após 2 s) → reserva. result null quando abortado.
 * @param {Item} it
 * @param {AbortSignal} signal
 * @returns {Promise<{result: TranscriptResult|null, cost: number}>}
 */
async function transcribeItem(it, signal) {
  const media = state.media.get(it.id);
  if (!media || !media.ok) return { result: { ok: false, error: 'mídia indisponível' }, cost: 0 };
  const [primary, fallback] = sttModels(state.settings);
  /** @param {string} model */
  const call = (model) => transcribe({ apiKey: state.settings.apiKey, model, base64: media.base64, format: audioFormat(media.mime), signal, http: platform.httpJson });
  /** @type {string[]} */
  const errors = [];
  let model = primary;
  let r = await call(model);
  if (!r.ok && !signal.aborted && sttShouldRetry(r)) {
    await sleep(STT_RETRY_DELAY_MS, signal);
    if (!signal.aborted) {
      errors.push(`${model}: ${r.error}`);
      r = await call(model);
    }
  }
  if (!r.ok && !signal.aborted && fallback) {
    errors.push(`${model}: ${r.error}`);
    model = fallback;
    r = await call(model);
  }
  if (r.ok) {
    try {
      await platform.storageSet({ [transcriptCacheKey(it.id)]: { text: r.text, model, at: Date.now() } });
    } catch { /* cache é opcional: a transcrição (e o custo) valem igual */ }
    return { result: { ok: true, text: r.text }, cost: r.cost };
  }
  if (signal.aborted) return { result: null, cost: 0 };
  errors.push(`${model}: ${r.error}`);
  return { result: { ok: false, error: errors.join('; ') }, cost: 0 };
}

/**
 * Fase 3: monta o payload, chama o Claude e mostra a saída.
 * @param {Mode} mode
 * @param {Item[]} items  snapshot do runJob
 * @param {AbortSignal} signal
 * @param {number} sttCost
 */
async function generate(mode, items, signal, sttCost) {
  setPhase('chat', 0, 0);
  // Tier DOM não tem chatId: grupo sai dos ids das mensagens.
  const isGroup = state.chatId ? isGroupChat(state.chatId) : isGroupFromIds(items);
  const { parts } = buildUserContent(items, state.transcripts, state.media, {
    chatName: state.job.chatName, isGroup, now: new Date(), userName: state.settings.userName, tz: TZ,
  });
  state.output.labels = plainLabels(parts);
  state.output.hadAudio = items.some(needsTranscript);
  /** @param {boolean} jsonFallback */
  const ask = (jsonFallback) => complete({
    apiKey: state.settings.apiKey,
    body: buildChatRequest({
      model: state.settings.model, systemPrompt: mode === 'tasks' ? SYSTEM_TASKS : SYSTEM_BRIEF, parts, mode, schema: TASKS_SCHEMA, jsonFallback,
    }),
    signal,
    http: platform.httpJson,
  });
  let res = await ask(false);
  let chatCost = res.cost || 0;
  // Contingência: provedor recusou o structured output → 1 tentativa com o schema no prompt.
  if (!res.ok && mode === 'tasks' && !signal.aborted && isSchemaRejection(res.error)) {
    res = await ask(true);
    chatCost += res.cost || 0;
  }
  if (!res.ok) {
    state.errors.push(signal.aborted ? 'cancelado (parcial mantido)' : `erro do modelo: ${res.error}`);
    state.output.cost = `custo real: ${formatUsd(sttCost + chatCost)}${chatCost ? '' : ' (só transcrição)'}`;
    return;
  }
  state.output.cost = `custo real: ${formatUsd(sttCost + chatCost)}`;
  state.output.mode = mode;
  if (mode === 'brief') {
    state.output.text = res.text;
    return;
  }
  const parsed = parseTasksJson(res.text);
  if (!parsed.ok) {
    state.output.text = res.text;
    state.output.raw = res.text;
    state.errors.push('JSON de tasks inválido:', ...parsed.errors);
    return;
  }
  const generatedAt = new Date();
  const range = knownTimeRange(items) || { from: generatedAt, to: generatedAt };
  state.output.text = tasksToMarkdown(parsed.value, {
    chatName: state.job.chatName,
    count: items.length,
    from: range.from,
    to: range.to,
    generatedAt,
  });
}

/** @param {AbortWhy} why */
function stopJob(why) {
  const c = state.job.controller;
  if (!c || c.signal.aborted) return;
  state.job.why = why;
  c.abort(why);
}

/** Mensagem pós-aborto das fases 1/2. @returns {false} */
function stopped() {
  const why = state.job.why;
  if (why === 'chat') {
    state.job.resumable = true;
    state.errors.push(`volte pro chat ${state.job.chatName} e clique Retomar`);
  } else if (why === 'tab') {
    state.errors.push(TAB_GONE);
  } else {
    state.errors.push('cancelado (parcial mantido)');
  }
  return false;
}

function finishJob() {
  const why = state.job.why;
  state.job.controller = null;
  state.job.phase = null;
  state.job.progress = '';
  if (why === 'tab') {
    resetSelection();
    state.errors = [TAB_GONE];
  }
  render();
  // Sempre: aba/chat/tier podem ter mudado durante o job (refresh fica parado enquanto roda).
  refresh().catch((err) => setStatus(`erro ao atualizar: ${errText(err)}`, 'err'));
}

/** Retomar: mesmo modo, só o que falta; exige o chat do job aberto. */
async function resume() {
  const mode = state.job.mode;
  if (!mode || running() || !state.job.resumable) return;
  await refresh();
  if (!state.job.resumable) return; // refresh zerou a seleção (outra aba)
  await runJob(mode, true); // runJob confere se o chat aberto é o do job
}

// ---------- saída ----------

/** @param {string} text */
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    state.job.progress = 'copiado';
  } catch (err) {
    state.job.progress = `não deu pra copiar: ${errText(err)}`;
  }
  renderJob();
}

function download() {
  const o = state.output;
  if (!o.text) return;
  const blob = new Blob([o.text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = mdFilename({ chatName: state.chatName || 'chat', date: new Date(), mode: o.mode || 'tasks' });
  el.card.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- diagnóstico ----------

async function runDiag() {
  const tabId = state.tabId;
  if (tabId === null) {
    el.diagOut.textContent = 'abra o WhatsApp Web nesta janela';
    return;
  }
  el.diagOut.textContent = 'rodando…';
  try {
    const status = await inMain(tabId, 'storeStatus');
    const diag = await inMain(tabId, 'storeDiag');
    const ping = await send(tabId, MSG.PING).catch(() => null);
    const railRes = await send(tabId, MSG.RAIL_INFO).catch(() => null);
    const rail = railRes && Array.isArray(railRes.icons) ? railRes.icons : null;
    /** @type {any} */
    let media;
    let extra = '';
    if (el.diagMedia.checked) {
      if (diag.lastPttId) media = await inMain(tabId, 'storeMedia', [diag.lastPttId, '']);
      else extra = '\nmídia: nenhum áudio (PTT) entre as linhas visíveis';
    }
    el.diagOut.textContent = diagReport({ status, diag, ping, media, rail }) + extra;
  } catch (err) {
    el.diagOut.textContent = `falhou: ${errText(err)}\n${RELOAD}`;
  }
}

// ---------- eventos ----------

/**
 * Evento do content script (PICKED, PICK_CANCELLED, CHAT_CHANGED).
 * @param {{name: string, payload?: any}} msg
 * @param {number|undefined} tabId  aba que mandou (undefined = a própria página)
 */
function onContentMessage(msg, tabId) {
  if (!msg || typeof msg.name !== 'string') return;
  if (tabId !== undefined && tabId !== state.tabId && tabId !== state.job.tabId) return;
  if (msg.name === MSG.PICKED) onPicked(msg.payload);
  else if (msg.name === MSG.PICK_CANCELLED) onPickCancelled(msg.payload);
  else if (msg.name === MSG.CHAT_CHANGED) onChatChanged(msg.payload);
}

/**
 * Esc ou troca de chat no content script (que já zerou a seleção do lado dele).
 * @param {{reason?: string} | undefined} p
 */
function onPickCancelled(p) {
  const collected = state.plannedItems.length > 0;
  const action = pickCancelledAction({ running: running(), resumable: state.job.resumable, collected });
  if (action === 'keep') {
    // Trecho já coletado (job rodando ou Retomar): fica; só a seleção do content script acabou.
    state.selection.picking = false;
    const notice = pickCancelledWarning({ collected, chatName: state.chatName });
    if (notice) state.selectionNotice = notice;
    render();
    return;
  }
  resetSelection();
  if (!p || p.reason !== 'esc') state.errors = ['chat trocado: selecione de novo'];
  render();
}

/** @param {{chatName?: string} | undefined} p */
function onChatChanged(p) {
  if (!running()) {
    refresh();
    return;
  }
  // Só a fase de mídia depende do chat aberto; STT e geração seguem (só a linha de status muda).
  if (state.job.phase === 'media') {
    stopJob('chat');
    return;
  }
  state.activeChat = (p && p.chatName) || '';
  if (state.storeSt) {
    const line = storeStatusLine(state.storeSt, state.activeChat);
    setStatus(line.text, line.kind);
  }
}

/** Abre uma gaveta (Configurações/Diagnóstico) e rola até ela. @param {HTMLDetailsElement} det */
function openSheet(det) {
  det.open = true;
  syncDock();
  try { det.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* sem layout (demo/teste) */ }
}

/** @param {HTMLDetailsElement} det */
function toggleSheet(det) {
  if (det.open) {
    det.open = false;
    syncDock();
  } else {
    openSheet(det);
  }
}

/** Ícones ao lado da coruja acompanham as gavetas (aria-expanded + destaque). */
function syncDock() {
  for (const [b, det] of /** @type {Array<[HTMLButtonElement, HTMLDetailsElement]>} */ ([[el.settingsIconBtn, el.settings], [el.diagIconBtn, el.diag]])) {
    b.setAttribute('aria-expanded', String(det.open));
    b.classList.toggle('on', det.open);
  }
}

/** Só interface (vale também no demo): ícones ao lado da coruja, minimizar/fechar, link "abrir em janela" (só fora do WhatsApp). */
function wireChrome() {
  el.settingsIconBtn.addEventListener('click', () => toggleSheet(el.settings));
  el.diagIconBtn.addEventListener('click', () => toggleSheet(el.diag));
  el.settings.addEventListener('toggle', syncDock);
  el.diag.addEventListener('toggle', syncDock);
  el.closeBtn.hidden = !opts.popup;
  el.minimizeBtn.hidden = !opts.popup;
  el.windowBtn.hidden = !!opts.popup;
  el.card.classList.toggle('popup', !!opts.popup);
  el.closeBtn.addEventListener('click', () => { if (opts.onClose) opts.onClose(); });
  el.minimizeBtn.addEventListener('click', () => { if (opts.onMinimize) opts.onMinimize(); });
}

function wire() {
  btn('saveSettings').addEventListener('click', () => { saveSettings().catch((e) => { el.settingsMsg.textContent = errText(e); }); });
  btn('clearCache').addEventListener('click', () => { clearTranscriptCache().catch((e) => { el.settingsMsg.textContent = errText(e); }); });
  el.grantBtn.addEventListener('click', () => {
    // permissions.request precisa ser chamado dentro do gesto, antes de qualquer await (requestOrigins faz isso).
    platform.requestOrigins().then(() => refresh(true)).catch((/** @type {unknown} */ err) => fail(err instanceof Error ? err.message : String(err)));
  });
  el.windowBtn.addEventListener('click', () => { platform.openWindow().catch(() => {}); });
  el.pickBtn.addEventListener('click', () => { startPick(); });
  el.pickCancelBtn.addEventListener('click', () => { cancelPick(); });
  el.tasksBtn.addEventListener('click', () => onModeClick('tasks'));
  el.briefBtn.addEventListener('click', () => onModeClick('brief'));
  el.resumeBtn.addEventListener('click', () => { resume().catch((e) => fail(`erro ao retomar: ${errText(e)}`)); });
  el.cancelJobBtn.addEventListener('click', () => stopJob('cancel'));
  el.copyBtn.addEventListener('click', () => { copy(state.output.text); });
  el.copyRawBtn.addEventListener('click', () => { copy(state.output.raw); });
  el.downloadBtn.addEventListener('click', download);
  el.transcriptsBtn.addEventListener('click', () => {
    el.transcriptsOut.hidden = !el.transcriptsOut.hidden;
    el.transcriptsBtn.textContent = el.transcriptsOut.hidden ? 'ver transcrições' : 'ocultar transcrições';
  });
  el.diagBtn.addEventListener('click', () => { runDiag(); });

  platform.onContentEvent((msg, tabId) => onContentMessage(msg, tabId));
  platform.onTabActivity({
    activated: () => { refresh(); },
    updated: (tabId, status, active) => {
      if (running()) {
        // Recarga da aba do job: o Store sumiu, o job para.
        if (tabId === state.job.tabId && status === 'loading') stopJob('tab');
        return;
      }
      if (status !== 'loading' && status !== 'complete') return;
      if (tabId === state.selection.tabId && (state.selection.startId || state.selection.picking)) {
        resetSelection();
        state.errors = [TAB_GONE];
        render();
      }
      if (status === 'complete' && active) refresh();
    },
  });
}

// ---------- demo (QA visual) ----------

/** Preenche todas as seções com dados de exemplo. Nunca chama chrome.*. ?open=1 abre as gavetas. */
function renderDemo() {
  const chat = 'Mudança do escritório';
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const input = /** @type {HTMLInputElement|null} */ (q(`set-${key}`));
    const v = /** @type {any} */ (DEFAULT_SETTINGS)[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = v === true;
    else input.value = key === 'apiKey' ? 'sk-or-v1-demo-0000000000000000' : String(v);
  }
  const line = storeStatusLine({ ready: true, missing: [], warnings: [], chatId: '', chatName: chat, waVersion: '' }, chat);
  setStatus(line.text, line.kind);
  el.settingsMsg.textContent = 'salvo';
  el.pickHint.textContent = pickHint({ picking: false, startId: 'a', endId: 'b', harvested: 41 });
  el.previewStart.hidden = false;
  el.previewStart.textContent = 'início: Pessoal, bora fechar a lista da mudança até sexta? Mandei a planta nova no grupo';
  el.previewEnd.hidden = false;
  el.previewEnd.textContent = 'fim: Fechado. Mando o orçamento do frete amanhã cedo';
  el.summary.textContent = '23 msgs · 2 áudios · 1 PDF · ≈ 1,2 min de áudio · ≈ US$ 0,04 (máx. 0,18)';
  renderList(el.warnings, [AUDIO_RECEIPT_WARNING]);
  el.pickCancelBtn.disabled = false;
  if (!opts.done) {
    el.briefBtn.classList.add('confirm');
    el.briefBtn.textContent = `Confirmar ≈ ${formatUsd(0.04)}`;
    el.banner.hidden = false;
    el.banner.textContent = ['mantenha este chat aberto e não feche o painel', AUDIO_RECEIPT_WARNING].join('\n');
    el.meter.hidden = false;
    el.meter.style.setProperty('--p', '0.6');
    el.progress.textContent = phaseLabel('stt', 3, 5);
    el.resumeBtn.hidden = false;
    el.cancelJobBtn.hidden = false;
    renderList(el.errors, ['#7 não transcrito: elevenlabs/scribe-v2: timeout 60 s']);
  }
  el.result.hidden = false;
  el.cost.textContent = `custo real: ${formatUsd(0.03)}`;
  el.output.textContent = [
    `# Tasks · ${chat}`,
    '_23 mensagens · 13/10/2026 09:12 → 14/10/2026 18:40 · gerado em 14/10/2026 18:42_',
    '',
    '- [ ] Mandar a planilha de inventário dos móveis pra Bia',
    '  - tipo: pedido a mim · quem pediu: Bia · prazo: 2026-10-16 (até quinta) · fonte: #3, #8 · confiança: alta',
    '',
    '- [ ] Fechar o orçamento do frete com a transportadora',
    '  - tipo: compromisso meu · assumido por mim · prazo: 2026-10-15 (amanhã cedo) · fonte: #21, #23 · anexos: orcamento-frete-transportadora-v2-final.pdf · confiança: alta',
    '',
    '- [ ] Confirmar com o prédio o horário do elevador de carga',
    '  - tipo: pedido ao grupo · quem pediu: Rafa · prazo: sem prazo · fonte: #12 · confiança: média',
    '  - ambiguidade: não ficou claro se a mudança é no sábado ou no domingo',
    '',
    '## Pendências',
    '- Rafa ainda não respondeu sobre as caixas extras',
    '',
    '## Perguntas em aberto',
    '- Quem fica com a chave do depósito durante a mudança?',
    '',
  ].join('\n');
  el.copyRawBtn.hidden = false;
  el.transcriptsBtn.hidden = false;
  el.transcriptsBtn.textContent = 'ocultar transcrições';
  el.transcriptsOut.hidden = false;
  el.transcriptsOut.textContent = '#5 [13/10 18:02] Bia (áudio 0:41): oi gente, então, eu preciso da planilha dos móveis até quinta pra mandar pro seguro\n#14 [14/10 09:30] Rafa (áudio 0:31): o síndico falou que o elevador de carga só libera com agendamento';
  el.diagOut.textContent = diagReport({
    status: { ready: true, missing: [], warnings: [], chatId: '1203630xxxx@g.us', chatName: chat, waVersion: '2.3000.1029' },
    diag: { rows: [{ id: 'false_1203630xxxx@g.us_3EB0A1', found: true, type: 'ptt', author: 'Bia' }], msgsInStore: 412, chatId: '1203630xxxx@g.us', lastPttId: 'false_1203630xxxx@g.us_3EB0A1', error: '' },
    ping: { chatName: chat, picking: false, startId: 'a', endId: 'b', harvested: 41 },
    media: { ok: true, mime: 'audio/ogg; codecs=opus', bytes: 38211 },
    rail: ['chats-filled', 'status-refreshed', 'newsletter-outline', 'community-refreshed-32', 'settings-refreshed'],
  });
  if (opts.open) {
    el.settings.open = true;
    el.diag.open = true;
  }
  syncDock();
}

/**
 * Monta o card em `target` (document.body na sidebar/janela/demo, um contêiner no Shadow DOM dentro do
 * WhatsApp) e liga o painel ao `platform`. Uma montagem por contexto (o estado é do módulo).
 * @param {ParentNode & Node} target
 * @param {Platform | null} plat  null só no demo
 * @param {MountOptions} [options]
 */
export async function mountPanel(target, plat, options = {}) {
  opts = options;
  root = target;
  const doc = target.ownerDocument || /** @type {Document} */ (/** @type {unknown} */ (target));
  target.insertBefore(buildFragment(doc, PANEL_HTML), target.firstChild);
  el = bindElements();
  wireChrome();
  // QA visual fora da extensão: retorna antes de qualquer chamada ao platform.
  if (options.demo || !plat) {
    renderDemo();
    return;
  }
  platform = plat;
  try {
    wire();
    await loadSettings();
    await refresh(true);
  } catch (err) {
    setStatus(`erro ao iniciar: ${errText(err)}`, 'err');
  }
}
