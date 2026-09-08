import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const destination = resolve('public/pdfjs')
await mkdir(destination, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(resolve('node_modules/pdfjs-dist', directory), resolve(destination, directory), {
    recursive: true,
  })
}
console.log('PDF.js 字体、CMap 与解码资源已准备好。')
