// @ts-check
import { describe, it, expect, vi } from 'vitest';
import { route, isAllowedFetchUrl, actionPlan } from '../src/lib/bgRouter.js';
import { BG, MSG } from '../src/lib/messages.js';

const WA = { tab: { id: 7, url: 'https://web.whatsapp.com/' } };

function deps() {
  const storeStatus = () => ({ ready: true });
  const storeMedia = () => ({ ok: true });
  return {
    storeFns: { storeStatus, storeMedia },
    executeScript: vi.fn((/** @type {any} */ _o) => Promise.resolve([{ result: { ready: true } }])),
    fetch: vi.fn((/** @type {any} */ _u, /** @type {any} */ _i) => Promise.resolve({ status: 200, text: () => Promise.resolve('{"ok":1}') })),
    openWindow: vi.fn(() => Promise.resolve()),
    /** @type {Map<string, AbortController>} */ inflight: new Map(),
  };
}

describe('route: STORE', () => {
  it('roda a função pedida no MAIN world da aba que pediu e devolve o resultado', async () => {
    const d = deps();
    const r = await route({ name: BG.STORE, fn: 'storeStatus', args: [] }, WA, /** @type {any} */ (d));
    expect(r).toEqual({ ready: true });
    const opts = d.executeScript.mock.calls[0][0];
    expect(opts.target).toEqual({ tabId: 7 });
    expect(opts.world).toBe('MAIN');
    expect(opts.func).toBe(d.storeFns.storeStatus);
    expect(opts.args).toEqual([]);
  });

  it('repassa os argumentos (array) e devolve undefined quando o script não retorna nada', async () => {
    const d = deps();
    d.executeScript.mockImplementation(() => Promise.resolve(/** @type {any} */ ([])));
    const r = await route({ name: BG.STORE, fn: 'storeMedia', args: ['id1', 'ab'] }, WA, /** @type {any} */ (d));
    expect(r).toBe(undefined);
    expect(d.executeScript.mock.calls[0][0].args).toEqual(['id1', 'ab']);
  });

  it('nome de função desconhecido (ou herdado do Object) é recusado', async () => {
    const d = deps();
    await expect(route({ name: BG.STORE, fn: 'eval', args: [] }, WA, /** @type {any} */ (d))).rejects.toThrow(/função desconhecida/);
    await expect(route({ name: BG.STORE, fn: 'toString', args: [] }, WA, /** @type {any} */ (d))).rejects.toThrow(/função desconhecida/);
    expect(d.executeScript).not.toHaveBeenCalled();
  });

  it('sem aba (ex.: mensagem de página da extensão) ou aba fora do WhatsApp: recusado', async () => {
    const d = deps();
    await expect(route({ name: BG.STORE, fn: 'storeStatus' }, {}, /** @type {any} */ (d))).rejects.toThrow(/aba/);
    await expect(route({ name: BG.STORE, fn: 'storeStatus' }, { tab: { id: 3, url: 'https://evil.example/' } }, /** @type {any} */ (d))).rejects.toThrow(/WhatsApp/);
  });

  it('args que não é array vira []', async () => {
    const d = deps();
    await route({ name: BG.STORE, fn: 'storeStatus', args: 'x' }, WA, /** @type {any} */ (d));
    expect(d.executeScript.mock.calls[0][0].args).toEqual([]);
  });
});

describe('route: FETCH', () => {
  it('faz o fetch e devolve {status, json, text}', async () => {
    const d = deps();
    const r = await route({ name: BG.FETCH, url: 'https://openrouter.ai/api/v1/chat/completions', method: 'POST', headers: { a: 'b' }, body: '{}', timeoutMs: 1000 }, WA, /** @type {any} */ (d));
    expect(r).toEqual({ status: 200, json: { ok: 1 }, text: '{"ok":1}' });
    const [url, init] = d.fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(init.signal).toBeDefined();
  });

  it('erro de rede vira {status: 0, text, error}', async () => {
    const d = deps();
    d.fetch.mockImplementation(() => Promise.reject(new TypeError('NetworkError when attempting to fetch resource.')));
    const r = await route({ name: BG.FETCH, url: 'https://openrouter.ai/x', timeoutMs: 1000 }, WA, /** @type {any} */ (d));
    expect(r).toEqual({ status: 0, json: null, text: 'NetworkError when attempting to fetch resource.', error: 'TypeError' });
  });

  it('URL fora do OpenRouter é recusada sem fetch', async () => {
    const d = deps();
    await expect(route({ name: BG.FETCH, url: 'https://evil.example/x', timeoutMs: 1000 }, WA, /** @type {any} */ (d))).rejects.toThrow(/não permitida/);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('FETCH_ABORT com o id aborta o fetch em andamento', async () => {
    const d = deps();
    /** @type {AbortSignal|undefined} */ let sig;
    d.fetch.mockImplementation((/** @type {any} */ _u, /** @type {any} */ init) => {
      sig = init.signal;
      return new Promise((_res, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
    });
    const p = route({ name: BG.FETCH, url: 'https://openrouter.ai/x', timeoutMs: 60_000, id: 'r1' }, WA, /** @type {any} */ (d));
    expect(d.inflight.has('r1')).toBe(true);
    expect(await route({ name: BG.FETCH_ABORT, id: 'r1' }, WA, /** @type {any} */ (d))).toBe(true);
    expect(sig && sig.aborted).toBe(true);
    expect(await p).toMatchObject({ status: 0, error: 'AbortError' });
    expect(d.inflight.has('r1')).toBe(false);
  });

  it('FETCH_ABORT de id desconhecido não quebra', async () => {
    expect(await route({ name: BG.FETCH_ABORT, id: 'nada' }, WA, /** @type {any} */ (deps()))).toBe(false);
  });
});

describe('isAllowedFetchUrl', () => {
  it('só https://openrouter.ai/…', () => {
    expect(isAllowedFetchUrl('https://openrouter.ai/api/v1/audio/transcriptions')).toBe(true);
    expect(isAllowedFetchUrl('http://openrouter.ai/api')).toBe(false);
    expect(isAllowedFetchUrl('https://openrouter.ai.evil.com/api')).toBe(false);
    expect(isAllowedFetchUrl('https://evil.com/https://openrouter.ai/')).toBe(false);
    expect(isAllowedFetchUrl('https://user@openrouter.ai/')).toBe(false);
    expect(isAllowedFetchUrl('https://openrouter.ai:8443/')).toBe(false);
    expect(isAllowedFetchUrl('nada')).toBe(false);
    expect(isAllowedFetchUrl(/** @type {any} */ (42))).toBe(false);
  });
});

describe('route: outras', () => {
  it('OPEN_WINDOW abre a janela do painel', async () => {
    const d = deps();
    expect(await route({ name: BG.OPEN_WINDOW }, WA, /** @type {any} */ (d))).toBe(true);
    expect(d.openWindow).toHaveBeenCalled();
  });

  it('KEEPALIVE responde true (só mantém o background acordado)', async () => {
    expect(await route({ name: BG.KEEPALIVE }, WA, /** @type {any} */ (deps()))).toBe(true);
  });

  it('nomes que não são do background (eventos do content script, lixo) → undefined', () => {
    const d = /** @type {any} */ (deps());
    expect(route({ name: MSG.PICKED, payload: {} }, WA, d)).toBe(undefined);
    expect(route({ name: 'TOGGLE_PANEL' }, WA, d)).toBe(undefined);
    expect(route(null, WA, d)).toBe(undefined);
    expect(route({ name: 5 }, WA, d)).toBe(undefined);
  });
});

describe('actionPlan (clique no ícone da barra)', () => {
  it('aba do WhatsApp Web: alterna o card dentro da página', () => {
    expect(actionPlan({ id: 1, url: 'https://web.whatsapp.com/' }, { sidebar: true })).toBe('overlay');
  });
  it('fora do WhatsApp: sidebar quando existe, senão abre o WhatsApp', () => {
    expect(actionPlan({ id: 1, url: 'https://example.com/' }, { sidebar: true })).toBe('sidebar');
    expect(actionPlan({ id: 1, url: 'https://example.com/' }, { sidebar: false })).toBe('open-wa');
    expect(actionPlan({ id: 1 }, { sidebar: false })).toBe('open-wa');
    expect(actionPlan(undefined, { sidebar: true })).toBe('sidebar');
  });
});
