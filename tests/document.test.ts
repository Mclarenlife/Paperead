import { describe, expect, it } from 'vitest'
import {
  bilingualMarkdown,
  continuousMarkdown,
  documentParagraphs,
  documentPreview,
  paragraphMarker,
  pdfParagraphText,
  planDocument,
} from '../src/lib/document'
import { acquireRequest } from '../src/lib/ai-queue'
import type { Job } from '../src/types'

const samplePages = [
  {
    number: 1,
    text: '# Introduction\n\nThe first paragraph wraps\nonto a second line.\n\nSecond paragraph.',
  },
  {
    number: 2,
    text: 'Third paragraph from the next physical page.\n\n## Results\n\nThe final paragraph.',
  },
]

describe('continuous document planning and alignment', () => {
  it('packs paragraphs across physical pages and preserves headings, tables and math blocks', () => {
    const chunks = planDocument(samplePages, 6000)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ page: 1, endPage: 2 })
    expect(chunks[0].paragraphs?.map((p) => p.text)).toEqual([
      '# Introduction',
      'The first paragraph wraps onto a second line.',
      'Second paragraph.',
      'Third paragraph from the next physical page.',
      '## Results',
      'The final paragraph.',
    ])
    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |',
      math = '$$\nx = y + z\n$$'
    expect(
      documentParagraphs([{ number: 1, text: `${table}\n\n${math}\n\nLast paragraph.` }]).map(
        (p) => p.text,
      ),
    ).toEqual([table, math, 'Last paragraph.'])
  })
  it('conservatively joins prose continued on the next page without joining completed paragraphs', () => {
    const first =
      'This long paragraph describes a detailed analysis of the experiment and its underlying assumptions which'
    const paragraphs = documentParagraphs([
      { number: 2, text: 'remain valid.\n\nAnother paragraph.' },
      { number: 1, text: first },
    ])
    expect(paragraphs[0]).toMatchObject({ text: `${first} remain valid.`, page: 1, endPage: 2 })
    expect(paragraphs).toHaveLength(2)
  })
  it('recovers paragraph breaks from PDF geometry while joining adjacent text items', () => {
    const item = (str: string, x: number, y: number, width = 100, hasEOL = true) => ({
      str,
      transform: [10, 0, 0, 10, x, y],
      width,
      height: 10,
      hasEOL,
    })
    expect(
      pdfParagraphText([
        item('First', 50, 750, 20, false),
        item('line.', 74, 750),
        item('Wrapped continuation.', 50, 736),
        item('New paragraph.', 50, 710),
      ]),
    ).toBe('First line.\nWrapped continuation.\n\nNew paragraph.')
  })
  it('reduces 20 short pages to two requests and carries adjacent read-only context', () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      text: `Paragraph ${i + 1}: ` + 'source content '.repeat(25) + 'End.',
    }))
    const chunks = planDocument(pages, 6000)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].contextAfter).toBe(chunks[1].input.slice(0, 500))
    expect(chunks[1].contextBefore).toBe(chunks[0].input.slice(-500))
    expect(chunks.flatMap((c) => c.paragraphs!)).toHaveLength(20)
  })
  it('splits oversized paragraphs without losing content or splitting surrogate pairs', () => {
    const source = '测量结果😀'.repeat(400)
    const chunks = planDocument([{ number: 1, text: source }], 501)
    expect(chunks.map((c) => c.input).join('')).toBe(source)
    expect(
      chunks.every(
        (c) => c.input.length <= 501 && !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(c.input),
      ),
    ).toBe(true)
    expect(new Set(chunks.flatMap((c) => c.paragraphs!.map((p) => p.id))).size).toBe(chunks.length)
  })
  it('assembles exact original blockquotes locally and removes all control markers', () => {
    const chunk = planDocument(samplePages, 6000)[0]
    const response = chunk
      .paragraphs!.map((p, index) => `${paragraphMarker(p.id)}\n译文 ${index + 1}。`)
      .join('\n\n')
    const output = bilingualMarkdown(chunk, response)
    expect(output).toBe(
      chunk.paragraphs!.map((p, index) => `> ${p.text}\n\n译文 ${index + 1}。`).join('\n\n'),
    )
    expect(output).not.toContain('paperead:')
    const job = { chunks: [{ ...chunk, output }] } as Job
    expect(continuousMarkdown(job)).toBe(output)
    expect(continuousMarkdown(job)).not.toMatch(/source-page|\n---\n/)
  })
  it('rejects missing, duplicate, unknown and reordered bilingual paragraphs', () => {
    const chunk = planDocument([{ number: 1, text: 'First.\n\nSecond.' }], 6000)[0]
    const [a, b] = chunk.paragraphs!.map((p) => `${paragraphMarker(p.id)}\n译文。`)
    for (const response of [
      a,
      `${a}\n${a}`,
      `${b}\n${a}`,
      `${a}\n<!-- paperead:unknown -->\n译文`,
      `Here you go\n${a}\n${b}`,
      `${a}\n${paragraphMarker(chunk.paragraphs![1].id)}`,
    ])
      expect(() => bilingualMarkdown(chunk, response)).toThrow('段落标记')
    expect(bilingualMarkdown(chunk, `${a}\n<!-- paperead:p000`, true)).toBe('> First.\n\n译文。')
  })
  it('holds out-of-order completions until earlier text exists and marks export gaps explicitly', () => {
    const job = {
      documentVersion: 2,
      chunks: [
        { page: 1, input: '' },
        { page: 2, input: '', output: 'Later' },
      ],
    } as Job
    expect(documentPreview(job, { 0: { text: 'Early draft' } })).toEqual({
      committed: '',
      draft: 'Early draft',
      waiting: true,
    })
    expect(continuousMarkdown(job)).toBe('_[未完成的正文：批次 1]_\n\nLater')
    job.chunks[0].output = 'Earlier'
    expect(documentPreview(job).committed).toBe('Earlier\n\nLater')
  })
})

describe('shared AI request queue', () => {
  it('bounds all jobs to three requests and applies the strictest same-origin concurrency', async () => {
    const a = await acquireRequest('https://a.test/v1', 1),
      b = await acquireRequest('https://b.test/v1', 3),
      c = await acquireRequest('https://c.test/v1', 3)
    let nextA: (() => void) | undefined, nextD: (() => void) | undefined
    const queuedA = acquireRequest('https://a.test/another', 3).then((release) => {
      nextA = release
    })
    const queuedD = acquireRequest('https://d.test/v1', 3).then((release) => {
      nextD = release
    })
    await Promise.resolve()
    expect(nextA).toBeUndefined()
    expect(nextD).toBeUndefined()
    b()
    await queuedD
    expect(nextA).toBeUndefined()
    a()
    await queuedA
    nextA!()
    nextD!()
    c()
  })
  it('removes cancelled waiting requests without consuming a slot', async () => {
    const first = await acquireRequest('https://one.test', 1),
      controller = new AbortController()
    const waiting = expect(
      acquireRequest('https://one.test', 1, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await waiting
    first()
    const next = await acquireRequest('https://one.test', 1)
    next()
    next()
  })
})
