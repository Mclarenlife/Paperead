import { createRequire } from 'node:module'
import { mkdir, readdir, copyFile, access, unlink } from 'node:fs/promises'
import path from 'node:path'
const require = createRequire(import.meta.url)
await mkdir('public/ocr/core', { recursive: true })
const worker = path.dirname(require.resolve('tesseract.js/package.json'))
const core = path.dirname(
  createRequire(path.join(worker, 'package.json')).resolve('tesseract.js-core/package.json'),
)
await copyFile(path.join(worker, 'dist/worker.min.js'), 'public/ocr/worker.min.js')
for (const file of await readdir('public/ocr/core'))
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(file) && !/-lstm\.wasm\.js$/.test(file))
    await unlink(path.join('public/ocr/core', file))
for (const file of await readdir(core))
  if (/-lstm\.wasm\.js$/.test(file))
    await copyFile(path.join(core, file), path.join('public/ocr/core', file))
for (const file of [
  'public/fonts/NotoSansSC-Regular.otf',
  'public/ocr/lang/eng.traineddata',
  'public/ocr/lang/chi_sim.traineddata',
]) {
  await access(file).catch(() => {
    throw new Error(`Missing ${file}. Run node scripts/fetch-reading-assets.mjs.`)
  })
}
console.log('Offline export fonts and OCR resources are ready.')
