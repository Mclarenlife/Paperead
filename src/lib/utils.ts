export const uid = () => crypto.randomUUID()
export const formatDate = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value)
export const formatSize = (size: number) =>
  size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
export const safeFilename = (name: string) =>
  name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 120) || 'Paperead'
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
