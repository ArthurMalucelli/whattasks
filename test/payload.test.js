// @ts-check
import { describe, it, expect } from 'vitest';
import { formatStamp, headerLine, labelFor, buildUserContent } from '../src/lib/payload.js';

/** @typedef {import('../src/lib/messages.js').Item} Item */

/** Unix seconds para uma data no fuso local (testes independentes do TZ da máquina). */
const ts = (y, mo, d, h, mi) => Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

describe('formatStamp', () => {
  it('formata dd/mm HH:MM com zero à esquerda', () => {
    expect(formatStamp(ts(2026, 3, 5, 7, 4))).toBe('05/03 07:04');
  });

  it('inclui o ano quando withYear', () => {
    expect(formatStamp(ts(2026, 10, 13, 9, 41), true)).toBe('13/10/2026 09:41');
  });

  it('usa o fuso informado em vez do local', () => {
    const t = Date.UTC(2026, 9, 14, 23, 5) / 1000;
    expect(formatStamp(t, true, 'Europe/Lisbon')).toBe('15/10/2026 00:05');
    expect(formatStamp(t, false, 'America/Sao_Paulo')).toBe('14/10 20:05');
  });

  it('meia-noite sai como 00, não 24', () => {
    expect(formatStamp(Date.UTC(2026, 0, 1, 0, 0) / 1000, false, 'UTC')).toBe('01/01 00:00');
  });

  it('t = 0 (horário desconhecido) vira placeholder em vez de 1970', () => {
    expect(formatStamp(0, false, 'UTC')).toBe('??/?? ??:??');
    expect(formatStamp(0, true, 'UTC')).toBe('??/??/???? ??:??');
  });

  it('t não finito ou negativo também vira placeholder', () => {
    for (const t of [NaN, Infinity, -1]) {
      expect(formatStamp(t)).toBe('??/?? ??:??');
      expect(formatStamp(t, true)).toBe('??/??/???? ??:??');
    }
  });
});

/**
 * Item mínimo com defaults.
 * @param {Partial<Item>} over
 * @returns {Item}
 */
function item(over) {
  return {
    id: 'id', hex: 'H', t: ts(2026, 10, 13, 9, 41), author: 'Pedro', fromMe: false, type: 'text',
    text: '', filename: '', mime: '', durationSec: 0, sizeBytes: 0, pageCount: 0,
    quotedHex: '', quotedText: '', note: '', ...over,
  };
}

describe('headerLine', () => {
  const now = new Date(2026, 9, 14, 20, 0); // quarta-feira
  const items = [
    item({ id: 'a', t: ts(2026, 10, 13, 9, 41) }),
    item({ id: 'b', t: ts(2026, 10, 14, 12, 0) }),
    item({ id: 'c', t: ts(2026, 10, 14, 18, 3) }),
  ];

  it('monta a linha de cabeçalho de grupo com dia da semana', () => {
    expect(headerLine({ chatName: 'Obra', isGroup: true, now, userName: 'Ana' }, items)).toBe(
      `Chat: "Obra" (grupo) · trecho de 3 mensagens · de 13/10/2026 09:41 a 14/10/2026 18:03 · hoje: 14/10/2026 (quarta-feira) · fuso ${Intl.DateTimeFormat().resolvedOptions().timeZone} · "Eu" = Ana.`,
    );
  });

  it('usa "direto" quando não é grupo', () => {
    expect(headerLine({ chatName: 'Pedro', isGroup: false, now, userName: 'Ana' }, items)).toContain('Chat: "Pedro" (direto) ·');
  });

  it('usa meta.tz no rótulo e nos horários (datas, hoje e dia da semana)', () => {
    // 14/10 23:30 UTC = 15/10 00:30 em Lisboa (quinta) e 14/10 20:30 em São Paulo (quarta).
    const nowUtc = new Date(Date.UTC(2026, 9, 14, 23, 30));
    const lis = [item({ id: 'a', t: Date.UTC(2026, 9, 13, 8, 41) / 1000 }), item({ id: 'b', t: Date.UTC(2026, 9, 14, 23, 5) / 1000 })];
    expect(headerLine({ chatName: 'X', isGroup: true, now: nowUtc, userName: 'Ana', tz: 'Europe/Lisbon' }, lis)).toBe(
      'Chat: "X" (grupo) · trecho de 2 mensagens · de 13/10/2026 09:41 a 15/10/2026 00:05 · hoje: 15/10/2026 (quinta-feira) · fuso Europe/Lisbon · "Eu" = Ana.',
    );
  });

  it('sem meta.tz, rotula o fuso que os horários realmente usam (o do sistema)', () => {
    const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(headerLine({ chatName: 'X', isGroup: true, now, userName: 'Ana' }, items)).toContain(` · fuso ${sys} · `);
  });

  it('usa o singular para 1 mensagem', () => {
    expect(headerLine({ chatName: 'X', isGroup: true, now, userName: 'Ana' }, [items[0]])).toContain(
      ' · trecho de 1 mensagem · de 13/10/2026 09:41 a 13/10/2026 09:41 · ',
    );
  });

  it('pega outro dia da semana corretamente', () => {
    const sabado = new Date(2026, 9, 17, 10, 0);
    expect(headerLine({ chatName: 'X', isGroup: true, now: sabado, userName: 'Ana' }, items)).toContain('hoje: 17/10/2026 (sábado)');
  });
});

describe('headerLine com horários desconhecidos (t = 0)', () => {
  const now = new Date(2026, 9, 14, 20, 0);
  const meta = { chatName: 'X', isGroup: true, now, userName: 'Ana' };

  it('intervalo usa o primeiro e o último item com t > 0', () => {
    const its = [
      item({ id: 'a', t: 0 }),
      item({ id: 'b', t: ts(2026, 10, 13, 9, 41) }),
      item({ id: 'c', t: ts(2026, 10, 14, 18, 3) }),
      item({ id: 'd', t: 0 }),
    ];
    const h = headerLine(meta, its);
    expect(h).toContain(' · trecho de 4 mensagens · de 13/10/2026 09:41 a 14/10/2026 18:03 · hoje: ');
    expect(h).not.toContain('1970');
    expect(h).not.toContain('??');
  });

  it('omite o intervalo quando nenhum item tem horário', () => {
    const h = headerLine(meta, [item({ id: 'a', t: 0 }), item({ id: 'b', t: 0 })]);
    expect(h).toContain('trecho de 2 mensagens · hoje: 14/10/2026');
    expect(h).not.toContain(' · de ');
  });
});

describe('headerLine sem nome de usuário', () => {
  const now = new Date(2026, 9, 14, 20, 0);
  it.each([[''], ['   ']])('nome %j vira "Eu" = você', (userName) => {
    const h = headerLine({ chatName: 'X', isGroup: true, now, userName }, []);
    expect(h.endsWith(' · "Eu" = você.')).toBe(true);
  });
  it('apara espaços do nome informado', () => {
    const h = headerLine({ chatName: 'X', isGroup: true, now, userName: '  Maria ' }, []);
    expect(h.endsWith(' · "Eu" = Maria.')).toBe(true);
  });
});

describe('headerLine sem itens', () => {
  it('omite o intervalo de datas quando o trecho está vazio', () => {
    const h = headerLine({ chatName: 'X', isGroup: true, now: new Date(2026, 9, 14), userName: 'Ana' }, []);
    expect(h).toContain('trecho de 0 mensagens · hoje: 14/10/2026');
    expect(h).not.toContain(' de  a ');
  });
});

/**
 * Contexto de label com defaults.
 * @param {Partial<import('../src/lib/payload.js').LabelCtx>} over
 * @returns {import('../src/lib/payload.js').LabelCtx}
 */
function ctx(over = {}) {
  return { hexIndex: new Map(), transcripts: new Map(), media: new Map(), attachment: '', ...over };
}

const T = ts(2026, 10, 13, 9, 41);

describe('labelFor: texto e citação', () => {
  it('rotula mensagem de texto', () => {
    expect(labelFor(item({ t: T, author: 'Pedro', text: 'manda o orçamento' }), 1, ctx())).toBe(
      '[#1 · 13/10 09:41 · Pedro] manda o orçamento',
    );
  });

  it('t = 0 mostra o horário como desconhecido', () => {
    expect(labelFor(item({ t: 0, text: 'oi' }), 1, ctx())).toBe('[#1 · ??/?? ??:?? · Pedro] oi');
  });

  it('cita mensagem dentro do trecho pelo índice', () => {
    const c = ctx({ hexIndex: new Map([['ABC', 2]]) });
    expect(labelFor(item({ t: T, text: 'sim', quotedHex: 'ABC', quotedText: 'pode ser sexta?' }), 5, c)).toBe(
      '[#5 · 13/10 09:41 · Pedro · ↳ responde #2] sim',
    );
  });

  it('cita mensagem fora do trecho pelo texto citado', () => {
    expect(labelFor(item({ t: T, text: 'sim', quotedHex: 'ZZZ', quotedText: 'pode ser sexta?' }), 5, ctx({ hexIndex: new Map([['ABC', 2]]) }))).toBe(
      '[#5 · 13/10 09:41 · Pedro · ↳ responde a «pode ser sexta?»] sim',
    );
  });

  it('remove espaços finais do label', () => {
    expect(labelFor(item({ t: T, text: 'ok   ' }), 1, ctx())).toBe('[#1 · 13/10 09:41 · Pedro] ok');
  });
});

describe('labelFor: áudio', () => {
  const ptt = item({ id: 'p1', t: T, type: 'ptt', durationSec: 42 });

  it('mostra a transcrição quando ok', () => {
    const c = ctx({ transcripts: new Map([['p1', { ok: true, text: 'traz o laudo amanhã' }]]) });
    expect(labelFor(ptt, 3, c)).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] «traz o laudo amanhã»');
  });

  it('marca NÃO TRANSCRITO com o erro quando falhou', () => {
    const c = ctx({ transcripts: new Map([['p1', { ok: false, error: 'timeout' }]]) });
    expect(labelFor(ptt, 3, c)).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] [NÃO TRANSCRITO: timeout]');
  });

  it('marca não processado quando não há resultado', () => {
    expect(labelFor(ptt, 3, ctx())).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] [NÃO TRANSCRITO: não processado]');
  });

  it('mídia que falhou no download mostra o motivo', () => {
    const c = ctx({ media: new Map([['p1', { ok: false, error: 'expirou', stage: 'ERROR' }]]) });
    expect(labelFor(ptt, 3, c)).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] [NÃO TRANSCRITO: mídia indisponível: expirou]');
  });

  it('transcrição ok (cache) vence mídia que falhou', () => {
    const c = ctx({
      media: new Map([['p1', { ok: false, error: 'expirou' }]]),
      transcripts: new Map([['p1', { ok: true, text: 'do cache' }]]),
    });
    expect(labelFor(ptt, 3, c)).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] «do cache»');
  });

  it('mídia ok sem transcrição continua não processado', () => {
    const c = ctx({ media: new Map([['p1', { ok: true, mime: 'audio/ogg', base64: 'AA', bytes: 1 }]]) });
    expect(labelFor(ptt, 3, c)).toBe('[#3 · 13/10 09:41 · Pedro · áudio 0:42] [NÃO TRANSCRITO: não processado]');
  });

  it('formata duração acima de um minuto como m:ss (tipo audio)', () => {
    const a = item({ id: 'a1', t: T, type: 'audio', durationSec: 70 });
    expect(labelFor(a, 1, ctx())).toContain(' · áudio 1:10] ');
  });

  it('arredonda duração fracionária', () => {
    const a = item({ id: 'a1', t: T, type: 'ptt', durationSec: 9.6 });
    expect(labelFor(a, 1, ctx())).toContain(' · áudio 0:10] ');
  });
});

/** @type {import('../src/lib/messages.js').MediaResult} */
const PDF_OK = { ok: true, mime: 'application/pdf', base64: 'JVBERi0=', bytes: 5 };
/** @type {import('../src/lib/messages.js').MediaResult} */
const IMG_OK = { ok: true, mime: 'image/jpeg', base64: '/9j/4AAQ', bytes: 6 };

describe('labelFor: documento', () => {
  const doc = item({ id: 'd1', t: T, type: 'document', filename: 'orcamento.pdf', pageCount: 3, text: 'segue' });

  it('aponta o anexo com nº de páginas quando a mídia está ok', () => {
    const c = ctx({ media: new Map([['d1', PDF_OK]]), attachment: 'A2' });
    expect(labelFor(doc, 4, c)).toBe('[#4 · 13/10 09:41 · Pedro · PDF "orcamento.pdf", 3 págs → A2] segue');
  });

  it('omite as páginas quando pageCount é 0', () => {
    const c = ctx({ media: new Map([['d1', PDF_OK]]), attachment: 'A1' });
    expect(labelFor({ ...doc, pageCount: 0, text: '' }, 4, c)).toBe('[#4 · 13/10 09:41 · Pedro · PDF "orcamento.pdf" → A1]');
  });

  it('marca mídia indisponível com o erro quando falhou', () => {
    const c = ctx({ media: new Map([['d1', { ok: false, error: 'expirada' }]]) });
    expect(labelFor(doc, 4, c)).toBe('[#4 · 13/10 09:41 · Pedro · PDF "orcamento.pdf" · mídia indisponível: expirada] segue');
  });

  it('marca não processada quando não há resultado', () => {
    expect(labelFor(doc, 4, ctx())).toBe('[#4 · 13/10 09:41 · Pedro · PDF "orcamento.pdf" · mídia indisponível: não processada] segue');
  });
});

describe('labelFor: imagem', () => {
  const img = item({ id: 'i1', t: T, type: 'image', text: 'fachada' });

  it('aponta o anexo com legenda quando a mídia está ok', () => {
    const c = ctx({ media: new Map([['i1', IMG_OK]]), attachment: 'A1' });
    expect(labelFor(img, 2, c)).toBe('[#2 · 13/10 09:41 · Pedro · imagem → A1, legenda: "fachada"]');
  });

  it('omite a legenda quando o texto está vazio', () => {
    const c = ctx({ media: new Map([['i1', IMG_OK]]), attachment: 'A1' });
    expect(labelFor({ ...img, text: '' }, 2, c)).toBe('[#2 · 13/10 09:41 · Pedro · imagem → A1]');
  });

  it('marca mídia indisponível com o erro quando falhou', () => {
    const c = ctx({ media: new Map([['i1', { ok: false, error: 'view once' }]]) });
    expect(labelFor(img, 2, c)).toBe('[#2 · 13/10 09:41 · Pedro · imagem · mídia indisponível: view once] fachada');
  });

  it('marca não processada quando não há resultado', () => {
    expect(labelFor(img, 2, ctx())).toBe('[#2 · 13/10 09:41 · Pedro · imagem · mídia indisponível: não processada] fachada');
  });
});

describe('labelFor: outros', () => {
  it('inclui a nota e o texto', () => {
    expect(labelFor(item({ t: T, type: 'other', note: 'vídeo não lido', text: 'olha isso' }), 7, ctx())).toBe(
      '[#7 · 13/10 09:41 · Pedro · vídeo não lido] olha isso',
    );
  });

  it('termina no colchete quando não há texto', () => {
    expect(labelFor(item({ t: T, type: 'other', note: 'mensagem apagada' }), 7, ctx())).toBe('[#7 · 13/10 09:41 · Pedro · mensagem apagada]');
  });
});

describe('buildUserContent', () => {
  const meta = { chatName: 'Obra', isGroup: true, now: new Date(2026, 9, 14, 20, 0), userName: 'Ana' };
  const items = [
    item({ id: 'm1', hex: 'H1', t: T, text: 'bom dia' }),
    item({ id: 'd1', hex: 'H2', t: T, type: 'document', filename: 'a.pdf', pageCount: 2 }),
    item({ id: 'p1', hex: 'H3', t: T, type: 'ptt', durationSec: 5 }),
    item({ id: 'i1', hex: 'H4', t: T, type: 'image', text: 'planta', filename: 'planta.jpg' }),
    item({ id: 'd2', hex: 'H5', t: T, type: 'document', filename: 'b.pdf' }),
    item({ id: 'i2', hex: 'H6', t: T, type: 'image', quotedHex: 'H2', quotedText: 'a.pdf' }),
  ];
  /** @type {Array<[string, import('../src/lib/messages.js').MediaResult]>} */
  const mediaEntries = [
    ['d1', PDF_OK],
    ['i1', IMG_OK],
    ['d2', { ok: false, error: 'expirada' }],
    ['i2', { ...IMG_OK, mime: 'image/png' }],
  ];
  const media = new Map(mediaEntries);
  /** @type {Map<string, import('../src/lib/messages.js').TranscriptResult>} */
  const transcripts = new Map([['p1', { ok: true, text: 'beleza' }]]);

  /** @type {ReturnType<typeof buildUserContent>} */
  const out = buildUserContent(items, transcripts, media, meta);

  it('abre com a linha de cabeçalho', () => {
    expect(out.parts[0]).toEqual({ type: 'text', text: headerLine(meta, items) });
  });

  it('numera anexos só de mídia ok, na ordem de aparição', () => {
    expect(out.attachments).toEqual([
      { label: 'A1', id: 'd1', filename: 'a.pdf' },
      { label: 'A2', id: 'i1', filename: 'planta.jpg' },
      { label: 'A3', id: 'i2', filename: '' },
    ]);
  });

  it('intercala labels e partes de arquivo/imagem na ordem dos itens', () => {
    expect(out.parts.slice(1)).toEqual([
      { type: 'text', text: '[#1 · 13/10 09:41 · Pedro] bom dia' },
      { type: 'text', text: '[#2 · 13/10 09:41 · Pedro · PDF "a.pdf", 2 págs → A1]' },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' } },
      { type: 'text', text: '[#3 · 13/10 09:41 · Pedro · áudio 0:05] «beleza»' },
      { type: 'text', text: '[#4 · 13/10 09:41 · Pedro · imagem → A2, legenda: "planta"]' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } },
      { type: 'text', text: '[#5 · 13/10 09:41 · Pedro · PDF "b.pdf" · mídia indisponível: expirada]' },
      { type: 'text', text: '[#6 · 13/10 09:41 · Pedro · ↳ responde #2 · imagem → A3]' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,/9j/4AAQ' } },
    ]);
  });

  it('labels usam o mesmo fuso do cabeçalho (meta.tz)', () => {
    const r = buildUserContent([item({ id: 'x', t: Date.UTC(2026, 9, 14, 23, 5) / 1000, text: 'oi' })], new Map(), new Map(), { ...meta, tz: 'Europe/Lisbon' });
    expect(r.parts[1]).toEqual({ type: 'text', text: '[#1 · 15/10 00:05 · Pedro] oi' });
  });

  it('não gera anexos quando não há mídia', () => {
    const r = buildUserContent([item({ id: 'x', text: 'oi' })], new Map(), new Map(), meta);
    expect(r.attachments).toEqual([]);
    expect(r.parts).toHaveLength(2);
  });

  it('item convertido em other pelo orçamento não vira anexo mesmo com mídia ok no Map', () => {
    const its = [
      item({ id: 'd1', t: T, type: 'other', filename: 'a.pdf', note: 'PDF não enviado: 30 MB', text: 'segue' }),
      item({ id: 'i1', t: T, type: 'other', filename: 'f.jpg', note: 'imagem não enviada: 20 MB' }),
    ];
    const r = buildUserContent(its, new Map(), new Map([['d1', PDF_OK], ['i1', IMG_OK]]), meta);
    expect(r.attachments).toEqual([]);
    expect(r.parts.slice(1)).toEqual([
      { type: 'text', text: '[#1 · 13/10 09:41 · Pedro · PDF não enviado: 30 MB] segue' },
      { type: 'text', text: '[#2 · 13/10 09:41 · Pedro · imagem não enviada: 20 MB]' },
    ]);
  });

  it('não anexa documento ou imagem sem resultado de mídia', () => {
    const r = buildUserContent([item({ id: 'd', type: 'document', filename: 'c.pdf' }), item({ id: 'i', type: 'image' })], new Map(), new Map(), meta);
    expect(r.attachments).toEqual([]);
    expect(r.parts.map((p) => p.type)).toEqual(['text', 'text', 'text']);
  });
});
