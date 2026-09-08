import { invoke, isTauri } from '@tauri-apps/api/core'
import type { AISettings } from '../types'

const sessionKeys = new Map<string, string>()
export function credentialId(config: Pick<AISettings, 'provider' | 'baseUrl'>) {
  const url = new URL(config.baseUrl.trim())
  const base = url
    .toString()
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|responses|messages)$/, '')
  return `${config.provider}:${base}`
}
async function accountId(config: AISettings) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(credentialId(config)),
  )
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const setSessionKey = (key: string, config: AISettings) => {
  const id = credentialId(config)
  if (key.trim()) sessionKeys.set(id, key.trim())
  else sessionKeys.delete(id)
}
export const hasSessionKey = (config: AISettings) => Boolean(sessionKeys.get(credentialId(config)))
export async function supportsSecureCredentials() {
  return isTauri() && (await invoke<boolean>('credentials_supported'))
}
export async function getCredential(config: AISettings): Promise<string> {
  const session = sessionKeys.get(credentialId(config))
  if (session) return session
  if (!(await supportsSecureCredentials())) return ''
  return (
    (await invoke<string | null>('read_credential', { account: await accountId(config) })) || ''
  )
}
export async function hasSavedCredential(config: AISettings) {
  if (!(await supportsSecureCredentials())) return false
  return Boolean(
    await invoke<string | null>('read_credential', { account: await accountId(config) }),
  )
}
export async function saveCredential(config: AISettings, key: string, remember: boolean) {
  const value = key.trim() || (await getCredential(config))
  if (await supportsSecureCredentials()) {
    const account = await accountId(config)
    if (remember && value) await invoke('write_credential', { account, secret: value })
    else if (!remember) await invoke('delete_credential', { account })
  }
  setSessionKey(value, config)
}
export async function clearCredential(config: AISettings) {
  if (await supportsSecureCredentials())
    await invoke('delete_credential', { account: await accountId(config) })
  setSessionKey('', config)
}
