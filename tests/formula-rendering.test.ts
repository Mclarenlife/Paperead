import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/components/Markdown'
import {
  FormulaIntegrityError,
  mathProtection,
  normalizeAcademicMarkdown,
  normalizeMathForRendering,
  protectedSpans,
} from '../src/lib/academic-markdown'
import { markdownTree } from '../src/lib/markdown-tree'

describe('formula translation and display', () => {
  it('keeps formula identity and order while accepting unambiguous Markdown wrappers', () => {
    const protection = mathProtection('old_4')
    const masked = protection.mask('The variable $x_i$ has value $3/2$.')
    const [first, second] = masked.match(/\[\[PRM_\w+\]\]/g)!
    const escaped = first.replace(/[[\]_]/g, '\\$&')
    expect(protection.restore('变量 $' + escaped + '$ 的值为 `' + second + '`。')).toBe(
      '变量 $x_i$ 的值为 $3/2$。',
    )
    expect(protection.restore(first + ' 等于 ' + second)).toBe('$x_i$ 等于 $3/2$')
    for (const invalid of [
      second + first,
      first + first,
      first,
      first + second + '[[PRM_other_2]]',
      first + second + '[[PRM_old_4_2',
      '$a+' + first + '$ 和 ' + second,
    ]) {
      expect(() => protection.restore(invalid)).toThrow(FormulaIntegrityError)
    }
  })

  it('protects bare environments and leaves currency and code available as their own text', () => {
    const source =
      'Costs $5 to $10 for $x_i$; `$ignore$`.\n\n\\begin{gather}a=b\\\\c=d\\end{gather}'
    const spans = protectedSpans(source).map((s) => [s.kind, source.slice(s.start, s.end)])
    expect(spans).toEqual([
      ['math', '$x_i$'],
      ['code', '`$ignore$`'],
      ['math', '\\begin{gather}a=b\\\\c=d\\end{gather}'],
    ])
    const p = mathProtection('1')
    expect(p.mask(source)).toContain('Costs $5 to $10 for [[PRM_1_0]]')
    expect(p.count).toBe(2)
    const html = renderToStaticMarkup(createElement(Markdown, { text: source }))
    expect(html).toContain('$5 to $10')
    expect(html).toContain('<code>$ignore$</code>')
    expect(html).not.toContain('katex-error')
  })

  it('renders and exports inline and block math in bilingual quotes while preserving the original Markdown', () => {
    const markdown = [
      '> Costs $5 to $10 for \\(x_i\\).',
      '>',
      '> \\[',
      '> \\frac{a}{b}',
      '> \\]',
      '',
      '译文 \\(x_i\\)。',
      '',
      '$$\\frac{a}{b}$$',
      '',
      '```text',
      '> \\[literal\\]',
      '```',
    ].join('\n')
    expect(normalizeAcademicMarkdown(markdown)).toContain('> \\[\n> \\frac{a}{b}\n> \\]')
    const normalized = normalizeMathForRendering(markdown)
    expect(normalizeMathForRendering(normalized)).toBe(normalized)
    const html = renderToStaticMarkup(createElement(Markdown, { text: markdown }))
    expect(html.match(/class="katex-display"/g)).toHaveLength(2)
    expect(html.match(/<math[\s>]/g)).toHaveLength(4)
    expect(html).toContain('$5 to $10')
    expect(html).toContain('&gt; \\[literal\\]')
    expect(html).not.toContain('katex-error')
    const tree = markdownTree(markdown)
    expect(tree.children?.map((n) => n.type)).toEqual(['blockquote', 'paragraph', 'math', 'code'])
    expect(tree.children?.[0].children?.at(-1)).toMatchObject({
      type: 'math',
      value: '\\frac{a}{b}',
    })
  })

  it('closes display math before trailing prose and repairs literal delimiter newlines only', () => {
    const markdown = '定理 \\[a=b\\]。下一句。\n\n$$\\n\\nabla f=0\\n$$'
    const tree = markdownTree(markdown)
    expect(tree.children?.map((n) => [n.type, n.value])).toEqual([
      ['paragraph', undefined],
      ['math', 'a=b'],
      ['paragraph', undefined],
      ['math', '\\nabla f=0'],
    ])
    expect(normalizeAcademicMarkdown('$$\\nu$$')).toBe('$$\n\\nu\n$$')
  })

  it('preserves spaced inline math and original multi-line AMS markup across rendering', () => {
    const tex = '\\begin{multline*}a+b+c\\\\=d\\end{multline*}'
    const original = '变量 $ x_i $。\n\n' + tex
    const protection = mathProtection('long')
    const stored = protection.restore(protection.mask(original))
    expect(stored).toContain(tex)
    expect(protection.count).toBe(2)
    const html = renderToStaticMarkup(createElement(Markdown, { text: stored }))
    expect(html).not.toContain('katex-error')
    expect(html).toContain('<mtable')
  })
})
