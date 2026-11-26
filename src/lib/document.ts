import type { Job, JobChunk, Page, SourceParagraph } from '../types'
import { extractPdfLayout, type PdfTextItem } from './pdf-layout'
import { headingLevel, normalizeAcademicMarkdown, protectedSpans } from './academic-markdown'

const heading = (line: string) =>
  /^#{1,6}\s|^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+\p{Lu}|^(?:abstract|introduction|conclusions?|references|acknowledg(?:e)?ments|摘要|参考文献)\s*$/iu.test(
    line,
  )
const list = (line: string) => /^(?:[-*+]\s|\d+[.)]\s|\[\d+\]\s|>\s|\|)/.test(line)
const sentenceEnd = (text: string) => /[.!?。！？:：;；]["'”’）)\]]*$/.test(text)
const displayOrFence = /^(?:\$\$|\\\[|\\begin\{|`{3,}|~{3,})/

export function pdfParagraphText(items: PdfTextItem[]): string {
  return extractPdfLayout(items).text
}
function joinLines(left: string, right: string) {
  const tight =
    /[-\u00ad]$/.test(left) || (/[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff]/.test(right))
  return (
    left.replace(/\u00ad$/, '').replace(/-$/, /^[a-z]/.test(right) ? '' : '-') +
    (tight ? '' : ' ') +
    right
  )
}

// Recover prose paragraphs, preserving explicit Markdown blocks and blank lines.
// Physical page boundaries remain provenance, not request or output boundaries.
export function documentParagraphs(pages: Pick<Page, 'number' | 'text'>[]): SourceParagraph[] {
  const all: SourceParagraph[] = []
  for (const page of [...pages].sort((a, b) => a.number - b.number)) {
    const blocks: string[] = []
    const source = page.text.replace(/\r\n?/g, '\n')
    // A display block can come from the PDF extractor or from vision OCR.
    // Preserve its interior verbatim: prose dehyphenation could remove a minus.
    const displays = protectedSpans(source).filter(({ start, end }) => {
      if (!displayOrFence.test(source.slice(start, start + 10))) return false
      const lineEnd = source.indexOf('\n', end)
      return (
        !source.slice(source.lastIndexOf('\n', start - 1) + 1, start).trim() &&
        !source.slice(end, lineEnd === -1 ? source.length : lineEnd).trim()
      )
    })
    let offset = 0,
      displayIndex = 0
    let current = '',
      fenced = false,
      math = false,
      block = ''
    const flush = () => {
      if (current.trim()) blocks.push(current.trim())
      current = ''
      block = ''
    }
    for (const raw of source.split('\n')) {
      const line = raw.trim()
      const lineEnd = offset + raw.length,
        display = displays[displayIndex]
      offset = lineEnd + 1
      if (display && display.start <= lineEnd) {
        flush()
        if (display.end <= lineEnd) {
          blocks.push(source.slice(display.start, display.end))
          displayIndex++
        }
        continue
      }
      if (/^```|^~~~/.test(line)) {
        if (!fenced) flush()
        current += (current ? '\n' : '') + raw
        fenced = !fenced
        if (!fenced) flush()
        continue
      }
      if (fenced) {
        current += '\n' + raw
        continue
      }
      if (/^\$\$/.test(line)) {
        if (!math) flush()
        current += (current ? '\n' : '') + raw
        if (math || (line.length > 4 && line.endsWith('$$'))) {
          math = false
          flush()
        } else math = true
        continue
      }
      if (math) {
        current += '\n' + raw
        continue
      }
      if (!line) {
        flush()
        continue
      }
      if (heading(line)) {
        flush()
        blocks.push(line)
        continue
      }
      if (list(line)) {
        const kind = line.startsWith('|') ? 'table' : line.startsWith('>') ? 'quote' : 'list'
        if (block !== kind) flush()
        current += (current ? '\n' : '') + line
        block = kind
        continue
      }
      if (block) flush()
      current = current ? joinLines(current, line) : line
    }
    flush()
    for (let i = 0; i < blocks.length; i++) {
      const text = blocks[i],
        previous = all.at(-1)
      if (
        i === 0 &&
        previous &&
        previous.endPage === page.number - 1 &&
        !sentenceEnd(previous.text) &&
        !heading(previous.text) &&
        !list(previous.text) &&
        !heading(text) &&
        !list(text) &&
        !displayOrFence.test(previous.text) &&
        !displayOrFence.test(text) &&
        previous.text.length > 80 &&
        /^[\p{Ll}\u3400-\u9fff]/u.test(text)
      ) {
        previous.text = joinLines(previous.text, text)
        previous.endPage = page.number
      } else all.push({ id: '', text, page: page.number, endPage: page.number })
    }
  }
  return all.map((paragraph, index) => ({
    ...paragraph,
    id: `p${String(index + 1).padStart(5, '0')}`,
  }))
}

function splitLongParagraph(text: string, budget: number, firstBudget = budget) {
  // Display equations, tables and code blocks must remain valid structures.
  if (displayOrFence.test(text) || text.startsWith('|')) return [text]
  const parts: string[] = []
  let rest = text
  let limit = firstBudget
  while (rest.length > limit) {
    const prefix = rest.slice(0, limit)
    const breaks = [...prefix.matchAll(/[.!?。！？]["'”’）)\]]*(?:\s+|(?=[\u3400-\u9fff]))/g)]
    let end = breaks.at(-1)
      ? breaks.at(-1)!.index! + breaks.at(-1)![0].length
      : prefix.lastIndexOf(' ')
    if (end < limit / 3) end = limit
    const span = protectedSpans(rest).find((s) => s.start < end && s.end > end)
    if (span) end = span.start > 0 ? span.start : span.end
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--
    parts.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trimStart()
    limit = budget
  }
  if (rest) parts.push(rest)
  return parts
}

export function planDocument(
  pages: Pick<Page, 'number' | 'text'>[],
  budget: number,
  firstBudget = budget,
): JobChunk[] {
  budget = Math.max(500, Math.floor(budget))
  const initial = Math.max(500, Math.min(budget, firstBudget))
  const paragraphs = documentParagraphs(pages).flatMap((paragraph, n) =>
    splitLongParagraph(paragraph.text, budget, n === 0 ? initial : budget).map((text, index) => ({
      ...paragraph,
      id: `${paragraph.id}-${index + 1}`,
      text,
    })),
  )
  const chunks: JobChunk[] = []
  let group: SourceParagraph[] = [],
    length = 0
  const flush = () => {
    if (!group.length) return
    chunks.push({
      page: group[0].page,
      endPage: group.at(-1)!.endPage,
      input: group.map((paragraph) => paragraph.text).join('\n\n'),
      paragraphs: group,
    })
    group = []
    length = 0
  }
  for (const paragraph of paragraphs) {
    const limit = !chunks.length ? initial : budget
    if (group.length && length + paragraph.text.length + 2 > limit) flush()
    group.push(paragraph)
    length += paragraph.text.length + 2
  }
  flush()
  return chunks.map((chunk, index) => ({
    ...chunk,
    contextBefore: chunks[index - 1]?.input.slice(-500) || '',
    contextAfter: chunks[index + 1]?.input.slice(0, 500) || '',
  }))
}

// Subdivide the saved source snapshot; opening the PDF here could replace text
// underneath previous translation checkpoints or annotations.
export function smallerTranslationChunks(
  chunk: JobChunk,
  budget: number,
  { afterFailure = false, bilingual = false }: { afterFailure?: boolean; bilingual?: boolean } = {},
): JobChunk[] {
  if (chunk.output || (afterFailure && chunk.sizeRetry)) return [chunk]
  const paragraphs = bilingual ? chunk.paragraphs : undefined
  const source = paragraphs?.map((p) => p.text).join('\n\n') ?? chunk.input
  const limit = afterFailure ? Math.max(500, Math.ceil(source.length / 2)) : budget
  if (source.length <= limit) return [chunk]

  // Bilingual originals stay whole, retaining their IDs and exact source text.
  // Plain jobs from older versions only store the text and the overall page range.
  let units: SourceParagraph[]
  if (paragraphs?.length) units = paragraphs
  else {
    const spans = protectedSpans(source)
    const blocks: string[] = []
    let start = 0,
      spanIndex = 0
    for (const gap of source.matchAll(/\n[ \t]*\n+/g)) {
      while (spanIndex < spans.length && spans[spanIndex].end <= gap.index) spanIndex++
      if (spans[spanIndex] && spans[spanIndex].start < gap.index + gap[0].length) continue
      blocks.push(source.slice(start, gap.index))
      start = gap.index + gap[0].length
    }
    blocks.push(source.slice(start))
    units = blocks.flatMap((block) =>
      splitLongParagraph(block, limit)
        .filter(Boolean)
        .map((text) => ({
          id: '',
          text,
          page: chunk.page,
          endPage: chunk.endPage ?? chunk.page,
        })),
    )
  }

  const groups: SourceParagraph[][] = []
  let group: SourceParagraph[] = [],
    length = 0
  for (const unit of units) {
    const newLength = length + (group.length ? 2 : 0) + unit.text.length
    const boundary = afterFailure
      ? !groups.length && Math.abs(limit - length) <= Math.abs(limit - newLength)
      : newLength > limit
    if (boundary && group.length) {
      groups.push(group)
      group = []
      length = 0
    }
    length += (group.length ? 2 : 0) + unit.text.length
    group.push(unit)
  }
  if (group.length) groups.push(group)
  if (groups.length < 2) return [chunk]
  const texts = groups.map((parts) => parts.map((p) => p.text).join('\n\n'))
  return groups.map((parts, i) => ({
    page: parts[0].page,
    endPage: parts.at(-1)!.endPage,
    input: paragraphs ? '' : texts[i],
    ...(paragraphs && { paragraphs: parts }),
    ...((afterFailure || chunk.sizeRetry) && { sizeRetry: true as const }),
    contextBefore: i ? texts[i - 1].slice(-500) : chunk.contextBefore,
    contextAfter: i + 1 < groups.length ? texts[i + 1].slice(0, 500) : chunk.contextAfter,
  }))
}

export const paragraphMarker = (id: string) => `<!-- paperead:${id} -->`
export const quoteSource = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

export class ParagraphAlignmentError extends Error {}

// Originals are assembled locally. The model never has to re-generate them.
export function bilingualMarkdown(
  chunk: JobChunk,
  response: string,
  partial = false,
  structured = false,
): string {
  const paragraphs = chunk.paragraphs || []
  const matches = [...response.matchAll(/^\s*<!--\s*paperead:([\w-]+)\s*-->[ \t]*\r?\n?/gm)]
  const bad = () => {
    throw new ParagraphAlignmentError(
      '对照翻译的段落标记缺失、重复或顺序不一致，未保存此批次。请继续重试或更换模型。',
    )
  }
  if (
    !partial &&
    (matches.length !== paragraphs.length ||
      !matches.length ||
      response.slice(0, matches[0].index).trim())
  )
    bad()
  const output: string[] = []
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index],
      paragraph = paragraphs[index]
    if (!paragraph || paragraph.id !== match[1]) {
      if (partial) break
      bad()
    }
    let translation = response
      .slice(match.index! + match[0].length, matches[index + 1]?.index)
      .trim()
    if (partial && index === matches.length - 1)
      translation = translation.replace(/\n?<!--[\s\S]*$/, '').trimEnd()
    if (!translation) {
      if (partial) break
      bad()
    }
    if (structured) {
      translation = normalizeAcademicMarkdown(translation)
      const level = headingLevel(paragraph.text)
      if (level)
        translation = `${'#'.repeat(level)} ${translation.replace(/^#{1,6}\s+/, '').trim()}`
    }
    output.push(`${quoteSource(paragraph.text)}\n\n${translation}`)
  }
  return output.join('\n\n')
}

export function continuousMarkdown(job: Job, showMissing = true) {
  const text = job.chunks
    .map(
      (chunk, index) =>
        chunk.output?.trim() || (showMissing ? `_[未完成的正文：批次 ${index + 1}]_` : ''),
    )
    .filter(Boolean)
    .join('\n\n')
  return job.sourceWarning ? `> ${job.sourceWarning}\n\n${text}` : text
}

export function documentPreview(job: Job, drafts: Record<number, { text: string }> = {}) {
  const firstMissing = job.chunks.findIndex((chunk) => !chunk.output)
  const end = firstMissing < 0 ? job.chunks.length : firstMissing
  const committed = job.chunks
    .slice(0, end)
    .map((chunk) => chunk.output!)
    .join('\n\n')
  const raw = drafts[end]?.text || ''
  const draft =
    raw && job.bilingual && job.documentVersion === 2
      ? bilingualMarkdown(job.chunks[end], raw, true, (job.promptVersion || 0) >= 4)
      : normalizeAcademicMarkdown(raw)
  const waiting =
    firstMissing >= 0 && job.chunks.slice(firstMissing + 1).some((chunk) => chunk.output)
  return { committed, draft, waiting }
}
