import { chromium } from 'playwright'

const errs = []
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text())
})
await p.goto('https://alexsopa.github.io/strat-execution-practice/', { waitUntil: 'networkidle' })
await p.waitForSelector('text=Execution Practice', { timeout: 30000 })
for (let i = 0; i < 3; i++) await p.click('button:has-text("Step")')
await p.screenshot({ path: 'scripts/shots/live.png' })
await b.close()
if (errs.length) {
  console.log('ERRORS:', errs.join('; '))
  process.exit(1)
}
console.log('LIVE SITE OK')
