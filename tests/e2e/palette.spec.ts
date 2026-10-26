import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('key text retains contrast in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.paper-card')).toHaveCount(6)
  const reports: unknown[] = []
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: '偏好设置', exact: true }).click()
      await page.getByRole('button', { name: '外观', exact: true }).click()
      await page.getByRole('button', { name: '夜读', exact: true }).click()
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
      await expect(page.locator('.main-navigation > .active')).toHaveCSS(
        'color',
        'rgb(194, 230, 255)',
      )
    }
    const pairs = await page.evaluate(() => {
      const background = (element: Element | null): string => {
        while (element) {
          const value = getComputedStyle(element).backgroundColor
          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value
          element = element.parentElement
        }
        return 'rgb(255, 255, 255)'
      }
      return [
        '.paper-title',
        '.paper-authors',
        '.paper-footer',
        '.main-navigation > .active',
        '.status-reading',
        '.status-finished',
        '.paper-tags .tag',
        '.sidebar-section-label',
      ].map((selector) => {
        const element = document.querySelector(selector)!
        return {
          selector,
          foreground: getComputedStyle(element).color,
          background: background(element),
        }
      })
    })
    function luminance(color: string) {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((value) => {
          const x = Number(value) / 255
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    for (const pair of pairs) {
      const a = luminance(pair.foreground),
        b = luminance(pair.background)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      reports.push({ theme, ...pair, ratio })
      expect(ratio, `${theme}: ${pair.selector}`).toBeGreaterThanOrEqual(4.5)
    }
    await page.screenshot({
      path: `.tmp/palette-0.1.11-${theme}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  await writeFile('.tmp/palette-0.1.11-contrast.json', JSON.stringify(reports, null, 2))
})
