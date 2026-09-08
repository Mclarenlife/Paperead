import JSZip from 'jszip'
import { db } from './db'
import { safeFilename } from './utils'
import { saveFile } from './platform'

export async function exportPapers(ids: string[]) {
  const snapshot = await db.transaction('r', db.papers, db.assets, db.pages, async () => {
    const selected = (await db.papers.bulkGet(ids)).filter((paper) => paper && !paper.deletedAt)
    return Promise.all(
      selected.map(async (paper) => ({
        paper: paper!,
        asset: await db.assets.get(paper!.id),
        pages: await db.pages.where('paperId').equals(paper!.id).sortBy('number'),
      })),
    )
  })
  if (!snapshot.length) throw new Error('请选择要导出的文献。')
  const zip = new JSZip()
  for (const [index, { paper, asset, pages }] of snapshot.entries()) {
    const prefix = `${String(index + 1).padStart(3, '0')}-${safeFilename(paper.title)}`
    if (paper.sample) zip.file(`${prefix}-演示导读.md`, pages.map((page) => page.text).join('\n\n'))
    else if (asset?.pdf) zip.file(`${prefix}.pdf`, await asset.pdf.arrayBuffer())
    else throw new Error(`「${paper.title}」的 PDF 缺失，导出已停止。`)
  }
  zip.file(
    '文献信息.json',
    JSON.stringify(
      snapshot.map(({ paper }) => paper),
      null,
      2,
    ),
  )
  return saveFile(
    `Paperead-文献-${snapshot.length}篇.zip`,
    await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }),
  )
}
