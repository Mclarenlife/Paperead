import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const document = mathjax.document('', {
  InputJax: new TeX({ packages: ['base', 'ams', 'newcommand'] }),
  OutputJax: new SVG({ fontCache: 'none' }),
})
export async function formulaSvg(tex: string) {
  const output = await mathjax.handleRetriesFor(() => document.convert(tex, { display: true }))
  const svg = adaptor.innerHTML(output)
  // pdfmake requires absolute dimensions; MathJax emits ex units.
  return svg
    .replace(
      /(width|height)="([\d.]+)ex"/g,
      (_, attribute, value) => `${attribute}="${Number(value) * 5.2}"`,
    )
    .replace(/currentColor/g, '#202a24')
}
