import { mulberry32 } from './rng'

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/**
 * Agent-based market simulation: ~100 simple seeded traders submit orders
 * each tick and their NET FLOW moves price through a liquidity-dependent
 * impact function. Realism is emergent, not scripted:
 *
 * - momentum traders chase recent returns → trends, stair-stepping runs
 * - mean reverters fade deviation from a slowly drifting fair value →
 *   pullbacks, chop, magnitude reversals
 * - breakout traders fire bursts through the recent channel extremes →
 *   triggers pop the way real stops do
 * - noise traders provide background flow
 * - liquidity thins when volatility rises → volatility clustering
 *
 * The tick stream is continuous, so bars aggregated from it can never gap.
 */
export function simulateTicks(seed: number, nTicks: number, startPrice = 100): number[] {
  const rng = mulberry32(seed)
  const randn = () => {
    const u = Math.max(rng(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
  }

  interface Ctx {
    price: number
    ret: number
    history: number[]
  }
  interface Trader {
    size: number
    desire: (c: Ctx) => number
  }

  let fairValue = startPrice
  let drift = 0
  let nextDriftChange = 0

  const traders: Trader[] = []

  // Momentum followers — chase the smoothed recent return.
  for (let i = 0; i < 30; i++) {
    const alpha = 0.04 + rng() * 0.2
    const gain = 0.6 + rng()
    const size = 0.5 + rng()
    let ema = 0
    traders.push({
      size,
      desire: (c) => {
        ema = ema * (1 - alpha) + c.ret * alpha
        return clamp((ema / 0.0006) * gain, -1, 1)
      },
    })
  }

  // Mean reverters — fade deviation from their view of fair value.
  for (let i = 0; i < 25; i++) {
    const gain = 0.5 + rng()
    const size = 0.5 + rng()
    const offset = 1 + (rng() - 0.5) * 0.01
    traders.push({
      size,
      desire: (c) => clamp(((fairValue * offset - c.price) / (c.price * 0.006)) * gain, -1, 1),
    })
  }

  // Breakout traders — buy strength through the recent channel high (sell
  // weakness through the low), then press for a burst of ticks.
  for (let i = 0; i < 20; i++) {
    const win = 36 + Math.floor(rng() * 120)
    const burstLen = 6 + Math.floor(rng() * 14)
    const size = 0.7 + rng()
    let burst = 0
    let dir = 0
    traders.push({
      size,
      desire: (c) => {
        if (burst > 0) {
          burst--
          return dir
        }
        const end = c.history.length - 1
        const start = Math.max(0, end - win)
        let hi = -Infinity
        let lo = Infinity
        for (let k = start; k < end; k++) {
          const p = c.history[k]
          if (p > hi) hi = p
          if (p < lo) lo = p
        }
        if (c.price > hi) {
          dir = 1
          burst = burstLen
          return 1
        }
        if (c.price < lo) {
          dir = -1
          burst = burstLen
          return -1
        }
        return 0
      },
    })
  }

  // Noise traders — small uninformed flow with short persistence.
  for (let i = 0; i < 25; i++) {
    const size = 0.3 + rng() * 0.7
    let desire = 0
    let hold = 0
    traders.push({
      size,
      desire: () => {
        if (hold-- <= 0) {
          desire = rng() * 2 - 1
          hold = 3 + Math.floor(rng() * 12)
        }
        return desire
      },
    })
  }

  const totalSize = traders.reduce((a, t) => a + t.size, 0)

  const WARMUP = 300
  const history: number[] = [startPrice]
  let price = startPrice
  let ret = 0
  let volEma = 0.0008

  for (let t = 0; t < nTicks + WARMUP; t++) {
    // Regime: fair value drifts in episodes — flat, grinding up, or down.
    if (t >= nextDriftChange) {
      drift = rng() < 0.45 ? 0 : (rng() - 0.5) * 0.00018
      nextDriftChange = t + 250 + Math.floor(rng() * 550)
    }
    fairValue *= 1 + drift

    const ctx: Ctx = { price, ret, history }
    let flow = 0
    for (const tr of traders) flow += clamp(tr.desire(ctx), -1, 1) * tr.size

    // Thin liquidity in volatile tape amplifies impact → clustering.
    const volRatio = clamp(volEma / 0.0008, 0.5, 3)
    const r = clamp(
      0.0016 * (flow / totalSize) * volRatio + 0.0007 * randn() * volRatio,
      -0.004,
      0.004,
    )
    price = Math.max(5, round2(price * (1 + r)))
    ret = r
    volEma = volEma * 0.97 + Math.abs(r) * 0.03
    history.push(price)
  }
  return history.slice(WARMUP + 1)
}
