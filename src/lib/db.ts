import Dexie, { type EntityTable } from 'dexie'
import type {
  Annotation,
  Asset,
  Collection,
  Job,
  Note,
  Page,
  Paper,
  NoteFolder,
  Attachment,
  Snapshot,
} from '../types'
import { samplePapers, samplePages, sampleNote, defaultCollections } from './samples'

export const db = new Dexie('paperead-v1') as Dexie & {
  papers: EntityTable<Paper, 'id'>
  assets: EntityTable<Asset, 'paperId'>
  pages: EntityTable<Page, 'id'>
  collections: EntityTable<Collection, 'id'>
  notes: EntityTable<Note, 'id'>
  annotations: EntityTable<Annotation, 'id'>
  jobs: EntityTable<Job, 'id'>
  meta: EntityTable<{ key: string; value: string }, 'key'>
  noteFolders: EntityTable<NoteFolder, 'id'>
  attachments: EntityTable<Attachment, 'id'>
  snapshots: EntityTable<Snapshot, 'id'>
}
db.version(1).stores({
  papers: 'id, &hash, collectionId, status, createdAt, lastReadAt, *tags',
  assets: 'paperId',
  pages: 'id, paperId, [paperId+number]',
  collections: 'id',
  notes: 'id, paperId, updatedAt',
  annotations: 'id, paperId, [paperId+source]',
  jobs: 'id, paperId, status',
  meta: 'key',
})
db.version(2).stores({
  papers: 'id, &hash, collectionId, status, createdAt, lastReadAt, *tags, deletedAt',
  notes: 'id, paperId, updatedAt, deletedAt',
  annotations: 'id, paperId, [paperId+source], deletedAt',
})
db.version(3)
  .stores({
    papers: 'id, &hash, collectionId, status, createdAt, lastReadAt, *tags, deletedAt, doi',
    notes: 'id, paperId, updatedAt, deletedAt, folderId, *tags',
    noteFolders: 'id',
    attachments: 'id',
    snapshots: 'id, createdAt, kind',
  })
  .upgrade(async (tx) => {
    await tx.table('papers').toCollection().modify({ metadataStatus: 'unverified' })
  })

export async function deletePaper(id: string) {
  await db.transaction(
    'rw',
    [db.papers, db.assets, db.pages, db.annotations, db.jobs, db.notes],
    async () => {
      await db.papers.delete(id)
      await db.assets.delete(id)
      await db.pages.where('paperId').equals(id).delete()
      await db.annotations.where('paperId').equals(id).delete()
      await db.jobs.where('paperId').equals(id).delete()
      // Independent notes remain available after their source paper is removed.
      await db.notes
        .where('paperId')
        .equals(id)
        .modify((note) => {
          delete note.paperId
        })
    },
  )
}

export async function seedDatabase() {
  await db.transaction('rw', [db.meta, db.collections, db.papers, db.pages, db.notes], async () => {
    if (await db.meta.get('initialized')) return
    await db.collections.bulkPut(defaultCollections)
    await db.papers.bulkPut(samplePapers)
    await db.pages.bulkPut(samplePages)
    await db.notes.put(sampleNote)
    await db.meta.put({ key: 'initialized', value: 'true' })
  })
}

// Call only after acquiring the exclusive workspace lock. Opening another
// window must never change the status of work that is still in progress.
export async function recoverInterruptedJobs() {
  await db.jobs
    .where('status')
    .equals('running')
    .modify({ status: 'cancelled', error: '上次任务已中断，可继续处理未完成的批次。' })
}
