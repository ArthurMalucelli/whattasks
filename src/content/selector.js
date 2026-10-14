// @ts-check
// Content script isolado: UI de seleção (hover/clique/Esc), colheita ordenada de data-id enquanto o
// usuário rola, aviso de troca de chat. Nunca chama rede nem o Store (isso é do panel/main world).
// Dois consumidores: o painel numa página da extensão (sidebar/janela: chrome.tabs.sendMessage + porta)
// e o painel dentro do WhatsApp (overlay.js: globalThis.__waTasksSelector, mesmo mundo isolado).
(() => {
  const ROW_SEL = '#main [role="row"]';
  const STYLE_ID = 'wa-tasks-style';
  /** Nome da porta que o panel abre com chrome.tabs.connect (igual a PANEL_PORT em src/lib/messages.js). */
  const PANEL_PORT = 'wa-tasks-panel';
  /** Janela do debounce do MutationObserver (ms). */
  const FLUSH_MS = 100;
  const CSS = [
    `.wt-hover { outline: 2px solid #BBA7F0 !important; outline-offset: -2px; cursor: crosshair !important; }`,
    `.wt-anchor { position: relative; outline: 3px solid #BBA7F0 !important; outline-offset: 2px; border-radius: 12px; }`,
    `.wt-anchor::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: rgba(187, 167, 240, 0.20); pointer-events: none; }`,
    `.wt-range { background: rgba(187, 167, 240, 0.12) !important; }`,
    `body.wt-picking ${ROW_SEL} { cursor: crosshair !important; }`,
  ].join('\n');

  /** @typedef {{dataId: string, domIndex: number, pre: string, text: string, hasPtt: boolean, hasDoc: boolean, hasImg: boolean}} RawRow */

  /** Estado da colheita: ordem global reconstruída pelos vizinhos no DOM. */
  const state = {
    picking: false,
    harvesting: false,
    /** @type {string|null} */ startId: null,
    /** @type {string|null} */ endId: null,
    /** @type {string[]} */ order: [],
    /** @type {Map<string, RawRow>} */ rows: new Map(),
    /** @type {Map<string, number>|null} */ index: null, // id → posição em order (lazy; null = recalcular)
    /** @type {MutationObserver|null} */ observer: null,
    /** @type {Element|null} */ observedMain: null,
    /** @type {Set<Element>} */ dirtyRows: new Set(), // linhas conhecidas que mudaram por dentro
    /** @type {ReturnType<typeof setTimeout>|null} */ flushTimer: null,
    ports: 0,
    /** @type {Set<(msg: {name: string, payload?: any}) => void>} painel dentro da página */
    subscribers: new Set(),
    lastChatName: '',
  };

  /** @param {string} id @returns {number} posição em state.order, -1 se ausente */
  function posOf(id) {
    if (!state.index) {
      state.index = new Map();
      state.order.forEach((x, i) => /** @type {Map<string, number>} */ (state.index).set(x, i));
    }
    const i = state.index.get(id);
    return i === undefined ? -1 : i;
  }

  /** @param {Element} row @returns {string} */
  function idOf(row) {
    if (row.hasAttribute('data-id')) return row.getAttribute('data-id') || '';
    const el = row.querySelector('[data-id]');
    return el ? (el.getAttribute('data-id') || '') : '';
  }

  /** @returns {string} */
  function chatName() {
    const el = document.querySelector('#main header span[title]');
    return el ? (el.getAttribute('title') || el.textContent || '') : '';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.setAttribute('id', STYLE_ID);
    st.textContent = CSS;
    document.documentElement.appendChild(st);
  }

  /** Lê a função do dom-fallback.js (mesmo mundo isolado). */
  function rowFromEl() {
    return /** @type {((rowEl: Element, dataId: string, domIndex: number) => RawRow)|undefined} */ (/** @type {any} */ (globalThis).__waTasksRowFromEl);
  }

  /**
   * Insere a linha na ordem global usando o vizinho conhecido mais próximo no DOM.
   * Linha já conhecida com texto só é re-serializada se `force` (mudou por dentro): innerText força layout.
   * @param {Element} row
   * @param {boolean} [force]
   */
  function placeRow(row, force) {
    const dataId = idOf(row);
    if (!dataId) return;
    const known = state.rows.has(dataId);
    if (known && !force) {
      const ex = state.rows.get(dataId);
      if (ex && ex.text) return;
    }
    if (!known) {
      let prev = row.previousElementSibling;
      while (prev && !(idOf(prev) && state.rows.has(idOf(prev)))) prev = prev.previousElementSibling;
      let next = row.nextElementSibling;
      while (next && !(idOf(next) && state.rows.has(idOf(next)))) next = next.nextElementSibling;
      if (prev) state.order.splice(posOf(idOf(prev)) + 1, 0, dataId);
      else if (next) state.order.splice(posOf(idOf(next)), 0, dataId);
      else state.order.push(dataId);
      state.index = null;
    }
    const make = rowFromEl();
    const snap = make ? make(row, dataId, 0) : { dataId, domIndex: 0, pre: '', text: '', hasPtt: false, hasDoc: false, hasImg: false };
    const existing = state.rows.get(dataId);
    // Mantém o snapshot mais rico (texto pode aparecer depois do primeiro render).
    if (!existing || snap.text.length >= existing.text.length) state.rows.set(dataId, snap);
  }

  /** Coloca as linhas montadas em ordem do DOM (novas e as marcadas como sujas). */
  function harvestMounted() {
    const dirty = state.dirtyRows;
    state.dirtyRows = new Set();
    document.querySelectorAll(ROW_SEL).forEach((row) => placeRow(row, dirty.has(row)));
  }

  function flush() {
    state.flushTimer = null;
    if (!state.harvesting) return;
    harvestMounted();
    paintRange();
  }

  function scheduleFlush() {
    if (state.flushTimer === null) state.flushTimer = setTimeout(flush, FLUSH_MS);
  }

  /** @param {MutationRecord[]} records */
  function onMutations(records) {
    for (const rec of records) {
      const t = rec.target;
      const row = t instanceof Element ? t.closest(ROW_SEL) : null;
      if (row) state.dirtyRows.add(row);
    }
    scheduleFlush();
  }

  /** (Re)liga o observer no #main atual (o WhatsApp pode recriar o nó). */
  function attachObserver() {
    if (state.observer) state.observer.disconnect();
    const main = document.querySelector('#main') || document.body;
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(main, { childList: true, subtree: true });
    state.observedMain = main;
  }

  function startHarvest() {
    if (state.harvesting) return;
    state.harvesting = true;
    harvestMounted();
    attachObserver();
  }

  function stopHarvest() {
    state.harvesting = false;
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    state.observedMain = null;
    if (state.flushTimer !== null) { clearTimeout(state.flushTimer); state.flushTimer = null; }
    state.dirtyRows = new Set();
  }

  function clearPaint() {
    document.querySelectorAll('.wt-hover, .wt-anchor, .wt-range').forEach((el) => el.classList.remove('wt-hover', 'wt-anchor', 'wt-range'));
  }

  /**
   * O balão da mensagem dentro da linha (o que o usuário vê como "a mensagem"), pra pintar só ele.
   * @param {Element} row
   */
  function bubbleOf(row) {
    const inner = row.hasAttribute('data-id') ? row : row.querySelector('[data-id]');
    const scope = inner || row;
    return scope.querySelector('[data-testid="msg-container"]') || scope.querySelector('.copyable-text') && /** @type {Element} */ (scope.querySelector('.copyable-text')).parentElement || scope;
  }

  /** Topo da linha na tela (NaN sem geometria, ex.: testes). @param {Element} row */
  function topOf(row) {
    const r = typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null;
    return r && Number.isFinite(r.top) ? r.top : NaN;
  }

  /**
   * Horário absoluto (ms) do data-pre-plain-text "[HH:MM, dd/mm/aaaa] Nome: " (ou "[h:MM PM, mm/dd/aaaa]").
   * NaN se não houver. @param {string} pre
   */
  function timeOfPre(pre) {
    const m = /\[(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?,\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\]/.exec(pre || '');
    if (!m) return NaN;
    let h = Number(m[1]);
    const ap = m[3] ? m[3].toLowerCase() : '';
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    const n1 = Number(m[4]), n2 = Number(m[5]), y = Number(m[6]);
    const day = ap ? n2 : n1, month = ap ? n1 : n2;
    return new Date(y, month - 1, day, h, Number(m[2])).getTime();
  }

  /** @param {Element} row */
  function timeOfRow(row) {
    const el = row.querySelector('[data-pre-plain-text]');
    const pre = el ? (el.getAttribute('data-pre-plain-text') || '') : (state.rows.get(idOf(row)) || { pre: '' }).pre;
    return timeOfPre(pre);
  }

  /** @param {string} id */
  function timeOfId(id) {
    const r = state.rows.get(id);
    return r ? timeOfPre(r.pre) : NaN;
  }

  /**
   * Realça âncoras (balão) e as linhas entre elas. O DOM do WhatsApp não guarda as linhas em ordem
   * cronológica (lista virtualizada), então "entre" é decidido pela posição na tela quando as duas
   * âncoras estão montadas, senão pelo horário das mensagens, e só em último caso pela ordem de colheita.
   */
  function paintRange() {
    if (!state.startId) return;
    const rows = Array.from(document.querySelectorAll(ROW_SEL)).filter((row) => !!idOf(row));
    const byId = new Map(rows.map((row) => [idOf(row), row]));
    const sRow = byId.get(state.startId);
    const eRow = state.endId ? byId.get(state.endId) : sRow;
    /** @type {(row: Element) => boolean} */
    let between;
    const ts = sRow ? topOf(sRow) : NaN, te = eRow ? topOf(eRow) : NaN;
    if (!Number.isNaN(ts) && !Number.isNaN(te)) {
      const lo = Math.min(ts, te), hi = Math.max(ts, te);
      between = (row) => { const t = topOf(row); return t > lo && t < hi; };
    } else {
      const t0 = sRow && !Number.isNaN(timeOfRow(sRow)) ? timeOfRow(sRow) : timeOfId(state.startId);
      const t1 = !state.endId ? t0 : (eRow && !Number.isNaN(timeOfRow(eRow)) ? timeOfRow(eRow) : timeOfId(state.endId));
      if (!Number.isNaN(t0) && !Number.isNaN(t1)) {
        const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
        between = (row) => { const t = timeOfRow(row); return !Number.isNaN(t) && t > lo && t < hi; };
      } else {
        const a = posOf(state.startId), b = state.endId ? posOf(state.endId) : a;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        between = (row) => { const i = posOf(idOf(row)); return i >= 0 && i > lo && i < hi; };
      }
    }
    rows.forEach((row) => {
      const id = idOf(row);
      const isAnchor = id === state.startId || id === state.endId;
      row.classList.remove('wt-anchor');
      bubbleOf(row).classList.toggle('wt-anchor', isAnchor);
      row.classList.toggle('wt-range', !isAnchor && between(row));
    });
  }


  /**
   * Avisa o panel (sidebar/janela via runtime e o painel da página via assinatura). Nunca lança: com a
   * extensão recarregada o content script fica órfão e sendMessage lança síncrono
   * ("Extension context invalidated"); um assinante quebrado não impede os outros.
   * @param {{name: string, payload?: any}} msg
   */
  function notify(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* contexto invalidado */ }
    state.subscribers.forEach((cb) => {
      try { cb(msg); } catch { /* assinante quebrado */ }
    });
  }

  /** Sem nenhum painel ligado (porta nem assinante), a seleção e o observer morrem. */
  function releaseIfIdle() {
    if (state.ports === 0 && state.subscribers.size === 0) cancelPick();
  }

  /** data-icon do trilho do WhatsApp (o overlay.js publica a função; null se ainda não carregou). */
  function railInfo() {
    try {
      const f = /** @type {any} */ (globalThis).__waTasksRailInfo;
      const icons = typeof f === 'function' ? f() : null;
      return { ok: true, icons: Array.isArray(icons) ? icons : null };
    } catch {
      return { ok: true, icons: null };
    }
  }

  /** @param {Element} row */
  function previewOf(row) {
    const t = row instanceof HTMLElement ? row.innerText.replace(/\s+/g, ' ').trim() : '';
    return t.slice(0, 60);
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    if (!state.picking) return;
    const target = e.target instanceof Element ? e.target : null;
    const row = target ? target.closest(ROW_SEL) : null;
    if (!row) return;
    const dataId = idOf(row);
    if (!dataId) return;
    e.preventDefault();
    e.stopPropagation();
    placeRow(row);
    const which = state.startId ? 'end' : 'start';
    if (which === 'start') state.startId = dataId; else state.endId = dataId;
    paintRange();
    notify({ name: 'PICKED', payload: { which, id: dataId, preview: previewOf(row), harvested: state.rows.size } });
    if (which === 'end') {
      state.picking = false;
      document.body.classList.remove('wt-picking');
      document.querySelectorAll('.wt-hover').forEach((el) => el.classList.remove('wt-hover')); // senão a linha do 2º clique fica contornada
    }
  }

  /** @param {MouseEvent} e */
  function onHover(e) {
    if (!state.picking) return;
    document.querySelectorAll('.wt-hover').forEach((el) => el.classList.remove('wt-hover'));
    const target = e.target instanceof Element ? e.target : null;
    const row = target ? target.closest(ROW_SEL) : null;
    if (row && idOf(row)) row.classList.add('wt-hover');
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    // Só durante a escolha: com a seleção já concluída, o Esc é do WhatsApp (fechar visualizador de
    // mídia, emoji, resposta, busca); limpar uma seleção pronta é com o botão Cancelar do panel.
    if (e.key === 'Escape' && state.picking) {
      // Consome o Esc: senão o handler do WhatsApp também roda e fecha o chat/painel aberto.
      e.preventDefault();
      e.stopPropagation();
      cancelPick();
      notify({ name: 'PICK_CANCELLED', payload: { reason: 'esc' } });
    }
  }

  function startPick() {
    ensureStyle();
    cancelPick();
    state.picking = true;
    document.body.classList.add('wt-picking');
    startHarvest();
  }

  function cancelPick() {
    state.picking = false;
    state.startId = null;
    state.endId = null;
    state.order = [];
    state.index = null;
    state.rows = new Map();
    stopHarvest();
    clearPaint();
    document.body.classList.remove('wt-picking');
  }

  /** @returns {{ok: true, domIds: string[], rows: RawRow[]}} */
  function collectDom() {
    harvestMounted();
    const rows = state.order.map((id, i) => {
      const r = state.rows.get(id);
      return r ? { ...r, domIndex: i } : { dataId: id, domIndex: i, pre: '', text: '', hasPtt: false, hasDoc: false, hasImg: false };
    });
    return { ok: true, domIds: state.order.slice(), rows };
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('keydown', onKey, true);

  state.lastChatName = chatName();
  // Poll de 1 s: um querySelector + um isConnected. Troca de chat zera a seleção (senão domIds
  // misturaria os dois chats); #main recriado no mesmo chat só religa o observer.
  // Extensão recarregada: chrome.runtime.id some e o poll se desliga (junto com a colheita).
  // Qualquer outra exceção (DOM em transição) é engolida: o poll tenta de novo no próximo tick.
  const poll = setInterval(() => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        clearInterval(poll);
        cancelPick();
        return;
      }
      const name = chatName();
      if (name !== state.lastChatName) {
        state.lastChatName = name;
        const hadSelection = state.picking || !!state.startId;
        if (hadSelection || state.harvesting) cancelPick();
        // PICK_CANCELLED (reason 'chat') vem antes do CHAT_CHANGED: o panel zera uma seleção ainda em
        // andamento, mas mantém um trecho já coletado (job rodando ou Retomar).
        if (hadSelection) notify({ name: 'PICK_CANCELLED', payload: { reason: 'chat' } });
        notify({ name: 'CHAT_CHANGED', payload: { chatName: name } });
        return;
      }
      if (state.harvesting && state.observedMain && !state.observedMain.isConnected) {
        attachObserver();
        harvestMounted();
        paintRange();
      }
    } catch { /* tenta de novo no próximo tick */ }
  }, 1000);

  // O panel abre uma porta (chrome.tabs.connect, name PANEL_PORT) enquanto está aberto; quando a
  // última fecha (e o painel da página não está assinando), a seleção e o observer morrem junto
  // (senão rodariam pela vida da aba).
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== PANEL_PORT) return;
    state.ports++;
    port.onDisconnect.addListener(() => {
      state.ports = Math.max(0, state.ports - 1);
      releaseIfIdle();
    });
  });

  /**
   * Resposta pra um pedido do painel; undefined = nome desconhecido.
   * @param {string} name
   * @returns {any}
   */
  function handle(name) {
    switch (name) {
      case 'PING':
        return { ok: true, chatName: chatName(), picking: state.picking, startId: state.startId, endId: state.endId, harvested: state.rows.size };
      case 'PICK_START':
        startPick();
        return { ok: true };
      case 'PAINT_OFF': // o card fechou: tira o lilás da tela, mas a seleção continua valendo
        clearPaint();
        return { ok: true };
      case 'PAINT_ON': // o card reabriu: realça de novo o que está selecionado
        paintRange();
        return { ok: true };
      case 'PICK_CANCEL':
        cancelPick();
        return { ok: true };
      case 'COLLECT_DOM':
        return collectDom();
      case 'RAIL_INFO':
        return railInfo();
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.name !== 'string') return false;
    const res = handle(msg.name);
    if (res !== undefined) sendResponse(res);
    return false;
  });

  /** Ponte pro painel dentro da página (overlay.js → app.js com platform-page.js). */
  /** @type {any} */ (globalThis).__waTasksSelector = {
    /** @param {string} name @param {any} [_payload] */
    handle: (name, _payload) => handle(name),
    /** @param {(msg: {name: string, payload?: any}) => void} cb @returns {() => void} */
    subscribe(cb) {
      state.subscribers.add(cb);
      return () => {
        state.subscribers.delete(cb);
        releaseIfIdle();
      };
    },
  };
})();
