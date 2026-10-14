// @ts-check
/**
 * Monta o conteúdo da mensagem de usuário (formato OpenAI content parts) a partir do trecho.
 */

/** @typedef {import('./messages.js').Item} Item */
/** @typedef {import('./messages.js').TranscriptResult} TranscriptResult */
/** @typedef {import('./messages.js').MediaResult} MediaResult */

/**
 * Metadados do chat para o cabeçalho.
 * @typedef {Object} PayloadMeta
 * @property {string} chatName
 * @property {boolean} isGroup
 * @property {Date} now
 * @property {string} userName   nome de quem aparece como "Eu"; vazio vira "você"
 * @property {string} [tz]          fuso IANA de todos os horários do payload e do rótulo "fuso" (default: o do sistema)
 */

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/** Fuso do sistema, o mesmo que `new Date()` usa. */
const systemTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** @type {Map<string, Intl.DateTimeFormat>} */
const stampFormats = new Map();

/**
 * Formatter numérico (dia, mês, ano, hora 00–23, minuto) para um fuso, em cache.
 * @param {string} tz
 * @returns {Intl.DateTimeFormat}
 */
function stampFormat(tz) {
  let f = stampFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    });
    stampFormats.set(tz, f);
  }
  return f;
}

/** t > 0 e finito: horário conhecido (domparse usa t = 0 quando a linha não tem data). */
const knownTime = (/** @type {number} */ t) => Number.isFinite(t) && t > 0;

/**
 * Unix seconds → 'dd/mm HH:MM' (ou 'dd/mm/yyyy HH:MM') no fuso `tz` (default: o do sistema).
 * Horário desconhecido (t = 0, não finito ou negativo) → '??/?? ??:??' (ou '??/??/???? ??:??').
 * @param {number} t
 * @param {boolean} [withYear]
 * @param {string} [tz]
 * @returns {string}
 */
export function formatStamp(t, withYear = false, tz = systemTz()) {
  if (!knownTime(t)) return withYear ? '??/??/???? ??:??' : '??/?? ??:??';
  /** @type {Record<string, number>} */
  const p = {};
  for (const { type, value } of stampFormat(tz).formatToParts(new Date(t * 1000))) p[type] = Number(value);
  const date = `${pad2(p.day)}/${pad2(p.month)}` + (withYear ? `/${p.year}` : '');
  return `${date} ${pad2(p.hour % 24)}:${pad2(p.minute)}`;
}

/**
 * Linha de contexto que abre o payload.
 * @param {PayloadMeta} meta
 * @param {Item[]} items
 * @returns {string}
 */
export function headerLine(meta, items) {
  const tz = meta.tz || systemTz();
  const n = items.length;
  const segs = [
    `Chat: "${meta.chatName}" (${meta.isGroup ? 'grupo' : 'direto'})`,
    `trecho de ${n} ${n === 1 ? 'mensagem' : 'mensagens'}`,
  ];
  const first = items.find((it) => knownTime(it.t));
  const last = items.findLast((it) => knownTime(it.t));
  if (first && last) segs.push(`de ${formatStamp(first.t, true, tz)} a ${formatStamp(last.t, true, tz)}`);
  const nowSec = Math.floor(meta.now.getTime() / 1000);
  const today = formatStamp(nowSec, true, tz).split(' ')[0];
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: tz }).format(meta.now);
  segs.push(`hoje: ${today} (${weekday})`);
  segs.push(`fuso ${tz}`);
  segs.push(`"Eu" = ${(meta.userName || '').trim() || 'você'}.`);
  return segs.join(' · ');
}

/**
 * Contexto necessário para rotular um item.
 * @typedef {Object} LabelCtx
 * @property {Map<string, number>} hexIndex          hex → índice 1-based no trecho
 * @property {Map<string, TranscriptResult>} transcripts
 * @property {Map<string, MediaResult>} media
 * @property {string} attachment                      rótulo do anexo deste item ('A1'...) ou ''
 * @property {string} [tz]                              fuso dos horários (default: o do sistema)
 */

/**
 * Label de uma mensagem: `[#i · dd/mm HH:MM · Autor ...] conteúdo`.
 * @param {Item} it
 * @param {number} index  1-based
 * @param {LabelCtx} ctx
 * @returns {string}
 */
export function labelFor(it, index, ctx) {
  let head = `[#${index} · ${formatStamp(it.t, false, ctx.tz)} · ${it.author}`;
  if (it.quotedHex) {
    const j = ctx.hexIndex.get(it.quotedHex);
    head += j !== undefined ? ` · ↳ responde #${j}` : ` · ↳ responde a «${it.quotedText}»`;
  }
  return `${head}${tail(it, ctx)}`.trimEnd();
}

/**
 * Segundos → 'm:ss'.
 * @param {number} sec
 */
function mss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/**
 * Parte do label específica do tipo, a partir do fechamento do cabeçalho.
 * @param {Item} it
 * @param {LabelCtx} ctx
 * @returns {string}
 */
function tail(it, ctx) {
  switch (it.type) {
    case 'ptt':
    case 'audio': {
      const tr = ctx.transcripts.get(it.id);
      const m = ctx.media.get(it.id);
      let body;
      if (tr && tr.ok) body = `«${tr.text}»`;
      else if (m && !m.ok) body = `[NÃO TRANSCRITO: mídia indisponível: ${m.error}]`;
      else body = tr ? `[NÃO TRANSCRITO: ${tr.error}]` : '[NÃO TRANSCRITO: não processado]';
      return ` · áudio ${mss(it.durationSec)}] ${body}`;
    }
    case 'document': {
      const m = ctx.media.get(it.id);
      const name = `PDF "${it.filename}"`;
      if (m && m.ok) {
        const pages = it.pageCount > 0 ? `, ${it.pageCount} págs` : '';
        return ` · ${name}${pages} → ${ctx.attachment}] ${it.text}`;
      }
      return ` · ${name} · mídia indisponível: ${m ? m.error : 'não processada'}] ${it.text}`;
    }
    case 'image': {
      const m = ctx.media.get(it.id);
      if (m && m.ok) {
        const caption = it.text ? `, legenda: "${it.text}"` : '';
        return ` · imagem → ${ctx.attachment}${caption}] `;
      }
      return ` · imagem · mídia indisponível: ${m ? m.error : 'não processada'}] ${it.text}`;
    }
    case 'other':
      return ` · ${it.note}] ${it.text}`;
    default:
      return `] ${it.text}`;
  }
}

/**
 * @typedef {{type: 'text', text: string}
 *   | {type: 'file', file: {filename: string, file_data: string}}
 *   | {type: 'image_url', image_url: {url: string}}} ContentPart
 * @typedef {{label: string, id: string, filename: string}} Attachment
 */

/**
 * Conteúdo da mensagem de usuário: cabeçalho, um label por item e os anexos (PDF/imagem) logo após o label.
 * @param {Item[]} items
 * @param {Map<string, TranscriptResult>} transcripts
 * @param {Map<string, MediaResult>} media
 * @param {PayloadMeta} meta
 * @returns {{parts: ContentPart[], attachments: Attachment[]}}
 */
export function buildUserContent(items, transcripts, media, meta) {
  const tz = meta.tz || systemTz();
  /** @type {ContentPart[]} */
  const parts = [{ type: 'text', text: headerLine({ ...meta, tz }, items) }];
  /** @type {Attachment[]} */
  const attachments = [];
  /** @type {Map<string, number>} */
  const hexIndex = new Map();
  items.forEach((it, i) => {
    if (it.hex && !hexIndex.has(it.hex)) hexIndex.set(it.hex, i + 1);
  });

  items.forEach((it, i) => {
    const m = media.get(it.id);
    const okMedia = (it.type === 'document' || it.type === 'image') && m && m.ok ? m : null;
    const attachment = okMedia ? `A${attachments.length + 1}` : '';
    if (okMedia) attachments.push({ label: attachment, id: it.id, filename: it.filename });

    parts.push({ type: 'text', text: labelFor(it, i + 1, { hexIndex, transcripts, media, attachment, tz }) });

    if (okMedia && it.type === 'document') {
      parts.push({ type: 'file', file: { filename: it.filename, file_data: `data:application/pdf;base64,${okMedia.base64}` } });
    } else if (okMedia) {
      parts.push({ type: 'image_url', image_url: { url: `data:${okMedia.mime};base64,${okMedia.base64}` } });
    }
  });

  return { parts, attachments };
}
