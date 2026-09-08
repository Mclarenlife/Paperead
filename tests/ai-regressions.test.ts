import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requestAI,
  documentPrompt,
  validateTaskOutput,
  createJob,
  runJob,
  cancelJob,
  jobMarkdown,
  sameService,
  setSessionKey,
} from '../src/lib/ai'
import { db, seedDatabase } from '../src/lib/db'
import { platformFetch } from '../src/lib/platform'
import { getJobProgress } from '../src/lib/ai-progress'
import { paragraphMarker } from '../src/lib/document'
import { createBackup, restoreBackup } from '../src/lib/backup'
import JSZip from 'jszip'
import type { Provider } from '../src/types'

vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
const fetchMock = vi.mocked(platformFetch)
const config = {
  provider: 'compatible' as const,
  baseUrl: 'http://127.0.0.1:19001/v1',
  model: 'model-a',
  targetLanguage: '简体中文',
  concurrency: 1,
  timeoutSeconds: 30,
  batchSize: 1000,
}
const json = (content: string) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
function sse(events: unknown[], done = false) {
  const wire =
    events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') +
    (done ? 'data: [DONE]\r\n\r\n' : '')
  const bytes = new TextEncoder().encode(wire)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  )
}
beforeEach(() => {
  fetchMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('request lifecycle regressions', () => {
  it('disposes the deadline after success rather than aborting an old native request', async () => {
    vi.useFakeTimers()
    const aborted = vi.fn()
    fetchMock.mockImplementation(async (_url, init) => {
      init.signal?.addEventListener('abort', aborted)
      return json('OK')
    })
    expect(await requestAI(config, 'test', 'OK')).toBe('OK')
    await vi.advanceTimersByTimeAsync(120_001)
    expect(aborted).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('times out headers even when the transport ignores abort, then permits another model', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    const first = expect(requestAI(config, 'task', 'text')).rejects.toThrow('30 秒（model-a）')
    await vi.advanceTimersByTimeAsync(30_010)
    await first
    fetchMock.mockResolvedValueOnce(json('second model'))
    expect(await requestAI({ ...config, model: 'model-b' }, 'task', 'text')).toBe('second model')
  })
  it('covers stalled JSON bodies and classifies cancellation separately from timeout', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })))
    const timeout = expect(requestAI(config, 'task', 'text')).rejects.toThrow('服务商响应超时')
    await vi.advanceTimersByTimeAsync(30_010)
    await timeout
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(() => new Promise(() => {}))
    const cancelled = expect(
      requestAI(config, 'task', 'text', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await cancelled
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each<Provider>(['compatible', 'openai', 'anthropic', 'gemini'])(
    'decodes split UTF-8 SSE for %s without mixing reasoning into the document',
    async (provider) => {
      const events =
        provider === 'compatible'
          ? [
              { choices: [{ delta: { reasoning_content: 'private' } }] },
              { choices: [{ delta: { content: '你好' } }] },
              { choices: [{ delta: { content: '世界' }, finish_reason: 'stop' }] },
            ]
          : provider === 'openai'
            ? [
                { type: 'response.output_text.delta', delta: '你好' },
                { type: 'response.output_text.delta', delta: '世界' },
                { type: 'response.completed' },
              ]
            : provider === 'anthropic'
              ? [
                  {
                    type: 'content_block_delta',
                    delta: { type: 'thinking_delta', thinking: 'private' },
                  },
                  { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好世界' } },
                  { type: 'message_stop' },
                ]
              : [
                  {
                    candidates: [
                      {
                        content: {
                          parts: [{ thought: true, text: 'private' }, { text: '你好世界' }],
                        },
                        finishReason: 'STOP',
                      },
                    ],
                  },
                ]
      fetchMock.mockResolvedValueOnce(sse(events))
      const progress = vi.fn()
      expect(await requestAI({ ...config, provider }, 'task', 'text', undefined, progress)).toBe(
        '你好世界',
      )
      expect(progress).toHaveBeenCalledWith('你好世界', 'receiving')
    },
  )
  it('rejects an abruptly disconnected stream and token-limit truncation', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'partial' } }] }]))
    await expect(requestAI(config, 'task', 'text')).rejects.toThrow('意外中断')
    fetchMock.mockResolvedValueOnce(
      sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }], true),
    )
    await expect(requestAI(config, 'task', 'text')).rejects.toThrow('截断')
  })
  it('shows service error detail and request ID without leaking the API key', async () => {
    setSessionKey('regression-secret', config)
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid key regression-secret' } }), {
        status: 401,
        headers: { 'x-request-id': 'req-test-1' },
      }),
    )
    const error = await requestAI(config, 'task', 'text').catch((e) => e)
    expect(error.message).toContain('HTTP 401')
    expect(error.message).toContain('req-test-1')
    expect(error.message).not.toContain('regression-secret')
    setSessionKey('', config)
  })
})

describe('document task regressions', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
    await seedDatabase()
  })
  it('puts task constraints around source data even without the system role and rejects the reported conversational output', async () => {
    const job = await createJob('sample-0', 'reflow', config)
    job.chunks[0].input = 'However, the effectiveness of this strategy depends critically'
    const prompt = documentPrompt(job, 0)
    expect(prompt.input).toContain('Reformat')
    expect(prompt.input).toContain('NEVER complete, continue or invent')
    expect(prompt.input).toContain(JSON.stringify({ text: job.chunks[0].input }))
    expect(() =>
      validateTaskOutput(
        'It looks like you pasted a manuscript. Please tell me what you would like me to do with this text.',
      ),
    ).toThrow('没有执行')
    fetchMock.mockResolvedValue(json('Please tell me what you would like me to do with this text.'))
    await runJob(job.id)
    expect((await db.jobs.get(job.id))?.status).toBe('failed')
    expect((await db.jobs.get(job.id))?.chunks.every((chunk) => !chunk.output)).toBe(true)
  })
  it('bounds concurrency, prevents duplicate runs and checkpoints in source order', async () => {
    const job = await createJob('sample-0', 'translation', { ...config, concurrency: 2 })
    const replies: ((response: Response) => void)[] = []
    fetchMock.mockImplementation(() => new Promise((resolve) => replies.push(resolve)))
    const running = runJob(job.id)
    const duplicate = runJob(job.id)
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    expect(getJobProgress(job.id)).toBeDefined()
    replies[1](json('second-page'))
    await vi.waitFor(async () =>
      expect((await db.jobs.get(job.id))?.chunks[1].output).toBe('second-page'),
    )
    replies[0](json('first-page'))
    await Promise.all([running, duplicate])
    const saved = (await db.jobs.get(job.id))!
    expect(saved.status).toBe('completed')
    expect(jobMarkdown(saved).indexOf('first-page')).toBeLessThan(
      jobMarkdown(saved).indexOf('second-page'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getJobProgress(job.id)).toBeUndefined()
  })
  it('resumes the original service explicitly and starts a separate version with the current model', async () => {
    const original = await createJob('sample-0', 'translation', config)
    const nextConfig = { ...config, baseUrl: 'http://127.0.0.1:19002/v1', model: 'model-b' }
    expect(sameService(original, nextConfig)).toBe(false)
    fetchMock.mockImplementation(async () => json('result'))
    await runJob(original.id, nextConfig)
    expect(fetchMock.mock.calls[0][0]).toContain(':19001/')
    const replacement = await createJob('sample-0', 'translation', nextConfig)
    await runJob(replacement.id)
    expect(fetchMock.mock.calls[2][0]).toContain(':19002/')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string).model).toBe('model-b')
    expect(await db.jobs.count()).toBe(2)
  })
  it('cancels both concurrent fragments and leaves a resumable task', async () => {
    const job = await createJob('sample-0', 'translation', { ...config, concurrency: 2 })
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const running = runJob(job.id)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    cancelJob(job.id)
    await running
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
  })
  it('keeps a successful in-flight batch when its parallel peer fails, then retries only the gap', async () => {
    const job = await createJob('sample-0', 'translation', { ...config, concurrency: 2 })
    const replies: ((response: Response) => void)[] = []
    const aborted = vi.fn()
    fetchMock.mockImplementation((_url, init) => {
      init.signal?.addEventListener('abort', aborted)
      return new Promise((resolve) => replies.push(resolve))
    })
    const running = runJob(job.id)
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    replies[0](new Response('{}', { status: 429 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    replies[1](json('saved despite peer failure'))
    await running
    const failed = (await db.jobs.get(job.id))!
    expect(failed.status).toBe('failed')
    expect(failed.chunks[1].output).toBe('saved despite peer failure')
    expect(aborted).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json('retried earlier batch'))
    await runJob(job.id)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(jobMarkdown((await db.jobs.get(job.id))!)).toBe(
      'retried earlier batch\n\nsaved despite peer failure',
    )
  })
  it('claims only one same-kind task for a paper even if two versions start together', async () => {
    const a = await createJob('sample-0', 'reflow', { ...config, batchSize: 6000 })
    const b = await createJob('sample-0', 'reflow', { ...config, batchSize: 6000 })
    let reply: (response: Response) => void = () => {}
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve
        }),
    )
    const both = [runJob(a.id), runJob(b.id)]
    await vi.waitFor(async () => {
      expect(fetchMock).toHaveBeenCalledOnce()
      expect((await db.jobs.toArray()).some((job) => job.error?.includes('同类任务'))).toBe(true)
    })
    reply(json('result'))
    await Promise.all(both)
    expect((await db.jobs.toArray()).filter((job) => job.status === 'completed')).toHaveLength(1)
  })
  it('saves exact bilingual originals, restores document annotations and rejects corrupted alignment', async () => {
    const job = await createJob('sample-0', 'translation', {
      ...config,
      batchSize: 6000,
      bilingual: true,
    })
    expect(job.chunks).toHaveLength(1)
    expect(job.chunks[0].input).toBe('')
    expect(documentPrompt(job, 0).input).toContain('Do NOT copy the source text')
    const output = job.chunks[0]
      .paragraphs!.map((p, i) => `${paragraphMarker(p.id)}\n段落 ${i + 1} 的译文。`)
      .join('\n\n')
    fetchMock.mockResolvedValueOnce(json(output))
    await runJob(job.id)
    const saved = (await db.jobs.get(job.id))!
    expect(saved.status).toBe('completed')
    expect(saved.chunks[0].output).toContain(`> ${job.chunks[0].paragraphs![0].text}`)
    await db.annotations.add({
      id: 'document-annotation',
      paperId: job.paperId,
      source: 'translation',
      jobId: job.id,
      scope: 'document',
      page: 1,
      start: 0,
      end: 2,
      quote: '引用',
      color: 'yellow',
      comment: 'note',
      rects: [],
      createdAt: Date.now(),
    })
    const blob = await createBackup()
    await db.jobs.clear()
    await db.annotations.clear()
    await restoreBackup(blob)
    expect((await db.annotations.get('document-annotation'))?.scope).toBe('document')
    expect((await db.jobs.get(job.id))?.chunks[0]).toEqual(saved.chunks[0])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer()),
      manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    manifest.jobs[0].chunks[0].paragraphs[1].id = manifest.jobs[0].chunks[0].paragraphs[0].id
    zip.file('manifest.json', JSON.stringify(manifest))
    await expect(restoreBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow(
      '段落无效或重复',
    )
    expect((await db.jobs.get(job.id))?.status).toBe('completed')
  })
  it('processes short text and warns about blank pages instead of rejecting the entire paper', async () => {
    await db.pages.update('sample-0:1', { text: 'Abstract' })
    await db.pages.update('sample-0:2', { text: '' })
    const job = await createJob('sample-0', 'reflow', config)
    expect(job.chunks[0].input).toBe('Abstract')
    expect(job.sourceWarning).toContain('1 页没有可提取文字')
  })
})
