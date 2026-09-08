import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

test('exports Chinese, quotes, tables, images and equations into actual PDF and Word', async ({
  page,
}) => {
  test.setTimeout(120000)
  await mkdir('.tmp/export-015', { recursive: true })
  const markdown =
    '# 文献阅读 · 导出验收\n\n这是一份包含中文与 English 的研究笔记。\n\n> Original evidence is preserved.\n\n原文逐段对照译文，保留关键证据。\n\n## 表格与公式\n\n| 方法 | 准确率 |\n| --- | --- |\n| 基线 | 82.4% |\n| 改进方法 | 91.6% |\n\n行内公式 $E=mc^2$ 对应能量。\n\n$$\n\\frac{a+b}{c} + \\sqrt{x^2+y^2} = \\sum_{i=1}^{n} i\n$$\n\n$$\nA=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n$$\n\n- 保留引用\n- 输出可编辑文档\n'
  const result = await page.evaluate(async (markdown) => {
    const load = (p: string) => import(/* @vite-ignore */ p)
    const { addAttachment } = await load('/src/lib/note-library.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 120
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e7eee3'
    ctx.fillRect(0, 0, 600, 120)
    ctx.fillStyle = '#365d48'
    ctx.font = '24px sans-serif'
    ctx.fillText('Figure 1 · Export validation', 30, 65)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const content =
      markdown + '\n' + (await addAttachment(new File([blob], 'figure.png', { type: 'image/png' })))
    const { pdfBlob } = await load('/src/lib/export-pdf.ts'),
      { docxBlob } = await load('/src/lib/export-docx.ts')
    return {
      pdf: Array.from(new Uint8Array(await (await pdfBlob('导出验收', content)).arrayBuffer())),
      docx: Array.from(new Uint8Array(await (await docxBlob('导出验收', content)).arrayBuffer())),
    }
  }, markdown)
  await writeFile('.tmp/export-015/review.pdf', Buffer.from(result.pdf))
  await writeFile('.tmp/export-015/review.docx', Buffer.from(result.docx))
  expect(Buffer.from(result.pdf).subarray(0, 5).toString()).toBe('%PDF-')
  const zip = await JSZip.loadAsync(Buffer.from(result.docx)),
    xml = await zip.file('word/document.xml')!.async('string')
  expect(xml).toContain('<w:tbl>')
  expect(xml).toContain('<m:f>')
  expect(xml).toContain('<m:rad>')
  expect(xml).toContain('<m:m>')
  expect(xml).toContain('91.6%')
  expect(xml).toContain('w:drawing')
  expect(xml).not.toContain('\\frac')
  expect(xml).not.toContain('<undefined>')
})

test('offline OCR reads a real scanned PDF and resumes saved pages into one document', async ({
  page,
}) => {
  test.setTimeout(120000)
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 1600
    const x = c.getContext('2d')!
    x.fillStyle = 'white'
    x.fillRect(0, 0, c.width, c.height)
    x.fillStyle = 'black'
    x.font = 'bold 40px Arial'
    x.fillText('SCANNED RESEARCH PAPER', 90, 170)
    x.font = '30px Arial'
    x.fillText('Optical recognition preserves research evidence.', 90, 270)
    x.fillText('The measured accuracy was 91.6 percent.', 90, 340)
    return c.toDataURL('image/png').split(',')[1]
  })
  const pdf = await PDFDocument.create(),
    image = await pdf.embedPng(Buffer.from(png, 'base64'))
  pdf.setTitle('Scanned OCR Study')
  for (let i = 0; i < 2; i++)
    pdf.addPage([600, 800]).drawImage(image, { x: 0, y: 0, width: 600, height: 800 })
  await page.getByLabel('选择 PDF 文献').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Scanned OCR Study', exact: true }).click()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: '扫描件与版面识别', exact: true }).click()
  await page.getByLabel('识别语言').selectOption('eng')
  await page.getByRole('button', { name: '开始识别', exact: true }).click()
  await expect(page.locator('.job-card').filter({ hasText: '本地 OCR 识别' })).toContainText(
    '已完成',
    { timeout: 90000 },
  )
  const state = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p)
    const { db } = await load('/src/lib/db.ts')
    const job = (await db.jobs.toArray()).find((j: any) => j.recognition)
    const pages = await db.pages.where('paperId').equals(job.paperId).toArray()
    const { jobMarkdown, runJob } = await load('/src/lib/ai.ts')
    const first = job.chunks[0].output
    job.chunks[1].output = undefined
    await db.jobs.update(job.id, { status: 'cancelled', chunks: job.chunks })
    await runJob(job.id)
    const resumed = await db.jobs.get(job.id)
    return {
      firstKept: first === resumed.chunks[0].output,
      markdown: jobMarkdown(resumed),
      pages: pages.map((p: any) => p.text),
      attachments: await db.attachments.count(),
      status: resumed.status,
    }
  })
  expect(state.firstKept).toBe(true)
  expect(state.status).toBe('completed')
  expect(state.pages.every((p: string) => p.includes('91.6'))).toBe(true)
  expect(state.markdown).toContain('Optical recognition')
  expect(state.attachments).toBe(3)
  expect(state.markdown).not.toMatch(/^#.*第.*页/m)
  await page.screenshot({ path: '.tmp/ocr-015.png', fullPage: true })
})

test('note folders, tags, history, image export and recovery preview protect existing content', async ({
  page,
}) => {
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByRole('button', { name: '新建笔记', exact: true }).click()
  await page.getByLabel('笔记标题').fill('带图笔记')
  await page.getByLabel('Markdown 笔记正文').fill('# 证据\n\n保留这段原始记录。')
  await expect(page.locator('.save-state')).toContainText('已保存')
  await page.getByRole('button', { name: '管理文件夹' }).click()
  await page.getByLabel('新文件夹名称').fill('课题资料')
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click()
  await page
    .getByRole('dialog', { name: '笔记文件夹', exact: true })
    .getByLabel('关闭', { exact: true })
    .click()
  await page.getByLabel('笔记标签', { exact: true }).fill('证据, 实验')
  await page.getByLabel('笔记标签', { exact: true }).blur()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
    'base64',
  )
  await page
    .getByLabel('插入笔记图片')
    .setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: png })
  await expect(page.locator('.markdown-preview-pane img')).toBeVisible()
  await expect(page.locator('.save-state')).toContainText('已保存')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /批量导出/ }).click()
  const file = await download
  await file.saveAs('.tmp/note-images-015.zip')
  const zip = await JSZip.loadAsync(await readFile('.tmp/note-images-015.zip'))
  expect(
    Object.keys(zip.files).some((f) => f.startsWith('attachments/') && f.endsWith('.png')),
  ).toBe(true)
  expect(Object.keys(zip.files).some((f) => f.startsWith('课题资料/') && f.endsWith('.md'))).toBe(
    true,
  )
  await page.getByRole('button', { name: /历史版本（/ }).click()
  await expect(page.getByLabel('选择笔记历史版本').locator('option')).not.toHaveCount(1)
  await page
    .getByRole('dialog', { name: '笔记历史版本' })
    .getByLabel('关闭', { exact: true })
    .click()
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByRole('button', { name: '数据与备份', exact: true }).click()
  await page.getByRole('button', { name: '立即创建快照' }).click()
  await expect(page.locator('.snapshot-row')).toHaveCount(1)
  await page.getByRole('button', { name: '预览恢复', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '恢复备份预览' })).toContainText('带图笔记')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.snapshot-row')).toHaveCount(1)
  await page.screenshot({ path: '.tmp/backups-015.png', fullPage: true })
})

test('citation import and DOI preview require explicit application and can attach a PDF', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.getByRole('button', { name: '引用导入 / 导出' }).click()
  await page.getByLabel('导入引用文件').setInputFiles({
    name: 'references.bib',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '@article{study,title={Citation Only Study},author={Smith, Jane},year={2020},doi={10.1234/example}}',
    ),
  })
  await page.getByRole('button', { name: '确认导入引用' }).click()
  await expect(page.locator('.paper-card')).toHaveCount(7)
  await page.getByRole('button', { name: '阅读 Citation Only Study', exact: true }).click()
  await expect(page.locator('.reference-notice')).toContainText('只有引用信息')
  await page.getByLabel('编辑文献信息').click()
  await page.route('https://api.crossref.org/works/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: {
          title: ['DOI Verified Study'],
          author: [{ given: 'Jane', family: 'Smith' }],
          'published-print': { 'date-parts': [[2022]] },
          'container-title': ['Test Journal'],
        },
      }),
    }),
  )
  await page.getByRole('button', { name: '根据 DOI 补全' }).click()
  await expect(page.getByRole('dialog', { name: 'DOI 信息预览' })).toContainText(
    'DOI Verified Study',
  )
  await page.getByRole('button', { name: '应用 DOI 信息' }).click()
  await page.getByLabel('我已核对这些文献元数据').check()
  await page.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect(page.locator('.reader-heading')).toContainText('DOI Verified Study')
  await page.getByLabel('编辑文献信息').click()
  const pdf = await PDFDocument.create()
  pdf.addPage()
  await page.getByLabel('为引用附加 PDF').setInputFiles({
    name: 'attached.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.reference-notice')).toHaveCount(0)
  await expect(page.locator('.pdf-surface canvas')).toBeVisible()
})

test('vision parsing sends a page image, preserves completed pages on rate limits and retries', async ({
  page,
}) => {
  test.setTimeout(90000)
  let requests = 0
  await page.route('https://vision.example.test/v1/chat/completions', async (route) => {
    const data = route.request().postDataJSON()
    expect(data.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
    expect(data.messages[0].content).toContain('Never summarize')
    requests++
    if (requests === 1)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '# Recognized table\n\n| Method | Value |\n| --- | --- |\n| Baseline | 91.6 |\n\n$$x^2$$',
              },
            },
          ],
        }),
      })
    else if (requests === 2)
      await route.fulfill({ status: 429, contentType: 'application/json', body: '{}' })
    else
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'Continued content' } }],
        }),
      })
  })
  const pdf = await PDFDocument.create()
  pdf.setTitle('Vision fixture')
  pdf.addPage()
  pdf.addPage()
  await page.getByLabel('选择 PDF 文献').setInputFiles({
    name: 'vision.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(page.locator('.paper-card')).toHaveCount(7)
  const state = await page.evaluate(async () => {
    const load = (p: string) => import(/* @vite-ignore */ p),
      { db } = await load('/src/lib/db.ts'),
      { createRecognition } = await load('/src/lib/recognition.ts'),
      { defaultSettings, setSessionKey, runJob, jobMarkdown } = await load('/src/lib/ai.ts')
    const paper = await db.papers.filter((p: any) => p.title === 'Vision fixture').first(),
      config = {
        ...defaultSettings,
        model: 'vision',
        baseUrl: 'https://vision.example.test/v1',
        stream: false,
      }
    setSessionKey('fixture-key', config)
    const job = await createRecognition(
      paper.id,
      config,
      { engine: 'vision', language: 'eng', keepImages: false },
      1,
      2,
      false,
    )
    await runJob(job.id)
    const failed = await db.jobs.get(job.id)
    await runJob(job.id)
    const completed = await db.jobs.get(job.id)
    return {
      failed: failed.status,
      done: failed.chunks.filter((c: any) => c.output).length,
      status: completed.status,
      markdown: jobMarkdown(completed),
      same: failed.chunks[0].output === completed.chunks[0].output,
    }
  })
  expect(state).toMatchObject({ failed: 'failed', done: 1, status: 'completed', same: true })
  expect(state.markdown).toContain('| Baseline | 91.6 |')
  expect(requests).toBe(3)
})
