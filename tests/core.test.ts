import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, deletePaper, seedDatabase } from '../src/lib/db'
import {
  buildRequest,
  hasSessionKey,
  cancelJob,
  createJob,
  parseResponse,
  runJob,
  setSessionKey,
  splitText,
  validateEndpoint,
} from '../src/lib/ai'
import { backupSchema, createBackup, restoreBackup } from '../src/lib/backup'
import { sampleNote, samplePapers } from '../src/lib/samples'
import { platformFetch } from '../src/lib/platform'
import JSZip from 'jszip'

vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
const fetchMock = vi.mocked(platformFetch)
const config = {
  provider: 'compatible' as const,
  baseUrl: 'https://api.example.test/v1',
  model: 'test-model',
  targetLanguage: '简体中文',
  concurrency: 1,
  batchSize: 1000,
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  await seedDatabase()
  fetchMock.mockReset()
  setSessionKey('test-secret', config)
})

describe('local data integrity', () => {
  it('seeds once and keeps user changes', async () => {
    await db.papers.update('sample-0', { title: 'Edited title' })
    await seedDatabase()
    expect(await db.papers.count()).toBe(6)
    expect((await db.papers.get('sample-0'))?.title).toBe('Edited title')
  })
  it('deletes source records but preserves independent notes', async () => {
    await deletePaper('sample-0')
    expect(await db.pages.where('paperId').equals('sample-0').count()).toBe(0)
    expect((await db.notes.get(sampleNote.id))?.paperId).toBeUndefined()
    expect((await db.notes.get(sampleNote.id))?.markdown).toContain('阅读')
  })
  it('round trips the full backup, without secrets or settings', async () => {
    await db.meta.put({ key: 'ai', value: JSON.stringify({ model: 'private-model' }) })
    const blob = await createBackup()
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const manifest = await zip.file('manifest.json')!.async('string')
    expect(manifest).not.toContain('test-secret')
    expect(manifest).not.toContain('private-model')
    await deletePaper('sample-0')
    expect(await restoreBackup(blob)).toBe(6)
    expect((await db.papers.get('sample-0'))?.title).toBe(samplePapers[0].title)
    expect((await db.notes.get(sampleNote.id))?.paperId).toBe('sample-0')
  })
  it('rejects broken references before changing the database', async () => {
    const blob = await createBackup(),
      zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const data = JSON.parse(await zip.file('manifest.json')!.async('string'))
    data.pages[0].paperId = 'missing'
    zip.file('manifest.json', JSON.stringify(data))
    await expect(restoreBackup(await zip.generateAsync({ type: 'blob' }))).rejects.toThrow('无来源')
    expect(await db.papers.count()).toBe(6)
    expect(await db.pages.count()).toBe(12)
  })
  it('rejects unsupported backup versions', () => {
    expect(backupSchema.safeParse({ version: 4 }).success).toBe(false)
  })
})

describe('AI adapters and checkpoints', () => {
  it('isolates session credentials by provider and endpoint', () => {
    expect(hasSessionKey(config)).toBe(true)
    expect(hasSessionKey({ ...config, baseUrl: 'https://another.example.test/v1' })).toBe(false)
    expect(hasSessionKey({ ...config, provider: 'anthropic' })).toBe(false)
  })
  it('restricts credentials and plaintext endpoints', () => {
    expect(() => validateEndpoint('http://evil.example/v1')).toThrow('HTTPS')
    expect(() => validateEndpoint('https://user:key@api.example/v1')).toThrow('凭据')
    expect(validateEndpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
  })
  it('constructs four provider-specific requests without putting keys in URLs', () => {
    for (const provider of ['openai', 'compatible', 'anthropic', 'gemini'] as const) {
      const request = buildRequest({ ...config, provider }, 'secret', 'system', 'document')
      expect(request.url).not.toContain('secret')
      expect(JSON.stringify(request.headers)).toContain('secret')
      expect(JSON.stringify(request.body)).toContain('document')
    }
    expect(buildRequest({ ...config, provider: 'openai' }, 'secret', '', '').body).toHaveProperty(
      'store',
      false,
    )
  })
  it('extracts outputs and rejects truncation or refusal', () => {
    expect(
      parseResponse('openai', {
        output: [
          { type: 'reasoning', summary: [] },
          { content: [{ type: 'output_text', text: 'translated' }] },
        ],
      }),
    ).toBe('translated')
    expect(parseResponse('anthropic', { content: [{ type: 'text', text: 'Claude' }] })).toBe(
      'Claude',
    )
    expect(
      parseResponse('gemini', {
        candidates: [
          { content: { parts: [{ text: 'private', thought: true }, { text: 'Gemini' }] } },
        ],
      }),
    ).toBe('Gemini')
    expect(() =>
      parseResponse('compatible', {
        choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
      }),
    ).toThrow('截断')
    expect(() =>
      parseResponse('openai', { output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }),
    ).toThrow('可用文本')
  })
  it('splits oversized text without losing meaningful content', () => {
    const text = 'alpha beta\n'.repeat(4000)
    const chunks = splitText(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 5500)).toBe(true)
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  })
  it('saves completed fragments and resumes only the failed portion', async () => {
    const job = await createJob('sample-0', 'translation', config)
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '第一部分' } }] })),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
    await runJob(job.id)
    expect((await db.jobs.get(job.id))?.status).toBe('failed')
    expect((await db.jobs.get(job.id))?.chunks[0].output).toBe('第一部分')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '第二部分' } }] })),
    )
    await runJob(job.id)
    expect((await db.jobs.get(job.id))?.status).toBe('completed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('cancels in-flight requests and preserves a resumable job', async () => {
    const job = await createJob('sample-1', 'reflow', config)
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const running = runJob(job.id)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    cancelJob(job.id)
    await running
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
    expect((await db.jobs.get(job.id))?.chunks.every((c) => !c.output)).toBe(true)
  })
})
