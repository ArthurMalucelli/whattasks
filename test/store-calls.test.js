// @ts-check
import { describe, it, expect, afterEach, vi } from 'vitest';
import { storeStatus, storeCollect, storeMedia, storeDiag } from '../src/panel/store-calls.js';

const g = /** @type {any} */ (globalThis);

/**
 * Recria a função a partir do toString(), como o chrome.scripting.executeScript faz:
 * se ela referenciar algo do módulo, quebra aqui.
 * @param {Function} fn
 * @returns {any}
 */
function reserialize(fn) {
  return new Function('return (' + fn.toString() + ')')();
}

/**
 * Instala um require() falso com uma única mensagem de mídia.
 * @param {any} msg
 */
function installStore(msg) {
  g.require = (/** @type {string} */ name) => {
    if (name === 'WAWebCollections') return { Msg: { get: (/** @type {string} */ id) => (id === 'm1' ? msg : undefined) } };
    if (name === 'WAWebMediaInMemoryBlobCache') return { InMemoryMediaBlobCache: { get: () => undefined } };
    throw new Error('módulo desconhecido ' + name);
  };
}

/**
 * Instala um require() falso pro storeStatus: Collections com Msg/Chat/Contact e chat ativo,
 * e o cache de blobs conforme `blobCache` ('throw' = módulo ausente).
 * @param {{collections?: any, blobCache?: any}} [o]
 */
function installStatusStore(o = {}) {
  const active = { id: { _serialized: '123@g.us' }, formattedTitle: 'Obra' };
  const collections = o.collections || { Msg: {}, Chat: { getActive: () => active }, Contact: {} };
  const blobCache = 'blobCache' in o ? o.blobCache : { InMemoryMediaBlobCache: {} };
  g.require = (/** @type {string} */ name) => {
    if (name === 'WAWebCollections') return collections;
    if (name === 'WAWebMediaInMemoryBlobCache') {
      if (blobCache === 'throw') throw new Error('módulo ausente');
      return blobCache;
    }
    throw new Error('módulo desconhecido ' + name);
  };
}

afterEach(() => {
  delete g.require;
  delete g.document;
  vi.useRealTimers();
});

describe('store-calls: funções autocontidas', () => {
  it('as quatro funções sobrevivem à serialização por toString()', () => {
    for (const fn of [storeStatus, storeCollect, storeMedia, storeDiag]) {
      expect(typeof reserialize(fn)).toBe('function');
    }
  });
});

describe('storeStatus', () => {
  it('Store completo: pronto, sem faltas nem avisos', () => {
    installStatusStore();
    const st = reserialize(storeStatus)();
    expect(st).toMatchObject({ ready: true, missing: [], warnings: [], chatId: '123@g.us', chatName: 'Obra' });
  });

  it('sem o módulo do cache de blobs continua no tier Store, com aviso', () => {
    installStatusStore({ blobCache: 'throw' });
    const st = reserialize(storeStatus)();
    expect(st.ready).toBe(true);
    expect(st.missing).toEqual([]);
    expect(st.warnings).toEqual(['WAWebMediaInMemoryBlobCache ausente: download usa fallback']);
  });

  it('módulo do cache sem InMemoryMediaBlobCache também só avisa', () => {
    installStatusStore({ blobCache: {} });
    const st = reserialize(storeStatus)();
    expect(st.ready).toBe(true);
    expect(st.missing).toEqual([]);
    expect(st.warnings).toEqual(['WAWebMediaInMemoryBlobCache.InMemoryMediaBlobCache ausente: download usa fallback']);
  });

  it('falta de coleção obrigatória derruba o Store', () => {
    installStatusStore({ collections: { Msg: {}, Chat: { getActive: () => null } } });
    g.document = { querySelector: () => null };
    const st = reserialize(storeStatus)();
    expect(st.ready).toBe(false);
    expect(st.missing).toEqual(['WAWebCollections.Contact']);
    expect(st.warnings).toEqual([]);
  });

  it('sem require: não pronto, sem avisos', () => {
    g.document = { querySelector: () => null };
    const st = reserialize(storeStatus)();
    expect(st).toMatchObject({ ready: false, missing: ['require'], warnings: [] });
  });
});

describe('storeMedia', () => {
  it('download rejeitado (mídia expirada) devolve o mediaStage, não stage vazio', async () => {
    const msg = {
      mediaData: { mediaStage: 'RESOLVED' },
      downloadMedia: async () => { msg.mediaData.mediaStage = 'ERROR'; throw new Error('media expired'); },
    };
    installStore(msg);
    const res = await reserialize(storeMedia)('m1');
    expect(res).toEqual({ ok: false, error: 'media expired', stage: 'ERROR' });
  });

  it('timeout de 30 s devolve stage FETCHING', async () => {
    vi.useFakeTimers();
    const msg = {
      mediaData: { mediaStage: 'INIT' },
      downloadMedia: () => { msg.mediaData.mediaStage = 'FETCHING'; return new Promise(() => {}); },
    };
    installStore(msg);
    const p = reserialize(storeMedia)('m1');
    await vi.advanceTimersByTimeAsync(30000);
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.stage).toBe('FETCHING');
    expect(res.error).toMatch(/timeout/);
  });

  it('limpa o timer da corrida quando o download termina', async () => {
    vi.useFakeTimers();
    let downloaded = false;
    const blob = new Blob([new Uint8Array([104, 105])], { type: 'audio/ogg' });
    const msg = {
      mediaData: {
        mediaStage: 'RESOLVED',
        mediaBlob: { forceToBlob: async () => (downloaded ? blob : null) },
      },
      downloadMedia: async () => { downloaded = true; },
    };
    installStore(msg);
    const res = await reserialize(storeMedia)('m1');
    expect(res).toEqual({ ok: true, mime: 'audio/ogg', base64: 'aGk=', bytes: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Store falso no formato do WhatsApp Web 2.3000.1050+: data-id da bolha é só o HEX; Msg.get(hex) falha. */
function installHexStore() {
  /** @param {string} hex @param {number} t @param {boolean} fromMe @param {string} [type] @param {string} [body] */
  const mk = (hex, t, fromMe, type = 'chat', body = '') => ({
    id: { id: hex, _serialized: `false_1203@g.us_${hex}_5511@lid`, fromMe, remote: { _serialized: '1203@g.us' } },
    t, type, body, author: { user: '5511' },
  });
  const models = [mk('HEX1', 10, false, 'chat', 'a'), mk('HEX2', 11, true, 'chat', 'b'), mk('HEX3', 12, false, 'ptt'), mk('HEX4', 13, false, 'chat', 'd')];
  const chat = { id: { _serialized: '1203@g.us' }, formattedTitle: 'PT', msgs: { getModelsArray: () => models } };
  g.require = (/** @type {string} */ name) => {
    if (name === 'WAWebCollections') return { Msg: { get: () => undefined }, Chat: { getActive: () => chat, get: () => undefined }, Contact: { get: () => ({ name: 'Fulano' }) } };
    if (name === 'WAWebMediaInMemoryBlobCache') return { InMemoryMediaBlobCache: { get: () => undefined } };
    throw new Error('módulo desconhecido ' + name);
  };
  return models;
}

describe('storeCollect com data-id só HEX (WhatsApp Web 2.3000.1050+)', () => {
  it('resolve as âncoras pelo HEX dentro do chat ativo e devolve ids completos do Store', () => {
    installHexStore();
    const r = reserialize(storeCollect)('HEX1', 'HEX3', ['HEX1', 'HEX2', 'HEX3', 'HEXX'], 300);
    expect(r.error).toBe('');
    expect(r.startFound && r.endFound).toBe(true);
    expect(r.msgs.map((/** @type {any} */ m) => m.hex)).toEqual(['HEX1', 'HEX2', 'HEX3']);
    expect(r.msgs[0].id).toBe('false_1203@g.us_HEX1_5511@lid');
    expect(r.msgs[1].authorName).toBe('Eu');
    expect(r.msgs[2].type).toBe('ptt');
    expect(r.chatId).toBe('1203@g.us');
    expect(r.chatName).toBe('PT');
    expect(r.missingFromStore).toEqual(['HEXX']);
  });
  it('âncoras invertidas são trocadas e âncora inexistente dá endFound false', () => {
    installHexStore();
    const inv = reserialize(storeCollect)('HEX3', 'HEX1', [], 300);
    expect(inv.msgs.map((/** @type {any} */ m) => m.hex)).toEqual(['HEX1', 'HEX2', 'HEX3']);
    const miss = reserialize(storeCollect)('HEX1', 'NOPE', [], 300);
    expect(miss.startFound).toBe(true);
    expect(miss.endFound).toBe(false);
    expect(miss.msgs).toEqual([]);
  });
  it('cap bloqueia sem devolver mensagens', () => {
    installHexStore();
    const r = reserialize(storeCollect)('HEX1', 'HEX4', [], 2);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(4);
    expect(r.msgs).toEqual([]);
  });
});

describe('storeMedia resolve pelo HEX quando Msg.get falha', () => {
  it('acha a mensagem no chat ativo pelo hex e devolve o blob', async () => {
    const blob = new Blob(['x'], { type: 'audio/ogg' });
    const m = { id: { id: 'HEXZ', _serialized: 'false_1_HEXZ' }, mediaData: { mediaStage: 'RESOLVED' }, filehash: 'fh', mimetype: 'audio/ogg', downloadMedia: async () => {}, mediaObject: { mediaBlob: { forceToBlob: async () => blob } } };
    g.require = (/** @type {string} */ name) => {
      if (name === 'WAWebCollections') return { Msg: { get: () => undefined }, Chat: { getActive: () => ({ msgs: { getModelsArray: () => [m] } }) }, Contact: {} };
      if (name === 'WAWebMediaInMemoryBlobCache') return { InMemoryMediaBlobCache: { get: () => undefined } };
      throw new Error('x');
    };
    const r = await reserialize(storeMedia)('false_1_HEXZ', 'HEXZ');
    expect(r.ok).toBe(true);
    expect(r.mime).toBe('audio/ogg');
    expect(r.bytes).toBe(1);
  });
});

describe('storeDiag com data-id só HEX', () => {
  it('encontra as linhas pelo chat ativo, conta as mensagens do Store e informa o formato dos ids', () => {
    installHexStore();
    g.document = { querySelectorAll: () => [{ getAttribute: () => 'HEX3' }, { getAttribute: () => 'HEX1' }, { getAttribute: () => 'NOPE' }] };
    const r = reserialize(storeDiag)();
    expect(r.rows.map((/** @type {any} */ x) => x.found)).toEqual([true, true, false]);
    expect(r.rows[0].type).toBe('ptt');
    expect(r.rows[0].storeId).toBe('false_1203@g.us_HEX3_5511@lid');
    expect(r.lastPttId).toBe('false_1203@g.us_HEX3_5511@lid');
    expect(r.msgsInStore).toBe(4);
    expect(r.chatId).toBe('1203@g.us');
    expect(r.idFormat).toBe('hex');
    expect(r.idKeys).toContain('_serialized');
  });
});

describe('storeStatus com WhatsApp ainda carregando', () => {
  it('require devolvendo undefined pra WAWebCollections = não pronto, marcado como carregando', () => {
    g.require = (/** @type {string} */ name) => (name === 'WAWebCollections' ? undefined : { InMemoryMediaBlobCache: {} });
    g.document = { querySelector: () => null };
    const r = reserialize(storeStatus)();
    expect(r.ready).toBe(false);
    expect(r.loading).toBe(true);
    expect(r.missing.join(' ')).toContain('WAWebCollections');
  });
  it('coleções ok mas lista de chats (#pane-side) ainda não montou = carregando', () => {
    installStatusStore();
    g.document = { querySelector: (/** @type {string} */ sel) => (sel === '#pane-side' ? null : null) };
    const r = reserialize(storeStatus)();
    expect(r.loading).toBe(true);
    expect(r.ready).toBe(false);
  });
  it('coleções ok e lista de chats montada = pronto, não carregando', () => {
    installStatusStore();
    g.document = { querySelector: (/** @type {string} */ sel) => (sel === '#pane-side' ? {} : null) };
    const r = reserialize(storeStatus)();
    expect(r.ready).toBe(true);
    expect(r.loading).toBe(false);
  });
});

describe('storeCollect/storeDiag com WAWebCollections indisponível', () => {
  it('devolvem erro legível em vez de TypeError', () => {
    g.require = () => undefined;
    g.document = { querySelectorAll: () => [] };
    expect(reserialize(storeCollect)('a', 'b', [], 300).error).toContain('WAWebCollections');
    expect(reserialize(storeDiag)().error).toContain('WAWebCollections');
  });
});
