import type { Provider } from '../types'
import type { RequestPhase } from './ai-progress'

export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('已取消', 'AbortError'))
    if (signal.aborted) {
      operation.catch(() => {})
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// SSE boundaries and UTF-8 code points can span any number of network chunks.
export async function readAIStream(
  response: Response,
  provider: Provider,
  signal: AbortSignal,
  onProgress: (text: string, phase?: RequestPhase) => void,
  parse: (provider: Provider, data: any) => string,
) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('服务商没有返回响应正文。')
  const decoder = new TextDecoder()
  let buffer = '',
    output = '',
    complete = false
  const event = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    if (data === '[DONE]') {
      complete = true
      return
    }
    const value = JSON.parse(data)
    const previousLength = output.length
    const thinking =
      value.choices?.[0]?.delta?.reasoning_content ||
      value.delta?.type === 'thinking_delta' ||
      value.type?.startsWith('response.reasoning') ||
      value.candidates?.[0]?.content?.parts?.some((part: any) => part.thought)
    if (value.error || value.type === 'error')
      throw new Error(value.error?.message || '流式服务返回错误。')
    if (provider === 'openai') {
      if (value.type === 'response.output_text.delta') output += value.delta || ''
      if (value.type === 'response.refusal.delta') throw new Error('模型拒绝处理当前批次。')
      if (value.type === 'response.incomplete')
        throw new Error('模型输出被截断，当前批次未保存为完成。')
      if (value.type === 'response.failed')
        throw new Error(value.response?.error?.message || '模型处理失败。')
      if (value.type === 'response.completed') {
        if (value.response?.output) output = parse(provider, value.response)
        complete = true
      }
    } else if (provider === 'anthropic') {
      if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta')
        output += value.delta.text || ''
      if (value.delta?.stop_reason === 'max_tokens')
        throw new Error('模型输出被截断，当前批次未保存为完成。')
      if (value.delta?.stop_reason === 'refusal') throw new Error('模型拒绝处理当前批次。')
      if (value.type === 'message_stop') complete = true
    } else if (provider === 'gemini') {
      const candidate = value.candidates?.[0]
      if (candidate?.finishReason && candidate.finishReason !== 'STOP')
        throw new Error(`模型未正常完成：${candidate.finishReason}。当前批次未保存为完成。`)
      output +=
        candidate?.content?.parts
          ?.filter((part: any) => !part.thought)
          .map((part: any) => part.text || '')
          .join('') || ''
      if (candidate?.finishReason === 'STOP') complete = true
    } else {
      const choice = value.choices?.[0]
      if (choice?.finish_reason === 'length')
        throw new Error('模型输出被截断，当前批次未保存为完成。')
      if (choice?.finish_reason === 'content_filter' || choice?.delta?.refusal)
        throw new Error('模型拒绝处理当前批次。')
      if (typeof choice?.delta?.content === 'string') output += choice.delta.content
      if (choice?.finish_reason === 'stop') complete = true
    }
    if (output.length > 2_000_000) throw new Error('单批次响应过大，已停止读取。')
    if (output.length !== previousLength) onProgress(output, 'receiving')
    else if (thinking && !output) onProgress('', 'thinking')
  }
  try {
    while (!complete) {
      const { value, done } = await abortable(reader.read(), signal)
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      if (buffer.length > 2_000_000) throw new Error('流式响应格式无效或事件过大。')
      let match: RegExpMatchArray | null
      while (!complete && (match = buffer.match(/\r?\n\r?\n/))) {
        const index = match.index!
        event(buffer.slice(0, index))
        buffer = buffer.slice(index + match[0].length)
      }
      if (done) {
        if (!complete && buffer.trim()) event(buffer)
        break
      }
    }
    if (!complete) throw new Error('响应流意外中断，当前批次未保存为完成，可继续重试。')
    if (!output.trim()) throw new Error('服务商没有返回可用文本。请检查模型权限或内容限制。')
    return output.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/, '$1').trim()
  } finally {
    // Do not keep the reader or Rust response resource after completion/cancellation.
    void reader.cancel().catch(() => {})
  }
}
