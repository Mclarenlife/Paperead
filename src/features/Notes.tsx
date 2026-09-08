import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { db } from '../lib/db'
import { errorMessage, formatDate, uid } from '../lib/utils'
import { Markdown } from '../components/Markdown'
import { Modal, useToast } from '../components/UI'
import { exportDocument } from '../lib/export'
import type { Note } from '../types'
import { isTauri } from '@tauri-apps/api/core'
import { pickNativeFiles } from '../lib/platform'
import { discardDraft, editDraft, loadDraft, saveDraft, useNoteDraft } from '../lib/note-drafts'
import { useNavigationGuard } from '../components/NavigationGuard'
import { moveToTrash, restoreFromTrash } from '../lib/trash'
import { NoteOrganization } from '../components/NoteOrganization'
import { exportNotesZip, importNoteContent } from '../lib/note-library'
import { saveFile } from '../lib/platform'

export function Notes({
  initialId,
  onOpenPaper,
}: {
  initialId?: string
  onOpenPaper: (id: string) => void
}) {
  const notes = useLiveQuery(
    () =>
      db.notes
        .orderBy('updatedAt')
        .reverse()
        .filter((note) => !note.deletedAt)
        .toArray(),
    [],
    [],
  )
  const guard = useNavigationGuard()
  const folders = useLiveQuery(() => db.noteFolders.toArray(), [], [])
  const [folder, setFolder] = useState('all'),
    [tag, setTag] = useState('')
  const [selected, setSelected] = useState(initialId || ''),
    [search, setSearch] = useState(''),
    [mobileEditor, setMobileEditor] = useState(!!initialId)
  const toast = useToast()
  const filtered = notes.filter(
    (n) =>
      (folder === 'all' || (n.folderId || '') === folder) &&
      (!tag || n.tags?.includes(tag)) &&
      `${n.title} ${n.markdown} ${(n.tags || []).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const active = notes.find((n) => n.id === selected) || filtered[0]
  useEffect(() => {
    if (!selected && filtered[0]) setSelected(filtered[0].id)
  }, [selected, filtered[0]?.id])
  async function addNote() {
    const note: Note = {
      id: uid(),
      title: '未命名笔记',
      folderId: folder === 'all' ? '' : folder,
      markdown: '# 新的想法\n\n',
      updatedAt: Date.now(),
    }
    await db.notes.add(note)
    setSelected(note.id)
    setMobileEditor(true)
  }
  async function importNotes(files: File[]) {
    if (!files.length) return
    try {
      const imported = await Promise.all(
        files.map(async (f) => {
          if (f.size > 20 * 1024 * 1024) throw new Error('含图片的 Markdown 不能超过 20 MB。')
          return {
            id: uid(),
            title: f.name.replace(/\.(md|markdown|txt)$/i, ''),
            markdown: await importNoteContent(await f.text()),
            folderId: folder === 'all' ? '' : folder,
            updatedAt: Date.now(),
          }
        }),
      )
      await db.notes.bulkAdd(imported)
      setSelected(imported[0].id)
      setMobileEditor(true)
      toast(`已导入 ${imported.length} 篇笔记`)
    } catch (error) {
      toast(errorMessage(error), true)
    }
  }
  return (
    <div className={`notes-page ${mobileEditor ? 'mobile-editor-open' : ''}`}>
      <div className="notes-sidebar">
        <div className="notes-sidebar-title">
          <div>
            <div className="eyebrow">THINKING IN WRITING</div>
            <h1>我的笔记</h1>
          </div>
          <button
            className="icon-button solid"
            onClick={() => guard.navigate(() => void addNote())}
            aria-label="新建笔记"
          >
            <Plus size={18} />
          </button>
        </div>
        <label className="note-search">
          <Search size={16} />
          <input
            placeholder="搜索笔记…"
            value={search}
            onChange={(e) => {
              const value = e.target.value
              guard.navigate(() => {
                setSearch(value)
                setSelected('')
              })
            }}
          />
        </label>
        <div className="notes-list">
          <div className="note-filters">
            <select
              aria-label="筛选笔记文件夹"
              value={folder}
              onChange={(e) =>
                guard.navigate(() => {
                  setFolder(e.target.value)
                  setSelected('')
                })
              }
            >
              <option value="all">全部文件夹</option>
              <option value="">未分类</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选笔记标签"
              value={tag}
              onChange={(e) =>
                guard.navigate(() => {
                  setTag(e.target.value)
                  setSelected('')
                })
              }
            >
              <option value="">全部标签</option>
              {[...new Set(notes.flatMap((n) => n.tags || []))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button
              className="button small"
              disabled={!filtered.length}
              onClick={() =>
                guard.navigate(() => {
                  void exportNotesZip(filtered)
                    .then((zip) => saveFile('Paperead-notes.zip', zip))
                    .catch((e) => toast(errorMessage(e), true))
                })
              }
            >
              批量导出 {filtered.length} 篇笔记
            </button>
          </div>
          {filtered.map((n) => (
            <button
              key={n.id}
              className={`note-list-item ${active?.id === n.id ? 'active' : ''}`}
              onClick={() =>
                guard.navigate(() => {
                  setSelected(n.id)
                  setMobileEditor(true)
                })
              }
            >
              <span>
                <FileText size={16} />
                <small>{formatDate(n.updatedAt)}</small>
              </span>
              <b>{n.title}</b>
              <p>{n.markdown.replace(/[#*>`\n]/g, ' ').slice(0, 90)}</p>
            </button>
          ))}
          {!notes.length && <p className="muted">写下第一个想法吧。</p>}
        </div>
        <label
          className="button note-import"
          onClick={(e) => {
            if (!isTauri()) return
            e.preventDefault()
            guard.navigate(() => {
              void pickNativeFiles(['md', 'markdown', 'txt'])
                .then((files) => importNotes(files || []))
                .catch((error) => toast(errorMessage(error), true))
            })
          }}
        >
          <Upload size={15} />
          导入 Markdown
          <input
            className="sr-only"
            type="file"
            accept=".md,.markdown,.txt"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files || [])
              e.target.value = ''
              guard.navigate(() => void importNotes(files))
            }}
          />
        </label>
      </div>
      {active ? (
        <NoteEditor
          key={active.id}
          note={active}
          onBack={() => setMobileEditor(false)}
          onOpenPaper={onOpenPaper}
        />
      ) : (
        <div className="empty-state">
          <FileText size={36} />
          <h3>给思考一个安放的地方</h3>
          <p>记录阅读中的问题、连接与灵感。</p>
          <button className="button primary" onClick={() => guard.navigate(() => void addNote())}>
            <Plus size={15} />
            新建笔记
          </button>
        </div>
      )}
    </div>
  )
}

function NoteEditor({
  note,
  onBack,
  onOpenPaper,
}: {
  note: Note
  onBack: () => void
  onOpenPaper: (id: string) => void
}) {
  const [title, setTitle] = useState(() => loadDraft(note)?.title ?? note.title),
    [markdown, setMarkdown] = useState(() => loadDraft(note)?.markdown ?? note.markdown),
    [mode, setMode] = useState('split'),
    [confirmDelete, setConfirmDelete] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const toast = useToast(),
    guard = useNavigationGuard(),
    draft = useNoteDraft(note.id)
  useEffect(() => guard.watchNote(note.id), [note.id, guard.watchNote])
  function update(t: string, md: string) {
    setTitle(t)
    setMarkdown(md)
    editDraft(note, t, md)
  }
  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <button
          className="icon-button mobile-only"
          onClick={() => guard.navigate(onBack)}
          aria-label="返回笔记列表"
        >
          <ArrowLeft size={18} />
        </button>
        <span className={`save-state ${draft?.status === 'error' ? 'save-failed' : ''}`}>
          <Check size={14} />
          {!draft
            ? '已保存到本地'
            : draft.status === 'error'
              ? '保存失败 · 草稿已保留'
              : '正在保存…'}
        </span>
        <div className="segmented">
          {[
            ['edit', '编辑'],
            ['split', '分栏'],
            ['preview', '预览'],
          ].map(([k, t]) => (
            <button key={k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
              {t}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="导出笔记 Markdown"
          onClick={async () => {
            try {
              if (await exportDocument(title, markdown, 'md')) toast('Markdown 笔记已导出')
            } catch (e) {
              toast(errorMessage(e), true)
            }
          }}
        >
          <Download size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="删除笔记"
          onClick={() => setConfirmDelete(!confirmDelete)}
        >
          <Trash2 size={17} />
        </button>
      </div>
      {draft?.status === 'error' && (
        <div className="draft-error" role="alert">
          <div>
            <b>笔记保存失败</b>
            <p>{draft.error}</p>
            <small>
              {draft.durable
                ? '草稿已另存本机，重新打开此笔记可恢复。'
                : '草稿暂存内存，关闭程序前请导出。'}
            </small>
          </div>
          <button className="button small" onClick={() => void saveDraft(note.id)}>
            重试保存
          </button>
          <button
            className="button small"
            onClick={() =>
              void exportDocument(`${title}-草稿`, markdown, 'md').catch((e) =>
                toast(errorMessage(e), true),
              )
            }
          >
            导出草稿
          </button>
          <button className="text-button danger-text" onClick={() => setDiscardOpen(true)}>
            放弃草稿
          </button>
        </div>
      )}
      {confirmDelete && (
        <div className="inline-confirm">
          <span>将「{title}」移入回收站？之后可以恢复。</span>
          <button
            className="button danger"
            onClick={() =>
              guard.navigate(() => {
                const items = [{ kind: 'note' as const, id: note.id }]
                void moveToTrash(items)
                  .then(() =>
                    toast('笔记已移入回收站', false, {
                      label: '撤销',
                      run: async () => {
                        await restoreFromTrash(items)
                        toast('笔记已恢复')
                      },
                    }),
                  )
                  .catch((e) => toast(errorMessage(e), true))
              })
            }
          >
            移入回收站
          </button>
          <button className="button" onClick={() => setConfirmDelete(false)}>
            取消
          </button>
        </div>
      )}
      <div className="note-title-area">
        <input
          aria-label="笔记标题"
          value={title}
          onChange={(e) => void update(e.target.value, markdown)}
          placeholder="笔记标题"
        />
        {note.paperId && (
          <button className="note-source" onClick={() => onOpenPaper(note.paperId!)}>
            <BookOpen size={13} />
            打开关联文献
          </button>
        )}
      </div>
      <NoteOrganization
        note={note}
        onInsert={(text) => update(title, `${markdown}\n\n${text}\n`)}
        onRestore={(saved) => {
          setTitle(saved.title)
          setMarkdown(saved.markdown)
        }}
      />
      <div className={`markdown-workspace mode-${mode}`}>
        {mode !== 'preview' && (
          <div className="markdown-edit-pane">
            <div className="pane-label">MARKDOWN</div>
            <textarea
              spellCheck={false}
              aria-label="Markdown 笔记正文"
              value={markdown}
              onChange={(e) => void update(title, e.target.value)}
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="markdown-preview-pane">
            <div className="pane-label">阅读预览</div>
            <Markdown text={markdown} />
          </div>
        )}
      </div>
      <div className="note-statusbar">
        <span>{markdown.length.toLocaleString()} 字符</span>
        <span>Markdown · 支持表格 / 任务列表 / LaTeX 公式</span>
      </div>
      {discardOpen && (
        <Modal title="放弃未保存的草稿" onClose={() => setDiscardOpen(false)}>
          <p>恢复此笔记上次保存的内容？当前草稿会被移除；需要保留时请先导出。</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDiscardOpen(false)}>
              取消
            </button>
            <button
              className="button danger"
              onClick={() => {
                discardDraft(note.id)
                setTitle(note.title)
                setMarkdown(note.markdown)
                setDiscardOpen(false)
              }}
            >
              放弃草稿并恢复
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
