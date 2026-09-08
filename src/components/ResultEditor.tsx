import { useEffect, useRef, useState } from 'react'
import { Modal, useToast } from './UI'
import { Markdown } from './Markdown'
import { useNavigationGuard } from './NavigationGuard'
import { jobMarkdown } from '../lib/ai'
import {
  clearResultDraft,
  getResultDraft,
  resultName,
  reviseResult,
  setResultDraft,
} from '../lib/results'
import { exportDocument } from '../lib/export'
import { errorMessage } from '../lib/utils'
import type { Job } from '../types'

export function ResultEditor({
  job,
  onClose,
  onSaved,
}: {
  job: Job
  onClose: () => void
  onSaved: (job: Job) => void
}) {
  const [restored] = useState(() => getResultDraft(job.id))
  const [name, setName] = useState(restored?.name ?? `${resultName(job).slice(0, 180)} · 校对`)
  const [markdown, setMarkdown] = useState(restored?.markdown ?? jobMarkdown(job))
  const [dirty, setDirty] = useState(!!restored),
    [durable, setDurable] = useState(restored?.durable ?? true)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [leave, setLeave] = useState<(() => void) | null>(null)
  const state = useRef({ dirty })
  state.current = { dirty }
  const guard = useNavigationGuard(),
    toast = useToast()
  useEffect(
    () =>
      guard.watchEditor(
        () => state.current.dirty,
        (action) => setLeave(() => action),
      ),
    [guard.watchEditor],
  )
  function change(n: string, md: string) {
    setName(n)
    setMarkdown(md)
    setDirty(true)
    setDurable(setResultDraft(job.id, { name: n, markdown: md }))
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      const revision = await reviseResult(job.id, name, markdown)
      clearResultDraft(job.id)
      state.current.dirty = false
      setDirty(false)
      toast('校对已保存为新版本，原结果与批注保留')
      onSaved(revision)
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  const askClose = () => {
    if (busy) return
    if (dirty) setLeave(() => onClose)
    else onClose()
  }
  const exportDraft = () =>
    exportDocument(name, markdown, 'md').catch((e) => setError(errorMessage(e)))
  return (
    <>
      <Modal title="校对 AI 结果" wide onClose={askClose}>
        <p className="field-hint">
          保存会创建独立修订版本，原版本上的批注保持原位置。{restored && '已恢复上次校对草稿。'}
        </p>
        <label className="field">
          修订版本名称
          <input
            value={name}
            maxLength={200}
            disabled={busy}
            onChange={(e) => change(e.target.value, markdown)}
          />
        </label>
        {error && (
          <p role="alert" className="job-error">
            保存失败：{error}，草稿已保留。
          </p>
        )}
        <div className="result-editor-panes">
          <textarea
            aria-label="校对 Markdown 正文"
            value={markdown}
            disabled={busy}
            onChange={(e) => change(name, e.target.value)}
            spellCheck={false}
          />
          <div className="result-preview">
            <Markdown text={markdown} />
          </div>
        </div>
        <p className="field-hint">
          {dirty
            ? durable
              ? '草稿已另存本机，尚未保存为正式结果。'
              : '草稿缓存不可用，请保存或导出后关闭。'
            : 'Markdown 编辑与预览'}
        </p>
        <div className="modal-actions">
          <button className="button" disabled={busy} onClick={() => void exportDraft()}>
            导出校对草稿
          </button>
          <button className="button" disabled={busy} onClick={askClose}>
            关闭校对
          </button>
          <button
            className="button primary"
            disabled={busy || !markdown.trim()}
            onClick={() => void save()}
          >
            保存为新版本
          </button>
        </div>
      </Modal>
      {leave && (
        <Modal
          title="校对草稿尚未保存"
          onClose={() => {
            if (!busy) setLeave(null)
          }}
        >
          <p>
            {durable
              ? '校对草稿已缓存在本机，可保存为新版本或下次继续。'
              : '草稿仅在内存中，请先保存或导出。'}
          </p>
          {error && (
            <p role="alert" className="job-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => void exportDraft()}>
              导出草稿
            </button>
            <button className="button" disabled={busy} onClick={() => setLeave(null)}>
              返回校对
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                const action = leave
                if (await save()) action()
              }}
            >
              保存并继续
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const action = leave
                state.current.dirty = false
                setLeave(null)
                action()
              }}
            >
              保留草稿并离开
            </button>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                clearResultDraft(job.id)
                state.current.dirty = false
                const action = leave
                setLeave(null)
                action()
              }}
            >
              放弃草稿并离开
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
