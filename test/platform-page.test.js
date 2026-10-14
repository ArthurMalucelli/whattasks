// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPagePlatform, KEEPALIVE_MS } from '../src/panel/platform-page.js';
import { BG } from '../src/lib/messages.js';

/** @param {(msg: any) => any} answer */
function setup(answer) {
  /** @type {Function[]} */ const subs = [];
  const runtime = { sendMessage: vi.fn((/** @type {any} */ msg) => Promise.resolve(answer(msg))) };
  const storage = {
    get: vi.fn(() => Promise.resolve({ a: 1 })),
    set: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  };
  const selector = {
    handle: vi.fn((/** @type {string} */ name) => (name === 'PING' ? { ok: true, chatName: 'X' } : { ok: true })),
    subscribe: vi.fn((/** @type {Function} */ cb) => { subs.push(cb); return () => subs.splice(subs.indexOf(cb), 1); }),
  };
  const p = createPagePlatform({ runtime, storage, getSelector: () => selector });
  return { p, runtime, storage, selector, subs };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('platform-page: STORE pelo background', () => {
  it('manda {name: STORE, fn, args} e devolve o result do envelope', async () => {
    const { p, runtime } = setup(() => ({ ok: true, result: { ready: true } }));
    expect(await p.storeCall('storeStatus', [])).toEqual({ ready: true });
    expect(runtime.sendMessage).toHaveBeenCalledWith({ name: BG.STORE, fn: 'storeStatus', args: [] });
  });

  it('envelope de erro vira exceção com a mensagem do background', async () => {
    const { p } = setup(() => ({ ok: false, error: 'No tab with id: 7' }));
    await expect(p.storeCall('storeDiag')).rejects.toThrow('No tab with id: 7');
  });

  it('sem resposta (background sem listener) vira exceção legível', async () => {
    const { p } = setup(() => undefined);
    await expect(p.storeCall('storeStatus')).rejects.toThrow(/background/);
  });
});

describe('platform-page: FETCH pelo background', () => {
  it('repassa url/método/cabeçalhos/corpo/timeout com um id e devolve {status, json, text}', async () => {
    const { p, runtime } = setup(() => ({ ok: true, result: { status: 200, json: { a: 1 }, text: '{"a":1}' } }));
    const r = await p.httpJson({ url: 'https://openrouter.ai/x', method: 'POST', headers: { h: '1' }, body: '{}', timeoutMs: 75_000 });
    expect(r).toEqual({ status: 200, json: { a: 1 }, text: '{"a":1}' });
    const msg = runtime.sendMessage.mock.calls[0][0];
    expect(msg).toMatchObject({ name: BG.FETCH, url: 'https://openrouter.ai/x', method: 'POST', headers: { h: '1' }, body: '{}', timeoutMs: 75_000 });
    expect(typeof msg.id).toBe('string');
    expect(msg.signal).toBeUndefined();
  });

  it('status 0 com erro recria o tipo (TimeoutError/TypeError) pro classificador do openrouter.js', async () => {
    const { p } = setup(() => ({ ok: true, result: { status: 0, json: null, text: 'tempo', error: 'TimeoutError' } }));
    await expect(p.httpJson({ url: 'u', timeoutMs: 1 })).rejects.toMatchObject({ name: 'TimeoutError', message: 'tempo' });
    const s2 = setup(() => ({ ok: true, result: { status: 0, json: null, text: 'rede', error: 'TypeError' } }));
    await expect(s2.p.httpJson({ url: 'u', timeoutMs: 1 })).rejects.toBeInstanceOf(TypeError);
  });

  it('cancelar o job rejeita na hora e pede FETCH_ABORT com o mesmo id', async () => {
    /** @type {Function} */ let release = () => {};
    const { p, runtime } = setup((msg) => (msg.name === BG.FETCH ? new Promise((r) => { release = r; }) : { ok: true, result: true }));
    const ctrl = new AbortController();
    const pr = p.httpJson({ url: 'u', timeoutMs: 60_000, signal: ctrl.signal });
    ctrl.abort('cancel');
    await expect(pr).rejects.toBe('cancel');
    const id = runtime.sendMessage.mock.calls[0][0].id;
    expect(runtime.sendMessage).toHaveBeenCalledWith({ name: BG.FETCH_ABORT, id });
    release({ ok: true, result: { status: 200, json: null, text: '' } });
  });

  it('signal já abortado: nem manda o FETCH', async () => {
    const { p, runtime } = setup(() => ({ ok: true, result: {} }));
    const ctrl = new AbortController();
    ctrl.abort('chat');
    await expect(p.httpJson({ url: 'u', timeoutMs: 1, signal: ctrl.signal })).rejects.toBe('chat');
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('com fetch em andamento manda KEEPALIVE periódico; sem fetch, para', async () => {
    /** @type {Function} */ let release = () => {};
    const { p, runtime } = setup((msg) => (msg.name === BG.FETCH ? new Promise((r) => { release = r; }) : { ok: true, result: true }));
    const pr = p.httpJson({ url: 'u', timeoutMs: 300_000 });
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 2 + 10);
    const keep = () => runtime.sendMessage.mock.calls.filter((c) => c[0].name === BG.KEEPALIVE).length;
    expect(keep()).toBe(2);
    release({ ok: true, result: { status: 200, json: null, text: '' } });
    await pr;
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
    expect(keep()).toBe(2);
  });

  it('STORE pendente (ex.: storeMedia de 60 s) também manda KEEPALIVE e para quando resolve', async () => {
    /** @type {Function} */ let release = () => {};
    const { p, runtime } = setup((msg) => (msg.name === BG.STORE ? new Promise((r) => { release = r; }) : { ok: true, result: true }));
    const pr = p.storeCall('storeMedia', ['id', 'hex']);
    const keep = () => runtime.sendMessage.mock.calls.filter((c) => c[0].name === BG.KEEPALIVE).length;
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 2 + 10);
    expect(keep()).toBe(2);
    release({ ok: true, result: { ok: true } });
    expect(await pr).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
    expect(keep()).toBe(2);
  });

  it('STORE que falha também desliga o KEEPALIVE', async () => {
    /** @type {Function} */ let release = () => {};
    const { p, runtime } = setup((msg) => (msg.name === BG.STORE ? new Promise((r) => { release = r; }) : { ok: true, result: true }));
    const pr = p.storeCall('storeStatus');
    const keep = () => runtime.sendMessage.mock.calls.filter((c) => c[0].name === BG.KEEPALIVE).length;
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS + 10);
    expect(keep()).toBe(1);
    release({ ok: false, error: 'boom' });
    await expect(pr).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
    expect(keep()).toBe(1);
  });
});

describe('platform-page: resto', () => {
  it('contentSend chama o selector.js direto', async () => {
    const { p, selector } = setup(() => ({}));
    expect(await p.contentSend('PING')).toEqual({ ok: true, chatName: 'X' });
    expect(selector.handle).toHaveBeenCalledWith('PING', undefined);
  });

  it('contentSend sem o selector.js rejeita', async () => {
    const p = createPagePlatform({ runtime: { sendMessage: vi.fn() }, storage: /** @type {any} */ ({}), getSelector: () => undefined });
    await expect(p.contentSend('PING')).rejects.toThrow(/content script/);
  });

  it('onContentEvent assina o selector.js (sem tabId) e devolve o cancelamento', () => {
    const { p, subs } = setup(() => ({}));
    const cb = vi.fn();
    const off = p.onContentEvent(cb);
    subs[0]({ name: 'PICKED', payload: { id: 'a' } });
    expect(cb).toHaveBeenCalledWith({ name: 'PICKED', payload: { id: 'a' } }, undefined);
    off();
    expect(subs.length).toBe(0);
  });

  it('storage via chrome.storage.local; aba fictícia -1; origens já concedidas; janela via background', async () => {
    const { p, storage, runtime } = setup(() => ({ ok: true, result: true }));
    expect(await p.storageGet('settings')).toEqual({ a: 1 });
    await p.storageSet({ x: 1 });
    await p.storageRemove(['x']);
    expect(storage.set).toHaveBeenCalledWith({ x: 1 });
    expect(storage.remove).toHaveBeenCalledWith(['x']);
    expect(await p.findWhatsAppTab()).toEqual({ id: -1 });
    expect(await p.hasRequiredOrigins()).toBe(true);
    await p.openWindow();
    expect(runtime.sendMessage).toHaveBeenCalledWith({ name: BG.OPEN_WINDOW });
    expect(p.kind).toBe('page');
  });
});
