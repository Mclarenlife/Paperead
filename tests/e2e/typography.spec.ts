import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function inspect(page: Page, scope: string, selectors: [string, number][]) {
  for (const [selector] of selectors)
    await page.locator(selector).first().waitFor({ state: 'attached' })
  const metrics = await page.evaluate((selectors) => {
    function luminance(color: string) {
      const [r, g, b] = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((value) => {
          const x = Number(value) / 255
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
      return r * 0.2126 + g * 0.7152 + b * 0.0722
    }
    return selectors.map(([selector, minimum]) => {
      const element = document.querySelector(selector)!
      if (!element) throw new Error(`Missing text: ${selector}`)
      const style = getComputedStyle(element)
      let parent: Element | null = element
      let background = 'rgb(255, 255, 255)'
      while (parent) {
        const value = getComputedStyle(parent).backgroundColor
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
          background = value
          break
        }
        parent = parent.parentElement
      }
      const a = luminance(style.color),
        b = luminance(background)
      return {
        selector,
        minimum,
        fontSize: parseFloat(style.fontSize),
        fontFamily: style.fontFamily,
        lineHeight: style.lineHeight,
        color: style.color,
        background,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      }
    })
  }, selectors)
  for (const metric of metrics) {
    expect(metric.fontSize, `${scope}: ${metric.selector} legibility`).toBeGreaterThanOrEqual(
      metric.minimum,
    )
    expect(metric.contrast, `${scope}: ${metric.selector} contrast`).toBeGreaterThanOrEqual(4.5)
  }
  await writeFile(`.tmp/typography-0.1.11-${scope}.json`, JSON.stringify(metrics, null, 2))
}

async function fitViewport(page: Page, selector: string) {
  const rect = await page.locator(selector).boundingBox()
  expect(rect).not.toBeNull()
  expect(rect!.x).toBeGreaterThanOrEqual(-1)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  )
}

for (const theme of ['light', 'dark']) {
  test(`reader, notes and settings remain legible in ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('.paper-card')).toHaveCount(6)
    if (theme === 'dark') {
      await page.getByRole('button', { name: '偏好设置', exact: true }).click()
      await page.getByRole('button', { name: '外观', exact: true }).click()
      await page.getByRole('button', { name: '夜读', exact: true }).click()
      await page.getByRole('button', { name: '关闭', exact: true }).click()
    }
    await page.locator('.paper-title').first().click()
    await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
    await inspect(page, `reader-${theme}`, [
      ['.pane-heading', 13],
      ['.reader-view-switch > button', 14],
      ['.reading-paper .markdown p', 18],
      ['.ai-action-card h4', 16],
      ['.ai-action-card p', 13],
      ['.ai-service small', 13],
    ])
    await fitViewport(page, '.reader-overlay')
    await page.screenshot({ path: `.tmp/reader-0.1.11-${theme}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '返回文献库', exact: true }).click()
    await page.getByRole('button', { name: '我的笔记', exact: true }).click()
    await expect(page.getByLabel('Markdown 笔记正文')).toBeVisible()
    await inspect(page, `notes-${theme}`, [
      ['.note-list-item b', 16],
      ['.note-list-item p', 13],
      ['.note-search input', 15],
      ['.markdown-edit-pane textarea', 16],
      ['.markdown-preview-pane .markdown p', 18],
      ['.note-statusbar', 12],
      ['.segmented > button.active', 14],
    ])
    await fitViewport(page, '.notes-page')
    const notes = await page.locator('.notes-page').boundingBox()
    expect(notes!.y + notes!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
    await page.screenshot({ path: `.tmp/notes-0.1.11-${theme}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect(page.locator('.ai-settings-form')).not.toBeDisabled()
    await inspect(page, `settings-${theme}`, [
      ['.modal-heading h2', 20],
      ['.settings-tabs > button', 14],
      ['.field', 14],
      ['.field input', 15],
      ['.field-hint', 13],
      ['.provider-options > button.active', 14],
      ['.privacy-note p', 13],
    ])
    await fitViewport(page, '.settings-modal')
    await page.screenshot({ path: `.tmp/settings-0.1.11-${theme}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '数据与备份', exact: true }).click()
    await page.screenshot({ path: `.tmp/backup-0.1.11-${theme}.png`, animations: 'disabled' })
  })
}

test('mobile text and controls fit reader, notes and settings without shrinking fonts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('.paper-title').first().click()
  await inspect(page, 'reader-mobile', [
    ['.reading-paper .markdown p', 17],
    ['.reader-view-switch > button', 14],
  ])
  await fitViewport(page, '.reader-toolbar')
  await expect(page.getByLabel('下一页', { exact: true })).toHaveCSS('min-height', '44px')
  await page.screenshot({ path: '.tmp/reader-0.1.11-mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'AI 阅读助手', exact: true }).click()
  await fitViewport(page, '.reader-side')
  const body = await page.locator('.reader-body').boundingBox()
  const side = await page.locator('.reader-side').boundingBox()
  expect(side!.y).toBeGreaterThanOrEqual(body!.y)
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  await page.locator('.sidebar-toggle').click()
  await page.getByRole('button', { name: '我的笔记', exact: true }).click()
  await page.locator('.note-list-item').first().click()
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await inspect(page, 'notes-mobile', [
    ['.markdown-preview-pane .markdown p', 17],
    ['.note-statusbar', 12],
  ])
  await fitViewport(page, '.note-editor-toolbar')
  expect(
    await page
      .locator('.note-editor-toolbar')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: '.tmp/notes-0.1.11-mobile.png', animations: 'disabled' })
  await page.locator('.sidebar-toggle').click()
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await inspect(page, 'settings-mobile', [
    ['.field input', 16],
    ['.field-hint', 13],
    ['.provider-options > button.active', 14],
  ])
  await fitViewport(page, '.settings-modal')
  expect(
    await page.locator('.settings-modal').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  await page.getByRole('button', { name: '保存配置', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeInViewport()
  await page.screenshot({ path: '.tmp/settings-0.1.11-mobile.png', animations: 'disabled' })
})

test('enlarging text to 200 percent retains settings controls and document content', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px'
  })
  await page.locator('.paper-title').first().click()
  await expect
    .poll(() =>
      page
        .locator('.reading-paper .markdown')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    )
    .toBeGreaterThanOrEqual(36)
  await fitViewport(page, '.reader-toolbar')
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  await fitViewport(page, '.settings-modal')
  expect(
    await page.locator('.settings-modal').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true)
  await page.getByRole('button', { name: '保存配置', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeInViewport()
  await page.screenshot({ path: '.tmp/settings-0.1.11-200percent.png', animations: 'disabled' })
})
