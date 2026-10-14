// @ts-check
import { describe, it, expect } from 'vitest';
import { toItem } from '../src/lib/toitem.js';

/** @typedef {import('../src/lib/messages.js').RawMsg} RawMsg */

/**
 * RawMsg completo com defaults neutros; sobrescreve com `over`.
 * @param {Partial<RawMsg>} over
 * @returns {RawMsg}
 */
function raw(over) {
  return {
    id: 'false_5511999999999@c.us_ABC123_5511888888888@c.us',
    hex: 'ABC123',
    t: 1760400000,
    fromMe: false,
    type: 'chat',
    body: '',
    caption: '',
    filename: '',
    mimetype: '',
    duration: 0,
    size: 0,
    pageCount: 0,
    isViewOnce: false,
    quotedHex: '',
    quotedText: '',
    authorName: 'Fulano',
    ...over,
  };
}

describe('toItem: tipos descartados', () => {
  for (const type of ['e2e_notification', 'gp2', 'notification_template', 'reaction', 'call_log', 'ciphertext', 'protocol']) {
    it(`retorna null para type '${type}'`, () => {
      expect(toItem(raw({ type }))).toBeNull();
    });
  }
});

describe('toItem: texto', () => {
  it("mapeia 'chat' para type 'text' com body como texto e note vazia", () => {
    const item = toItem(raw({ type: 'chat', body: 'comprar pão' }));
    expect(item).not.toBeNull();
    expect(item?.type).toBe('text');
    expect(item?.text).toBe('comprar pão');
    expect(item?.note).toBe('');
  });
});

describe('toItem: mídia suportada', () => {
  it("mapeia 'ptt' para type 'ptt' com note vazia", () => {
    const item = toItem(raw({ type: 'ptt' }));
    expect(item?.type).toBe('ptt');
    expect(item?.note).toBe('');
  });

  it("mapeia 'audio' para type 'audio' com note vazia", () => {
    const item = toItem(raw({ type: 'audio' }));
    expect(item?.type).toBe('audio');
    expect(item?.note).toBe('');
  });

  it("mapeia 'image' para type 'image' com note vazia", () => {
    const item = toItem(raw({ type: 'image' }));
    expect(item?.type).toBe('image');
    expect(item?.note).toBe('');
  });

  it("mapeia 'document' PDF para type 'document' com note vazia", () => {
    const item = toItem(raw({ type: 'document', mimetype: 'application/pdf', filename: 'contrato.pdf' }));
    expect(item?.type).toBe('document');
    expect(item?.note).toBe('');
  });
});

describe('toItem: texto de mídia', () => {
  it('usa caption e nunca o body base64 numa imagem', () => {
    const base64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/'.repeat(20);
    const item = toItem(raw({ type: 'image', body: base64, caption: 'nota fiscal do mês' }));
    expect(item?.text).toBe('nota fiscal do mês');
  });

  it("devolve text '' quando mídia não tem caption, mesmo com body preenchido", () => {
    const item = toItem(raw({ type: 'ptt', body: 'AAAABBBBCCCC', caption: /** @type {any} */ (undefined) }));
    expect(item?.text).toBe('');
  });
});

describe('toItem: documento não-PDF', () => {
  it("vira 'other' com note citando o filename", () => {
    const item = toItem(raw({ type: 'document', mimetype: 'application/vnd.ms-excel', filename: 'planilha.xls' }));
    expect(item?.type).toBe('other');
    expect(item?.note).toBe('anexo "planilha.xls" não lido');
  });

  it("vira 'other' com note 'anexo não lido' quando filename é vazio", () => {
    const item = toItem(raw({ type: 'document', mimetype: 'application/zip', filename: '' }));
    expect(item?.type).toBe('other');
    expect(item?.note).toBe('anexo não lido');
  });

  it("vira 'other' com note 'anexo não lido' quando filename e mimetype são undefined", () => {
    const item = toItem(raw({ type: 'document', mimetype: /** @type {any} */ (undefined), filename: /** @type {any} */ (undefined) }));
    expect(item?.type).toBe('other');
    expect(item?.note).toBe('anexo não lido');
  });
});

describe("toItem: tipos que viram 'other'", () => {
  /** @type {Array<[string, string]>} */
  const casos = [
    ['video', 'vídeo não lido'],
    ['ptv', 'vídeo curto não lido'],
    ['sticker', 'figurinha'],
    ['poll_creation', 'enquete não lida'],
    ['location', 'localização'],
    ['vcard', 'contato compartilhado'],
    ['revoked', 'mensagem apagada'],
  ];
  for (const [type, note] of casos) {
    it(`mapeia '${type}' para 'other' com note '${note}'`, () => {
      const item = toItem(raw({ type }));
      expect(item?.type).toBe('other');
      expect(item?.note).toBe(note);
    });
  }

  it("mapeia tipo desconhecido para 'other' com note de não suportado", () => {
    const item = toItem(raw({ type: 'list_response' }));
    expect(item?.type).toBe('other');
    expect(item?.note).toBe('tipo "list_response" não suportado');
  });
});

describe('toItem: visualização única', () => {
  it("imagem view-once vira 'other' com note 'visualização única não lida'", () => {
    const item = toItem(raw({ type: 'image', isViewOnce: true, caption: 'segredo' }));
    expect(item?.type).toBe('other');
    expect(item?.note).toBe('visualização única não lida');
    expect(item?.text).toBe('');
  });

  it('chat view-once não envia body', () => {
    const item = toItem(raw({ type: 'chat', isViewOnce: true, body: 'segredo' }));
    expect(item?.type).toBe('other');
    expect(item?.text).toBe('');
  });

  it('tipo descartado com isViewOnce continua null', () => {
    expect(toItem(raw({ type: 'reaction', isViewOnce: true }))).toBeNull();
  });
});

describe('toItem: autor', () => {
  it('usa authorName quando presente', () => {
    expect(toItem(raw({ authorName: 'Maria', fromMe: false }))?.author).toBe('Maria');
  });

  it("usa 'Eu' quando authorName é vazio e fromMe é true", () => {
    expect(toItem(raw({ authorName: '', fromMe: true }))?.author).toBe('Eu');
  });

  it("usa '?' quando authorName é vazio e fromMe é false", () => {
    expect(toItem(raw({ authorName: '', fromMe: false }))?.author).toBe('?');
  });

  it('converte fromMe para boolean estrito', () => {
    expect(toItem(raw({ fromMe: /** @type {any} */ (undefined) }))?.fromMe).toBe(false);
    expect(toItem(raw({ fromMe: /** @type {any} */ (1) }))?.fromMe).toBe(true);
  });
});

describe('toItem: campos copiados e numéricos', () => {
  it('copia id, hex, t, mime, filename, quotedHex e quotedText', () => {
    const item = toItem(raw({
      type: 'document', id: 'true_x@c.us_DEF456', hex: 'DEF456', t: 1760401234,
      mimetype: 'application/pdf', filename: 'boleto.pdf', quotedHex: 'ABC123', quotedText: 'manda o boleto',
    }));
    expect(item).toMatchObject({
      id: 'true_x@c.us_DEF456', hex: 'DEF456', t: 1760401234,
      mime: 'application/pdf', filename: 'boleto.pdf', quotedHex: 'ABC123', quotedText: 'manda o boleto',
    });
  });

  it('converte duration string em durationSec numérico', () => {
    expect(toItem(raw({ type: 'ptt', duration: '42' }))?.durationSec).toBe(42);
  });

  it('copia size e pageCount numéricos', () => {
    const item = toItem(raw({ type: 'document', mimetype: 'application/pdf', size: 123456, pageCount: 7 }));
    expect(item?.sizeBytes).toBe(123456);
    expect(item?.pageCount).toBe(7);
  });

  it('usa 0 quando duration não é numérico', () => {
    expect(toItem(raw({ type: 'ptt', duration: 'abc' }))?.durationSec).toBe(0);
  });

  it('converte t string em número', () => {
    expect(toItem(raw({ t: /** @type {any} */ ('1760400000') }))?.t).toBe(1760400000);
  });
});

describe('toItem: campos opcionais ausentes', () => {
  it('aplica defaults seguros quando os opcionais são undefined', () => {
    /** @type {any} */
    const minimo = { id: 'false_y@c.us_AAA', hex: 'AAA', type: 'ptt' };
    expect(toItem(minimo)).toEqual({
      id: 'false_y@c.us_AAA',
      hex: 'AAA',
      t: 0,
      author: '?',
      fromMe: false,
      type: 'ptt',
      text: '',
      filename: '',
      mime: '',
      durationSec: 0,
      sizeBytes: 0,
      pageCount: 0,
      quotedHex: '',
      quotedText: '',
      note: '',
    });
  });

  it("chat sem body vira text ''", () => {
    /** @type {any} */
    const minimo = { id: 'i', hex: 'h', type: 'chat' };
    expect(toItem(minimo)?.text).toBe('');
  });

  it('tipo com nome de chave do Object.prototype cai em não suportado', () => {
    expect(toItem(raw({ type: 'toString' }))?.note).toBe('tipo "toString" não suportado');
  });
});
