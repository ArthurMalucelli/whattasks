// @ts-check
import { describe, it, expect } from 'vitest';
import { parsePrePlainText, domRowsToItems } from '../src/lib/domparse.js';

/** @typedef {import('../src/lib/messages.js').RawRow} RawRow */

/** unix seconds de uma data LOCAL */
const local = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime() / 1000;

describe('parsePrePlainText', () => {
  it('lê o formato pt-BR (24h, dia/mês/ano)', () => {
    expect(parsePrePlainText('[09:41, 14/10/2026] Fulano: ')).toEqual({
      t: local(2026, 10, 14, 9, 41),
      author: 'Fulano',
    });
  });

  it('lê o formato en-US (12h com PM, mês/dia/ano)', () => {
    expect(parsePrePlainText('[9:41 PM, 10/14/2026] John Doe: ')).toEqual({
      t: local(2026, 10, 14, 21, 41),
      author: 'John Doe',
    });
  });

  it('lê o formato de (24h, dia.mês.ano com pontos)', () => {
    expect(parsePrePlainText('[14:32, 28.9.2026] Anna: ')).toEqual({
      t: local(2026, 9, 28, 14, 32),
      author: 'Anna',
    });
  });

  it('converte 12 AM em 0h', () => {
    expect(parsePrePlainText('[12:05 AM, 1/2/2026] X: ')?.t).toBe(local(2026, 1, 2, 0, 5));
  });

  it('mantém 12 PM como 12h', () => {
    expect(parsePrePlainText('[12:30 PM, 1/2/2026] X: ')?.t).toBe(local(2026, 1, 2, 12, 30));
  });

  it('aceita espaço estreito (U+202F) antes de AM/PM', () => {
    expect(parsePrePlainText('[9:41 PM, 10/14/2026] John: ')?.t).toBe(local(2026, 10, 14, 21, 41));
  });

  it('preserva ": " dentro do nome do autor, removendo só o final', () => {
    expect(parsePrePlainText('[09:41, 14/10/2026] Ana: Paula: ')?.author).toBe('Ana: Paula');
  });

  it('devolve null para string vazia', () => {
    expect(parsePrePlainText('')).toBeNull();
  });

  it('devolve null para texto sem cabeçalho reconhecível', () => {
    expect(parsePrePlainText('olá mundo')).toBeNull();
  });

  it('devolve null para minuto fora da faixa', () => {
    expect(parsePrePlainText('[09:60, 14/10/2026] Fulano: ')).toBeNull();
  });

  it('devolve null para hora fora da faixa (24h)', () => {
    expect(parsePrePlainText('[24:00, 14/10/2026] Fulano: ')).toBeNull();
  });

  it('devolve null para hora 13 com AM/PM', () => {
    expect(parsePrePlainText('[13:00 PM, 10/14/2026] John: ')).toBeNull();
  });

  it('devolve null para data impossível', () => {
    expect(parsePrePlainText('[09:41, 32/13/2026] Fulano: ')).toBeNull();
  });
});

/**
 * @param {Partial<RawRow> & {dataId: string, domIndex: number}} o
 * @returns {RawRow}
 */
const row = (o) => ({ pre: '', text: '', hasPtt: false, hasDoc: false, hasImg: false, ...o });

const ID_A = 'false_5511999@c.us_AAA';
const ID_B = 'false_5511999@c.us_BBB';
const ID_C = 'false_5511999@c.us_CCC';
const PRE = '[09:41, 14/10/2026] Fulano: ';
const T = local(2026, 10, 14, 9, 41);

describe('domRowsToItems', () => {
  it('converte uma linha de texto num Item completo', () => {
    const r = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'oi' })], ID_A, ID_A);
    expect(r).toEqual({
      startFound: true,
      endFound: true,
      items: [{
        id: ID_A, hex: 'AAA', t: T, author: 'Fulano', fromMe: false, type: 'text', text: 'oi',
        filename: '', mime: '', durationSec: 0, sizeBytes: 0, pageCount: 0,
        quotedHex: '', quotedText: '', note: '',
      }],
    });
  });

  it('ordena por domIndex antes de recortar', () => {
    const rows = [
      row({ dataId: ID_C, domIndex: 2, pre: PRE, text: 'c' }),
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, pre: PRE, text: 'b' }),
    ];
    expect(domRowsToItems(rows, ID_A, ID_C).items.map((i) => i.text)).toEqual(['a', 'b', 'c']);
  });

  it('recorta inclusivamente só entre as âncoras', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, pre: PRE, text: 'b' }),
      row({ dataId: ID_C, domIndex: 2, pre: PRE, text: 'c' }),
    ];
    expect(domRowsToItems(rows, ID_B, ID_C).items.map((i) => i.text)).toEqual(['b', 'c']);
  });

  it('troca âncoras invertidas', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, pre: PRE, text: 'b' }),
    ];
    expect(domRowsToItems(rows, ID_B, ID_A).items.map((i) => i.text)).toEqual(['a', 'b']);
  });

  it('devolve [] e flags quando uma âncora não está no DOM', () => {
    const rows = [row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' })];
    expect(domRowsToItems(rows, ID_A, ID_C)).toEqual({ items: [], startFound: true, endFound: false });
  });

  it('extrai o hex de id de grupo', () => {
    const id = 'false_1203630@g.us_3EB0ABCDEF_5511999@c.us';
    expect(domRowsToItems([row({ dataId: id, domIndex: 0, pre: PRE, text: 'x' })], id, id).items[0].hex)
      .toBe('3EB0ABCDEF');
  });

  it('marca fromMe e usa autor "Eu" mesmo com nome no pre', () => {
    const id = 'true_5511999@c.us_MINE';
    const it0 = domRowsToItems([row({ dataId: id, domIndex: 0, pre: PRE, text: 'x' })], id, id).items[0];
    expect(it0.fromMe).toBe(true);
    expect(it0.author).toBe('Eu');
  });

  it('linha sem pre herda t da anterior e recebe autor "?"', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, pre: '', text: 'b' }),
    ];
    const b = domRowsToItems(rows, ID_A, ID_B).items[1];
    expect(b.t).toBe(T);
    expect(b.author).toBe('?');
  });

  it('linha com pre ilegível também herda t', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, pre: 'lixo', text: 'b' }),
    ];
    expect(domRowsToItems(rows, ID_A, ID_B).items[1].t).toBe(T);
  });

  it('herda t encadeado por várias linhas sem pre', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, text: 'b' }),
      row({ dataId: ID_C, domIndex: 2, text: 'c' }),
    ];
    expect(domRowsToItems(rows, ID_A, ID_C).items[2].t).toBe(T);
  });

  it('primeira linha do recorte sem pre fica com t 0', () => {
    expect(domRowsToItems([row({ dataId: ID_A, domIndex: 0, text: 'a' })], ID_A, ID_A).items[0].t).toBe(0);
  });

  it('não herda t de linha fora do recorte', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'a' }),
      row({ dataId: ID_B, domIndex: 1, text: 'b' }),
    ];
    expect(domRowsToItems(rows, ID_B, ID_B).items[0].t).toBe(0);
  });

  it('linha fromMe sem pre recebe autor "Eu"', () => {
    const id = 'true_5511999@c.us_MINE';
    expect(domRowsToItems([row({ dataId: id, domIndex: 0, text: 'x' })], id, id).items[0].author).toBe('Eu');
  });

  it('áudio vira other com nota e mantém o texto como legenda', () => {
    const it0 = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE, text: 'leg', hasPtt: true })], ID_A, ID_A).items[0];
    expect(it0).toMatchObject({ type: 'other', note: 'áudio ignorado (modo texto)', text: 'leg' });
  });

  it('documento vira other com nota', () => {
    const it0 = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE, hasDoc: true })], ID_A, ID_A).items[0];
    expect(it0).toMatchObject({ type: 'other', note: 'documento ignorado (modo texto)' });
  });

  it('imagem vira other com nota', () => {
    const it0 = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE, hasImg: true })], ID_A, ID_A).items[0];
    expect(it0).toMatchObject({ type: 'other', note: 'imagem ignorada (modo texto)' });
  });

  it('prioridade de mídia: áudio > documento > imagem', () => {
    const rows = [
      row({ dataId: ID_A, domIndex: 0, pre: PRE, hasPtt: true, hasDoc: true, hasImg: true }),
      row({ dataId: ID_B, domIndex: 1, pre: PRE, hasDoc: true, hasImg: true }),
    ];
    expect(domRowsToItems(rows, ID_A, ID_B).items.map((i) => i.note)).toEqual([
      'áudio ignorado (modo texto)',
      'documento ignorado (modo texto)',
    ]);
  });

  it('linha sem texto e sem mídia vira other "mensagem sem texto"', () => {
    const it0 = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE })], ID_A, ID_A).items[0];
    expect(it0).toMatchObject({ type: 'other', note: 'mensagem sem texto', text: '' });
  });

  it('texto só com espaços conta como sem texto', () => {
    const it0 = domRowsToItems([row({ dataId: ID_A, domIndex: 0, pre: PRE, text: '  \n ' })], ID_A, ID_A).items[0];
    expect(it0).toMatchObject({ type: 'other', note: 'mensagem sem texto' });
  });
});
