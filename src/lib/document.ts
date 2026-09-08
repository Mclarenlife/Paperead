import type { Job, JobChunk, Page, SourceParagraph } from '../types'
import { extractPdfLayout, type PdfTextItem } from './pdf-layout'
import { headingLevel, normalizeAcademicMarkdown, protectedSpans } from './academic-markdown'

const heading = (line: string) =>
  /^#{1,6}\s|^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+\p{Lu}|^(?:abstract|introduction|conclusions?|references|acknowledg(?:e)?ments|摘要|参考文献)\s*$/iu.test(
    line,
  )
const list = (line: string) => /^(?:[-*+]\s|\d+[.)]\s|\[\d+\]\s|>\s|\|)/.test(line)
const sentenceEnd = (text: string) => /[.!?。！？:：;；]["'”’）)\]]*$/.test(text)

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
    let current = '',
      fenced = false,
      math = false,
      block = ''
    const flush = () => {
      if (current.trim()) blocks.push(current.trim())
      current = ''
      block = ''
    }
    for (const raw of page.text.replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trim()
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
        !/^```|^~~~|^\$\$/.test(text) &&
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

function splitLongParagraph(text: string, budget: number) {
  // Display equations, tables and code blocks must remain valid structures.
  if (/^(?:\$\$|\\\[|```|~~~|\|)/.test(text)) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > budget) {
    const prefix = rest.slice(0, budget)
    const breaks = [...prefix.matchAll(/[.!?。！？]["'”’）)\]]*(?:\s+|(?=[\u3400-\u9fff]))/g)]
    let end = breaks.at(-1)
      ? breaks.at(-1)!.index! + breaks.at(-1)![0].length
      : prefix.lastIndexOf(' ')
    if (end < budget / 3) end = budget
    const span = protectedSpans(rest).find((s) => s.start < end && s.end > end)
    if (span) end = span.start > 0 ? span.start : span.end
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--
    parts.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trimStart()
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
  const paragraphs = documentParagraphs(pages).flatMap((paragraph) =>
    splitLongParagraph(paragraph.text, budget).map((text, index) => ({
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
    const limit = !chunks.length ? Math.min(budget, Math.max(500, firstBudget)) : budget
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

export const paragraphMarker = (id: string) => `<!-- paperead:${id} -->`
export const quoteSource = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')

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
    throw new Error(
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
