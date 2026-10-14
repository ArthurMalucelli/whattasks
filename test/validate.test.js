// @ts-check
import { describe, it, expect } from 'vitest';
import { validateTasks, parseTasksJson } from '../src/lib/validate.js';

/** @returns {Record<string, any>} */
function task(overrides = {}) {
  return {
    task: 'Enviar orçamento revisado',
    tipo: 'pedido_a_mim',
    quem_pediu: 'Fulano',
    prazo_iso: '2026-10-20',
    prazo_texto: 'até segunda',
    fonte: ['#3'],
    anexos: ['orcamento.pdf'],
    confianca: 'alta',
    ambiguidade: '',
    ...overrides,
  };
}

/** @returns {Record<string, any>} */
function doc(overrides = {}) {
  return {
    tasks: [task()],
    pendencias: ['Aguardar retorno do fornecedor'],
    perguntas_em_aberto: ['Quem aprova o orçamento?'],
    ...overrides,
  };
}

/** @param {any} r */
function errorsOf(r) {
  expect(r.ok).toBe(false);
  return r.errors;
}

describe('validateTasks', () => {
  it('aceita um objeto válido e devolve o próprio valor', () => {
    const v = doc();
    const r = validateTasks(v);
    expect(r).toEqual({ ok: true, value: v });
  });

  it('aceita listas vazias', () => {
    const r = validateTasks({ tasks: [], pendencias: [], perguntas_em_aberto: [] });
    expect(r.ok).toBe(true);
  });

  it('aceita todos os valores de tipo e confianca', () => {
    const tipos = ['pedido_a_mim', 'pedido_ao_grupo', 'compromisso_meu', 'dependencia'];
    const confs = ['alta', 'media', 'baixa'];
    const tasks = tipos.flatMap((tipo) => confs.map((confianca) => task({ tipo, confianca })));
    expect(validateTasks(doc({ tasks })).ok).toBe(true);
  });

  it('entrada não-objeto gera um único erro', () => {
    for (const bad of [null, undefined, 'x', 42, true, [1, 2]]) {
      const errs = errorsOf(validateTasks(bad));
      expect(errs).toHaveLength(1);
      expect(errs[0]).toBe('raiz: esperado objeto');
    }
  });

  it('acusa enum inválido em tipo com caminho JSON', () => {
    const r = validateTasks(doc({ tasks: [task(), task({ tipo: 'x' })] }));
    expect(errorsOf(r)).toEqual(['tasks[1].tipo: valor inválido "x"']);
  });

  it('acusa enum inválido em confianca', () => {
    const r = validateTasks(doc({ tasks: [task({ confianca: 'média' })] }));
    expect(errorsOf(r)).toEqual(['tasks[0].confianca: valor inválido "média"']);
  });

  it('acusa chave faltante na raiz', () => {
    const v = doc();
    delete v.pendencias;
    expect(errorsOf(validateTasks(v))).toEqual(['pendencias: chave ausente']);
  });

  it('acusa chave faltante numa task', () => {
    const t = task();
    delete t.quem_pediu;
    expect(errorsOf(validateTasks(doc({ tasks: [t] })))).toEqual(['tasks[0].quem_pediu: chave ausente']);
  });

  it('acusa chave extra na raiz', () => {
    expect(errorsOf(validateTasks(doc({ foo: 1 })))).toEqual(['raiz: chave inesperada "foo"']);
  });

  it('acusa chave extra numa task', () => {
    expect(errorsOf(validateTasks(doc({ tasks: [task({ foo: 1 })] })))).toEqual([
      'tasks[0]: chave inesperada "foo"',
    ]);
  });

  it('acusa array esperado na raiz', () => {
    expect(errorsOf(validateTasks(doc({ pendencias: 'nada' })))).toEqual(['pendencias: esperado array']);
  });

  it('acusa string esperada em item de array de strings', () => {
    expect(errorsOf(validateTasks(doc({ perguntas_em_aberto: ['ok', 3] })))).toEqual([
      'perguntas_em_aberto[1]: esperado string',
    ]);
  });

  it('acusa task que não é objeto', () => {
    expect(errorsOf(validateTasks(doc({ tasks: ['texto'] })))).toEqual(['tasks[0]: esperado objeto']);
  });

  it('acusa campo string com tipo errado', () => {
    expect(errorsOf(validateTasks(doc({ tasks: [task({ prazo_iso: null })] })))).toEqual([
      'tasks[0].prazo_iso: esperado string',
    ]);
  });

  it('acusa fonte/anexos que não são array de strings', () => {
    const r = validateTasks(doc({ tasks: [task({ fonte: 'abc', anexos: [1] })] }));
    expect(errorsOf(r)).toEqual(['tasks[0].fonte: esperado array', 'tasks[0].anexos[0]: esperado string']);
  });

  it('acusa enum com tipo não-string', () => {
    expect(errorsOf(validateTasks(doc({ tasks: [task({ tipo: 1 })] })))).toEqual([
      'tasks[0].tipo: valor inválido 1',
    ]);
  });

  it('coleta vários erros de uma vez', () => {
    const t = task({ tipo: 'x', extra: true });
    delete t.task;
    const r = validateTasks({ tasks: [t], pendencias: 5, bar: 0 });
    expect(errorsOf(r)).toEqual([
      'tasks[0].task: chave ausente',
      'tasks[0].tipo: valor inválido "x"',
      'tasks[0]: chave inesperada "extra"',
      'pendencias: esperado array',
      'perguntas_em_aberto: chave ausente',
      'raiz: chave inesperada "bar"',
    ]);
  });
});

describe('parseTasksJson', () => {
  it('faz parse de JSON puro válido', () => {
    const v = doc();
    expect(parseTasksJson(JSON.stringify(v))).toEqual({ ok: true, value: v });
  });

  it('extrai o bloco {...} quando há prosa em volta', () => {
    const v = doc();
    const text = 'Claro! Aqui está:\n```json\n' + JSON.stringify(v, null, 2) + '\n```\nQualquer coisa me avise.';
    expect(parseTasksJson(text)).toEqual({ ok: true, value: v });
  });

  it('texto inválido devolve erro "JSON inválido: <mensagem>"', () => {
    const r = parseTasksJson('não consegui gerar as tasks');
    const errs = errorsOf(r);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^JSON inválido: .+/);
  });

  it('bloco {...} malformado também devolve JSON inválido', () => {
    const errs = errorsOf(parseTasksJson('veja: {"tasks": [,]} fim'));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^JSON inválido: /);
  });

  it('JSON válido mas fora do schema devolve os erros do validador', () => {
    expect(parseTasksJson('{"tasks": [], "pendencias": []}')).toEqual({
      ok: false,
      errors: ['perguntas_em_aberto: chave ausente'],
    });
  });

  it('JSON que é array (não objeto) cai no validador', () => {
    expect(parseTasksJson('[1,2]')).toEqual({ ok: false, errors: ['raiz: esperado objeto'] });
  });
});
