import { headingLevel } from './academic-markdown'

export type PdfTextItem = {
  str?: string
  hasEOL?: boolean
  transform?: number[]
  width?: number
  height?: number
  fontName?: string
}
type Glyph = { text: string; x: number; y: number; height: number; end: number; font: string }
type Line = Glyph & { script: boolean }
const median = (values: number[], fallback: number) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)] || fallback
const endSentence = (text: string) => /[.!?。！？]["'”’）)\]]*$/.test(text)
const symbols: Record<string, string> = {
  α: '\\alpha ',
  β: '\\beta ',
  γ: '\\gamma ',
  δ: '\\delta ',
  θ: '\\theta ',
  λ: '\\lambda ',
  μ: '\\mu ',
  σ: '\\sigma ',
  π: '\\pi ',
  φ: '\\phi ',
  ω: '\\omega ',
  Σ: '\\Sigma ',
  Δ: '\\Delta ',
  Ω: '\\Omega ',
  '∑': '\\sum ',
  '∫': '\\int ',
  '∞': '\\infty ',
  '∂': '\\partial ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '≠': '\\ne ',
  '≈': '\\approx ',
  '×': '\\times ',
  '·': '\\cdot ',
  '−': '-',
  '∈': '\\in ',
  '∇': '\\nabla ',
  '→': '\\to ',
}
const latexSymbols = (text: string) =>
  text.replace(/[αβγδθλμσπφωΣΔΩ∑∫∞∂≤≥≠≈×·−∈∇→]/g, (c) => symbols[c])

export function extractPdfLayout(items: PdfTextItem[], options: { page?: number } = {}) {
  const glyphs: Glyph[] = items
    .filter((i) => i.str?.trim())
    .map((i) => ({
      text: i.str!,
      x: i.transform?.[4] || 0,
      y: i.transform?.[5] || 0,
      height: Math.abs(i.height || i.transform?.[3] || 10),
      end: (i.transform?.[4] || 0) + Math.abs(i.width || 0),
      font: i.fontName || '',
    }))
  // Weight by text length so a page full of tiny equation glyphs doesn't turn
  // its body into headings. Runs at a common baseline are sorted geometrically.
  const sizes = new Map<number, number>()
  for (const g of glyphs)
    sizes.set(Math.round(g.height), (sizes.get(Math.round(g.height)) || 0) + g.text.length)
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 10
  const rows: { y: number; glyphs: Glyph[] }[] = []
  for (const g of [...glyphs].sort((a, b) => b.height - a.height || b.y - a.y || a.x - b.x)) {
    // Sub/superscripts attach only when smaller and horizontally adjacent.
    const row = rows.find(
      (r) =>
        Math.abs(r.y - g.y) < Math.max(1.5, g.height * 0.23) ||
        (g.height < body * 0.85 &&
          Math.abs(r.y - g.y) < body * 0.8 &&
          r.glyphs.some(
            (p) =>
              p.height >= body * 0.9 &&
              g.x >= p.x &&
              g.x - p.end < body * 0.65 &&
              g.x >= p.end - body,
          )),
    )
    if (row) row.glyphs.push(g)
    else rows.push({ y: g.y, glyphs: [g] })
  }
  const lines: Line[] = []
  for (const row of rows) {
    let line: Line | undefined
    for (const g of row.glyphs.sort((a, b) => a.x - b.x)) {
      if (line && g.x - line.end > body * 2.5) {
        lines.push(line)
        line = undefined
      }
      if (!line) {
        line = { ...g, y: row.y, script: false }
        continue
      }
      const dy = g.y - line.y
      const script =
        g.height < line.height * 0.85 &&
        Math.abs(dy) > body * 0.18 &&
        /^[\wα-ω+−=-]+$/u.test(g.text.trim()) &&
        g.x - line.end < body * 0.65 &&
        /[\wα-ω)}]$/u.test(line.text)
      if (script) {
        line.text += `${dy > 0 ? '^' : '_'}{${latexSymbols(g.text.trim())}}`
        line.script = true
      } else {
        const space =
          !/\s$/.test(line.text) && !/^\s/.test(g.text) && g.x - line.end > body * 0.12 ? ' ' : ''
        line.text += space + g.text
      }
      line.end = Math.max(line.end, g.end)
      line.height = Math.max(line.height, g.height)
    }
    if (line) lines.push(line)
  }
  lines.sort((a, b) => b.y - a.y || a.x - b.x)
  // A repeated, empty vertical gutter separates columns. Full-width headings
  // are barriers: read both columns in each band before the next full-width block.
  const leftEdge = Math.min(...lines.map((l) => l.x)),
    rightEdge = Math.max(...lines.map((l) => l.end))
  const starts = [...new Set(lines.map((l) => l.x))].filter(
    (x) =>
      x > leftEdge + (rightEdge - leftEdge) * 0.3 && x < leftEdge + (rightEdge - leftEdge) * 0.75,
  )
  const gutter = starts.find((x) => {
    const left = lines.filter((l) => l.x < x - body * 2 && l.end <= x - body)
    const right = lines.filter((l) => Math.abs(l.x - x) < body * 2)
    return (
      left.length >= 3 &&
      right.length >= 3 &&
      Math.max(...left.map((l) => l.y)) >= Math.min(...right.map((l) => l.y))
    )
  })
  let ordered = lines
  if (gutter !== undefined) {
    ordered = []
    let band: Line[] = []
    const flush = () => {
      ordered.push(
        ...band.filter((l) => l.x < gutter - body).sort((a, b) => b.y - a.y),
        ...band.filter((l) => l.x >= gutter - body).sort((a, b) => b.y - a.y),
      )
      band = []
    }
    for (const line of lines) {
      if (line.x < gutter - body && line.end > gutter - body) {
        flush()
        ordered.push(line)
      } else band.push(line)
    }
    flush()
  }
  const gaps = ordered
    .slice(1)
    .map((l, i) => ordered[i].y - l.y)
    .filter((g) => g > body * 0.8 && g < body * 1.8)
  const leading = median(gaps, body * 1.4)
  const warnings = new Set<string>()
  const output: string[] = []
  let previous: Line | undefined,
    previousHeading = 0
  for (const line of ordered) {
    let text = line.text.trim()
    if (/[\uFFFD\uE000-\uF8FF]/.test(text)) warnings.add('存在无法可靠解码的 PDF 字符')
    const mathLike = /[=∑∫≤≥≠≈∂∇]/.test(text) || line.script
    // Convert only simple, visibly linear expressions; complex layouts still
    // require a vision pass. A footnote superscript in prose is not an equation.
    const prose = /[A-Za-z]{4,}/.test(text.replace(/\b(?:sin|cos|tan|log|exp|lim|max|min)\b/g, ''))
    const equation = mathLike && !prose && text.length < 400
    if (equation) text = `$$\n${latexSymbols(text)}\n$$`
    else if (line.script) {
      text = text.replace(
        /([A-Za-zα-ω](?:[_^]\{[^}]+\})+)/gu,
        (_, value) => `$${latexSymbols(value)}$`,
      )
      warnings.add('上下标按字形位置恢复，复杂公式需对照页面核验')
    }
    if (/[∑∫∂∇]/.test(line.text) || /symbol|math|cmmi|cmsy/i.test(line.font))
      warnings.add('公式结构可能未完整保留，建议使用视觉版面解析')
    let level = equation ? 0 : headingLevel(text)
    if (!level && text.length < 180 && !endSentence(text) && !mathLike && line.height > body * 1.18)
      level = (options.page || 1) === 1 && line.height >= body * 1.5 ? 1 : 2
    if (level && !/^#{1,6}\s/.test(text)) text = `${'#'.repeat(level)} ${text}`
    if (
      previous &&
      level &&
      level === previousHeading &&
      Math.abs(previous.height - line.height) < 1 &&
      previous.y - line.y > 0 &&
      previous.y - line.y < line.height * 1.5 &&
      !headingLevel(line.text) &&
      !headingLevel(previous.text)
    ) {
      output[output.length - 1] += ' ' + text.replace(/^#+\s/, '')
    } else {
      const columnChange =
        previous && (Math.abs(line.x - previous.x) > body * 5 || line.y > previous.y + body)
      const shortEnding =
        previous &&
        endSentence(previous.text) &&
        previous.end < line.end - body * 2 &&
        Math.abs(line.x - previous.x) < body * 0.8
      const paragraph =
        !previous ||
        level ||
        previousHeading ||
        equation ||
        /\$\$$/.test(output.at(-1) || '') ||
        columnChange ||
        previous.y - line.y > Math.max(leading * 1.35, body * 1.65) ||
        line.x - previous.x > body * 0.8 ||
        shortEnding
      output.push((output.length ? (paragraph ? '\n\n' : '\n') : '') + text)
    }
    previous = line
    previousHeading = level
  }
  return { text: output.join(''), warnings: [...warnings] }
}
