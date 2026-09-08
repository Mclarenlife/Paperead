import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../components/Markdown'
import { escapeHtml } from './utils'
import { saveFile } from './platform'

export type ExportFormat = 'md' | 'html' | 'txt' | 'docx' | 'pdf'
export function exportName(
  title: string,
  source: 'original' | 'translation' | 'reflow',
  job?: { id: string; name?: string; language: string; updatedAt: number },
) {
  return `${title}-${{ original: '原文', translation: '译文', reflow: '重排' }[source]}${job ? `-${job.name || job.language}-${new Date(job.updatedAt).toISOString().slice(0, 10)}-${job.id.slice(0, 8)}` : ''}`
}
export const plainText = (md: string) =>
  md
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
export const documentHtml = (title: string, markdown: string) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{max-width:820px;margin:60px auto;padding:0 24px;color:#26352e;font:16px/1.9 Georgia,"Noto Serif SC",serif}h1,h2,h3{line-height:1.4}h2{margin-top:2em}pre{padding:20px;background:#f3f5f0;white-space:pre-wrap}code{font-family:monospace}blockquote{border-left:3px solid #719180;padding-left:20px;color:#66756e}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}img{max-width:100%;height:auto}a{color:#315548}.katex-html{display:none}.katex-mathml{position:static!important;clip:auto!important;width:auto!important;height:auto!important}@media print{body{margin:0;max-width:none}@page{margin:20mm}h1,h2,h3{break-after:avoid}pre,table{break-inside:avoid}}</style></head><body>${renderToStaticMarkup(<Markdown text={markdown} embeddedImages />)}</body></html>`

export async function exportDocument(title: string, markdown: string, format: ExportFormat) {
  if (format === 'html' || format === 'md') {
    const { imageDataUrl } = await import('./note-library')
    for (const match of [...markdown.matchAll(/paperead-attachment:([\w-]+)/g)]) {
      const url = await imageDataUrl(match[1])
      if (url) markdown = markdown.replaceAll(match[0], url)
    }
  }
  let blob: Blob
  if (format === 'pdf') blob = await (await import('./export-pdf')).pdfBlob(title, markdown)
  else if (format === 'docx') {
    blob = await (await import('./export-docx')).docxBlob(title, markdown)
  } else {
    const content =
      format === 'html'
        ? documentHtml(title, markdown)
        : format === 'txt'
          ? plainText(markdown)
          : markdown
    blob = new Blob([content], {
      type: format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
    })
  }
  return saveFile(`${title}.${format}`, blob)
}

export function printDocument(title: string, markdown: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;'
  frame.title = '打印文献'
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  frame.srcdoc = documentHtml(title, markdown)
  document.body.append(frame)
}
