// @ts-check
/**
 * Funções AUTOCONTIDAS executadas no main world do WhatsApp Web via
 *   chrome.scripting.executeScript({ target: {tabId}, world: 'MAIN', func, args })
 * Cada função é serializada com toString(): NÃO pode referenciar nada deste módulo
 * (sem imports, sem helpers externos). Devolve só JSON. Só LÊ o Store interno
 * (require('WAWebCollections')); nunca envia, marca ou altera nada.
 *
 * Módulos internos usados (nomes podem mudar com builds do WhatsApp; o Diagnóstico aponta qual):
 *   require('WAWebCollections')            → { Msg, Chat, Contact }
 *   require('WAWebMediaInMemoryBlobCache') → { InMemoryMediaBlobCache }  (opcional: storeMedia tem fallback)
 */

/**
 * Estado do Store e chat ativo. `localStorage.waTasksNoStore === '1'` simula falha (tier DOM).
 * `missing` = módulos obrigatórios ausentes (derrubam `ready`); `warnings` = opcionais ausentes
 * (o cache de blobs: storeMedia tem fallback via forceToBlob), que não tiram do tier Store.
 * `loading: true` = o WhatsApp ainda não terminou de montar (módulo vazio ou lista de chats ausente):
 * o panel re-checa em vez de cair no modo texto.
 * @returns {{ready: boolean, loading: boolean, missing: string[], warnings: string[], chatId: string, chatName: string, waVersion: string}}
 */
export function storeStatus() {
  const g = /** @type {any} */ (globalThis);
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const warnings = [];
  let loading = false;
  let chatId = '';
  let chatName = '';
  let waVersion = '';
  try {
    if (g.localStorage && g.localStorage.getItem('waTasksNoStore') === '1') {
      return { ready: false, loading: false, missing: ['simulado: localStorage.waTasksNoStore=1'], warnings, chatId, chatName, waVersion };
    }
    if (typeof g.require !== 'function') {
      missing.push('require');
    } else {
      /** @type {any} */
      let coll = null;
      try { coll = g.require('WAWebCollections') || null; } catch (e) { coll = null; }
      if (!coll) { missing.push('WAWebCollections (ainda não carregou)'); loading = true; }
      if (coll) {
        for (const k of ['Msg', 'Chat', 'Contact']) if (!coll[k]) missing.push('WAWebCollections.' + k);
        try {
          const active = coll.Chat && typeof coll.Chat.getActive === 'function' ? coll.Chat.getActive() : null;
          if (active && active.id) {
            chatId = active.id._serialized || active.id.$1 || String(active.id);
            chatName = active.formattedTitle || active.name || '';
          }
        } catch (e) { /* chat ativo é opcional aqui */ }
      }
      try {
        const bc = g.require('WAWebMediaInMemoryBlobCache');
        if (!bc || !bc.InMemoryMediaBlobCache) warnings.push('WAWebMediaInMemoryBlobCache.InMemoryMediaBlobCache ausente: download usa fallback');
      } catch (e) { warnings.push('WAWebMediaInMemoryBlobCache ausente: download usa fallback'); }
      try {
        waVersion = (g.Debug && g.Debug.VERSION) || '';
        if (!waVersion) { const bc = g.require('WAWebBuildConstants'); waVersion = (bc && (bc.VERSION_BASE || bc.VERSION)) || ''; }
      } catch (e) { /* versão é informativa */ }
    }
  } catch (e) {
    missing.push('erro: ' + (e instanceof Error ? e.message : String(e)));
  }
  const doc = typeof document !== 'undefined' && document && typeof document.querySelector === 'function' ? document : null;
  if (!chatName && doc) {
    const el = doc.querySelector('#main header span[title]');
    chatName = el ? (el.getAttribute('title') || el.textContent || '') : '';
  }
  // Lista de chats ausente = SPA ainda montando (logo após F5): não é tier DOM, é esperar.
  if (doc && !doc.querySelector('#pane-side')) loading = true;
  return { ready: missing.length === 0 && !loading, loading, missing, warnings, chatId, chatName, waVersion: String(waVersion) };
}

/**
 * Corta Chat.get(chatId).msgs por índice entre as duas âncoras (inclusive) e devolve RawMsg[].
 * cap BLOQUEIA (total > cap → truncated:true, msgs:[]). missingFromStore = domIds que não existem no Store.
 * @param {string} startId
 * @param {string} endId
 * @param {string[]} domIds
 * @param {number} cap
 * @returns {{chatId: string, chatName: string, startFound: boolean, endFound: boolean, total: number, truncated: boolean, msgs: any[], missingFromStore: string[], error: string}}
 */
export function storeCollect(startId, endId, domIds, cap) {
  const g = /** @type {any} */ (globalThis);
  const out = { chatId: '', chatName: '', startFound: false, endFound: false, total: 0, truncated: false, msgs: /** @type {any[]} */ ([]), missingFromStore: /** @type {string[]} */ ([]), error: '' };
  try {
    const coll = g.require('WAWebCollections');
    if (!coll) { out.error = 'WAWebCollections indisponível (WhatsApp ainda carregando?)'; return out; }
    const Msg = coll.Msg, Chat = coll.Chat, Contact = coll.Contact;
    /** @param {any} id */
    const ser = (id) => (id && (id._serialized || id.$1)) || String(id);
    /** @param {string} id */
    const hexOf = (id) => { const p = String(id).split('_'); return p.length >= 3 ? p[2] : String(id); };
    /** @param {any} c */
    const models = (c) => (c && c.msgs ? (typeof c.msgs.getModelsArray === 'function' ? c.msgs.getModelsArray() : (c.msgs.models || [])) : []);
    /** @type {any} */
    let chat = null;
    try { chat = typeof Chat.getActive === 'function' ? Chat.getActive() : null; } catch (e) { chat = null; }
    /**
     * A partir do WA Web 2.3000.1050 o data-id da bolha é só o HEX da mensagem (sem 'false_<chat>_');
     * o Store continua indexado pela chave completa. Resolve por chave completa ou por HEX no chat.
     * @param {any} c @param {string} id
     */
    const findIn = (c, id) => {
      const all = models(c);
      const h = hexOf(id);
      return all.find((/** @type {any} */ m) => ser(m.id) === id) || all.find((/** @type {any} */ m) => m.id && m.id.id === h) || null;
    };
    /** @type {any} */
    let start = null;
    /** @type {any} */
    let end = null;
    try { start = Msg.get(startId) || null; end = Msg.get(endId) || null; } catch (e) { /* formato novo de id */ }
    if (!start && chat) start = findIn(chat, startId);
    if (!end && chat) end = findIn(chat, endId);
    out.startFound = !!start;
    out.endFound = !!end;
    if (!start || !end) return out;
    const remote = start.id && start.id.remote;
    // Se a âncora veio do Msg.get, o chat dela manda (pode não ser o ativo).
    /** @type {any} */
    let chatOfAnchor = null;
    try { chatOfAnchor = remote ? Chat.get(remote) : null; } catch (e) { chatOfAnchor = null; }
    if (!chatOfAnchor && remote) { try { chatOfAnchor = Chat.get(ser(remote)); } catch (e) { chatOfAnchor = null; } }
    if (chatOfAnchor && chatOfAnchor.msgs) chat = chatOfAnchor;
    if (!chat || !chat.msgs) { out.error = 'chat_not_found'; return out; }
    out.chatId = ser(chat.id || remote);
    out.chatName = chat.formattedTitle || chat.name || '';
    const all = models(chat);
    let i0 = all.indexOf(start);
    let i1 = all.indexOf(end);
    if (i0 < 0) i0 = all.findIndex((/** @type {any} */ m) => m.id && start.id && m.id.id === start.id.id);
    if (i1 < 0) i1 = all.findIndex((/** @type {any} */ m) => m.id && end.id && m.id.id === end.id.id);
    if (i0 < 0 || i1 < 0) { out.error = 'anchor_not_in_chat_msgs'; return out; }
    if (i0 > i1) { const tmp = i0; i0 = i1; i1 = tmp; }
    const slice = all.slice(i0, i1 + 1);
    out.total = slice.length;
    if (cap && slice.length > cap) { out.truncated = true; return out; }
    const allSer = new Set(all.map((/** @type {any} */ m) => ser(m.id)));
    const allHex = new Set(all.map((/** @type {any} */ m) => (m.id && m.id.id) || ''));
    out.missingFromStore = (domIds || []).filter((d) => !allSer.has(d) && !allHex.has(hexOf(d)));

    /*
     * Menções em grupo (WA Web 2.3000.1050+): o texto traz "@<número do @lid>" cru. Resolve pra "@nome"
     * na ordem: mentionedJidList → Contact.get(N@lid) → Contact.get(N@c.us) → participantes do grupo.
     * Sem nome: apelido estável "@participante-K" (mesma pessoa, mesmo apelido no trecho todo).
     * Nunca deixa o número cru no texto.
     */
    /** @param {any} c */
    const nameOf = (c) => {
      for (const k of ['name', 'pushname', 'notifyName', 'verifiedName', 'formattedName']) {
        const v = c && c[k];
        if (!v) continue;
        const s = String(v);
        // Nome que é só número/telefone (ex.: formattedName de contato desconhecido) vazaria o id: ignora.
        // Tira caracteres de formatação invisíveis (U+202A…) antes de olhar; sem letra e com 6+ dígitos = telefone.
        const bare = s.replace(/\p{Cf}/gu, '').trim();
        if (!bare) continue;
        const phoneLike = !/\p{L}/u.test(bare) && (bare.replace(/\D/g, '').length >= 6 || /^[\d\s+().-]+$/.test(bare));
        if (!phoneLike) return s;
      }
      return '';
    };
    /** @param {any} jid */
    const nameFromJid = (jid) => { try { return jid ? nameOf(Contact.get(jid)) : ''; } catch (e) { return ''; } };
    /** @param {any} w */
    const userOf = (w) => {
      try { return (typeof w === 'string' ? w : String((w && (w.user || w._serialized || w.$1)) || '')).split('@')[0]; } catch (e) { return ''; }
    };
    /** @param {any} x @returns {any[]} */
    const jidList = (x) => { try { return x && Array.isArray(x.mentionedJidList) ? x.mentionedJidList : []; } catch (e) { return []; } };
    /** @param {any} p @returns {any[]} */
    const asArray = (p) => (!p ? [] : typeof p.getModelsArray === 'function' ? p.getModelsArray() : Array.isArray(p.models) ? p.models : Array.isArray(p) ? p : []);
    /** Resolução que não depende da mensagem (fallbacks 2–4), memorizada por número. @type {Map<string, string>} */
    const byNumber = new Map();
    /** @param {string} n */
    const resolveNumber = (n) => {
      const cached = byNumber.get(n);
      if (cached !== undefined) return cached;
      let name = nameFromJid(n + '@lid') || nameFromJid(n + '@c.us');
      if (!name) {
        try {
          const meta = chat && chat.groupMetadata;
          const p = asArray(meta && meta.participants).find((/** @type {any} */ x) => x && userOf(x.id) === n);
          if (p) name = (p.contact && nameOf(p.contact)) || nameFromJid(p.id);
        } catch (e) { name = ''; }
      }
      byNumber.set(n, name);
      return name;
    };
    /** @type {Map<string, string>} */
    const aliases = new Map();
    /** @param {string} s @param {any[]} list */
    // Borda: não é menção se vier colado em letra/dígito/./:/@/- (e-mail, URL) nem se seguir letra/dígito.
    const MENTION_RE = /(?<![\w./:@-])@(\d{6,})(?!\w)/g;
    const mentions = (s, list) => (s.indexOf('@') < 0 ? s : s.replace(MENTION_RE, (_, /** @type {string} */ n) => {
      let name = '';
      for (const w of list) if (!name && userOf(w) === n) name = nameFromJid(w);
      if (name && !byNumber.get(n)) byNumber.set(n, name); // mesma pessoa, mesmo nome nas mensagens seguintes sem lista
      if (!name) name = resolveNumber(n);
      if (name) return '@' + name;
      let alias = aliases.get(n);
      if (!alias) { alias = 'participante-' + (aliases.size + 1); aliases.set(n, alias); }
      return '@' + alias;
    }));

    /** @param {any} m */
    const authorName = (m) => {
      if (m.id && m.id.fromMe) return 'Eu';
      const wid = m.author || m.from;
      /** @type {any} */
      let c = null;
      try { c = wid ? Contact.get(wid) : null; } catch (e) { c = null; }
      const name = c && (c.name || c.pushname || c.notifyName || c.verifiedName || c.formattedName);
      if (name) return String(name);
      if (m.notifyName) return String(m.notifyName);
      const user = wid && (wid.user || String(wid._serialized || wid).split('@')[0]);
      return user ? '+' + user : '?';
    };
    /** @param {any} m */
    const quotedText = (m) => {
      /** @type {any} */
      let q = null;
      try { q = m.quotedMsg || (typeof m.quotedMsgObj === 'function' ? m.quotedMsgObj() : null); } catch (e) { q = null; }
      if (!q) return '';
      const txt = q.type === 'chat' ? (q.body || '') : (q.caption || ('[' + (q.type || 'mídia') + ']'));
      // Resolve antes de cortar (o corte não pode deixar meio número). Lista da citada primeiro, depois a da resposta.
      const full = mentions(String(txt), jidList(q).concat(jidList(m)));
      if (full.length <= 120) return full;
      let cut = full.slice(0, 120);
      // Se o corte caiu no meio de um "@nome"/"@participante-N", tira o token inteiro (meio apelido troca a pessoa).
      const at = cut.lastIndexOf('@');
      if (at >= 0 && !/\s/.test(cut.slice(at + 1)) && /[\wÀ-ÿ-]/.test(full.charAt(120))) cut = cut.slice(0, at).trimEnd();
      return cut;
    };
    out.msgs = slice.map((/** @type {any} */ m) => {
      const id = ser(m.id);
      const type = String(m.type || '');
      return {
        id,
        hex: (m.id && m.id.id) || hexOf(id),
        t: Number(m.t) || 0,
        fromMe: !!(m.id && m.id.fromMe),
        type,
        body: type === 'chat' && typeof m.body === 'string' ? mentions(m.body, jidList(m)) : '',
        caption: typeof m.caption === 'string' ? mentions(m.caption, jidList(m)) : '',
        filename: m.filename ? String(m.filename) : '',
        mimetype: m.mimetype ? String(m.mimetype) : '',
        duration: m.duration != null ? m.duration : 0,
        size: Number(m.size) || 0,
        pageCount: Number(m.pageCount) || 0,
        isViewOnce: !!m.isViewOnce,
        quotedHex: m.quotedStanzaID ? String(m.quotedStanzaID) : '',
        quotedText: m.quotedStanzaID ? quotedText(m) : '',
        authorName: authorName(m),
      };
    });
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}

/**
 * Baixa (e descriptografa, via o próprio WhatsApp) a mídia de uma mensagem e devolve base64.
 * Parâmetros de download iguais aos do próprio WhatsApp. Nunca chama API de reprodução/marcação.
 * @param {string} id   id completo do Store (ou o data-id da bolha)
 * @param {string} [hex] HEX da mensagem, pra achar no chat ativo quando Msg.get(id) falha
 * @returns {Promise<{ok: true, mime: string, base64: string, bytes: number} | {ok: false, error: string, stage: string}>}
 */
export async function storeMedia(id, hex) {
  const g = /** @type {any} */ (globalThis);
  /** @type {any} */
  let m = null;
  // mediaStage ('ERROR'/'FETCHING'/...) diz ao panel se a mídia expirou ou ainda está baixando.
  const stageOf = () => String((m && m.mediaData && m.mediaData.mediaStage) || '');
  try {
    const coll = g.require('WAWebCollections');
    if (!coll) return { ok: false, error: 'WAWebCollections indisponível (WhatsApp ainda carregando?)', stage: '' };
    /** @param {any} x */
    const ser = (x) => (x && (x._serialized || x.$1)) || String(x);
    const h = hex || (() => { const p = String(id).split('_'); return p.length >= 3 ? p[2] : String(id); })();
    try { m = coll.Msg.get(id) || null; } catch (e) { m = null; }
    if (!m) {
      // WA Web 2.3000.1050+: data-id é só o HEX; procura no chat ativo.
      /** @type {any} */
      let chat = null;
      try { chat = typeof coll.Chat.getActive === 'function' ? coll.Chat.getActive() : null; } catch (e) { chat = null; }
      const all = chat && chat.msgs ? (typeof chat.msgs.getModelsArray === 'function' ? chat.msgs.getModelsArray() : (chat.msgs.models || [])) : [];
      m = all.find((/** @type {any} */ x) => ser(x.id) === id) || all.find((/** @type {any} */ x) => x.id && x.id.id === h) || null;
    }
    if (!m && typeof coll.Msg.getModelsArray === 'function') {
      m = coll.Msg.getModelsArray().find((/** @type {any} */ x) => x.id && x.id.id === h) || null;
    }
    if (!m) return { ok: false, error: 'mensagem não encontrada', stage: '' };
    if (!m.mediaData) return { ok: false, error: 'mensagem sem mídia', stage: '' };
    /** @param {Promise<any>} p @param {number} ms */
    const withTimeout = (p, ms) => {
      /** @type {any} */
      let timer = null;
      const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout ' + ms / 1000 + ' s')), ms); });
      return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
    };
    const getBlob = async () => {
      try {
        const bc = g.require('WAWebMediaInMemoryBlobCache').InMemoryMediaBlobCache;
        if (bc && m.filehash) { const b = bc.get(m.filehash); if (b) return b; }
      } catch (e) { /* cache opcional */ }
      try {
        const mo = m.mediaObject || (m.mediaData && m.mediaData.mediaObject);
        const mb = mo && mo.mediaBlob;
        if (mb && typeof mb.forceToBlob === 'function') { const b = await mb.forceToBlob(); if (b) return b; }
      } catch (e) { /* idem */ }
      try {
        const mb = m.mediaData && m.mediaData.mediaBlob;
        if (mb && typeof mb.forceToBlob === 'function') { const b = await mb.forceToBlob(); if (b) return b; }
      } catch (e) { /* idem */ }
      return null;
    };
    let blob = await getBlob();
    if (!blob) {
      await withTimeout(m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true }), 30000);
      blob = await getBlob();
    }
    if (!blob) return { ok: false, error: 'mídia não encontrada', stage: stageOf() };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let base64;
    if (typeof (/** @type {any} */ (bytes)).toBase64 === 'function') {
      base64 = (/** @type {any} */ (bytes)).toBase64();
    } else {
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CH)));
      base64 = btoa(s);
    }
    return { ok: true, mime: blob.type || m.mimetype || 'application/octet-stream', base64, bytes: bytes.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), stage: stageOf() };
  }
}

/**
 * Amostra pro Diagnóstico: últimas linhas visíveis × Store (pelo chat ativo), formato dos ids.
 * Não baixa mídia (o panel chama storeMedia se pedido).
 * @returns {{rows: Array<{id: string, found: boolean, type: string, author: string, storeId: string}>, msgsInStore: number, chatId: string, chatName: string, lastPttId: string, idFormat: string, idKeys: string, error: string}}
 */
export function storeDiag() {
  const g = /** @type {any} */ (globalThis);
  const out = {
    rows: /** @type {Array<{id: string, found: boolean, type: string, author: string, storeId: string}>} */ ([]),
    msgsInStore: 0, chatId: '', chatName: '', lastPttId: '', idFormat: '', idKeys: '', error: '',
  };
  try {
    const coll = g.require('WAWebCollections');
    if (!coll) { out.error = 'WAWebCollections indisponível (WhatsApp ainda carregando?)'; return out; }
    const Msg = coll.Msg, Chat = coll.Chat, Contact = coll.Contact;
    /** @param {any} x */
    const ser = (x) => (x && (x._serialized || x.$1)) || String(x);
    /** @param {string} id */
    const hexOf = (id) => { const p = String(id).split('_'); return p.length >= 3 ? p[2] : String(id); };
    /** @type {any} */
    let chat = null;
    try { chat = typeof Chat.getActive === 'function' ? Chat.getActive() : null; } catch (e) { chat = null; }
    const all = chat && chat.msgs ? (typeof chat.msgs.getModelsArray === 'function' ? chat.msgs.getModelsArray() : (chat.msgs.models || [])) : [];
    out.msgsInStore = all.length;
    if (chat) { out.chatId = ser(chat.id); out.chatName = chat.formattedTitle || chat.name || ''; }
    const els = Array.from(document.querySelectorAll('#main [role="row"] [data-id], #main [role="row"][data-id]'));
    const ids = els.map((el) => el.getAttribute('data-id') || '').filter(Boolean).slice(-10);
    if (ids.length) out.idFormat = ids[0].includes('_') ? 'completo' : 'hex';
    for (const id of ids) {
      /** @type {any} */
      let m = null;
      try { m = Msg.get(id) || null; } catch (e) { m = null; }
      if (!m) { const h = hexOf(id); m = all.find((/** @type {any} */ x) => ser(x.id) === id) || all.find((/** @type {any} */ x) => x.id && x.id.id === h) || null; }
      let author = '';
      if (m) {
        if (!out.idKeys && m.id && typeof m.id === 'object') out.idKeys = Object.keys(m.id).join(',');
        if (m.id && m.id.fromMe) author = 'Eu';
        else { try { const c = Contact.get(m.author || m.from); author = (c && (c.name || c.pushname)) || m.notifyName || '?'; } catch (e) { author = '?'; } }
        if (m.type === 'ptt') out.lastPttId = ser(m.id);
      }
      out.rows.push({ id, found: !!m, type: m ? String(m.type) : '', author: String(author), storeId: m ? ser(m.id) : '' });
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
