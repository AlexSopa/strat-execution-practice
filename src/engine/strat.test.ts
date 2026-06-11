import { describe, expect, it } from 'vitest'
import { armedSetupsAt, classifyBar, classifySeries, classifyShape, expectedTrailStop, isValidAddBar, magnitudeTarget } from './strat'
import type { Bar } from './types'

let t = 0
const bar = (open: number, high: number, low: number, close: number): Bar => ({
  time: ++t,
  open,
  high,
  low,
  close,
  path: [open, high, low, close],
})

describe('classifyBar', () => {
  const prev = bar(10, 12, 8, 11)
  it('inside bar is 1', () => {
    expect(classifyBar(prev, bar(10.5, 11.5, 9, 10))).toBe('1')
    expect(classifyBar(prev, bar(10, 12, 8, 11))).toBe('1') // equal H/L is still inside
  })
  it('breaks high only is 2u', () => {
    expect(classifyBar(prev, bar(11, 13, 9, 12.5))).toBe('2u')
  })
  it('breaks low only is 2d', () => {
    expect(classifyBar(prev, bar(10, 11, 7, 7.5))).toBe('2d')
  })
  it('breaks both is 3', () => {
    expect(classifyBar(prev, bar(10, 13, 7, 12))).toBe('3')
  })
})

describe('classifyShape', () => {
  it('hammer: open and close in top third', () => {
    expect(classifyShape(bar(11.6, 12, 9, 11.9))).toBe('hammer')
  })
  it('shooter: open and close in bottom third', () => {
    expect(classifyShape(bar(9.8, 12, 9, 9.2))).toBe('shooter')
  })
  it('doji: tiny body mid-range', () => {
    expect(classifyShape(bar(10.5, 12, 9, 10.52))).toBe('doji')
  })
  it('plain otherwise', () => {
    expect(classifyShape(bar(9.5, 12, 9, 11.5))).toBe('plain')
  })
})

describe('armedSetupsAt — bullish scenarios', () => {
  it('2-2: a lone 2d arms a long over its high', () => {
    const bars = [bar(10, 12, 8, 9), bar(9, 11, 7, 7.5)]
    const types = classifySeries(bars)
    const setups = armedSetupsAt(bars, types, 1)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({
      scenario: '2-2',
      direction: 'long',
      trigger: 11.01,
      tightStop: 6.99,
      setupStop: 6.99,
    })
  })

  it('2-1-2: 2d then inside bar arms a long over the inside high', () => {
    const bars = [bar(10, 12, 8, 9), bar(9, 11, 7, 7.5), bar(7.5, 9, 7.2, 8.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '2d', '1'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({
      scenario: '2-1-2',
      direction: 'long',
      trigger: 9.01,
      tightStop: 7.19,
      setupStop: 6.99, // pattern low is the 2d's low
      patternStart: 1,
    })
  })

  it('3-1-2: red outside bar then inside bar arms a long', () => {
    const bars = [bar(10, 12, 8, 9), bar(11, 13, 7, 7.5), bar(7.5, 9, 7.2, 8.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '3', '1'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({ scenario: '3-1-2', direction: 'long', trigger: 9.01 })
  })

  it('1-2-2: inside bar then 2d arms a long over the 2d high', () => {
    const bars = [bar(10, 12, 8, 9), bar(9, 11, 8.5, 10), bar(9.5, 10, 7, 7.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '1', '2d'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({
      scenario: '1-2-2',
      direction: 'long',
      trigger: 10.01,
      tightStop: 6.99,
    })
  })

  it('3-2-2: outside bar then 2d arms a long', () => {
    const bars = [bar(10, 12, 8, 9), bar(11, 13, 7, 12), bar(11, 12, 6, 6.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '3', '2d'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({ scenario: '3-2-2', direction: 'long', trigger: 12.01, setupStop: 5.99 })
  })
})

describe('armedSetupsAt — bearish mirrors', () => {
  it('2-2: a lone 2u arms a short under its low', () => {
    const bars = [bar(10, 12, 8, 11), bar(11, 13, 9, 12.5)]
    const types = classifySeries(bars)
    const setups = armedSetupsAt(bars, types, 1)
    expect(setups).toHaveLength(1)
    expect(setups[0]).toMatchObject({ scenario: '2-2', direction: 'short', trigger: 8.99, tightStop: 13.01 })
  })

  it('2-1-2: 2u then inside bar arms a short', () => {
    const bars = [bar(10, 12, 8, 11), bar(11, 13, 9, 12.5), bar(12.5, 12.8, 11, 11.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '2u', '1'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups[0]).toMatchObject({ scenario: '2-1-2', direction: 'short', trigger: 10.99, setupStop: 13.01 })
  })

  it('3-1-2: green outside bar then inside bar arms a short', () => {
    const bars = [bar(10, 12, 8, 11), bar(9, 13, 7, 12.5), bar(12, 12.8, 11, 11.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '3', '1'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups[0]).toMatchObject({ scenario: '3-1-2', direction: 'short', trigger: 10.99 })
  })

  it('1-2-2: inside bar then 2u arms a short', () => {
    const bars = [bar(10, 12, 8, 11), bar(10.5, 11.5, 9, 10), bar(10.5, 13, 10, 12.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '1', '2u'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups[0]).toMatchObject({ scenario: '1-2-2', direction: 'short', trigger: 9.99 })
  })

  it('3-2-2: outside bar then 2u arms a short', () => {
    const bars = [bar(10, 12, 8, 9), bar(11, 13, 7, 8), bar(8, 14, 7.5, 13.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '3', '2u'])
    const setups = armedSetupsAt(bars, types, 2)
    expect(setups[0]).toMatchObject({ scenario: '3-2-2', direction: 'short', trigger: 7.49, setupStop: 14.01 })
  })
})

describe('armedSetupsAt — non-setups', () => {
  it('an inside bar after a plain inside bar arms nothing', () => {
    const bars = [bar(10, 12, 8, 11), bar(10.5, 11.5, 9, 10), bar(10.2, 11, 9.5, 10.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '1', '1'])
    expect(armedSetupsAt(bars, types, 2)).toHaveLength(0)
  })

  it('a 3 bar itself arms nothing (we wait for the next bar)', () => {
    const bars = [bar(10, 12, 8, 11), bar(9, 13, 7, 12.5)]
    const types = classifySeries(bars)
    expect(types).toEqual([null, '3'])
    expect(armedSetupsAt(bars, types, 1)).toHaveLength(0)
  })
})

describe('magnitudeTarget', () => {
  it('finds the most recent pivot high above for a long', () => {
    const bars = [
      bar(10, 11, 9, 10.5),
      bar(10.5, 14, 10, 13), // pivot high 14
      bar(13, 13.5, 11, 11.5),
      bar(11.5, 12, 9, 9.5),
      bar(9.5, 10.5, 8, 8.5), // arming 2d
    ]
    expect(magnitudeTarget(bars, 4, 'long')).toBe(14)
  })

  it('returns null when no prior pivot is beyond the arming bar', () => {
    const bars = [bar(10, 11, 9, 10.5), bar(10.5, 12, 10, 11.5), bar(11.5, 13, 11, 12.5)]
    expect(magnitudeTarget(bars, 2, 'long')).toBeNull()
  })
})

describe('trade management helpers', () => {
  it('expectedTrailStop trails under a green 2u in a long', () => {
    const bars = [bar(10, 12, 8, 11), bar(11, 13, 10, 12.5)]
    const types = classifySeries(bars)
    expect(expectedTrailStop(bars, types, 1, 'long')).toBe(9.99)
    expect(expectedTrailStop(bars, types, 1, 'short')).toBeNull()
  })

  it('expectedTrailStop ignores a red 2u (no trail yet)', () => {
    const bars = [bar(10, 12, 8, 11), bar(12.4, 13, 10, 11)]
    const types = classifySeries(bars)
    expect(expectedTrailStop(bars, types, 1, 'long')).toBeNull()
  })

  it('isValidAddBar: inside bars and pullback bars are valid adds', () => {
    const bars = [bar(10, 12, 8, 11), bar(10.5, 11.5, 9, 10), bar(10, 11, 7.5, 8)]
    const types = classifySeries(bars)
    expect(isValidAddBar(types, 1, 'long')).toBe(true) // inside bar
    expect(isValidAddBar(types, 2, 'long')).toBe(true) // 2d pullback in a long
    expect(isValidAddBar(types, 2, 'short')).toBe(false)
  })
})
