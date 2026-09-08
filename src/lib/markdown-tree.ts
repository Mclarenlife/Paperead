import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
export interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  depth?: number
  ordered?: boolean
  start?: number
  url?: string
  alt?: string
  checked?: boolean | null
  lang?: string
}
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
export const markdownTree = (text: string) => parser.parse(text) as MarkdownNode
export const nodeText = (node: MarkdownNode): string =>
  node.value ?? node.children?.map(nodeText).join('') ?? ''
