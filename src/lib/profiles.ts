import { db } from './db'
import { normalizeConfig } from './ai'
import { uid } from './utils'
import type { AIProfile, AISettings } from '../types'

// Whitelist fields: service profiles never persist API keys or arbitrary input.
export function profileSettings(raw: AISettings): AISettings {
  const c = normalizeConfig(raw)
  return {
    profileId: c.profileId,
    provider: c.provider,
    baseUrl: c.baseUrl,
    model: c.model,
    targetLanguage: c.targetLanguage,
    timeoutSeconds: c.timeoutSeconds,
    stream: c.stream,
    concurrency: c.concurrency,
    chunkSize: c.chunkSize,
    maxOutputTokens: c.maxOutputTokens,
    rememberKey: c.rememberKey,
    bilingual: c.bilingual,
    batchSize: c.batchSize,
    thinkingMode: c.thinkingMode,
  }
}
export async function readProfiles(): Promise<AIProfile[]> {
  return JSON.parse((await db.meta.get('aiProfiles'))?.value || '[]')
}
export async function storeProfile(name: string, raw: AISettings) {
  if (!name.trim()) throw new Error('请输入配置名称。')
  const settings = profileSettings({ ...raw, profileId: raw.profileId || uid() })
  if (!settings.model) throw new Error('请填写模型 ID。')
  await db.transaction('rw', db.meta, async () => {
    const profiles = await readProfiles()
    const existing = profiles.findIndex((p) => p.id === settings.profileId)
    if (existing < 0 && profiles.length >= 50) throw new Error('最多保存 50 套配置。')
    const entry = { id: settings.profileId!, name: name.trim().slice(0, 100), settings }
    if (existing < 0) profiles.push(entry)
    else profiles[existing] = entry
    await db.meta.put({ key: 'aiProfiles', value: JSON.stringify(profiles) })
  })
  return settings
}
export async function deleteProfile(id: string) {
  await db.transaction('rw', db.meta, async () => {
    const profiles = (await readProfiles()).filter((p) => p.id !== id)
    await db.meta.put({ key: 'aiProfiles', value: JSON.stringify(profiles) })
  })
}
