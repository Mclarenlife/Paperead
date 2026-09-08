import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { errorMessage, formatDate, formatSize } from '../lib/utils'
import { statusLabels, type Paper } from '../types'
import { Modal, useToast } from './UI'
import { lookupDoi, normalizeDoi, type ReferenceMetadata } from '../lib/metadata'
import { pickNativeFiles } from '../lib/platform'
import { isTauri } from '@tauri-apps/api/core'
export function PaperEditor({
  paper,
  onClose,
  onDelete,
}: {
  paper: Paper
  onClose: () => void
  onDelete: () => void
}) {
  const [form, setForm] = useState(paper),
    [tags, setTags] = useState(paper.tags.join(', ')),
    toast = useToast()
  const collections = useLiveQuery(() => db.collections.toArray(), [], [])
  const [lookup, setLookup] = useState<ReferenceMetadata | null>(null),
    [busy, setBusy] = useState(false)
  async function attach(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      await (await import('../lib/pdf')).importPdf(file, paper.collectionId, undefined, paper.id)
      toast('PDF 已附加')
      onClose()
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="文献信息" onClose={onClose}>
      <div className="form-stack">
        <p className="field-hint">
          {form.metadataStatus === 'verified' ? '已核验' : '待核验'} ·{' '}
          {form.metadataSource || '历史资料，请核对标题、年份和摘要'}
        </p>
        <div className="form-two">
          <label className="field">
            DOI
            <input
              aria-label="文献 DOI"
              value={form.doi || ''}
              onChange={(e) => setForm({ ...form, doi: e.target.value })}
              placeholder="10.1038/nphys1170"
            />
          </label>
          <button
            className="button"
            disabled={busy || !form.doi}
            onClick={async () => {
              setBusy(true)
              try {
                setLookup(await lookupDoi(form.doi || ''))
              } catch (e) {
                toast(errorMessage(e), true)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '正在读取…' : '根据 DOI 补全'}
          </button>
        </div>
        {paper.referenceOnly && (
          <label
            className="button"
            onClick={(e) => {
              if (isTauri()) {
                e.preventDefault()
                void pickNativeFiles(['pdf'], false)
                  .then((f) => attach(f?.[0]))
                  .catch((e) => toast(errorMessage(e), true))
              }
            }}
          >
            附加 PDF 文件
            <input
              aria-label="为引用附加 PDF"
              className="sr-only"
              type="file"
              accept=".pdf"
              disabled={busy}
              onChange={(e) => void attach(e.target.files?.[0])}
            />
          </label>
        )}
        <label className="field">
          标题
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="field">
          作者
          <input
            value={form.authors}
            onChange={(e) => setForm({ ...form, authors: e.target.value })}
          />
        </label>
        <div className="form-two">
          <label className="field">
            年份
            <input
              type="number"
              min="1000"
              max="2200"
              value={form.year || ''}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            来源 / 期刊
            <input
              value={form.venue}
              onChange={(e) => setForm({ ...form, venue: e.target.value })}
            />
          </label>
        </div>
        <div className="form-two">
          <label className="field">
            文献集
            <select
              value={form.collectionId}
              onChange={(e) => setForm({ ...form, collectionId: e.target.value })}
            >
              <option value="">未分类</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            阅读状态
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Paper['status'] })}
            >
              {Object.entries(statusLabels).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          标签 <span className="subtle-text">用逗号分隔</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="field">
          摘要 / 简介
          <textarea
            rows={4}
            value={form.abstract}
            onChange={(e) => setForm({ ...form, abstract: e.target.value })}
          />
        </label>
        <p className="field-hint">
          {paper.pageCount} 页 · {paper.sample ? '演示导读' : formatSize(paper.size)} ·{' '}
          {formatDate(paper.createdAt)} 导入
        </p>
        {form.excerpt && (
          <details>
            <summary>正文摘录（不是已核验摘要）</summary>
            <p className="field-hint">{form.excerpt}</p>
          </details>
        )}
        <label className="bilingual-option">
          <input
            type="checkbox"
            checked={form.metadataStatus === 'verified'}
            onChange={(e) =>
              setForm({ ...form, metadataStatus: e.target.checked ? 'verified' : 'unverified' })
            }
          />
          我已核对这些文献元数据
        </label>
        <div className="modal-actions">
          <button className="text-button danger-text" onClick={onDelete}>
            <Trash2 size={15} />
            删除文献
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={async () => {
              if (!form.title.trim()) {
                toast('文献标题不能为空', true)
                return
              }
              try {
                await db.papers.update(paper.id, {
                  doi: normalizeDoi(form.doi || ''),
                  metadataStatus: form.metadataStatus || 'unverified',
                  metadataSource: form.metadataSource,
                  title: form.title.trim(),
                  authors: form.authors,
                  year: form.year,
                  venue: form.venue,
                  abstract: form.abstract,
                  collectionId: form.collectionId,
                  status: form.status,
                  tags: [
                    ...new Set(
                      tags
                        .split(/[,，]/)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    ),
                  ],
                })
                onClose()
                toast('文献信息已更新')
              } catch (e) {
                toast(errorMessage(e), true)
              }
            }}
          >
            保存更改
          </button>
        </div>
      </div>
      {lookup && (
        <Modal title="DOI 信息预览" onClose={() => setLookup(null)}>
          <p>应用后会替换编辑表单中的标题、作者、年份和来源；点击「保存更改」才写入资料库。</p>
          <div className="preview-list">
            <h3>{lookup.title}</h3>
            <p>{lookup.authors}</p>
            <p>
              {lookup.year || '年份未知'} · {lookup.venue}
            </p>
            <p>{lookup.abstract || '服务未提供摘要，将保留现有摘要。'}</p>
          </div>
          <div className="modal-actions">
            <button className="button" onClick={() => setLookup(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                setForm({
                  ...form,
                  ...lookup,
                  abstract: lookup.abstract || form.abstract,
                  metadataStatus: 'unverified',
                  metadataSource: 'Crossref DOI 信息',
                })
                setLookup(null)
              }}
            >
              应用 DOI 信息
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
