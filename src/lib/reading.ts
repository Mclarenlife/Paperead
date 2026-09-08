import { db } from './db'
import { uid } from './utils'
import type { ReadingLocation, Bookmark } from '../types'

export const locationKey = (location: ReadingLocation) =>
  location.source === 'original'
    ? `original:${location.page}`
    : `${location.source}:${location.jobId}`

// Ignore PDF line wrapping while retaining offsets into the original string.
export function searchableText(text: string) {
  let value = ''
  const offsets: number[] = []
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)!)
    const lowered = char.toLocaleLowerCase()
    if (!/\s/u.test(char)) {
      value += lowered
      for (let j = 0; j < lowered.length; j++) offsets.push(i)
    }
    i += char.length
  }
  offsets.push(text.length)
  return { value, offsets }
}
export function findMatches(text: string, query: string, limit = 5000) {
  const needle = searchableText(query).value
  if (!needle) return []
  const haystack = searchableText(text)
  const found: { start: number; end: number; excerpt: string }[] = []
  let offset = 0,
    at: number
  while (found.length < limit && (at = haystack.value.indexOf(needle, offset)) !== -1) {
    const start = haystack.offsets[at],
      end = haystack.offsets[at + needle.length]
    found.push({
      start,
      end,
      excerpt: text.slice(Math.max(0, start - 30), end + 55).replace(/\s+/g, ' '),
    })
    offset = at + needle.length
  }
  return found
}
export function locateRange(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0,
    began = false,
    node: Node | null
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0
    if (!began && start < offset + length) {
      range.setStart(node, start - offset)
      began = true
    }
    if (began && end <= offset + length) {
      range.setEnd(node, end - offset)
      return range
    }
    offset += length
  }
  return null
}
export async function saveReadingPosition(paperId: string, location: ReadingLocation) {
  await db.transaction('rw', db.papers, db.jobs, async () => {
    const paper = await db.papers.get(paperId)
    if (!paper || paper.deletedAt) return
    if (!(await validLocation(paperId, paper.pageCount, location))) return
    const safe = { ...location, progress: Math.max(0, Math.min(1, location.progress)) }
    await db.papers.update(paperId, {
      readingPositions: { ...paper.readingPositions, [locationKey(safe)]: safe },
      lastLocation: safe,
    })
  })
}
async function validLocation(paperId: string, pageCount: number, location: ReadingLocation) {
  if (
    !Number.isInteger(location.page) ||
    location.page < 1 ||
    location.page > pageCount ||
    !Number.isFinite(location.progress) ||
    location.progress < 0 ||
    location.progress > 1
  )
    return false
  if (location.source === 'original') return !location.jobId
  const job = location.jobId && (await db.jobs.get(location.jobId))
  return (
    !!job && job.paperId === paperId && job.kind === location.source && job.status === 'completed'
  )
}
export async function addBookmark(paperId: string, name: string, location: ReadingLocation) {
  const bookmark: Bookmark = {
    ...location,
    id: uid(),
    name: name.trim().slice(0, 200),
    createdAt: Date.now(),
  }
  if (!bookmark.name) throw new Error('请输入书签名称。')
  await db.transaction('rw', db.papers, db.jobs, async () => {
    const paper = await db.papers.get(paperId)
    if (!paper || paper.deletedAt) throw new Error('文献不可用。')
    if (!(await validLocation(paperId, paper.pageCount, location)))
      throw new Error('请先打开原文或已完成的结果，再添加书签。')
    if ((paper.bookmarks?.length || 0) >= 1000) throw new Error('每篇文献最多保存 1000 个书签。')
    await db.papers.update(paperId, { bookmarks: [...(paper.bookmarks || []), bookmark] })
  })
  return bookmark
}
export async function removeBookmark(paperId: string, bookmarkId: string) {
  await db.transaction('rw', db.papers, async () => {
    const paper = await db.papers.get(paperId)
    if (paper)
      await db.papers.update(paperId, {
        bookmarks: paper.bookmarks?.filter((b) => b.id !== bookmarkId),
      })
  })
}
