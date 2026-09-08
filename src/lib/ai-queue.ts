type Waiter = {
  origin: string
  limit: number
  signal?: AbortSignal
  grant: (release: () => void) => void
  reject: (error: Error) => void
  abort: () => void
}
const waiting: Waiter[] = []
const running = new Set<Waiter>()
function drain() {
  for (const entry of [...waiting]) {
    if (running.size >= 3) break
    const peers = [...running].filter((peer) => peer.origin === entry.origin)
    const limit = Math.min(entry.limit, ...peers.map((peer) => peer.limit))
    if (peers.length >= limit) continue
    waiting.splice(waiting.indexOf(entry), 1)
    entry.signal?.removeEventListener('abort', entry.abort)
    running.add(entry)
    let released = false
    entry.grant(() => {
      if (!released) {
        released = true
        running.delete(entry)
        drain()
      }
    })
  }
}
// One shared queue prevents each document from independently multiplying API concurrency.
export function acquireRequest(
  url: string,
  limit: number,
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'))
  return new Promise((grant, reject) => {
    const entry: Waiter = {
      origin: new URL(url).origin,
      limit,
      signal,
      grant,
      reject,
      abort: () => {},
    }
    entry.abort = () => {
      const index = waiting.indexOf(entry)
      if (index >= 0) waiting.splice(index, 1)
      reject(new DOMException('已取消', 'AbortError'))
      drain()
    }
    signal?.addEventListener('abort', entry.abort, { once: true })
    waiting.push(entry)
    drain()
  })
}
