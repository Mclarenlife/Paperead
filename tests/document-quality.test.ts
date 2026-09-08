import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { extractPdfLayout } from '../src/lib/pdf-layout'
import { normalizeAcademicMarkdown, mathProtection } from '../src/lib/academic-markdown'
import { planDocument, documentParagraphs, paragraphMarker } from '../src/lib/document'
import {
  createJob,
  runJob,
  documentPrompt,
  buildRequest,
  buildVisionRequest,
  requestAI,
} from '../src/lib/ai'
import { getJobProgress } from '../src/lib/ai-progress'
import { platformFetch } from '../src/lib/platform'
import { db, seedDatabase } from '../src/lib/db'
import { profileSettings } from '../src/lib/profiles'
import { createBackup, restoreBackup } from '../src/lib/backup'
vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
const fetchMock = vi.mocked(platformFetch)
const config = {
  provider: 'compatible' as const,
  baseUrl: 'http://127.0.0.1:19008/v1',
  model: 'deepseek-v4-flash',
  targetLanguage: '简体中文',
  concurrency: 2,
}
const json = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }))
const item = (str: string, x: number, y: number, width = 120, height = 10) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
})
beforeEach(async () => {
  fetchMock.mockReset()
  await Promise.all(db.tables.map((t) => t.clear()))
  await seedDatabase()
})
afterEach(() => vi.useRealTimers())

describe('DeepSeek latency and streaming', () => {
  it('disables V4 thinking by default, exposes explicit efforts and keeps unknown providers compatible', () => {
    expect(buildRequest(config, '', 'task', 'text').body).toMatchObject({
      thinking: { type: 'disabled' },
      stream: true,
    })
    expect(buildRequest({ ...config, thinkingMode: 'low' }, '', '', '').body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    })
    expect(
      buildRequest({ ...config, thinkingMode: 'provider' }, '', '', '').body,
    ).not.toHaveProperty('thinking')
    expect(buildRequest({ ...config, model: 'another-model' }, '', '', '').body).not.toHaveProperty(
      'thinking',
    )
    expect(buildRequest({ ...config, provider: 'openai' }, '', '', '').body).toMatchObject({
      reasoning: { effort: 'none' },
    })
    expect(
      buildRequest({ ...config, provider: 'anthropic', thinkingMode: 'high' }, '', '', '').body,
    ).toMatchObject({ output_config: { effort: 'high' } })
    expect(profileSettings({ ...config, thinkingMode: 'low' }).thinkingMode).toBe('low')
  })
  it('rejects a known text-only model before uploading a page image', () => {
    expect(() => buildVisionRequest(config, '', '', '', 'data:image/png;base64,YQ==')).toThrow(
      '不支持图片',
    )
    expect(
      buildVisionRequest(
        { ...config, model: 'deepseek-v4-flash-vision-exp' },
        '',
        '',
        '',
        'data:image/png;base64,YQ==',
      ).body,
    ).toHaveProperty('messages')
  })
  it('reports thinking without exposing reasoning and displays the first token before completion', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            stream = c
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const job = await createJob('sample-0', 'translation', config)
    const run = runJob(job.id)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const send = (delta: unknown, finish_reason?: string) =>
      stream.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`,
        ),
      )
    send({ reasoning_content: 'private reasoning' })
    await vi.waitFor(() => expect(getJobProgress(job.id)?.fragments[0]?.phase).toBe('thinking'))
    expect(getJobProgress(job.id)?.fragments[0].text).toBe('')
    send({ content: '# 即时标题' })
    await vi.waitFor(() => expect(getJobProgress(job.id)?.fragments[0].text).toBe('# 即时标题'))
    expect((await db.jobs.get(job.id))?.status).toBe('running')
    send({ content: '\n\n正文' }, 'stop')
    stream.close()
    await run
    expect((await db.jobs.get(job.id))?.chunks[0].timing?.firstTextMs).toBeGreaterThanOrEqual(0)
  })
  it('distinguishes JSON buffering from streaming rather than reporting false received characters', async () => {
    fetchMock.mockResolvedValue(json('text'))
    const progress = vi.fn()
    await requestAI(config, 'task', 'text', undefined, progress)
    expect(progress).toHaveBeenCalledWith('', 'buffering')
    expect(progress).toHaveBeenCalledWith('text', 'receiving')
  })
})

describe('PDF layout and structure', () => {
  it('recovers title, section levels, paragraphs and left-column-first reading order from interleaved runs', () => {
    const result = extractPdfLayout(
      [
        item('A Research Title', 50, 800, 420, 22),
        item('1 Introduction', 50, 755, 190, 12),
        item('Left paragraph begins with enough body text', 50, 730, 220),
        item('Right paragraph begins with enough body text', 330, 730, 220),
        item('and continues on the following physical line', 50, 716, 220),
        item('and continues in its own column only', 330, 716, 220),
        item('before ending.', 50, 702, 100),
        item('before the right column ends.', 330, 702, 160),
        item('Next indented paragraph begins here.', 62, 688, 208),
        item('More body material in the right column.', 330, 680, 220),
        item('and keeps its continuation aligned.', 50, 674, 220),
      ],
      { page: 1 },
    )
    expect(result.text).toContain('# A Research Title')
    expect(result.text).toContain('## 1 Introduction')
    const paragraphs = documentParagraphs([{ number: 1, text: result.text }]).map((p) => p.text)
    expect(
      paragraphs.some((p) => p.includes('Left paragraph') && p.includes('Right paragraph')),
    ).toBe(false)
    expect(result.text.indexOf('Right paragraph')).toBeGreaterThan(
      result.text.indexOf('keeps its continuation'),
    )
    expect(paragraphs).toContain(
      'Next indented paragraph begins here. and keeps its continuation aligned.',
    )
  })
  it('joins soft hyphenation without merging completed paragraphs across pages', () => {
    expect(
      documentParagraphs([
        { number: 1, text: 'A trans-\nformation method.\n\nA separate paragraph.' },
      ]).map((p) => p.text),
    ).toEqual(['A transformation method.', 'A separate paragraph.'])
  })
  it('recovers simple superscript equations from positioning and flags undecodable glyphs', () => {
    const result = extractPdfLayout([
      item('The ordinary body text establishes the font size.', 50, 750, 400),
      item('E = mc', 100, 700, 35),
      item('2', 135, 704, 5, 6),
      item('Bad glyph \uFFFD', 50, 650, 120),
    ])
    expect(result.text).toContain('$$\nE = mc^{2}\n$$')
    expect(result.warnings.join()).toContain('无法可靠解码')
  })
  it('never cuts a display equation, table or inline formula at the batch boundary', () => {
    const formula = '$$\n' + 'x_i + '.repeat(180) + '0\n$$'
    const table = '| A | B |\n| --- | --- |\n' + '| long cell | other cell |\n'.repeat(45)
    const chunks = planDocument(
      [
        {
          number: 1,
          text: `${formula}\n\n${table}\n\n${'a '.repeat(220)}$x + ${'y+'.repeat(120)}z$ end.`,
        },
      ],
      500,
    )
    expect(chunks.some((c) => c.input === formula)).toBe(true)
    expect(chunks.some((c) => c.input.includes(table.trim()))).toBe(true)
    expect(
      chunks.flatMap((c) => c.paragraphs!).filter((p) => p.text.includes('$x +'))[0].text,
    ).toContain('z$')
  })
  it('starts long documents with a smaller complete group and still packs following cross-page batches', () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({
      number: i + 1,
      text: 'A paragraph ' + 'word '.repeat(80) + '.',
    }))
    const chunks = planDocument(pages, 6000, 1500)
    expect(chunks[0].input.length).toBeLessThanOrEqual(1500)
    expect(chunks[1].input.length).toBeGreaterThan(5000)
    expect(chunks.length).toBeLessThan(6)
    expect(chunks.flatMap((c) => c.paragraphs!).length).toBe(40)
  })
})

describe('Markdown and formula integrity', () => {
  it('normalizes headings and alternate LaTeX delimiters without editing code or quoted originals', () => {
    const input =
      'Introduction\n\n2.1 Model Architecture\n\n正文 \\(x_i\\)\n\n\\[\\frac{a}{b}\\]\n\n> 原文 \\(x\\)\n\n`\\(code\\)`\n\n```txt\nIntroduction\n\\[code\\]\n```'
    const result = normalizeAcademicMarkdown(input)
    expect(result).toContain('## Introduction')
    expect(result).toContain('### 2.1 Model Architecture')
    expect(result).toContain('$x_i$')
    expect(result).toContain('$$\n\\frac{a}{b}\n$$')
    expect(result).toContain('> 原文 \\(x\\)')
    expect(result).toContain('`\\(code\\)`')
    expect(result).toContain('```txt\nIntroduction\n\\[code\\]\n```')
    expect(normalizeAcademicMarkdown(result)).toBe(result)
  })
  it('wraps standalone LaTeX equation environments for actual math rendering', () => {
    expect(normalizeAcademicMarkdown('\\begin{equation}x=1\\end{equation}')).toBe('$$\nx=1\n$$')
    expect(normalizeAcademicMarkdown('\\begin{align}x&=1\\\\y&=2\\end{align}')).toBe(
      '$$\n\\begin{aligned}x&=1\\\\y&=2\\end{aligned}\n$$',
    )
  })
  it('preserves original formulas locally and rejects omitted or duplicated formula tokens', () => {
    const protect = mathProtection('test')
    const masked = protect.mask('A $x_i$ and $$\n\\frac{a}{b}\n$$; `code $raw$`')
    expect(masked).not.toContain('frac')
    expect(masked).toContain('`code $raw$`')
    expect(protect.restore(masked)).toBe('A $x_i$ and $$\n\\frac{a}{b}\n$$; `code $raw$`')
    expect(() => protect.restore('No formula')).toThrow('遗漏或重复')
    expect(() => protect.restore(masked + masked)).toThrow('遗漏或重复')
    expect(protect.restore('A [[PRM_test_', true)).toBe('A ')
  })
  it('keeps bilingual originals, restores source heading levels and equations, including backup roundtrip', async () => {
    await db.pages.where('paperId').equals('sample-0').delete()
    await db.papers.update('sample-0', { pageCount: 1 })
    await db.pages.add({
      id: 'sample-0:1',
      paperId: 'sample-0',
      number: 1,
      text: '## Method\n\nEnergy $E=mc^{2}$ is conserved.',
      extractionVersion: 3,
    })
    const job = await createJob('sample-0', 'translation', {
      ...config,
      bilingual: true,
      thinkingMode: 'low',
    })
    const prompt = documentPrompt(job, 0),
      payload = JSON.parse(prompt.input.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0])
    fetchMock.mockResolvedValue(
      json(
        payload.paragraphs
          .map(
            (p: any, i: number) =>
              `${paragraphMarker(p.id)}\n${i === 0 ? '方法' : p.text.replace('Energy', '能量').replace('is conserved.', '守恒。')}`,
          )
          .join('\n\n'),
      ),
    )
    await runJob(job.id)
    let saved = (await db.jobs.get(job.id))!
    expect(saved.status).toBe('completed')
    expect(saved.chunks[0].output).toContain('> ## Method\n\n## 方法')
    expect(saved.chunks[0].output).toContain('能量 $E=mc^{2}$ 守恒。')
    expect(saved.chunks[0].output).not.toContain('[[PRM')
    const backup = await createBackup()
    await restoreBackup(backup, { snapshot: false })
    saved = (await db.jobs.get(job.id))!
    expect(saved.thinkingMode).toBe('low')
    expect(saved.chunks[0].timing).toBeDefined()
    expect((await db.pages.get('sample-0:1'))?.extractionVersion).toBe(3)
  })
})
