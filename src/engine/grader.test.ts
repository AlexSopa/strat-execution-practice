import { describe, expect, it } from 'vitest'
import { Broker } from './broker'
import { gradeTrade } from './grader'
import { armedSetupsAt, classifySeries } from './strat'
import type { Bar } from './types'

let t = 0
const bar = (path: number[]): Bar => ({
  time: ++t,
  open: path[0],
  high: Math.max(...path),
  low: Math.min(...path),
  close: path[path.length - 1],
  path,
})

/**
 * A bullish 2-1-2 that triggers and runs 2u-2u before pulling back:
 *   0: base bar           10.0 H12.0 L8.0 C9.0
 *   1: 2d red             L7.0 H11.0 C7.5
 *   2: inside bar         7.5..9.0 (arming bar; trigger 9.01, tight stop 7.19)
 *   3: 2u green           breaks 9.01, runs to 10.5  (continuation: trail to 7.99)
 *   4: 2u green           runs to 12.0               (trail to 9.49)
 *   5: 2d red             pulls back through 9.49 → stopped
 */
const runBars = [
  bar([10, 8, 12, 9]),
  bar([9, 11, 7, 7.5]),
  bar([7.5, 7.2, 9, 8.5]),
  bar([8.5, 8, 10.5, 10.2]),
  bar([10.2, 9.5, 12, 11.8]),
  bar([11.8, 11.9, 9.2, 9.4]),
]

function disciplinedTrade() {
  const bars = runBars
  const types = classifySeries(bars)
  const setup = armedSetupsAt(bars, types, 2).find((s) => s.direction === 'long')!
  const broker = new Broker()
  bars.slice(0, 3).forEach((b, i) => broker.stepBar(b, i))
  broker.placeOrder({
    direction: 'long',
    price: setup.trigger,
    qty: 100,
    isAdd: false,
    placedBarIndex: 2,
    plannedStop: setup.tightStop,
    declaredStopStyle: 'tight',
    scenario: setup.scenario,
  })
  return { bars, types, setup, broker }
}

describe('gradeTrade', () => {
  it('scores a disciplined trade highly on all three skills', () => {
    const { bars, types, broker } = disciplinedTrade()
    broker.stepBar(bars[3], 3)
    broker.setStop(7.99, 3) // trail under the 2u at bar 3
    broker.stepBar(bars[4], 4)
    broker.setStop(9.49, 4) // trail under the 2u at bar 4
    broker.stepBar(bars[5], 5)
    expect(broker.trades).toHaveLength(1)
    const g = gradeTrade(broker.trades[0], bars, types)
    expect(g.scenario).toBe('2-1-2')
    expect(g.entry).toBe(100)
    expect(g.stops).toBe(100)
    expect(g.management).toBeGreaterThanOrEqual(85)
  })

  it('penalizes never trailing', () => {
    const { bars, types, broker } = disciplinedTrade()
    broker.stepBar(bars[3], 3)
    broker.stepBar(bars[4], 4)
    broker.stepBar(bars[5], 5)
    broker.closeAll(bars[5].close, 5, bars[5].time, 'session-end')
    const g = gradeTrade(broker.trades[0], bars, types)
    expect(g.management).toBeLessThan(50)
    expect(g.notes.join(' ')).toMatch(/Trailed 0 of 2/)
  })

  it('penalizes widening the stop', () => {
    const { bars, types, broker } = disciplinedTrade()
    broker.stepBar(bars[3], 3)
    broker.setStop(6.5, 3) // widening — moving the stop further away
    broker.stepBar(bars[4], 4)
    broker.stepBar(bars[5], 5)
    broker.closeAll(bars[5].close, 5, bars[5].time, 'session-end')
    const g = gradeTrade(broker.trades[0], bars, types)
    expect(g.stops).toBeLessThanOrEqual(70)
    expect(g.notes.join(' ')).toMatch(/widened/i)
  })

  it('penalizes an entry with no armed setup behind it', () => {
    const bars = runBars
    const types = classifySeries(bars)
    const broker = new Broker()
    bars.slice(0, 4).forEach((b, i) => broker.stepBar(b, i))
    // Bar 3 is a green 2u — chasing its high is not a reversal entry.
    broker.placeOrder({
      direction: 'long',
      price: 10.51,
      qty: 100,
      isAdd: false,
      placedBarIndex: 3,
      plannedStop: 9.99,
      declaredStopStyle: 'tight',
      scenario: null,
    })
    broker.stepBar(bars[4], 4)
    broker.stepBar(bars[5], 5)
    broker.closeAll(9.4, 5, bars[5].time, 'session-end')
    const g = gradeTrade(broker.trades[0], bars, types)
    expect(g.entry).toBe(15)
    expect(g.notes.join(' ')).toMatch(/chase/i)
  })

  it('gives a clean stopped-out loser full management credit', () => {
    const bars = [
      bar([10, 8, 12, 9]),
      bar([9, 11, 7, 7.5]),
      bar([7.5, 7.2, 9, 8.5]),
      bar([8.5, 9.2, 7.1, 7.2]), // triggers long at 9.01, reverses to stop 7.19
    ]
    const types = classifySeries(bars)
    const setup = armedSetupsAt(bars, types, 2).find((s) => s.direction === 'long')!
    const broker = new Broker()
    bars.slice(0, 3).forEach((b, i) => broker.stepBar(b, i))
    broker.placeOrder({
      direction: 'long',
      price: setup.trigger,
      qty: 100,
      isAdd: false,
      placedBarIndex: 2,
      plannedStop: setup.tightStop,
      declaredStopStyle: 'tight',
      scenario: setup.scenario,
    })
    broker.stepBar(bars[3], 3)
    expect(broker.trades).toHaveLength(1)
    expect(broker.trades[0].exitReason).toBe('stop')
    const g = gradeTrade(broker.trades[0], bars, types)
    expect(g.entry).toBe(100)
    expect(g.stops).toBe(100)
    expect(g.management).toBe(100) // a 1R loss executed perfectly is perfect execution
  })
})
