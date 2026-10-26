import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { db } from '../lib/db'
import { getDocument } from '../lib/pdf'
import { errorMessage } from '../lib/utils'
import type { Annotation } from '../types'
import type { OutlineEntry } from './ReaderNavigation'
import { Spinner } from './UI'

export type PdfJump = { page: number; token: number; progress?: number }

export function ContinuousPdf({
  id,
  pageCount,
  page,
  zoom,
  annotations,
  scrollRef,
  jump,
  onPage,
  onReady,
  onOutline,
  onActiveElement,
  onSelect,
}: {
  id: string
  pageCount: number
  page: number
  zoom: number
  annotations: Annotation[]
  scrollRef: RefObject<HTMLDivElement | null>
  jump?: PdfJump
  onPage: (page: number) => void
  onReady: (page: number) => void
  onOutline: (entries: OutlineEntry[]) => void
  onActiveElement: (element: HTMLDivElement | null) => void
  onSelect: (page: number, element: HTMLDivElement) => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(760)
  const [ratio, setRatio] = useState(1.414)
  const [near, setNear] = useState<Set<number>>(() => new Set([page]))
  const wrapper = useRef<HTMLDivElement>(null)
  const previousWidth = useRef(760)
  const resizeAnchor = useRef<{ page: number; progress: number } | null>(null)
  const current = useRef(page)
  current.current = page
  const notifyPage = useRef(onPage)
  notifyPage.current = onPage
  useEffect(() => {
    let disposed = false
    let task: ReturnType<typeof getDocument> | undefined
    void (async () => {
      try {
        const asset = await db.assets.get(id)
        if (!asset?.pdf) throw new Error('PDF 文件缺失，请从备份恢复。')
        task = getDocument({ data: await asset.pdf.arrayBuffer() })
        const loaded = await task.promise
        if (disposed) return
        const first = (await loaded.getPage(1)).getViewport({ scale: 1 })
        if (disposed) return
        setRatio(first.height / first.width)
        setPdf(loaded)
        const entries: OutlineEntry[] = []
        const walk = async (
          items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>,
          depth = 0,
        ) => {
          for (const item of items || []) {
            if (entries.length >= 1000 || disposed) break
            let target: number | undefined
            try {
              const dest =
                typeof item.dest === 'string' ? await loaded.getDestination(item.dest) : item.dest
              if (Array.isArray(dest) && dest[0] !== undefined)
                target =
                  (typeof dest[0] === 'number' ? dest[0] : await loaded.getPageIndex(dest[0])) + 1
            } catch {
              /* Keep malformed outline entries disabled. */
            }
            entries.push({ title: item.title, depth, page: target })
            if (depth < 10) await walk(item.items, depth + 1)
          }
        }
        await walk(await loaded.getOutline().catch(() => []))
        if (!disposed) onOutline(entries)
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
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.min(920, entry.contentRect.width)
      if (Math.abs(next - previousWidth.current) < 0.5) return
      const root = scrollRef.current
      const slot = wrapper.current?.querySelector<HTMLElement>(`[data-page="${current.current}"]`)
      if (root && slot)
        resizeAnchor.current = {
          page: current.current,
          progress: Math.max(
            0,
            (root.getBoundingClientRect().top - slot.getBoundingClientRect().top) /
              slot.clientHeight,
          ),
        }
      previousWidth.current = next
      setWidth(next)
    })
    observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [scrollRef])
  useLayoutEffect(() => {
    const saved = resizeAnchor.current,
      root = scrollRef.current
    if (!saved || !root) return
    const slot = wrapper.current?.querySelector<HTMLElement>(`[data-page="${saved.page}"]`)
    if (slot)
      root.scrollTop +=
        slot.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        saved.progress * slot.clientHeight
    resizeAnchor.current = null
  }, [width, scrollRef])
  useEffect(() => {
    const root = scrollRef.current,
      container = wrapper.current
    if (!root || !container || !pdf) return
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((previous) => {
          const next = new Set(previous)
          for (const entry of entries) {
            const number = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) next.add(number)
            else next.delete(number)
          }
          return next
        })
      },
      { root, rootMargin: '900px 0px' },
    )
    const slots = Array.from(container.querySelectorAll<HTMLElement>('.pdf-page-slot'))
    slots.forEach((slot) => observer.observe(slot))
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const y = root.getBoundingClientRect().top + Math.min(root.clientHeight * 0.3, 180)
        let low = 0,
          high = slots.length - 1
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (slots[middle].getBoundingClientRect().bottom < y) low = middle + 1
          else high = middle
        }
        const number = Number(slots[low]?.dataset.page)
        if (number && number !== current.current) notifyPage.current(number)
      })
    }
    root.addEventListener('scroll', update, { passive: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', update)
    }
  }, [pdf, pageCount, scrollRef])
  useEffect(() => {
    if (!jump || !pdf || !scrollRef.current) return
    const root = scrollRef.current
    const target = wrapper.current?.querySelector<HTMLElement>(`[data-page="${jump.page}"]`)
    if (!target) return
    setNear((previous) => new Set([...previous, jump.page]))
    root.scrollTop +=
      target.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      (jump.progress || 0) * target.clientHeight
    notifyPage.current(jump.page)
  }, [jump?.token, pdf, scrollRef])
  return (
    <div className="pdf-continuous" ref={wrapper} aria-label="连续 PDF 文档">
      {error ? (
        <div className="error-box">{error}</div>
      ) : !pdf ? (
        <Spinner text="正在打开 PDF…" />
      ) : (
        Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((number) => (
          <PdfSheet
            key={number}
            pdf={pdf}
            page={number}
            width={Math.max(120, width) * zoom}
            ratio={ratio}
            active={number === page}
            mounted={near.has(number) || number === page}
            annotations={annotations.filter((a) => a.source === 'original' && a.page === number)}
            scrollRef={scrollRef}
            onReady={onReady}
            onActiveElement={onActiveElement}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}

function PdfSheet({
  pdf,
  page,
  width,
  ratio,
  active,
  mounted,
  annotations,
  scrollRef,
  onReady,
  onActiveElement,
  onSelect,
}: {
  pdf: PDFDocumentProxy
  page: number
  width: number
  ratio: number
  active: boolean
  mounted: boolean
  annotations: Annotation[]
  scrollRef: RefObject<HTMLDivElement | null>
  onReady: (page: number) => void
  onActiveElement: (element: HTMLDivElement | null) => void
  onSelect: (page: number, element: HTMLDivElement) => void
}) {
  const [aspect, setAspect] = useState(ratio)
  const slot = useRef<HTMLElement>(null),
    previousAspect = useRef(ratio),
    correction = useRef(0)
  const measure = useCallback(
    (next: number) => {
      if (Math.abs(next - previousAspect.current) < 0.001) return
      const root = scrollRef.current
      if (
        root &&
        slot.current &&
        slot.current.getBoundingClientRect().bottom <= root.getBoundingClientRect().top
      )
        correction.current += width * (next - previousAspect.current)
      previousAspect.current = next
      setAspect(next)
    },
    [width, scrollRef],
  )
  useLayoutEffect(() => {
    if (scrollRef.current && correction.current) scrollRef.current.scrollTop += correction.current
    correction.current = 0
  }, [aspect, scrollRef])
  return (
    <section
      className="pdf-page-slot"
      ref={slot}
      data-page={page}
      data-active={active}
      aria-label={`PDF 第 ${page} 页`}
      style={{ height: width * aspect + 32 }}
    >
      <div className="pdf-page-caption">第 {page} 页</div>
      {mounted && (
        <PdfCanvas
          pdf={pdf}
          page={page}
          width={width}
          height={width * aspect}
          active={active}
          annotations={annotations}
          onRatio={measure}
          onReady={onReady}
          onActiveElement={onActiveElement}
          onSelect={onSelect}
        />
      )}
    </section>
  )
}

function PdfCanvas({
  pdf,
  page,
  width,
  height,
  active,
  annotations,
  onRatio,
  onReady,
  onActiveElement,
  onSelect,
}: {
  pdf: PDFDocumentProxy
  page: number
  width: number
  height: number
  active: boolean
  annotations: Annotation[]
  onRatio: (ratio: number) => void
  onReady: (page: number) => void
  onActiveElement: (element: HTMLDivElement | null) => void
  onSelect: (page: number, element: HTMLDivElement) => void
}) {
  const surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    if (active && ready) {
      onActiveElement(surface.current)
      onReady(page)
    }
  }, [active, ready, page, onActiveElement, onReady])
  useEffect(() => {
    let disposed = false
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let text: TextLayer | undefined
    const target = canvas.current!,
      targetLayer = layer.current!,
      element = surface.current!
    setReady(false)
    setError('')
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page)
        if (disposed) return
        const natural = pdfPage.getViewport({ scale: 1 })
        onRatio(natural.height / natural.width)
        const viewport = pdfPage.getViewport({ scale: width / natural.width })
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
        )
        target.width = Math.floor(viewport.width * dpr)
        target.height = Math.floor(viewport.height * dpr)
        target.style.width = `${viewport.width}px`
        target.style.height = `${viewport.height}px`
        element.style.width = `${viewport.width}px`
        element.style.height = `${viewport.height}px`
        element.style.setProperty('--scale-factor', String(viewport.scale))
        element.style.setProperty('--total-scale-factor', String(viewport.scale))
        element.style.setProperty('--user-unit', '1')
        targetLayer.replaceChildren()
        render = pdfPage.render({
          canvas: target,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        })
        await render.promise
        if (disposed) return
        text = new TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: targetLayer,
          viewport,
        })
        await text.render()
        if (!disposed) setReady(true)
      } catch (e) {
        if (!disposed && !(e instanceof Error && e.name === 'RenderingCancelledException'))
          setError(errorMessage(e))
      }
    })()
    return () => {
      disposed = true
      render?.cancel()
      text?.cancel()
      target.width = 0
      target.height = 0
    }
  }, [pdf, page, width, onRatio])
  return (
    <>
      {error && <div className="error-box">{error}</div>}
      <div
        ref={surface}
        className="pdf-surface"
        style={{ width, height }}
        data-ready={ready}
        onMouseUp={() => onSelect(page, surface.current!)}
        onTouchEnd={() =>
          setTimeout(() => {
            if (surface.current) onSelect(page, surface.current)
          }, 150)
        }
      >
        {!ready && !error && (
          <div className="pdf-loading">
            <Spinner text={`正在渲染第 ${page} 页…`} />
          </div>
        )}
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
    </>
  )
}
