import JSZip from 'jszip'
import { z } from 'zod'
import { db } from './db'
import type { Asset, Attachment } from '../types'
import { allDrafts } from './note-drafts'
import { hasResultDrafts } from './results'

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w-]+$/)
const text = z.string().max(5_000_000)
const locationSchema = z.object({
  source: z.enum(['original', 'translation', 'reflow']),
  page: z.number().int().positive(),
  jobId: id.optional(),
  progress: z.number().min(0).max(1),
})
const paperSchema = z.object({
  doi: z.string().max(200).optional(),
  metadataStatus: z.enum(['unverified', 'verified']).optional(),
  metadataSource: z.string().max(500).optional(),
  excerpt: text.optional(),
  referenceOnly: z.boolean().optional(),
  bookmarks: z
    .array(locationSchema.extend({ id, name: z.string().max(200), createdAt: z.number() }))
    .max(1000)
    .optional(),
  readingPositions: z.record(z.string().max(250), locationSchema).optional(),
  lastLocation: locationSchema.optional(),
  deletedAt: z.number().positive().optional(),
  id,
  hash: z.string().min(1),
  title: text,
  authors: text,
  year: z.number().int(),
  venue: text,
  abstract: text,
  tags: z.array(z.string().max(200)).max(100),
  collectionId: z.string(),
  starred: z.boolean(),
  status: z.enum(['unread', 'reading', 'finished']),
  currentPage: z.number().int().positive(),
  pageCount: z.number().int().positive().max(1500),
  createdAt: z.number(),
  lastReadAt: z.number(),
  color: z.string(),
  sample: z.boolean(),
  size: z.number().nonnegative(),
})
const provider = z.enum(['openai', 'compatible', 'anthropic', 'gemini'])
export const backupSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  createdAt: z.number(),
  papers: z.array(paperSchema).max(10000),
  collections: z.array(z.object({ id, name: text, color: z.string() })),
  pages: z.array(
    z.object({
      id: z.string(),
      paperId: id,
      number: z.number().int().positive(),
      text,
      extractionVersion: z.union([z.literal(2), z.literal(3)]).optional(),
      extractionWarnings: z.array(z.string().max(500)).max(20).optional(),
      recognition: z
        .object({
          engine: z.enum(['local', 'vision']),
          confidence: z.number().min(0).max(100).optional(),
          model: z.string().optional(),
          updatedAt: z.number(),
        })
        .optional(),
    }),
  ),
  notes: z.array(
    z.object({
      id,
      paperId: id.optional(),
      title: text,
      markdown: text,
      updatedAt: z.number(),
      deletedAt: z.number().positive().optional(),
      folderId: z.string().optional(),
      tags: z.array(z.string().max(200)).max(100).optional(),
      history: z
        .array(z.object({ id, title: text, markdown: text, createdAt: z.number() }))
        .max(30)
        .optional(),
    }),
  ),
  annotations: z.array(
    z.object({
      deletedAt: z.number().positive().optional(),
      id,
      paperId: id,
      source: z.enum(['original', 'translation', 'reflow']),
      page: z.number().int().positive(),
      quote: text,
      comment: text,
      color: z.enum(['yellow', 'green', 'purple']),
      rects: z.array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        }),
      ),
      start: z.number().int().nonnegative().optional(),
      end: z.number().int().nonnegative().optional(),
      createdAt: z.number(),
      jobId: id.optional(),
      scope: z.literal('document').optional(),
    }),
  ),
  jobs: z.array(
    z.object({
      recognition: z
        .object({
          engine: z.enum(['local', 'vision']),
          language: z.enum(['eng', 'eng+chi_sim']),
          keepImages: z.boolean(),
        })
        .optional(),
      name: z.string().max(200).optional(),
      revisionOf: id.optional(),
      editedMarkdown: text.optional(),
      inputJobId: id.optional(),
      inputName: text.optional(),
      id,
      paperId: id,
      kind: z.enum(['translation', 'reflow']),
      provider,
      model: text,
      baseUrl: z.string(),
      language: text,
      timeoutSeconds: z.number().min(30).max(900).optional(),
      stream: z.boolean().optional(),
      thinkingMode: z.enum(['auto', 'provider', 'low', 'high']).optional(),
      concurrency: z.number().int().min(1).max(3).optional(),
      chunkSize: z.number().int().min(1000).max(6000).optional(),
      maxOutputTokens: z.number().int().min(1024).max(32768).optional(),
      promptVersion: z.number().int().optional(),
      documentVersion: z.literal(2).optional(),
      documentTitle: text.optional(),
      sourceWarning: text.optional(),
      bilingual: z.boolean().optional(),
      batchSize: z.number().int().min(1000).max(16000).optional(),
      status: z.enum(['running', 'completed', 'failed', 'cancelled']),
      chunks: z.array(
        z.object({
          page: z.number().int().positive(),
          endPage: z.number().int().positive().optional(),
          input: text,
          output: text.optional(),
          timing: z
            .object({
              queueMs: z.number().nonnegative(),
              firstTextMs: z.number().nonnegative().optional(),
              totalMs: z.number().nonnegative(),
            })
            .optional(),
          paragraphs: z
            .array(
              z.object({
                id: z.string().min(1).max(100),
                text,
                page: z.number().int().positive(),
                endPage: z.number().int().positive(),
              }),
            )
            .optional(),
          contextBefore: text.optional(),
          contextAfter: text.optional(),
        }),
      ),
      error: text.optional(),
      updatedAt: z.number(),
    }),
  ),
  noteFolders: z.array(z.object({ id, name: z.string().max(200) })).default([]),
  attachments: z
    .array(
      z.object({
        id,
        name: z.string().max(1000),
        mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        createdAt: z.number(),
        size: z
          .number()
          .nonnegative()
          .max(10 * 1024 * 1024),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .default([]),
})

export async function createBackup(): Promise<Blob> {
  if (allDrafts().length || hasResultDrafts())
    throw new Error('请先处理未保存的笔记或校对草稿（保存，或导出后放弃草稿），再备份资料库。')
  const snapshot = await db.transaction(
    'r',
    [
      db.papers,
      db.collections,
      db.pages,
      db.notes,
      db.annotations,
      db.jobs,
      db.assets,
      db.noteFolders,
      db.attachments,
    ],
    async () => ({
      version: 4 as const,
      createdAt: Date.now(),
      papers: await db.papers.toArray(),
      collections: await db.collections.toArray(),
      pages: await db.pages.toArray(),
      notes: await db.notes.toArray(),
      annotations: await db.annotations.toArray(),
      jobs: await db.jobs.toArray(),
      assets: await db.assets.toArray(),
      noteFolders: await db.noteFolders.toArray(),
      attachments: await db.attachments.toArray(),
    }),
  )
  const { assets, attachments, ...data } = snapshot
  const manifest = {
    ...data,
    attachments: [] as {
      id: string
      name: string
      mime: string
      createdAt: number
      size: number
      sha256: string
    }[],
  }
  const zip = new JSZip()
  for (const attachment of attachments) {
    const bytes = await attachment.blob.arrayBuffer()
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    manifest.attachments.push({
      id: attachment.id,
      name: attachment.name,
      mime: attachment.mime,
      createdAt: attachment.createdAt,
      size: bytes.byteLength,
      sha256,
    })
    zip.file(`attachments/${attachment.id}`, bytes)
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const asset of assets) {
    if (asset.pdf) zip.file(`papers/${asset.paperId}.pdf`, await asset.pdf.arrayBuffer())
    if (asset.thumbnail) zip.file(`previews/${asset.paperId}.txt`, asset.thumbnail)
  }
  for (const note of manifest.notes) zip.file(`notes/${note.id}.md`, note.markdown)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export interface RestorePreview {
  papers: { id: string; title: string; overwrite: boolean }[]
  notes: { id: string; title: string; overwrite: boolean }[]
  attachments: number
  createdAt: number
  version: number
}
export async function restoreBackup(
  file: Blob,
  options: { preview?: boolean; snapshot?: boolean } = {},
): Promise<number | RestorePreview> {
  if (allDrafts().length || hasResultDrafts())
    throw new Error('请先处理未保存的笔记或校对草稿（保存，或导出后放弃草稿），再恢复备份。')
  if (file.size > 500 * 1024 * 1024) throw new Error('备份文件超过 500 MB。')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entry = zip.file('manifest.json')
  if (!entry) throw new Error('不是 Paperead 备份：缺少 manifest.json。')
  const raw = await entry.async('string')
  if (raw.length > 100_000_000) throw new Error('备份清单过大。')
  const parsed = backupSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error('备份结构或版本不受支持，当前数据未修改。')
  const data = parsed.data
  const papers = new Map(data.papers.map((p) => [p.id, p]))
  for (const paper of data.papers) {
    const locations = [
      ...(paper.bookmarks || []),
      ...Object.values(paper.readingPositions || {}),
      ...(paper.lastLocation ? [paper.lastLocation] : []),
    ]
    if (
      locations.some(
        (l) =>
          l.page > paper.pageCount ||
          (l.source !== 'original' &&
            !data.jobs.some(
              (j) => j.id === l.jobId && j.paperId === paper.id && j.kind === l.source,
            )),
      )
    )
      throw new Error('备份中的书签或阅读位置无效。')
  }
  const collections = new Set(data.collections.map((c) => c.id))
  const tables = [
    data.papers,
    data.collections,
    data.pages,
    data.notes,
    data.annotations,
    data.jobs,
    data.noteFolders,
    data.attachments,
  ]
  if (tables.some((rows) => new Set(rows.map((row) => row.id)).size !== rows.length))
    throw new Error('备份包含重复记录。')
  if (new Set(data.papers.map((p) => p.hash)).size !== data.papers.length)
    throw new Error('备份包含重复 PDF。')
  if (
    data.papers.some(
      (p) => p.currentPage > p.pageCount || (p.collectionId && !collections.has(p.collectionId)),
    )
  )
    throw new Error('备份文献信息不一致。')
  for (const row of [...data.pages, ...data.annotations, ...data.jobs]) {
    if (!papers.has(row.paperId)) throw new Error('备份包含无来源的文献记录。')
  }
  if (
    data.pages.some(
      (p) => p.id !== `${p.paperId}:${p.number}` || p.number > papers.get(p.paperId)!.pageCount,
    )
  )
    throw new Error('备份页码无效。')
  if (data.notes.some((n) => n.paperId && !papers.has(n.paperId)))
    throw new Error('备份笔记的文献关联无效。')
  if (
    data.annotations.some(
      (a) =>
        a.page > papers.get(a.paperId)!.pageCount ||
        (a.start !== undefined && (a.end === undefined || a.end <= a.start)) ||
        (a.scope === 'document' && (a.source === 'original' || !a.jobId)) ||
        (a.jobId &&
          !data.jobs.some(
            (j) => j.id === a.jobId && j.paperId === a.paperId && j.kind === a.source,
          )),
    )
  )
    throw new Error('备份中的批注定位或结果版本无效。')
  if (
    data.jobs.some(
      (j) =>
        !j.chunks.length ||
        j.chunks.some((c) => c.page > papers.get(j.paperId)!.pageCount) ||
        (j.status === 'completed' && j.chunks.some((c) => !c.output?.trim())),
    )
  )
    throw new Error('备份中的 AI 任务不完整。')
  for (const job of data.jobs) {
    const paragraphIds = new Set<string>()
    let previousPage = 0
    for (const chunk of job.chunks) {
      const endPage = chunk.endPage ?? chunk.page
      if (
        endPage < chunk.page ||
        endPage > papers.get(job.paperId)!.pageCount ||
        chunk.page < previousPage
      )
        throw new Error('备份中的 AI 正文顺序或来源页码无效。')
      previousPage = chunk.page
      if (
        job.bilingual &&
        (job.kind !== 'translation' || job.documentVersion !== 2 || !chunk.paragraphs?.length)
      )
        throw new Error('备份中的对照翻译缺少段落。')
      let previousParagraphPage = chunk.page
      for (const paragraph of chunk.paragraphs || []) {
        if (
          !/^[\w-]+$/.test(paragraph.id) ||
          paragraphIds.has(paragraph.id) ||
          !paragraph.text.trim() ||
          paragraph.page < previousParagraphPage ||
          paragraph.endPage < paragraph.page ||
          paragraph.endPage > endPage
        )
          throw new Error('备份中的对照翻译段落无效或重复。')
        paragraphIds.add(paragraph.id)
        previousParagraphPage = paragraph.page
      }
    }
  }
  const assets: Asset[] = []
  for (const paper of data.papers) {
    if (data.pages.filter((p) => p.paperId === paper.id).length !== paper.pageCount)
      throw new Error('备份缺少文献页面。')
    const asset = zip.file(`papers/${paper.id}.pdf`)
    if (!paper.sample && !paper.referenceOnly && !asset)
      throw new Error(`备份缺少 PDF：${paper.title}`)
    if (asset) {
      const bytes = await asset.async('uint8array')
      if (
        bytes.length > 100 * 1024 * 1024 ||
        !new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')
      )
        throw new Error('备份中的 PDF 无效或过大。')
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      if (!paper.sample && hash !== paper.hash) throw new Error('备份中的 PDF 校验值不匹配。')
      const preview = await zip.file(`previews/${paper.id}.txt`)?.async('string')
      const thumbnail =
        preview &&
        preview.length < 2_000_000 &&
        /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(preview)
          ? preview
          : undefined
      assets.push({
        paperId: paper.id,
        pdf: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        thumbnail,
      })
    }
  }
  const folderIds = new Set(data.noteFolders.map((f) => f.id))
  if (data.notes.some((n) => n.folderId && !folderIds.has(n.folderId)))
    throw new Error('笔记文件夹关联无效。')
  const attachmentIds = new Set(data.attachments.map((a) => a.id))
  const contents = [
    ...data.notes.flatMap((n) => [n.markdown, ...(n.history || []).map((h) => h.markdown)]),
    ...data.pages.map((p) => p.text),
    ...data.jobs.flatMap((j) => [j.editedMarkdown || '', ...j.chunks.map((c) => c.output || '')]),
  ]
  for (const content of contents)
    for (const match of content.matchAll(/paperead-attachment:([\w-]+)/g))
      if (!attachmentIds.has(match[1])) throw new Error('备份中的图片引用缺少附件。')
  const attachments: Attachment[] = []
  for (const row of data.attachments) {
    const entry = zip.file(`attachments/${row.id}`)
    if (!entry) throw new Error(`备份缺少图片附件：${row.name}`)
    const bytes = await entry.async('uint8array')
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    if (bytes.length !== row.size || digest !== row.sha256) throw new Error('图片附件校验失败。')
    attachments.push({
      id: row.id,
      name: row.name,
      mime: row.mime,
      createdAt: row.createdAt,
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: row.mime }),
    })
  }
  if (options.preview) {
    const currentPapers = new Set(await db.papers.toCollection().primaryKeys()),
      currentNotes = new Set(await db.notes.toCollection().primaryKeys())
    return {
      papers: data.papers.map((p) => ({
        id: p.id,
        title: p.title,
        overwrite: currentPapers.has(p.id),
      })),
      notes: data.notes.map((n) => ({
        id: n.id,
        title: n.title,
        overwrite: currentNotes.has(n.id),
      })),
      attachments: attachments.length,
      createdAt: data.createdAt,
      version: data.version,
    }
  }
  if (await db.jobs.where('status').equals('running').count())
    throw new Error('请先暂停正在运行的 AI 任务，再恢复备份。')
  if (options.snapshot !== false)
    await (await import('./snapshots')).createSnapshot('before-restore')
  await db.transaction(
    'rw',
    [
      db.papers,
      db.assets,
      db.collections,
      db.pages,
      db.notes,
      db.annotations,
      db.jobs,
      db.meta,
      db.noteFolders,
      db.attachments,
    ],
    async () => {
      // Replacing a paper also replaces its dependent snapshot, avoiding stale pages/results.
      if (
        allDrafts().length ||
        hasResultDrafts() ||
        (await db.jobs.where('status').equals('running').count())
      )
        throw new Error('资料库正在编辑或处理任务，请稍后重新恢复。')
      const ids = data.papers.map((p) => p.id)
      await db.assets.where('paperId').anyOf(ids).delete()
      await db.pages.where('paperId').anyOf(ids).delete()
      await db.annotations.where('paperId').anyOf(ids).delete()
      await db.jobs.where('paperId').anyOf(ids).delete()
      await db.collections.bulkPut(data.collections)
      await db.papers.bulkPut(data.papers)
      await db.assets.bulkPut(assets)
      await db.pages.bulkPut(data.pages)
      await db.notes.bulkPut(data.notes)
      await db.noteFolders.bulkPut(data.noteFolders)
      await db.attachments.bulkPut(attachments)
      await db.annotations.bulkPut(data.annotations)
      await db.jobs.bulkPut(
        data.jobs.map((j) => ({
          ...j,
          status: j.status === 'running' ? ('cancelled' as const) : j.status,
        })),
      )
      await db.meta.put({ key: 'initialized', value: 'true' })
    },
  )
  return data.papers.length
}
