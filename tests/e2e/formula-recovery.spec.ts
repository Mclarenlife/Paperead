import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('continues a previous 4/14 translation, restores omitted equations and exports the whole paper', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
  const endpoint = 'http://127.0.0.1:11438/v1'
  const equation = String.raw`\frac{\alpha_{10}}{1+x^{2}}`
  await page.evaluate(
    async ({ endpoint, equation }) => {
      const path = '/src/lib/db.ts'
      const { db } = await import(/* @vite-ignore */ path)
      await db.jobs.add({
        id: 'previous-formula-job',
        kind: 'translation',
        paperId: 'sample-0',
        provider: 'compatible',
        baseUrl: endpoint,
        model: 'deepseek-v4-flash',
        language: '简体中文',
        documentTitle: 'Formula study',
        status: 'failed',
        promptVersion: 4,
        documentVersion: 2,
        concurrency: 2,
        error: '模型遗漏或重复了原文公式。',
        updatedAt: Date.now(),
        chunks: Array.from({ length: 14 }, (_, i) => ({
          page: i + 1,
          input:
            i === 4
              ? `The ratio is\n\n\\[${equation}\\]\n\nwhere the parameters are fixed.`
              : `Source paragraph ${i + 1}.`,
          ...(i < 4 ? { output: `原有译文 ${i + 1}。`, timing: { queueMs: 0, totalMs: 100 } } : {}),
        })),
      })
    },
    { endpoint, equation },
  )

  let repairs = 0
  const requested: string[] = []
  await page.route(endpoint + '/chat/completions', async (route) => {
    const input = route.request().postDataJSON().messages.at(-1).content as string
    let content: string
    if (input.includes('REPAIR_JSON:\n')) {
      repairs++
      const payload = JSON.parse(input.split('REPAIR_JSON:\n')[1].split('\nEND_REPAIR_JSON')[0])
      const segments = payload.blocks.flat().filter((part: { id?: string }) => part.id)
      content = JSON.stringify({
        translations: segments.map((part: { id: string; text: string }) => ({
          id: part.id,
          text: part.text.includes('ratio') ? '比值为' : '其中参数固定。',
        })),
      })
    } else {
      const { text } = JSON.parse(input.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0])
      requested.push(text)
      content = text.includes('ratio')
        ? '比值为，其中参数固定。'
        : text.replace('Source paragraph', '续译段落')
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    })
  })

  await page.getByRole('button', { name: 'AI 工作台', exact: true }).click()
  const job = page.locator('.job-card').filter({ hasText: 'deepseek-v4-flash' })
  await expect(job).toContainText('4 / 14')
  await job.getByRole('button', { name: /继续/ }).click()
  await expect(job).toContainText('14 / 14')
  await expect(job).toContainText('已完成')
  expect(repairs).toBe(1)
  expect(requested).toHaveLength(10)
  expect(requested.some((text) => /^Source paragraph [1-4]\.$/.test(text))).toBe(false)

  await job.getByRole('button', { name: '查看结果' }).click()
  const result = page.locator('.reading-paper')
  await expect(result.locator('.katex-display')).toHaveCount(1)
  await expect(result.locator('.katex-error')).toHaveCount(0)
  await expect(result.locator('annotation[encoding="application/x-tex"]')).toHaveText(equation)
  await page.getByRole('button', { name: '导出', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'MD 开放的 Markdown' }).click()
  const file = testInfo.outputPath('complete.md')
  await (await download).saveAs(file)
  const markdown = await readFile(file, 'utf8')
  expect(markdown).toContain(
    `原有译文 4。\n\n比值为\n\n$$\n${equation}\n$$\n\n其中参数固定。\n\n续译段落 6.`,
  )
  expect(markdown.trimEnd()).toMatch(/续译段落 14\.$/)
  expect(markdown).not.toMatch(/PRM_|未完成的正文|REPAIR_JSON/)
})
