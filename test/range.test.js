// @ts-check
import { describe, it, expect } from 'vitest';
import { hexOf, diffIds, sliceByIds } from '../src/lib/range.js';

describe('hexOf', () => {
  it('extrai o token de índice 2 de id de chat direto', () => {
    expect(hexOf('false_5511999@c.us_3EB0ABCDEF')).toBe('3EB0ABCDEF');
  });

  it('extrai o token de índice 2 de id de grupo (com participante extra)', () => {
    expect(hexOf('false_1203630@g.us_3EB0ABCDEF_5511999@c.us')).toBe('3EB0ABCDEF');
  });

  it('devolve o id inalterado quando há menos de 3 tokens', () => {
    expect(hexOf('false_5511999@c.us')).toBe('false_5511999@c.us');
  });
});

describe('diffIds', () => {
  it('devolve os ids do DOM ausentes no Store, preservando a ordem', () => {
    expect(diffIds(['a', 'c'], ['a', 'b', 'c', 'd'])).toEqual(['b', 'd']);
  });

  it('remove duplicatas do resultado', () => {
    expect(diffIds(['a'], ['b', 'a', 'b', 'c', 'c'])).toEqual(['b', 'c']);
  });

  it('devolve [] quando todos os ids do DOM estão no Store', () => {
    expect(diffIds(['a', 'b'], ['b', 'a'])).toEqual([]);
  });
});

describe('sliceByIds', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  /** @param {{id: string}[]} xs */
  const ids = (xs) => xs.map((x) => x.id);

  it('devolve o recorte inclusivo entre start e end', () => {
    const r = sliceByIds(items, 'b', 'd');
    expect(ids(r.items)).toEqual(['b', 'c', 'd']);
    expect(r).toMatchObject({ startFound: true, endFound: true, swapped: false });
  });

  it('troca as âncoras quando start vem depois de end', () => {
    const r = sliceByIds(items, 'd', 'b');
    expect(ids(r.items)).toEqual(['b', 'c', 'd']);
    expect(r.swapped).toBe(true);
  });

  it('devolve recorte de um item quando startId === endId', () => {
    const r = sliceByIds(items, 'c', 'c');
    expect(ids(r.items)).toEqual(['c']);
    expect(r.swapped).toBe(false);
  });

  it('devolve [] e sinaliza quando a âncora final não existe', () => {
    const r = sliceByIds(items, 'b', 'zzz');
    expect(r).toEqual({ items: [], startFound: true, endFound: false, swapped: false });
  });

  it('devolve [] e sinaliza quando a âncora inicial não existe', () => {
    const r = sliceByIds(items, 'zzz', 'b');
    expect(r).toEqual({ items: [], startFound: false, endFound: true, swapped: false });
  });

  it('preserva o tipo dos itens (genérico)', () => {
    const rich = [{ id: 'x', n: 1 }, { id: 'y', n: 2 }];
    const r = sliceByIds(rich, 'x', 'y');
    expect(r.items.map((i) => i.n)).toEqual([1, 2]);
  });
});
