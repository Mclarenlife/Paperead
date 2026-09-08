import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Modal, useToast } from './UI'
import { uid, errorMessage } from '../lib/utils'
import { addAttachment, restoreNoteVersion } from '../lib/note-library'
import { pickNativeFiles } from '../lib/platform'
import { isTauri } from '@tauri-apps/api/core'
import type { Note } from '../types'
import { useNavigationGuard } from './NavigationGuard'
export function NoteOrganization({
  note,
  onInsert,
  onRestore,
}: {
  note: Note
  onInsert: (markdown: string) => void
  onRestore: (note: Note) => void
}) {
  const folders = useLiveQuery(() => db.noteFolders.toArray(), [], []),
    [folderOpen, setFolderOpen] = useState(false),
    [folderName, setFolderName] = useState(''),
    [historyOpen, setHistoryOpen] = useState(false),
    [selectedHistory, setSelectedHistory] = useState(''),
    [busy, setBusy] = useState(false),
    toast = useToast(),
    guard = useNavigationGuard()
  async function image(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      onInsert(await addAttachment(file))
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy(false)
    }
  }
  const revision = note.history?.find((h) => h.id === selectedHistory)
  return (
    <>
      <div className="note-organization">
        <select
          aria-label="笔记文件夹"
          value={note.folderId || ''}
          onChange={(e) =>
            void db.notes
              .update(note.id, { folderId: e.target.value })
              .catch((e) => toast(errorMessage(e), true))
          }
        >
          <option value="">未分类</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className="button small" onClick={() => setFolderOpen(true)}>
          管理文件夹
        </button>
        <input
          key={`${note.id}:${(note.tags || []).join(',')}`}
          aria-label="笔记标签"
          placeholder="标签，用逗号分隔"
          defaultValue={(note.tags || []).join(', ')}
          onBlur={(e) => {
            const tags = [
              ...new Set(
                e.target.value
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ]
            if (tags.length > 100 || tags.some((t) => t.length > 200))
              toast('标签最多 100 个，每个最多 200 字符', true)
            else void db.notes.update(note.id, { tags }).catch((e) => toast(errorMessage(e), true))
          }}
        />
        <label
          className="button small"
          onClick={(e) => {
            if (isTauri()) {
              e.preventDefault()
              void pickNativeFiles(['png', 'jpg', 'jpeg', 'webp'], false)
                .then((f) => image(f?.[0]))
                .catch((e) => toast(errorMessage(e), true))
            }
          }}
        >
          插入图片
          <input
            aria-label="插入笔记图片"
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              void image(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <button className="button small" onClick={() => guard.navigate(() => setHistoryOpen(true))}>
          历史版本（{note.history?.length || 0}）
        </button>
      </div>
      {folderOpen && (
        <Modal title="笔记文件夹" onClose={() => setFolderOpen(false)}>
          <label className="field">
            新文件夹名称
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              maxLength={200}
            />
          </label>
          <button
            className="button primary"
            disabled={!folderName.trim()}
            onClick={async () => {
              try {
                const id = uid()
                await db.noteFolders.add({ id, name: folderName.trim() })
                await db.notes.update(note.id, { folderId: id })
                setFolderName('')
                toast('文件夹已创建')
              } catch (e) {
                toast(errorMessage(e), true)
              }
            }}
          >
            创建文件夹
          </button>
          <div className="preview-list">
            {folders.map((f) => (
              <div className="folder-row" key={f.id}>
                <input
                  aria-label={`重命名文件夹 ${f.name}`}
                  defaultValue={f.name}
                  maxLength={200}
                  onBlur={(e) => {
                    if (e.target.value.trim())
                      void db.noteFolders
                        .update(f.id, { name: e.target.value.trim() })
                        .catch((e) => toast(errorMessage(e), true))
                  }}
                />
                <button
                  className="text-button danger-text"
                  onClick={async () => {
                    try {
                      await db.transaction('rw', db.noteFolders, db.notes, async () => {
                        await db.notes.where('folderId').equals(f.id).modify({ folderId: '' })
                        await db.noteFolders.delete(f.id)
                      })
                      toast('文件夹已删除，笔记保留')
                    } catch (e) {
                      toast(errorMessage(e), true)
                    }
                  }}
                >
                  删除（保留笔记）
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {historyOpen && (
        <Modal title="笔记历史版本" wide onClose={() => setHistoryOpen(false)}>
          <p className="field-hint">
            自动保存按编辑时段保留历史，最多 30 份。恢复前会保留当前正文。
          </p>
          <select
            aria-label="选择笔记历史版本"
            value={selectedHistory}
            onChange={(e) => setSelectedHistory(e.target.value)}
          >
            <option value="">选择版本</option>
            {[...(note.history || [])].reverse().map((h) => (
              <option key={h.id} value={h.id}>
                {new Date(h.createdAt).toLocaleString()} · {h.title}
              </option>
            ))}
          </select>
          {revision && (
            <>
              <pre className="history-preview">{revision.markdown}</pre>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await restoreNoteVersion(note.id, revision.id)
                    onRestore((await db.notes.get(note.id))!)
                    setHistoryOpen(false)
                    toast('历史版本已恢复，原正文已保留')
                  } catch (e) {
                    toast(errorMessage(e), true)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                恢复此笔记版本
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
