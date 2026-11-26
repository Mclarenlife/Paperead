import { beforeEach, expect, it, vi } from 'vitest'
import { cancelJob, createJob, jobMarkdown, runJob } from '../src/lib/ai'
import { db, seedDatabase } from '../src/lib/db'
import { paragraphMarker, planDocument, smallerTranslationChunks } from '../src/lib/document'
import { createBackup, restoreBackup } from '../src/lib/backup'
import { platformFetch } from '../src/lib/platform'
import { getJobProgress } from '../src/lib/ai-progress'
import type { SourceParagraph } from '../src/types'

vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
const fetchMock = vi.mocked(platformFetch)
const config = {
  provider: 'compatible' as const,
  baseUrl: 'http://localhost:12080/v1',
  model: 'local-fixture',
  targetLanguage: '简体中文',
  concurrency: 1,
  batchSize: 6000,
}
const response = (content: string, finish_reason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }))
const payload = (init: RequestInit) => {
  const message = JSON.parse(init.body as string).messages[1].content as string
  return JSON.parse(message.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0])
}

beforeEach(async () => {
  fetchMock.mockReset()
  await Promise.all(db.tables.map((table) => table.clear()))
  await seedDatabase()
})

it('subdivides a limited bilingual batch, checkpoints parallel peers, and resumes just the paused child after backup', async () => {
  const job = await createJob('sample-0', 'translation', {
    ...config,
    concurrency: 2,
    bilingual: true,
  })
  const p1 = { id: 'p1', text: 'A measured value. '.repeat(40) + '$x_i$.', page: 1, endPage: 1 }
  const p2 = { id: 'p2', text: 'The next example. '.repeat(40), page: 1, endPage: 2 }
  const peer = { id: 'p3', text: 'Other work.', page: 2, endPage: 2 }
  await db.jobs.update(job.id, {
    chunks: [
      { page: 1, endPage: 2, input: '', paragraphs: [p1, p2] },
      { page: 2, input: '', paragraphs: [peer] },
    ],
  })
  const calls: string[] = []
  fetchMock.mockImplementation(async (_, init) => {
    const parts = payload(init).paragraphs as SourceParagraph[]
    const which = parts.map((p) => p.id).join(',')
    calls.push(which)
    if (parts.length > 1) return new Response('{}', { status: 413 })
    if (which === 'p2' && calls.filter((id) => id === 'p2').length === 1)
      return new Promise(() => {})
    return response(
      paragraphMarker(which) +
        '\n' +
        (which === 'p1'
          ? '第一个值 ' + parts[0].text.match(/\[\[PRM_\w+\]\]/)?.[0]
          : '译文 ' + which),
    )
  })
  const running = runJob(job.id)
  await vi.waitFor(async () => {
    const saved = (await db.jobs.get(job.id))!
    expect(saved.chunks).toHaveLength(3)
    expect(saved.chunks[0].output).toContain('第一个值 $x_i$')
    expect(saved.chunks[2].output).toContain('译文 p3')
    expect(calls).toContain('p2')
  })
  cancelJob(job.id)
  await running
  const paused = (await db.jobs.get(job.id))!
  expect(paused.status).toBe('cancelled')
  expect(paused.chunks[1].output).toBeUndefined()
  const backup = await createBackup()
  await restoreBackup(backup)
  expect((await db.jobs.get(job.id))!.chunks).toEqual(paused.chunks)
  await runJob(job.id)
  const done = (await db.jobs.get(job.id))!
  expect(done.status).toBe('completed')
  expect(done.chunks.flatMap((c) => c.paragraphs!.map((p) => p.id))).toEqual(['p1', 'p2', 'p3'])
  expect(done.chunks[0].output).toBe(paused.chunks[0].output)
  expect(done.chunks[2].output).toBe(paused.chunks[2].output)
  expect(calls.sort()).toEqual(['p1', 'p1,p2', 'p2', 'p2', 'p3'])
})

it('bounds automatic subdivision to one level and excludes auth and quota errors', async () => {
  const job = await createJob('sample-0', 'translation', config)
  const input = ['First paragraph. ', 'Next paragraph. ', 'Last paragraph. ']
    .map((s) => s.repeat(100))
    .join('\n\n')
  await db.jobs.update(job.id, { chunks: [{ page: 1, input }] })
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }))
  await runJob(job.id)
  expect((await db.jobs.get(job.id))!.chunks).toHaveLength(1)
  fetchMock.mockImplementation(async () => response('partial', 'length'))
  await runJob(job.id)
  const failed = (await db.jobs.get(job.id))!
  expect(failed.status).toBe('failed')
  expect(failed.chunks).toHaveLength(2)
  expect(failed.chunks.every((c) => c.sizeRetry && !c.output)).toBe(true)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('recovers from a stalled SSE generation without committing its partial text', async () => {
  const job = await createJob('sample-0', 'translation', { ...config, timeoutSeconds: 30 })
  const first = 'First experimental condition. '.repeat(25).trimEnd()
  const last = 'Second experimental condition. '.repeat(25).trimEnd()
  await db.jobs.update(job.id, { chunks: [{ page: 1, input: first + '\n\n' + last }] })
  const wire =
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '丢弃未完成的流' } }] }) + '\n\n'
  fetchMock.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(wire))
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    ),
  )
  fetchMock.mockImplementation(async (_, init) =>
    response(payload(init).text.startsWith('First') ? '第一组。' : '第二组。'),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const running = runJob(job.id)
  try {
    await vi.waitFor(() => expect(getJobProgress(job.id)?.fragments[0]?.received).toBe(true))
    await vi.advanceTimersByTimeAsync(30_010)
    await running
  } finally {
    cancelJob(job.id)
    vi.useRealTimers()
    await running
  }
  const completed = (await db.jobs.get(job.id))!
  expect(completed.status).toBe('completed')
  expect(completed.chunks).toHaveLength(2)
  expect(jobMarkdown(completed)).toBe('第一组。\n\n第二组。')
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('applies the current smaller budget to an old pending source snapshot without re-requesting completed text', async () => {
  const job = await createJob('sample-0', 'translation', config)
  const paragraphs = ['One ', 'Two ', 'End '].map((s) => s.repeat(190).trimEnd())
  const input = paragraphs.join('\n\n')
  await db.jobs.update(job.id, {
    status: 'failed',
    chunks: [
      { page: 1, input: 'Saved source', output: '保留的译文' },
      // Old plain jobs may carry optional paragraph metadata. The public
      // prompt for plain translation always reads the saved input.
      {
        page: 2,
        input,
        paragraphs: [{ id: 'legacy', page: 2, endPage: 2, text: 'Legacy metadata' }],
      },
    ],
  })
  fetchMock.mockImplementation(async (_, init) => response(payload(init).text))
  await runJob(job.id, { ...config, batchSize: 1000 })
  const saved = (await db.jobs.get(job.id))!
  expect(saved.status).toBe('completed')
  expect(saved.batchSize).toBe(1000)
  expect(saved.chunks.map((c) => c.input)).toEqual(['Saved source', ...paragraphs])
  expect(jobMarkdown(saved)).toBe('保留的译文\n\n' + input)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('keeps display math and fenced code intact and starts an unusually long first paragraph within its warm-up budget', () => {
  const prose = 'Results from this experiment. '.repeat(300)
  expect(
    planDocument([{ number: 1, text: prose }], 6000, 1500)[0].input.length,
  ).toBeLessThanOrEqual(1500)
  const code = ['```js', 'x'.repeat(1200), '', 'y'.repeat(1200), '```'].join('\n')
  const math = '$$\na+b\n\nc-d\n$$'
  const result = smallerTranslationChunks(
    { page: 1, input: [code, math, 'Next.'].join('\n\n') },
    1000,
  )
  expect(result.map((c) => c.input)).toEqual([code, math + '\n\nNext.'])
})
