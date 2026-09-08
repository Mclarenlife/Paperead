import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal, useToast } from './UI'
import { db } from '../lib/db'
import { clearResultDraft, deleteResult, renameResult, resultName } from '../lib/results'
import { errorMessage } from '../lib/utils'
import type { Job } from '../types'

export function ResultActions({ job, onEdit }: { job: Job; onEdit?: () => void }) {
  const [mode, setMode] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false)
  const count = useLiveQuery(
    () => db.annotations.filter((a) => a.jobId === job.id).count(),
    [job.id],
    0,
  )
  const toast = useToast()
  return (
    <>
      <div className="result-actions">
        {onEdit && (
          <button className="text-button" disabled={job.status !== 'completed'} onClick={onEdit}>
            校对
          </button>
        )}
        <button
          className="text-button"
          onClick={() => {
            setName(resultName(job))
            setMode('rename')
          }}
        >
          命名版本
        </button>
        <button
          className="text-button danger-text"
          disabled={job.status === 'running'}
          onClick={() => setMode('delete')}
        >
          删除版本
        </button>
      </div>
      {mode && (
        <Modal
          title={mode === 'rename' ? '命名结果版本' : '删除结果版本'}
          onClose={() => {
            if (!busy) setMode('')
          }}
        >
          {mode === 'rename' ? (
            <label className="field">
              版本名称
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
          ) : (
            <p>
              彻底删除「{resultName(job)}」？此版本的 {count}{' '}
              条批注、书签和校对草稿将一起删除，其他版本与独立笔记保留。已由此版本创建的重排任务继续使用各自保存的输入。此操作无法撤销。
            </p>
          )}
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setMode('')}>
              取消
            </button>
            <button
              className={`button ${mode === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy || (mode === 'rename' && !name.trim())}
              onClick={async () => {
                setBusy(true)
                try {
                  if (mode === 'rename') await renameResult(job.id, name)
                  else {
                    await deleteResult(job.id)
                    clearResultDraft(job.id)
                  }
                  setMode('')
                  toast(mode === 'rename' ? '版本已命名' : '版本已删除')
                } catch (e) {
                  toast(errorMessage(e), true)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {mode === 'rename' ? '保存版本名称' : '确认删除版本'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
