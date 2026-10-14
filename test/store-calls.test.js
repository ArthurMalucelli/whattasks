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

/**
 * Store falso de grupo pras menções (WA Web 2.3000.1050+: @menção no texto vira o número cru do @lid).
 * Cada spec vira uma mensagem do chat ativo (campos do spec sobrescrevem o padrão); `get` faz o papel de
 * Contact.get (undefined = não resolveu; lançar = falha do Store). Devolve a coleta do trecho inteiro.
 * @param {any[]} specs @param {(jid: any) => any} get @param {any} [groupMetadata]
 */
function collectMentions(specs, get, groupMetadata) {
  const models = specs.map((s, i) => ({
    id: { id: 'MN' + i, _serialized: `false_1203@g.us_MN${i}_9999@lid`, fromMe: false, remote: { _serialized: '1203@g.us' } },
    t: 100 + i, type: 'chat', body: '', author: '9999@lid', ...s,
  }));
  const chat = { id: { _serialized: '1203@g.us' }, formattedTitle: 'Grupo', msgs: { getModelsArray: () => models }, groupMetadata };
  g.require = (/** @type {string} */ name) => {
    if (name === 'WAWebCollections') return { Msg: { get: () => undefined }, Chat: { getActive: () => chat, get: () => undefined }, Contact: { get } };
    throw new Error('módulo desconhecido ' + name);
  };
  return reserialize(storeCollect)('MN0', 'MN' + (models.length - 1), [], 300);
}

/** Nenhum campo de texto pode sobrar com "@" + número cru. @param {any} r */
function semNumeroCru(r) {
  for (const m of r.msgs) for (const k of ['body', 'caption', 'quotedText']) expect(m[k]).not.toMatch(/@\d{6,}/);
}

describe('storeCollect resolve @menções numéricas (@lid) em nomes', () => {
  it('menção pela mentionedJidList vira @nome; autor continua igual', () => {
    const r = collectMentions(
      [{ body: '@149434948169739 manda o kindle', mentionedJidList: ['149434948169739@lid'] }],
      (jid) => (jid === '149434948169739@lid' ? { pushname: 'Chedid' } : undefined),
    );
    expect(r.error).toBe('');
    expect(r.msgs[0].body).toBe('@Chedid manda o kindle');
    expect(r.msgs[0].authorName).toBe('+9999');
    expect(r.msgs[0].hex).toBe('MN0');
  });

  it('entrada da mentionedJidList é passada como veio (wid objeto) e tem prioridade sobre os fallbacks', () => {
    const wid = { user: '5511987654321', server: 'c.us', _serialized: '5511987654321@c.us' };
    const soSerialized = { _serialized: '777777777@lid' };
    const r = collectMentions(
      [{ body: '@5511987654321 e @777777777 e @123456789', mentionedJidList: [wid, soSerialized, '123456789@c.us'] }],
      (jid) => {
        if (jid === wid) return { name: 'Ana' };
        if (jid === soSerialized) return { verifiedName: 'Loja X' };
        if (jid === '123456789@c.us') return { notifyName: 'Pela lista' };
        if (jid === '123456789@lid') return { name: 'Pelo fallback' };
        return undefined;
      },
    );
    expect(r.msgs[0].body).toBe('@Ana e @Loja X e @Pela lista');
  });

  it('sem mentionedJidList: resolve por N@lid e, se não, por N@c.us', () => {
    const r = collectMentions(
      [{ body: '@2345678901 e @3456789012' }],
      (jid) => (jid === '2345678901@lid' ? { name: 'Bia' } : jid === '3456789012@c.us' ? { notifyName: 'Caio' } : undefined),
    );
    expect(r.msgs[0].body).toBe('@Bia e @Caio');
  });

  it('último recurso: participantes do grupo (contact do participante ou Contact.get(participant.id))', () => {
    const pid = { user: '5678901234', _serialized: '5678901234@lid' };
    const participants = [
      { id: { user: '4567890123', _serialized: '4567890123@lid' }, contact: { formattedName: 'Duda' } },
      { id: pid },
    ];
    const get = (/** @type {any} */ jid) => (jid === pid ? { pushname: 'Enzo' } : undefined);
    const body = '@4567890123 chama o @5678901234';
    for (const p of [{ getModelsArray: () => participants }, { models: participants }, participants]) {
      const r = collectMentions([{ body }], get, { participants: p });
      expect(r.msgs[0].body).toBe('@Duda chama o @Enzo');
    }
  });

  it('não resolvidos viram @participante-N estável em todo o trecho', () => {
    const r = collectMentions(
      [{ body: '@111111111 e @222222222 e @111111111' }, { body: 'nada aqui' }, { body: '@333333333 responde @222222222' }],
      () => undefined,
    );
    expect(r.msgs.map((/** @type {any} */ m) => m.body)).toEqual([
      '@participante-1 e @participante-2 e @participante-1',
      'nada aqui',
      '@participante-3 responde @participante-2',
    ]);
  });

  it('contato cujo único nome é o próprio número não vaza o número: vira apelido', () => {
    const r = collectMentions(
      [{ body: 'fala @149434948169739', mentionedJidList: ['149434948169739@lid'] }],
      (jid) => (String(jid).startsWith('149434948169739') ? { formattedName: '+149434948169739' } : undefined),
    );
    expect(r.msgs[0].body).toBe('fala @participante-1');
  });

  it('legenda de mídia e texto citado também são resolvidos (citada usa a própria mentionedJidList)', () => {
    const qwid = { user: '888888888', _serialized: '888888888@lid' };
    const mwid = { user: '666666666', _serialized: '666666666@lid' };
    const get = (/** @type {any} */ jid) => {
      if (jid === '149434948169739@lid') return { pushname: 'Chedid' };
      if (jid === qwid) return { name: 'Eva' };
      if (jid === mwid) return { name: 'Fábio' };
      return undefined;
    };
    const r = collectMentions([
      { type: 'image', body: '', caption: 'olha isso @149434948169739', mentionedJidList: ['149434948169739@lid'] },
      { body: 'feito', quotedStanzaID: 'Q1', quotedMsg: { type: 'chat', body: 'pergunta pro @888888888', mentionedJidList: [qwid] } },
      { body: 'ok @666666666', mentionedJidList: [mwid], quotedStanzaID: 'Q2', quotedMsg: { type: 'image', caption: 'foto do @666666666' } },
    ], get);
    expect(r.msgs[0].caption).toBe('olha isso @Chedid');
    expect(r.msgs[1].quotedHex).toBe('Q1');
    expect(r.msgs[1].quotedText).toBe('pergunta pro @Eva');
    expect(r.msgs[2].body).toBe('ok @Fábio');
    expect(r.msgs[2].quotedText).toBe('foto do @Fábio');
    semNumeroCru(r);
  });

  it('@ curto e e-mail ficam intactos; mensagem sem @ sai byte a byte igual', () => {
    const sem = 'sem menção nenhuma, pedido 123456789 às 10h';
    const r = collectMentions(
      [{ body: 'vê com o @12 e o @12345, manda pra x@gmail.com' }, { body: sem }],
      () => ({ name: 'Não deveria aparecer' }),
    );
    expect(r.msgs[0].body).toBe('vê com o @12 e o @12345, manda pra x@gmail.com');
    expect(r.msgs[1].body).toBe(sem);
  });

  it('Contact.get lançando não derruba a coleta: cai no apelido', () => {
    const r = collectMentions(
      [{ body: '@111111111 e @2345678901', mentionedJidList: ['111111111@lid'] }],
      (jid) => {
        if (String(jid).startsWith('111111111')) throw new Error('Store quebrou');
        return jid === '2345678901@lid' ? { name: 'Bia' } : undefined;
      },
      { participants: { getModelsArray: () => { throw new Error('metadata quebrou'); } } },
    );
    expect(r.error).toBe('');
    expect(r.msgs[0].body).toBe('@participante-1 e @Bia');
    expect(r.msgs[0].authorName).toBe('+9999');
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

describe('storeCollect: bordas da resolução de menções (revisão adversarial)', () => {
  it('não mexe em @ dentro de URL, e-mail com domínio numérico ou token com letras coladas', () => {
    const body = 'veja https://x.y/@123456789 e joao@1234567.com e @123456abc; (@123456789) oi @123456789. e a,@123456789';
    const r = collectMentions([{ body }], () => undefined);
    expect(r.msgs[0].body).toBe('veja https://x.y/@123456789 e joao@1234567.com e @123456abc; (@participante-1) oi @participante-1. e a,@participante-1');
  });

  it('nome achado pela mentionedJidList vale pro mesmo número em mensagens seguintes sem lista', () => {
    const wid = { user: '123456789', _serialized: '123456789@lid' };
    const r = collectMentions(
      [{ body: '@123456789 manda', mentionedJidList: [wid] }, { body: 'cadê, @123456789?' }],
      (jid) => (jid === wid ? { name: 'Ana' } : undefined),
    );
    expect(r.msgs.map((/** @type {any} */ m) => m.body)).toEqual(['@Ana manda', 'cadê, @Ana?']);
  });

  it('número que é prefixo de outro não é trocado dentro do maior', () => {
    const r = collectMentions([{ body: '@123456 e @1234567 e @123456' }], (jid) => (jid === '1234567@lid' ? { name: 'Longo' } : undefined));
    expect(r.msgs[0].body).toBe('@participante-1 e @Longo e @participante-1');
  });

  it('corte de 120 chars do texto citado não deixa apelido ou nome pela metade', () => {
    const longo = 'x'.repeat(110) + ' @111111111 fim';
    const r = collectMentions([{ body: 'ok', quotedStanzaID: 'Q9', quotedMsg: { type: 'chat', body: longo } }], () => undefined);
    expect(r.msgs[0].quotedText).toBe('x'.repeat(110));
    const cabe = 'y'.repeat(100) + ' @111111111';
    const r2 = collectMentions([{ body: 'ok', quotedStanzaID: 'Q8', quotedMsg: { type: 'chat', body: cabe } }], () => undefined);
    expect(r2.msgs[0].quotedText).toBe('y'.repeat(100) + ' @participante-1');
  });

  it('nome que é telefone disfarçado com caracteres invisíveis ou hífen especial não vaza', () => {
    const r = collectMentions(
      [{ body: 'fala @149434948169739', mentionedJidList: ['149434948169739@lid'] }],
      () => ({ formattedName: '\u202A+149 434 948\u2011169 739\u202C' }),
    );
    expect(r.msgs[0].body).toBe('fala @participante-1');
    const emoji = collectMentions([{ body: 'oi @149434948169739', mentionedJidList: ['149434948169739@lid'] }], () => ({ pushname: '🦉' }));
    expect(emoji.msgs[0].body).toBe('oi @🦉');
  });
});
