import { db, deletePaper } from './db'
import { cancelJob } from './ai'
import { clearResultDraft } from './results'
import type { Paper } from '../types'

export type TrashKind = 'paper' | 'note' | 'annotation'
export interface TrashRef {
  kind: TrashKind
  id: string
}
export async function moveToTrash(items: TrashRef[]) {
  const paperIds = items.filter((item) => item.kind === 'paper').map((item) => item.id)
  const jobs = paperIds.length ? await db.jobs.where('paperId').anyOf(paperIds).toArray() : []
  jobs.forEach((job) => cancelJob(job.id))
  const deletedAt = Date.now()
  await db.transaction('rw', [db.papers, db.notes, db.annotations, db.jobs], async () => {
    for (const item of items) {
      const table =
        item.kind === 'paper' ? db.papers : item.kind === 'note' ? db.notes : db.annotations
      const saved = await table.get(item.id)
      if (saved && !saved.deletedAt) await table.update(item.id, { deletedAt })
    }
    for (const job of jobs)
      if (job.status === 'running')
        await db.jobs.update(job.id, {
          status: 'cancelled',
          error: '文献已移入回收站，恢复后可继续。',
        })
  })
}

export async function restoreFromTrash(items: TrashRef[]) {
  await db.transaction('rw', [db.papers, db.notes, db.annotations, db.collections], async () => {
    // Restoring annotations requires an active source; never silently restore
    // or permanently remove a different item than the one the user selected.
    for (const item of items.filter((entry) => entry.kind === 'paper')) {
      const paper = await db.papers.get(item.id)
      if (paper?.deletedAt)
        await db.papers.update(item.id, {
          deletedAt: undefined,
          collectionId:
            paper.collectionId && (await db.collections.get(paper.collectionId))
              ? paper.collectionId
              : '',
        })
    }
    for (const item of items.filter((entry) => entry.kind !== 'paper')) {
      if (item.kind === 'note') await db.notes.update(item.id, { deletedAt: undefined })
      else {
        const annotation = await db.annotations.get(item.id)
        const paper = annotation && (await db.papers.get(annotation.paperId))
        if (!paper || paper.deletedAt) throw new Error('请先恢复批注所属的文献。')
        await db.annotations.update(item.id, { deletedAt: undefined })
      }
    }
  })
}

export async function permanentlyDelete(items: TrashRef[]) {
  const removedJobs: string[] = []
  await db.transaction(
    'rw',
    [db.papers, db.assets, db.pages, db.annotations, db.jobs, db.notes],
    async () => {
      for (const item of items) {
        const table =
          item.kind === 'paper' ? db.papers : item.kind === 'note' ? db.notes : db.annotations
        const entry = await table.get(item.id)
        if (!entry) continue
        if (!entry.deletedAt) throw new Error('只能彻底删除回收站中的内容。')
        if (item.kind === 'paper') {
          removedJobs.push(...(await db.jobs.where('paperId').equals(item.id).primaryKeys()))
          await deletePaper(item.id)
        } else await table.delete(item.id)
      }
    },
  )
  removedJobs.forEach(clearResultDraft)
}

export async function updatePapers(
  ids: string[],
  change: Pick<Partial<Paper>, 'collectionId' | 'status' | 'starred'>,
  tags?: { mode: 'add' | 'remove' | 'replace'; values: string[] },
) {
  await db.transaction('rw', db.papers, db.collections, async () => {
    if (change.collectionId && !(await db.collections.get(change.collectionId)))
      throw new Error('文献集不存在。')
    for (const id of new Set(ids)) {
      const paper = await db.papers.get(id)
      if (!paper || paper.deletedAt) continue
      const next = tags
        ? tags.mode === 'replace'
          ? tags.values
          : tags.mode === 'remove'
            ? paper.tags.filter((tag) => !tags.values.includes(tag))
            : [...paper.tags, ...tags.values]
        : undefined
      if (next && (new Set(next).size > 100 || next.some((tag) => tag.length > 200)))
        throw new Error('每篇文献最多 100 个标签，每个不超过 200 字符。')
      await db.papers.update(id, { ...change, ...(next ? { tags: [...new Set(next)] } : {}) })
    }
  })
}
