import * as word from 'docx'
import katex from 'katex'
import { markdownTree, nodeText, type MarkdownNode } from './markdown-tree'
import { embeddedImageBlob } from './note-library'
import { escapeHtml } from './utils'

export function formulaOmml(tex: string) {
  const html = katex.renderToString(tex, { output: 'mathml', throwOnError: true })
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const convert = (node: Element): string => {
    const kids = [...node.children],
      child = (i: number) => (kids[i] ? convert(kids[i]) : ''),
      all = () => kids.map(convert).join('')
    const run = (text: string) => `<m:r><m:t xml:space="preserve">${escapeHtml(text)}</m:t></m:r>`
    switch (node.localName) {
      case 'annotation':
        return ''
      case 'mi':
      case 'mn':
      case 'mo':
      case 'mtext':
      case 'ms':
        return run(node.textContent || '')
      case 'mspace':
        return run(' ')
      case 'mfrac':
        return `<m:f><m:num>${child(0)}</m:num><m:den>${child(1)}</m:den></m:f>`
      case 'msup':
        return `<m:sSup><m:e>${child(0)}</m:e><m:sup>${child(1)}</m:sup></m:sSup>`
      case 'msub':
        return `<m:sSub><m:e>${child(0)}</m:e><m:sub>${child(1)}</m:sub></m:sSub>`
      case 'msubsup':
        return `<m:sSubSup><m:e>${child(0)}</m:e><m:sub>${child(1)}</m:sub><m:sup>${child(2)}</m:sup></m:sSubSup>`
      case 'msqrt':
        return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${all()}</m:e></m:rad>`
      case 'mroot':
        return `<m:rad><m:deg>${child(1)}</m:deg><m:e>${child(0)}</m:e></m:rad>`
      case 'mover':
        return `<m:limUpp><m:e>${child(0)}</m:e><m:lim>${child(1)}</m:lim></m:limUpp>`
      case 'munder':
        return `<m:limLow><m:e>${child(0)}</m:e><m:lim>${child(1)}</m:lim></m:limLow>`
      case 'munderover':
        return `<m:limUpp><m:e><m:limLow><m:e>${child(0)}</m:e><m:lim>${child(1)}</m:lim></m:limLow></m:e><m:lim>${child(2)}</m:lim></m:limUpp>`
      case 'mtable':
        return `<m:m>${all()}</m:m>`
      case 'mtr':
        return `<m:mr>${all()}</m:mr>`
      case 'mtd':
        return `<m:e>${all()}</m:e>`
      default:
        return kids.length ? all() : run(node.textContent || '')
    }
  }
  const math = doc.querySelector('math')
  if (!math) throw new Error('公式转换失败。')
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${convert(math)}</m:oMath>`
}
async function inlines(
  nodes: MarkdownNode[],
  style: word.IRunOptions = {},
): Promise<word.ParagraphChild[]> {
  const output: word.ParagraphChild[] = []
  for (const node of nodes) {
    if (node.type === 'inlineMath' || node.type === 'math') {
      const root = new DOMParser().parseFromString(
        formulaOmml(node.value || ''),
        'application/xml',
      ).documentElement
      const component = (element: Element): word.ImportedXmlComponent => {
        const result = new word.ImportedXmlComponent(
          element.tagName,
          Object.fromEntries([...element.attributes].map((a) => [a.name, a.value])),
        )
        for (const child of element.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) result.push(component(child as Element))
          else if (child.nodeType === Node.TEXT_NODE) result.push(child.textContent || '')
        }
        return result
      }
      output.push(component(root) as word.ParagraphChild)
    } else if (['strong', 'emphasis', 'delete'].includes(node.type))
      output.push(
        ...(await inlines(node.children || [], {
          ...style,
          bold: node.type === 'strong' || style.bold,
          italics: node.type === 'emphasis' || style.italics,
          strike: node.type === 'delete' || style.strike,
        })),
      )
    else if (node.type === 'link' && /^https?:\/\//i.test(node.url || ''))
      output.push(
        new word.ExternalHyperlink({
          link: node.url!,
          children: await inlines(node.children || [], {
            ...style,
            color: '315548',
            underline: {},
          }),
        }),
      )
    else if (node.type === 'image') {
      const blob = await embeddedImageBlob(node.url)
      if (blob) {
        const bitmap = await createImageBitmap(blob),
          ratio = Math.min(1, 580 / bitmap.width, 500 / bitmap.height)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(bitmap.width * ratio)
        canvas.height = Math.round(bitmap.height * ratio)
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
        const png = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('图片转换失败'))),
            'image/png',
          ),
        )
        output.push(
          new word.ImageRun({
            type: 'png',
            data: new Uint8Array(await png.arrayBuffer()),
            transformation: { width: canvas.width, height: canvas.height },
          }),
        )
      } else output.push(new word.TextRun(`[图片：${node.alt || '未内嵌'}]`))
    } else if (node.type !== 'html')
      output.push(
        new word.TextRun({
          text: node.type === 'break' ? '' : nodeText(node),
          break: node.type === 'break' ? 1 : undefined,
          font: node.type === 'inlineCode' ? 'Consolas' : 'Microsoft YaHei',
          size: 22,
          ...style,
        }),
      )
  }
  return output
}
async function blocks(
  nodes: MarkdownNode[],
  quote = false,
): Promise<(word.Paragraph | word.Table)[]> {
  const output: (word.Paragraph | word.Table)[] = []
  for (const node of nodes) {
    const children = node.children || []
    if (node.type === 'html') continue
    if (node.type === 'table')
      output.push(
        new word.Table({
          width: { size: 100, type: word.WidthType.PERCENTAGE },
          rows: await Promise.all(
            children.map(
              async (row, index) =>
                new word.TableRow({
                  tableHeader: index === 0,
                  children: await Promise.all(
                    row.children!.map(
                      async (cell) =>
                        new word.TableCell({
                          children: [
                            new word.Paragraph({
                              children: await inlines(cell.children || [], { bold: index === 0 }),
                            }),
                          ],
                          margins: { top: 90, bottom: 90, left: 120, right: 120 },
                        }),
                    ),
                  ),
                }),
            ),
          ),
        }),
      )
    else if (node.type === 'blockquote') output.push(...(await blocks(children, true)))
    else if (node.type === 'list') {
      for (const [index, item] of children.entries()) {
        const nested = await blocks(item.children || [], quote)
        const prefix =
          item.checked != null
            ? item.checked
              ? '☑ '
              : '☐ '
            : node.ordered
              ? `${(node.start || 1) + index}. `
              : '• '
        if (item.children?.[0]?.type === 'paragraph')
          nested[0] = new word.Paragraph({
            children: [
              new word.TextRun(prefix),
              ...(await inlines(item.children[0].children || [])),
            ],
            indent: { left: 300, hanging: 220 },
            spacing: { after: 110 },
          })
        output.push(...nested)
      }
    } else if (
      node.type === 'heading' ||
      node.type === 'paragraph' ||
      node.type === 'code' ||
      node.type === 'math'
    ) {
      output.push(
        new word.Paragraph({
          heading:
            node.type === 'heading'
              ? (['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6'][
                  Math.min(5, (node.depth || 1) - 1)
                ] as 'Heading1')
              : undefined,
          children:
            node.type === 'math'
              ? await inlines([node])
              : node.type === 'code'
                ? nodeText(node)
                    .split('\n')
                    .map(
                      (line, i) =>
                        new word.TextRun({
                          text: line,
                          break: i ? 1 : undefined,
                          font: 'Consolas',
                          size: 19,
                        }),
                    )
                : await inlines(
                    children,
                    node.type === 'heading'
                      ? { size: 44 - (node.depth || 1) * 4, bold: true, color: '315548' }
                      : quote
                        ? { color: '596B60', italics: true }
                        : {},
                  ),
          indent: quote ? { left: 420 } : undefined,
          border: quote
            ? { left: { color: '719180', size: 14, style: word.BorderStyle.SINGLE, space: 10 } }
            : undefined,
          spacing: { after: 150, line: 320 },
          keepNext: node.type === 'heading',
        }),
      )
    }
  }
  return output
}
export async function docxBlob(title: string, markdown: string) {
  return word.Packer.toBlob(
    new word.Document({
      title,
      creator: 'Paperead',
      styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 22 } } } },
      sections: [
        {
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
            },
          },
          children: await blocks(markdownTree(markdown).children || []),
        },
      ],
    }),
  )
}
