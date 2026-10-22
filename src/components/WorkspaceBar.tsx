import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  FileText,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Minus,
  Square,
  Copy,
  X,
} from 'lucide-react'

export function WorkspaceBar({
  collapsed,
  navigationOpen,
  onToggle,
  tabs,
  active,
  workspace,
  onWorkspace,
  onSelect,
  onClose,
  onError,
}: {
  collapsed: boolean
  navigationOpen: boolean
  onToggle: () => void
  tabs: { id: string; title: string }[]
  active: string
  workspace: string
  onWorkspace: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onError: (message: string) => void
}) {
  const native = isTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent)
  const mac = native && /Mac/i.test(navigator.platform)
  const [maximized, setMaximized] = useState(false)
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 780px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)')
    const update = () => setCompact(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const sidebarOpen = compact ? navigationOpen : !collapsed
  useEffect(() => {
    if (!native) return
    let disposed = false
    let off: (() => void) | undefined
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const update = async () => {
          const value = await win.isMaximized()
          if (!disposed) setMaximized(value)
        }
        await update()
        const unlisten = await win.onResized(() => void update().catch(() => {}))
        if (disposed) unlisten()
        else off = unlisten
      })
      .catch(() => {})
    return () => {
      disposed = true
      off?.()
    }
  }, [native])
  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close' | 'startDragging') {
    if (!native) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow()[action]()
    } catch {
      onError('窗口操作失败，请重试。')
    }
  }
  return (
    <header className={`workspace-bar ${mac ? 'mac-titlebar' : ''}`}>
      <button
        className="icon-button sidebar-toggle"
        title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        aria-expanded={sidebarOpen}
        onClick={onToggle}
      >
        {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>
      <div
        className="workspace-tabs"
        role="tablist"
        aria-label="工作区标签页"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          )
          const index = controls.indexOf(document.activeElement as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? controls.length - 1
                : (index + (event.key === 'ArrowLeft' ? -1 : 1) + controls.length) % controls.length
          controls[next]?.focus()
          controls[next]?.click()
        }}
      >
        <button
          className={`workspace-tab ${!active ? 'active' : ''}`}
          role="tab"
          aria-selected={!active}
          onClick={onWorkspace}
        >
          <LibraryBig size={15} />
          <span>{workspace}</span>
        </button>
        {tabs.map((tab) => (
          <div className={`document-tab ${active === tab.id ? 'active' : ''}`} key={tab.id}>
            <button
              className="workspace-tab"
              role="tab"
              aria-selected={active === tab.id}
              title={tab.title}
              onClick={() => onSelect(tab.id)}
            >
              <FileText size={14} />
              <span>{tab.title}</span>
            </button>
            <button
              className="tab-close"
              aria-label={`关闭标签页：${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="window-drag-region" data-tauri-drag-region>
        <span data-tauri-drag-region>Paperead</span>
      </div>
      {native && !mac && (
        <div className="window-controls">
          <button aria-label="最小化窗口" onClick={() => void windowAction('minimize')}>
            <Minus size={15} />
          </button>
          <button
            aria-label={maximized ? '还原窗口' : '最大化窗口'}
            onClick={() => void windowAction('toggleMaximize')}
          >
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            className="window-close"
            aria-label="关闭窗口"
            onClick={() => void windowAction('close')}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </header>
  )
}
