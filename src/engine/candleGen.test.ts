import { describe, expect, it } from 'vitest'
import { generateSession, makeBar, mulberry32 } from './candleGen'
import { armedSetupsAt, classifySeries, classifyShape } from './strat'
import type { Bar } from './types'

const SEEDS = [1, 7, 42, 1337, 20260610]

describe('makeBar', () => {
  const prev: Bar = { time: 0, open: 100, high: 101, low: 99, close: 100.5, path: [100, 99, 101, 100.5] }

  it('produces the requested bar type for every type and seed', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const type of ['1', '2u', '2d', '3'] as const) {
        for (let n = 0; n < 50; n++) {
          const b = makeBar(rng, prev, { type })
          const brokeHigh = b.high > prev.high
          const brokeLow = b.low < prev.low
          const actual = brokeHigh && brokeLow ? '3' : brokeHigh ? '2u' : brokeLow ? '2d' : '1'
          expect(actual).toBe(type)
        }
      }
    }
  })

  it('produces the requested shape', () => {
    const rng = mulberry32(99)
    for (const shape of ['hammer', 'shooter', 'doji'] as const) {
      for (let n = 0; n < 50; n++) {
        const b = makeBar(rng, prev, { type: '2d', shape })
        expect(classifyShape(b)).toBe(shape)
      }
    }
  })

  it('path starts at open, ends at close, and spans exactly high/low', () => {
    const rng = mulberry32(5)
    for (let n = 0; n < 200; n++) {
      const b = makeBar(rng, prev, { type: n % 2 ? '2u' : '3' })
      expect(b.path[0]).toBe(b.open)
      expect(b.path[b.path.length - 1]).toBe(b.close)
      expect(Math.max(...b.path)).toBe(b.high)
      expect(Math.min(...b.path)).toBe(b.low)
    }
  })

  it('trend runs stair-step: the 3rd consecutive 2u low clears the 1st 2u high', () => {
    const rng = mulberry32(123)
    let stairStepped = 0
    let shallow = 0
    const TRIALS = 200
    for (let n = 0; n < TRIALS; n++) {
      let b0: Bar = { time: 0, open: 100, high: 101, low: 99, close: 100.8, path: [100, 99, 101, 100.8] }
      const run: Bar[] = []
      for (let k = 0; k < 3; k++) {
        const b = makeBar(rng, b0, { type: '2u', green: true })
        run.push(b)
        b0 = b
      }
      if (run[2].low > run[0].high) stairStepped++
      // Shallow retrace: the 2nd bar's low holds above the 1st bar's midpoint.
      if (run[1].low > (run[0].high + run[0].low) / 2) shallow++
    }
    expect(stairStepped / TRIALS).toBeGreaterThan(0.5)
    expect(shallow / TRIALS).toBeGreaterThan(0.55)
  })

  it('honors pathOrder', () => {
    const rng = mulberry32(8)
    const b = makeBar(rng, prev, { type: '3', pathOrder: 'lowFirst' })
    expect(b.path.indexOf(b.low)).toBeLessThan(b.path.indexOf(b.high))
  })
})

describe('generateSession', () => {
  it('is deterministic for a given seed', () => {
    const a = generateSession({ seed: 42 })
    const b = generateSession({ seed: 42 })
    expect(a.bars).toEqual(b.bars)
    expect(a.episodes).toEqual(b.episodes)
  })

  it('every bar is internally consistent', () => {
    for (const seed of SEEDS) {
      const { bars } = generateSession({ seed })
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i]
        expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close))
        expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close))
        expect(Math.max(...b.path)).toBe(b.high)
        expect(Math.min(...b.path)).toBe(b.low)
        expect(b.path[0]).toBe(b.open)
        expect(b.path[b.path.length - 1]).toBe(b.close)
        if (i > 0) expect(b.time).toBeGreaterThan(bars[i - 1].time)
      }
    }
  })

  it('injects a healthy number of episodes and they detect back correctly', () => {
    for (const seed of SEEDS) {
      const { bars, episodes } = generateSession({ seed, barCount: 200 })
      expect(episodes.length).toBeGreaterThanOrEqual(8)
      const types = classifySeries(bars)
      for (const ep of episodes) {
        const setups = armedSetupsAt(bars, types, ep.armedIndex)
        const match = setups.find((s) => s.scenario === ep.scenario && s.direction === ep.direction)
        expect(match, `seed ${seed}: ${ep.scenario} ${ep.direction} at bar ${ep.armedIndex}`).toBeDefined()
      }
    }
  })

  it('trigger episodes break the trigger on the next bar; fails do not', () => {
    for (const seed of SEEDS) {
      const { bars, episodes } = generateSession({ seed, barCount: 200 })
      const types = classifySeries(bars)
      for (const ep of episodes) {
        const setup = armedSetupsAt(bars, types, ep.armedIndex).find(
          (s) => s.scenario === ep.scenario && s.direction === ep.direction,
        )!
        const next = bars[ep.armedIndex + 1]
        const took = ep.direction === 'long' ? next.high >= setup.trigger : next.low <= setup.trigger
        expect(took, `seed ${seed} bar ${ep.armedIndex}`).toBe(ep.outcome === 'trigger')
      }
    }
  })

  it('bars carry dense tick paths for live intrabar replay', () => {
    for (const seed of SEEDS) {
      const { bars } = generateSession({ seed })
      for (const b of bars.slice(1)) {
        expect(b.path.length).toBeGreaterThanOrEqual(12)
      }
    }
  })

  it('prices stay positive and ranges stay proportionate to price', () => {
    for (const seed of SEEDS) {
      const { bars } = generateSession({ seed, barCount: 300 })
      for (const b of bars) {
        expect(b.low).toBeGreaterThan(0)
        expect(b.high - b.low).toBeLessThan(Math.abs(b.close) * 0.16)
      }
    }
  })

  it('bars open at the prior close most of the time, with occasional gaps', () => {
    for (const seed of SEEDS) {
      const { bars } = generateSession({ seed, barCount: 300 })
      let continuous = 0
      let gapped = 0
      for (let i = 1; i < bars.length; i++) {
        const r = bars[i].high - bars[i].low
        const jump = Math.abs(bars[i].open - bars[i - 1].close)
        if (jump <= r * 0.12) continuous++
        if (jump >= r * 0.25) gapped++
      }
      // Mostly a continuous market...
      expect(continuous / (bars.length - 1), `seed ${seed} continuity`).toBeGreaterThan(0.5)
      // ...but real opening gaps do happen.
      expect(gapped, `seed ${seed} gaps`).toBeGreaterThanOrEqual(3)
    }
  })

  it('volatility expands and contracts across the session', () => {
    for (const seed of SEEDS) {
      const { bars } = generateSession({ seed, barCount: 200 })
      const ranges = bars.map((b) => b.high - b.low).sort((a, b) => a - b)
      const p10 = ranges[Math.floor(ranges.length * 0.1)]
      const p90 = ranges[Math.floor(ranges.length * 0.9)]
      expect(p90 / p10, `seed ${seed}`).toBeGreaterThan(2)
    }
  })

  it('covers all five scenarios and both directions across seeds', () => {
    const scenarios = new Set<string>()
    const dirs = new Set<string>()
    for (const seed of SEEDS) {
      for (const ep of generateSession({ seed, barCount: 300 }).episodes) {
        scenarios.add(ep.scenario)
        dirs.add(ep.direction)
      }
    }
    expect([...scenarios].sort()).toEqual(['1-2-2', '2-1-2', '2-2', '3-1-2', '3-2-2'])
    expect(dirs.size).toBe(2)
  })
})
