import pdfMake from 'pdfmake/build/pdfmake'
import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces'
import { markdownTree, nodeText, type MarkdownNode } from './markdown-tree'
import { embeddedImageBlob } from './note-library'
let fonts: Promise<void> | undefined
async function loadFont() {
  fonts ||= (async () => {
    const response = await fetch('/fonts/NotoSansSC-Regular.otf')
    if (!response.ok) throw new Error('导出字体缺失，请重新安装完整版本。')
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    pdfMake.addVirtualFileSystem({ 'Noto.otf': btoa(binary) })
    pdfMake.addFonts({
      Noto: { normal: 'Noto.otf', bold: 'Noto.otf', italics: 'Noto.otf', bolditalics: 'Noto.otf' },
    })
  })().catch((e) => {
    fonts = undefined
    throw e
  })
  await fonts
}
function inline(nodes: MarkdownNode[]): ContentText['text'] {
  return nodes.map((node) => {
    const text = nodeText(node)
    if (node.type === 'strong') return { text, bold: true }
    if (node.type === 'emphasis') return { text, italics: true }
    if (node.type === 'delete') return { text, decoration: 'lineThrough' as const }
    if (node.type === 'link')
      return {
        text,
        link: /^https?:\/\//i.test(node.url || '') ? node.url : undefined,
        color: '#315548',
      }
    return { text: node.type === 'break' ? '\n' : text }
  })
}
async function blocks(nodes: MarkdownNode[]): Promise<Content[]> {
  const output: Content[] = []
  for (const node of nodes) {
    const children = node.children || []
    if (node.type === 'html') continue
    if (node.type === 'heading')
      output.push({
        text: inline(children),
        fontSize: 24 - (node.depth || 1) * 2,
        bold: true,
        margin: [0, 12, 0, 8],
        headlineLevel: node.depth,
      })
    else if (node.type === 'table')
      output.push({
        table: {
          headerRows: 1,
          widths: children[0].children!.map(() => '*'),
          body: await Promise.all(
            children.map(async (row, index) =>
              Promise.all(
                row.children!.map(async (cell) => ({
                  stack: await blocks([{ type: 'paragraph', children: cell.children || [] }]),
                  bold: index === 0,
                  margin: [4, 4, 4, 4],
                })),
              ),
            ),
          ),
        },
        layout: 'lightHorizontalLines',
        margin: [0, 8, 0, 12],
      })
    else if (node.type === 'blockquote')
      output.push({
        stack: await blocks(children),
        margin: [16, 4, 0, 8],
        color: '#596b60',
        italics: true,
      })
    else if (node.type === 'list') {
      const items = await Promise.all(
        children.map(async (item) => ({ stack: await blocks(item.children || []) })),
      )
      output.push(
        node.ordered
          ? { ol: items, start: node.start || 1, margin: [0, 3, 0, 8] }
          : { ul: items, margin: [0, 3, 0, 8] },
      )
    } else if (node.type === 'math') output.push(await mathContent(node.value || ''))
    else if (node.type === 'code')
      output.push({
        text: node.value || '',
        fontSize: 9,
        preserveLeadingSpaces: true,
        background: '#f1f4ef',
        margin: [8, 6, 8, 12],
      })
    else if (node.type === 'thematicBreak')
      output.push({
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 480, y2: 0, lineWidth: 0.5, lineColor: '#d5ddd5' },
        ],
        margin: [0, 8, 0, 12],
      })
    else if (node.type === 'paragraph') {
      let pending: MarkdownNode[] = []
      const flush = () => {
        if (pending.length) output.push({ text: inline(pending), margin: [0, 0, 0, 7] })
        pending = []
      }
      for (const child of children) {
        if (child.type === 'inlineMath') {
          flush()
          output.push(await mathContent(child.value || ''))
        } else if (child.type === 'image') {
          flush()
          const blob = await embeddedImageBlob(child.url)
          let image: string | undefined
          if (blob) {
            const bitmap = await createImageBitmap(blob),
              canvas = document.createElement('canvas')
            const ratio = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height))
            canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
            canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
            bitmap.close()
            image = canvas.toDataURL('image/png')
            canvas.width = 0
            canvas.height = 0
          }
          output.push(
            image
              ? { image, fit: [470, 420], margin: [0, 5, 0, 8] }
              : { text: `[图片：${child.alt || '图片未内嵌'}]`, color: '#657368' },
          )
        } else pending.push(child)
      }
      flush()
    } else if (children.length) output.push(...(await blocks(children)))
    else if (node.value) output.push({ text: node.value })
  }
  return output
}
async function mathContent(tex: string): Promise<Content> {
  const svg = await (await import('./export-math')).formulaSvg(tex)
  const naturalWidth = Number(svg.match(/width="([\d.]+)"/)?.[1]) || 120
  return { svg, width: Math.min(470, naturalWidth), margin: [0, 6, 0, 10] }
}
export async function pdfBlob(title: string, markdown: string) {
  await loadFont()
  const definition: TDocumentDefinitions = {
    info: { title, author: 'Paperead' },
    pageSize: 'A4',
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: 'Noto', fontSize: 10, lineHeight: 1.35 },
    content: await blocks(markdownTree(markdown).children || []),
    footer: (current, count) => ({
      text: `${current} / ${count}`,
      alignment: 'center',
      fontSize: 8,
      color: '#788477',
      margin: [0, 15, 0, 0],
    }),
  }
  return pdfMake.createPdf(definition).getBlob()
}
