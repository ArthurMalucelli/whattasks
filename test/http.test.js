// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { fetchJson, timeoutSignal, errorToResponse, responseToError } from '../src/lib/http.js';

/** @param {number} status @param {string} text */
const res = (status, text) => ({ status, text: () => Promise.resolve(text) });

describe('fetchJson', () => {
  it('repassa método, cabeçalhos e corpo; devolve status, json e texto', async () => {
    const f = vi.fn(() => Promise.resolve(res(200, '{"a":1}')));
    const r = await fetchJson(/** @type {any} */ (f), { url: 'https://openrouter.ai/x', method: 'POST', headers: { a: 'b' }, body: '{}', timeoutMs: 1000 });
    expect(r).toEqual({ status: 200, json: { a: 1 }, text: '{"a":1}' });
    const [url, init] = /** @type {any} */ (f.mock.calls[0]);
    expect(url).toBe('https://openrouter.ai/x');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ a: 'b' });
    expect(init.body).toBe('{}');
    expect(init.signal).toBeDefined();
  });

  it('corpo não-JSON: json null, texto cru', async () => {
    const r = await fetchJson(/** @type {any} */ (() => Promise.resolve(res(502, 'Bad Gateway'))), { url: 'u', timeoutMs: 1000 });
    expect(r).toEqual({ status: 502, json: null, text: 'Bad Gateway' });
  });

  it('erro de rede propaga como veio (o classificador do openrouter.js depende do tipo)', async () => {
    const f = () => Promise.reject(new TypeError('NetworkError'));
    await expect(fetchJson(/** @type {any} */ (f), { url: 'u', timeoutMs: 1000 })).rejects.toBeInstanceOf(TypeError);
  });

  it('o signal do fetch aborta quando o signal do job aborta', async () => {
    const ctrl = new AbortController();
    /** @type {AbortSignal|undefined} */ let seen;
    const f = (/** @type {any} */ _u, /** @type {any} */ init) => { seen = init.signal; return new Promise(() => {}); };
    void fetchJson(/** @type {any} */ (f), { url: 'u', timeoutMs: 60_000, signal: ctrl.signal });
    ctrl.abort('cancel');
    expect(seen && seen.aborted).toBe(true);
  });
});

describe('timeoutSignal', () => {
  it('aborta com TimeoutError no prazo', async () => {
    const s = timeoutSignal(undefined, 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.aborted).toBe(true);
    expect(/** @type {any} */ (s.reason).name).toBe('TimeoutError');
  });

  it('aborta junto com o signal do job', () => {
    const ctrl = new AbortController();
    const s = timeoutSignal(ctrl.signal, 60_000);
    expect(s.aborted).toBe(false);
    ctrl.abort('chat');
    expect(s.aborted).toBe(true);
  });
});

describe('erro ⇄ resposta (fetch feito pelo background)', () => {
  it('errorToResponse guarda mensagem e tipo', () => {
    expect(errorToResponse(new TypeError('sem rede'))).toEqual({ status: 0, json: null, text: 'sem rede', error: 'TypeError' });
    const t = new Error('signal timed out');
    t.name = 'TimeoutError';
    expect(errorToResponse(t)).toEqual({ status: 0, json: null, text: 'signal timed out', error: 'TimeoutError' });
    expect(errorToResponse('x')).toEqual({ status: 0, json: null, text: 'x', error: 'Error' });
  });

  it('responseToError recria o tipo', () => {
    expect(responseToError({ status: 0, text: 'sem rede', error: 'TypeError' })).toBeInstanceOf(TypeError);
    const e = responseToError({ status: 0, text: 'tempo', error: 'TimeoutError' });
    expect(e.name).toBe('TimeoutError');
    expect(e.message).toBe('tempo');
    expect(responseToError({ status: 0, text: 'z' }).name).toBe('Error');
  });
});
