// @ts-check
/**
 * Interface entre o painel (app.js) e o navegador. O painel nunca chama chrome.tabs/scripting/windows
 * nem fetch direto: tudo passa por um objeto Platform.
 *   - platform-ext.js: painel numa página da extensão (sidebar do Firefox/Zen, side panel do Chrome,
 *     janela própria). Faz executeScript, fetch e tabs.sendMessage direto.
 *   - platform-page.js: painel dentro do WhatsApp (overlay.js, Shadow DOM). Pede STORE/FETCH ao
 *     background e fala com o selector.js direto (mesmo mundo isolado).
 */

/** @typedef {import('../lib/http.js').HttpRequest} HttpRequest */
/** @typedef {import('../lib/http.js').HttpResponse} HttpResponse */

/**
 * Evento do content script: PICKED, PICK_CANCELLED, CHAT_CHANGED.
 * `tabId` = aba que mandou (undefined dentro da página: é sempre a própria aba).
 * @typedef {(msg: {name: string, payload?: any}, tabId: number | undefined) => void} ContentEventCb
 */

/**
 * @typedef {Object} TabActivity
 * @property {() => void} activated                       outra aba ficou ativa
 * @property {(tabId: number, status: string | undefined, active: boolean) => void} updated  aba recarregando/carregou
 */

/**
 * @typedef {Object} Platform
 * @property {'ext'|'page'} kind
 * @property {(fnName: 'storeStatus'|'storeCollect'|'storeMedia'|'storeDiag', args?: any[], tabId?: number) => Promise<any>} storeCall
 *   executa uma função de store-calls.js no MAIN world da aba do WhatsApp (por operação; nada fica injetado)
 * @property {(req: HttpRequest) => Promise<HttpResponse>} httpJson
 *   rejeita com o erro original em rede/timeout/abort (TypeError, TimeoutError, AbortError)
 * @property {(keys: string | string[] | null) => Promise<Record<string, any>>} storageGet
 * @property {(obj: Record<string, any>) => Promise<void>} storageSet
 * @property {(keys: string | string[]) => Promise<void>} storageRemove
 * @property {() => Promise<{id?: number} | null>} findWhatsAppTab   dentro da página: sempre {id: -1}
 * @property {(name: string, payload?: any, tabId?: number) => Promise<any>} contentSend   fala com o selector.js
 * @property {(cb: ContentEventCb) => (() => void)} onContentEvent
 * @property {() => Promise<boolean>} hasRequiredOrigins
 * @property {() => Promise<boolean>} requestOrigins   chamar DENTRO do gesto do usuário (antes de qualquer await)
 * @property {() => Promise<unknown>} openWindow        abre o painel numa janela própria
 * @property {(tabId: number) => void} keepAlive        porta aberta com o content script enquanto o painel vive (só ext)
 * @property {(h: TabActivity) => void} onTabActivity   troca/recarga de aba (só ext; dentro da página, a recarga mata o painel junto)
 */

export {};
