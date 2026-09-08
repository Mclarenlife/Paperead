import { PaperEditor } from '../components/PaperEditor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RecognitionPanel } from '../components/RecognitionPanel'
import { useLiveQuery } from 'dexie-react-hooks'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePenLine,
  Highlighter,
  Languages,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
  Search,
  ListTree,
} from 'lucide-react'
import { db } from '../lib/db'
import { moveToTrash, restoreFromTrash } from '../lib/trash'
import { getDocument } from '../lib/pdf'
import { cancelJob, createJob, jobMarkdown, runJob, sameService } from '../lib/ai'
import { useJobProgress } from '../lib/ai-progress'
import { documentPreview, bilingualMarkdown } from '../lib/document'
import { exportDocument, exportName, printDocument, type ExportFormat } from '../lib/export'
import { saveFile } from '../lib/platform'
import { isTauri } from '@tauri-apps/api/core'
import { errorMessage, formatDate, formatSize, uid } from '../lib/utils'
import { Markdown } from '../components/Markdown'
import { Modal, Spinner, useToast } from '../components/UI'
import {
  ReaderNavigation,
  type OutlineEntry,
  type SearchTarget,
} from '../components/ReaderNavigation'
import { ResultEditor } from '../components/ResultEditor'
import { ResultActions } from '../components/ResultActions'
import { resultName } from '../lib/results'
import { annotationsMarkdown, editAnnotation } from '../lib/annotations'
import { findMatches, locateRange } from '../lib/reading'
import { useReadingPosition } from '../lib/use-reading-position'
import {
  statusLabels,
  type AISettings,
  type Annotation,
  type Job,
  type Paper,
  type Rect,
  type Source,
  type ReadingLocation,
} from '../types'

type SelectionInfo = { quote: string; rects: Rect[]; start: number; end: number }

export function Reader({
  id,
  config,
  onClose: onExit,
  onSettings,
  onNote,
  initialJobId,
}: {
  id: string
  config: AISettings
  onClose: () => void
  onSettings: () => void
  onNote: (id: string) => void
  initialJobId?: string
}) {
  const paper = useLiveQuery(() => db.papers.get(id), [id])
  const pages = useLiveQuery(() => db.pages.where('paperId').equals(id).sortBy('number'), [id], [])
  const annotations = useLiveQuery(
    () =>
      db.annotations
        .where('paperId')
        .equals(id)
        .filter((annotation) => !annotation.deletedAt)
        .toArray(),
    [id],
    [],
  )
  const jobs = useLiveQuery(
    () => db.jobs.where('paperId').equals(id).reverse().sortBy('updatedAt'),
    [id],
    [],
  )
  const [page, setPage] = useState(1),
    [source, setSource] = useState<Source>('original'),
    [side, setSide] = useState('annotations'),
    [zoom, setZoom] = useState(1)
  const [selection, setSelection] = useState<SelectionInfo | null>(null),
    [comment, setComment] = useState(''),
    [color, setColor] = useState('yellow')
  const [resultVersions, setResultVersions] = useState<Record<string, string>>({})
  const [exportOpen, setExportOpen] = useState(false),
    [editOpen, setEditOpen] = useState(false),
    [removeOpen, setRemoveOpen] = useState(false),
    [aiBusy, setAiBusy] = useState(false)
  const [bilingual, setBilingual] = useState(config.bilingual === true)
  const [recognitionOpen, setRecognitionOpen] = useState(false)
  const [reflowInput, setReflowInput] = useState('')
  const [findTrigger, setFindTrigger] = useState(0)
  const [editingResult, setEditingResult] = useState<Job | null>(null)
  const [annotationQuery, setAnnotationQuery] = useState(''),
    [annotationFilter, setAnnotationFilter] = useState('all')
  const [annotationEdit, setAnnotationEdit] = useState<Annotation | null>(null),
    [annotationBusy, setAnnotationBusy] = useState(false)
  const [pdfOutline, setPdfOutline] = useState<OutlineEntry[]>([]),
    [pdfReadyPage, setPdfReadyPage] = useState(0),
    [renderEpoch, setRenderEpoch] = useState(0)
  const [renderedText, setRenderedText] = useState(''),
    [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null)
  const [jumpTarget, setJumpTarget] = useState<(ReadingLocation & { token: number }) | undefined>(
    undefined,
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const onPdfReady = useCallback((page: number) => {
    setPdfReadyPage(page)
    setRenderEpoch((n) => n + 1)
  }, [])
  const onOutline = useCallback((outline: OutlineEntry[]) => setPdfOutline(outline), [])
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null)
  useEffect(() => {
    if (paper?.deletedAt) onExit()
  }, [paper?.deletedAt, onExit])
  const [showSide, setShowSide] = useState(() => window.innerWidth > 780)
  const contentRef = useRef<HTMLDivElement>(null),
    toast = useToast(),
    initial = useRef(false)
  const latestJob =
    source === 'original'
      ? undefined
      : jobs.find((j) => j.id === resultVersions[source] && j.kind === source) ||
        [...jobs].sort((a, b) => b.updatedAt - a.updatedAt).find((j) => j.kind === source)
  const activity = useJobProgress(latestJob?.id)
  const preview = latestJob
    ? documentPreview(latestJob, activity?.fragments)
    : { committed: '', draft: '', waiting: false }
  const firstGap = latestJob?.chunks.findIndex((c) => !c.output) ?? -1
  const parallelPreview =
    latestJob && latestJob.status === 'running' && firstGap >= 0
      ? latestJob.chunks.flatMap((chunk, index) => {
          if (index <= firstGap) return []
          const raw = activity?.fragments[index]?.text || ''
          const content =
            chunk.output ||
            (latestJob.bilingual
              ? bilingualMarkdown(chunk, raw, true, (latestJob.promptVersion || 0) >= 4)
              : raw)
          return content ? [{ index, content }] : []
        })
      : []
  const fullResult = useMemo(() => (latestJob ? jobMarkdown(latestJob) : ''), [latestJob])
  const text =
    source === 'original'
      ? pages.find((p) => p.number === page)?.text || ''
      : latestJob?.status === 'running'
        ? preview.committed || preview.draft || parallelPreview[0]?.content || ''
        : fullResult
  const pdfMode = source === 'original' && paper && !paper.sample && !paper.referenceOnly
  const location: ReadingLocation = {
    source,
    page: source === 'original' ? page : 1,
    jobId: latestJob?.id,
    progress: 0,
  }
  const ready = pdfMode ? pdfReadyPage === page : !!text && latestJob?.status !== 'running'
  const {
    onScroll,
    getLocation,
    flush: flushPosition,
  } = useReadingPosition(paper, location, scrollRef, ready, jumpTarget)
  const onClose = useCallback(() => {
    void flushPosition().finally(onExit)
  }, [flushPosition, onExit])
  const filteredAnnotations = annotations.filter(
    (a) =>
      (annotationFilter === 'all' ||
        (annotationFilter === 'current'
          ? a.source === source && (!a.jobId || a.jobId === latestJob?.id)
          : a.source === annotationFilter)) &&
      `${a.quote} ${a.comment}`.toLocaleLowerCase().includes(annotationQuery.toLocaleLowerCase()),
  )
  const outline =
    source === 'original' && !paper?.sample
      ? pdfOutline
      : (source === 'original' ? pages : [{ number: 1, text: fullResult }]).flatMap((p) =>
          [...p.text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => ({
            title: m[2],
            depth: m[1].length - 1,
            page: p.number,
            query: m[2],
          })),
        )
  useEffect(() => {
    if (ready) setRenderedText(contentRef.current?.textContent || '')
  }, [ready, text, source, renderEpoch])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !document.querySelector('.modal-backdrop')
      ) {
        event.preventDefault()
        setSide('navigation')
        setShowSide(true)
        setFindTrigger((n) => n + 1)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (
      !ready ||
      !searchTarget ||
      !contentRef.current ||
      (source === 'original' && searchTarget.page !== page)
    )
      return
    const root = contentRef.current
    const found = findMatches(root.textContent || '', searchTarget.query)
    const match = found[searchTarget.occurrence] || found[0]
    const range = match && locateRange(root, match.start, match.end)
    if (!range) return
    const highlights = (CSS as any).highlights,
      HighlightCtor = (window as any).Highlight
    if (highlights && HighlightCtor) highlights.set('reader-search', new HighlightCtor(range))
    const frame = requestAnimationFrame(() => {
      const rect = range.getBoundingClientRect(),
        scroller = scrollRef.current
      if (scroller)
        scroller.scrollTop +=
          rect.top - scroller.getBoundingClientRect().top - scroller.clientHeight / 3
    })
    return () => {
      cancelAnimationFrame(frame)
      highlights?.delete('reader-search')
    }
  }, [searchTarget, ready, source, page, renderEpoch, text])
  const showResult = (job: Job) => {
    setResultVersions((prev) => ({ ...prev, [job.kind]: job.id }))
    setSource(job.kind)
  }
  const jump = (target: ReadingLocation) => {
    if (target.source !== 'original' && !jobs.some((j) => j.id === target.jobId)) {
      toast('书签对应的结果版本已删除。', true)
      return
    }
    setSource(target.source)
    setResultVersions((prev) => ({ ...prev, [target.source]: target.jobId || '' }))
    if (target.source === 'original') navigate(target.page)
    setJumpTarget({ ...target, token: Date.now() })
    setSearchTarget(null)
    if (window.innerWidth <= 780) setShowSide(false)
  }
  useEffect(() => {
    setBilingual(config.bilingual === true)
  }, [config.bilingual])
  useEffect(() => {
    if (!initialJobId) return
    const selected = jobs.find((job) => job.id === initialJobId)
    if (selected) {
      setResultVersions((prev) => ({ ...prev, [selected.kind]: selected.id }))
      setSource(selected.kind)
      setSide('ai')
    }
  }, [initialJobId, jobs.some((job) => job.id === initialJobId)])
  useEffect(() => {
    setSelection(null)
    setSearchTarget(null)
  }, [source, latestJob?.id])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    document.querySelector<HTMLElement>('.reader-overlay')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || document.querySelector('.modal-backdrop')) return
      const root = document.querySelector<HTMLElement>('.reader-overlay')
      const controls = Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,select,a[href]',
        ) || [],
      ).filter((el) => el.offsetParent !== null)
      const first = controls[0],
        last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === root)
      ) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', trap)
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    if (paper && !initial.current) {
      setPage(paper.currentPage)
      if (!initialJobId && paper.lastLocation) {
        setSource(paper.lastLocation.source)
        setResultVersions((prev) => ({
          ...prev,
          [paper.lastLocation!.source]: paper.lastLocation!.jobId || '',
        }))
        if (paper.lastLocation.source === 'original') setPage(paper.lastLocation.page)
      }
      initial.current = true
      void db.papers.update(id, {
        status: paper.status === 'unread' ? 'reading' : paper.status,
        lastReadAt: Date.now(),
      })
    }
  }, [paper, id])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !document.querySelector('.modal-backdrop') &&
        !editOpen &&
        !exportOpen &&
        !removeOpen
      ) {
        if (selection) setSelection(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose, selection, editOpen, exportOpen, removeOpen])
  useEffect(() => {
    if (pdfMode || !contentRef.current || latestJob?.status === 'running') return
    const highlights = (CSS as any).highlights,
      HighlightCtor = (window as any).Highlight
    if (!highlights || !HighlightCtor) return
    for (const c of ['yellow', 'green', 'purple']) {
      const ranges = annotations
        .filter(
          (a) =>
            a.source === source &&
            (source !== 'original' || a.page === page) &&
            a.color === c &&
            a.start !== undefined &&
            (!a.jobId || a.jobId === latestJob?.id),
        )
        .flatMap((a) => {
          const root =
            a.source !== 'original' && a.scope !== 'document'
              ? contentRef.current!.querySelector<HTMLElement>(`[data-legacy-page="${a.page}"]`)
              : contentRef.current!
          const range = root ? locateRange(root, a.start!, a.end!) : null
          return range && range.toString() === a.quote ? [range] : []
        })
      highlights.set(`paper-${c}`, new HighlightCtor(...ranges))
    }
    return () => {
      for (const c of ['yellow', 'green', 'purple']) highlights.delete(`paper-${c}`)
    }
  }, [annotations, source, page, text, pdfMode, latestJob?.id, latestJob?.status])
  useEffect(() => {
    const annotation = selectedAnnotation
    if (
      !annotation ||
      !ready ||
      (annotation.source === 'original' && annotation.page !== page) ||
      source !== annotation.source ||
      (annotation.jobId && annotation.jobId !== latestJob?.id) ||
      !contentRef.current
    )
      return
    const root =
      annotation.source !== 'original' && annotation.scope !== 'document'
        ? contentRef.current.querySelector<HTMLElement>(`[data-legacy-page="${annotation.page}"]`)
        : contentRef.current
    const range =
      root && annotation.start !== undefined
        ? locateRange(root, annotation.start, annotation.end!)
        : null
    let cancelled = false
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (cancelled || !scrollRef.current || !root) return
        const rect = range?.getBoundingClientRect()
        const top =
          rect?.top ??
          root.getBoundingClientRect().top +
            (annotation.rects[0]?.y || 0) * root.getBoundingClientRect().height
        scrollRef.current.scrollTop +=
          top - scrollRef.current.getBoundingClientRect().top - scrollRef.current.clientHeight / 3
        setSelectedAnnotation(null)
      }),
    )
    return () => {
      cancelled = true
    }
  }, [selectedAnnotation, source, latestJob?.id, text, ready, page, renderEpoch])

  function navigate(next: number) {
    if (!paper || next < 1 || next > paper.pageCount) return
    setPage(next)
    setSelection(null)
    void db.papers.update(id, { currentPage: next, lastReadAt: Date.now() })
    document.querySelector('.reader-scroll')?.scrollTo({ top: 0 })
  }
  function captureSelection() {
    const native = window.getSelection(),
      root = contentRef.current
    if (
      !native ||
      native.isCollapsed ||
      !root ||
      !root.contains(native.anchorNode) ||
      !root.contains(native.focusNode)
    )
      return
    const range = native.getRangeAt(0),
      quote = range.toString()
    if (!quote.trim()) return
    if (source !== 'original' && latestJob?.status !== 'completed') {
      toast('请等待全文处理完成后添加批注，避免内容接续时定位发生变化。')
      return
    }
    const rect = root.getBoundingClientRect()
    const prefix = range.cloneRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(range.startContainer, range.startOffset)
    const start = prefix.toString().length
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    const rects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        x: clamp((r.left - rect.left) / rect.width),
        y: clamp((r.top - rect.top) / rect.height),
        width: clamp(r.width / rect.width),
        height: clamp(r.height / rect.height),
      }))
    setSelection({ quote, rects, start, end: start + quote.length })
    setComment('')
    setSide('annotations')
    setShowSide(true)
  }
  async function addAnnotation() {
    if (!selection) return
    try {
      await db.annotations.add({
        id: uid(),
        paperId: id,
        source,
        page,
        scope: source === 'original' ? undefined : 'document',
        jobId: latestJob?.id,
        ...selection,
        rects: pdfMode ? selection.rects : [],
        comment,
        color,
        createdAt: Date.now(),
      })
      setSelection(null)
      window.getSelection()?.removeAllRanges()
      toast('批注已保存')
    } catch (e) {
      toast(errorMessage(e), true)
    }
  }
  async function addNote(annotation?: Annotation) {
    const noteId = uid()
    await db.notes.add({
      id: noteId,
      paperId: id,
      title: `${paper!.title} · 阅读笔记`,
      markdown: `# ${paper!.title}\n\n${annotation ? `> ${annotation.quote.replace(/\n/g, '\n> ')}\n\n— ${annotation.scope === 'document' ? '全文' : `第 ${annotation.page} 页`} · ${annotation.source === 'original' ? '原文' : annotation.source === 'translation' ? '译文' : '重排'}\n\n${annotation.comment}\n\n` : '## 我的思考\n\n'}`,
      updatedAt: Date.now(),
    })
    onNote(noteId)
  }
  async function start(kind: Job['kind']) {
    setAiBusy(true)
    try {
      const job = await createJob(
        id,
        kind,
        { ...config, bilingual },
        kind === 'reflow' && reflowInput ? { jobId: reflowInput } : undefined,
      )
      setResultVersions((prev) => ({ ...prev, [kind]: job.id }))
      setSource(kind)
      void runJob(job.id)
      toast('任务已开始，完成的批次会自动保存')
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setAiBusy(false)
    }
  }
  const fullMarkdown =
    source === 'original'
      ? pages.map((p) => `<!-- source-page: ${p.number} -->\n\n${p.text}`).join('\n\n---\n\n')
      : latestJob
        ? jobMarkdown(latestJob)
        : ''
  const closeEdit = useCallback(() => setEditOpen(false), [])
  if (!paper)
    return (
      <div className="reader-overlay">
        <Spinner />
      </div>
    )
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="文献阅读器"
      tabIndex={-1}
      className="reader-overlay"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
    >
      <header className="reader-header">
        <button className="icon-button" onClick={onClose} aria-label="返回文献库">
          <ArrowLeft size={20} />
        </button>
        <span className="reader-logo">p.</span>
        <div className="reader-heading">
          <strong>{paper.title}</strong>
          <span>
            {paper.authors} · {paper.year || '年份待核验'}
            {paper.sample && ' · 演示导读'}
          </span>
        </div>
        <div className="reader-header-actions">
          <button
            className="icon-button"
            aria-label="全文查找与目录"
            onClick={() => {
              setSide('navigation')
              setShowSide(true)
            }}
          >
            <Search size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setEditOpen(true)}
            aria-label="编辑文献信息"
          >
            <Pencil size={17} />
          </button>
          <button className="button" onClick={() => setExportOpen(true)}>
            <Download size={15} />
            <span>导出</span>
          </button>
          <button
            className="button primary"
            onClick={() => {
              setSide('ai')
              setShowSide(true)
            }}
          >
            <Sparkles size={15} />
            <span>AI 阅读助手</span>
          </button>
        </div>
      </header>
      {recognitionOpen && (
        <RecognitionPanel
          paper={paper}
          config={config}
          onClose={() => setRecognitionOpen(false)}
          onStart={(job) => {
            setResultVersions((prev) => ({ ...prev, reflow: job.id }))
            setSource('reflow')
            setSide('ai')
            setShowSide(true)
          }}
        />
      )}
      {paper.referenceOnly && (
        <div className="reference-notice">
          此记录只有引用信息。
          <button className="text-button" onClick={() => setEditOpen(true)}>
            附加 PDF / 编辑元数据
          </button>
        </div>
      )}
      <div className="reader-toolbar">
        <div className="reader-mode-tabs">
          {[
            ['original', '原文', BookOpen],
            ['translation', '智能翻译', Languages],
            ['reflow', '智能重排', Sparkles],
          ].map(([k, t, I]) => {
            const Icon = I as typeof BookOpen
            return (
              <button
                key={k as string}
                className={source === k ? 'active' : ''}
                onClick={() => {
                  setSource(k as Source)
                  setSelection(null)
                }}
              >
                <Icon size={15} />
                {t as string}
              </button>
            )
          })}
        </div>
        {source === 'original' ? (
          <div className="page-controls">
            <button
              className="icon-button"
              onClick={() => navigate(page - 1)}
              disabled={page === 1}
              aria-label="上一页"
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              <input
                className="page-input"
                type="number"
                min={1}
                max={paper.pageCount}
                aria-label="跳转页码"
                value={page}
                onChange={(e) => navigate(Number(e.target.value))}
              />{' '}
              <small>/ {paper.pageCount}</small>
            </span>
            <button
              className="icon-button"
              onClick={() => navigate(page + 1)}
              disabled={page === paper.pageCount}
              aria-label="下一页"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        ) : (
          <div className="document-mode-label">
            连续 Markdown 文档{latestJob?.bilingual ? ' · 原文对照' : ''}
          </div>
        )}
        {latestJob?.status === 'completed' && (
          <button className="button small" onClick={() => setEditingResult(latestJob)}>
            校对当前结果
          </button>
        )}
        <div className="zoom-controls">
          <button
            className="icon-button"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
            aria-label="缩小"
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            onClick={() => setZoom(Math.min(2, zoom + 0.1))}
            aria-label="放大"
          >
            <Plus size={14} />
          </button>
          <button className="icon-button" onClick={() => setZoom(1)} aria-label="适应宽度">
            <Maximize2 size={15} />
          </button>
        </div>
        <button
          className={`icon-button ${showSide ? 'selected' : ''}`}
          onClick={() => setShowSide(!showSide)}
          aria-label="切换批注面板"
        >
          <MessageSquare size={17} />
        </button>
      </div>
      <div className={`reader-body ${showSide ? '' : 'side-hidden'}`}>
        <div className="reader-scroll" ref={scrollRef} onScroll={onScroll}>
          {paper.sample && (
            <div className="demo-notice">演示导读 · 请导入原始 PDF 阅读完整文献</div>
          )}
          {source !== 'original' && latestJob?.sourceWarning && (
            <div className="demo-notice">{latestJob.sourceWarning}</div>
          )}
          {pdfMode ? (
            <PdfPage
              id={id}
              page={page}
              zoom={zoom}
              annotations={annotations.filter((a) => a.source === 'original' && a.page === page)}
              contentRef={contentRef}
              onSelect={captureSelection}
              onReady={onPdfReady}
              onOutline={onOutline}
            />
          ) : text ? (
            <div
              className="reading-paper"
              style={{ '--reading-zoom': zoom } as React.CSSProperties}
            >
              <div className="reading-page-label">
                {source === 'original'
                  ? 'ORIGINAL'
                  : source === 'translation'
                    ? 'TRANSLATION'
                    : 'REFLOW'}
                <span>
                  {source === 'original'
                    ? `PAGE ${String(page).padStart(2, '0')}`
                    : '完整文档 · MARKDOWN'}
                </span>
              </div>
              <div
                ref={contentRef}
                onMouseUp={captureSelection}
                onTouchEnd={() => setTimeout(captureSelection, 150)}
              >
                {source === 'original' ? (
                  <Markdown text={text} />
                ) : latestJob?.status === 'running' ? (
                  <>
                    <Markdown text={preview.committed} />
                    {preview.draft && (
                      <div className="document-draft">
                        <Markdown text={preview.draft} />
                      </div>
                    )}
                  </>
                ) : latestJob && latestJob.documentVersion !== 2 ? (
                  [...new Set(latestJob.chunks.map((chunk) => chunk.page))].map((sourcePage) => (
                    <div key={sourcePage} data-legacy-page={sourcePage}>
                      <Markdown
                        text={latestJob.chunks
                          .filter((chunk) => chunk.page === sourcePage)
                          .map((chunk) => chunk.output || '_[未完成的正文]_')
                          .join('\n\n')}
                      />
                    </div>
                  ))
                ) : (
                  <Markdown text={fullResult} />
                )}
              </div>
              {parallelPreview.length > 0 && (
                <div className="parallel-preview" aria-label="并行内容预览">
                  <p className="field-hint">后续内容已返回，可先预览；全文会按原文顺序自动合并。</p>
                  {parallelPreview.map(({ index, content }) => (
                    <details key={index} open>
                      <summary>并行预览 · 批次 {index + 1}</summary>
                      <Markdown text={content} />
                    </details>
                  ))}
                </div>
              )}
              {source === 'original' ? (
                <div className="reading-page-number">— {page} —</div>
              ) : (
                latestJob?.status === 'running' && (
                  <div className="document-progress-note">
                    {preview.waiting
                      ? '后续内容已完成，正在等待前文；全文将按原文顺序接续。'
                      : '内容正在接续生成，已完成部分会自动保存。'}
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="empty-state reader-empty">
              <span className="feature-icon">
                <Sparkles size={28} />
              </span>
              <h3>
                {source === 'translation' ? '跨越语言，靠近知识' : '给复杂的论文，一次清晰的表达'}
              </h3>
              <p>
                {latestJob?.status === 'running'
                  ? '正在处理全文，内容将按原文顺序连续显示。'
                  : latestJob
                    ? '暂无结果，可在右侧继续未完成的任务。'
                    : source === 'translation'
                      ? `将文献翻译为${config.targetLanguage}，汇总为一份连续 Markdown 文档。`
                      : '把提取的文本整理为层次清晰的 Markdown。'}
              </p>
              <button
                className="button primary"
                onClick={() => {
                  setSide('ai')
                  setShowSide(true)
                }}
              >
                <Sparkles size={15} />
                打开 AI 助手
              </button>
            </div>
          )}
        </div>
        {showSide && (
          <aside className="reader-side">
            <div className="side-tabs">
              <button
                className={side === 'navigation' ? 'active' : ''}
                onClick={() => setSide('navigation')}
              >
                <ListTree size={15} />
                导航
              </button>
              <button
                className={side === 'annotations' ? 'active' : ''}
                onClick={() => setSide('annotations')}
              >
                <MessageSquare size={15} />
                批注 <span>{annotations.length}</span>
              </button>
              <button className={side === 'ai' ? 'active' : ''} onClick={() => setSide('ai')}>
                <Sparkles size={15} />
                AI 助手
              </button>
              <button
                className="icon-button mobile-only"
                onClick={() => setShowSide(false)}
                aria-label="关闭侧面板"
              >
                <X size={16} />
              </button>
            </div>
            <div className="side-content">
              {side === 'navigation' ? (
                <ReaderNavigation
                  key={`${source}:${latestJob?.id || ''}`}
                  paper={paper}
                  findTrigger={findTrigger}
                  pages={pages}
                  location={location}
                  text={renderedText}
                  outline={outline}
                  getLocation={getLocation}
                  onJump={jump}
                  onSearch={(target) => {
                    if (source === 'original') navigate(target.page)
                    setSearchTarget(target)
                    if (window.innerWidth <= 780) setShowSide(false)
                  }}
                />
              ) : side === 'annotations' ? (
                <>
                  <div className="annotation-heading">
                    <span>阅读的痕迹，思考的起点</span>
                    <Highlighter size={16} />
                  </div>
                  <div className="annotation-filters">
                    <input
                      aria-label="搜索批注"
                      placeholder="搜索引用或评论"
                      value={annotationQuery}
                      onChange={(e) => setAnnotationQuery(e.target.value)}
                    />
                    <select
                      aria-label="批注来源筛选"
                      value={annotationFilter}
                      onChange={(e) => setAnnotationFilter(e.target.value)}
                    >
                      <option value="all">所有来源与版本</option>
                      <option value="original">原文</option>
                      <option value="translation">译文</option>
                      <option value="reflow">重排</option>
                      <option value="current">当前来源与版本</option>
                    </select>
                    <button
                      className="button small"
                      disabled={!filteredAnnotations.length}
                      onClick={() =>
                        void exportDocument(
                          `${paper.title}-批注汇总`,
                          annotationsMarkdown(paper.title, filteredAnnotations, jobs),
                          'md',
                        ).catch((e) => toast(errorMessage(e), true))
                      }
                    >
                      <Download size={14} />
                      导出批注汇总（{filteredAnnotations.length}）
                    </button>
                  </div>
                  {selection && (
                    <div className="annotation-compose">
                      <span className="eyebrow">新的批注 · 第 {page} 页</span>
                      <blockquote>{selection.quote}</blockquote>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="记下此刻的想法…"
                        aria-label="批注内容"
                      />
                      <div className="annotation-compose-actions">
                        <div className="highlight-colors">
                          {['yellow', 'green', 'purple'].map((c) => (
                            <button
                              key={c}
                              aria-label={`${c} 高亮`}
                              className={`highlight-${c} ${color === c ? 'active' : ''}`}
                              onClick={() => setColor(c)}
                            >
                              {color === c && <Check size={12} />}
                            </button>
                          ))}
                        </div>
                        <button
                          className="icon-button"
                          onClick={() => setSelection(null)}
                          aria-label="取消批注"
                        >
                          <X size={14} />
                        </button>
                        <button
                          className="button primary small"
                          onClick={() => void addAnnotation()}
                        >
                          保存批注
                        </button>
                      </div>
                    </div>
                  )}
                  {!annotations.length && !selection && (
                    <div className="annotations-empty">
                      <div className="annotation-doodle">
                        <Highlighter size={32} />
                      </div>
                      <h3>划下重点，留下想法</h3>
                      <p>在原文、译文或重排内容中选中文字，即可高亮和添加批注。</p>
                    </div>
                  )}
                  {[...filteredAnnotations]
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((a) => (
                      <div className={`annotation-card annotation-${a.color}`} key={a.id}>
                        <div className="annotation-card-meta">
                          <button
                            onClick={() => {
                              setResultVersions((prev) => ({ ...prev, [a.source]: a.jobId || '' }))
                              setSource(a.source)
                              if (a.source === 'original') navigate(a.page)
                              setSelectedAnnotation(a)
                            }}
                          >
                            {a.scope === 'document' ? '全文' : `第 ${a.page} 页`} ·{' '}
                            {a.source === 'original'
                              ? '原文'
                              : a.source === 'translation'
                                ? '译文'
                                : '重排'}
                          </button>
                          <button
                            className="icon-button"
                            aria-label="删除批注"
                            onClick={() => {
                              const items = [{ kind: 'annotation' as const, id: a.id }]
                              void moveToTrash(items)
                                .then(() =>
                                  toast('批注已移入回收站', false, {
                                    label: '撤销',
                                    run: async () => {
                                      await restoreFromTrash(items)
                                      toast('批注已恢复')
                                    },
                                  }),
                                )
                                .catch((e) => toast(errorMessage(e), true))
                            }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <blockquote>{a.quote}</blockquote>
                        {a.comment && <p>{a.comment}</p>}
                        <div className="annotation-card-footer">
                          <button
                            className="text-button"
                            aria-label="编辑批注"
                            onClick={() => setAnnotationEdit(a)}
                          >
                            编辑
                          </button>
                          <small>{formatDate(a.createdAt)}</small>
                          <button className="text-button" onClick={() => void addNote(a)}>
                            收集到笔记 <ArrowRight size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  <button className="button full-width" onClick={() => void addNote()}>
                    <FilePenLine size={15} />
                    新建关联笔记
                  </button>
                </>
              ) : (
                <>
                  <div className="ai-side-intro">
                    <span className="feature-icon">
                      <Sparkles size={22} />
                    </span>
                    <h3>换个角度，读懂论文</h3>
                    <p>保留原文，让阅读更进一步。</p>
                  </div>
                  <button className="ai-service" onClick={onSettings}>
                    <span className="online-dot" />
                    <span>
                      {config.model || '配置你的 AI 服务'}
                      <small>{config.model ? config.provider : '连接模型后即可开始'}</small>
                    </span>
                    <Settings2 size={16} />
                  </button>
                  <div className="ai-action-card">
                    <Languages size={21} />
                    <h4>智能翻译</h4>
                    <p>翻译为{config.targetLanguage}，保留学术术语、公式和章节内容。</p>
                    <label className="bilingual-option">
                      <input
                        type="checkbox"
                        checked={bilingual}
                        disabled={aiBusy}
                        onChange={(e) => setBilingual(e.target.checked)}
                      />
                      原文对照（逐段引用原文）
                    </label>
                    <p className="field-hint">
                      {bilingual
                        ? '每段原文以 > 引用，下面接译文，汇总为一份 Markdown。'
                        : '按段落批量翻译，输出一份连续 Markdown。'}
                    </p>
                    <button
                      className="button primary full-width"
                      disabled={aiBusy || jobs.some((j) => j.status === 'running')}
                      onClick={() => void start('translation')}
                    >
                      开始翻译 <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="ai-action-card">
                    <Sparkles size={21} />
                    <h4>智能重排</h4>
                    <p>整理段落与标题，输出更适合屏幕阅读的 Markdown。</p>
                    <label className="field">
                      重排输入来源
                      <select
                        aria-label="重排输入来源"
                        value={reflowInput}
                        disabled={aiBusy}
                        onChange={(e) => setReflowInput(e.target.value)}
                      >
                        <option value="">原文 PDF 提取文本</option>
                        {jobs
                          .filter((j) => j.status === 'completed')
                          .map((j) => (
                            <option key={j.id} value={j.id}>
                              {resultName(j)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="field-hint">
                      {reflowInput
                        ? '使用所选版本的完整 Markdown，保留该版本的语言及对照引用。校对请先保存为新版本。'
                        : '使用原文提取文本，保持原文语言。'}
                    </p>
                    <button
                      className="button full-width"
                      disabled={aiBusy || jobs.some((j) => j.status === 'running')}
                      onClick={() => void start('reflow')}
                    >
                      开始重排 <ArrowRight size={14} />
                    </button>
                  </div>
                  <p className="field-hint">
                    运行时会将文献文本发送至 {config.baseUrl}。复杂表格、公式与扫描件需要另行核对。
                  </p>
                  <button
                    className="button full-width"
                    disabled={
                      paper.sample ||
                      paper.referenceOnly ||
                      jobs.some((j) => j.status === 'running')
                    }
                    onClick={() => setRecognitionOpen(true)}
                  >
                    扫描件与版面识别
                  </button>
                  {[...jobs]
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onEdit={() => setEditingResult(job)}
                        config={{ ...config, bilingual }}
                        onRestart={(next) => {
                          setResultVersions((prev) => ({ ...prev, [next.kind]: next.id }))
                          setSource(next.kind)
                        }}
                        onView={() => {
                          setResultVersions((prev) => ({ ...prev, [job.kind]: job.id }))
                          setSource(job.kind)
                        }}
                      />
                    ))}
                </>
              )}
            </div>
            <div className="reader-side-footer">
              <span className="online-dot" /> 本地存储 · 随时继续
            </div>
          </aside>
        )}
      </div>
      <AnimatePresence>
        {editingResult && (
          <ResultEditor
            job={editingResult}
            onClose={() => setEditingResult(null)}
            onSaved={(job) => {
              setEditingResult(null)
              showResult(job)
              setReflowInput(job.id)
            }}
          />
        )}
        {annotationEdit && (
          <Modal
            title="编辑批注"
            onClose={() => {
              if (!annotationBusy) setAnnotationEdit(null)
            }}
          >
            <blockquote>{annotationEdit.quote}</blockquote>
            <label className="field">
              批注评论
              <textarea
                aria-label="编辑批注评论"
                value={annotationEdit.comment}
                onChange={(e) => setAnnotationEdit({ ...annotationEdit, comment: e.target.value })}
              />
            </label>
            <label className="field">
              高亮颜色
              <select
                aria-label="编辑批注颜色"
                value={annotationEdit.color}
                onChange={(e) => setAnnotationEdit({ ...annotationEdit, color: e.target.value })}
              >
                <option value="yellow">黄色</option>
                <option value="green">绿色</option>
                <option value="purple">紫色</option>
              </select>
            </label>
            <div className="modal-actions">
              <button
                className="button"
                disabled={annotationBusy}
                onClick={() => setAnnotationEdit(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={annotationBusy}
                onClick={async () => {
                  setAnnotationBusy(true)
                  try {
                    await editAnnotation(
                      annotationEdit.id,
                      annotationEdit.comment,
                      annotationEdit.color,
                    )
                    setAnnotationEdit(null)
                    toast('批注已更新')
                  } catch (e) {
                    toast(errorMessage(e), true)
                  } finally {
                    setAnnotationBusy(false)
                  }
                }}
              >
                保存批注修改
              </button>
            </div>
          </Modal>
        )}
        {editOpen && (
          <PaperEditor
            paper={paper}
            onClose={closeEdit}
            onDelete={() => {
              setEditOpen(false)
              setRemoveOpen(true)
            }}
          />
        )}
        {exportOpen && (
          <Modal title="导出文献" onClose={() => setExportOpen(false)}>
            <p className="muted">
              当前内容：
              {source === 'original'
                ? '原文提取文本'
                : source === 'translation'
                  ? '智能译文'
                  : '重排内容'}
              {latestJob && latestJob.status !== 'completed' && '（未完成，仅导出已有批次）'}
            </p>
            <div className="export-options">
              {(['md', 'html', 'txt', 'docx', 'pdf'] as ExportFormat[]).map((f) => (
                <button
                  className="export-format"
                  key={f}
                  disabled={!fullMarkdown}
                  onClick={async () => {
                    try {
                      if (
                        await exportDocument(
                          exportName(paper.title, source, latestJob),
                          fullMarkdown,
                          f,
                        )
                      ) {
                        toast(`${f.toUpperCase()} 已导出`)
                        setExportOpen(false)
                      }
                    } catch (e) {
                      toast(errorMessage(e), true)
                    }
                  }}
                >
                  <FilePenLine size={23} />
                  <b>{f.toUpperCase()}</b>
                  <span>
                    {
                      {
                        md: '开放的 Markdown',
                        html: '独立阅读页面',
                        txt: '纯文本内容',
                        docx: 'Word 表格与公式',
                        pdf: '可直接保存的 PDF',
                      }[f]
                    }
                  </span>
                </button>
              ))}
            </div>
            <p className="field-hint">
              PDF 使用内置中文字体；DOCX 保留表格、引用及可编辑公式。文件名包含内容来源和版本。
            </p>
            <div className="modal-actions">
              {!paper.sample && (
                <button
                  className="button"
                  onClick={async () => {
                    const asset = await db.assets.get(id)
                    if (asset?.pdf) {
                      try {
                        if (await saveFile(`${paper.title}.pdf`, asset.pdf))
                          toast('原始 PDF 已导出')
                      } catch (e) {
                        toast(errorMessage(e), true)
                      }
                    }
                  }}
                >
                  <Download size={15} />
                  原始 PDF
                </button>
              )}
              <button
                className="button"
                disabled={!fullMarkdown}
                onClick={() => {
                  if (isTauri()) {
                    toast('原生端请导出 HTML 或 DOCX，使用系统应用打印为 PDF。')
                    return
                  }
                  printDocument(paper.title, fullMarkdown)
                }}
              >
                打印 / 存为 PDF
              </button>
            </div>
          </Modal>
        )}
        {removeOpen && (
          <Modal title="移入回收站" onClose={() => setRemoveOpen(false)}>
            <p>
              将「{paper.title}」移入回收站？PDF、批注和 AI
              结果会一起保留，正在运行的任务将暂停。笔记独立保留。
            </p>
            <div className="modal-actions">
              <button className="button" onClick={() => setRemoveOpen(false)}>
                取消
              </button>
              <button
                className="button danger"
                onClick={async () => {
                  jobs.forEach((j) => cancelJob(j.id))
                  try {
                    const items = [{ kind: 'paper' as const, id }]
                    await moveToTrash(items)
                    onClose()
                    toast('文献已移入回收站，笔记保留', false, {
                      label: '撤销',
                      run: async () => {
                        await restoreFromTrash(items)
                        toast('文献已恢复')
                      },
                    })
                  } catch (e) {
                    toast(errorMessage(e), true)
                  }
                }}
              >
                确认移入回收站
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function PdfPage({
  id,
  page,
  zoom,
  annotations,
  contentRef,
  onSelect,
  onReady,
  onOutline,
}: {
  id: string
  page: number
  zoom: number
  annotations: Annotation[]
  contentRef: React.RefObject<HTMLDivElement | null>
  onSelect: () => void
  onReady: (page: number) => void
  onOutline: (entries: OutlineEntry[]) => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [width, setWidth] = useState(760)
  const wrapper = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false,
      task: ReturnType<typeof getDocument> | undefined
    void (async () => {
      try {
        const asset = await db.assets.get(id)
        if (!asset?.pdf) throw new Error('PDF 文件缺失，请从备份恢复。')
        task = getDocument({ data: await asset.pdf.arrayBuffer() })
        const loaded = await task.promise
        if (disposed) await task.destroy()
        else {
          setPdf(loaded)
          const entries: OutlineEntry[] = []
          const walk = async (
            items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
            depth = 0,
          ) => {
            for (const item of items || []) {
              if (entries.length >= 1000) break
              let page: number | undefined
              try {
                const dest =
                  typeof item.dest === 'string' ? await loaded.getDestination(item.dest) : item.dest
                if (Array.isArray(dest) && dest[0] !== undefined)
                  page =
                    (typeof dest[0] === 'number' ? dest[0] : await loaded.getPageIndex(dest[0])) + 1
              } catch {
                /* An invalid outline item remains visible but disabled. */
              }
              entries.push({ title: item.title, depth, page })
              if (depth < 10) await walk(item.items, depth + 1)
            }
          }
          await walk(await loaded.getOutline().catch(() => []))
          if (!disposed) onOutline(entries)
        }
      } catch (e) {
        if (!disposed) setError(errorMessage(e))
      }
    })()
    return () => {
      disposed = true
      void task?.destroy()
    }
  }, [id, onOutline])
  useEffect(() => {
    if (!wrapper.current) return
    const resize = new ResizeObserver((entries) =>
      setWidth(Math.min(920, entries[0].contentRect.width)),
    )
    resize.observe(wrapper.current)
    return () => resize.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf || !canvas.current || !layer.current || !contentRef.current) return
    let disposed = false,
      render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined,
      textLayer: TextLayer | undefined
    const targetCanvas = canvas.current,
      targetLayer = layer.current,
      surface = contentRef.current
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page)
        if (disposed) return
        const viewport = pdfPage.getViewport({
          scale: (Math.max(280, width) / pdfPage.getViewport({ scale: 1 }).width) * zoom,
        })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        targetCanvas.width = Math.floor(viewport.width * ratio)
        targetCanvas.height = Math.floor(viewport.height * ratio)
        targetCanvas.style.width = `${viewport.width}px`
        targetCanvas.style.height = `${viewport.height}px`
        surface.style.width = `${viewport.width}px`
        surface.style.height = `${viewport.height}px`
        surface.style.setProperty('--scale-factor', String(viewport.scale))
        surface.style.setProperty('--total-scale-factor', String(viewport.scale))
        surface.style.setProperty('--user-unit', '1')
        targetLayer.replaceChildren()
        render = pdfPage.render({
          canvas: targetCanvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        })
        await render.promise
        if (disposed) return
        textLayer = new TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: targetLayer,
          viewport,
        })
        await textLayer.render()
        if (!disposed) {
          setLoading(false)
          onReady(page)
        }
      } catch (e) {
        if (!disposed && !(e instanceof Error && e.name === 'RenderingCancelledException')) {
          setError(errorMessage(e))
          setLoading(false)
        }
      }
    })()
    return () => {
      disposed = true
      render?.cancel()
      textLayer?.cancel()
    }
  }, [pdf, page, width, zoom, contentRef, onReady])
  return (
    <div ref={wrapper} className="pdf-wrapper">
      {error && <div className="error-box">{error}</div>}
      {loading && !error && (
        <div className="pdf-loading">
          <Spinner text="正在渲染 PDF…" />
        </div>
      )}
      <div
        ref={contentRef}
        className="pdf-surface"
        onMouseUp={onSelect}
        onTouchEnd={() => setTimeout(onSelect, 150)}
      >
        <canvas ref={canvas} />
        <div ref={layer} className="textLayer" />
        <div className="pdf-highlights">
          {annotations.flatMap((a) =>
            a.rects.map((r, i) => (
              <span
                key={`${a.id}-${i}`}
                title={a.comment || a.quote}
                className={`highlight-${a.color}`}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.width * 100}%`,
                  height: `${r.height * 100}%`,
                }}
              />
            )),
          )}
        </div>
      </div>
    </div>
  )
}

export function JobCard({
  job,
  onView,
  config,
  onRestart,
  onEdit,
}: {
  job: Job
  onView: () => void
  config: AISettings
  onRestart?: (job: Job) => void
  onEdit?: () => void
}) {
  const done = job.chunks.filter((c) => c.output).length
  const activity = useJobProgress(job.id)
  const [now, setNow] = useState(Date.now()),
    [restarting, setRestarting] = useState(false)
  const toast = useToast()
  const changed = !job.recognition && !sameService(job, config)
  const inFlight = Object.values(activity?.fragments || {}).filter((fragment) => !fragment.complete)
  useEffect(() => {
    if (job.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job.status])
  async function restart() {
    setRestarting(true)
    try {
      const next = await createJob(
        job.paperId,
        job.kind,
        config,
        job.inputJobId
          ? {
              snapshot: {
                jobId: job.inputJobId,
                name: job.inputName || '历史输入版本',
                text: job.chunks.map((chunk) => chunk.input).join('\n\n'),
              },
            }
          : undefined,
      )
      onRestart?.(next)
      void runJob(next.id)
    } catch (error) {
      toast(errorMessage(error), true)
    } finally {
      setRestarting(false)
    }
  }
  return (
    <div className="job-card">
      {job.name && <strong className="result-version-name">{job.name}</strong>}
      <div className="job-heading">
        <span>
          {job.status === 'running' ? (
            <LoaderCircle size={15} className="spin" />
          ) : job.status === 'completed' ? (
            <Check size={15} />
          ) : (
            <Square size={13} />
          )}{' '}
          {job.recognition
            ? '文字与版面识别'
            : job.kind === 'translation'
              ? '智能翻译'
              : '智能重排'}
        </span>
        <small>
          {
            { running: '处理中', completed: '已完成', failed: '未完成', cancelled: '已暂停' }[
              job.status
            ]
          }
        </small>
      </div>
      <div className="progress-track">
        <i style={{ width: `${(done / Math.max(1, job.chunks.length)) * 100}%` }} />
      </div>
      <p>
        {done} / {job.chunks.length} 批次 · {job.model}
      </p>
      {job.bilingual && <p className="field-hint">原文对照 · 逐段译文</p>}
      {job.revisionOf && <p className="field-hint">人工校对版本 · 原始版本保留</p>}
      {job.inputJobId && (
        <p className="field-hint">输入：{job.inputName || '已有结果版本'}（已保存输入快照）</p>
      )}
      {job.sourceWarning && <p className="field-hint">{job.sourceWarning}</p>}
      <p className="job-endpoint" title={job.baseUrl}>
        {job.baseUrl}
      </p>
      {changed && (
        <p className="field-hint">
          此任务使用旧配置。重新处理将使用 {config.model || '当前模型'}，旧结果仍保留。
        </p>
      )}
      {activity && (
        <p className="job-live" role="status">
          {job.recognition?.engine === 'local'
            ? inFlight.map((f) => f.text).join(' ')
            : inFlight.some((fragment) => fragment.received)
              ? '正在接收模型输出'
              : inFlight.some((fragment) => fragment.phase === 'thinking')
                ? '模型正在思考，尚未返回正文'
                : inFlight.some((fragment) => fragment.phase === 'buffering')
                  ? '服务商未使用流式，等待完整正文'
                  : inFlight.length && inFlight.every((fragment) => fragment.phase === 'queued')
                    ? '正在排队，等待请求名额'
                    : '正在等待模型响应'}
          {' · '}
          {Math.max(0, Math.floor((now - activity.startedAt) / 1000))} 秒{' · '}当前批次已生成{' '}
          {inFlight.reduce((sum, fragment) => sum + fragment.text.length, 0)} 字符
        </p>
      )}
      {activity && inFlight.some((f) => f.firstTextAt && f.requestedAt) && (
        <p className="field-hint">
          当前请求首字：
          {inFlight
            .filter((f) => f.firstTextAt && f.requestedAt)
            .map((f) => `${((f.firstTextAt! - f.requestedAt!) / 1000).toFixed(1)} 秒`)
            .join(' / ')}
        </p>
      )}
      {!activity && job.chunks.some((c) => c.timing?.firstTextMs !== undefined) && (
        <p className="field-hint">
          平均首字：
          {(
            job.chunks.reduce((n, c) => n + (c.timing?.firstTextMs || 0), 0) /
            job.chunks.filter((c) => c.timing?.firstTextMs !== undefined).length /
            1000
          ).toFixed(1)}{' '}
          秒
        </p>
      )}
      {job.error && <p className="job-error">{job.error}</p>}
      <div className="job-actions">
        <button className="text-button" onClick={onView}>
          查看结果 <ArrowRight size={12} />
        </button>
        {job.status === 'running' ? (
          <button className="text-button" onClick={() => cancelJob(job.id)}>
            暂停
          </button>
        ) : (
          job.status !== 'completed' && (
            <button className="text-button" onClick={() => void runJob(job.id, config)}>
              <RotateCcw size={12} />
              {changed ? '继续原任务' : '继续'}
            </button>
          )
        )}
      </div>
      {job.status !== 'running' && !job.recognition && (
        <button
          className="button small full-width"
          disabled={restarting}
          onClick={() => void restart()}
        >
          {restarting ? <LoaderCircle size={12} className="spin" /> : <RotateCcw size={12} />}
          使用当前配置重新处理
        </button>
      )}
      <ResultActions job={job} onEdit={onEdit} />
    </div>
  )
}
