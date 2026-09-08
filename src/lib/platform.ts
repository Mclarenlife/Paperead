import { isTauri } from '@tauri-apps/api/core'
import { safeFilename } from './utils'

export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])
    const ext = name.split('.').pop() || 'txt'
    const path = await save({
      defaultPath: safeFilename(name),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (!path) return false
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    return true
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeFilename(name)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

export async function pickNativeFiles(
  extensions: string[],
  multiple = true,
): Promise<File[] | null> {
  if (!isTauri()) return null
  const [{ open }, { readFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const paths = await open({
    multiple,
    filters: [{ name: extensions.join(' / ').toUpperCase(), extensions }],
  })
  if (!paths) return []
  return Promise.all(
    (Array.isArray(paths) ? paths : [paths]).map(async (path, index) => {
      const bytes = await readFile(path)
      const name = path.startsWith('content://')
        ? `导入文件 ${index + 1}.${extensions[0]}`
        : decodeURIComponent(path.split(/[/\\]/).pop() || `导入文件.${extensions[0]}`)
      return new File([bytes], name, {
        type: extensions[0] === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      })
    }),
  )
}

export const pickNativePdfs = () => pickNativeFiles(['pdf'])

export async function platformFetch(url: string, init: RequestInit) {
  if (isTauri()) {
    const { nativeFetch } = await import('./native-http')
    return nativeFetch(url, init)
  }
  return fetch(url, init)
}
