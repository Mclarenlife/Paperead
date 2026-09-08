import { db } from './db'
import { platformFetch } from './platform'
import { uid } from './utils'
import type { Paper } from '../types'
import { abortable } from './ai-stream'
export interface ReferenceMetadata {
  title: string
  authors: string
  year: number
  venue: string
  abstract: string
  doi: string
}
const strip = (s: unknown) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .trim()
export function normalizeDoi(value: string) {
  const doi = value
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .replace(/[.,;]+$/, '')
  if (!doi) return ''
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 200)
    throw new Error('DOI 格式无效，例如 10.1038/nphys1170。')
  return doi.toLowerCase()
}
export function detectDoi(text: string) {
  const found = text.match(/\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/i)?.[0]
  try {
    return found ? normalizeDoi(found) : ''
  } catch {
    return ''
  }
}
export function abstractFromText(text: string) {
  const match = text.match(
    /(?:^|\n)\s*(?:abstract|摘\s*要)\s*[:：—-]?\s*([\s\S]{40,6000}?)(?=\n\s*(?:keywords|index terms|关\s*键\s*词|(?:1[.\s]+)?introduction|引言|引\s*言)\b|\n\s*1[.\s]+|$)/i,
  )
  return match?.[1]?.trim() || ''
}
export async function lookupDoi(value: string, signal?: AbortSignal): Promise<ReferenceMetadata> {
  const doi = normalizeDoi(value)
  if (!doi) throw new Error('请先填写 DOI。')
  const controller = new AbortController(),
    cancel = () => controller.abort()
  signal?.throwIfAborted()
  signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, 30_000)
  try {
    const response = await abortable(
      platformFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
      controller.signal,
    )
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? 'Crossref 未找到该 DOI，请手动补充或核对 DOI。'
          : `DOI 查询失败（HTTP ${response.status}）。`,
      )
    const { message: m } = await abortable(response.json(), controller.signal)
    if (!m?.title?.[0]) throw new Error('DOI 服务没有返回有效文献信息。')
    return {
      doi,
      title: strip(m.title[0]),
      authors: (m.author || [])
        .map((a: any) => [a.given, a.family].filter(Boolean).join(' ') || a.name)
        .join('; '),
      year:
        Number(
          (m['published-print'] || m['published-online'] || m.issued)?.['date-parts']?.[0]?.[0],
        ) || 0,
      venue: strip(m['container-title']?.[0]),
      abstract: strip(m.abstract),
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
async function citation() {
  const { Cite } = await import('@citation-js/core')
  await Promise.all([import('@citation-js/plugin-bibtex'), import('@citation-js/plugin-ris')])
  return Cite
}
export async function parseReferences(text: string): Promise<ReferenceMetadata[]> {
  if (text.length > 10_000_000) throw new Error('引用文件不能超过 10 MB。')
  const Cite = await citation(),
    data = new Cite(text).data
  if (!data.length || data.length > 5000)
    throw new Error('请导入包含 1–5000 条记录的 BibTeX 或 RIS 文件。')
  return data.map((m) => ({
    title: strip(m.title) || '未命名文献',
    authors: (m.author || [])
      .map((a: any) => a.literal || [a.given, a.family].filter(Boolean).join(' '))
      .join('; '),
    year: Number(m.issued?.['date-parts']?.[0]?.[0]) || 0,
    venue: strip(m['container-title']),
    abstract: strip(m.abstract),
    doi: m.DOI ? normalizeDoi(m.DOI) : '',
  }))
}
export async function importReferences(entries: ReferenceMetadata[]) {
  let added = 0,
    skipped = 0
  await db.transaction('rw', db.papers, db.pages, async () => {
    for (const metadata of entries) {
      if (metadata.doi && (await db.papers.where('doi').equals(metadata.doi).first())) {
        skipped++
        continue
      }
      const id = uid(),
        now = Date.now()
      const paper: Paper = {
        ...metadata,
        id,
        hash: `reference:${id}`,
        metadataStatus: 'unverified',
        metadataSource: 'BibTeX / RIS',
        referenceOnly: true,
        tags: [],
        collectionId: '',
        starred: false,
        status: 'unread',
        currentPage: 1,
        pageCount: 1,
        createdAt: now,
        lastReadAt: 0,
        color: 'sage',
        sample: false,
        size: 0,
      }
      await db.papers.add(paper)
      await db.pages.add({
        id: `${id}:1`,
        paperId: id,
        number: 1,
        text: `# ${paper.title}\n\n${paper.abstract}`,
        extractionVersion: 2,
      })
      added++
    }
  })
  return { added, skipped }
}
export async function bibliography(papers: Paper[], format: 'bibtex' | 'ris') {
  const Cite = await citation()
  return new Cite(
    papers.map((p) => ({
      id: p.id,
      type: 'article-journal',
      title: p.title,
      DOI: p.doi || undefined,
      'container-title': p.venue,
      abstract: p.abstract,
      issued: p.year ? { 'date-parts': [[p.year]] } : undefined,
      author: p.authors
        .split(/;|；/)
        .filter(Boolean)
        .map((name) => ({ literal: name.trim() })),
    })),
  ).format(format)
}
