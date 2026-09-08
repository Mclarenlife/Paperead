import {
  getDocument as loadDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { db } from './db'
import { uid } from './utils'
import { extractPdfLayout } from './pdf-layout'
import type { Page, Paper } from '../types'
import { abstractFromText, detectDoi } from './metadata'

GlobalWorkerOptions.workerSrc = workerUrl
export const getDocument = (options: DocumentInitParameters) =>
  loadDocument({
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
    ...options,
  })

export async function importPdf(
  file: File,
  collectionId = '',
  progress?: (text: string) => void,
  attachTo?: string,
): Promise<Paper> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')
    throw new Error('请选择 PDF 文件。')
  if (file.size > 100 * 1024 * 1024) throw new Error('当前版本支持单个 100 MB 以内的 PDF。')
  const bytes = await file.arrayBuffer()
  const header = new TextDecoder().decode(bytes.slice(0, 1024))
  if (!header.includes('%PDF-')) throw new Error('文件不是有效的 PDF。')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const duplicate = await db.papers.where('hash').equals(hash).first()
  if (duplicate)
    throw new Error(
      duplicate.deletedAt
        ? `「${file.name}」已在回收站中，请先恢复或彻底删除后重新导入。`
        : `「${file.name}」已在文献库中。`,
    )
  let pdf: PDFDocumentProxy | undefined
  const loadingTask = getDocument({ data: bytes })
  try {
    pdf = await loadingTask.promise
    if (pdf.numPages > 1500) throw new Error('当前版本支持 1500 页以内的文献，请拆分后导入。')
    const existing = attachTo ? await db.papers.get(attachTo) : undefined
    if (attachTo && (!existing || !existing.referenceOnly || existing.deletedAt))
      throw new Error('只能为有效的纯引用记录附加 PDF。')
    const id = attachTo || uid(),
      pages: Page[] = []
    let thumbnail: string | undefined
    for (let number = 1; number <= pdf.numPages; number++) {
      progress?.(`正在解析 ${file.name} · ${number} / ${pdf.numPages} 页`)
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const { text, warnings } = extractPdfLayout(
        content.items.filter((item) => 'str' in item),
        { page: number },
      )
      pages.push({
        id: `${id}:${number}`,
        paperId: id,
        number,
        text,
        extractionVersion: 3,
        extractionWarnings: warnings,
      })
      if (number === 1) {
        const base = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({ scale: 420 / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        thumbnail = canvas.toDataURL('image/webp', 0.75)
      }
      page.cleanup()
    }
    const metadata = await pdf.getMetadata().catch(() => null)
    const info = metadata?.info as
      { Title?: string; Author?: string; CreationDate?: string } | undefined
    const year = 0
    const extracted = pages.map((p) => p.text).join('\n')
    const now = Date.now()
    const paper: Paper = {
      id,
      hash,
      title: info?.Title?.trim() || file.name.replace(/\.pdf$/i, ''),
      authors: info?.Author || '作者待补充',
      year,
      metadataStatus: 'unverified',
      metadataSource: 'PDF 内置元数据 / 文本提取，待核验',
      doi: detectDoi(extracted.slice(0, 15000)),
      excerpt: extracted.slice(0, 800),
      venue: '',
      abstract: abstractFromText(extracted.slice(0, 15000)),
      tags: [],
      collectionId,
      starred: false,
      status: 'unread',
      currentPage: 1,
      pageCount: pdf.numPages,
      createdAt: now,
      lastReadAt: 0,
      color: ['sage', 'lavender', 'sand', 'blue'][Math.floor(Math.random() * 4)],
      sample: false,
      size: file.size,
    }
    if (existing)
      Object.assign(paper, {
        title: existing.title,
        authors: existing.authors,
        year: existing.year,
        venue: existing.venue,
        abstract: existing.abstract || paper.abstract,
        doi: existing.doi || paper.doi,
        tags: existing.tags,
        collectionId: existing.collectionId,
        starred: existing.starred,
        metadataStatus: existing.metadataStatus,
        metadataSource: existing.metadataSource,
        createdAt: existing.createdAt,
        referenceOnly: false,
      })
    await db.transaction('rw', [db.papers, db.assets, db.pages], async () => {
      if (existing) await db.pages.where('paperId').equals(id).delete()
      await db.papers.put(paper)
      await db.assets.put({
        paperId: id,
        pdf: new Blob([file], { type: 'application/pdf' }),
        thumbnail,
      })
      await db.pages.bulkAdd(pages)
    })
    return paper
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('此 PDF 需要密码，请先解锁后再导入。')
    throw error
  } finally {
    await loadingTask.destroy()
  }
}

const refreshing = new Map<string, Promise<Page[]>>()
// Upgrade text from older imports once, without changing PDF selection coordinates.
export function refreshDocumentPages(paperId: string): Promise<Page[]> {
  const existing = refreshing.get(paperId)
  if (existing) return existing
  const work = (async () => {
    const asset = await db.assets.get(paperId)
    if (!asset?.pdf) throw new Error('PDF 原文件缺失，无法恢复段落。请从备份恢复文献。')
    const task = getDocument({ data: await asset.pdf.arrayBuffer() })
    try {
      const pdf = await task.promise,
        pages: Page[] = []
      const existingPages = await db.pages.where('paperId').equals(paperId).toArray()
      for (let number = 1; number <= pdf.numPages; number++) {
        const existing = existingPages.find((p) => p.number === number)
        // Recognition is authoritative: never overwrite OCR / vision with a
        // newer text-layer extractor when another page needs upgrading.
        if (existing?.recognition || existing?.extractionVersion === 3) {
          pages.push(existing)
          continue
        }
        const page = await pdf.getPage(number),
          content = await page.getTextContent()
        const result = extractPdfLayout(
          content.items.filter((item) => 'str' in item),
          { page: number },
        )
        pages.push({
          id: `${paperId}:${number}`,
          paperId,
          number,
          text: result.text,
          extractionVersion: 3,
          extractionWarnings: result.warnings,
        })
        page.cleanup()
      }
      await db.transaction('rw', db.pages, db.papers, async () => {
        if (!(await db.papers.get(paperId))) throw new Error('文献已被删除。')
        for (const next of pages) {
          const current = await db.pages.get(next.id)
          if (current?.recognition && !next.recognition) Object.assign(next, current)
          else await db.pages.put(next)
        }
      })
      return pages
    } finally {
      await task.destroy()
    }
  })()
  refreshing.set(paperId, work)
  void work.finally(() => refreshing.delete(paperId)).catch(() => {})
  return work
}
