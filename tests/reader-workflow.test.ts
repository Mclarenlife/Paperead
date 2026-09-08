import { beforeEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { db, seedDatabase } from '../src/lib/db'
import { createJob, documentPrompt, jobMarkdown } from '../src/lib/ai'
import {
  reviseResult,
  deleteResult,
  renameResult,
  setResultDraft,
  clearResultDraft,
  getResultDraft,
} from '../src/lib/results'
import { addBookmark, findMatches, locationKey, saveReadingPosition } from '../src/lib/reading'
import { annotationsMarkdown, editAnnotation } from '../src/lib/annotations'
import { storeProfile, readProfiles, deleteProfile } from '../src/lib/profiles'
import { credentialId } from '../src/lib/credentials'
import { createBackup, restoreBackup } from '../src/lib/backup'
import { moveToTrash, permanentlyDelete } from '../src/lib/trash'
import type { AISettings, Annotation } from '../src/types'

const config: AISettings = {
  provider: 'compatible',
  baseUrl: 'http://localhost:19444/v1',
  model: 'test-model',
  targetLanguage: '中文',
}
const annotation: Annotation = {
  id: 'annotation-test',
  paperId: 'sample-0',
  source: 'translation',
  page: 1,
  scope: 'document',
  quote: '原译文',
  comment: '待核对',
  color: 'yellow',
  rects: [],
  start: 0,
  end: 3,
  createdAt: 1,
}
beforeEach(async () => {
  clearResultDraft('draft-test')
  const cache = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cache.get(k) ?? null,
    setItem: (k: string, v: string) => cache.set(k, v),
    removeItem: (k: string) => cache.delete(k),
    key: (i: number) => [...cache.keys()][i] ?? null,
    get length() {
      return cache.size
    },
  })
  await Promise.all(db.tables.map((table) => table.clear()))
  await seedDatabase()
})
async function completed() {
  const job = await createJob('sample-0', 'translation', config)
  job.status = 'completed'
  job.name = '原始译文'
  job.chunks = job.chunks.map((chunk) => ({ ...chunk, output: '# 原译文\n\n原译文段落。' }))
  await db.jobs.put(job)
  return job
}
it('finds case-insensitive phrases across PDF line breaks with original text offsets', () => {
  const text = 'A neural\n network. Neural network. 文献\n阅读。'
  const matches = findMatches(text, 'NEURAL NETWORK')
  expect(matches).toHaveLength(2)
  expect(text.slice(matches[0].start, matches[0].end).replace(/\s/g, '').toLowerCase()).toBe(
    'neuralnetwork',
  )
  expect(findMatches(text, '文献阅读')).toHaveLength(1)
  expect(findMatches(text, '  ')).toEqual([])
  expect(findMatches('aaaaaa', 'aa', 2)).toHaveLength(2)
})
it('creates a manual revision without changing original text or old annotation anchors', async () => {
  const original = await completed()
  await db.annotations.put({ ...annotation, jobId: original.id })
  const revision = await reviseResult(original.id, '校对定稿', '# 定稿\n\n经过校对的译文。')
  expect(revision.id).not.toBe(original.id)
  expect(revision.revisionOf).toBe(original.id)
  expect(jobMarkdown(revision)).toContain('经过校对')
  expect(jobMarkdown((await db.jobs.get(original.id))!)).toContain('原译文')
  expect((await db.annotations.get(annotation.id))?.jobId).toBe(original.id)
  await renameResult(revision.id, '投稿版本')
  expect((await db.jobs.get(revision.id))?.name).toBe('投稿版本')
  await expect(reviseResult(original.id, 'empty', '   ')).rejects.toThrow('不能为空')
})
it('reflows the chosen revised text and retains an immutable input after the source is deleted', async () => {
  const original = await completed()
  const revision = await reviseResult(
    original.id,
    '校对定稿',
    '# 定稿\n\nOnly this corrected translation may be processed.',
  )
  const reflow = await createJob('sample-0', 'reflow', config, { jobId: revision.id })
  expect(reflow.chunks.map((c) => c.input).join('\n')).toContain('Only this corrected translation')
  expect(reflow.chunks.map((c) => c.input).join('\n')).not.toContain('Transformer')
  expect(documentPrompt(reflow, 0).system).toContain('not the original PDF')
  const snapshot = reflow.chunks.map((c) => c.input).join('\n\n')
  await deleteResult(revision.id)
  expect((await db.jobs.get(reflow.id))?.chunks.map((c) => c.input).join('\n\n')).toBe(snapshot)
  const retry = await createJob(
    'sample-0',
    'reflow',
    { ...config, model: 'new-model' },
    { snapshot: { jobId: revision.id, name: '校对定稿', text: snapshot } },
  )
  expect(retry.chunks.map((c) => c.input).join('\n\n')).toBe(snapshot)
  await expect(createJob('sample-1', 'reflow', config, { jobId: original.id })).rejects.toThrow(
    '此文献',
  )
  await expect(createJob('sample-0', 'reflow', config, { jobId: reflow.id })).rejects.toThrow(
    '已完成',
  )
})
it('keeps reading locations by version and removes only bookmarks and annotations owned by a deleted version', async () => {
  const original = await completed()
  const revision = await reviseResult(original.id, '修订', '修订内容')
  const oldLocation = { source: 'translation' as const, page: 1, jobId: original.id, progress: 0.2 }
  const newLocation = { ...oldLocation, jobId: revision.id, progress: 0.8 }
  await addBookmark('sample-0', '旧译文位置', oldLocation)
  await addBookmark('sample-0', '新译文位置', newLocation)
  await saveReadingPosition('sample-0', oldLocation)
  await saveReadingPosition('sample-0', newLocation)
  await db.annotations.bulkPut([
    { ...annotation, jobId: original.id },
    { ...annotation, id: 'new-annotation', jobId: revision.id },
  ])
  let paper = (await db.papers.get('sample-0'))!
  expect(paper.readingPositions?.[locationKey(oldLocation)].progress).toBe(0.2)
  expect(paper.lastLocation?.progress).toBe(0.8)
  setResultDraft(revision.id, { name: 'Draft of revision', markdown: 'Uncommitted edit' })
  await deleteResult(revision.id)
  expect(getResultDraft(revision.id)).toBeUndefined()
  await saveReadingPosition('sample-0', newLocation)
  paper = (await db.papers.get('sample-0'))!
  expect(paper.bookmarks?.map((b) => b.name)).toEqual(['旧译文位置'])
  expect(paper.readingPositions?.[locationKey(newLocation)]).toBeUndefined()
  expect(await db.annotations.get('new-annotation')).toBeUndefined()
  expect(await db.annotations.get(annotation.id)).toBeDefined()
  await expect(addBookmark('sample-0', '无效版本', newLocation)).rejects.toThrow('已完成')
})
it('edits annotation comment and color while retaining its quote, version and offsets', async () => {
  const original = await completed()
  const saved = { ...annotation, jobId: original.id }
  await db.annotations.add(saved)
  await editAnnotation(saved.id, '修正后的评论', 'purple')
  const edited = (await db.annotations.get(saved.id))!
  expect(edited).toEqual({ ...saved, comment: '修正后的评论', color: 'purple' })
  const markdown = annotationsMarkdown('论文', [edited], [original])
  expect(markdown).toContain('> 原译文')
  expect(markdown).toContain('原始译文')
  expect(markdown).toContain('修正后的评论')
  await expect(editAnnotation(saved.id, 'bad', 'red')).rejects.toThrow('颜色无效')
})
it('round trips revisions, source lineage, bookmarks and reading positions in backup format four', async () => {
  const original = await completed(),
    revision = await reviseResult(original.id, '备份定稿', '# Preserve corrected text')
  const location = { source: 'translation' as const, page: 1, jobId: revision.id, progress: 0.6 }
  await addBookmark('sample-0', '备份书签', location)
  await saveReadingPosition('sample-0', location)
  const backup = await createBackup(),
    zip = await JSZip.loadAsync(await backup.arrayBuffer())
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  expect(manifest.version).toBe(4)
  await deleteResult(revision.id)
  await restoreBackup(backup)
  expect(jobMarkdown((await db.jobs.get(revision.id))!)).toBe('# Preserve corrected text')
  expect((await db.papers.get('sample-0'))?.lastLocation).toEqual(location)
  expect((await db.papers.get('sample-0'))?.bookmarks?.[0].name).toBe('备份书签')
  manifest.version = 2
  for (const paper of manifest.papers) {
    delete paper.bookmarks
    delete paper.lastLocation
    delete paper.readingPositions
  }
  for (const job of manifest.jobs) {
    delete job.editedMarkdown
    delete job.name
    delete job.revisionOf
  }
  zip.file('manifest.json', JSON.stringify(manifest))
  await restoreBackup(await zip.generateAsync({ type: 'blob' }))
  expect(await db.jobs.get(original.id)).toBeDefined()
})
it('stores separate named service profiles without keys, while leaving running job settings unchanged', async () => {
  const job = await completed()
  const one = await storeProfile('快速模型', {
    ...config,
    stream: false,
    timeoutSeconds: 120,
    apiKey: 'must-not-persist',
  } as AISettings)
  const two = await storeProfile('推理模型', { ...config, model: 'reasoning', concurrency: 1 })
  expect(one.profileId).not.toBe(two.profileId)
  expect(credentialId(one)).toBe(credentialId(two))
  expect(JSON.stringify(await readProfiles())).not.toContain('must-not-persist')
  const changed = await storeProfile('快速模型改名', {
    ...one,
    baseUrl: 'http://localhost:19555/v1',
  })
  expect(await readProfiles()).toHaveLength(2)
  expect(changed.profileId).toBe(one.profileId)
  expect((await db.jobs.get(job.id))?.baseUrl).toBe(config.baseUrl)
  await deleteProfile(one.profileId!)
  expect((await readProfiles()).map((p) => p.name)).toEqual(['推理模型'])
})
it('retains a recoverable result draft and blocks backup until it is dealt with', async () => {
  localStorage.setItem(
    'paperead-result-draft:draft-test',
    JSON.stringify({ name: 'Reloaded draft', markdown: 'Still unsaved' }),
  )
  await expect(createBackup()).rejects.toThrow('校对草稿')
  clearResultDraft('draft-test')
  expect(setResultDraft('draft-test', { name: 'Draft', markdown: 'Unsaved correction' })).toBe(true)
  expect(getResultDraft('draft-test')?.markdown).toBe('Unsaved correction')
  await expect(createBackup()).rejects.toThrow('校对草稿')
  clearResultDraft('draft-test')
  expect(getResultDraft('draft-test')).toBeUndefined()
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('full')
    },
    getItem: () => null,
    removeItem: () => {},
  })
  expect(setResultDraft('draft-test', { name: 'Draft', markdown: 'Keep in memory' })).toBe(false)
  expect(getResultDraft('draft-test')?.markdown).toBe('Keep in memory')
  clearResultDraft('draft-test')
})

it('clears correction drafts only after permanently deleting their source paper', async () => {
  const job = await completed()
  setResultDraft(job.id, { name: 'Draft', markdown: 'Preserve until purge' })
  await moveToTrash([{ kind: 'paper', id: 'sample-0' }])
  expect(getResultDraft(job.id)?.markdown).toBe('Preserve until purge')
  await permanentlyDelete([{ kind: 'paper', id: 'sample-0' }])
  expect(getResultDraft(job.id)).toBeUndefined()
  await expect(createBackup()).resolves.toBeInstanceOf(Blob)
})
