import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
await mkdir('.tmp', { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
})
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
await page.goto('http://127.0.0.1:1420')
await page.getByRole('heading', { name: '全部文献' }).waitFor()
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: '.tmp/library-desktop.png', fullPage: true, animations: 'disabled' })
console.log(
  JSON.stringify({
    title: await page.title(),
    cards: await page.locator('.paper-card').count(),
    errors,
  }),
)
await page.setViewportSize({ width: 390, height: 844 })
await page.screenshot({ path: '.tmp/library-mobile.png', fullPage: true, animations: 'disabled' })
console.log(
  JSON.stringify({
    mobileWidth: await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
    })),
  }),
)
await browser.close()
