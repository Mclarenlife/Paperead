import { useState } from 'react'
import { Modal, useToast } from './UI'
import {
  bibliography,
  parseReferences,
  importReferences,
  type ReferenceMetadata,
} from '../lib/metadata'
import { pickNativeFiles, saveFile } from '../lib/platform'
import { isTauri } from '@tauri-apps/api/core'
import { errorMessage } from '../lib/utils'
import type { Paper } from '../types'
export function BibliographyTools({ papers }: { papers: Paper[] }) {
  const [open, setOpen] = useState(false),
    [entries, setEntries] = useState<ReferenceMetadata[]>([]),
    [busy, setBusy] = useState(false),
    toast = useToast()
  async function parse(file?: File) {
    if (!file) return
    setBusy(true)
    try {
      setEntries(await parseReferences(await file.text()))
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className="button small" onClick={() => setOpen(true)}>
        引用导入 / 导出
      </button>
      {open && (
        <Modal
          title="文献引用数据"
          onClose={() => {
            if (!busy) setOpen(false)
          }}
        >
          <p className="muted">
            BibTeX / RIS 保存文献元数据。导入后可在文献信息中附加 PDF，相同 DOI 的记录会跳过。
          </p>
          <label
            className="button"
            onClick={(e) => {
              if (isTauri()) {
                e.preventDefault()
                void pickNativeFiles(['bib', 'ris'], false)
                  .then((f) => parse(f?.[0]))
                  .catch((e) => toast(errorMessage(e), true))
              }
            }}
          >
            选择 BibTeX / RIS
            <input
              className="sr-only"
              aria-label="导入引用文件"
              type="file"
              accept=".bib,.ris"
              disabled={busy}
              onChange={(e) => {
                void parse(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {!!entries.length && (
            <>
              <p>将导入 {entries.length} 条记录：</p>
              <div className="preview-list">
                {entries.slice(0, 100).map((m, i) => (
                  <p key={i}>
                    <b>{m.title}</b>
                    <br />
                    <small>
                      {m.year || '年份未知'} · {m.doi || '无 DOI'}
                    </small>
                  </p>
                ))}
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = await importReferences(entries)
                    toast(`已导入 ${result.added} 条，跳过重复 DOI ${result.skipped} 条`)
                    setEntries([])
                    setOpen(false)
                  } catch (e) {
                    toast(errorMessage(e), true)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                确认导入引用
              </button>
            </>
          )}
          <div className="modal-actions">
            {(['bibtex', 'ris'] as const).map((format) => (
              <button
                className="button"
                key={format}
                disabled={busy || !papers.length}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await saveFile(
                      `Paperead-${papers.length}-references.${format === 'bibtex' ? 'bib' : 'ris'}`,
                      new Blob([await bibliography(papers, format)], {
                        type: 'text/plain;charset=utf-8',
                      }),
                    )
                  } catch (e) {
                    toast(errorMessage(e), true)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                导出 {papers.length} 条 {format.toUpperCase()}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
