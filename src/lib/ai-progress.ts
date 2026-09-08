import { useSyncExternalStore } from 'react'
export type RequestPhase = 'queued' | 'connecting' | 'thinking' | 'receiving' | 'buffering'

export interface JobProgress {
  startedAt: number
  fragments: Record<
    number,
    {
      text: string
      received: boolean
      phase?: RequestPhase
      requestedAt?: number
      firstTextAt?: number
      complete?: boolean
    }
  >
}
const progress = new Map<string, JobProgress>()
const listeners = new Set<() => void>()
export function setJobProgress(id: string, value?: JobProgress) {
  if (value) progress.set(id, value)
  else progress.delete(id)
  listeners.forEach((listener) => listener())
}
export function getJobProgress(id: string) {
  return progress.get(id)
}
export function useJobProgress(id?: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => (id ? progress.get(id) : undefined),
  )
}
