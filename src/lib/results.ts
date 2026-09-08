import { db } from './db'
import { uid } from './utils'
import type { Job } from '../types'

export const resultName = (job: Job) =>
  job.name ||
  `${job.kind === 'translation' ? '译文' : '重排'} · ${new Date(job.updatedAt).toLocaleString()} · ${job.model}`
export async function reviseResult(id: string, name: string, markdown: string) {
  if (!markdown.trim()) throw new Error('校对内容不能为空。')
  if (markdown.length > 5_000_000) throw new Error('校对内容超过 500 万字符。')
  return db.transaction('rw', db.jobs, db.papers, async () => {
    const source = await db.jobs.get(id)
    const paper = source && (await db.papers.get(source.paperId))
    if (!source || source.status !== 'completed' || !paper || paper.deletedAt)
      throw new Error('只能校对已完成且可用的结果。')
    const revision: Job = {
      ...source,
      id: uid(),
      revisionOf: id,
      name: (name.trim() || '校对修订').slice(0, 200),
      editedMarkdown: markdown,
      documentVersion: 2,
      updatedAt: Date.now(),
    }
    await db.jobs.add(revision)
    return revision
  })
}
export async function renameResult(id: string, name: string) {
  if (!name.trim()) throw new Error('请输入版本名称。')
  await db.jobs.update(id, { name: name.trim().slice(0, 200) })
}
export async function deleteResult(id: string) {
  await db.transaction('rw', db.jobs, db.annotations, db.papers, async () => {
    const job = await db.jobs.get(id)
    if (!job) return
    if (job.status === 'running') throw new Error('请先暂停此任务，再删除版本。')
    await db.annotations.filter((a) => a.jobId === id).delete()
    const paper = await db.papers.get(job.paperId)
    if (paper)
      await db.papers.update(paper.id, {
        bookmarks: paper.bookmarks?.filter((b) => b.jobId !== id),
        readingPositions: Object.fromEntries(
          Object.entries(paper.readingPositions || {}).filter(([, value]) => value.jobId !== id),
        ),
        lastLocation: paper.lastLocation?.jobId === id ? undefined : paper.lastLocation,
      })
    await db.jobs.delete(id)
  })
  clearResultDraft(id)
}

export interface ResultDraft {
  name: string
  markdown: string
  durable?: boolean
}
const drafts = new Map<string, ResultDraft>()
const draftKey = (id: string) => `paperead-result-draft:${id}`
export function getResultDraft(id: string) {
  if (drafts.has(id)) return drafts.get(id)
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(id)) || 'null')
    if (value && typeof value.name === 'string' && typeof value.markdown === 'string') {
      const draft = { ...value, durable: true } as ResultDraft
      drafts.set(id, draft)
      return draft
    }
  } catch {
    /* The editor can still open the saved result. */
  }
}
export function setResultDraft(id: string, draft: ResultDraft) {
  let durable = false
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(draft))
    durable = true
  } catch {
    /* Warn before closing. */
  }
  drafts.set(id, { ...draft, durable })
  return durable
}
export function clearResultDraft(id: string) {
  drafts.delete(id)
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    /* memory cleared */
  }
}
export function hasResultDrafts() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('paperead-result-draft:'))
        getResultDraft(key.slice('paperead-result-draft:'.length))
    }
  } catch {
    /* In-memory drafts are still protected when local storage is unavailable. */
  }
  return drafts.size > 0
}
