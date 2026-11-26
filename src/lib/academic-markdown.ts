// Only normalize unambiguous syntax. Never infer fractions or missing symbols
// from flattened PDF text. Code and literal original blockquotes stay untouched.
export function headingLevel(raw: string): number {
  const text = raw.trim().replace(/^\*\*(.*?)\*\*$/, '$1')
  if (text.length > 150 || /[。!?！？;；]$/.test(text)) return 0
  const explicit = text.match(/^(#{1,6})\s+/)
  if (explicit) return explicit[1].length
  if (
    /^(?:abstract|introduction|background|related work|methods?|methodology|experiments?|results?(?: and discussion)?|discussion|conclusions?|references|acknowledg(?:e)?ments|appendix|摘要|引言|绪论|背景|相关工作|方法|实验|结果|讨论|结论|参考文献|致谢|附录)[:：]?$/i.test(
      text,
    )
  )
    return 2
  const numbered = text.match(/^(\d+(?:\.\d+)*|[IVX]+)\.?\s+(.+)$/)
  if (
    numbered &&
    numbered[2].length < 100 &&
    !/[.!?。！？;；]$/.test(numbered[2]) &&
    /^(?:[A-Z\u3400-\u9fff])/.test(numbered[2])
  )
    return Math.min(6, 2 + (numbered[1].match(/\./g)?.length || 0))
  return 0
}

type SyntaxSpan = { start: number; end: number; kind: 'math' | 'code' | 'quote' }

// A single scan serves batch boundaries, local formula protection, and Markdown
// rendering. A dollar inside code or the next currency amount cannot close math.
function* syntaxSpans(text: string, groupQuotes: boolean): Generator<SyntaxSpan> {
  const starts =
    /^( {0,3}>[ \t]?)|^ {0,3}(`{3,}|~{3,})[^\n]*|(`+)|(?<!\\)(\$\$|\$(?!\$)|\\\(|\\\[|\\begin\{((?:equation|align|gather|multline|alignat|flalign)\*?|aligned|gathered|alignedat|split|cases|[pbBvV]?matrix)\})/gm
  let match: RegExpExecArray | null
  while ((match = starts.exec(text))) {
    const start = match.index
    let end: number, kind: SyntaxSpan['kind']
    if (match[1]) {
      if (!groupQuotes) continue
      const lines = /[^\n]*(?:\n {0,3}>[^\n]*)*/y
      lines.lastIndex = starts.lastIndex
      lines.exec(text)
      end = lines.lastIndex
      kind = 'quote'
    } else if (match[2]) {
      const fence = match[2]
      const close = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}[ \t]*\r?$', 'gm')
      close.lastIndex = starts.lastIndex
      end = close.exec(text) ? close.lastIndex : text.length
      kind = 'code'
    } else if (match[3]) {
      const close = new RegExp('(?<!`)' + match[3] + '(?!`)', 'g')
      close.lastIndex = starts.lastIndex
      const found = close.exec(text)
      if (!found || /\n[ \t]*\n/.test(text.slice(starts.lastIndex, found.index))) continue
      end = close.lastIndex
      kind = 'code'
    } else {
      const marker = match[4]
      if (marker === '$') {
        const inline = /(?:\\[^\n]|[^\\$\n])+?\$(?![\d$])/y
        inline.lastIndex = starts.lastIndex
        if (!inline.exec(text)) continue
        end = inline.lastIndex
        const body = text.slice(starts.lastIndex, end - 1)
        if (!body.trim() || /^\s/.test(body) !== /\s$/.test(body)) continue
      } else if (marker === '$$') {
        const close = /(?<![\\$])\$\$(?!\$)/g
        close.lastIndex = starts.lastIndex
        if (!close.exec(text)) continue
        end = close.lastIndex
      } else {
        const closing = match[5] ? `\\end{${match[5]}}` : marker === '\\(' ? '\\)' : '\\]'
        const at = text.indexOf(closing, starts.lastIndex)
        if (at < 0 || (marker === '\\(' && text.slice(starts.lastIndex, at).includes('\n')))
          continue
        end = at + closing.length
      }
      kind = 'math'
    }
    yield { start, end, kind }
    starts.lastIndex = end
  }
}

export const protectedSpans = (text: string) =>
  [...syntaxSpans(text, false)] as { start: number; end: number; kind: 'code' | 'math' }[]

function canonicalFormula(raw: string, standalone: boolean) {
  if (raw.startsWith('\\(')) return '$' + raw.slice(2, -2).trim() + '$'
  let body: string
  if (raw.startsWith('$$')) {
    if (!standalone && !raw.includes('\n')) return raw
    body = raw.slice(2, -2)
    // Some providers repeat a literal newline from an example at both boundaries.
    const escaped = /^\\n(?![a-z])([^\n]+)\\n$/.exec(body)
    if (escaped) body = escaped[1]
  } else if (raw.startsWith('\\[')) body = raw.slice(2, -2)
  else if (raw.startsWith('\\begin{')) {
    const environment = /^\\begin\{([^}]+)\}/.exec(raw)![1]
    const inner = raw.slice(raw.indexOf('}') + 1, raw.lastIndexOf('\\end{'))
    if (/^equation\*?$/.test(environment)) body = inner
    else if (/^(?:align|gather)\*?$/.test(environment)) {
      const name = environment.startsWith('align') ? 'aligned' : 'gathered'
      body = `\\begin{${name}}${inner}\\end{${name}}`
    } else body = raw
  } else return raw
  return '$$\n' + body.trim() + '\n$$'
}

function normalizeSyntax(text: string, render: boolean, headings: boolean): string {
  let result = '',
    end = 0
  const plain = (start: number, stop: number) => {
    let prose = text.slice(start, stop)
    // remark-math also accepts the two dollar signs in "$5 to $10". Escape
    // unpaired monetary amounts for presentation; the stored source stays exact.
    if (render) prose = prose.replace(/(?<![\\$])\$(?=\d)/g, '\\$')
    if (headings)
      prose = prose.replace(/^[^\n]+$/gm, (line: string, offset: number) => {
        if (
          (start + offset > 0 && text[start + offset - 1] !== '\n') ||
          (start + offset + line.length < text.length &&
            text[start + offset + line.length] !== '\n') ||
          /^\s*[#>|]/.test(line)
        )
          return line
        const level = headingLevel(line)
        return level ? '#'.repeat(level) + ' ' + line.trim().replace(/^\*\*(.*?)\*\*$/, '$1') : line
      })
    return prose
  }
  for (const span of syntaxSpans(text, true)) {
    result += plain(end, span.start)
    const raw = text.slice(span.start, span.end)
    if (span.kind === 'quote' && render) {
      const quoted = raw.replace(/^ {0,3}> ?/gm, '')
      result += normalizeSyntax(quoted, true, false).replace(/^/gm, '> ')
    } else if (span.kind === 'math') {
      const before = text.slice(text.lastIndexOf('\n', span.start - 1) + 1, span.start)
      const nextLine = text.indexOf('\n', span.end)
      const after = text.slice(span.end, nextLine < 0 ? text.length : nextLine)
      let formula = canonicalFormula(raw, !before.trim() && !after.trim())
      if (render && formula.startsWith('$$\n')) {
        // The installed KaTeX supports aligned/gathered, but not these two
        // AMS layout environments. Preserve the original TeX in stored Markdown.
        formula = formula.replace(
          /^\$\$\n\\begin\{(flalign\*?|multline\*?)\}([\s\S]*?)\\end\{\1\}\n\$\$$/,
          (_, environment: string, body: string) => {
            const layout = environment.startsWith('flalign') ? 'aligned' : 'gathered'
            return '$$\n\\begin{' + layout + '}' + body + '\\end{' + layout + '}\n$$'
          },
        )
      }
      if (formula.startsWith('$$\n')) {
        // Keep the opening and closing markers on their own lines. Without
        // this, trailing punctuation can absorb the rest of the translation.
        result += (before.trim() ? '\n' : '') + formula + (after.trim() ? '\n' : '')
      } else result += formula
    } else result += raw
    end = span.end
  }
  return result + plain(end, text.length)
}

export const normalizeMathMarkdown = (text: string) => normalizeSyntax(text, false, false)
export const normalizeMathForRendering = (text: string) => normalizeSyntax(text, true, false)
export const normalizeAcademicMarkdown = (text: string) => normalizeSyntax(text, false, true)

export class FormulaIntegrityError extends Error {
  constructor() {
    super('模型遗漏或重复了原文公式，或移动了公式标记。')
    this.name = 'FormulaIntegrityError'
  }
}

export function mathProtection(seed: string) {
  const entries = new Map<string, { index: number; text: string }>()
  const prefix = `[[PRM_${seed.replace(/\W/g, '')}_`
  return {
    mask(text: string) {
      if (text.includes(prefix)) throw new Error('原文包含保留的公式标记，请新建任务重试。')
      let result = '',
        end = 0
      for (const span of protectedSpans(text)) {
        if (span.kind === 'code') continue
        const index = entries.size
        const token = `${prefix}${index}]]`
        const formula = text.slice(span.start, span.end)
        entries.set(token, { index, text: canonicalFormula(formula, true) })
        result += text.slice(end, span.start) + token
        end = span.end
      }
      return result + text.slice(end)
    },
    restore(text: string, partial = false) {
      if (!entries.size && !text.includes('PRM')) return text
      // Providers sometimes escape brackets/underscores as Markdown or wrap
      // one placeholder in code/math. Only peel wrappers of a whole token.
      const unescaped = text.replace(
        /\\?\[[ \t]*\\?\[[ \t]*PRM[\\\w\u200b \t]*\\?\][ \t]*\\?\]/g,
        (value) => value.replace(/\\([[\]_])/g, '$1').replace(/[\u200b \t]/g, ''),
      )
      let canonical = '',
        end = 0
      for (const span of protectedSpans(unescaped)) {
        const raw = unescaped.slice(span.start, span.end)
        if (!raw.includes('[[PRM_')) continue
        const only = raw.match(
          /^(?:([`$]+)\s*(\[\[PRM_\w+\]\])\s*\1|\\\(\s*(\[\[PRM_\w+\]\])\s*\\\)|\\\[\s*(\[\[PRM_\w+\]\])\s*\\\])$/,
        )
        if (!only) {
          if (!partial) throw new FormulaIntegrityError()
          continue
        }
        canonical += unescaped.slice(end, span.start) + (only[2] || only[3] || only[4])
        end = span.end
      }
      canonical += unescaped.slice(end)

      let seen = 0
      const restored = canonical.replace(/\[\[PRM_\w+\]\]/g, (token) => {
        const entry = entries.get(token)
        if (!partial && (!entry || entry.index !== seen)) throw new FormulaIntegrityError()
        seen++
        return entry?.text ?? ''
      })
      if (!partial && seen !== entries.size) throw new FormulaIntegrityError()
      if (!partial && canonical.replace(/\[\[PRM_\w+\]\]/g, '').includes('[[PRM_'))
        throw new FormulaIntegrityError()
      return partial ? restored.replace(/\[\[(?:P(?:R(?:M(?:_[^\]\n]*)?)?)?)?$/, '') : restored
    },
    get count() {
      return entries.size
    },
  }
}
