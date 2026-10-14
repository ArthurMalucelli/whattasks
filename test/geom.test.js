// @ts-check
import { describe, it, expect } from 'vitest';
import { clampRect, dragMove, resizeTo, DEFAULT_RECT, MIN_SIZE, maxSizeFor } from '../src/lib/geom.js';

const VP = { width: 1440, height: 900 };

describe('constantes', () => {
  it('padrão 72/12, 360 de largura, altura automática; mínimo 300×320; máximo 720×(vh - 24)', () => {
    expect(DEFAULT_RECT).toEqual({ left: 72, top: 12, width: 360, height: null });
    expect(MIN_SIZE).toEqual({ width: 300, height: 320 });
    expect(maxSizeFor(VP)).toEqual({ width: 720, height: 876 });
  });

  it('janela minúscula: o máximo nunca fica abaixo do mínimo', () => {
    expect(maxSizeFor({ width: 200, height: 200 })).toEqual({ width: 300, height: 320 });
  });
});

describe('clampRect', () => {
  const max = maxSizeFor(VP);

  it('retângulo válido passa intacto', () => {
    const r = { left: 100, top: 40, width: 400, height: 500 };
    expect(clampRect(r, VP, MIN_SIZE, max)).toEqual(r);
  });

  it('limita o tamanho a [mín, máx] e o máximo à viewport', () => {
    expect(clampRect({ left: 0, top: 0, width: 100, height: 100 }, VP, MIN_SIZE, max)).toEqual({ left: 0, top: 0, width: 300, height: 320 });
    expect(clampRect({ left: 0, top: 0, width: 2000, height: 2000 }, VP, MIN_SIZE, max)).toEqual({ left: 0, top: 0, width: 720, height: 876 });
    const small = { width: 500, height: 600 };
    expect(clampRect({ left: 0, top: 0, width: 700, height: 700 }, small, MIN_SIZE, maxSizeFor(small))).toEqual({ left: 0, top: 0, width: 500, height: 576 });
  });

  it('puxa a posição pra dentro da viewport', () => {
    expect(clampRect({ left: 1300, top: 800, width: 360, height: 400 }, VP, MIN_SIZE, max)).toEqual({ left: 1080, top: 500, width: 360, height: 400 });
    expect(clampRect({ left: -50, top: -10, width: 360, height: 400 }, VP, MIN_SIZE, max)).toEqual({ left: 0, top: 0, width: 360, height: 400 });
  });

  it('altura automática (null) continua null e o topo reserva a altura mínima', () => {
    expect(clampRect({ left: 72, top: 880, width: 360, height: null }, VP, MIN_SIZE, max)).toEqual({ left: 72, top: 580, width: 360, height: null });
  });

  it('valores ilegíveis viram o padrão', () => {
    const r = /** @type {any} */ ({ left: NaN, top: 'x', width: undefined, height: 'abc' });
    expect(clampRect(r, VP, MIN_SIZE, max)).toEqual({ left: 72, top: 12, width: 360, height: null });
    expect(clampRect(/** @type {any} */ (null), VP, MIN_SIZE, max)).toEqual(DEFAULT_RECT);
  });
});

describe('dragMove', () => {
  const start = { left: 72, top: 12, width: 360, height: 500, x: 200, y: 30 };

  it('desloca pelo movimento do ponteiro', () => {
    expect(dragMove(start, { x: 300, y: 130 }, VP)).toEqual({ left: 172, top: 112 });
  });

  it('não sai da viewport', () => {
    expect(dragMove(start, { x: -500, y: -500 }, VP)).toEqual({ left: 0, top: 0 });
    expect(dragMove(start, { x: 5000, y: 5000 }, VP)).toEqual({ left: 1080, top: 400 });
  });

  it('card maior que a viewport: fica no canto de cima/esquerda', () => {
    expect(dragMove({ ...start, width: 2000, height: 2000 }, { x: 900, y: 900 }, VP)).toEqual({ left: 0, top: 0 });
  });
});

describe('resizeTo', () => {
  const start = { left: 72, top: 12, width: 360, height: 500, x: 432, y: 512 };
  const max = maxSizeFor(VP);

  it('soma o movimento do ponteiro à largura e à altura', () => {
    expect(resizeTo(start, { x: 472, y: 612 }, VP, MIN_SIZE, max)).toEqual({ width: 400, height: 600 });
  });

  it('respeita o mínimo 300×320 e o máximo 720×(vh - 24)', () => {
    expect(resizeTo(start, { x: 0, y: 0 }, VP, MIN_SIZE, max)).toEqual({ width: 300, height: 320 });
    expect(resizeTo(start, { x: 5000, y: 5000 }, VP, MIN_SIZE, max)).toEqual({ width: 720, height: 876 });
  });

  it('não passa da borda direita/de baixo da viewport', () => {
    const near = { left: 1000, top: 500, width: 360, height: 360, x: 1360, y: 860 };
    expect(resizeTo(near, { x: 1600, y: 1000 }, VP, MIN_SIZE, max)).toEqual({ width: 440, height: 400 });
  });
});
