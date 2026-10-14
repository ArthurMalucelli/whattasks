// @ts-check
import { describe, it, expect } from 'vitest';
import {
  CHAT_URL,
  STT_URL,
  buildChatRequest,
  buildSttRequest,
  parseChatResponse,
  parseSttResponse,
  authHeaders,
} from '../src/lib/requests.js';

/**
 * Teste de entrada inválida: desliga a checagem de tipo só no argumento.
 * @param {any} v
 * @returns {any}
 */
const loose = (v) => v;

const PARTS = [{ type: 'text', text: 'oi' }];
const SCHEMA = { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] };

describe('URLs', () => {
  it('CHAT_URL aponta pro endpoint de chat completions', () => {
    expect(CHAT_URL).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
  it('STT_URL aponta pro endpoint de transcrição', () => {
    expect(STT_URL).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
  });
});

describe('buildChatRequest', () => {
  it('modo tasks gera o corpo exato com response_format json_schema strict', () => {
    const body = buildChatRequest({ model: 'anthropic/claude-x', systemPrompt: 'SYS', parts: PARTS, mode: 'tasks', schema: SCHEMA });
    expect(body).toStrictEqual({
      model: 'anthropic/claude-x',
      max_tokens: 32000,
      reasoning: { effort: 'high' },
      usage: { include: true },
      provider: { require_parameters: true },
      plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: PARTS },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'tasks', strict: true, schema: SCHEMA } },
    });
  });

  it('modo brief gera o corpo exato sem response_format', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'S', parts: PARTS, mode: 'brief', schema: SCHEMA });
    expect(body).toStrictEqual({
      model: 'm',
      max_tokens: 32000,
      reasoning: { effort: 'high' },
      usage: { include: true },
      provider: { require_parameters: true },
      plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: PARTS },
      ],
    });
  });

  it('modo brief não tem a chave response_format', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'S', parts: PARTS, mode: 'brief' });
    expect('response_format' in body).toBe(false);
  });

  it('respeita maxTokens e effort informados', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'S', parts: PARTS, mode: 'brief', maxTokens: 1000, effort: 'low' });
    expect(body.max_tokens).toBe(1000);
    expect(body.reasoning).toStrictEqual({ effort: 'low' });
  });

  it('jsonFallback (tasks): sem response_format e com o schema anexado ao prompt de sistema', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'SYS', parts: PARTS, mode: 'tasks', schema: SCHEMA, jsonFallback: true });
    expect('response_format' in body).toBe(false);
    expect(body.messages[0]).toStrictEqual({
      role: 'system',
      content: 'SYS\n\nResponda SOMENTE com um JSON válido exatamente neste schema, sem texto antes ou depois:\n' + JSON.stringify(SCHEMA),
    });
    expect(body.messages[1]).toStrictEqual({ role: 'user', content: PARTS });
    expect(body.provider).toStrictEqual({ require_parameters: true });
  });

  it('jsonFallback false mantém o corpo com response_format', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'SYS', parts: PARTS, mode: 'tasks', schema: SCHEMA, jsonFallback: false });
    expect(body.response_format).toStrictEqual({ type: 'json_schema', json_schema: { name: 'tasks', strict: true, schema: SCHEMA } });
    expect(body.messages[0].content).toBe('SYS');
  });

  it('jsonFallback no modo brief não muda nada', () => {
    const body = buildChatRequest({ model: 'm', systemPrompt: 'S', parts: PARTS, mode: 'brief', schema: SCHEMA, jsonFallback: true });
    expect(body.messages[0].content).toBe('S');
    expect('response_format' in body).toBe(false);
  });

  it('lança erro para modo inválido', () => {
    expect(() => buildChatRequest(loose({ model: 'm', systemPrompt: 'S', parts: PARTS, mode: 'resumo' }))).toThrow(/modo inválido/);
  });

  it('lança erro quando mode está ausente', () => {
    expect(() => buildChatRequest(loose({ model: 'm', systemPrompt: 'S', parts: PARTS }))).toThrow(/modo inválido/);
  });
});

describe('buildSttRequest', () => {
  it('gera o corpo exato com defaults ogg e pt', () => {
    expect(buildSttRequest({ model: 'stt-m', base64: 'QUJD' })).toStrictEqual({
      model: 'stt-m',
      input_audio: { data: 'QUJD', format: 'ogg' },
      language: 'pt',
    });
  });

  it('respeita format e language informados', () => {
    expect(buildSttRequest({ model: 'm', base64: 'QUJD', format: 'mp3', language: 'en' })).toStrictEqual({
      model: 'm',
      input_audio: { data: 'QUJD', format: 'mp3' },
      language: 'en',
    });
  });

  it('remove o prefixo data: até a primeira vírgula', () => {
    const body = buildSttRequest({ model: 'm', base64: 'data:audio/ogg; codecs=opus;base64,T2dnUw==' });
    expect(body.input_audio.data).toBe('T2dnUw==');
  });

  it('remove só até a PRIMEIRA vírgula do prefixo data:', () => {
    const body = buildSttRequest({ model: 'm', base64: 'data:audio/ogg;base64,AAA,BBB' });
    expect(body.input_audio.data).toBe('AAA,BBB');
  });

  it('mantém base64 cru intacto mesmo contendo vírgula', () => {
    const body = buildSttRequest({ model: 'm', base64: 'AAA,BBB' });
    expect(body.input_audio.data).toBe('AAA,BBB');
  });
});

describe('authHeaders', () => {
  it('monta Bearer e Content-Type JSON', () => {
    expect(authHeaders('sk-or-123')).toStrictEqual({
      Authorization: 'Bearer sk-or-123',
      'Content-Type': 'application/json',
    });
  });
});

/**
 * @param {Record<string, any>} [over]
 * @returns {Record<string, any>}
 */
function chatJson(over = {}) {
  return {
    id: 'gen-1',
    provider: 'Anthropic',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"tasks":[]}' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0123 },
    ...over,
  };
}

describe('parseChatResponse', () => {
  it('sucesso devolve texto, finishReason, custo e provider', () => {
    expect(parseChatResponse(chatJson())).toStrictEqual({
      ok: true,
      text: '{"tasks":[]}',
      finishReason: 'stop',
      cost: 0.0123,
      provider: 'Anthropic',
    });
  });

  it('json.error com message vira ok:false com a mensagem', () => {
    expect(parseChatResponse({ error: { code: 402, message: 'Insufficient credits' } })).toStrictEqual({
      ok: false,
      error: 'Insufficient credits',
      cost: 0,
    });
  });

  it('json.error sem message vira ok:false com o JSON do erro', () => {
    expect(parseChatResponse({ error: { code: 500 } })).toStrictEqual({ ok: false, error: '{"code":500}', cost: 0 });
  });

  it('json.error tem prioridade mesmo havendo choices', () => {
    const res = parseChatResponse(chatJson({ error: { message: 'falhou no meio' } }));
    expect(res).toStrictEqual({ ok: false, error: 'falhou no meio', cost: 0.0123 });
  });

  it('sem choices vira ok:false "resposta sem choices"', () => {
    expect(parseChatResponse({ id: 'x' })).toStrictEqual({ ok: false, error: 'resposta sem choices', cost: 0 });
  });

  it('choices vazio vira ok:false "resposta sem choices"', () => {
    expect(parseChatResponse(chatJson({ choices: [] }))).toStrictEqual({ ok: false, error: 'resposta sem choices', cost: 0.0123 });
  });

  it('finish_reason length vira ok:false de saída truncada', () => {
    const json = chatJson({ choices: [{ finish_reason: 'length', message: { content: '{"tasks":[' } }] });
    expect(parseChatResponse(json)).toStrictEqual({ ok: false, error: 'saída truncada; reduza o trecho', cost: 0.0123 });
  });

  it('choice.error vira ok:false com a mensagem do provedor', () => {
    const json = chatJson({
      choices: [{ finish_reason: 'error', error: { code: 502, message: 'upstream' }, message: { content: null } }],
    });
    expect(parseChatResponse(json)).toStrictEqual({ ok: false, error: 'upstream', cost: 0.0123 });
  });

  it('choice.error sem message vira JSON do erro', () => {
    const json = chatJson({ choices: [{ finish_reason: 'error', error: { code: 502 }, message: { content: null } }] });
    expect(parseChatResponse(json)).toStrictEqual({ ok: false, error: '{"code":502}', cost: 0.0123 });
  });

  it('choice.error tem prioridade sobre finish_reason length', () => {
    const json = chatJson({ choices: [{ finish_reason: 'length', error: { message: 'caiu' }, message: { content: '' } }] });
    expect(parseChatResponse(json)).toStrictEqual({ ok: false, error: 'caiu', cost: 0.0123 });
  });

  it('finish_reason error sem choice.error vira ok:false "erro do provedor"', () => {
    const json = chatJson({ choices: [{ finish_reason: 'error', message: { content: null } }] });
    expect(parseChatResponse(json)).toStrictEqual({ ok: false, error: 'erro do provedor', cost: 0.0123 });
  });

  it('custo em string é convertido para número', () => {
    expect(parseChatResponse(chatJson({ usage: { cost: '0.5' } }))).toMatchObject({ ok: true, cost: 0.5 });
  });

  it('saída truncada (length) ainda devolve o custo cobrado', () => {
    const json = chatJson({ usage: { cost: '0.7' }, choices: [{ finish_reason: 'length', message: { content: '{"tasks":[' } }] });
    expect(parseChatResponse(json)).toMatchObject({ ok: false, cost: 0.7 });
  });

  it('sem usage o custo é 0', () => {
    const json = chatJson();
    delete json.usage;
    expect(parseChatResponse(json)).toMatchObject({ ok: true, cost: 0 });
  });

  it('custo não numérico vira 0', () => {
    expect(parseChatResponse(chatJson({ usage: { cost: 'abc' } }))).toMatchObject({ ok: true, cost: 0 });
  });

  it('sem provider devolve string vazia', () => {
    const json = chatJson();
    delete json.provider;
    expect(parseChatResponse(json)).toMatchObject({ ok: true, provider: '' });
  });

  it('content nulo vira texto vazio', () => {
    const json = chatJson({ choices: [{ finish_reason: 'stop', message: { content: null } }] });
    expect(parseChatResponse(json)).toMatchObject({ ok: true, text: '' });
  });
});

describe('parseSttResponse', () => {
  it('sucesso devolve texto aparado e custo', () => {
    expect(parseSttResponse({ text: '  vamos marcar amanhã \n', usage: { cost: 0.002 } })).toStrictEqual({
      ok: true,
      text: 'vamos marcar amanhã',
      cost: 0.002,
    });
  });

  it('json.error com message vira ok:false com a mensagem', () => {
    expect(parseSttResponse({ error: { message: 'audio inválido' } })).toStrictEqual({ ok: false, error: 'audio inválido' });
  });

  it('json.error sem message vira ok:false com o JSON do erro', () => {
    expect(parseSttResponse({ error: { code: 400 } })).toStrictEqual({ ok: false, error: '{"code":400}' });
  });

  it('sem text vira ok:false "resposta sem texto"', () => {
    expect(parseSttResponse({ usage: { cost: 0.1 } })).toStrictEqual({ ok: false, error: 'resposta sem texto' });
  });

  it('text não-string vira ok:false "resposta sem texto"', () => {
    expect(parseSttResponse({ text: 42 })).toStrictEqual({ ok: false, error: 'resposta sem texto' });
  });

  it('custo em string é convertido para número', () => {
    expect(parseSttResponse({ text: 'oi', usage: { cost: '0.25' } })).toMatchObject({ ok: true, cost: 0.25 });
  });

  it('sem usage o custo é 0', () => {
    expect(parseSttResponse({ text: 'oi' })).toMatchObject({ ok: true, cost: 0 });
  });

  it('texto vazio (silêncio) é sucesso com string vazia', () => {
    expect(parseSttResponse({ text: '   ' })).toStrictEqual({ ok: true, text: '', cost: 0 });
  });
});
