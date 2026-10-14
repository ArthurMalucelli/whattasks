// @ts-check
import { describe, it, expect } from 'vitest';
import { runPool } from '../src/lib/pool.js';

/** Promise controlável manualmente. */
function deferred() {
  /** @type {(v?: any) => void} */ let resolve = () => {};
  /** @type {(e?: any) => void} */ let reject = () => {};
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Deixa a fila de microtasks drenar. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runPool', () => {
  it('itens vazios resolvem para []', async () => {
    const res = await runPool([], 3, async () => 1);
    expect(res).toEqual([]);
  });

  it('preserva a ordem mesmo quando itens posteriores terminam antes', async () => {
    const ds = [deferred(), deferred(), deferred()];
    const p = runPool(['a', 'b', 'c'], 3, (item, i) => ds[i].promise.then(() => item.toUpperCase()));
    await flush();
    ds[2].resolve();
    await flush();
    ds[1].resolve();
    await flush();
    ds[0].resolve();
    const res = await p;
    expect(res).toEqual([
      { ok: true, value: 'A' },
      { ok: true, value: 'B' },
      { ok: true, value: 'C' },
    ]);
  });

  it('nunca passa de n chamadas concorrentes', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const res = await runPool(items, 3, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, (x % 3) + 1));
      inFlight--;
      return x * 2;
    });
    expect(maxInFlight).toBe(3);
    expect(res.map((r) => (r.ok ? r.value : null))).toEqual(items.map((x) => x * 2));
  });

  it('n maior que o número de itens roda todos de uma vez', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const res = await runPool([1, 2], 10, async (x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      return x;
    });
    expect(maxInFlight).toBe(2);
    expect(res).toEqual([{ ok: true, value: 1 }, { ok: true, value: 2 }]);
  });

  it('n < 1 é tratado como 1', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = async (/** @type {number} */ x) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      return x;
    };
    const res = await runPool([1, 2, 3], 0, fn);
    expect(maxInFlight).toBe(1);
    expect(res).toHaveLength(3);
    expect(res.every((r) => r.ok)).toBe(true);
  });

  it('uma rejeição não interrompe os demais itens', async () => {
    const res = await runPool([1, 2, 3], 1, async (x) => {
      if (x === 2) throw new Error('falhou');
      return x;
    });
    expect(res).toEqual([
      { ok: true, value: 1 },
      { ok: false, error: 'falhou' },
      { ok: true, value: 3 },
    ]);
  });

  it('erro lançado de forma síncrona vira {ok:false}', async () => {
    const res = await runPool([1, 2], 2, (x) => {
      if (x === 1) throw new Error('sync');
      return Promise.resolve(x);
    });
    expect(res).toEqual([{ ok: false, error: 'sync' }, { ok: true, value: 2 }]);
  });

  it('rejeição com valor que não é Error usa String(valor)', async () => {
    const res = await runPool([1], 1, () => Promise.reject('texto cru'));
    expect(res).toEqual([{ ok: false, error: 'texto cru' }]);
  });

  it('signal já abortado antes de começar: nenhum fn chamado, todos aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let calls = 0;
    const res = await runPool([1, 2, 3], 2, async (x) => { calls++; return x; }, ctrl.signal);
    expect(calls).toBe(0);
    expect(res).toEqual([
      { ok: false, error: 'aborted' },
      { ok: false, error: 'aborted' },
      { ok: false, error: 'aborted' },
    ]);
  });

  it('abort no meio: itens não iniciados viram aborted sem chamar fn', async () => {
    const ctrl = new AbortController();
    const ds = [deferred(), deferred(), deferred(), deferred()];
    /** @type {number[]} */
    const started = [];
    const p = runPool([0, 1, 2, 3], 2, (x) => {
      started.push(x);
      return ds[x].promise.then(() => x);
    }, ctrl.signal);
    await flush();
    expect(started).toEqual([0, 1]);
    ctrl.abort();
    ds[0].resolve();
    ds[1].resolve();
    const res = await p;
    expect(started).toEqual([0, 1]);
    expect(res).toEqual([
      { ok: true, value: 0 },
      { ok: true, value: 1 },
      { ok: false, error: 'aborted' },
      { ok: false, error: 'aborted' },
    ]);
  });

  it('itens em voo recebem o mesmo signal como 3º argumento', async () => {
    const ctrl = new AbortController();
    /** @type {(AbortSignal|undefined)[]} */
    const seen = [];
    await runPool(['a', 'b'], 2, async (_item, _i, sig) => { seen.push(sig); }, ctrl.signal);
    expect(seen).toEqual([ctrl.signal, ctrl.signal]);
  });

  it('fn que se cancela pelo signal vira {ok:false} e runPool não rejeita', async () => {
    const ctrl = new AbortController();
    const p = runPool([1], 1, (_x, _i, sig) => new Promise((_res, rej) => {
      sig?.addEventListener('abort', () => rej(new Error('cancelado pelo fn')));
    }), ctrl.signal);
    await flush();
    ctrl.abort();
    await expect(p).resolves.toEqual([{ ok: false, error: 'cancelado pelo fn' }]);
  });

  it('onProgress é chamado total vezes com done crescente, inclusive em falhas', async () => {
    /** @type {Array<[number, number]>} */
    const calls = [];
    await runPool([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('x');
      return x;
    }, undefined, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('onProgress é chamado logo após cada item terminar, em ordem de conclusão', async () => {
    const ds = [deferred(), deferred()];
    /** @type {string[]} */
    const log = [];
    const p = runPool([0, 1], 2, (x) => ds[x].promise.then(() => { log.push(`fim:${x}`); return x; }),
      undefined, (done) => { log.push(`progresso:${done}`); });
    await flush();
    ds[1].resolve();
    await flush();
    ds[0].resolve();
    await p;
    expect(log).toEqual(['fim:1', 'progresso:1', 'fim:0', 'progresso:2']);
  });

  it('onProgress também conta itens abortados', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    /** @type {number[]} */
    const dones = [];
    await runPool([1, 2], 1, async (x) => x, ctrl.signal, (done) => dones.push(done));
    expect(dones).toEqual([1, 2]);
  });

  it('onProgress que lança não faz runPool rejeitar', async () => {
    const res = await runPool([1, 2], 1, async (x) => x, undefined, () => { throw new Error('ui quebrou'); });
    expect(res).toEqual([{ ok: true, value: 1 }, { ok: true, value: 2 }]);
  });
});
