import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { locationKey, saveReadingPosition } from './reading'
import type { Paper, ReadingLocation } from '../types'

export function useReadingPosition(
  paper: Paper | undefined,
  location: ReadingLocation,
  scroll: React.RefObject<HTMLDivElement | null>,
  ready: boolean,
  jump?: ReadingLocation & { token: number },
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
    return {
      ...latest.current.location,
      progress: el ? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) : 0,
    }
  }, [scroll])
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
    timer.current = setTimeout(flush, 200)
  }, [flush, getLocation])
  const key = locationKey(location)
  useLayoutEffect(() => {
    enabled.current = false
    if (!ready || !paper) return
    const hasJump = jump && jump.token !== usedJump.current && locationKey(jump) === key
    const saved = hasJump ? jump : paper.readingPositions?.[key]
    if (hasJump) usedJump.current = jump.token
    if (scroll.current) {
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
