// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatUsd,
  needsMedia,
  needsTranscript,
  summarizeItems,
  summaryLine,
  remainingMedia,
  remainingTranscripts,
  DEFAULT_SETTINGS,
  mergeSettings,
  limitsFromSettings,
  pricesFromSettings,
  audioFormat,
  isGroupChat,
  storeCollectProblem,
  anchorsProblem,
  missingFromStoreWarning,
  droppedNotes,
  transcriptCacheKey,
  isTranscriptCacheKey,
  sttModels,
  needsCostConfirm,
  phaseLabel,
  plainLabels,
  diagReport,
  storeStatusLine,
  domTierLine,
  cachedTranscriptKeys,
  applyCachedTranscripts,
  isGroupFromIds,
  domIdsBetween,
  tooManyMessages,
  sttShouldRetry,
  STT_RETRY_DELAY_MS,
  isSchemaRejection,
  failedTranscriptNotes,
  AUDIO_RECEIPT_WARNING,
  audioReceiptLine,
  pickCancelledAction,
  activeChatProblem,
  abortPromise,
  withTimeout,
  MEDIA_TIMEOUT_MS,
  MEDIA_TIMEOUT_ERROR,
  SELECTION_CLEARED_WARNING,
  pickCancelledWarning,
  needsRecollect,
  selectionTabChanged,
  pickHint,
} from '../src/lib/job.js';
import { DEFAULT_LIMITS } from '../src/lib/budget.js';

/** @typedef {import('../src/lib/messages.js').Item} Item */

let seq = 0;

/**
 * @param {Partial<Item>} [over]
 * @returns {Item}
 */
function item(over = {}) {
  seq += 1;
  return {
    id: `id${seq}`,
    hex: `HEX${seq}`,
    t: 1760000000 + seq,
    author: 'Fulano',
    fromMe: false,
    type: 'text',
    text: '',
    filename: '',
    mime: '',
    durationSec: 0,
    sizeBytes: 0,
    pageCount: 0,
    quotedHex: '',
    quotedText: '',
    note: '',
    ...over,
  };
}

describe('formatUsd', () => {
  it('formata com vírgula decimal e 2 casas', () => {
    expect(formatUsd(0.31)).toBe('US$ 0,31');
    expect(formatUsd(1.5)).toBe('US$ 1,50');
    expect(formatUsd(0)).toBe('US$ 0,00');
  });
  it('arredonda pra 2 casas', () => {
    expect(formatUsd(0.0037)).toBe('US$ 0,00');
    expect(formatUsd(0.905)).toBe('US$ 0,91');
  });
  it('trata NaN/inválido como 0', () => {
    expect(formatUsd(Number.NaN)).toBe('US$ 0,00');
  });
});

describe('needsMedia / needsTranscript', () => {
  it('needsMedia é true pra document, image, ptt e audio', () => {
    for (const type of /** @type {const} */ (['document', 'image', 'ptt', 'audio'])) {
      expect(needsMedia(item({ type }))).toBe(true);
    }
    for (const type of /** @type {const} */ (['text', 'other'])) {
      expect(needsMedia(item({ type }))).toBe(false);
    }
  });
  it('needsTranscript é true só pra ptt e audio', () => {
    expect(needsTranscript(item({ type: 'ptt' }))).toBe(true);
    expect(needsTranscript(item({ type: 'audio' }))).toBe(true);
    expect(needsTranscript(item({ type: 'document' }))).toBe(false);
    expect(needsTranscript(item({ type: 'image' }))).toBe(false);
    expect(needsTranscript(item({ type: 'text' }))).toBe(false);
  });
});

describe('summarizeItems', () => {
  it('conta por tipo e soma minutos de áudio com 1 decimal', () => {
    const items = [
      item({ type: 'text' }),
      item({ type: 'ptt', durationSec: 90 }),
      item({ type: 'audio', durationSec: 64 }),
      item({ type: 'document' }),
      item({ type: 'image' }),
      item({ type: 'image' }),
      item({ type: 'other' }),
    ];
    expect(summarizeItems(items)).toEqual({ total: 7, audios: 2, pdfs: 1, images: 2, others: 1, audioMinutes: 2.6 });
  });
  it('lista vazia zera tudo', () => {
    expect(summarizeItems([])).toEqual({ total: 0, audios: 0, pdfs: 0, images: 0, others: 0, audioMinutes: 0 });
  });
});

describe('summaryLine', () => {
  const cost = { typical: 0.31, max: 0.9 };
  it('monta a linha completa no plural', () => {
    const s = { total: 142, audios: 3, pdfs: 2, images: 2, others: 0, audioMinutes: 4.2 };
    expect(summaryLine(s, cost)).toBe('142 msgs · 3 áudios · 2 PDFs · 2 imagens · ≈ 4,2 min de áudio · ≈ US$ 0,31 (máx. 0,90)');
  });
  it('usa singular quando a contagem é 1', () => {
    const s = { total: 1, audios: 1, pdfs: 1, images: 1, others: 0, audioMinutes: 0.5 };
    expect(summaryLine(s, cost)).toBe('1 msg · 1 áudio · 1 PDF · 1 imagem · ≈ 0,5 min de áudio · ≈ US$ 0,31 (máx. 0,90)');
  });
  it('omite segmentos zerados, exceto msgs', () => {
    const s = { total: 0, audios: 0, pdfs: 0, images: 0, others: 3, audioMinutes: 0 };
    expect(summaryLine(s, { typical: 0.01, max: 0.05 })).toBe('0 msgs · ≈ US$ 0,01 (máx. 0,05)');
  });
  it('omite minutos de áudio quando 0 mesmo com áudios', () => {
    const s = { total: 2, audios: 1, pdfs: 0, images: 0, others: 0, audioMinutes: 0 };
    expect(summaryLine(s, cost)).toBe('2 msgs · 1 áudio · ≈ US$ 0,31 (máx. 0,90)');
  });
  it('minutos inteiros aparecem sem casa decimal extra', () => {
    const s = { total: 2, audios: 1, pdfs: 0, images: 0, others: 0, audioMinutes: 4 };
    expect(summaryLine(s, cost)).toBe('2 msgs · 1 áudio · ≈ 4 min de áudio · ≈ US$ 0,31 (máx. 0,90)');
  });
});

describe('remainingMedia', () => {
  it('devolve só mídia sem resultado ok', () => {
    const a = item({ type: 'ptt' });
    const b = item({ type: 'document' });
    const c = item({ type: 'image' });
    const d = item({ type: 'text' });
    const media = new Map(/** @type {Array<[string, any]>} */ ([
      [a.id, { ok: true, mime: 'audio/ogg', base64: 'AA', bytes: 1 }],
      [b.id, { ok: false, error: 'timeout' }],
    ]));
    expect(remainingMedia([a, b, c, d], /** @type {any} */ (media)).map((i) => i.id)).toEqual([b.id, c.id]);
  });
});

describe('remainingTranscripts', () => {
  it('áudios com mídia ok e sem transcrição ok', () => {
    const a = item({ type: 'ptt' });
    const b = item({ type: 'audio' });
    const c = item({ type: 'ptt' });
    const d = item({ type: 'ptt' });
    const e = item({ type: 'image' });
    const ok = { ok: true, mime: 'audio/ogg', base64: 'AA', bytes: 1 };
    const media = new Map(/** @type {Array<[string, any]>} */ ([[a.id, ok], [b.id, ok], [c.id, { ok: false, error: 'x' }], [e.id, ok]]));
    const transcripts = new Map(/** @type {Array<[string, any]>} */ ([[a.id, { ok: true, text: 'oi' }], [b.id, { ok: false, error: 'falhou' }]]));
    const out = remainingTranscripts([a, b, c, d, e], /** @type {any} */ (media), /** @type {any} */ (transcripts));
    expect(out.map((i) => i.id)).toEqual([b.id]);
  });
});

describe('settings', () => {
  it('DEFAULT_SETTINGS tem os valores do plano', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      apiKey: '',
      model: 'anthropic/claude-opus-5.5',
      sttPrimary: 'elevenlabs/scribe-v2',
      sttFallback: 'openai/gpt-transcribe',
      maxMessages: 300,
      maxAudioMinutesTotal: 60,
      maxAudioMinutesEach: 8,
      inputPerM: 4,
      outputPerM: 20,
      sttPerMin: 0.0037,
      costCap: 1,
      userName: '',
      audioReceiptWarning: true,
    });
  });
  it('userName vem vazio por padrão e aceita o nome salvo (aparado)', () => {
    expect(mergeSettings({}).userName).toBe('');
    expect(mergeSettings({ userName: '  Maria  ' }).userName).toBe('Maria');
    expect(mergeSettings({ userName: '   ' }).userName).toBe('');
  });
  it('mergeSettings preenche ausentes e aceita undefined', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ apiKey: 'sk-1' })).toEqual({ ...DEFAULT_SETTINGS, apiKey: 'sk-1' });
  });
  it('mergeSettings converte números vindos como string (aceita vírgula)', () => {
    const s = mergeSettings({ maxMessages: '500', costCap: '2,5', sttPerMin: '0.004' });
    expect(s.maxMessages).toBe(500);
    expect(s.costCap).toBe(2.5);
    expect(s.sttPerMin).toBe(0.004);
  });
  it('mergeSettings volta ao default em número inválido ou negativo', () => {
    const s = mergeSettings({ maxMessages: 'abc', costCap: -1, inputPerM: '' });
    expect(s.maxMessages).toBe(300);
    expect(s.costCap).toBe(1);
    expect(s.inputPerM).toBe(4);
  });
  it('mergeSettings apara strings, ignora chaves estranhas e mantém default em string vazia de modelo', () => {
    const s = mergeSettings({ apiKey: '  sk-2 \n', model: '  ', userName: ' Ana ', foo: 1 });
    expect(s.apiKey).toBe('sk-2');
    expect(s.model).toBe('anthropic/claude-opus-5.5');
    expect(s.userName).toBe('Ana');
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
  it('apiKey vazia continua vazia', () => {
    expect(mergeSettings({ apiKey: '' }).apiKey).toBe('');
  });
  it('limitsFromSettings sobrescreve só os limites de áudio', () => {
    const s = mergeSettings({ maxAudioMinutesTotal: 10, maxAudioMinutesEach: 2 });
    expect(limitsFromSettings(s)).toEqual({ ...DEFAULT_LIMITS, maxAudioMinutesTotal: 10, maxAudioMinutesEach: 2 });
  });
  it('pricesFromSettings', () => {
    const s = mergeSettings({ inputPerM: 3, outputPerM: 15, sttPerMin: 0.01 });
    expect(pricesFromSettings(s)).toEqual({ inputPerM: 3, outputPerM: 15, sttPerMin: 0.01 });
  });
  it('sttModels: primário e fallback (o retry do primário é decidido por sttShouldRetry)', () => {
    expect(sttModels(DEFAULT_SETTINGS)).toEqual(['elevenlabs/scribe-v2', 'openai/gpt-transcribe']);
  });
  it('sttModels sem fallback distinto devolve só o primário', () => {
    const s = mergeSettings({ sttFallback: 'elevenlabs/scribe-v2' });
    expect(sttModels(s)).toEqual(['elevenlabs/scribe-v2']);
  });
  it('audioReceiptWarning: boolean, aceita "true"/"false" em string, lixo volta ao default', () => {
    expect(mergeSettings({ audioReceiptWarning: false }).audioReceiptWarning).toBe(false);
    expect(mergeSettings({ audioReceiptWarning: true }).audioReceiptWarning).toBe(true);
    expect(mergeSettings({ audioReceiptWarning: 'false' }).audioReceiptWarning).toBe(false);
    expect(mergeSettings({ audioReceiptWarning: 'true' }).audioReceiptWarning).toBe(true);
    expect(mergeSettings({ audioReceiptWarning: 'x' }).audioReceiptWarning).toBe(true);
    expect(mergeSettings({}).audioReceiptWarning).toBe(true);
  });
  it('maxMessages é limitado a 1..1000 e inteiro', () => {
    expect(mergeSettings({ maxMessages: 0 }).maxMessages).toBe(1);
    expect(mergeSettings({ maxMessages: '5000' }).maxMessages).toBe(1000);
    expect(mergeSettings({ maxMessages: 1000 }).maxMessages).toBe(1000);
    expect(mergeSettings({ maxMessages: 1 }).maxMessages).toBe(1);
    expect(mergeSettings({ maxMessages: '250,6' }).maxMessages).toBe(251);
  });
});

describe('audioFormat', () => {
  it('mapeia mime em formato do STT', () => {
    expect(audioFormat('audio/ogg; codecs=opus')).toBe('ogg');
    expect(audioFormat('audio/mpeg')).toBe('mp3');
    expect(audioFormat('audio/mp4')).toBe('m4a');
    expect(audioFormat('audio/aac')).toBe('aac');
    expect(audioFormat('audio/wav')).toBe('wav');
    expect(audioFormat('audio/x-wav')).toBe('wav');
    expect(audioFormat('audio/webm')).toBe('webm');
    expect(audioFormat('audio/flac')).toBe('flac');
  });
  it('default ogg', () => {
    expect(audioFormat('')).toBe('ogg');
    expect(audioFormat('application/octet-stream')).toBe('ogg');
  });
});

describe('isGroupChat', () => {
  it('grupo termina em @g.us', () => {
    expect(isGroupChat('1203630@g.us')).toBe(true);
    expect(isGroupChat('5511999@c.us')).toBe(false);
    expect(isGroupChat('')).toBe(false);
  });
});

describe('problemas da coleta', () => {
  const base = { chatId: 'x@c.us', chatName: 'X', startFound: true, endFound: true, total: 10, truncated: false, msgs: [], missingFromStore: [], error: '' };
  it('sem problema → null', () => {
    expect(storeCollectProblem(base, 300)).toBeNull();
  });
  it('erro do Store tem prioridade e códigos conhecidos viram PT-BR', () => {
    expect(storeCollectProblem({ ...base, error: 'chat_not_found', startFound: false }, 300)).toBe('chat não encontrado no Store; recarregue a aba');
    expect(storeCollectProblem({ ...base, error: 'anchor_not_in_chat_msgs' }, 300)).toBe('role de novo pelo trecho e selecione outra vez');
  });
  it('erro desconhecido do Store vai cru com prefixo', () => {
    expect(storeCollectProblem({ ...base, error: 'boom' }, 300)).toBe('erro no Store: boom');
  });
  it('âncora faltando', () => {
    const msg = 'role de novo pelo trecho e selecione outra vez';
    expect(storeCollectProblem({ ...base, startFound: false }, 300)).toBe(msg);
    expect(storeCollectProblem({ ...base, endFound: false }, 300)).toBe(msg);
    expect(anchorsProblem({ startFound: true, endFound: false })).toBe(msg);
    expect(anchorsProblem({ startFound: true, endFound: true })).toBeNull();
  });
  it('truncado', () => {
    expect(storeCollectProblem({ ...base, truncated: true, total: 512 }, 300)).toBe('trecho de 512 msgs, acima do limite de 300; aumente o limite ou encurte');
  });
  it('tooManyMessages bloqueia só acima do limite (vale pros dois tiers)', () => {
    expect(tooManyMessages(301, 300)).toBe('trecho de 301 msgs, acima do limite de 300; aumente o limite ou encurte');
    expect(tooManyMessages(300, 300)).toBeNull();
    expect(tooManyMessages(0, 300)).toBeNull();
  });
  it('aviso de mensagens fora do Store', () => {
    expect(missingFromStoreWarning(0)).toBe('');
    expect(missingFromStoreWarning(3)).toBe('3 mensagens vistas na tela não estão no Store; role mais devagar e selecione de novo');
    expect(missingFromStoreWarning(1)).toBe('1 mensagem vista na tela não está no Store; role mais devagar e selecione de novo');
  });
});

describe('droppedNotes', () => {
  it('uma linha por item descartado com índice #n e a nota', () => {
    const a = item({ type: 'text' });
    const b = item({ type: 'other', note: 'áudio longo demais: 12 min' });
    const c = item({ type: 'other', note: 'PDF não enviado: 30 MB' });
    expect(droppedNotes([{ id: b.id, reason: 'audio_too_long' }, { id: c.id, reason: 'pdf_too_big' }], [a, b, c])).toEqual([
      '#2: áudio longo demais: 12 min',
      '#3: PDF não enviado: 30 MB',
    ]);
  });
  it('id desconhecido usa o reason', () => {
    expect(droppedNotes([{ id: 'zz', reason: 'budget' }], [])).toEqual(['budget']);
  });
});

describe('cache de transcrição', () => {
  it('chave t:<id>', () => {
    expect(transcriptCacheKey('false_x@c.us_ABC')).toBe('t:false_x@c.us_ABC');
    expect(isTranscriptCacheKey('t:abc')).toBe(true);
    expect(isTranscriptCacheKey('settings')).toBe(false);
  });
});

describe('needsCostConfirm', () => {
  it('true só quando o custo típico passa do teto', () => {
    expect(needsCostConfirm({ typical: 1.2 }, 1)).toBe(true);
    expect(needsCostConfirm({ typical: 1 }, 1)).toBe(false);
    expect(needsCostConfirm({ typical: 0.3 }, 1)).toBe(false);
  });
});

describe('phaseLabel', () => {
  it('rótulos das fases', () => {
    expect(phaseLabel('media', 2, 5)).toBe('baixando mídia 2/5');
    expect(phaseLabel('stt', 0, 3)).toBe('transcrevendo 0/3');
    expect(phaseLabel('chat', 0, 0)).toBe('gerando…');
  });
});

describe('plainLabels', () => {
  it('junta só as partes de texto', () => {
    const parts = [
      { type: 'text', text: 'Chat: X' },
      { type: 'text', text: '[#1 · áudio 0:10] «oi»' },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:...' } },
      { type: 'image_url', image_url: { url: 'data:...' } },
    ];
    expect(plainLabels(/** @type {any} */ (parts))).toBe('Chat: X\n[#1 · áudio 0:10] «oi»');
  });
});

describe('diagReport', () => {
  const base = {
    status: { ready: true, missing: [], warnings: [], chatId: '', chatName: '', waVersion: '' },
    diag: { rows: [], msgsInStore: 0, chatId: '', lastPttId: '', error: '' },
    ping: null,
    media: undefined,
  };
  it('linha "trilho" com os data-icon do trilho, separados por vírgula', () => {
    const text = diagReport({ ...base, rail: ['chats-filled', 'status-refreshed', 'community-refreshed-32'] });
    expect(text.split('\n')).toContain('trilho: chats-filled, status-refreshed, community-refreshed-32');
  });
  it('trilho não encontrado (null ou lista vazia)', () => {
    expect(diagReport({ ...base, rail: null })).toContain('trilho: não encontrado');
    expect(diagReport({ ...base, rail: [] })).toContain('trilho: não encontrado');
  });
  it('sem a informação do trilho (undefined) a linha não aparece', () => {
    expect(diagReport(base)).not.toContain('trilho:');
  });
  it('monta relatório legível com todas as partes', () => {
    const text = diagReport({
      status: { ready: false, missing: ['WAWebCollections.Msg'], warnings: ['WAWebMediaInMemoryBlobCache ausente: download usa fallback'], chatId: 'a@c.us', chatName: 'Ana', waVersion: '2.3000.1' },
      diag: { rows: [{ id: 'r1', found: true, type: 'chat', author: 'Ana' }, { id: 'r2', found: false, type: '', author: '' }], msgsInStore: 40, chatId: 'a@c.us', lastPttId: 'r1', error: '' },
      ping: { ok: true, chatName: 'Ana', picking: false, startId: null, endId: null, harvested: 12 },
      media: { ok: false, error: 'timeout 30 s', stage: 'FETCHING' },
    });
    expect(text).toContain('tier: dom');
    expect(text).toContain('faltando: WAWebCollections.Msg');
    expect(text).toContain('avisos: WAWebMediaInMemoryBlobCache ausente: download usa fallback');
    expect(text).toContain('waVersion: 2.3000.1');
    expect(text).toContain('chatId: a@c.us');
    expect(text).toContain('chatName: Ana');
    expect(text).toContain('msgsInStore: 40');
    expect(text).toContain('r1 → encontrada · chat · Ana');
    expect(text).toContain('r2 → NÃO encontrada');
    expect(text).toContain('harvested');
    expect(text).toContain('12');
    expect(text).toContain('mídia r1: erro timeout 30 s (stage FETCHING)');
  });
  it('mídia ok mostra mime e bytes sem base64', () => {
    const text = diagReport({
      status: { ready: true, missing: [], warnings: [], chatId: '', chatName: '', waVersion: '' },
      diag: { rows: [], msgsInStore: 0, chatId: '', lastPttId: 'p9', error: 'boom' },
      ping: null,
      media: { ok: true, mime: 'audio/ogg', bytes: 2048, base64: 'SEGREDO' },
    });
    expect(text).toContain('tier: store');
    expect(text).toContain('faltando: (nada)');
    expect(text).toContain('avisos: (nenhum)');
    expect(text).toContain('erro do diag: boom');
    expect(text).toContain('PING: falhou');
    expect(text).toContain('mídia p9: ok audio/ogg · 2048 bytes');
    expect(text).not.toContain('SEGREDO');
  });
  it('sem teste de mídia não menciona mídia', () => {
    const text = diagReport({
      status: { ready: true, missing: [], warnings: [], chatId: '', chatName: '', waVersion: '' },
      diag: { rows: [], msgsInStore: 0, chatId: '', lastPttId: '', error: '' },
      ping: null,
      media: undefined,
    });
    expect(text).not.toContain('mídia ');
  });
});

describe('storeStatusLine', () => {
  const base = { ready: true, missing: [], warnings: [], chatId: '', chatName: '', waVersion: '' };

  it('Store pronto sem avisos: ok com o chat ativo', () => {
    expect(storeStatusLine(base, 'Obra')).toEqual({ text: 'Store pronto · Obra', kind: 'ok' });
  });

  it('Store pronto sem chat aberto', () => {
    expect(storeStatusLine(base, '')).toEqual({ text: 'Store pronto · nenhum chat aberto', kind: 'ok' });
  });

  it('Store pronto com avisos: continua Store, mas em warn com os avisos', () => {
    const st = { ...base, warnings: ['WAWebMediaInMemoryBlobCache ausente: download usa fallback'] };
    expect(storeStatusLine(st, 'Obra')).toEqual({
      text: 'Store pronto · Obra · aviso: WAWebMediaInMemoryBlobCache ausente: download usa fallback',
      kind: 'warn',
    });
  });

  it('Store indisponível: modo texto com o que faltou', () => {
    const st = { ...base, ready: false, missing: ['require', 'WAWebCollections'] };
    expect(storeStatusLine(st, 'Obra')).toEqual({
      text: 'modo texto: mídia ignorada; módulos do WhatsApp mudaram (faltou: require, WAWebCollections). Rode o Diagnóstico.',
      kind: 'warn',
    });
  });

  it('domTierLine monta a linha do modo texto', () => {
    expect(domTierLine('executeScript (sem permissão)')).toBe(
      'modo texto: mídia ignorada; módulos do WhatsApp mudaram (faltou: executeScript (sem permissão)). Rode o Diagnóstico.',
    );
  });
});

describe('knownTimeRange', () => {
  /** @param {number} t */
  const it_ = (t) => /** @type {any} */ ({ id: String(t), hex: '', t, author: 'x', fromMe: false, type: 'text', text: '', filename: '', mime: '', durationSec: 0, sizeBytes: 0, pageCount: 0, quotedHex: '', quotedText: '', note: '' });
  it('ignora t=0 nas pontas e usa o primeiro e o último tempo conhecidos', async () => {
    const { knownTimeRange } = await import('../src/lib/job.js');
    const r = knownTimeRange([it_(0), it_(1700000000), it_(1700000600), it_(0)]);
    expect(r?.from.getTime()).toBe(1700000000 * 1000);
    expect(r?.to.getTime()).toBe(1700000600 * 1000);
  });
  it('devolve null quando nenhum item tem tempo conhecido', async () => {
    const { knownTimeRange } = await import('../src/lib/job.js');
    expect(knownTimeRange([it_(0), it_(0)])).toBeNull();
    expect(knownTimeRange([])).toBeNull();
  });
});

describe('remainingMedia com transcrição em cache', () => {
  it('pula áudio que já tem transcrição ok; PDF/imagem e áudio com transcrição falha continuam', () => {
    const a = item({ type: 'ptt' });
    const b = item({ type: 'audio' });
    const c = item({ type: 'document' });
    const d = item({ type: 'ptt' });
    const transcripts = new Map(/** @type {Array<[string, any]>} */ ([
      [a.id, { ok: true, text: 'oi' }],
      [c.id, { ok: true, text: 'não se aplica' }],
      [d.id, { ok: false, error: 'falhou' }],
    ]));
    expect(remainingMedia([a, b, c, d], new Map(), /** @type {any} */ (transcripts)).map((i) => i.id)).toEqual([b.id, c.id, d.id]);
  });
  it('sem o mapa de transcrições, comportamento antigo', () => {
    const a = item({ type: 'ptt' });
    expect(remainingMedia([a], new Map()).map((i) => i.id)).toEqual([a.id]);
  });
});

describe('cache de transcrição antes do download', () => {
  it('cachedTranscriptKeys: uma chave t:<id> por áudio, sem duplicatas, na ordem', () => {
    const a = item({ type: 'ptt' });
    const b = item({ type: 'text' });
    const c = item({ type: 'audio' });
    const d = item({ type: 'document' });
    expect(cachedTranscriptKeys([a, b, c, d, a])).toEqual([`t:${a.id}`, `t:${c.id}`]);
    expect(cachedTranscriptKeys([])).toEqual([]);
  });
  it('applyCachedTranscripts grava como ok só entradas t:<id> com text string', () => {
    const tr = new Map(/** @type {Array<[string, any]>} */ ([['x', { ok: false, error: 'falhou' }], ['y', { ok: true, text: 'memória' }]]));
    const out = applyCachedTranscripts(/** @type {any} */ (tr), {
      't:x': { text: 'do cache', model: 'm', at: 1 },
      't:y': { text: 'memória' },
      't:z': { text: 42 },
      't:w': null,
      't:v': { text: '' },
      settings: { text: 'não é transcrição' },
    });
    expect(out).toBe(tr);
    expect(tr.get('x')).toEqual({ ok: true, text: 'do cache' });
    expect(tr.get('y')).toEqual({ ok: true, text: 'memória' });
    expect(tr.get('v')).toEqual({ ok: true, text: '' });
    expect(tr.has('z')).toBe(false);
    expect(tr.has('w')).toBe(false);
    expect(tr.has('settings')).toBe(false);
  });
  it('applyCachedTranscripts aceita stored vazio/indefinido', () => {
    const tr = new Map();
    expect(applyCachedTranscripts(tr, undefined).size).toBe(0);
    expect(applyCachedTranscripts(tr, null).size).toBe(0);
  });
});

describe('isGroupFromIds (tier DOM, sem chatId)', () => {
  it('grupo quando algum id tem @g.us', () => {
    expect(isGroupFromIds([item({ id: 'false_1203630@g.us_3EB0AB_5511999@c.us' })])).toBe(true);
    expect(isGroupFromIds([item({ id: 'true_5511999@c.us_3EB0AB' }), item({ id: 'false_1203630@g.us_3EB0CD_55@c.us' })])).toBe(true);
  });
  it('direto quando nenhum id tem @g.us', () => {
    expect(isGroupFromIds([item({ id: 'false_5511999@c.us_3EB0AB' }), item({ id: 'false_123@lid_3EB0CD' })])).toBe(false);
    expect(isGroupFromIds([])).toBe(false);
  });
});

describe('domIdsBetween', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  it('recorta entre as âncoras, inclusive', () => {
    expect(domIdsBetween(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
  });
  it('âncoras em qualquer ordem', () => {
    expect(domIdsBetween(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
  it('âncora ausente → nada (sem aviso falso)', () => {
    expect(domIdsBetween(ids, 'b', 'zz')).toEqual([]);
    expect(domIdsBetween([], 'a', 'b')).toEqual([]);
  });
});

describe('sttShouldRetry', () => {
  it('repete em timeout, rede e 5xx', () => {
    expect(sttShouldRetry({ kind: 'timeout', status: 0 })).toBe(true);
    expect(sttShouldRetry({ kind: 'network', status: 0 })).toBe(true);
    expect(sttShouldRetry({ kind: 'http', status: 500 })).toBe(true);
    expect(sttShouldRetry({ kind: 'http', status: 503 })).toBe(true);
  });
  it('não repete em 4xx, cancelamento, resposta inválida ou ausente', () => {
    expect(sttShouldRetry({ kind: 'http', status: 400 })).toBe(false);
    expect(sttShouldRetry({ kind: 'http', status: 401 })).toBe(false);
    expect(sttShouldRetry({ kind: 'http', status: 429 })).toBe(false);
    expect(sttShouldRetry({ kind: 'abort', status: 0 })).toBe(false);
    expect(sttShouldRetry({ kind: 'parse', status: 200 })).toBe(false);
    expect(sttShouldRetry(undefined)).toBe(false);
  });
  it('espera 2 s antes do retry', () => {
    expect(STT_RETRY_DELAY_MS).toBe(2000);
  });
});

describe('isSchemaRejection', () => {
  it('reconhece rejeição do response_format / json_schema / structured e HTTP 400', () => {
    expect(isSchemaRejection('HTTP 400: Invalid request')).toBe(true);
    expect(isSchemaRejection('HTTP 404: response_format is not supported by this provider')).toBe(true);
    expect(isSchemaRejection('provider does not support JSON_SCHEMA')).toBe(true);
    expect(isSchemaRejection('Structured outputs unavailable')).toBe(true);
  });
  it('reconhece o 404 do OpenRouter quando require_parameters não acha provedor', () => {
    expect(isSchemaRejection('HTTP 404: No endpoints found that can handle the requested parameters.')).toBe(true);
    expect(isSchemaRejection('no endpoints found that can handle response_format')).toBe(true);
  });
  it('não confunde com outros erros', () => {
    expect(isSchemaRejection('HTTP 500: upstream')).toBe(false);
    expect(isSchemaRejection('HTTP 4000: estranho')).toBe(false);
    expect(isSchemaRejection('HTTP 404: No endpoints found for anthropic/modelo-inexistente.')).toBe(false);
    expect(isSchemaRejection('tempo esgotado (300 s) esperando o OpenRouter')).toBe(false);
    expect(isSchemaRejection('')).toBe(false);
  });
});

describe('failedTranscriptNotes', () => {
  it('uma linha por áudio não transcrito, com o motivo', () => {
    const t = item({ type: 'text' });
    const a = item({ type: 'ptt' });
    const b = item({ type: 'ptt' });
    const c = item({ type: 'audio' });
    const d = item({ type: 'ptt' });
    const transcripts = new Map(/** @type {Array<[string, any]>} */ ([[a.id, { ok: false, error: 'scribe: HTTP 500' }], [b.id, { ok: true, text: 'oi' }]]));
    const media = new Map(/** @type {Array<[string, any]>} */ ([[c.id, { ok: false, error: 'expirou (stage ERROR)' }]]));
    expect(failedTranscriptNotes([t, a, b, c, d], /** @type {any} */ (transcripts), /** @type {any} */ (media))).toEqual([
      '#2 não transcrito: scribe: HTTP 500',
      '#4 não transcrito: mídia indisponível: expirou (stage ERROR)',
    ]);
  });
});

describe('aviso de recibo de áudio', () => {
  it('linha fixa só com áudio no plano e o aviso ligado', () => {
    expect(AUDIO_RECEIPT_WARNING).toBe('o remetente pode ver os áudios como ouvidos');
    expect(audioReceiptLine([item({ type: 'text' }), item({ type: 'ptt' })], true)).toBe(AUDIO_RECEIPT_WARNING);
    expect(audioReceiptLine([item({ type: 'audio' })], true)).toBe(AUDIO_RECEIPT_WARNING);
    expect(audioReceiptLine([item({ type: 'ptt' })], false)).toBe('');
    expect(audioReceiptLine([item({ type: 'text' }), item({ type: 'other', note: 'áudio longo demais: 12 min' })], true)).toBe('');
  });
});

describe('pickCancelledAction', () => {
  it('mantém o trecho com job rodando, job retomável ou itens já coletados', () => {
    expect(pickCancelledAction({ running: true, resumable: false, collected: false })).toBe('keep');
    expect(pickCancelledAction({ running: false, resumable: true, collected: false })).toBe('keep');
    expect(pickCancelledAction({ running: false, resumable: false, collected: true })).toBe('keep');
  });
  it('zera a seleção quando ainda não há nada coletado', () => {
    expect(pickCancelledAction({ running: false, resumable: false, collected: false })).toBe('reset');
  });
});

describe('activeChatProblem', () => {
  it('null quando o chat aberto é o do trecho (rodada nova ou Retomar)', () => {
    expect(activeChatProblem('Obra', 'Obra', false)).toBeNull();
    expect(activeChatProblem('Obra', 'Obra', true)).toBeNull();
  });
  it('rodada nova: o chat ativo mudou desde a coleta', () => {
    expect(activeChatProblem('Outro', 'Obra', false)).toBe('o chat ativo mudou: volte pro chat Obra ou selecione de novo');
    expect(activeChatProblem('', 'Obra', false)).toBe('o chat ativo mudou: volte pro chat Obra ou selecione de novo');
  });
  it('Retomar: pede pra voltar ao chat do job', () => {
    expect(activeChatProblem('Outro', 'Obra', true)).toBe('volte pro chat Obra e clique Retomar');
    expect(activeChatProblem('', 'Obra', true)).toBe('volte pro chat Obra e clique Retomar');
  });
});

describe('abortPromise', () => {
  it('signal já abortado: rejeita na hora com "cancelado"', async () => {
    const c = new AbortController();
    c.abort('cancel');
    await expect(abortPromise(c.signal)).rejects.toMatchObject({ message: 'cancelado' });
  });
  it('fica pendente até o abort e então rejeita com "cancelado"', async () => {
    const c = new AbortController();
    const p = abortPromise(c.signal);
    const first = await Promise.race([p.then(() => 'resolveu', () => 'rejeitou'), Promise.resolve('pendente')]);
    expect(first).toBe('pendente');
    c.abort('chat');
    await expect(p).rejects.toMatchObject({ message: 'cancelado' });
  });
  it('destrava um race com uma promessa que nunca resolve', async () => {
    const c = new AbortController();
    const r = Promise.race([new Promise(() => {}), abortPromise(c.signal)]);
    c.abort('cancel');
    await expect(r).rejects.toMatchObject({ message: 'cancelado' });
  });
});

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('resolve com o valor quando a promessa chega antes do prazo e limpa o timer', async () => {
    await expect(withTimeout(Promise.resolve(42), 60_000, 'timeout 60 s')).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejeita com o rótulo exatamente no prazo, não antes', async () => {
    let settled = '';
    withTimeout(new Promise(() => {}), 60_000, 'timeout 60 s').catch((e) => { settled = e.message; });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe('timeout 60 s');
  });
  it('repassa a rejeição original e limpa o timer', async () => {
    await expect(withTimeout(Promise.reject(new Error('executeScript falhou')), 1000, 'x')).rejects.toMatchObject({ message: 'executeScript falhou' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('mídia: 60 s e o texto gravado no item', () => {
    expect(MEDIA_TIMEOUT_MS).toBe(60_000);
    expect(MEDIA_TIMEOUT_ERROR).toBe('timeout 60 s');
  });
  it('composição do panel: abort antes do prazo → "cancelado" e o timer some', async () => {
    const c = new AbortController();
    const p = withTimeout(Promise.race([new Promise(() => {}), abortPromise(c.signal)]), MEDIA_TIMEOUT_MS, MEDIA_TIMEOUT_ERROR);
    const check = expect(p).rejects.toMatchObject({ message: 'cancelado' });
    await vi.advanceTimersByTimeAsync(5_000);
    c.abort('cancel');
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('composição do panel: storeMedia travado → "timeout 60 s"', async () => {
    const c = new AbortController();
    let settled = '';
    withTimeout(Promise.race([new Promise(() => {}), abortPromise(c.signal)]), MEDIA_TIMEOUT_MS, MEDIA_TIMEOUT_ERROR)
      .catch((e) => { settled = e.message; });
    await vi.advanceTimersByTimeAsync(MEDIA_TIMEOUT_MS);
    expect(settled).toBe('timeout 60 s');
  });
});

describe('pickCancelledWarning', () => {
  it('trecho coletado: explica os previews sem realce e nomeia o chat do trecho', () => {
    expect(pickCancelledWarning({ collected: true, chatName: 'Obra Rua das Flores' }))
      .toBe('seleção apagada no WhatsApp; os itens coletados continuam válidos no chat "Obra Rua das Flores"');
    expect(SELECTION_CLEARED_WARNING('Obra Rua das Flores')).toBe('seleção apagada no WhatsApp; os itens coletados continuam válidos no chat "Obra Rua das Flores"');
  });
  it('vale também com job rodando (o job pode parar por troca de chat e os previews precisam de explicação)', () => {
    expect(pickCancelledWarning({ collected: true, chatName: 'X', running: true })).toContain('válidos no chat "X"');
  });
  it('sem nada coletado não avisa; sem nome usa "o chat selecionado"', () => {
    expect(pickCancelledWarning({ collected: false, chatName: 'X' })).toBe('');
    expect(pickCancelledWarning({ collected: true, chatName: '' })).toContain('no chat selecionado');
  });
});

describe('needsRecollect', () => {
  it('coleta de novo com as duas âncoras, nenhum item (ex.: barrado pelo limite no Store) e nenhum job', () => {
    expect(needsRecollect({ startId: 'a', endId: 'b', items: 0, running: false })).toBe(true);
  });
  it('não coleta sem as duas âncoras, com itens já coletados ou com job rodando', () => {
    expect(needsRecollect({ startId: 'a', endId: null, items: 0, running: false })).toBe(false);
    expect(needsRecollect({ startId: null, endId: null, items: 0, running: false })).toBe(false);
    expect(needsRecollect({ startId: 'a', endId: 'b', items: 5, running: false })).toBe(false);
    expect(needsRecollect({ startId: 'a', endId: 'b', items: 0, running: true })).toBe(false);
  });
});

describe('selectionTabChanged', () => {
  it('true quando a seleção foi feita em outra aba', () => {
    expect(selectionTabChanged(1, 2)).toBe(true);
  });
  it('false sem seleção ou na mesma aba', () => {
    expect(selectionTabChanged(null, 2)).toBe(false);
    expect(selectionTabChanged(2, 2)).toBe(false);
  });
});

describe('pickHint', () => {
  it('guia a escolha das âncoras', () => {
    expect(pickHint({ picking: true, startId: null, endId: null, harvested: 0 })).toBe('clique na primeira mensagem…');
    expect(pickHint({ picking: true, startId: 'a', endId: null, harvested: 3 })).toBe('agora clique na última');
  });
  it('depois da âncora final mostra quantas linhas foram vistas', () => {
    expect(pickHint({ picking: false, startId: 'a', endId: 'b', harvested: 42 })).toBe('42 linhas vistas');
    expect(pickHint({ picking: false, startId: 'a', endId: 'a', harvested: 1 })).toBe('1 linha vista');
  });
  it('vazio sem seleção', () => {
    expect(pickHint({ picking: false, startId: null, endId: null, harvested: 0 })).toBe('');
  });
});

describe('pickWhatsAppTab (Firefox/Zen: o painel pode estar em janela própria)', () => {
  const WA = 'https://web.whatsapp.com/';
  /** @param {Partial<{id:number,url:string,active:boolean,windowId:number,lastAccessed:number}>} t */
  const tab = (t) => /** @type {any} */ ({ id: 1, url: WA, active: false, windowId: 1, lastAccessed: 0, ...t });
  it('prefere a aba ativa do WhatsApp na janela atual', async () => {
    const { pickWhatsAppTab } = await import('../src/lib/job.js');
    const tabs = [tab({ id: 1, active: true, windowId: 7 }), tab({ id: 2, active: true, windowId: 3 })];
    expect(pickWhatsAppTab(tabs, 3)?.id).toBe(2);
  });
  it('senão, a aba ativa do WhatsApp em qualquer janela; senão a acessada mais recentemente', async () => {
    const { pickWhatsAppTab } = await import('../src/lib/job.js');
    expect(pickWhatsAppTab([tab({ id: 1, lastAccessed: 5 }), tab({ id: 2, active: true, windowId: 9 })], 3)?.id).toBe(2);
    expect(pickWhatsAppTab([tab({ id: 1, lastAccessed: 5 }), tab({ id: 2, lastAccessed: 9 })], 3)?.id).toBe(2);
  });
  it('ignora abas fora do WhatsApp e devolve null sem nenhuma', async () => {
    const { pickWhatsAppTab } = await import('../src/lib/job.js');
    expect(pickWhatsAppTab([tab({ id: 1, url: 'https://x.com/', active: true, windowId: 3 })], 3)).toBeNull();
    expect(pickWhatsAppTab([], 3)).toBeNull();
  });
  it('REQUIRED_ORIGINS lista WhatsApp Web e OpenRouter', async () => {
    const { REQUIRED_ORIGINS } = await import('../src/lib/job.js');
    expect(REQUIRED_ORIGINS).toEqual(['https://web.whatsapp.com/*', 'https://openrouter.ai/*']);
  });
});

describe('storeStatusLine com WhatsApp carregando', () => {
  it('avisa que está aguardando em vez de cair no modo texto', async () => {
    const { storeStatusLine } = await import('../src/lib/job.js');
    const line = storeStatusLine(/** @type {any} */ ({ ready: false, loading: true, missing: ['WAWebCollections (ainda não carregou)'], warnings: [], chatId: '', chatName: '', waVersion: '' }), '');
    expect(line.kind).toBe('warn');
    expect(line.text).toContain('carregando');
    expect(line.text).not.toContain('modo texto');
  });
});
