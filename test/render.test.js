// @ts-check
import { describe, it, expect } from 'vitest';
import { slugify, mdFilename, tasksToMarkdown } from '../src/lib/render.js';

/** @typedef {import('../src/lib/validate.js').Task} Task */
/** @typedef {import('../src/lib/validate.js').TasksData} TasksData */

/** @param {Partial<Task>} [overrides] @returns {Task} */
function task(overrides = {}) {
  return {
    task: 'Enviar orçamento revisado',
    tipo: 'pedido_a_mim',
    quem_pediu: 'Fulano',
    prazo_iso: '2026-10-20',
    prazo_texto: 'até segunda',
    fonte: ['#3', '#7'],
    anexos: ['orcamento.pdf', 'planta.jpg'],
    confianca: 'alta',
    ambiguidade: '',
    ...overrides,
  };
}

/** @param {Partial<TasksData>} [overrides] @returns {TasksData} */
function data(overrides = {}) {
  return { tasks: [task()], pendencias: ['Aguardar fornecedor'], perguntas_em_aberto: ['Quem aprova?'], ...overrides };
}

// Datas locais: o render formata no fuso local, então os testes constroem no fuso local.
const meta = {
  chatName: 'Obra Rua das Flores — Bloco B',
  count: 42,
  from: new Date(2026, 9, 1, 8, 5),
  to: new Date(2026, 9, 14, 21, 30),
  generatedAt: new Date(2026, 9, 14, 22, 0),
};

/** @param {Task} t */
function taskBlock(t) {
  const md = tasksToMarkdown(data({ tasks: [t] }), meta);
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('- [ ] '));
  const end = lines.indexOf('## Pendências');
  return lines.slice(start, end).filter((l) => l !== '');
}

describe('slugify', () => {
  it('remove acentos e troca separadores por hífen', () => {
    expect(slugify('Obra Rua das Flores — Bloco B')).toBe('obra-rua-das-flores-bloco-b');
  });

  it('converte cedilha e acentos variados', () => {
    expect(slugify('Ação Ênfase Já')).toBe('acao-enfase-ja');
  });

  it('remove hífens nas pontas', () => {
    expect(slugify('  🔥 Família!! ')).toBe('familia');
  });

  it('trunca nomes longos em 40 caracteres', () => {
    const s = slugify('a'.repeat(60));
    expect(s).toBe('a'.repeat(40));
  });

  it('não deixa hífen pendurado depois de truncar', () => {
    const s = slugify('a'.repeat(39) + ' bcd');
    expect(s).toBe('a'.repeat(39));
  });

  it('nome vazio vira "chat"', () => {
    expect(slugify('')).toBe('chat');
  });

  it('nome só com símbolos vira "chat"', () => {
    expect(slugify('🎉🎉 —')).toBe('chat');
  });
});

describe('mdFilename', () => {
  it('monta nome com slug, data local e modo tasks', () => {
    expect(mdFilename({ chatName: 'Obra Rua das Flores — Bloco B', date: new Date(2026, 9, 4, 23, 59), mode: 'tasks' })).toBe(
      'whattasks_obra-rua-das-flores-bloco-b_2026-10-04_tasks.md',
    );
  });

  it('usa o modo brief e "chat" pra nome vazio', () => {
    expect(mdFilename({ chatName: '', date: new Date(2026, 0, 2), mode: 'brief' })).toBe(
      'whattasks_chat_2026-01-02_brief.md',
    );
  });
});

describe('tasksToMarkdown', () => {
  it('renderiza o documento completo no formato exato', () => {
    const md = tasksToMarkdown(
      data({
        tasks: [
          task({ ambiguidade: 'não ficou claro se é a versão final' }),
          task({
            task: 'Confirmar visita técnica',
            tipo: 'compromisso_meu',
            quem_pediu: 'Eu',
            prazo_iso: '',
            prazo_texto: '',
            fonte: ['#12'],
            anexos: [],
            confianca: 'media',
          }),
        ],
      }),
      meta,
    );
    expect(md).toBe(
      [
        '# Tasks · Obra Rua das Flores — Bloco B',
        '_42 mensagens · 01/10/2026 08:05 → 14/10/2026 21:30 · gerado em 14/10/2026 22:00_',
        '',
        '- [ ] Enviar orçamento revisado',
        '  - tipo: pedido a mim · quem pediu: Fulano · prazo: 2026-10-20 (até segunda) · fonte: #3, #7 · anexos: orcamento.pdf, planta.jpg · confiança: alta',
        '  - ambiguidade: não ficou claro se é a versão final',
        '',
        '- [ ] Confirmar visita técnica',
        '  - tipo: compromisso meu · assumido por mim · prazo: sem prazo · fonte: #12 · confiança: média',
        '',
        '## Pendências',
        '- Aguardar fornecedor',
        '',
        '## Perguntas em aberto',
        '- Quem aprova?',
        '',
      ].join('\n'),
    );
  });

  it('termina com exatamente uma quebra de linha', () => {
    const md = tasksToMarkdown(data(), meta);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('mapeia tipo pedido_ao_grupo pra texto humano', () => {
    expect(taskBlock(task({ tipo: 'pedido_ao_grupo' }))[1]).toContain('tipo: pedido ao grupo ·');
  });

  it('mapeia tipo dependencia pra "dependência"', () => {
    expect(taskBlock(task({ tipo: 'dependencia' }))[1]).toContain('tipo: dependência ·');
  });

  it('prazo só com iso mostra só o iso', () => {
    expect(taskBlock(task({ prazo_texto: '' }))[1]).toContain('· prazo: 2026-10-20 ·');
  });

  it('prazo_iso vazio mostra "sem prazo" mesmo com prazo_texto', () => {
    expect(taskBlock(task({ prazo_iso: '', prazo_texto: 'semana que vem' }))[1]).toContain('· prazo: sem prazo ·');
  });

  it('omite o segmento anexos quando vazio', () => {
    const line = taskBlock(task({ anexos: [] }))[1];
    expect(line).not.toContain('anexos:');
    expect(line).toContain('· fonte: #3, #7 · confiança: alta');
  });

  it('omite a linha de ambiguidade quando vazia', () => {
    expect(taskBlock(task({ ambiguidade: '' }))).toHaveLength(2);
  });

  it('lista de tasks vazia vira "- (nenhuma task)"', () => {
    const md = tasksToMarkdown(data({ tasks: [] }), meta);
    expect(md).toContain('_\n\n- (nenhuma task)\n\n## Pendências\n');
  });

  it('pendências e perguntas vazias viram "- (nenhuma)"', () => {
    const md = tasksToMarkdown(data({ pendencias: [], perguntas_em_aberto: [] }), meta);
    expect(md).toContain('## Pendências\n- (nenhuma)\n\n## Perguntas em aberto\n- (nenhuma)\n');
    expect(md.endsWith('## Perguntas em aberto\n- (nenhuma)\n')).toBe(true);
  });

  it('quebra de linha dentro de campos da task vira um espaço (lista não quebra)', () => {
    const lines = taskBlock(
      task({
        task: 'Enviar orçamento\n  revisado',
        quem_pediu: 'Fulano\nde Tal',
        prazo_texto: 'até\nsegunda',
        anexos: ['orc\n.pdf'],
        ambiguidade: 'versão\n\nfinal?',
      }),
    );
    expect(lines).toEqual([
      '- [ ] Enviar orçamento revisado',
      '  - tipo: pedido a mim · quem pediu: Fulano de Tal · prazo: 2026-10-20 (até segunda) · fonte: #3, #7 · anexos: orc .pdf · confiança: alta',
      '  - ambiguidade: versão final?',
    ]);
  });

  it('\\r\\n em pendências, perguntas e no nome do chat vira um espaço', () => {
    const md = tasksToMarkdown(
      data({ pendencias: ['Aguardar\r\nfornecedor', 'ok'], perguntas_em_aberto: ['Quem \r\n\r\n aprova?\rhoje'] }),
      { ...meta, chatName: 'Obra\r\nRua das Flores' },
    );
    expect(md.startsWith('# Tasks · Obra Rua das Flores\n')).toBe(true);
    expect(md).toContain('## Pendências\n- Aguardar fornecedor\n- ok\n\n## Perguntas em aberto\n- Quem aprova? hoje\n');
    expect(md).not.toContain('\r');
  });

  it('mantém espaços e tabs que não envolvem quebra de linha', () => {
    expect(taskBlock(task({ task: 'a  b\tc' }))[0]).toBe('- [ ] a  b\tc');
  });

  it('documento todo vazio segue o formato', () => {
    const md = tasksToMarkdown({ tasks: [], pendencias: [], perguntas_em_aberto: [] }, { ...meta, count: 0 });
    expect(md).toBe(
      [
        '# Tasks · Obra Rua das Flores — Bloco B',
        '_0 mensagens · 01/10/2026 08:05 → 14/10/2026 21:30 · gerado em 14/10/2026 22:00_',
        '',
        '- (nenhuma task)',
        '',
        '## Pendências',
        '- (nenhuma)',
        '',
        '## Perguntas em aberto',
        '- (nenhuma)',
        '',
      ].join('\n'),
    );
  });
});

describe('tasksToMarkdown: ajustes pós-primeiro-uso real', () => {
  const base = { task: 'x', tipo: 'compromisso_meu', quem_pediu: 'Ana', prazo_iso: '', prazo_texto: '', fonte: ['#1', '#2', '#3', '#4', '#5', '#6'], anexos: [], confianca: 'alta', ambiguidade: '' };
  const meta = { chatName: 'C', count: 1, from: new Date(2026, 9, 14, 14, 26), to: new Date(2026, 9, 14, 14, 28), generatedAt: new Date(2026, 9, 14, 14, 47) };
  it('compromisso meu mostra "assumido por mim" em vez de "quem pediu: Ana"', async () => {
    const { tasksToMarkdown } = await import('../src/lib/render.js');
    const md = tasksToMarkdown(/** @type {any} */ ({ tasks: [base], pendencias: [], perguntas_em_aberto: [] }), meta);
    expect(md).toContain('tipo: compromisso meu · assumido por mim ·');
    expect(md).not.toContain('quem pediu: Ana');
  });
  it('fonte com mais de 4 mensagens mostra as 4 primeiras e "e mais N"', async () => {
    const { tasksToMarkdown } = await import('../src/lib/render.js');
    const md = tasksToMarkdown(/** @type {any} */ ({ tasks: [{ ...base, tipo: 'pedido_a_mim', quem_pediu: 'Pedro' }], pendencias: [], perguntas_em_aberto: [] }), meta);
    expect(md).toContain('fonte: #1, #2, #3, #4 e mais 2');
    expect(md).toContain('quem pediu: Pedro');
  });
});
