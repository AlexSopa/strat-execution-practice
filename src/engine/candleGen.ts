import { TICK, classifyBar } from './strat'
import type { Bar, BarType, Direction, Scenario, Shape } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Deterministic PRNG so sessions are reproducible / shareable by seed. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

const rand = (rng: Rng, min: number, max: number) => min + rng() * (max - min)
const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)]

export interface BarSpec {
  type: BarType
  shape?: Shape
  /** Close above open. Defaults to random. */
  green?: boolean
  /** Which extreme the intrabar path visits first. */
  pathOrder?: 'lowFirst' | 'highFirst'
  /** Session volatility regime multiplier (expansion > 1, contraction < 1). */
  vol?: number
}

/**
 * Lower-timeframe tick stream for one display bar: a bridge random walk with
 * clustered volatility that starts at the open, visits both extremes in the
 * requested order (exactly touching them), and settles at the close. This is
 * what the chart aggregates live while the bar develops, and what the broker
 * fills against.
 */
function buildPath(
  rng: Rng,
  open: number,
  high: number,
  low: number,
  close: number,
  lowFirst: boolean,
): number[] {
  const range = Math.max(high - low, 0.01)
  const waypoints = lowFirst ? [open, low, high, close] : [open, high, low, close]
  const path: number[] = []
  let localVol = 1
  for (let s = 0; s < 3; s++) {
    const from = waypoints[s]
    const to = waypoints[s + 1]
    const n = Math.max(4, Math.round((Math.abs(to - from) / range) * 14) + Math.floor(rng() * 3))
    // Until an extreme's own waypoint is reached, keep noise a hair inside it
    // so the touch order (and therefore fill order) stays as requested.
    const hiCap = s === 0 && lowFirst ? high - 0.01 : high
    const loCap = s === 0 && !lowFirst ? low + 0.01 : low
    for (let k = s === 0 ? 0 : 1; k < n; k++) {
      const f = k / n
      localVol = Math.min(2.2, Math.max(0.45, localVol * Math.exp(0.5 * (rng() - 0.5))))
      const bridge = 2 * Math.sqrt(Math.max(0, f * (1 - f)))
      const noise = (rng() - 0.5) * range * 0.22 * localVol * bridge
      const v = from + (to - from) * f + noise
      path.push(round2(Math.min(hiCap, Math.max(loCap, v))))
    }
    path.push(round2(to))
  }
  return path
}

/**
 * Build the next bar from a spec relative to the previous bar.
 * Guarantees the bar classifies as spec.type and (when given) spec.shape.
 */
export function makeBar(rng: Rng, prev: Bar, spec: BarSpec, barIntervalSec = 900): Bar {
  const rawPr = prev.high - prev.low
  // Volatility regime scales how far bars extend beyond the prior bar.
  // Extensions are anchored to a percent-of-price base (not the raw prior
  // range) so expansion stretches and contraction coils WITHOUT ranges
  // compounding exponentially across the session.
  const vol = Math.min(2.4, Math.max(0.45, spec.vol ?? 1))
  const base = Math.max(0.2, Math.abs(prev.close) * 0.012) * vol
  const pr = Math.min(Math.max(rawPr, base * 0.4), base * 2.2)
  let high: number
  let low: number

  switch (spec.type) {
    case '1': {
      const r = rawPr * Math.min(0.85, rand(rng, 0.35, 0.8) * Math.sqrt(vol))
      const slack = rawPr - r
      low = round2(prev.low + slack * rand(rng, 0.15, 0.85))
      high = round2(low + r)
      if (high > prev.high) {
        high = round2(prev.high)
        low = round2(high - r)
      }
      if (low < prev.low) low = round2(prev.low)
      break
    }
    case '2u':
      // Breakout side extends by the vol-anchored amount; the interior side
      // pulls in proportionally to the actual prior range so oversized ranges
      // decay back toward the regime level instead of persisting.
      high = round2(prev.high + Math.max(0.02, pr * rand(rng, 0.15, 0.85)))
      low = round2(Math.max(prev.low, Math.min(prev.low + rawPr * rand(rng, 0.1, 0.5), prev.high)))
      break
    case '2d':
      low = round2(prev.low - Math.max(0.02, pr * rand(rng, 0.15, 0.85)))
      high = round2(Math.min(prev.high, Math.max(prev.high - rawPr * rand(rng, 0.1, 0.5), prev.low)))
      break
    case '3':
      high = round2(prev.high + Math.max(0.02, pr * rand(rng, 0.1, 0.45)))
      low = round2(prev.low - Math.max(0.02, pr * rand(rng, 0.1, 0.45)))
      break
  }
  if (high - low < 0.05) {
    if (spec.type === '2d') low = round2(high - 0.05)
    else high = round2(low + 0.05)
  }

  const r = high - low
  const green = spec.green ?? rng() < 0.5
  let open: number
  let close: number
  const shape = spec.shape ?? 'plain'
  switch (shape) {
    case 'hammer': {
      const zone = low + r * 0.7 // body lives in the top 30%
      const a = round2(rand(rng, zone, high))
      const b = round2(rand(rng, zone, high))
      open = green ? Math.min(a, b) : Math.max(a, b)
      close = green ? Math.max(a, b) : Math.min(a, b)
      break
    }
    case 'shooter': {
      const zone = low + r * 0.3 // body lives in the bottom 30%
      const a = round2(rand(rng, low, zone))
      const b = round2(rand(rng, low, zone))
      open = green ? Math.min(a, b) : Math.max(a, b)
      close = green ? Math.max(a, b) : Math.min(a, b)
      break
    }
    case 'doji': {
      const mid = low + r * rand(rng, 0.35, 0.65)
      open = round2(mid)
      close = round2(mid + (green ? 1 : -1) * r * 0.02)
      break
    }
    default: {
      const bodySize = r * rand(rng, 0.35, 0.75)
      const bodyLow = low + (r - bodySize) * rand(rng, 0.15, 0.85)
      open = round2(green ? bodyLow : bodyLow + bodySize)
      close = round2(green ? bodyLow + bodySize : bodyLow)
    }
  }
  open = Math.min(high, Math.max(low, open))
  close = Math.min(high, Math.max(low, close))

  const lowFirst = spec.pathOrder ? spec.pathOrder === 'lowFirst' : rng() < (green ? 0.7 : 0.3)
  const path = buildPath(rng, open, high, low, close, lowFirst)

  return { time: prev.time + barIntervalSec, open, high, low, close, path }
}

export interface Episode {
  scenario: Scenario
  direction: Direction
  /** Index of the bar that arms the setup (its break is the trigger). */
  armedIndex: number
  /** Did the bar after the arming bar take the trigger, or break the other way? */
  outcome: 'trigger' | 'fail'
}

export interface Session {
  seed: number
  bars: Bar[]
  episodes: Episode[]
}

/** The bar specs that form each armed pattern, bullish version (mirrored for shorts). */
export function patternSpecs(rng: Rng, scenario: Scenario, dir: Direction): BarSpec[] {
  const rev = (t: BarType): BarType => (t === '2d' ? '2u' : t === '2u' ? '2d' : t)
  const withDir = (s: BarSpec): BarSpec => (dir === 'long' ? s : { ...s, type: rev(s.type), green: s.green === undefined ? undefined : !s.green })
  // Bias the final (arming) bar toward a reversal shape: hammers under longs, shooters over shorts.
  const reversalShape = (): Shape | undefined => {
    const x = rng()
    if (x < 0.35) return dir === 'long' ? 'hammer' : 'shooter'
    if (x < 0.45) return 'doji'
    return undefined
  }
  switch (scenario) {
    case '2-2':
      return [withDir({ type: '2d', green: false, shape: reversalShape() })]
    case '2-1-2':
      return [withDir({ type: '2d', green: false }), withDir({ type: '1', shape: reversalShape() })]
    case '3-1-2':
      return [withDir({ type: '3', green: false }), withDir({ type: '1', shape: reversalShape() })]
    case '1-2-2':
      return [withDir({ type: '1' }), withDir({ type: '2d', green: false, shape: reversalShape() })]
    case '3-2-2':
      return [withDir({ type: '3', green: rng() < 0.5 }), withDir({ type: '2d', green: false, shape: reversalShape() })]
  }
}

export const SCENARIOS: Scenario[] = ['2-2', '2-1-2', '3-1-2', '1-2-2', '3-2-2']

export interface SessionOptions {
  seed: number
  barCount?: number
  startPrice?: number
  /** Seconds per bar, cosmetic only. */
  barIntervalSec?: number
}

/**
 * Generate a practice session: a regime-switching random walk with reversal
 * scenarios injected at controlled frequency. ~70% of armed setups trigger
 * (filling a correctly placed entry); the rest break the other way, training
 * no-chase discipline. Triggered setups are followed by a continuation run
 * (trail/add practice) or a quick failure (stop practice).
 */
export function generateSession(opts: SessionOptions): Session {
  const { seed, barCount = 160, startPrice = 100, barIntervalSec = 900 } = opts
  const rng = mulberry32(seed)
  const bars: Bar[] = []
  const episodes: Episode[] = []

  const r0 = startPrice * 0.012
  const o0 = round2(startPrice + rand(rng, -0.5, 0.5))
  const first: Bar = {
    time: 1704207600, // cosmetic anchor; bars advance by barIntervalSec
    open: o0,
    high: round2(o0 + r0 * 0.6),
    low: round2(o0 - r0 * 0.4),
    close: round2(o0 + r0 * 0.2),
    path: [o0, round2(o0 - r0 * 0.4), round2(o0 + r0 * 0.6), round2(o0 + r0 * 0.2)],
  }
  first.path = first.path.map((p) => Math.min(first.high, Math.max(first.low, p)))
  bars.push(first)

  let trendUp = rng() < 0.5
  // Mean-reverting volatility regime with occasional shocks: long quiet
  // stretches that coil, punctuated by expansions that stretch ranges.
  let vol = 1
  const add = (spec: BarSpec) => {
    vol = Math.min(2.4, Math.max(0.45, vol * Math.exp(0.22 * (rng() - 0.5)) * Math.exp(0.05 * (1 - vol))))
    if (rng() < 0.04) vol = Math.min(2.4, vol * rand(rng, 1.4, 1.9)) // expansion shock
    const b = makeBar(rng, bars[bars.length - 1], { vol, ...spec }, barIntervalSec)
    bars.push(b)
    return b
  }

  let cooldown = 2
  while (bars.length < barCount) {
    if (cooldown <= 0 && rng() < 0.28) {
      // ---- inject a scenario episode ----
      let scenario = pick(rng, SCENARIOS)
      // Reversals fire against the prevailing trend more often than with it.
      const dir: Direction = rng() < 0.7 ? (trendUp ? 'short' : 'long') : trendUp ? 'long' : 'short'
      for (const spec of patternSpecs(rng, scenario, dir)) add(spec)
      const armedIndex = bars.length - 1
      if (scenario === '2-2' && armedIndex >= 2) {
        // If the bar preceding the injected 2 happens to be a 1 or 3, the
        // pattern is really the more specific scenario — label it that way.
        const before = classifyBar(bars[armedIndex - 2], bars[armedIndex - 1])
        if (before === '1') scenario = '1-2-2'
        else if (before === '3') scenario = '3-2-2'
      }
      const triggered = rng() < 0.7
      episodes.push({ scenario, direction: dir, armedIndex, outcome: triggered ? 'trigger' : 'fail' })

      if (triggered) {
        // Entry bar: takes the trigger. Usually a clean 2; sometimes a 3 that
        // wicks through the far side first — the tight-stop wick-out lesson.
        const asThree = rng() < 0.12
        add(
          dir === 'long'
            ? { type: asThree ? '3' : '2u', green: true, pathOrder: asThree ? 'lowFirst' : rng() < 0.35 ? 'lowFirst' : 'highFirst' }
            : { type: asThree ? '3' : '2d', green: false, pathOrder: asThree ? 'highFirst' : rng() < 0.35 ? 'highFirst' : 'lowFirst' },
        )
        if (rng() < 0.62) {
          // Follow-through run: 2u-2u-2u (or 2d run) with pauses for adds.
          const runLen = 1 + Math.floor(rng() * 4)
          for (let k = 0; k < runLen && bars.length < barCount; k++) {
            const pause = rng()
            if (pause < 0.22) add({ type: '1' })
            else if (pause < 0.34) add(dir === 'long' ? { type: '2d', green: false } : { type: '2u', green: true })
            else add(dir === 'long' ? { type: '2u', green: true } : { type: '2d', green: false })
          }
          trendUp = dir === 'long'
        } else {
          // Quick failure back through the entry — stop-placement practice.
          add(dir === 'long' ? { type: '2d', green: false } : { type: '2u', green: true })
          if (rng() < 0.5) add(dir === 'long' ? { type: '2d', green: false } : { type: '2u', green: true })
        }
      } else {
        // Decoy: armed but breaks the other way. The unfilled order was correct.
        add(dir === 'long' ? { type: '2d', green: false } : { type: '2u', green: true })
        trendUp = dir !== 'long'
      }
      cooldown = 2 + Math.floor(rng() * 3)
    } else {
      // ---- plain regime walk ----
      // Quiet regimes coil (more inside bars); expansions print more 3s.
      const x = rng()
      if (rng() < 0.06) trendUp = !trendUp
      const pInside = vol < 0.7 ? 0.34 : vol > 1.6 ? 0.1 : 0.18
      const pThree = vol > 1.6 ? 0.16 : 0.07
      let spec: BarSpec
      if (x < pInside) spec = { type: '1' }
      else if (x < pInside + pThree) spec = { type: '3' }
      else if (x < pInside + pThree + 0.52)
        spec = trendUp ? { type: '2u', green: rng() < 0.75 } : { type: '2d', green: rng() > 0.75 }
      else spec = trendUp ? { type: '2d', green: rng() < 0.35 } : { type: '2u', green: rng() > 0.35 }
      add(spec)
      cooldown--
    }
  }

  return { seed, bars: bars.slice(0, barCount), episodes: episodes.filter((e) => e.armedIndex < barCount - 1) }
}

export { TICK }
