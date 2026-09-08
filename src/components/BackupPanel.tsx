import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTauri } from '@tauri-apps/api/core'
import { db } from '../lib/db'
import { createBackup, restoreBackup, type RestorePreview } from '../lib/backup'
import {
  backupDefaults,
  backupSettings,
  saveBackupSettings,
  createSnapshot,
  snapshotBlob,
  deleteSnapshot,
  discoverSnapshots,
} from '../lib/snapshots'
import { pickNativeFiles, saveFile } from '../lib/platform'
import { formatSize, errorMessage } from '../lib/utils'
import { Modal, useToast } from './UI'
export function BackupPanel() {
  const [settings, setSettings] = useState(backupDefaults),
    [busy, setBusy] = useState(''),
    [preview, setPreview] = useState<{ blob: Blob; data: RestorePreview } | null>(null),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(''),
    toast = useToast()
  const snapshots = useLiveQuery(
      () => db.snapshots.orderBy('createdAt').reverse().toArray(),
      [],
      [],
    ),
    last = useLiveQuery(() => db.meta.get('lastBackupAt'))
  useEffect(() => {
    void backupSettings().then(setSettings)
    void discoverSnapshots().catch((e) => setError(errorMessage(e)))
  }, [])
  async function work(name: string, action: () => Promise<void>) {
    setBusy(name)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
      toast(errorMessage(e), true)
    } finally {
      setBusy('')
    }
  }
  async function inspect(blob?: Blob) {
    if (!blob) return
    await work('preview', async () => {
      const data = (await restoreBackup(blob, { preview: true })) as RestorePreview
      setPreview({ blob, data })
    })
  }
  return (
    <>
      <h3>备份与恢复</h3>
      <p className="muted">
        完整备份包含 PDF、文献元数据、笔记历史、图片、批注及 AI 结果，不包含 API 密钥。
      </p>
      {error && (
        <p className="job-error" role="alert">
          {error}
        </p>
      )}
      <p className="field-hint">
        最近备份：{last ? new Date(Number(last.value)).toLocaleString() : '尚无记录'}
      </p>
      <div className="data-action">
        <div>
          <h4>导出完整资料库</h4>
          <p>保存可迁移的 ZIP 文件。</p>
        </div>
        <button
          className="button"
          disabled={!!busy}
          onClick={() =>
            void work('export', async () => {
              if (
                await saveFile(
                  `Paperead-backup-${new Date().toISOString().slice(0, 10)}.zip`,
                  await createBackup(),
                )
              ) {
                await db.meta.put({ key: 'lastBackupAt', value: String(Date.now()) })
                toast('备份已导出')
              }
            })
          }
        >
          导出备份
        </button>
      </div>
      <div className="data-action">
        <div>
          <h4>从备份恢复</h4>
          <p>先查看覆盖清单，确认后保存恢复前快照再合并。</p>
        </div>
        <label
          className={`button ${busy ? 'disabled' : ''}`}
          onClick={(e) => {
            if (isTauri()) {
              e.preventDefault()
              void pickNativeFiles(['zip'], false)
                .then((f) => inspect(f?.[0]))
                .catch((e) => setError(errorMessage(e)))
            }
          }}
        >
          导入备份
          <input
            className="sr-only"
            aria-label="导入完整备份"
            type="file"
            accept=".zip"
            disabled={!!busy}
            onChange={(e) => {
              void inspect(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <div className="backup-policy">
        <label className="bilingual-option">
          <input
            type="checkbox"
            checked={settings.automatic}
            onChange={(e) => setSettings({ ...settings, automatic: e.target.checked })}
          />
          应用运行时自动备份
        </label>
        <div className="form-two">
          <label className="field">
            备份间隔（小时）
            <input
              type="number"
              min={1}
              max={168}
              value={settings.intervalHours}
              onChange={(e) => setSettings({ ...settings, intervalHours: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            每类快照保留份数
            <input
              type="number"
              min={1}
              max={20}
              value={settings.keep}
              onChange={(e) => setSettings({ ...settings, keep: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            备份提醒（天）
            <input
              type="number"
              min={1}
              max={90}
              value={settings.remindDays}
              onChange={(e) => setSettings({ ...settings, remindDays: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="field-hint">
          {isTauri()
            ? '自动快照保存在应用数据目录的 backups 文件夹，独立于 WebView 资料库。'
            : '浏览器快照仍在当前站点存储中，请另外导出 ZIP 保存。'}
          关闭软件期间不执行自动备份；有未保存草稿或 AI 任务时延后执行。
        </p>
        <button
          className="button"
          disabled={!!busy}
          onClick={() =>
            void work('settings', async () => {
              await saveBackupSettings(settings)
              setSettings(await backupSettings())
              toast('备份策略已保存')
            })
          }
        >
          保存备份策略
        </button>
      </div>
      <div className="data-action">
        <h4>本机快照</h4>
        <button
          className="button"
          disabled={!!busy}
          onClick={() =>
            void work('snapshot', async () => {
              await createSnapshot('manual')
              toast('本机快照已创建')
            })
          }
        >
          立即创建快照
        </button>
      </div>
      <div className="snapshot-list">
        {snapshots.map((s) => (
          <div className="snapshot-row" key={s.id}>
            <div>
              <b>{s.name}</b>
              <small>{formatSize(s.size)}</small>
            </div>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void work('read', async () => {
                  const blob = await snapshotBlob(s)
                  setPreview({
                    blob,
                    data: (await restoreBackup(blob, {
                      preview: true,
                    })) as RestorePreview,
                  })
                })
              }
            >
              预览恢复
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                void work('save', async () => {
                  await saveFile(`Paperead-snapshot-${s.createdAt}.zip`, await snapshotBlob(s))
                })
              }
            >
              导出快照
            </button>
            <button
              className="text-button danger-text"
              disabled={!!busy}
              onClick={() => setDeleting(s.id)}
            >
              删除快照
            </button>
          </div>
        ))}
      </div>
      {deleting && (
        <Modal title="删除备份快照" onClose={() => setDeleting('')}>
          <p>删除这份本机快照？当前资料库保持不变。</p>
          <button
            className="button danger"
            disabled={!!busy}
            onClick={() =>
              void work('delete', async () => {
                await deleteSnapshot(deleting)
                setDeleting('')
              })
            }
          >
            确认删除快照
          </button>
        </Modal>
      )}
      {preview && (
        <Modal
          title="恢复备份预览"
          wide
          onClose={() => {
            if (!busy) setPreview(null)
          }}
        >
          <p>
            备份时间：{new Date(preview.data.createdAt).toLocaleString()} · 格式{' '}
            {preview.data.version}
          </p>
          <p>
            {preview.data.papers.length} 篇文献，{preview.data.notes.length} 篇笔记，
            {preview.data.attachments} 张图片。
          </p>
          <p>
            相同 ID 的文献将替换其页面、批注和 AI
            结果；未出现在备份中的现有记录保留。恢复前快照创建成功后才开始写入。
          </p>
          <div className="preview-list">
            {[
              ...preview.data.papers.map((p) => ({ ...p, kind: '文献' })),
              ...preview.data.notes.map((n) => ({ ...n, kind: '笔记' })),
            ].map((row) => (
              <p key={`${row.kind}:${row.id}`}>
                <span className={row.overwrite ? 'danger-text' : 'green-text'}>
                  {row.overwrite ? '覆盖' : '新增'}
                </span>{' '}
                · {row.kind} · {row.title}
              </p>
            ))}
          </div>
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setPreview(null)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() =>
                void work('restore', async () => {
                  const count = await restoreBackup(preview.blob)
                  setPreview(null)
                  toast(`已恢复 ${count} 篇文献及关联资料`)
                })
              }
            >
              {busy === 'restore' ? '正在保护并恢复…' : '创建快照并确认恢复'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
