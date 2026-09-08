import { invoke, Resource } from '@tauri-apps/api/core'

interface NativeResponse {
  rid: number
  status: number
  statusText: string
  headers: [string, string][]
  url: string
}

// Uses the pinned Tauri HTTP 2.6.0 command protocol and its existing URL ACL.
// Own the cancellation lifecycle: its stock JS wrapper keeps abort listeners
// after EOF and can error/close the same stream or resource more than once.
export async function nativeFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal
  const aborted = () => new DOMException('已取消', 'AbortError')
  if (signal?.aborted) throw aborted()
  const request = new Request(url, init)
  const data = new Uint8Array(await request.arrayBuffer())
  if (signal?.aborted) throw aborted()
  const rid = await invoke<number>('plugin:http|fetch', {
    clientConfig: {
      url: request.url,
      method: request.method,
      headers: Array.from(request.headers),
      data: data.length ? Array.from(data) : null,
      connectTimeout: 30_000,
      maxRedirections: 5,
    },
  })
  let cancelling: Promise<unknown> | undefined
  const cancelRequest = () =>
    (cancelling ??= invoke('plugin:http|fetch_cancel', { rid }).catch(() => {}))
  const abortRequest = () => {
    void cancelRequest()
  }
  signal?.addEventListener('abort', abortRequest, { once: true })
  let native: NativeResponse
  try {
    const sending = invoke<NativeResponse>('plugin:http|fetch_send', { rid })
    if (signal?.aborted) abortRequest()
    native = await sending
  } finally {
    signal?.removeEventListener('abort', abortRequest)
    await cancelRequest()
    await new Resource(rid).close().catch(() => {})
  }
  let closed = false
  let control: ReadableStreamDefaultController<Uint8Array>
  const removeListener = () => signal?.removeEventListener('abort', abortBody)
  const drop = () => {
    void invoke('plugin:http|fetch_cancel_body', { rid: native.rid }).catch(() => {})
  }
  const abortBody = () => {
    if (closed) return
    closed = true
    removeListener()
    control.error(aborted())
    drop()
  }
  if (signal?.aborted) {
    drop()
    throw aborted()
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      control = controller
      signal?.addEventListener('abort', abortBody, { once: true })
    },
    async pull(controller) {
      try {
        const bytes = new Uint8Array(
          await invoke<ArrayBuffer>('plugin:http|fetch_read_body', { rid: native.rid }),
        )
        if (closed) return
        if (bytes.at(-1) === 1) {
          closed = true
          removeListener()
          controller.close()
        } else controller.enqueue(bytes.slice(0, -1))
      } catch (error) {
        if (closed) return
        closed = true
        removeListener()
        controller.error(error)
        drop()
      }
    },
    cancel() {
      if (closed) return
      closed = true
      removeListener()
      drop()
    },
  })
  const noBody = [101, 103, 204, 205, 304].includes(native.status)
  if (noBody) await body.cancel()
  const response = new Response(noBody ? null : body, {
    status: native.status,
    statusText: native.statusText,
    headers: native.headers,
  })
  Object.defineProperty(response, 'url', { value: native.url })
  return response
}
