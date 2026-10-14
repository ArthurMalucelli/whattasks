// @ts-check
import { describe, it, expect } from 'vitest';
import { applyLimits, estimateCost, DEFAULT_LIMITS, DEFAULT_PRICES } from '../src/lib/budget.js';

/** @typedef {import('../src/lib/messages.js').Item} Item */

const MB = 1024 * 1024;
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

describe('constantes', () => {
  it('DEFAULT_LIMITS tem os valores do spec', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxAudioMinutesTotal: 60,
      maxAudioMinutesEach: 8,
      maxPdfBytes: 22 * MB,
      maxPdfPagesTotal: 600,
      maxImages: 20,
      maxImageBytes: 10 * MB,
      maxBase64Bytes: 30 * MB,
    });
  });

  it('DEFAULT_PRICES tem os valores do spec', () => {
    expect(DEFAULT_PRICES).toEqual({ inputPerM: 4, outputPerM: 20, sttPerMin: 0.0037 });
  });
});

describe('applyLimits: por item', () => {
  it('sem mídia, devolve os mesmos itens e nada descartado', () => {
    const items = [item({ text: 'oi' }), item({ text: 'tudo bem?' })];
    const r = applyLimits(items);
    expect(r.items).toEqual(items);
    expect(r.dropped).toEqual([]);
    expect(r.audioMinutes).toBe(0);
    expect(r.needsAudioConfirm).toBe(false);
    expect(r.unknownPages).toBe(0);
  });

  it('áudio exatamente no limite individual não é descartado', () => {
    const a = item({ type: 'ptt', durationSec: 8 * 60 });
    const r = applyLimits([a]);
    expect(r.items[0].type).toBe('ptt');
    expect(r.dropped).toEqual([]);
  });

  it('ptt acima do limite individual vira other com nota e reason audio_too_long', () => {
    const a = item({ type: 'ptt', durationSec: 8 * 60 + 1, text: '' });
    const r = applyLimits([a]);
    expect(r.items[0].type).toBe('other');
    expect(r.items[0].note).toBe('áudio longo demais: 8 min');
    expect(r.dropped).toEqual([{ id: a.id, reason: 'audio_too_long' }]);
  });

  it('audio (não ptt) longo também é convertido, minutos arredondados', () => {
    const a = item({ type: 'audio', durationSec: 12.6 * 60 });
    const r = applyLimits([a]);
    expect(r.items[0].note).toBe('áudio longo demais: 13 min');
    expect(r.dropped[0].reason).toBe('audio_too_long');
  });

  it('item convertido mantém id, autor, t e texto/legenda', () => {
    const a = item({ type: 'image', sizeBytes: 11 * MB, text: 'olha isso', author: 'Ana', t: 123 });
    const r = applyLimits([a]);
    const out = r.items[0];
    expect(out).toMatchObject({ id: a.id, author: 'Ana', t: 123, text: 'olha isso', type: 'other' });
  });

  it('PDF acima de maxPdfBytes vira other com nota em MB e reason pdf_too_big', () => {
    const d = item({ type: 'document', sizeBytes: 23 * MB, pageCount: 10 });
    const r = applyLimits([d]);
    expect(r.items[0].type).toBe('other');
    expect(r.items[0].note).toBe('PDF não enviado: 23 MB');
    expect(r.dropped).toEqual([{ id: d.id, reason: 'pdf_too_big' }]);
  });

  it('PDF exatamente em maxPdfBytes é mantido', () => {
    const d = item({ type: 'document', sizeBytes: 22 * MB, pageCount: 1 });
    const r = applyLimits([d]);
    expect(r.items[0].type).toBe('document');
  });

  it('imagem acima de maxImageBytes vira other com reason image_too_big', () => {
    const i = item({ type: 'image', sizeBytes: 10 * MB + 600 * 1024 });
    const r = applyLimits([i]);
    expect(r.items[0].note).toBe('imagem não enviada: 11 MB');
    expect(r.dropped).toEqual([{ id: i.id, reason: 'image_too_big' }]);
  });

  it('não muta os itens de entrada', () => {
    const a = item({ type: 'ptt', durationSec: 1000 });
    const snapshot = { ...a };
    const r = applyLimits([a]);
    expect(a).toEqual(snapshot);
    expect(r.items[0]).not.toBe(a);
  });

  it('respeita limites customizados', () => {
    const a = item({ type: 'ptt', durationSec: 61 });
    const r = applyLimits([a], { ...DEFAULT_LIMITS, maxAudioMinutesEach: 1 });
    expect(r.dropped).toEqual([{ id: a.id, reason: 'audio_too_long' }]);
  });
});

describe('applyLimits: limite de imagens', () => {
  it('21 imagens: só a 21ª é convertida', () => {
    const imgs = Array.from({ length: 21 }, () => item({ type: 'image', sizeBytes: 1000 }));
    const r = applyLimits(imgs);
    expect(r.items.slice(0, 20).every((i) => i.type === 'image')).toBe(true);
    expect(r.items[20].type).toBe('other');
    expect(r.items[20].note).toBe('imagem não enviada: limite de 20 imagens');
    expect(r.dropped).toEqual([{ id: imgs[20].id, reason: 'image_limit' }]);
  });

  it('a nota usa o limite configurado', () => {
    const imgs = [item({ type: 'image' }), item({ type: 'image' }), item({ type: 'image' })];
    const r = applyLimits(imgs, { ...DEFAULT_LIMITS, maxImages: 2 });
    expect(r.items[2].note).toBe('imagem não enviada: limite de 2 imagens');
  });

  it('imagem já descartada por tamanho não ocupa vaga no limite', () => {
    const big = item({ type: 'image', sizeBytes: 11 * MB });
    const imgs = [big, ...Array.from({ length: 20 }, () => item({ type: 'image', sizeBytes: 1000 }))];
    const r = applyLimits(imgs);
    expect(r.dropped).toEqual([{ id: big.id, reason: 'image_too_big' }]);
  });
});

describe('applyLimits: páginas de PDF', () => {
  it('soma 601 com dois PDFs: o maior é convertido', () => {
    const small = item({ type: 'document', pageCount: 200, sizeBytes: 1000 });
    const large = item({ type: 'document', pageCount: 401, sizeBytes: 1000 });
    const r = applyLimits([small, large]);
    expect(r.items[0].type).toBe('document');
    expect(r.items[1].type).toBe('other');
    expect(r.items[1].note).toBe('PDF não enviado: limite de páginas no request');
    expect(r.dropped).toEqual([{ id: large.id, reason: 'pdf_pages' }]);
  });

  it('soma exatamente 600 não descarta nada', () => {
    const r = applyLimits([
      item({ type: 'document', pageCount: 300 }),
      item({ type: 'document', pageCount: 300 }),
    ]);
    expect(r.dropped).toEqual([]);
  });

  it('descarta repetidamente o maior até caber', () => {
    const a = item({ type: 'document', pageCount: 500 });
    const b = item({ type: 'document', pageCount: 400 });
    const c = item({ type: 'document', pageCount: 100 });
    const r = applyLimits([a, b, c]);
    expect(r.dropped.map((d) => d.id)).toEqual([a.id]);
    const r2 = applyLimits([a, b, c], { ...DEFAULT_LIMITS, maxPdfPagesTotal: 150 });
    expect(r2.dropped.map((d) => d.id)).toEqual([a.id, b.id]);
  });

  it('PDF com pageCount 0 conta em unknownPages e como 0 páginas', () => {
    const r = applyLimits([
      item({ type: 'document', pageCount: 0 }),
      item({ type: 'document', pageCount: 0 }),
      item({ type: 'document', pageCount: 600 }),
    ]);
    expect(r.unknownPages).toBe(2);
    expect(r.dropped).toEqual([]);
  });

  it('PDF descartado por tamanho não conta em unknownPages', () => {
    const r = applyLimits([item({ type: 'document', pageCount: 0, sizeBytes: 23 * MB })]);
    expect(r.unknownPages).toBe(0);
  });
});

describe('applyLimits: orçamento base64', () => {
  it('descarta o maior PDF antes de qualquer imagem', () => {
    const img = item({ type: 'image', sizeBytes: 9 * MB });
    const pdfSmall = item({ type: 'document', sizeBytes: 5 * MB, pageCount: 1 });
    const pdfBig = item({ type: 'document', sizeBytes: 12 * MB, pageCount: 1 });
    // base64 ≈ (9+5+12)*4/3 = 34.7 MB > 30 MB; sem o PDF grande: 18.7 MB
    const r = applyLimits([img, pdfSmall, pdfBig]);
    expect(r.dropped).toEqual([{ id: pdfBig.id, reason: 'budget' }]);
    expect(r.items[2].note).toBe('não enviado: limite de tamanho do request');
    expect(r.items[0].type).toBe('image');
  });

  it('esgota os PDFs antes de passar pras imagens, maior imagem primeiro', () => {
    const imgs = [3, 9, 9.5, 8].map((m) => item({ type: 'image', sizeBytes: m * MB }));
    const pdf = item({ type: 'document', sizeBytes: 1 * MB, pageCount: 1 });
    // base64: (29.5+1)*4/3 = 40.7 → tira PDF (39.3) → tira 9.5 (26.7) ok
    const r = applyLimits([...imgs, pdf]);
    expect(r.dropped).toEqual([
      { id: pdf.id, reason: 'budget' },
      { id: imgs[2].id, reason: 'budget' },
    ]);
  });

  it('exatamente no orçamento não descarta', () => {
    const r = applyLimits([item({ type: 'image', sizeBytes: 3 })], { ...DEFAULT_LIMITS, maxBase64Bytes: 4 });
    expect(r.dropped).toEqual([]);
  });

  it('usa Math.ceil no tamanho base64 estimado', () => {
    // ceil(1*4/3) = 2 > 1
    const r = applyLimits([item({ type: 'image', sizeBytes: 1 })], { ...DEFAULT_LIMITS, maxBase64Bytes: 1 });
    expect(r.dropped[0].reason).toBe('budget');
  });
});

describe('applyLimits: minutos de áudio', () => {
  it('soma os áudios mantidos, arredondado a 1 decimal', () => {
    const r = applyLimits([
      item({ type: 'ptt', durationSec: 100 }),
      item({ type: 'audio', durationSec: 50 }),
      item({ type: 'ptt', durationSec: 9 * 60 }), // descartado
    ]);
    expect(r.audioMinutes).toBe(2.5);
  });

  it('needsAudioConfirm é false exatamente em maxAudioMinutesTotal', () => {
    const r = applyLimits(Array.from({ length: 8 }, () => item({ type: 'ptt', durationSec: 450 })));
    expect(r.audioMinutes).toBe(60);
    expect(r.needsAudioConfirm).toBe(false);
  });

  it('needsAudioConfirm é true acima de maxAudioMinutesTotal', () => {
    const items = Array.from({ length: 8 }, () => item({ type: 'ptt', durationSec: 450 }));
    items.push(item({ type: 'ptt', durationSec: 6 }));
    const r = applyLimits(items);
    expect(r.audioMinutes).toBe(60.1);
    expect(r.needsAudioConfirm).toBe(true);
  });
});

describe('estimateCost', () => {
  it('sem itens: só overhead de 500 tokens e saída típica/máxima', () => {
    const r = estimateCost([]);
    expect(r).toEqual({ typical: 0.122, max: 0.642, inputTokens: 500, audioMinutes: 0 });
  });

  it('texto conta ceil(chars / 3.2) tokens mais 100 por item', () => {
    const r = estimateCost([item({ text: 'a'.repeat(33) })]);
    expect(r.inputTokens).toBe(500 + 11 + 100);
  });

  it('documento conta 2000 tokens por página', () => {
    const r = estimateCost([item({ type: 'document', pageCount: 3 })]);
    expect(r.inputTokens).toBe(500 + 6000 + 100);
  });

  it('imagem conta 1600 tokens', () => {
    const r = estimateCost([item({ type: 'image' })]);
    expect(r.inputTokens).toBe(500 + 1600 + 100);
  });

  it('item other não conta páginas nem imagem', () => {
    const r = estimateCost([item({ type: 'other', pageCount: 50, note: 'PDF não enviado: 30 MB' })]);
    expect(r.inputTokens).toBe(600);
  });

  it('cenário misto: tokens, minutos e custos arredondados a 4 casas', () => {
    const r = estimateCost([
      item({ text: 'a'.repeat(32) }),
      item({ type: 'document', pageCount: 3 }),
      item({ type: 'image' }),
      item({ type: 'ptt', durationSec: 120 }),
    ]);
    expect(r.inputTokens).toBe(8510);
    expect(r.audioMinutes).toBe(2);
    expect(r.typical).toBe(0.1614);
    expect(r.max).toBe(0.6814);
  });

  it('opts.typicalOut e opts.maxOut sobrescrevem os tokens de saída', () => {
    const r = estimateCost([], DEFAULT_PRICES, { typicalOut: 1000, maxOut: 2000 });
    expect(r.typical).toBe(0.022);
    expect(r.max).toBe(0.042);
  });

  it('usa os preços passados', () => {
    const r = estimateCost([item({ type: 'audio', durationSec: 600 })], { inputPerM: 0, outputPerM: 0, sttPerMin: 1 });
    expect(r.typical).toBe(10);
    expect(r.max).toBe(10);
  });
});
