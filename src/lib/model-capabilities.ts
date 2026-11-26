import type { AISettings } from '../types'

export const isDeepSeekV4 = (config: AISettings) =>
  /^(?:deepseek\/)?deepseek-v4-(?:flash|pro)(?:-|$)/i.test(config.model.trim())

// Ark documents these Seed 2.1 revisions as thinking-enabled by default.
// Opaque deployment IDs and third-party gateways may expose other capabilities.
const arkSeedModels = new Set([
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-pro-260915',
  'doubao-seed-2-1-lite-260915',
])

export function thinkingBackend(config: AISettings) {
  if (config.provider === 'gemini') return undefined
  if (isDeepSeekV4(config)) return 'deepseek'
  if (config.provider === 'anthropic' || !arkSeedModels.has(config.model.trim())) return undefined
  try {
    const url = new URL(config.baseUrl)
    if (
      url.origin === 'https://ark.cn-beijing.volces.com' &&
      /^\/api\/v3(?:\/(?:chat\/completions|responses))?\/*$/.test(url.pathname)
    )
      return 'ark'
  } catch {
    // The settings form calls this while the endpoint is being typed.
  }
}

export function thinkingParameters(config: AISettings): Record<string, unknown> {
  const backend = thinkingBackend(config)
  if (!backend || config.thinkingMode === 'provider') return {}
  const effort =
    config.thinkingMode === 'low' || config.thinkingMode === 'high' ? config.thinkingMode : 'none'
  if (config.provider === 'openai') {
    if (backend === 'ark' && effort === 'none') return { thinking: { type: 'disabled' } }
    return { reasoning: { effort } }
  }
  return {
    thinking: { type: effort === 'none' ? 'disabled' : 'enabled' },
    ...(effort === 'none'
      ? {}
      : config.provider === 'anthropic'
        ? { output_config: { effort } }
        : { reasoning_effort: effort }),
  }
}

export function requireVisionModel(config: AISettings) {
  if (isDeepSeekV4(config) && !/vision/i.test(config.model))
    throw new Error(
      `${config.model} 不支持图片输入。请在偏好设置中选择支持图片的视觉模型后再识别公式，例如 deepseek-v4-flash-vision-exp；普通全文翻译仍可使用当前模型。`,
    )
}
