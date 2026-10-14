// @ts-check
/**
 * Mini parser do markup ESTÁTICO do painel (string confiável escrita por nós, nunca dado de usuário).
 * Monta o DOM só com createElement/setAttribute/createTextNode: funciona dentro do WhatsApp Web mesmo
 * com Trusted Types/CSP (innerHTML e DOMParser são "sinks" bloqueáveis) e passa limpo no web-ext lint.
 * Suporta o subconjunto que o painel usa: tags, atributos com aspas, booleanos, elementos vazios,
 * comentários e as entidades &amp; &lt; &gt; &quot; &#39;.
 */

/** @typedef {{type: 'open', tag: string, attrs: Array<[string, string]>, void: boolean} | {type: 'close', tag: string} | {type: 'text', text: string}} Token */

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** @param {string} s */
function decode(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k) => ENTITIES[k]);
}

/**
 * @param {string} html
 * @returns {Token[]}
 */
export function tokenize(html) {
  /** @type {Token[]} */
  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[i] === '<') {
      const close = html[i + 1] === '/';
      let j = i + (close ? 2 : 1);
      const nameMatch = /^[a-zA-Z][\w-]*/.exec(html.slice(j));
      if (!nameMatch) throw new Error(`markup inválido perto de ${JSON.stringify(html.slice(i, i + 20))}`);
      const tag = nameMatch[0].toLowerCase();
      j += nameMatch[0].length;
      /** @type {Array<[string, string]>} */
      const attrs = [];
      let selfClosing = false;
      for (;;) {
        while (j < html.length && /\s/.test(html[j])) j++;
        if (j >= html.length) throw new Error(`tag <${tag}> sem fechar`);
        if (html[j] === '>') { j++; break; }
        if (html.startsWith('/>', j)) { selfClosing = true; j += 2; break; }
        const an = /^[^\s=>/]+/.exec(html.slice(j));
        if (!an) throw new Error(`atributo inválido em <${tag}>`);
        const name = an[0];
        j += name.length;
        let value = '';
        if (html[j] === '=') {
          j++;
          const q = html[j];
          if (q === '"' || q === "'") {
            const end = html.indexOf(q, j + 1);
            if (end < 0) throw new Error(`aspas sem fechar em <${tag}>`);
            value = decode(html.slice(j + 1, end));
            j = end + 1;
          } else {
            const uv = /^[^\s>]+/.exec(html.slice(j));
            value = uv ? decode(uv[0]) : '';
            j += uv ? uv[0].length : 0;
          }
        }
        attrs.push([name, value]);
      }
      if (close) out.push({ type: 'close', tag });
      else out.push({ type: 'open', tag, attrs, void: selfClosing || VOID.has(tag) });
      i = j;
      continue;
    }
    const next = html.indexOf('<', i);
    const raw = html.slice(i, next < 0 ? html.length : next);
    i = next < 0 ? html.length : next;
    // indentação entre tags some; espaço "de verdade" (ex.: entre palavras) fica
    if (/^\s*$/.test(raw) && raw.includes('\n')) continue;
    out.push({ type: 'text', text: decode(raw) });
  }
  return out;
}

/**
 * @param {Pick<Document, 'createElement' | 'createDocumentFragment' | 'createTextNode'>} doc
 * @param {string} html
 * @returns {DocumentFragment}
 */
export function buildFragment(doc, html) {
  const frag = doc.createDocumentFragment();
  /** @type {Array<{tag: string, node: Node}>} */
  const stack = [{ tag: '#fragment', node: frag }];
  for (const t of tokenize(html)) {
    const parent = stack[stack.length - 1].node;
    if (t.type === 'text') {
      parent.appendChild(doc.createTextNode(t.text));
    } else if (t.type === 'open') {
      const el = doc.createElement(t.tag);
      for (const [k, v] of t.attrs) el.setAttribute(k, v);
      parent.appendChild(el);
      if (!t.void) stack.push({ tag: t.tag, node: el });
    } else {
      const top = stack[stack.length - 1];
      if (top.tag !== t.tag) throw new Error(`</${t.tag}> fecha <${top.tag}>`);
      stack.pop();
    }
  }
  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].tag}> sem fechar`);
  return frag;
}
