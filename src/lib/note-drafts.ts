import { useSyncExternalStore } from 'react'
import { db } from './db'
import type { Note } from '../types'
import { errorMessage } from './utils'
import { withNoteHistory } from './note-library'

export interface NoteDraft {
  id: string
  title: string
  markdown: string
  revision: number
  updatedAt: number
  status: 'saving' | 'error'
  error?: string
  durable: boolean
}
const drafts = new Map<string, NoteDraft>()
const writers = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const key = (id: string) => `paperead-note-draft:${id}`
function announce() {
  listeners.forEach((listener) => listener())
}
function persist(draft: NoteDraft) {
  try {
    localStorage.setItem(key(draft.id), JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}
export function getDraft(id: string): NoteDraft | undefined {
  return drafts.get(id)
}
export function allDrafts() {
  return [...drafts.values()]
}
export function loadDraft(note: Note) {
  if (drafts.has(note.id)) return drafts.get(note.id)
  try {
    const raw = localStorage.getItem(key(note.id))
    if (!raw) return
    const saved = JSON.parse(raw)
    if (
      saved.id !== note.id ||
      typeof saved.title !== 'string' ||
      typeof saved.markdown !== 'string'
    )
      return
    if (saved.title === note.title && saved.markdown === note.markdown) {
      localStorage.removeItem(key(note.id))
      return
    }
    const draft: NoteDraft = {
      ...saved,
      revision: 1,
      status: 'error',
      error: '发现上次未保存的草稿，请重试保存或导出。',
      durable: true,
    }
    drafts.set(note.id, draft)
    return draft
  } catch {
    /* Failed draft storage does not prevent opening a saved note. */
  }
}
export function discardDraft(id: string) {
  drafts.delete(id)
  try {
    localStorage.removeItem(key(id))
  } catch {
    /* memory still cleared */
  }
  announce()
}
export function editDraft(note: Note, title: string, markdown: string) {
  const draft: NoteDraft = {
    id: note.id,
    title,
    markdown,
    revision: (drafts.get(note.id)?.revision || 0) + 1,
    updatedAt: Date.now(),
    status: 'saving',
    durable: false,
  }
  draft.durable = persist(draft)
  drafts.set(note.id, draft)
  announce()
  void saveDraft(note.id)
}
export function saveDraft(id: string): Promise<void> {
  const existing = writers.get(id)
  if (existing) return existing
  const work = (async () => {
    while (drafts.has(id)) {
      const current = drafts.get(id)!
      drafts.set(id, { ...current, status: 'saving', error: undefined })
      announce()
      try {
        await db.transaction('rw', db.notes, async () => {
          const note = await db.notes.get(id)
          if (!note || note.deletedAt) throw new Error('笔记已删除，请先恢复，或导出草稿。')
          await db.notes.update(id, {
            history: withNoteHistory(note, current.updatedAt),
            title: current.title,
            markdown: current.markdown,
            updatedAt: current.updatedAt,
          })
        })
        if (drafts.get(id)?.revision === current.revision) {
          discardDraft(id)
          break
        }
      } catch (error) {
        const latest = drafts.get(id)
        if (latest) {
          drafts.set(id, { ...latest, status: 'error', error: errorMessage(error) })
          announce()
        }
        break
      }
    }
  })()
  writers.set(id, work)
  void work.finally(() => writers.delete(id))
  return work
}
export function useNoteDraft(id: string) {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    () => drafts.get(id),
  )
}
