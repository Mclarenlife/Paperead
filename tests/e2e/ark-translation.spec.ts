import { test, expect } from '@playwright/test'

test('resumes an Ark translation and finishes an oversized batch as smaller passages', async ({
  page,
}) => {
  const endpoint = 'https://ark.cn-beijing.volces.com/api/v3'
  const model = 'doubao-seed-2-1-turbo-260628'
  const calls: string[] = []
  await page.route(endpoint + '/**', async (route) => {
    const body = route.request().postDataJSON()
    expect(route.request().url()).toBe(endpoint + '/chat/completions')
    expect(body.model).toBe(model)
    expect(body.thinking).toEqual({ type: 'disabled' })
    const source = JSON.parse(
      body.messages.at(-1).content.split('SOURCE_JSON:\n')[1].split('\nEND_SOURCE_JSON')[0],
    ).text as string
    calls.push(source)
    if (source.includes('Methods') && source.includes('Results')) {
      await route.fulfill({ status: 413, contentType: 'application/json', body: '{}' })
      return
    }
    const translated = source.includes('Methods') ? '方法部分译文。' : '结果部分译文。'
    const token = source.match(/\[\[PRM_\w+\]\]/)?.[0] || ''
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        'data: ' +
        JSON.stringify({
          choices: [{ delta: { content: translated + token }, finish_reason: 'stop' }],
        }) +
        '\n\n',
    })
  })
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('API 地址').fill(endpoint + '/chat/completions')
  await page.getByLabel('模型 ID').fill(model)
  await page.locator('input[type=password]').fill('local-browser-test')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('AI 配置已保存')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(
    async ({ endpoint, model }) => {
      const path = '/src/lib/db.ts'
      const { db } = await import(/* @vite-ignore */ path)
      await db.jobs.add({
        id: 'ark-resume',
        paperId: 'sample-0',
        kind: 'translation',
        model,
        baseUrl: endpoint,
        provider: 'compatible',
        language: '简体中文',
        documentVersion: 2,
        promptVersion: 4,
        status: 'failed',
        updatedAt: Date.now(),
        batchSize: 6000,
        chunks: [
          { page: 1, input: 'Checkpointed abstract.', output: '此前已保存的摘要。' },
          {
            page: 2,
            endPage: 3,
            input:
              'Methods. ' +
              'We measured both samples once per minute. '.repeat(45) +
              '\n\nResults. ' +
              'The observed values were stable. '.repeat(50) +
              'The median is $m_i$.',
          },
        ],
      })
    },
    { endpoint, model },
  )
  await page.getByRole('button', { name: 'AI 工作台', exact: true }).click()
  const job = page.locator('.job-card').filter({ hasText: model })
  await job.getByRole('button', { name: '继续', exact: true }).click()
  await expect(job).toContainText('已完成')
  expect(calls).toHaveLength(3)
  expect(calls.every((source) => !source.includes('Checkpointed abstract.'))).toBe(true)
  await job.getByRole('button', { name: '查看结果' }).click()
  const result = page.locator('.reading-paper')
  await expect(result).toContainText(/此前已保存的摘要。\s*方法部分译文。\s*结果部分译文。/)
  await expect(result.locator('annotation[encoding="application/x-tex"]')).toHaveText('m_i')
})
