// @ts-check
/**
 * Builders/parsers puros dos corpos HTTP do OpenRouter (sem fetch aqui).
 */

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

/** @typedef {'tasks'|'brief'|'resumo'} ChatMode */

const JSON_FALLBACK_PROMPT = '\n\nResponda SOMENTE com um JSON válido exatamente neste schema, sem texto antes ou depois:\n';

/**
 * Monta o corpo de POST CHAT_URL.
 * @param {Object} opts
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {Array<Object>} opts.parts      content parts da mensagem do usuário (texto, file, image_url...)
 * @param {ChatMode} opts.mode
 * @param {Object} [opts.schema]          JSON Schema da saída (usado só em mode 'tasks')
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.effort]
 * @param {boolean} [opts.jsonFallback]  mode 'tasks' sem response_format: o schema vai no prompt de sistema
 *                                        (contingência quando o provedor recusa structured output)
 * @returns {Record<string, any>}
 */
export function buildChatRequest({ model, systemPrompt, parts, mode, schema, maxTokens = 32000, effort = 'high', jsonFallback = false }) {
  if (mode !== 'tasks' && mode !== 'brief' && mode !== 'resumo') {
    throw new Error(`modo inválido: ${String(mode)}`);
  }
  const fallback = mode === 'tasks' && jsonFallback;
  const system = fallback ? systemPrompt + JSON_FALLBACK_PROMPT + JSON.stringify(schema) : systemPrompt;
  /** @type {Record<string, any>} */
  const body = {
    model,
    max_tokens: maxTokens,
    reasoning: { effort },
    usage: { include: true },
    provider: { require_parameters: true },
    plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: parts },
    ],
  };
  if (mode === 'tasks' && !fallback) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'tasks', strict: true, schema } };
  }
  return body;
}

/**
 * Monta o corpo de POST STT_URL. Aceita base64 cru ou data URL (o prefixo é removido).
 * @param {Object} opts
 * @param {string} opts.model
 * @param {string} opts.base64
 * @param {string} [opts.format]
 * @param {string} [opts.language]
 * @returns {{model: string, input_audio: {data: string, format: string}, language: string}}
 */
export function buildSttRequest({ model, base64, format = 'ogg', language = 'pt' }) {
  const data = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  return { model, input_audio: { data, format }, language };
}

/**
 * @param {string} apiKey
 * @returns {{Authorization: string, 'Content-Type': string}}
 */
export function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/**
 * @typedef {{ok: true, text: string, finishReason: string, cost: number, provider: string} | {ok: false, error: string, cost: number}} ChatParsed
 * @typedef {{ok: true, text: string, cost: number} | {ok: false, error: string}} SttParsed
 */

/**
 * Mensagem de erro do OpenRouter (json.error), ou null se não houver erro.
 * @param {any} json
 * @returns {string|null}
 */
function errorOf(json) {
  if (!json?.error) return null;
  return json.error.message || JSON.stringify(json.error);
}

/**
 * @param {any} json
 * @returns {number}
 */
function costOf(json) {
  return Number(json?.usage?.cost) || 0;
}

/**
 * Interpreta a resposta de CHAT_URL. Mesmo em erro devolve `cost` (usage.cost): saída truncada é cobrada.
 * @param {any} json
 * @returns {ChatParsed}
 */
export function parseChatResponse(json) {
  const cost = costOf(json);
  /** @param {string} error @returns {ChatParsed} */
  const fail = (error) => ({ ok: false, error, cost });
  const error = errorOf(json);
  if (error !== null) return fail(error);
  const choice = json?.choices?.[0];
  if (!choice) return fail('resposta sem choices');
  // Falha do provedor pode vir com HTTP 200: choice.error e/ou finish_reason 'error'.
  if (choice.error) return fail(choice.error.message || JSON.stringify(choice.error));
  if (choice.finish_reason === 'error') return fail('erro do provedor');
  if (choice.finish_reason === 'length') return fail('saída truncada; reduza o trecho');
  return {
    ok: true,
    text: String(choice.message?.content ?? ''),
    finishReason: String(choice.finish_reason ?? ''),
    cost,
    provider: json.provider || '',
  };
}

/**
 * Interpreta a resposta de STT_URL. Texto vazio (áudio sem fala) conta como sucesso.
 * @param {any} json
 * @returns {SttParsed}
 */
export function parseSttResponse(json) {
  const error = errorOf(json);
  if (error !== null) return { ok: false, error };
  if (typeof json?.text !== 'string') return { ok: false, error: 'resposta sem texto' };
  return { ok: true, text: json.text.trim(), cost: costOf(json) };
}
