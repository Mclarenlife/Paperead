import JSZip from 'jszip'
import { db } from './db'
import { uid, safeFilename } from './utils'
import type { Note } from '../types'

export function withNoteHistory(note: Note, now = Date.now()) {
  const history = [...(note.history || [])]
  // Coalesce fast autosaves, while keeping the version that preceded this editing session.
  if (!history.length || now - history.at(-1)!.createdAt > 60_000)
    history.push({ id: uid(), title: note.title, markdown: note.markdown, createdAt: now })
  while (
    history.length > 30 ||
    (history.length > 1 && history.reduce((n, h) => n + h.markdown.length, 0) > 5_000_000)
  )
    history.shift()
  return history
}
export async function restoreNoteVersion(id: string, revisionId: string) {
  await db.transaction('rw', db.notes, async () => {
    const note = await db.notes.get(id),
      revision = note?.history?.find((h) => h.id === revisionId)
    if (!note || !revision || note.deletedAt) throw new Error('笔记历史版本不可用。')
    const history = [
      ...(note.history || []),
      { id: uid(), title: note.title, markdown: note.markdown, createdAt: Date.now() },
    ].slice(-30)
    while (history.length > 1 && history.reduce((sum, h) => sum + h.markdown.length, 0) > 5_000_000)
      history.shift()
    await db.notes.update(id, {
      title: revision.title,
      markdown: revision.markdown,
      history,
      updatedAt: Date.now(),
    })
  })
}
export async function addAttachment(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB。')
  const bytes = new Uint8Array(await file.arrayBuffer()),
    mime =
      bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216
          ? 'image/jpeg'
          : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
              String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
            ? 'image/webp'
            : ''
  if (!mime) throw new Error('请选择 PNG、JPEG 或 WebP 图片。')
  const id = uid()
  await db.attachments.add({
    id,
    name: file.name,
    mime,
    blob: new Blob([bytes], { type: mime }),
    createdAt: Date.now(),
  })
  return `![${file.name.replace(/[\[\]\\\r\n]/g, '')}](paperead-attachment:${id})`
}
export async function imageDataUrl(id: string) {
  const attachment = await db.attachments.get(id)
  if (!attachment) return undefined
  const bytes = new Uint8Array(await attachment.blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${attachment.mime};base64,${btoa(binary)}`
}
export async function embeddedImageBlob(url = ''): Promise<Blob | undefined> {
  const local = url.match(/^paperead-attachment:([\w-]+)$/)
  if (local) return (await db.attachments.get(local[1]))?.blob
  const data = url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (data && data[2].length <= 14_000_000)
    return new Blob([Uint8Array.from(atob(data[2]), (c) => c.charCodeAt(0))], { type: data[1] })
}
export async function importNoteContent(text: string) {
  if (text.length > 20_000_000) throw new Error('含图片的 Markdown 不能超过 20 MB。')
  for (const match of [...text.matchAll(/data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/g)]) {
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
    const markdown = await addAttachment(
      new File([bytes], `导入图片.${match[1]}`, { type: `image/${match[1]}` }),
    )
    text = text.replaceAll(match[0], markdown.match(/\((paperead-attachment:[\w-]+)\)/)![1])
  }
  if (text.length > 5_000_000) throw new Error('单篇笔记正文不能超过 500 万字符。')
  return text
}
export async function exportNotesZip(notes: Note[]) {
  if (!notes.length) throw new Error('没有可导出的笔记。')
  const zip = new JSZip(),
    folders = new Map((await db.noteFolders.toArray()).map((f) => [f.id, f.name]))
  for (const note of notes) {
    let text = note.markdown
    for (const match of text.matchAll(/paperead-attachment:([\w-]+)/g)) {
      const asset = await db.attachments.get(match[1])
      if (asset) {
        const ext = asset.mime.split('/')[1],
          name = `attachments/${asset.id}.${ext}`
        zip.file(name, await asset.blob.arrayBuffer())
        text = text.replaceAll(match[0], `../${name}`)
      }
    }
    const folder = safeFilename(folders.get(note.folderId || '') || '未分类')
    zip.file(`${folder}/${safeFilename(note.title)}-${note.id.slice(0, 8)}.md`, text)
  }
  zip.file('notes.json', JSON.stringify(notes, null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
