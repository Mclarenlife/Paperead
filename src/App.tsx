import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FilePenLine,
  FolderOpen,
  HardDrive,
  LibraryBig,
  Menu,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Star,
  Upload,
  X,
  Trash2,
} from 'lucide-react'
import { db, seedDatabase, recoverInterruptedJobs } from './lib/db'
import { acquireWorkspace } from './lib/workspace-lock'
import { NavigationGuard, useNavigationGuard } from './components/NavigationGuard'
import { defaultSettings } from './lib/ai'
import { errorMessage, uid } from './lib/utils'
import { pickNativePdfs } from './lib/platform'
import { Library } from './features/Library'
import {
  Modal,
  Spinner,
  ToastContext,
  Toasts,
  type ToastItem,
  type ToastAction,
} from './components/UI'
import type { AISettings } from './types'
import { BackupRuntime } from './components/BackupRuntime'

const Notes = lazy(() => import('./features/Notes').then((m) => ({ default: m.Notes })))
const Reader = lazy(() => import('./features/Reader').then((m) => ({ default: m.Reader })))
const JobCard = lazy(() => import('./features/Reader').then((m) => ({ default: m.JobCard })))
const Settings = lazy(() => import('./features/Settings').then((m) => ({ default: m.Settings })))
const Trash = lazy(() => import('./features/Trash').then((m) => ({ default: m.Trash })))

export default function App() {
  return (
    <NavigationGuard>
      <Workspace />
    </NavigationGuard>
  )
}
function Workspace() {
  const guard = useNavigationGuard()
  const [otherWindow, setOtherWindow] = useState(false)
  const [ready, setReady] = useState(false),
    [fatal, setFatal] = useState(''),
    [scope, setScope] = useState('library'),
    [search, setSearch] = useState('')
  const [readerId, setReaderId] = useState(''),
    [readerJobId, setReaderJobId] = useState(''),
    [noteId, setNoteId] = useState(''),
    [settingsOpen, setSettingsOpen] = useState(false),
    [collectionOpen, setCollectionOpen] = useState(false)
  const [collectionName, setCollectionName] = useState(''),
    [theme, setTheme] = useState('light'),
    [config, setConfig] = useState<AISettings>(defaultSettings),
    [mobileNav, setMobileNav] = useState(false)
  const [importing, setImporting] = useState(''),
    [dragging, setDragging] = useState(false),
    [helpOpen, setHelpOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const fileInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    importLock = useRef(false),
    dragDepth = useRef(0)
  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deletedAt).toArray(), [], []),
    collections = useLiveQuery(() => db.collections.toArray(), [], []),
    allJobs = useLiveQuery(() => db.jobs.toArray(), [], [])
  const jobs = allJobs.filter((job) => papers.some((paper) => paper.id === job.paperId))
  const toast = useCallback((message: string, error = false, action?: ToastAction) => {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items.slice(-3), { id, message, error, action }])
    setTimeout(() => setToasts((items) => items.filter((i) => i.id !== id)), action ? 10000 : 5000)
  }, [])
  useEffect(() => {
    void (async () => {
      try {
        if (!(await acquireWorkspace())) {
          setOtherWindow(true)
          return
        }
        await seedDatabase()
        await recoverInterruptedJobs()
        const settings = await db.meta.get('ai'),
          appearance = await db.meta.get('theme')
        if (settings) {
          const parsed = JSON.parse(settings.value)
          if (['compatible', 'openai', 'anthropic', 'gemini'].includes(parsed.provider))
            setConfig({ ...defaultSettings, ...parsed })
        }
        if (appearance) setTheme(appearance.value)
        setReady(true)
      } catch (e) {
        setFatal(errorMessage(e))
      }
    })()
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])
  function handleFiles(files: File[]) {
    guard.navigate(() => void importFiles(files).catch((e) => toast(errorMessage(e), true)))
  }
  async function importFiles(files: File[]) {
    if (importLock.current) return
    importLock.current = true
    let count = 0
    try {
      const { importPdf } = await import('./lib/pdf')
      for (const file of files) {
        setImporting(`准备导入 ${file.name}`)
        try {
          await importPdf(
            file,
            scope.startsWith('collection:') ? scope.slice(11) : '',
            setImporting,
          )
          count++
        } catch (e) {
          toast(`${file.name}：${errorMessage(e)}`, true)
        }
      }
      if (count) {
        toast(`已导入 ${count} 篇文献`)
        setScope(scope.startsWith('collection:') ? scope : 'library')
        setSearch('')
        void navigator.storage?.persist?.()
      }
    } finally {
      setImporting('')
      importLock.current = false
    }
  }
  async function chooseFiles() {
    try {
      const native = await pickNativePdfs()
      if (native) await handleFiles(native)
      else fileInput.current?.click()
    } catch (e) {
      toast(errorMessage(e), true)
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        guard.navigate(() => {
          setReaderId('')
          if (scope === 'notes' || scope === 'ai' || scope === 'trash') setScope('library')
          searchInput.current?.focus()
        })
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void chooseFiles()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })
  const navigate = (next: string) => {
    guard.navigate(() => {
      setScope(next)
      setSearch('')
      setMobileNav(false)
    })
  }
  const saveConfig = async (value: AISettings) => {
    await db.meta.put({ key: 'ai', value: JSON.stringify(value) })
    setConfig(value)
  }
  const closeReader = useCallback(() => {
    setReaderId('')
    setReaderJobId('')
  }, [])
  const openPaper = (id: string) => {
    if (!papers.some((paper) => paper.id === id)) {
      toast('文献在回收站中，请先恢复。')
      return
    }
    guard.navigate(() => {
      setReaderJobId('')
      setReaderId(id)
    })
  }
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const closeCollection = useCallback(() => setCollectionOpen(false), [])
  if (otherWindow)
    return (
      <div className="boot-error">
        <h1>资料库已在另一窗口打开</h1>
        <p>请继续使用原窗口；关闭原窗口后，可以在这里重新打开。</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新打开
        </button>
      </div>
    )
  if (fatal)
    return (
      <div className="boot-error">
        <h1>无法打开本地资料库</h1>
        <p>{fatal}</p>
        <p>请确认浏览器允许本地存储，再刷新重试。</p>
      </div>
    )
  if (!ready)
    return (
      <div className="boot">
        <span className="boot-logo">p.</span>
        <Spinner text="准备你的阅读空间…" />
      </div>
    )
  return (
    <MotionConfig reducedMotion="user">
      <ToastContext.Provider value={toast}>
        <BackupRuntime notify={toast} />
        <Suspense
          fallback={
            <div className="boot">
              <Spinner />
            </div>
          }
        >
          <div
            className="app"
            onDragEnter={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              dragDepth.current++
              setDragging(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              dragDepth.current--
              if (dragDepth.current <= 0) setDragging(false)
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              dragDepth.current = 0
              setDragging(false)
              void handleFiles(Array.from(e.dataTransfer.files))
            }}
          >
            {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />}
            <aside inert={!!readerId} className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
              <button
                className="brand"
                onClick={() => navigate('library')}
                aria-label="Paperead 首页"
              >
                <span className="brand-icon">
                  <BookOpen size={21} />
                </span>
                <span>
                  paperead<span className="brand-dot">.</span>
                </span>
              </button>
              <div className="workspace-label">
                <span className="workspace-avatar">P</span>
                <span>
                  我的研究空间<small>个人工作区</small>
                </span>
                <ChevronDown size={14} />
              </div>
              <div className="sidebar-section-label">
                工作台 <span>WORKSPACE</span>
              </div>
              <nav className="main-navigation">
                {[
                  ['library', '全部文献', LibraryBig, papers.length],
                  ['recent', '最近阅读', Clock3, null],
                  ['favorites', '我的收藏', Star, papers.filter((p) => p.starred).length],
                  ['notes', '我的笔记', FilePenLine, null],
                  ['trash', '回收站', Trash2, null],
                ].map(([k, t, I, count]) => {
                  const Icon = I as typeof BookOpen
                  return (
                    <button
                      key={k as string}
                      className={scope === k ? 'active' : ''}
                      onClick={() => navigate(k as string)}
                    >
                      <Icon size={18} />
                      <span>{t as string}</span>
                      {count !== null && <small>{count as number}</small>}
                    </button>
                  )
                })}
              </nav>
              <div className="sidebar-section-label collection-label">
                文献集
                <button
                  className="icon-button"
                  onClick={() => setCollectionOpen(true)}
                  aria-label="新建文献集"
                >
                  <Plus size={15} />
                </button>
              </div>
              <nav className="collection-navigation">
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={scope === `collection:${c.id}` ? 'active' : ''}
                    onClick={() => navigate(`collection:${c.id}`)}
                  >
                    <FolderOpen size={17} style={{ color: c.color }} />
                    <span>{c.name}</span>
                    <small>{papers.filter((p) => p.collectionId === c.id).length}</small>
                  </button>
                ))}
                <button className="new-collection" onClick={() => setCollectionOpen(true)}>
                  <Plus size={16} />
                  <span>新建文献集</span>
                </button>
              </nav>
              <div className="sidebar-bottom">
                <button
                  className={`ai-promo ${scope === 'ai' ? 'selected' : ''}`}
                  onClick={() => navigate('ai')}
                >
                  <span className="ai-promo-title">
                    <Sparkles size={17} />
                    <b>为阅读，加一点 AI</b>
                    <span className="mini-badge">AI</span>
                  </span>
                  <p>翻译、重排，跨越理解的边界。</p>
                  <span className="ai-promo-link">
                    探索 AI 工作台 <ArrowRight size={14} />
                  </span>
                </button>
                <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
                  <Settings2 size={17} />
                  <span>偏好设置</span>
                  <span className="shortcut">⌘ ,</span>
                </button>
                <div className="local-status">
                  <span className="online-dot" />
                  本地优先，安心阅读
                  <button
                    className="icon-button"
                    aria-label="使用帮助"
                    onClick={() => setHelpOpen(true)}
                  >
                    <CircleHelp size={15} />
                  </button>
                </div>
              </div>
            </aside>
            <div inert={!!readerId} className="main-shell">
              <header className="topbar">
                <div className="breadcrumb">
                  <button
                    className="icon-button mobile-only"
                    aria-label="打开导航"
                    onClick={() => setMobileNav(true)}
                  >
                    <Menu size={20} />
                  </button>
                  <span>我的工作台</span>
                  <ChevronRight size={12} />
                  <b>{scope === 'notes' ? '阅读笔记' : scope === 'ai' ? 'AI 工作台' : '文献库'}</b>
                </div>
                <div className="topbar-right">
                  <label className="global-search">
                    <Search size={16} />
                    <input
                      ref={searchInput}
                      value={search}
                      onChange={(e) => {
                        const value = e.target.value
                        guard.navigate(() => {
                          setSearch(value)
                          if (scope === 'notes' || scope === 'ai' || scope === 'trash')
                            setScope('library')
                        })
                      }}
                      placeholder="搜索文献、作者、关键词…"
                      aria-label="搜索文献"
                    />
                    {search ? (
                      <button
                        className="icon-button"
                        onClick={() => setSearch('')}
                        aria-label="清除搜索"
                      >
                        <X size={13} />
                      </button>
                    ) : (
                      <kbd>⌘ K</kbd>
                    )}
                  </label>
                  <span className="header-divider" />
                  <button
                    className="user-avatar"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="工作区设置"
                  >
                    P<span />
                  </button>
                </div>
              </header>
              <main className={scope === 'notes' ? 'main-content notes-main' : 'main-content'}>
                {scope === 'notes' ? (
                  <Notes key={noteId} initialId={noteId} onOpenPaper={openPaper} />
                ) : scope === 'trash' ? (
                  <Trash />
                ) : scope === 'ai' ? (
                  <motion.div className="ai-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="eyebrow">A NEW WAY TO UNDERSTAND</div>
                    <h1>让理解，多一种可能。</h1>
                    <p className="page-description">
                      翻译语言，梳理结构，把注意力留给真正重要的想法。
                    </p>
                    <div className="ai-workspace-banner">
                      <Sparkles size={36} />
                      <div>
                        <h2>
                          {config.model ? `已配置 ${config.model}` : '连接模型，开启 AI 阅读'}
                        </h2>
                        <p>支持 OpenAI、Claude、Gemini 与自定义兼容 API。</p>
                      </div>
                      <button className="button primary" onClick={() => setSettingsOpen(true)}>
                        配置 AI 服务 <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="section-heading">
                      <h2>
                        处理任务 <span className="count-badge">{jobs.length}</span>
                      </h2>
                      <button className="text-button" onClick={() => navigate('library')}>
                        选择文献 <ArrowRight size={14} />
                      </button>
                    </div>
                    {jobs.length ? (
                      <div className="job-grid">
                        {[...jobs]
                          .sort((a, b) => b.updatedAt - a.updatedAt)
                          .map((job) => (
                            <div key={job.id}>
                              <h4>{papers.find((p) => p.id === job.paperId)?.title}</h4>
                              <JobCard
                                job={job}
                                config={config}
                                onRestart={(next) => {
                                  setReaderJobId(next.id)
                                  setReaderId(job.paperId)
                                }}
                                onView={() => {
                                  setReaderJobId(job.id)
                                  setReaderId(job.paperId)
                                }}
                              />
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <Sparkles size={32} />
                        <h3>新的理解，从一篇论文开始</h3>
                        <p>在文献阅读器中打开 AI 助手，开始翻译或重排。</p>
                        <button className="button" onClick={() => navigate('library')}>
                          前往文献库
                        </button>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <Library
                    papers={papers}
                    collections={collections}
                    scope={scope}
                    search={search}
                    onOpen={openPaper}
                    onImport={() => void chooseFiles()}
                    onScope={navigate}
                    onCreateCollection={() => setCollectionOpen(true)}
                    onClearSearch={() => setSearch('')}
                  />
                )}
              </main>
            </div>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              aria-label="选择 PDF 文献"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                void handleFiles(files)
              }}
            />
            <AnimatePresence>
              {readerId && (
                <Reader
                  key={readerId}
                  id={readerId}
                  initialJobId={readerJobId}
                  config={config}
                  onClose={closeReader}
                  onSettings={() => setSettingsOpen(true)}
                  onNote={(id) => {
                    setNoteId(id)
                    setReaderId('')
                    setScope('notes')
                  }}
                />
              )}{' '}
              {settingsOpen && (
                <Settings
                  config={config}
                  onSave={saveConfig}
                  onClose={closeSettings}
                  theme={theme}
                  onTheme={(value) => {
                    setTheme(value)
                    void db.meta
                      .put({ key: 'theme', value })
                      .catch((e) => toast(errorMessage(e), true))
                  }}
                />
              )}{' '}
              {collectionOpen && (
                <Modal title="新建文献集" onClose={closeCollection}>
                  <p className="muted">把同一研究方向的文献放在一起。</p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault()
                      const name = collectionName.trim()
                      if (!name) return
                      if (collections.some((c) => c.name === name)) {
                        toast('已存在同名文献集', true)
                        return
                      }
                      try {
                        const id = uid()
                        await db.collections.add({
                          id,
                          name,
                          color: ['#63816d', '#9b8ab8', '#cf9b64'][collections.length % 3],
                        })
                        setCollectionName('')
                        setCollectionOpen(false)
                        navigate(`collection:${id}`)
                        toast('文献集已创建')
                      } catch (error) {
                        toast(errorMessage(error), true)
                      }
                    }}
                  >
                    <label className="field">
                      名称
                      <input
                        value={collectionName}
                        maxLength={80}
                        placeholder="例如：多模态学习"
                        onChange={(e) => setCollectionName(e.target.value)}
                      />
                    </label>
                    <div className="modal-actions">
                      <button className="button" type="button" onClick={closeCollection}>
                        取消
                      </button>
                      <button className="button primary" disabled={!collectionName.trim()}>
                        创建文献集
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
              {helpOpen && (
                <Modal title="欢迎来到 Paperead" onClose={() => setHelpOpen(false)}>
                  <div className="help-steps">
                    <p>
                      <b>01 · 建立文献库</b>
                      <br />
                      点击导入或拖入 PDF，在阅读器中编辑资料、标签与所属文献集。
                    </p>
                    <p>
                      <b>02 · 读懂并留下思考</b>
                      <br />
                      选中文字添加高亮批注。连接你自己的 AI API 后，可生成全文译文和重排文档。
                    </p>
                    <p>
                      <b>03 · 让知识连接起来</b>
                      <br />
                      批注可以收集到 Markdown 笔记；笔记、译文和重排内容都能导出。
                    </p>
                    <p>
                      <b>04 · 带走你的资料</b>
                      <br />
                      在偏好设置中导出 ZIP 完整备份，在其他设备导入恢复。
                    </p>
                    <div className="privacy-note">
                      <HardDrive size={18} />
                      <p>
                        示例卡片只含原创导读。导入真实 PDF 后，即可使用完整的 PDF 阅读与批注功能。
                      </p>
                    </div>
                  </div>
                </Modal>
              )}
              {dragging && (
                <motion.div
                  className="drop-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div>
                    <Upload size={40} />
                    <h2>把新的发现，放进这里</h2>
                    <p>松开即可导入 PDF 文献 · 支持多文件</p>
                  </div>
                </motion.div>
              )}
              {importing && (
                <motion.div
                  className="import-progress"
                  initial={{ y: 30, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Spinner text={importing} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Toasts items={toasts} />
        </Suspense>
      </ToastContext.Provider>
    </MotionConfig>
  )
}
