// @ts-check
/**
 * Pool de concorrência limitada para transcrições e downloads de mídia.
 * Nunca rejeita: cada item vira {ok:true,value} ou {ok:false,error}.
 */

/** @typedef {{ok: true, value: any} | {ok: false, error: string}} PoolResult */

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  const e = /** @type {any} */ (err);
  return String(e && e.message ? e.message : e);
}

/**
 * Executa fn(item, index, signal) sobre todos os itens com no máximo n chamadas simultâneas.
 * Itens não iniciados quando o signal aborta viram {ok:false, error:'aborted'} sem chamar fn;
 * itens em voo recebem o mesmo signal para se cancelarem.
 * @template T
 * @param {T[]} items
 * @param {number} n                 concorrência máxima (n < 1 ou inválido vira 1)
 * @param {(item: T, index: number, signal: AbortSignal | undefined) => any} fn
 * @param {AbortSignal} [signal]
 * @param {(done: number, total: number) => void} [onProgress]  chamado após cada item terminar, em ordem de conclusão
 * @returns {Promise<PoolResult[]>}   mesmo tamanho e ordem de items
 */
export async function runPool(items, n, fn, signal, onProgress) {
  const total = items.length;
  /** @type {PoolResult[]} */
  const results = new Array(total);
  let next = 0;
  let done = 0;

  /** @param {number} i */
  async function runOne(i) {
    if (signal && signal.aborted) return { ok: false, error: 'aborted' };
    try {
      return { ok: true, value: await fn(items[i], i, signal) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  async function worker() {
    while (next < total) {
      const i = next++;
      results[i] = /** @type {PoolResult} */ (await runOne(i));
      done++;
      if (onProgress) {
        try {
          onProgress(done, total);
        } catch {
          // callback de UI não pode derrubar o pool
        }
      }
    }
  }

  const width = Math.min(total, Math.max(1, Math.floor(n) || 1));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
