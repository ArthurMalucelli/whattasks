// @ts-check
/**
 * Validador escrito à mão do JSON de tasks devolvido pelo modelo.
 * Sem ajv/zod: a CSP da extensão proíbe `new Function`.
 */

/** @typedef {'pedido_a_mim'|'pedido_ao_grupo'|'compromisso_meu'|'dependencia'} TaskTipo */
/** @typedef {'alta'|'media'|'baixa'} Confianca */

/**
 * @typedef {Object} Task
 * @property {string} task
 * @property {TaskTipo} tipo
 * @property {string} quem_pediu
 * @property {string} prazo_iso      'YYYY-MM-DD' ou '' quando sem prazo
 * @property {string} prazo_texto
 * @property {string[]} fonte        rótulos "#n" das mensagens de origem (como pedido em prompts.js)
 * @property {string[]} anexos
 * @property {Confianca} confianca
 * @property {string} ambiguidade
 */

/**
 * @typedef {Object} TasksData
 * @property {Task[]} tasks
 * @property {string[]} pendencias
 * @property {string[]} perguntas_em_aberto
 */

/** @typedef {{ok: true, value: TasksData} | {ok: false, errors: string[]}} ValidationResult */

/** @typedef {(v: unknown, path: string, errors: string[]) => void} Check */

/** @type {Check} */
function str(v, path, errors) {
  if (typeof v !== 'string') errors.push(`${path}: esperado string`);
}

/** @type {Check} */
function strArray(v, path, errors) {
  if (!Array.isArray(v)) {
    errors.push(`${path}: esperado array`);
    return;
  }
  v.forEach((item, i) => str(item, `${path}[${i}]`, errors));
}

/**
 * @param {readonly string[]} allowed
 * @returns {Check}
 */
function oneOf(allowed) {
  return (v, path, errors) => {
    if (typeof v !== 'string' || !allowed.includes(v)) {
      errors.push(`${path}: valor inválido ${JSON.stringify(v)}`);
    }
  };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Checa um objeto contra um schema {chave: Check}: chaves ausentes, valores e chaves extras.
 * @param {Record<string, unknown>} obj
 * @param {Record<string, Check>} schema
 * @param {string} prefix     '' na raiz; 'tasks[0]' etc.
 * @param {string[]} errors
 */
function checkObject(obj, schema, prefix, errors) {
  const at = (/** @type {string} */ key) => (prefix ? `${prefix}.${key}` : key);
  for (const [key, check] of Object.entries(schema)) {
    if (!Object.hasOwn(obj, key)) errors.push(`${at(key)}: chave ausente`);
    else check(obj[key], at(key), errors);
  }
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(schema, key)) errors.push(`${prefix || 'raiz'}: chave inesperada "${key}"`);
  }
}

/** @type {Record<string, Check>} */
const TASK_SCHEMA = {
  task: str,
  tipo: oneOf(['pedido_a_mim', 'pedido_ao_grupo', 'compromisso_meu', 'dependencia']),
  quem_pediu: str,
  prazo_iso: str,
  prazo_texto: str,
  fonte: strArray,
  anexos: strArray,
  confianca: oneOf(['alta', 'media', 'baixa']),
  ambiguidade: str,
};

/** @type {Check} */
function taskList(v, path, errors) {
  if (!Array.isArray(v)) {
    errors.push(`${path}: esperado array`);
    return;
  }
  v.forEach((item, i) => {
    const p = `${path}[${i}]`;
    if (isPlainObject(item)) checkObject(item, TASK_SCHEMA, p, errors);
    else errors.push(`${p}: esperado objeto`);
  });
}

/** @type {Record<string, Check>} */
const ROOT_SCHEMA = {
  tasks: taskList,
  pendencias: strArray,
  perguntas_em_aberto: strArray,
};

/**
 * Valida o objeto de tasks devolvido pelo modelo, coletando todos os erros.
 * @param {unknown} value
 * @returns {ValidationResult}
 */
export function validateTasks(value) {
  if (!isPlainObject(value)) return { ok: false, errors: ['raiz: esperado objeto'] };
  /** @type {string[]} */
  const errors = [];
  checkObject(value, ROOT_SCHEMA, '', errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: /** @type {TasksData} */ (/** @type {unknown} */ (value)) };
}

/**
 * Faz parse da resposta textual do modelo e valida. Se o texto não for JSON puro,
 * tenta o trecho entre o primeiro '{' e o último '}'.
 * @param {string} text
 * @returns {ValidationResult}
 */
export function parseTasksJson(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return { ok: false, errors: [`JSON inválido: ${errMessage(err)}`] };
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (err2) {
      return { ok: false, errors: [`JSON inválido: ${errMessage(err2)}`] };
    }
  }
  return validateTasks(parsed);
}

/** @param {unknown} err */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
