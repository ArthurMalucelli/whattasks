// @ts-check
/**
 * Renderização do resultado em Markdown e nome do arquivo de download.
 * Datas são formatadas no fuso local do navegador.
 */

/** @typedef {import('./validate.js').Task} Task */
/** @typedef {import('./validate.js').TaskTipo} TaskTipo */
/** @typedef {import('./validate.js').TasksData} TasksData */

/**
 * @typedef {Object} FilenameMeta
 * @property {string} chatName
 * @property {Date} date
 * @property {'tasks'|'brief'|'resumo'} mode
 */

/**
 * @typedef {Object} TasksMeta
 * @property {string} chatName
 * @property {number} count         número de mensagens no trecho
 * @property {Date} from
 * @property {Date} to
 * @property {Date} generatedAt
 */

const SLUG_MAX = 40;

/**
 * Slug ASCII minúsculo pra nome de arquivo: sem acentos, separadores viram '-', até 40 chars.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'chat';
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/** @param {Date} d  'yyyy-mm-dd' local */
function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** @param {Date} d  'dd/mm/yyyy HH:MM' local */
function brDateTime(d) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * @param {FilenameMeta} meta
 * @returns {string}
 */
export function mdFilename(meta) {
  return `whattasks_${slugify(meta.chatName)}_${isoDate(meta.date)}_${meta.mode}.md`;
}

/**
 * Junta numa linha só: cada sequência de espaços que contém quebra de linha (\n, \r\n ou \r) vira um espaço.
 * Strings vindas do modelo podem trazer quebras que desmontariam a lista Markdown.
 * @param {string} s
 * @returns {string}
 */
const oneLine = (s) => s.replace(/\s*[\r\n]\s*/g, ' ');

/** @type {Record<TaskTipo, string>} */
const TIPO_HUMANO = {
  pedido_a_mim: 'pedido a mim',
  pedido_ao_grupo: 'pedido ao grupo',
  compromisso_meu: 'compromisso meu',
  dependencia: 'dependência',
};

/** Valor do schema → texto em pt-BR (o schema não aceita acento no enum). */
const CONFIANCA_HUMANA = { alta: 'alta', media: 'média', baixa: 'baixa' };

/** @param {Task} t */
function prazo(t) {
  if (!t.prazo_iso) return 'sem prazo';
  return t.prazo_texto ? `${t.prazo_iso} (${t.prazo_texto})` : t.prazo_iso;
}

/** @param {Task} t @returns {string[]} */
function taskLines(t) {
  const fields = [
    `tipo: ${TIPO_HUMANO[t.tipo]}`,
    t.tipo === 'compromisso_meu' ? 'assumido por mim' : `quem pediu: ${t.quem_pediu}`,
    `prazo: ${prazo(t)}`,
    `fonte: ${t.fonte.length > 4 ? `${t.fonte.slice(0, 4).join(', ')} e mais ${t.fonte.length - 4}` : t.fonte.join(', ')}`,
  ];
  if (t.anexos.length) fields.push(`anexos: ${t.anexos.join(', ')}`);
  fields.push(`confiança: ${CONFIANCA_HUMANA[t.confianca] || t.confianca}`);
  const lines = [`- [ ] ${oneLine(t.task)}`, `  - ${oneLine(fields.join(' · '))}`];
  if (t.ambiguidade) lines.push(`  - ambiguidade: ${oneLine(t.ambiguidade)}`);
  return lines;
}

/** @param {string[]} items */
function bulletList(items) {
  return items.length ? items.map((i) => `- ${oneLine(i)}`) : ['- (nenhuma)'];
}

/**
 * Markdown do checklist de tasks (dados já validados por validateTasks).
 * @param {TasksData} data
 * @param {TasksMeta} meta
 * @returns {string}
 */
export function tasksToMarkdown(data, meta) {
  const header = [
    `# Tasks · ${oneLine(meta.chatName)}`,
    `_${meta.count} mensagens · ${brDateTime(meta.from)} → ${brDateTime(meta.to)} · gerado em ${brDateTime(meta.generatedAt)}_`,
  ];
  const taskBlocks = data.tasks.length ? data.tasks.map((t) => taskLines(t).join('\n')) : ['- (nenhuma task)'];
  const sections = [
    header.join('\n'),
    ...taskBlocks,
    ['## Pendências', ...bulletList(data.pendencias)].join('\n'),
    ['## Perguntas em aberto', ...bulletList(data.perguntas_em_aberto)].join('\n'),
  ];
  return sections.join('\n\n') + '\n';
}
