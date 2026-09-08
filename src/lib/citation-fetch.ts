// Citation.js imports Node transports even when only parsing local BibTeX / RIS.
// Supply the browser transport instead of bundling Node streams into the WebView.
export const Headers = globalThis.Headers
export default (...args: Parameters<typeof fetch>) => globalThis.fetch(...args)
