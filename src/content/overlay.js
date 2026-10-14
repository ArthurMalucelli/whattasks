// @ts-check
// Content script classic (mundo isolado): põe o ícone da extensão no trilho de ícones à esquerda do
// WhatsApp Web (Conversas, Status, Canais, Comunidades… a coruja entra logo depois do primeiro grupo) e,
// no clique, abre o painel como um card flutuante (Shadow DOM) ao lado do trilho. O card mede o conteúdo,
// arrasta pela linha de cima, redimensiona pelo canto de baixo à direita e lembra posição/tamanho
// (chrome.storage.local, chave overlayRect). O painel em si é o app.js (mesmo da sidebar), com o
// platform-page.js: Store e OpenRouter passam pelo background, a seleção fala com o selector.js direto.
// Trilho: primeiro pelos nomes de data-icon conhecidos, senão pela geometria (src/lib/rail.js); sem
// trilho reconhecível em 6 s, botão redondo flutuante no canto de baixo à esquerda.
(() => {
  const g = /** @type {any} */ (globalThis);
  if (g.__waTasksOverlay) return;
  g.__waTasksOverlay = true;

  const RAIL_TIMEOUT_MS = 6_000;
  const LOG = '[wa-tasks]';
  const DEBOUNCE_MS = 400;
  const FLOAT_RETRY_MS = 2_000;
  const Z = '2147483000';
  const ICON = 'src/icons/owl-48.png';
  const HOVER_BG = 'rgba(134, 150, 160, 0.16)';
  const ACTIVE_BG = 'rgba(134, 150, 160, 0.26)';
  const RECT_KEY = 'overlayRect';
  /** Folga embaixo do card até a borda da tela. */
  const BOTTOM_GAP = 12;
  const started = Date.now();
  /** `localStorage.waTasksDebug = '1'` no console do WhatsApp liga os logs de diagnóstico do trilho. */
  const DEBUG = (() => { try { return localStorage.getItem('waTasksDebug') === '1'; } catch { return false; } })();
  if (DEBUG) console.info(LOG, 'overlay ativo', { url: location.href });

  /** @param {string} p */
  const url = (p) => chrome.runtime.getURL(p);

  /** Contorno do card, alça de redimensionar e pílula (o resto vem do panel.css, no mesmo Shadow DOM). */
  const FRAME_CSS = [
    ':host { all: initial; }',
    '.frame { position: relative; display: flex; flex-direction: column; height: 100%; max-height: inherit; filter: drop-shadow(0 18px 40px rgba(0, 0, 0, .55)); }',
    '.mount { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }',
    '.mount > .card { flex: 1 1 auto; min-height: 0; }',
    '.loading { margin: 0; padding: 14px 18px; color: #9A9AA6; background: #15151b; border: 2px solid #26262e; border-radius: 16px; font: 500 13px/1.4 "Avenir Next", "Avenir", "Helvetica Neue", sans-serif; }',
    // alça de arrastar: a linha de cima (status), menos os botões
    '.card.popup .topbar { cursor: grab; touch-action: none; -webkit-user-select: none; user-select: none; }',
    '.card.popup .topbar :is(button, input, a) { cursor: pointer; }',
    '.frame.dragging .card.popup .topbar { cursor: grabbing; }',
    '.frame.dragging, .frame.resizing { -webkit-user-select: none; user-select: none; }',
    // alça de redimensionar: canto de baixo à direita
    '.grip { position: absolute; right: 5px; bottom: 5px; z-index: 5; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none; border-radius: 0 0 14px 0; opacity: .55; transition: opacity .15s;',
    '  background: linear-gradient(135deg, transparent 0 52%, #6b6b77 52% 60%, transparent 60% 70%, #6b6b77 70% 78%, transparent 78%); }',
    '.grip:hover, .frame.resizing .grip { opacity: 1; }',
    '.pill { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 46px; max-width: 100%; padding: 0 18px 0 10px; color: #F2F2F4; background: #15151b; border: 2px solid #33333d; border-radius: 999px; font: 600 13px/1.2 "Avenir Next", "Avenir", "Helvetica Neue", sans-serif; cursor: pointer; box-shadow: 0 14px 30px -12px rgba(0, 0, 0, .85); }',
    '.pill:hover { border-color: #44444f; }',
    '.pill:focus-visible { outline: 3px solid rgba(187, 167, 240, .65); outline-offset: 2px; }',
    '.pill img { width: 28px; height: 28px; flex: none; }',
    '.pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '[hidden] { display: none !important; }',
  ].join('\n');

  /** @type {any} módulo src/lib/rail.js (import dinâmico: content script classic não tem import estático) */
  let rail = null;
  /** @type {any} módulo src/lib/geom.js */
  let geom = null;
  /** @type {HTMLDivElement|null} item inserido no trilho (envolve o botão, com a mesma caixa do vizinho) */ let railItem = null;
  /** @type {HTMLButtonElement|null} */ let railBtn = null;
  /** @type {Element|null} vizinho de cima do botão no trilho */ let railAnchor = null;
  /** @type {HTMLButtonElement|null} */ let floatBtn = null;
  /** @type {ReturnType<typeof setTimeout>|null} */ let timer = null;
  /** @type {MutationObserver|null} */ let observer = null;

  /** @typedef {{left: number, top: number, width: number, height: number|null}} CardRect */
  /** Usado até o geom.js carregar (mesmos valores de DEFAULT_RECT). @type {CardRect} */
  const FALLBACK_RECT = { left: 72, top: 12, width: 360, height: null };

  const card = {
    /** @type {HTMLDivElement|null} */ host: null,
    /** @type {HTMLDivElement|null} */ frame: null,
    /** @type {HTMLDivElement|null} */ mountEl: null,
    /** @type {HTMLStyleElement|null} */ panelStyle: null,
    /** @type {HTMLButtonElement|null} */ pill: null,
    /** @type {HTMLSpanElement|null} */ pillText: null,
    /** @type {Promise<void>|null} */ mounting: null,
    /** @type {CardRect} posição/tamanho pedidos (o exibido é este limitado à tela atual) */ rect: { ...FALLBACK_RECT },
    visible: false,
    minimized: false,
  };

  // ---------- botão no trilho ----------

  /** @param {HTMLButtonElement} b @param {number} imgPx */
  function fillButton(b, imgPx) {
    b.type = 'button';
    b.title = 'WhatTasks';
    b.setAttribute('aria-label', 'WhatTasks');
    b.setAttribute('aria-pressed', 'false');
    const img = document.createElement('img');
    img.src = url(ICON);
    img.alt = '';
    img.width = imgPx;
    img.height = imgPx;
    Object.assign(img.style, { width: `${imgPx}px`, height: `${imgPx}px`, display: 'block', pointerEvents: 'none' });
    b.appendChild(img);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
  }

  function makeRailItem() {
    const item = document.createElement('div');
    item.setAttribute('data-wa-tasks', 'rail-item');
    Object.assign(item.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', boxSizing: 'border-box', padding: '0' });
    const b = document.createElement('button');
    b.setAttribute('data-wa-tasks', 'rail-btn');
    Object.assign(b.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', margin: '0', padding: '0',
      border: '0', borderRadius: '50%', background: 'transparent', cursor: 'pointer', boxSizing: 'border-box',
      transition: 'background-color .15s',
    });
    fillButton(b, 26);
    b.addEventListener('mouseenter', () => { b.style.background = card.visible ? ACTIVE_BG : HOVER_BG; });
    b.addEventListener('mouseleave', paintButtons);
    item.appendChild(b);
    railItem = item;
    railBtn = b;
  }

  /**
   * Mesma caixa do vizinho: o item do trilho com a largura/altura/margens da âncora, o botão com o
   * tamanho e o arredondamento do botão de dentro dela.
   * @param {Element} anchor
   */
  function sizeRailItem(anchor) {
    if (!railItem || !railBtn) return;
    const size = rail.buttonSizeFrom(anchor, window);
    const radius = rail.buttonRadiusFrom(anchor, window);
    const box = anchor.getBoundingClientRect();
    const cs = getComputedStyle(anchor);
    const w = box.width >= size.width && box.width <= 120 ? Math.round(box.width) : size.width;
    const h = box.height >= size.height && box.height <= 120 ? Math.round(box.height) : size.height;
    Object.assign(railItem.style, {
      width: `${w}px`, height: `${h}px`,
      marginTop: cs.marginTop, marginBottom: cs.marginBottom, marginLeft: cs.marginLeft, marginRight: cs.marginRight,
    });
    Object.assign(railBtn.style, { width: `${size.width}px`, height: `${size.height}px`, borderRadius: radius });
    const img = railBtn.querySelector('img');
    const px = size.width < 36 ? 22 : 26;
    if (img) Object.assign(img.style, { width: `${px}px`, height: `${px}px` });
  }

  function makeFloatButton() {
    const b = document.createElement('button');
    b.setAttribute('data-wa-tasks', 'float-btn');
    Object.assign(b.style, {
      position: 'fixed', left: '16px', bottom: '16px', zIndex: Z, width: '48px', height: '48px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', margin: '0',
      border: '2px solid #33333d', borderRadius: '50%', background: '#15151b', cursor: 'pointer',
      boxShadow: '0 12px 28px -10px rgba(0, 0, 0, .8)', boxSizing: 'border-box',
    });
    fillButton(b, 30);
    return b;
  }

  /** Fundo e aria-pressed dos botões refletem o card aberto. */
  function paintButtons() {
    if (railBtn) {
      railBtn.style.background = card.visible ? ACTIVE_BG : 'transparent';
      railBtn.setAttribute('aria-pressed', String(card.visible));
    }
    if (floatBtn) floatBtn.setAttribute('aria-pressed', String(card.visible));
  }

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (railItem) railItem.remove();
    if (floatBtn) floatBtn.remove();
    if (card.host) card.host.remove();
    railItem = null;
    railBtn = null;
    railAnchor = null;
    floatBtn = null;
  }

  /**
   * Medidas pro rail.js: coluna (caminho por nome), caixa na tela e viewport (caminho por geometria).
   * Gavetas de Status/Canais/Comunidades abertas ao lado ficam de fora.
   */
  const RAIL_OPTS = {
    measureLeft: (/** @type {Element} */ el) => el.getBoundingClientRect().left,
    win: window,
  };

  /** O botão está no lugar: no DOM, logo depois da âncora, que também segue no DOM. */
  function railHealthy() {
    return !!(railItem && railItem.isConnected && railAnchor && railAnchor.isConnected && railItem.previousElementSibling === railAnchor);
  }

  /** data-icon vistos no trilho, pro log e pro aviso do flutuante (o dado bruto vai à parte, em railRaw). */
  function seenIcons() {
    try {
      const icons = rail ? rail.railInfo(document, RAIL_OPTS) : null;
      return icons && icons.length ? icons.join(', ') : '(nenhum)';
    } catch (e) {
      return 'erro: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Dado bruto quando o trilho não é reconhecido: todo [data-icon] colado à esquerda, fora de #pane-side/#main,
   * com o [role] (e a tag) e o [aria-label] mais próximos e a caixa na tela (rail.railDump), uma linha por
   * ícone, pra próxima rodada de seletores sair do DOM real.
   */
  function railRaw() {
    try {
      return rail ? rail.formatRailDump(rail.railDump(document, RAIL_OPTS)) : 'rail.js não carregou';
    } catch (e) {
      return 'erro: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  /** (Re)detecta o trilho e (re)insere o botão; sem trilho depois de 6 s, usa o flutuante. */
  function ensureButton() {
    timer = null;
    try {
      if (!chrome.runtime || !chrome.runtime.id) { teardown(); return; } // extensão recarregada: content script órfão
      if (card.host && !card.host.isConnected && document.body) document.body.appendChild(card.host);
      const byName = rail ? rail.findRailAnchorByName(document, RAIL_OPTS) : null;
      const anchor = byName || (rail ? rail.findRailAnchorByGeometry(document, window, RAIL_OPTS) : null);
      if (anchor && anchor.parentNode) {
        if (!railItem) makeRailItem();
        const item = /** @type {HTMLDivElement} */ (railItem);
        sizeRailItem(anchor);
        if (!item.isConnected || item.previousElementSibling !== anchor) anchor.parentNode.insertBefore(item, anchor.nextSibling);
        if (anchor !== railAnchor) {
          if (DEBUG) console.info(LOG, `trilho: âncora ${rail.describeAnchor(anchor)} (via ${byName ? 'nomes' : 'geometria'}) · data-icon vistos: ${seenIcons()}`);
          railAnchor = anchor;
        }
        if (floatBtn) { floatBtn.remove(); floatBtn = null; }
        paintButtons();
        return;
      }
      if (railItem && railItem.isConnected) railItem.remove(); // âncora sumiu: o botão não fica solto no lugar errado
      railAnchor = null;
      const late = !rail || Date.now() - started >= RAIL_TIMEOUT_MS;
      if (late && !floatBtn) {
        console.warn(LOG, `trilho: não reconhecido; usando botão flutuante. data-icon vistos: ${rail ? seenIcons() : 'rail.js não carregou'}`);
        if (DEBUG && rail) console.warn(LOG, `trilho: [data-icon] com left < 140 (fora de #pane-side/#main):\n${railRaw()}`);
        floatBtn = makeFloatButton();
      }
      if (floatBtn && !floatBtn.isConnected && document.body) {
        document.body.appendChild(floatBtn);
        paintButtons();
      }
    } catch (e) { console.warn(LOG, 'ensureButton falhou (tenta de novo na próxima mutação):', e); }
  }

  /**
   * Com o botão no lugar, só mutações dentro do trilho redisparam a detecção (o resto do WhatsApp muda o
   * tempo todo e medir a coluna força layout); sem botão, qualquer mutação redispara.
   * @param {MutationRecord[]} [records]
   */
  function schedule(records) {
    if (timer !== null) return;
    if (railHealthy() && records) {
      const list = /** @type {HTMLElement} */ (railItem).parentElement;
      const root = list && list.parentElement ? list.parentElement : list;
      if (!root || !records.some((r) => root.contains(r.target))) return;
    }
    // No flutuante (trilho não achado), o WhatsApp muda o tempo todo: tenta de novo com menos pressa.
    timer = setTimeout(ensureButton, floatBtn ? FLOAT_RETRY_MS : DEBOUNCE_MS);
  }

  // ---------- card: posição e tamanho ----------

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  /** Retângulo exibido: o pedido limitado à tela atual. @returns {CardRect} */
  function shownRect() {
    if (!geom) return { ...card.rect };
    const vp = viewport();
    return geom.clampRect(card.rect, vp, geom.MIN_SIZE, geom.maxSizeFor(vp));
  }

  function loadRect() {
    try {
      return chrome.storage.local.get(RECT_KEY)
        .then((o) => {
          const v = o && o[RECT_KEY];
          if (v && typeof v === 'object') card.rect = { ...FALLBACK_RECT, ...v };
        })
        .catch(() => {});
    } catch { return Promise.resolve(); }
  }

  function saveRect() {
    try { chrome.storage.local.set({ [RECT_KEY]: card.rect }).catch(() => {}); } catch { /* contexto invalidado */ }
  }

  /** Posição/tamanho do host conforme o estado (aberto, minimizado, fechado). Só o card recebe cliques. */
  function layoutHost() {
    const host = card.host;
    if (!host) return;
    const r = shownRect();
    const vp = viewport();
    const base = {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, right: 'auto', bottom: 'auto', zIndex: Z,
      margin: '0', padding: '0', border: '0', background: 'transparent', boxSizing: 'border-box',
    };
    if (!card.visible) Object.assign(host.style, base, { display: 'none' });
    else if (card.minimized) Object.assign(host.style, base, { display: 'block', width: 'auto', height: 'auto', maxHeight: 'none', maxWidth: `${Math.max(160, Math.min(400, vp.width - r.left - 12))}px` });
    else {
      Object.assign(host.style, base, {
        display: 'block', width: `${r.width}px`, maxWidth: 'none',
        height: r.height === null ? 'auto' : `${r.height}px`,
        maxHeight: `${Math.max(200, vp.height - r.top - BOTTOM_GAP)}px`,
      });
    }
    if (card.frame) card.frame.hidden = card.minimized;
    if (card.pill) card.pill.hidden = !card.minimized;
    const cardEl = card.mountEl ? card.mountEl.querySelector('.card') : null;
    if (cardEl) cardEl.classList.toggle('sized', r.height !== null);
    paintButtons();
  }

  /** @type {{kind: 'drag'|'resize', id: number, el: Element, start: {left: number, top: number, width: number, height: number, x: number, y: number}} | null} */
  let gesture = null;

  /** @param {'drag'|'resize'} kind @param {PointerEvent} e @param {Element} el */
  function beginGesture(kind, e, el) {
    if (!card.host || !card.frame || !geom || e.button !== 0) return;
    e.preventDefault();
    const b = card.host.getBoundingClientRect();
    gesture = { kind, id: e.pointerId, el, start: { left: b.left, top: b.top, width: b.width, height: b.height, x: e.clientX, y: e.clientY } };
    try { el.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    card.frame.classList.add(kind === 'drag' ? 'dragging' : 'resizing');
  }

  /** @param {PointerEvent} e */
  function moveGesture(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const p = { x: e.clientX, y: e.clientY };
    const vp = viewport();
    if (gesture.kind === 'drag') {
      card.rect = { ...shownRect(), ...geom.dragMove(gesture.start, p, vp) };
    } else {
      const size = geom.resizeTo(gesture.start, p, vp, geom.MIN_SIZE, geom.maxSizeFor(vp));
      card.rect = { left: gesture.start.left, top: gesture.start.top, width: size.width, height: size.height };
    }
    layoutHost();
  }

  /** @param {PointerEvent} e */
  function endGesture(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    try { gesture.el.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    if (card.frame) card.frame.classList.remove('dragging', 'resizing');
    gesture = null;
    card.rect = shownRect();
    saveRect();
  }

  function resetRect() {
    card.rect = { ...(geom ? geom.DEFAULT_RECT : FALLBACK_RECT) };
    layoutHost();
    saveRect();
  }

  /** @param {Element} el */
  function listenGesture(el) {
    el.addEventListener('pointermove', (e) => moveGesture(/** @type {PointerEvent} */ (e)));
    el.addEventListener('pointerup', (e) => endGesture(/** @type {PointerEvent} */ (e)));
    el.addEventListener('pointercancel', (e) => endGesture(/** @type {PointerEvent} */ (e)));
  }

  const NOT_HANDLE = 'button, input, textarea, select, a, label, [contenteditable]';

  /** Linha de cima do card = alça de arrastar (menos botões/campos); duplo clique volta ao padrão. */
  function attachDragHandle() {
    const topbar = card.mountEl ? card.mountEl.querySelector('.topbar') : null;
    if (!topbar || topbar.hasAttribute('data-drag')) return;
    topbar.setAttribute('data-drag', '');
    topbar.querySelectorAll('img').forEach((img) => { img.draggable = false; }); // sem arrastar-imagem nativo
    /** @param {Event} e */
    const onHandle = (e) => {
      const t = /** @type {Element|null} */ (e.target instanceof Element ? e.target : null);
      return !t || !t.closest(NOT_HANDLE);
    };
    topbar.addEventListener('pointerdown', (e) => { if (onHandle(e)) beginGesture('drag', /** @type {PointerEvent} */ (e), topbar); });
    topbar.addEventListener('dblclick', (e) => { if (onHandle(e)) resetRect(); });
    listenGesture(topbar);
  }

  // ---------- card: montagem ----------

  function ensureHost() {
    if (card.host) {
      if (!card.host.isConnected) document.body.appendChild(card.host);
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('data-wa-tasks', 'overlay');
    const shadow = host.attachShadow({ mode: 'open' });
    // Teclas digitadas no painel não chegam aos atalhos do WhatsApp (ex.: digitar e cair no campo de mensagem).
    for (const type of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    const frameStyle = document.createElement('style');
    frameStyle.textContent = FRAME_CSS;
    const panelStyle = document.createElement('style');
    const frame = document.createElement('div');
    frame.className = 'frame';
    const mountEl = document.createElement('div');
    mountEl.className = 'mount';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'carregando…';
    mountEl.appendChild(loading);
    const grip = document.createElement('div');
    grip.className = 'grip';
    grip.title = 'Arraste pra redimensionar · duplo clique volta ao tamanho padrão';
    grip.addEventListener('pointerdown', (e) => beginGesture('resize', e, grip));
    grip.addEventListener('dblclick', resetRect);
    listenGesture(grip);
    frame.append(mountEl, grip);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.title = 'Expandir o WhatTasks';
    pill.hidden = true;
    const pillImg = document.createElement('img');
    pillImg.src = url(ICON);
    pillImg.alt = '';
    const pillText = document.createElement('span');
    pillText.textContent = 'WhatTasks';
    pill.append(pillImg, pillText);
    pill.addEventListener('click', () => { card.minimized = false; layoutHost(); });
    shadow.append(frameStyle, panelStyle, frame, pill);
    Object.assign(card, { host, frame, mountEl, panelStyle, pill, pillText });
    layoutHost();
    document.body.appendChild(host);
  }

  /** Carrega panel.css + app.js + platform-page.js e monta o painel (uma vez por aba). */
  function mount() {
    if (card.mounting) return card.mounting;
    const mountEl = /** @type {HTMLDivElement} */ (card.mountEl);
    card.mounting = (async () => {
      try {
        const [app, plat, css] = await Promise.all([
          import(url('src/panel/app.js')),
          import(url('src/panel/platform-page.js')),
          fetch(url('src/panel/panel.css')).then((r) => r.text()),
        ]);
        /** @type {HTMLStyleElement} */ (card.panelStyle).textContent = css;
        mountEl.replaceChildren();
        const ready = app.mountPanel(mountEl, plat.createPagePlatform(), {
          popup: true,
          onClose: hide,
          onMinimize: minimize,
          onStatus: (/** @type {string} */ text) => { if (card.pillText) card.pillText.textContent = text || 'WhatTasks'; },
        });
        // O markup entra antes do primeiro await do mountPanel: a alça e o .sized já podem ser ligados.
        attachDragHandle();
        layoutHost();
        await ready;
      } catch (err) {
        const box = document.createElement('div');
        box.className = 'loading';
        box.textContent = `não deu pra abrir o painel: ${err instanceof Error ? err.message : String(err)}. Recarregue a aba (Cmd+R).`;
        mountEl.replaceChildren(box);
        card.mounting = null;
      }
    })();
    return card.mounting;
  }

  const rectLoaded = loadRect();

  /** Realce das mensagens selecionadas: some quando o card fecha, volta quando reabre. */
  function paint(on) {
    try { const sel = g.__waTasksSelector; if (sel && typeof sel.handle === 'function') sel.handle(on ? 'PAINT_ON' : 'PAINT_OFF'); } catch (e) { /* content script órfão */ }
  }

  function show() {
    ensureHost();
    card.visible = true;
    card.minimized = false;
    layoutHost();
    paint(true);
    void rectLoaded.then(() => { if (card.visible) layoutHost(); });
    void mount();
  }

  function hide() {
    card.visible = false;
    card.minimized = false;
    layoutHost();
    paint(false);
  }

  function minimize() {
    card.minimized = true;
    layoutHost();
  }

  function toggle() {
    if (card.visible) hide();
    else show();
  }

  // ---------- início ----------

  // Clique no ícone da barra do navegador com o WhatsApp aberto (background → TOGGLE_PANEL).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.name !== 'TOGGLE_PANEL') return false;
    toggle();
    sendResponse({ ok: true, visible: card.visible });
    return false;
  });

  window.addEventListener('resize', () => { if (card.visible) layoutHost(); });

  import(url('src/lib/geom.js'))
    .then((m) => { geom = m; if (card.visible) layoutHost(); })
    .catch((e) => { console.error(LOG, 'não carregou src/lib/geom.js (card sem arrastar/redimensionar):', e); });

  import(url('src/lib/rail.js'))
    .then((m) => {
      rail = m;
      g.__waTasksRailInfo = () => m.railInfo(document, RAIL_OPTS);
      g.__waTasksRailDump = () => m.railDump(document, RAIL_OPTS);
      ensureButton();
    })
    .catch((e) => { console.error(LOG, 'não carregou src/lib/rail.js:', e); ensureButton(); }); // sem rail.js: flutuante na hora

  observer = new MutationObserver((records) => schedule(records));
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(ensureButton, RAIL_TIMEOUT_MS + 50);
})();
