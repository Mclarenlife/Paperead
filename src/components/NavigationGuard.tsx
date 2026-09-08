import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Modal } from './UI'
import { allDrafts, getDraft, saveDraft } from '../lib/note-drafts'
import { saveFile } from '../lib/platform'

const NavigationContext = createContext({
  navigate: (action: () => void) => action(),
  watchNote: (_id: string) => () => {},
  watchEditor: (_dirty: () => boolean, _leave: (action: () => void) => void) => () => {},
})
export const useNavigationGuard = () => useContext(NavigationContext)
export function NavigationGuard({ children }: { children: ReactNode }) {
  const active = useRef(''),
    permitClose = useRef(false)
  const editor = useRef<{ dirty: () => boolean; leave: (action: () => void) => void } | null>(null)
  const watchEditor = useCallback((dirty: () => boolean, leave: (action: () => void) => void) => {
    const entry = { dirty, leave }
    editor.current = entry
    return () => {
      if (editor.current === entry) editor.current = null
    }
  }, [])
  const [pending, setPending] = useState<{
    action: () => void
    closing?: boolean
    ids: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const watchNote = useCallback((id: string) => {
    active.current = id
    return () => {
      if (active.current === id) active.current = ''
    }
  }, [])
  const navigate = useCallback((action: () => void) => {
    if (editor.current?.dirty()) {
      editor.current.leave(action)
      return
    }
    const id = active.current
    const proceed = () => {
      if (id && getDraft(id)) {
        setError('')
        setPending({ action, ids: [id] })
      } else action()
    }
    if (id && getDraft(id)?.status === 'saving') void saveDraft(id).then(proceed)
    else proceed()
  }, [])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!permitClose.current && (allDrafts().length || editor.current?.dirty())) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    let disposed = false,
      unlisten: (() => void) | undefined
    if (isTauri())
      void import('@tauri-apps/api/window')
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow()
          const off = await win.onCloseRequested((event) => {
            if (!permitClose.current && editor.current?.dirty()) {
              event.preventDefault()
              editor.current.leave(() => {
                permitClose.current = true
                void win.close()
              })
              return
            }
            if (permitClose.current || !allDrafts().length) return
            event.preventDefault()
            setError('')
            setPending({
              closing: true,
              ids: allDrafts().map((draft) => draft.id),
              action: () => {
                permitClose.current = true
                void win.close()
              },
            })
          })
          if (disposed) off()
          else unlisten = off
        })
        .catch(() => {
          /* Browser beforeunload remains an additional safeguard. */
        })
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])
  return (
    <NavigationContext.Provider value={{ navigate, watchNote, watchEditor }}>
      {children}
      {pending && (
        <Modal
          title="笔记尚未保存"
          onClose={() => {
            if (!busy) setPending(null)
          }}
        >
          <p>有笔记尚未写入资料库。你可以重试保存，或先导出草稿。</p>
          <p className="field-hint">
            {pending.ids.some((id) => getDraft(id) && !getDraft(id)!.durable)
              ? '本机草稿存储也不可用，草稿暂存内存；关闭程序前请先导出。'
              : '草稿已另存本机，重新打开此笔记可以恢复；正式保存前仍建议导出备份。'}
          </p>
          {error && <p className="job-error">{error}</p>}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  for (const id of pending.ids) {
                    const draft = getDraft(id)
                    if (
                      draft &&
                      !(await saveFile(
                        `${draft.title || '未命名笔记'}-草稿.md`,
                        new Blob([draft.markdown], { type: 'text/markdown' }),
                      ))
                    )
                      break
                  }
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              导出草稿
            </button>
            <button className="button" disabled={busy} onClick={() => setPending(null)}>
              返回编辑
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await Promise.all(pending.ids.map(saveDraft))
                setBusy(false)
                if (pending.ids.some((id) => getDraft(id)))
                  setError('保存仍然失败，请导出草稿或返回编辑。')
                else {
                  const action = pending.action
                  setPending(null)
                  action()
                }
              }}
            >
              重试保存并继续
            </button>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                const action = pending.action
                setPending(null)
                action()
              }}
            >
              {pending.closing ? '仍然关闭' : '保留草稿并离开'}
            </button>
          </div>
        </Modal>
      )}
    </NavigationContext.Provider>
  )
}
