#!/usr/bin/env node
// Bake-off cego de STT via OpenRouter.
// Uso: OPENROUTER_API_KEY=... node scripts/stt-bakeoff.mjs <pasta-com-ogg> [modelo1,modelo2,...]
//   (ou: export OPENROUTER_API_KEY=...; node scripts/stt-bakeoff.mjs ./audios)
// Saída: <pasta>/bakeoff/<arquivo>.md com as transcrições rotuladas A, B, C... em ordem embaralhada,
//        e <pasta>/bakeoff/GABARITO.json (qual letra é qual modelo) pra abrir só depois de julgar.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const DEFAULT_MODELS = ['elevenlabs/scribe-v2', 'google/gemini-3.5-transcribe', 'openai/gpt-transcribe'];
const URL = 'https://openrouter.ai/api/v1/audio/transcriptions';

const [, , dir, modelsArg] = process.argv;
if (!dir) { console.error('uso: node scripts/stt-bakeoff.mjs <pasta-com-ogg> [modelo1,modelo2]'); process.exit(1); }
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY ausente (export OPENROUTER_API_KEY=...)'); process.exit(1); }
const models = modelsArg ? modelsArg.split(',') : DEFAULT_MODELS;

/** @param {string} file @param {string} model */
async function transcribe(file, model) {
  const bytes = await readFile(file);
  const ext = extname(file).slice(1).toLowerCase();
  const format = ext === 'opus' ? 'ogg' : ext;
  const body = { model, input_audio: { data: bytes.toString('base64'), format }, language: 'pt' };
  const t0 = Date.now();
  const res = await fetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const json = await res.json().catch(() => ({}));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok || json.error) return { text: '', error: json.error?.message || `HTTP ${res.status}`, cost: 0, secs };
  return { text: (json.text || '').trim(), error: '', cost: Number(json.usage?.cost) || 0, secs };
}

/** Embaralha de forma determinística por arquivo (pra reproduzir). @param {string[]} arr @param {string} seed */
function shuffle(arr, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const files = (await readdir(dir)).filter((f) => /\.(ogg|opus|mp3|m4a|wav)$/i.test(f)).sort();
if (!files.length) { console.error('nenhum áudio (.ogg/.opus/.mp3/.m4a/.wav) em ' + dir); process.exit(1); }
const out = join(dir, 'bakeoff');
await mkdir(out, { recursive: true });
/** @type {Record<string, Record<string, string>>} */
const gabarito = {};
const totals = Object.fromEntries(models.map((m) => [m, { cost: 0, errors: 0 }]));

for (const f of files) {
  const path = join(dir, f);
  const order = shuffle(models, f);
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  gabarito[f] = Object.fromEntries(order.map((m, i) => [letters[i], m]));
  const lines = [`# ${f}`, ''];
  for (let i = 0; i < order.length; i++) {
    const r = await transcribe(path, order[i]);
    totals[order[i]].cost += r.cost;
    if (r.error) totals[order[i]].errors++;
    lines.push(`## ${letters[i]}  (${r.secs} s)`, '', r.error ? `[ERRO: ${r.error}]` : r.text, '');
    process.stdout.write(`${f} ${letters[i]} ${r.secs}s ${r.error ? 'ERRO' : 'ok'}\n`);
  }
  await writeFile(join(out, basename(f, extname(f)) + '.md'), lines.join('\n'));
}
await writeFile(join(out, 'GABARITO.json'), JSON.stringify({ gabarito, totals }, null, 2));
console.log(`\nTranscrições em ${out}/*.md (julgue às cegas). Gabarito em ${out}/GABARITO.json. Custo por modelo:`);
for (const [m, t] of Object.entries(totals)) console.log(`  ${m}: US$ ${t.cost.toFixed(4)}${t.errors ? ` (${t.errors} erros)` : ''}`);
