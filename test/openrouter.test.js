// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { transcribe, complete } from '../src/panel/openrouter.js';

/** @param {any} json @param {number} [status] */
const ok = (json, status = 200) => Promise.resolve({ status, json, text: JSON.stringify(json) });
/** @param {string} name @param {string} [msg] */
function named(name, msg = name) { const e = new Error(msg); e.name = name; return e; }

describe('openrouter.js com http injetado (fetch direto ou via background)', () => {
  it('transcribe manda POST pro STT com timeout de 75 s e lê o texto', async () => {
    const http = vi.fn(() => ok({ text: 'oi', usage: { cost: 0.01 } }));
    const r = await transcribe({ apiKey: 'k', model: 'm', base64: 'AAA', format: 'ogg', http });
    const req = /** @type {any} */ (http.mock.calls[0])[0];
    expect(req.method).toBe('POST');
    expect(req.timeoutMs).toBe(75_000);
    expect(req.headers.Authorization).toBe('Bearer k');
    expect(typeof req.body).toBe('string');
    expect(r.ok).toBe(true);
  });

  it('TimeoutError vira "tempo esgotado"; TypeError vira falha de rede', async () => {
    const t = await transcribe({ apiKey: 'k', model: 'm', base64: 'A', format: 'ogg', http: () => Promise.reject(named('TimeoutError')) });
    expect(t).toMatchObject({ ok: false, kind: 'timeout', error: 'tempo esgotado (75 s) esperando o OpenRouter' });
    const n = await transcribe({ apiKey: 'k', model: 'm', base64: 'A', format: 'ogg', http: () => Promise.reject(new TypeError('x')) });
    expect(n).toMatchObject({ ok: false, kind: 'network', error: 'falha de rede: sem conexão com o OpenRouter' });
  });

  it('job cancelado vira "cancelado"', async () => {
    const ctrl = new AbortController();
    ctrl.abort('cancel');
    const r = await transcribe({ apiKey: 'k', model: 'm', base64: 'A', format: 'ogg', signal: ctrl.signal, http: () => Promise.reject('cancel') });
    expect(r).toMatchObject({ ok: false, kind: 'abort', error: 'cancelado' });
  });

  it('complete usa timeout de 300 s e passa o signal do job', async () => {
    const http = vi.fn(() => ok({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: { cost: 0.02 } }));
    const ctrl = new AbortController();
    const r = await complete({ apiKey: 'k', body: { a: 1 }, signal: ctrl.signal, http });
    const req = /** @type {any} */ (http.mock.calls[0])[0];
    expect(req.timeoutMs).toBe(300_000);
    expect(req.signal).toBe(ctrl.signal);
    expect(req.body).toBe('{"a":1}');
    expect(r.ok).toBe(true);
  });
});
