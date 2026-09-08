import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import Dexie from 'dexie'
import { db, seedDatabase, recoverInterruptedJobs } from '../src/lib/db'
import { moveToTrash, restoreFromTrash, permanentlyDelete, updatePapers } from '../src/lib/trash'
import {
  allDrafts,
  discardDraft,
  editDraft,
  getDraft,
  loadDraft,
  saveDraft,
} from '../src/lib/note-drafts'
import { createBackup, restoreBackup } from '../src/lib/backup'
import { createJob, runJob, setSessionKey } from '../src/lib/ai'
import { platformFetch } from '../src/lib/platform'
import { sampleNote } from '../src/lib/samples'

vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
beforeEach(async () => {
  vi.restoreAllMocks()
  allDrafts().forEach((draft) => discardDraft(draft.id))
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  await Promise.all(db.tables.map((table) => table.clear()))
  await seedDatabase()
})
afterEach(() => {
  allDrafts().forEach((draft) => discardDraft(draft.id))
  vi.unstubAllGlobals()
})

describe('recoverable library operations', () => {
  it('upgrades an existing version-one database without replacing its papers or notes', async () => {
    const paper = (await db.papers.get('sample-0'))!
    await db.delete()
    const legacy = new Dexie(db.name)
    legacy.version(1).stores({
      papers: 'id, &hash, collectionId, status, createdAt, lastReadAt, *tags',
      assets: 'paperId',
      pages: 'id, paperId, [paperId+number]',
      collections: 'id',
      notes: 'id, paperId, updatedAt',
      annotations: 'id, paperId, [paperId+source]',
      jobs: 'id, paperId, status',
      meta: 'key',
    })
    try {
      await legacy.table('papers').put({ ...paper, title: 'My existing paper' })
      await legacy.table('notes').put({ ...sampleNote, markdown: 'My existing note' })
      await legacy.table('meta').put({ key: 'initialized', value: 'true' })
    } finally {
      legacy.close()
    }
    await db.open()
    await seedDatabase()
    expect(db.verno).toBe(3)
    expect(await db.papers.count()).toBe(1)
    expect((await db.papers.get(paper.id))?.title).toBe('My existing paper')
    expect((await db.notes.get(sampleNote.id))?.markdown).toBe('My existing note')
    await moveToTrash([{ kind: 'paper', id: paper.id }])
    await restoreFromTrash([{ kind: 'paper', id: paper.id }])
    expect((await db.notes.get(sampleNote.id))?.paperId).toBe(paper.id)
  })
  it('restores a paper with its exact assets, annotations and AI result while preserving independent notes', async () => {
    await db.assets.add({ paperId: 'sample-0', pdf: new Blob(['%PDF-test']) })
    const job = await createJob('sample-0', 'translation', {
      provider: 'compatible',
      baseUrl: 'http://localhost:19000/v1',
      model: 'test',
      targetLanguage: '中文',
    })
    await db.annotations.add({
      id: 'a1',
      paperId: 'sample-0',
      page: 1,
      source: 'original',
      quote: 'quote',
      comment: 'keep',
      color: 'yellow',
      rects: [],
      createdAt: 1,
    })
    const items = [{ kind: 'paper' as const, id: 'sample-0' }]
    await moveToTrash(items)
    expect((await db.papers.get('sample-0'))?.deletedAt).toBeTruthy()
    expect((await db.assets.get('sample-0'))?.pdf?.size).toBe(9)
    expect((await db.notes.get(sampleNote.id))?.paperId).toBe('sample-0')
    await restoreFromTrash(items)
    expect((await db.papers.get('sample-0'))?.deletedAt).toBeUndefined()
    expect(await db.jobs.get(job.id)).toBeDefined()
    expect((await db.annotations.get('a1'))?.comment).toBe('keep')
    await expect(permanentlyDelete(items)).rejects.toThrow('只能彻底删除回收站')
    await moveToTrash(items)
    await permanentlyDelete(items)
    expect(await db.assets.get('sample-0')).toBeUndefined()
    expect(await db.jobs.get(job.id)).toBeUndefined()
    expect(await db.annotations.get('a1')).toBeUndefined()
    expect((await db.notes.get(sampleNote.id))?.paperId).toBeUndefined()
  })
  it('round trips recycle bin state and still imports version-one backups', async () => {
    const items = [
      { kind: 'paper' as const, id: 'sample-0' },
      { kind: 'note' as const, id: sampleNote.id },
    ]
    await moveToTrash(items)
    const backup = await createBackup()
    await restoreFromTrash(items)
    await restoreBackup(backup)
    expect((await db.papers.get('sample-0'))?.deletedAt).toBeTruthy()
    expect((await db.notes.get(sampleNote.id))?.deletedAt).toBeTruthy()
    const zip = await JSZip.loadAsync(await backup.arrayBuffer()),
      manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.version).toBe(4)
    manifest.version = 1
    for (const row of [...manifest.papers, ...manifest.notes]) delete row.deletedAt
    zip.file('manifest.json', JSON.stringify(manifest))
    await restoreBackup(await zip.generateAsync({ type: 'blob' }))
    expect((await db.papers.get('sample-0'))?.deletedAt).toBeUndefined()
  })
  it('retains explicitly deleted annotations when the parent paper is restored', async () => {
    await db.annotations.add({
      id: 'a1',
      paperId: 'sample-0',
      page: 1,
      source: 'original',
      quote: 'q',
      comment: '',
      color: 'yellow',
      rects: [],
      createdAt: 1,
    })
    await moveToTrash([
      { kind: 'annotation', id: 'a1' },
      { kind: 'paper', id: 'sample-0' },
    ])
    await expect(restoreFromTrash([{ kind: 'annotation', id: 'a1' }])).rejects.toThrow('先恢复')
    await restoreFromTrash([{ kind: 'paper', id: 'sample-0' }])
    expect((await db.annotations.get('a1'))?.deletedAt).toBeTruthy()
    await restoreFromTrash([{ kind: 'annotation', id: 'a1' }])
    expect((await db.annotations.get('a1'))?.deletedAt).toBeUndefined()
  })
  it('applies batch tags atomically, respects deleted papers and rejects invalid collections', async () => {
    await moveToTrash([{ kind: 'paper', id: 'sample-1' }])
    await updatePapers(
      ['sample-0', 'sample-1'],
      { status: 'finished' },
      { mode: 'replace', values: ['研究', '研究', 'AI'] },
    )
    expect((await db.papers.get('sample-0'))?.tags).toEqual(['研究', 'AI'])
    expect((await db.papers.get('sample-1'))?.status).not.toBe('finished')
    await expect(updatePapers(['sample-0'], { collectionId: 'missing' })).rejects.toThrow('不存在')
    await updatePapers(['sample-0'], {}, { mode: 'remove', values: ['AI'] })
    expect((await db.papers.get('sample-0'))?.tags).toEqual(['研究'])
  })
  it('pauses an active job on recycle and never writes late output into a removed paper', async () => {
    const config = {
      provider: 'compatible' as const,
      baseUrl: 'http://localhost:19000/v1',
      model: 'test',
      targetLanguage: '中文',
    }
    setSessionKey('', config)
    const job = await createJob('sample-0', 'translation', config)
    vi.mocked(platformFetch).mockImplementation(() => new Promise(() => {}))
    const running = runJob(job.id)
    await vi.waitFor(async () => expect((await db.jobs.get(job.id))?.status).toBe('running'))
    await moveToTrash([{ kind: 'paper', id: 'sample-0' }])
    await running
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
    expect((await db.jobs.get(job.id))?.chunks.every((chunk) => !chunk.output)).toBe(true)
    await runJob(job.id)
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
  })
  it('seeding another window cannot interrupt a running job; owner recovery is explicit', async () => {
    const job = await createJob('sample-0', 'reflow', {
      provider: 'compatible',
      baseUrl: 'http://localhost:19000/v1',
      model: 'test',
      targetLanguage: '中文',
    })
    await db.jobs.update(job.id, { status: 'running' })
    await seedDatabase()
    expect((await db.jobs.get(job.id))?.status).toBe('running')
    await recoverInterruptedJobs()
    expect((await db.jobs.get(job.id))?.status).toBe('cancelled')
  })
})

describe('note drafts and retry', () => {
  it('preserves failed writes in memory and local storage, then clears the draft only after a successful retry', async () => {
    const note = (await db.notes.get(sampleNote.id))!
    vi.spyOn(db.notes, 'update').mockRejectedValueOnce(new Error('Storage is full'))
    editDraft(note, 'Draft title', 'Critical research note')
    await saveDraft(note.id)
    expect(getDraft(note.id)).toMatchObject({
      status: 'error',
      title: 'Draft title',
      durable: true,
    })
    expect(localStorage.getItem(`paperead-note-draft:${note.id}`)).toContain(
      'Critical research note',
    )
    expect((await db.notes.get(note.id))?.title).toBe(note.title)
    await expect(createBackup()).rejects.toThrow('未保存')
    await saveDraft(note.id)
    expect(getDraft(note.id)).toBeUndefined()
    expect(localStorage.getItem(`paperead-note-draft:${note.id}`)).toBeNull()
    expect((await db.notes.get(note.id))?.markdown).toBe('Critical research note')
  })
  it('serializes rapid edits and retains the newest revision', async () => {
    const note = (await db.notes.get(sampleNote.id))!
    editDraft(note, 'first', 'A')
    editDraft(note, 'second', 'B')
    editDraft(note, 'latest', 'C')
    await saveDraft(note.id)
    expect((await db.notes.get(note.id))?.title).toBe('latest')
    expect((await db.notes.get(note.id))?.markdown).toBe('C')
    expect(getDraft(note.id)).toBeUndefined()
  })
  it('recovers a draft after reopening, and reports volatile storage when both writes fail', async () => {
    const note = (await db.notes.get(sampleNote.id))!
    localStorage.setItem(
      `paperead-note-draft:${note.id}`,
      JSON.stringify({
        id: note.id,
        title: 'Recovered',
        markdown: 'Unsaved evidence',
        updatedAt: Date.now(),
      }),
    )
    expect(loadDraft(note)).toMatchObject({ title: 'Recovered', status: 'error' })
    discardDraft(note.id)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(db.notes, 'update').mockRejectedValueOnce(new Error('full'))
    editDraft(note, 'memory', 'keep me')
    await saveDraft(note.id)
    expect(getDraft(note.id)).toMatchObject({
      status: 'error',
      durable: false,
      markdown: 'keep me',
    })
  })
})
