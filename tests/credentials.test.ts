import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: true, store: new Map<string, string>() }))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => native.enabled,
  invoke: vi.fn(async (command: string, args?: { account: string; secret?: string }) => {
    if (command === 'credentials_supported') return true
    if (command === 'write_credential') native.store.set(args!.account, args!.secret!)
    if (command === 'delete_credential') native.store.delete(args!.account)
    if (command === 'read_credential') return native.store.get(args!.account) || null
  }),
}))
const a = {
  provider: 'compatible' as const,
  baseUrl: 'https://api.example.test/v1',
  model: 'model-a',
  targetLanguage: '简体中文',
}
beforeEach(() => {
  native.enabled = true
  native.store.clear()
  vi.resetModules()
})
describe('secure credential lifecycle', () => {
  it('persists through a fresh module session, isolates endpoints and supports replacement/deletion', async () => {
    const first = await import('../src/lib/credentials')
    await first.saveCredential(a, 'fake-secret-a', true)
    const b = { ...a, baseUrl: 'https://second.example.test/v1' }
    await first.saveCredential(b, 'fake-secret-b', true)
    expect([...native.store.keys()].every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true)
    vi.resetModules()
    const restarted = await import('../src/lib/credentials')
    expect(await restarted.getCredential(a)).toBe('fake-secret-a')
    expect(await restarted.getCredential(b)).toBe('fake-secret-b')
    await restarted.saveCredential(a, 'replacement', true)
    expect(await restarted.getCredential(a)).toBe('replacement')
    await restarted.clearCredential(a)
    expect(await restarted.getCredential(a)).toBe('')
    expect(await restarted.getCredential(b)).toBe('fake-secret-b')
  })
  it('preserves an existing key with an empty field and normalizes endpoint spelling', async () => {
    const store = await import('../src/lib/credentials')
    await store.saveCredential(a, 'fake-secret', true)
    await store.saveCredential(
      { ...a, baseUrl: 'https://API.example.test/v1/chat/completions/' },
      '',
      true,
    )
    expect(native.store.size).toBe(1)
    expect(await store.getCredential(a)).toBe('fake-secret')
  })
  it('honors session-only mode and never persists browser credentials', async () => {
    const store = await import('../src/lib/credentials')
    await store.saveCredential(a, 'fake-secret', true)
    await store.saveCredential(a, '', false)
    expect(native.store.size).toBe(0)
    expect(await store.getCredential(a)).toBe('fake-secret')
    native.enabled = false
    await store.saveCredential(a, 'browser-secret', true)
    expect(native.store.size).toBe(0)
    vi.resetModules()
    expect(await (await import('../src/lib/credentials')).getCredential(a)).toBe('')
  })
})
