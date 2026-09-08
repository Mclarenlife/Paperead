import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArchiveRestore, FileText, Highlighter, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { permanentlyDelete, restoreFromTrash, type TrashRef } from '../lib/trash'
import { discardDraft } from '../lib/note-drafts'
import { errorMessage, formatDate } from '../lib/utils'
import { Modal, useToast } from '../components/UI'

export function Trash() {
  const papers = useLiveQuery(() => db.papers.toArray(), [], [])
  const notes = useLiveQuery(() => db.notes.filter((n) => !!n.deletedAt).toArray(), [], [])
  const annotations = useLiveQuery(
    () => db.annotations.filter((a) => !!a.deletedAt).toArray(),
    [],
    [],
  )
  const [filter, setFilter] = useState('all'),
    [pending, setPending] = useState<TrashRef[] | null>(null),
    [busy, setBusy] = useState(false)
  const toast = useToast()
  const rows = [
    ...papers
      .filter((p) => p.deletedAt)
      .map((p) => ({
        kind: 'paper' as const,
        id: p.id,
        title: p.title,
        deletedAt: p.deletedAt!,
        detail: `${p.pageCount} 页 · 包含 PDF、批注与 AI 结果`,
        blocked: false,
      })),
    ...notes.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      title: n.title,
      deletedAt: n.deletedAt!,
      detail: 'Markdown 笔记',
      blocked: false,
    })),
    ...annotations
      .filter((a) => !papers.find((p) => p.id === a.paperId)?.deletedAt)
      .map((a) => ({
        kind: 'annotation' as const,
        id: a.id,
        title: a.comment || a.quote,
        deletedAt: a.deletedAt!,
        detail: papers.find((p) => p.id === a.paperId)?.title || '批注',
        blocked: false,
      })),
  ].sort((a, b) => b.deletedAt - a.deletedAt)
  async function restore(items: TrashRef[]) {
    setBusy(true)
    try {
      await restoreFromTrash(items)
      toast('已恢复到资料库')
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="trash-page">
      <div className="eyebrow">A LITTLE ROOM TO RECONSIDER</div>
      <div className="section-heading">
        <div>
          <h1>回收站</h1>
          <p className="muted">
            内容保留到你手动彻底删除。恢复文献时，PDF、批注和 AI 结果一起恢复。
          </p>
        </div>
        <button
          className="button danger"
          disabled={!rows.length || busy}
          onClick={() => setPending(rows)}
        >
          清空回收站
        </button>
      </div>
      <div className="filter-tabs">
        {[
          ['all', '全部'],
          ['paper', '文献'],
          ['note', '笔记'],
          ['annotation', '批注'],
        ].map(([kind, label]) => (
          <button
            key={kind}
            className={filter === kind ? 'active' : ''}
            onClick={() => setFilter(kind)}
          >
            {label}
            <span>{rows.filter((row) => kind === 'all' || row.kind === kind).length}</span>
          </button>
        ))}
      </div>
      <div className="trash-list">
        {rows
          .filter((row) => filter === 'all' || row.kind === filter)
          .map((row) => (
            <article className="trash-row" key={`${row.kind}:${row.id}`}>
              <span className="stat-icon">
                {row.kind === 'annotation' ? <Highlighter size={20} /> : <FileText size={20} />}
              </span>
              <div className="trash-info">
                <h3>{row.title || '未命名内容'}</h3>
                <p>
                  {row.detail} · {formatDate(row.deletedAt)} 删除
                </p>
              </div>
              <button className="button small" disabled={busy} onClick={() => void restore([row])}>
                <ArchiveRestore size={15} />
                恢复
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`彻底删除 ${row.title}`}
                disabled={busy}
                onClick={() => setPending([row])}
              >
                <Trash2 size={17} />
              </button>
            </article>
          ))}
      </div>
      {!rows.filter((row) => filter === 'all' || row.kind === filter).length && (
        <div className="empty-state">
          <ArchiveRestore size={32} />
          <h3>这里没有已删除的内容</h3>
          <p>从文献库、笔记或批注中删除的内容会先来到这里。</p>
        </div>
      )}
      {pending && (
        <Modal
          title="彻底删除"
          onClose={() => {
            if (!busy) setPending(null)
          }}
        >
          <p>
            彻底删除这 {pending.length} 项内容？文献的 PDF、批注与 AI
            结果会一起移除，关联笔记保留并解除关联。此操作无法撤销。
          </p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setPending(null)}>
              取消
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await permanentlyDelete(pending)
                  pending
                    .filter((item) => item.kind === 'note')
                    .forEach((item) => discardDraft(item.id))
                  setPending(null)
                  toast('已彻底删除')
                } catch (e) {
                  toast(errorMessage(e), true)
                } finally {
                  setBusy(false)
                }
              }}
            >
              确认彻底删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
