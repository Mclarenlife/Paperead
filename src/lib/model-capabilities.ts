import type { AISettings } from '../types'

// V4 defaults to high-effort thinking; document transforms explicitly opt out.
// Unknown models retain their provider defaults instead of receiving alien flags.
export const isDeepSeekV4 = (config: AISettings) =>
  /^(?:deepseek\/)?deepseek-v4-(?:flash|pro)(?:-|$)/i.test(config.model.trim())

export function thinkingParameters(config: AISettings): Record<string, unknown> {
  if (!isDeepSeekV4(config) || config.thinkingMode === 'provider') return {}
  const effort =
    config.thinkingMode === 'low' || config.thinkingMode === 'high' ? config.thinkingMode : 'none'
  if (config.provider === 'openai') return { reasoning: { effort } }
  if (config.provider === 'gemini') return {}
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
