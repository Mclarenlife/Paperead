import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const assets = [
  [
    'fonts/NotoSansSC-Regular.otf',
    'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf',
  ],
  [
    'fonts/LICENSE-NOTO.txt',
    'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE',
  ],
  [
    'ocr/lang/eng.traineddata',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata',
  ],
  [
    'ocr/lang/chi_sim.traineddata',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/chi_sim.traineddata',
  ],
  [
    'ocr/LICENSE-TESSDATA.txt',
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/LICENSE',
  ],
]
const expected = JSON.parse(
  await readFile(new URL('./reading-assets.sha256.json', import.meta.url), 'utf8'),
)
function verify(name, bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected[name])
    throw new Error(
      `${name}: SHA-256 mismatch. Review upstream changes before updating the asset manifest.`,
    )
}
for (const [name, url] of assets) {
  const destination = path.join('public', name)
  if (
    await access(destination)
      .then(() => true)
      .catch(() => false)
  ) {
    verify(name, await readFile(destination))
    continue
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  verify(name, bytes)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  console.log(`${name}: ${bytes.length} bytes`)
}
