import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = `http://localhost:${process.env.PORT ?? '5174'}/strat-execution-practice/`
const OUT = 'scripts/shots'
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
page.on('pageerror', (err) => errors.push(String(err)))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Execution Practice', { timeout: 20000 })

// --- Replay tab: step a few bars, place a long, screenshot ---
await page.waitForSelector('text=Order ticket')
for (let i = 0; i < 5; i++) await page.click('button:has-text("Next bar")')
// Live tick playback: let a bar develop on screen, pause mid-bar.
await page.click('.transport button:has-text("Play")')
await page.waitForTimeout(1600)
await page.click('.transport button:has-text("Pause")')
await page.screenshot({ path: `${OUT}/replay-developing.png` })
await page.click('button:has-text("Place long")')
for (let i = 0; i < 10; i++) await page.click('button:has-text("Next bar")')
await page.screenshot({ path: `${OUT}/replay.png` })

// If we got into a trade, try trailing + flatten to exercise the panel.
const trail = page.locator('button:has-text("Trail stop")')
if (await trail.count()) {
  if (await trail.isEnabled()) await trail.click()
  await page.click('button:has-text("Flatten")')
  await page.screenshot({ path: `${OUT}/replay-after-trade.png` })
}

// Hotkey market orders: buy 2 units, net down 1, flatten — P&L window updates.
await page.keyboard.press('b')
await page.keyboard.press('b')
await page.waitForSelector('text=Lots')
await page.keyboard.press('s')
await page.keyboard.press('f')
await page.waitForSelector('text=Order ticket')
await page.screenshot({ path: `${OUT}/replay-hotkeys.png` })

// Auto-stop + drag: market buy attaches a stop; grab the line and drag it.
await page.keyboard.press('b')
await page.waitForSelector('text=Lots')
const tradeCard = page.locator('.side-panel .card').nth(1)
const stopBefore = await tradeCard.locator('.stat-grid strong').first().innerText()
if (stopBefore === '—') throw new Error('market entry did not auto-attach a stop')
const chartBox = await page.locator('.chart-panel').boundingBox()
const dragX = chartBox.x + chartBox.width * 0.5
let grabY = null
for (let y = chartBox.y + 8; y < chartBox.y + 470; y += 3) {
  await page.mouse.move(dragX, y)
  const grabbing = await page.evaluate(
    () => [...document.querySelectorAll('.chart-panel div')].some((d) => d.style.cursor === 'ns-resize'),
  )
  if (grabbing) {
    grabY = y
    break
  }
}
if (grabY === null) throw new Error('never found the draggable stop line hover zone')
await page.mouse.down()
// Drag DOWN: lowering a long stop is never clamped, so the move always sticks.
await page.mouse.move(dragX, grabY + 45, { steps: 6 })
await page.mouse.up()
const stopAfter = await tradeCard.locator('.stat-grid strong').first().innerText()
if (stopAfter === stopBefore) throw new Error(`drag did not move the stop (still ${stopAfter})`)
console.log(`drag OK: stop ${stopBefore} -> ${stopAfter}`)
await page.screenshot({ path: `${OUT}/replay-dragged-stop.png` })
await page.keyboard.press('f')

// --- Quiz tab: answer one question end to end ---
await page.click('button:has-text("Pattern quiz")')
await page.waitForSelector("text=What's armed")
await page.screenshot({ path: `${OUT}/quiz.png` })
await page.click('button:has-text("2-1-2 reversal")')
const side = page.locator('button:has-text("Long — buy the break")')
if (await side.count()) {
  await side.click()
  await page.waitForSelector('text=Click the trigger level')
  const box = await page.locator('.quiz-layout .panel').boundingBox()
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4)
}
await page.waitForSelector('text=Next question')
await page.screenshot({ path: `${OUT}/quiz-reveal.png` })

// --- Stats tab ---
await page.click('button:has-text("My stats")')
await page.waitForSelector('text=Pattern recognition')
await page.screenshot({ path: `${OUT}/stats.png` })

await browser.close()
if (errors.length) {
  console.log('CONSOLE/PAGE ERRORS:')
  for (const e of errors) console.log(' -', e)
  process.exit(1)
}
console.log('SMOKE OK — no console or page errors')
