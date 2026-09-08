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

export function normalizeAcademicMarkdown(text: string): string {
  // Split protected code blocks / spans and source quotes before replacing LaTeX
  // delimiters that remark-math otherwise treats as escaped punctuation.
  return text
    .split(
      /(^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[^\n]*$|^[ \t]*~~~[^\n]*\n[\s\S]*?^[ \t]*~~~[^\n]*$|`+[^`\n]*`+|^>[^\n]*$)/gm,
    )
    .map((part, index) => {
      if (index % 2) return part
      part = part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$\n${math.trim()}\n$$`)
        .replace(/\\\(([^\n]*?)\\\)/g, (_, math) => `$${math.trim()}$`)
        .replace(
          /(?<!\$\$\n)\\begin\{(equation\*?|align\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g,
          (_, environment: string, math: string, offset: number, whole: string) => {
            if ((whole.slice(0, offset).match(/\$\$/g)?.length || 0) % 2)
              return `\\begin{${environment}}${math}\\end{${environment}}`
            const inner = environment.startsWith('align')
              ? `\\begin{aligned}${math}\\end{aligned}`
              : environment.startsWith('gather')
                ? `\\begin{gathered}${math}\\end{gathered}`
                : math.trim()
            return `$$\n${inner}\n$$`
          },
        )
      let math = false
      return part
        .split('\n')
        .map((line) => {
          if (/^\s*\$\$/.test(line)) {
            if (!(line.trim().length > 4 && line.trim().endsWith('$$'))) math = !math
            return line
          }
          if (math || /^\s*[#>|]/.test(line)) return line
          const level = headingLevel(line)
          return level
            ? `${'#'.repeat(level)} ${line.trim().replace(/^\*\*(.*?)\*\*$/, '$1')}`
            : line
        })
        .join('\n')
    })
    .join('')
}

// These spans are indivisible when packing requests (including inline math).
export const protectedSpans = (text: string) =>
  [
    ...text.matchAll(
      /```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+|(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<![\\$])\$(?!\$)[^\n]*?(?<!\\)\$(?!\$)|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g,
    ),
  ].map((m) => ({ start: m.index!, end: m.index! + m[0].length }))

export function mathProtection(seed: string) {
  const entries: { token: string; text: string }[] = []
  const prefix = `[[PRM_${seed.replace(/\W/g, '')}_`
  return {
    mask(text: string) {
      if (text.includes(prefix)) throw new Error('原文包含保留的公式标记，请新建任务重试。')
      let result = '',
        end = 0
      for (const span of protectedSpans(text)) {
        const math = text.slice(span.start, span.end)
        if (/^[`~]/.test(math)) continue
        const token = `${prefix}${entries.length}]]`
        entries.push({ token, text: normalizeAcademicMarkdown(math) })
        result += text.slice(end, span.start) + token
        end = span.end
      }
      return result + text.slice(end)
    },
    restore(text: string, partial = false) {
      for (const entry of entries) {
        const count = text.split(entry.token).length - 1
        if (!partial && count !== 1)
          throw new Error(
            '模型遗漏或重复了原文公式，当前批次未保存为完成。继续可重试此批次；已有公式保持原样。',
          )
        text = text.split(entry.token).join(entry.text)
      }
      if (partial) text = text.replace(/\[\[(?:P(?:R(?:M(?:_[^\]\n]*)?)?)?)?$/, '')
      return text
    },
    get count() {
      return entries.length
    },
  }
}
