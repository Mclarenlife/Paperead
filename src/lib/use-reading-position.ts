import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { locationKey, saveReadingPosition } from './reading'
import type { Paper, ReadingLocation } from '../types'

export function useReadingPosition(
  paper: Paper | undefined,
  location: ReadingLocation,
  scroll: React.RefObject<HTMLDivElement | null>,
  ready: boolean,
  jump?: ReadingLocation & { token: number },
  continuous = false,
) {
  const latest = useRef({ paper, location })
  latest.current = { paper, location }
  const enabled = useRef(false),
    usedJump = useRef<number | undefined>(undefined),
    writing = useRef<Promise<void>>(Promise.resolve()),
    pending = useRef<ReadingLocation | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const getLocation = useCallback(() => {
    const el = scroll.current
    const slot =
      continuous && latest.current.location.source === 'original'
        ? el?.querySelector<HTMLElement>(
            `.pdf-page-slot[data-page="${latest.current.location.page}"]`,
          )
        : null
    return {
      ...latest.current.location,
      progress:
        slot && el
          ? Math.max(
              0,
              Math.min(
                1,
                (el.getBoundingClientRect().top - slot.getBoundingClientRect().top) /
                  slot.clientHeight,
              ),
            )
          : el
            ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
            : 0,
    }
  }, [scroll, continuous])
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const target = pending.current,
      id = latest.current.paper?.id
    pending.current = null
    if (target && id)
      writing.current = writing.current
        .then(() => saveReadingPosition(id, target))
        .catch(() => {
          /* Reading position never blocks reading. */
        })
    await writing.current
  }, [])
  const onScroll = useCallback(() => {
    if (!enabled.current) return
    pending.current = getLocation()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      pending.current = getLocation()
      void flush()
    }, 200)
  }, [flush, getLocation])
  const key =
    continuous && location.source === 'original' ? 'original:continuous' : locationKey(location)
  useLayoutEffect(() => {
    enabled.current = false
    if (!ready || !paper) return
    const hasJump =
      jump &&
      jump.token !== usedJump.current &&
      ((continuous && jump.source === 'original') || locationKey(jump) === key)
    const saved = hasJump ? jump : paper.readingPositions?.[locationKey(location)]
    if (hasJump) usedJump.current = jump.token
    if (scroll.current) {
      const slot =
        continuous && location.source === 'original'
          ? scroll.current.querySelector<HTMLElement>(
              `.pdf-page-slot[data-page="${saved?.page || location.page}"]`,
            )
          : null
      if (slot)
        scroll.current.scrollTop +=
          slot.getBoundingClientRect().top -
          scroll.current.getBoundingClientRect().top +
          (saved?.progress || 0) * slot.clientHeight
      else
        scroll.current.scrollTop =
          (saved?.progress || 0) *
          Math.max(0, scroll.current.scrollHeight - scroll.current.clientHeight)
      enabled.current = true
      pending.current = { ...latest.current.location, progress: saved?.progress || 0 }
      void flush()
    }
    return () => {
      void flush()
      enabled.current = false
    }
  }, [key, ready, jump?.token, paper?.id, flush, scroll])
  useEffect(() => {
    const pagehide = () => flush()
    window.addEventListener('pagehide', pagehide)
    return () => {
      window.removeEventListener('pagehide', pagehide)
      flush()
    }
  }, [flush])
  return { onScroll, getLocation, flush }
}
