// @ts-check
// Tier só-texto: serializa uma linha [data-id] do WhatsApp Web em RawRow (ver src/lib/messages.js).
// Script classic no mundo isolado; expõe uma função global pro selector.js usar. Sem rede, sem Store.
(() => {
  /**
   * Texto visível do nó: o WhatsApp desenha emoji como <img alt="👍">, que innerText/textContent
   * ignoram; aqui cada <img alt> vira o alt e cada <br> vira '\n'. Não força layout (sem innerText).
   * @param {Node} node
   * @returns {string}
   */
  function textOf(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    const el = /** @type {Element} */ (node);
    const tag = el.tagName;
    if (tag === 'IMG') return el.getAttribute('alt') || '';
    if (tag === 'BR') return '\n';
    let out = '';
    node.childNodes.forEach((c) => { out += textOf(c); });
    return out;
  }

  /**
   * @param {Element} rowEl  elemento [role="row"]
   * @param {string} dataId
   * @param {number} domIndex
   */
  function rowFromEl(rowEl, dataId, domIndex) {
    const preEl = rowEl.querySelector('.copyable-text[data-pre-plain-text]');
    const textEl = rowEl.querySelector('span.selectable-text');
    const text = textEl ? textOf(textEl).trim() : '';
    const hasPtt = !!rowEl.querySelector('[data-icon="ptt-status"], [data-icon="audio-play"], [role="slider"]');
    const hasImg = !hasPtt && !!rowEl.querySelector('img[src^="blob:"]');
    const hasDoc = !hasPtt && !!rowEl.querySelector('[data-icon^="doc"], [data-icon*="document"], [data-icon="file"], [title$=".pdf"], [title$=".PDF"]');
    return {
      dataId,
      domIndex,
      pre: preEl ? (preEl.getAttribute('data-pre-plain-text') || '') : '',
      text,
      hasPtt,
      hasDoc,
      hasImg,
    };
  }
  /** @type {any} */ (globalThis).__waTasksRowFromEl = rowFromEl;
})();
