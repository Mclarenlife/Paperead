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
import { BatchSizeError } from '../src/lib/ai-stream'
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
  it('allows visible SSE output to span several deadlines without including local queue time', async () => {
    vi.useFakeTimers()
    // The real request origin has only one slot. A pending second request
    // must get its full first-output window after that slot is released.
    let controller!: ReadableStreamDefaultController<Uint8Array>
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            controller = stream
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
    fetchMock.mockResolvedValueOnce(json('第二个批次'))
    const first = requestAI(config, 'task', 'A')
    const second = requestAI(config, 'task', 'B')
    const send = (content: string, finish_reason?: string) =>
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`,
        ),
      )
    await vi.advanceTimersByTimeAsync(25_000)
    send('前言。')
    await vi.advanceTimersByTimeAsync(25_000)
    send('方法。')
    await vi.advanceTimersByTimeAsync(25_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    send('结果。', 'stop')
    expect(await first).toBe('前言。方法。结果。')
    expect(await second).toBe('第二个批次')
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    ['thinking', '模型已返回思考过程，等待首段正文'],
    ['output', '连续未收到新的正文内容'],
    ['heartbeat', '已连接，等待首段正文'],
  ])('times out stalled %s streams despite padding and heartbeats', async (stage, detail) => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            controller = stream
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
    const failed = requestAI(config, 'task', 'A').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    const send = (event: string) => controller.enqueue(new TextEncoder().encode(event + '\n\n'))
    if (stage === 'thinking')
      send('data: {"choices":[{"delta":{"reasoning_content":"still thinking"}}]}')
    if (stage === 'output') send('data: {"choices":[{"delta":{"content":"已输出"}}]}')
    await vi.advanceTimersByTimeAsync(15_000)
    send(': heartbeat')
    send('data: {"choices":[{"delta":{"content":" "}}]}')
    await vi.advanceTimersByTimeAsync(stage === 'output' ? 15_000 : 5_000)
    const error = await failed
    expect(error).toBeInstanceOf(BatchSizeError)
    expect(error).toHaveProperty('message', expect.stringContaining(detail))
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves a rate-limit status even if the error body never completes', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(
      new Response(new ReadableStream({ start() {} }), { status: 429 }),
    )
    const failed = requestAI(config, 'task', 'text').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await failed
    expect(error).toHaveProperty('message', expect.stringContaining('HTTP 429'))
    expect(error).not.toBeInstanceOf(BatchSizeError)
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
    expect(prompt.system).toContain('$$\nE = mc^{2}\n$$')
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
  it('repairs a lost equation in one grouped request and restores old bilingual checkpoints', async () => {
    const job = await createJob('sample-0', 'translation', { ...config, bilingual: true })
    const formula = '$$\n\\frac{y}{x_i^{2}}\n$$'
    const lines = ['## Method', 'Assume $x_i$ is positive.', formula]
    await db.jobs.update(job.id, {
      promptVersion: 4,
      chunks: [
        { page: 1, input: '', output: '已经校对的译文' },
        {
          page: 2,
          input: '',
          paragraphs: lines.map((text, i) => ({ text, id: `p${i}`, page: 2, endPage: 2 })),
        },
      ],
    })
    // Valid paragraph markers, but a duplicated inline equation and a missing display equation.
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const input = JSON.parse(init.body as string).messages[1].content
      const token = input.match(/\[\[PRM_[\w]+_0\]\]/)?.[0]
      expect(token).toBeDefined()
      return json(
        `<!-- paperead:p0 -->\n方法\n<!-- paperead:p1 -->\n令 ${token} ${token}\n<!-- paperead:p2 -->\n无`,
      )
    })
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const input = JSON.parse(init.body as string).messages[1].content
      const plan = JSON.parse(input.split('REPAIR_JSON:\n')[1].split('\nEND_REPAIR_JSON')[0])
      expect(plan.blocks.flat().filter((p: { fixed?: string }) => p.fixed === 'math')).toHaveLength(
        2,
      )
      expect(
        plan.blocks
          .flat()
          .filter((p: { id?: string }) => p.id)
          .map((p: { text: string }) => p.text),
      ).toEqual(['Method', 'Assume', 'is positive.'])
      return json(
        JSON.stringify({
          translations: [
            { id: 's3', text: '为正数。' },
            { id: 's1', text: '方法' },
            { id: 's2', text: '设' },
          ],
        }),
      )
    })
    await runJob(job.id)
    const result = (await db.jobs.get(job.id))!
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('completed')
    expect(result.chunks[0].output).toBe('已经校对的译文')
    expect(result.chunks[1].output).toBe(
      `> ## Method\n\n## 方法\n\n> Assume $x_i$ is positive.\n\n设 $x_i$ 为正数。\n\n> $$\n> \\frac{y}{x_i^{2}}\n> $$\n\n${formula}`,
    )
  })
  it('keeps a gap after invalid repair data, finishes later batches and only retries the gap', async () => {
    const job = await createJob('sample-0', 'translation', config)
    await db.jobs.update(job.id, {
      chunks: [
        { page: 3, endPage: 4, input: 'Given $x$ it follows.' },
        { page: 5, input: '$$\ny = x^2\n$$' },
        { page: 6, input: 'Next paragraph.' },
      ],
    })
    fetchMock
      .mockResolvedValueOnce(json('公式缺失'))
      .mockResolvedValueOnce(
        json(
          JSON.stringify({
            translations: [
              { id: 's1', text: '设' },
              { id: 's1', text: '可得。' },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(json('下一段。'))
    await runJob(job.id)
    const partial = (await db.jobs.get(job.id))!
    expect(partial.status).toBe('failed')
    expect(partial.error).toContain('第 1 批（第 3–4 页）')
    expect(partial.chunks.map((c) => c.output)).toEqual([undefined, '$$\ny = x^2\n$$', '下一段。'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const token = JSON.parse(init.body as string).messages[1].content.match(
        /\[\[PRM_[\w]+_0\]\]/,
      )[0]
      return json(`由 ${token} 可得。`)
    })
    await runJob(job.id)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect((await db.jobs.get(job.id))?.chunks[0].output).toBe('由 $x$ 可得。')
  })
  it('catches a formula moved into a different bilingual paragraph even when both markers survive', async () => {
    const job = await createJob('sample-0', 'translation', { ...config, bilingual: true })
    await db.jobs.update(job.id, {
      chunks: [
        {
          page: 1,
          input: '',
          paragraphs: [
            { id: 'p1', page: 1, endPage: 1, text: 'Take $x$.' },
            { id: 'p2', page: 1, endPage: 1, text: 'Then proceed.' },
          ],
        },
      ],
    })
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const input = JSON.parse(init.body as string).messages[1].content
      const token = input.match(/\[\[PRM_\w+\]\]/)[0]
      return json(`<!-- paperead:p1 -->\n取。\n<!-- paperead:p2 -->\n然后依据 ${token} 继续。`)
    })
    fetchMock.mockResolvedValueOnce(
      json('{"translations":[{"id":"s1","text":"取"},{"id":"s2","text":"然后继续。"}]}'),
    )
    await runJob(job.id)
    const result = (await db.jobs.get(job.id))!
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('completed')
    expect(result.chunks[0].output).toBe('> Take $x$.\n\n取 $x$.\n\n> Then proceed.\n\n然后继续。')
  })
  it('cancels an in-flight prose repair without saving placeholders, JSON or a partial output', async () => {
    const job = await createJob('sample-0', 'translation', config)
    await db.jobs.update(job.id, { chunks: [{ page: 1, input: 'Consider $x$.' }] })
    fetchMock.mockResolvedValueOnce(json('设')).mockImplementationOnce(() => new Promise(() => {}))
    const running = runJob(job.id)
    await vi.waitFor(() => expect(getJobProgress(job.id)?.fragments[0]?.phase).toBe('repairing'))
    cancelJob(job.id)
    await running
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
    expect((await db.jobs.get(job.id))?.chunks[0].output).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('retries a disconnected translation stream once from the start', async () => {
    const job = await createJob('sample-0', 'translation', config)
    await db.jobs.update(job.id, { chunks: [{ page: 1, input: 'A complete sentence.' }] })
    const interrupted = () => sse([{ choices: [{ delta: { content: '没有完成' } }] }])
    fetchMock.mockResolvedValueOnce(interrupted()).mockResolvedValueOnce(interrupted())
    await runJob(job.id)
    expect((await db.jobs.get(job.id))?.chunks[0].output).toBeUndefined()
    expect((await db.jobs.get(job.id))?.status).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockResolvedValueOnce(interrupted()).mockResolvedValueOnce(json('完整的一句话。'))
    await runJob(job.id)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect((await db.jobs.get(job.id))?.chunks[0].output).toBe('完整的一句话。')
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
    // Captured Ark behavior: all markers are present, but it echoes the
    // read-only document title as a heading before the first marker.
    fetchMock.mockResolvedValueOnce(json(`# ${job.documentTitle}\n\n${output}`))
    await runJob(job.id)
    const saved = (await db.jobs.get(job.id))!
    expect(saved.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(documentPrompt(job, 0).restoreMath('# Unrelated heading\n' + output)).toContain(
      '# Unrelated heading',
    )
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
    expect(job.sourceWarning).toContain('第 2 页没有可提取的文字')
  })
})
