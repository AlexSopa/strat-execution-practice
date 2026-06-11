import { simulateTicks } from './market'
import { mulberry32, rand } from './rng'
import type { Rng } from './rng'
import { TICK, armedSetupsAt, classifySeries } from './strat'
import type { Bar, BarType, Direction, Scenario, Shape } from './types'

export { mulberry32 }
export type { Rng }

const round2 = (n: number) => Math.round(n * 100) / 100

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
  // Hard ceiling so chains of expansion bars can't run ranges away from price.
  const maxRange = Math.abs(prev.close) * 0.09
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
    case '2u': {
      // The interior low is a pullback from the PRIOR CLOSE — shallow most of
      // the time (real trend legs don't retest every prior bar), with an
      // occasional deeper retest. In a 2u-2u-2u run this stair-steps: each
      // bar's low ends up above the high from two bars ago.
      const deep = rng() < 0.3
      const pullback = deep ? rawPr * rand(rng, 0.35, 0.8) : pr * rand(rng, 0.05, 0.3)
      low = round2(Math.max(prev.low, prev.close - pullback))
      const ext = Math.min(pr * rand(rng, 0.15, 0.85), maxRange - (prev.high - low))
      high = round2(prev.high + Math.max(0.02, ext))
      break
    }
    case '2d': {
      const deep = rng() < 0.3
      const pullback = deep ? rawPr * rand(rng, 0.35, 0.8) : pr * rand(rng, 0.05, 0.3)
      high = round2(Math.min(prev.high, prev.close + pullback))
      const ext = Math.min(pr * rand(rng, 0.15, 0.85), maxRange - (high - prev.low))
      low = round2(prev.low - Math.max(0.02, ext))
      break
    }
    case '3': {
      const room = (maxRange - rawPr) / 2
      high = round2(prev.high + Math.max(0.02, Math.min(pr * rand(rng, 0.1, 0.45), room)))
      low = round2(prev.low - Math.max(0.02, Math.min(pr * rand(rng, 0.1, 0.45), room)))
      break
    }
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
  // Continuous market: every bar opens at (or within a hair of) the prior
  // close, clamped into the zone its shape requires — no opening gaps.
  const anchor = prev.close + (rng() - 0.5) * r * 0.05
  switch (shape) {
    case 'hammer': {
      const zone = low + r * 0.7 // body lives in the top 30%
      open = round2(Math.min(high, Math.max(zone, anchor)))
      close = round2(Math.min(high, Math.max(zone, open + (green ? 1 : -1) * r * rand(rng, 0.05, 0.25))))
      break
    }
    case 'shooter': {
      const zone = low + r * 0.3 // body lives in the bottom 30%
      open = round2(Math.min(zone, Math.max(low, anchor)))
      close = round2(Math.min(zone, Math.max(low, open + (green ? 1 : -1) * r * rand(rng, 0.05, 0.25))))
      break
    }
    case 'doji': {
      const zLow = low + r * 0.35
      const zHigh = low + r * 0.65
      open = round2(Math.min(zHigh, Math.max(zLow, anchor)))
      close = round2(Math.min(zHigh, Math.max(zLow, open + (green ? 1 : -1) * r * 0.02)))
      break
    }
    default: {
      const minBody = Math.max(0.02, r * 0.08)
      const lowest = green ? low + 0.01 : low + minBody
      const highest = green ? high - minBody : high - 0.01
      open = round2(Math.min(highest, Math.max(lowest, anchor)))
      // A directional bar moving WITH its break (green 2u / red 2d) closes
      // near its extreme — trend legs leave small terminal wicks.
      const aligned = (spec.type === '2u' && green) || (spec.type === '2d' && !green)
      const span = green ? high - open : open - low
      const body = Math.max(minBody, span * (aligned ? rand(rng, 0.7, 0.97) : rand(rng, 0.35, 0.75)))
      close = round2(green ? open + Math.min(body, span) : open - Math.min(body, span))
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

const TICKS_PER_BAR = 24

/**
 * Generate a practice session by SIMULATING A MARKET, not drawing candles:
 * ~100 seeded agents (momentum, mean reversion, breakout, noise) trade into
 * a price-impact model in engine/market.ts; the resulting continuous tick
 * stream is aggregated into bars (24 ticks each). Strat reversal setups are
 * then DETECTED from the tape — they emerge from agent behavior the same way
 * they do in real markets. Bars can never gap: each opens one tick after the
 * prior close. The episode list is the detected setups with their outcomes.
 */
export function generateSession(opts: SessionOptions): Session {
  const { seed, barCount = 160, startPrice = 100, barIntervalSec = 900 } = opts
  const ticks = simulateTicks(seed, barCount * TICKS_PER_BAR, startPrice)
  const bars: Bar[] = []
  let time = 1704207600 // cosmetic anchor; bars advance by barIntervalSec
  for (let i = 0; i < barCount; i++) {
    const path = ticks.slice(i * TICKS_PER_BAR, (i + 1) * TICKS_PER_BAR)
    bars.push({
      time,
      open: path[0],
      high: Math.max(...path),
      low: Math.min(...path),
      close: path[path.length - 1],
      path,
    })
    time += barIntervalSec
  }

  const types = classifySeries(bars)
  const episodes: Episode[] = []
  for (let i = 1; i < bars.length - 1; i++) {
    for (const s of armedSetupsAt(bars, types, i)) {
      const next = bars[i + 1]
      const took = s.direction === 'long' ? next.high >= s.trigger : next.low <= s.trigger
      episodes.push({
        scenario: s.scenario,
        direction: s.direction,
        armedIndex: i,
        outcome: took ? 'trigger' : 'fail',
      })
    }
  }
  return { seed, bars, episodes }
}

export { TICK }
