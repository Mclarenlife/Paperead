import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

test('library actions, search reset, selected-only batch management, ZIP export and recycle undo', async ({
  page,
}) => {
  await page.getByLabel('搜索文献').fill('Vaswani')
  await expect(page.locator('.section-heading .count-badge').first()).toHaveText('1')
  await page.getByLabel('搜索文献').fill('no_such_paper')
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await expect(page.getByLabel('搜索文献')).toHaveValue('')
  await expect(page.locator('.paper-card')).toHaveCount(6)
  await page.getByLabel('更多操作 Attention Is All You Need', { exact: true }).click()
  await page.getByRole('menuitem', { name: '编辑文献信息', exact: true }).click()
  await page.getByRole('dialog', { name: '文献信息' }).getByLabel('来源 / 期刊').fill('Audit venue')
  await page.getByRole('button', { name: '保存更改', exact: true }).click()
  await expect(
    page.locator('.paper-card').filter({ hasText: 'Attention Is All You Need' }),
  ).toContainText('Audit venue')
  await page.locator('.paper-card').nth(0).getByRole('checkbox').check()
  await page.locator('.paper-card').nth(1).getByRole('checkbox').check()
  await expect(page.locator('.bulk-toolbar')).toContainText('已选择 2 篇')
  await page.locator('.bulk-toolbar').getByRole('button', { name: '修改标签', exact: true }).click()
  await page.getByLabel('标签操作').selectOption('replace')
  await page.getByLabel('标签（逗号分隔）').fill('本次研究, 精读')
  await page.getByRole('button', { name: '应用到所选文献', exact: true }).click()
  await expect(page.locator('.paper-card').filter({ hasText: '本次研究' })).toHaveCount(2)
  await page.getByLabel('批量阅读状态').selectOption('finished')
  await expect(page.locator('.paper-selected .status')).toHaveText(['已读完', '已读完'])
  await page
    .locator('.bulk-toolbar')
    .getByRole('button', { name: '移动到文献集', exact: true })
    .click()
  await page.getByLabel('目标文献集').selectOption({ index: 1 })
  await page.getByRole('button', { name: '应用到所选文献', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '批量导出', exact: true }).click()
  await (await downloading).saveAs('.tmp/selected-papers.zip')
  const zip = await JSZip.loadAsync(await readFile('.tmp/selected-papers.zip'))
  const metadata = JSON.parse(await zip.file('文献信息.json')!.async('string'))
  expect(metadata).toHaveLength(2)
  expect(metadata.every((paper: { status: string }) => paper.status === 'finished')).toBe(true)
  expect(Object.keys(zip.files).filter((name) => name.endsWith('.md'))).toHaveLength(2)
  await page.screenshot({
    path: '.tmp/library-batch-013.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page
    .locator('.bulk-toolbar')
    .getByRole('button', { name: '移入回收站', exact: true })
    .click()
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click()
  await expect(page.locator('.paper-card')).toHaveCount(4)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.paper-card')).toHaveCount(6)
  await page.reload()
  await expect(page.locator('.paper-card')).toHaveCount(6)
})

test('annotations and notes can be undone, restored and permanently removed from recycle bin', async ({
  page,
}) => {
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page
    .locator('.reading-paper .markdown p')
    .first()
    .evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await page.locator('.reading-paper .markdown').dispatchEvent('mouseup')
  await page.getByLabel('批注内容').fill('可恢复的批注')
  await page.getByRole('button', { name: '保存批注', exact: true }).click()
  await page.getByLabel('删除批注', { exact: true }).click()
  await expect(page.locator('.annotation-card')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.annotation-card')).toHaveCount(1)
  await page.getByLabel('返回文献库').click()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.getByLabel('删除笔记').click()
  await page
    .locator('.inline-confirm')
    .getByRole('button', { name: '移入回收站', exact: true })
    .click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.trash-row')).toHaveCount(1)
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.locator('.trash-row')).toHaveCount(0)
  await page.getByRole('button', { name: '全部文献', exact: false }).first().click()
  await page.getByLabel('更多操作 Attention Is All You Need', { exact: true }).click()
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.screenshot({
    path: '.tmp/recycle-bin-013.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '全部文献', exact: false }).first().click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await expect(page.locator('.annotation-card')).toContainText('可恢复的批注')
  await page.getByLabel('返回文献库').click()
  await page.getByLabel('更多操作 Attention Is All You Need', { exact: true }).click()
  await page.getByRole('menuitem', { name: '移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '确认移入回收站', exact: true }).click()
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await page.getByRole('button', { name: '清空回收站', exact: true }).click()
  await page.getByRole('button', { name: '确认彻底删除', exact: true }).click()
  await expect(page.locator('.trash-row')).toHaveCount(0)
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('笔记标题')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开关联文献' })).toHaveCount(0)
})

test('failed note saves keep persistent drafts, guard navigation and recover after reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('笔记标题')).toBeVisible()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'notes') throw new DOMException('Test quota full', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await page.getByLabel('Markdown 笔记正文').fill('# 重要草稿\n\n写入失败也要保留。')
  await expect(page.getByRole('alert')).toContainText('笔记保存失败')
  await expect(page.locator('.save-state')).toContainText('保存失败')
  await page.getByRole('button', { name: '全部文献', exact: false }).first().click()
  await expect(page.getByRole('dialog', { name: '笔记尚未保存' })).toBeVisible()
  await page.getByRole('button', { name: '保留草稿并离开', exact: true }).click()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/写入失败也要保留/)
  page.once('dialog', (dialog) => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/写入失败也要保留/)
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.locator('.save-state')).toContainText('已保存到本地')
  await page.reload()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await expect(page.getByLabel('Markdown 笔记正文')).toHaveValue(/写入失败也要保留/)
})

test('second window cannot change live AI status and can take over after the owner closes', async ({
  page,
  context,
}) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await context.route('http://127.0.0.1:19992/v1/chat/completions', async (route) => {
    await held
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: 'Completed translation.' }, finish_reason: 'stop' }],
        }),
      })
      .catch(() => {})
  })
  await page.getByRole('button', { name: '偏好设置', exact: false }).click()
  await page.getByLabel('API 地址').fill('http://127.0.0.1:19992/v1')
  await page.getByLabel('模型 ID').fill('lock-test')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '阅读 Attention Is All You Need', exact: true }).click()
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await page.getByRole('button', { name: '开始翻译', exact: false }).click()
  await expect(page.locator('.job-card')).toContainText('处理中')
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.getByRole('heading', { name: '资料库已在另一窗口打开' })).toBeVisible()
  await expect(page.locator('.job-card')).toContainText('处理中')
  release()
  await expect(page.locator('.job-card')).toContainText('已完成')
  await page.close()
  await second.getByRole('button', { name: '重新打开' }).click()
  await expect(second.locator('.paper-card')).toHaveCount(6)
})

test('batch controls and quick menu remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.paper-card').first().getByRole('checkbox').check()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page
    .locator('.paper-card')
    .first()
    .getByRole('button', { name: /更多操作/ })
    .click()
  await expect(page.getByRole('menu')).toBeInViewport()
  const menu = await page.getByRole('menu').boundingBox()
  expect(menu!.x).toBeGreaterThanOrEqual(0)
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: '.tmp/library-mobile-013.png',
    fullPage: true,
    animations: 'disabled',
  })
})
