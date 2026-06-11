import { describe, expect, it } from 'vitest'
import { Broker, tradePnl, tradeR } from './broker'
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

const buyStop = (price: number, plannedStop: number) => ({
  direction: 'long' as const,
  price,
  qty: 100,
  isAdd: false,
  placedBarIndex: 0,
  plannedStop,
  declaredStopStyle: 'tight' as const,
  scenario: '2-2' as const,
})

describe('Broker fills', () => {
  it('fills a buy stop at the order price when the path crosses it', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 10.2, 11.5, 11.2]), 0)
    expect(b.position).not.toBeNull()
    expect(b.position!.lots[0].price).toBe(11.01)
    expect(b.position!.stopPrice).toBe(9.99)
  })

  it('does not fill when the path never reaches the order', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0)
    expect(b.position).toBeNull()
    expect(b.pendingOrders).toHaveLength(1)
  })

  it('fills at the open when price gaps over the order', () => {
    const b = new Broker()
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0) // establishes prior close 10.7
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([11.4, 11.2, 11.8, 11.6]), 1) // gaps from 10.7 to 11.4
    expect(b.position!.lots[0].price).toBe(11.4)
  })

  it('entry then stop-out in the same bar when the path wicks back through the stop', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 10.49))
    b.stepBar(bar([10.8, 11.2, 10.2, 10.4]), 0)
    expect(b.position).toBeNull()
    expect(b.trades).toHaveLength(1)
    expect(b.trades[0].exitReason).toBe('stop')
    expect(b.trades[0].exitPrice).toBe(10.49)
  })

  it('stop vs target in one bar resolves by path order — low first means stopped', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 11.1, 10.8]), 0)
    b.setTarget(12)
    b.stepBar(bar([10.8, 9.9, 12.1, 11.5]), 1) // hits stop before target
    expect(b.trades[0].exitReason).toBe('stop')
  })

  it('stop vs target in one bar — high first means target', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 11.1, 10.8]), 0)
    b.setTarget(12)
    b.stepBar(bar([10.8, 12.1, 9.9, 10.0]), 1) // hits target before stop
    expect(b.trades[0].exitReason).toBe('target')
    expect(b.trades[0].exitPrice).toBe(12)
  })

  it('short side mirrors: sell stop entry and protective buy stop', () => {
    const b = new Broker()
    b.placeOrder({ ...buyStop(9.99, 11.01), direction: 'short' })
    b.stepBar(bar([10.5, 9.8, 10.0]), 0)
    expect(b.position!.direction).toBe('short')
    expect(b.position!.lots[0].price).toBe(9.99)
    b.stepBar(bar([10.0, 11.2, 11.0]), 1)
    expect(b.trades[0].exitReason).toBe('stop')
    expect(b.trades[0].exitPrice).toBe(11.01)
  })
})

describe('limit orders and market netting', () => {
  it('a buy limit fills on a pulldown to the level, not on the way up', () => {
    const b = new Broker()
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0)
    b.placeOrder({ ...buyStop(10.3, 9.79), kind: 'limit' })
    b.stepBar(bar([10.7, 11.0, 10.8]), 1) // rallies — no fill
    expect(b.position).toBeNull()
    b.stepBar(bar([10.8, 10.25, 10.6]), 2) // pulls back through 10.30
    expect(b.position).not.toBeNull()
    expect(b.position!.lots[0].price).toBe(10.3)
  })

  it('a sell limit fills on a rally to the level', () => {
    const b = new Broker()
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0)
    b.placeOrder({ ...buyStop(11.2, 12.0), direction: 'short', kind: 'limit' })
    b.stepBar(bar([10.7, 11.3, 11.0]), 1)
    expect(b.position!.direction).toBe('short')
    expect(b.position!.lots[0].price).toBe(11.2)
  })

  it('market orders open, add, net down, and never flip', () => {
    const b = new Broker()
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0)
    b.marketOrder('long', 100, 10.7, 0, 1, 'tight')
    expect(b.position!.direction).toBe('long')
    b.marketOrder('long', 100, 11.0, 1, 2, 'tight')
    expect(b.openQty()).toBe(200)
    b.marketOrder('short', 100, 11.5, 2, 3, 'tight') // nets down 1 unit, FIFO
    expect(b.openQty()).toBe(100)
    expect(b.position!.partialExits).toEqual([{ qty: 100, entryPrice: 10.7, exitPrice: 11.5 }])
    b.marketOrder('short', 100, 11.2, 3, 4, 'tight') // flat — closes the trade
    expect(b.position).toBeNull()
    const trade = b.trades[0]
    // (11.5-10.7)*100 scaled out + (11.2-11.0)*100 final = 80 + 20
    expect(tradePnl(trade)).toBeCloseTo(100)
    b.marketOrder('short', 100, 11.0, 4, 5, 'tight') // flat + sell = new short, not ignored
    expect(b.position!.direction).toBe('short')
  })

  it('remaining-lot average survives a partial exit', () => {
    const b = new Broker()
    b.stepBar(bar([10.5, 10.2, 10.9, 10.7]), 0)
    b.marketOrder('long', 100, 10.0, 0, 1, 'tight')
    b.marketOrder('long', 100, 12.0, 1, 2, 'tight')
    b.marketOrder('short', 100, 11.0, 2, 3, 'tight')
    expect(b.remainingLots()).toEqual([{ price: 12.0, qty: 100 }])
  })
})

describe('adds and R math', () => {
  it('adds stack lots and die with the position', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 11.1, 11.0]), 0)
    b.placeOrder({ ...buyStop(11.51, 9.99), isAdd: true })
    b.stepBar(bar([11.0, 11.6, 11.5]), 1)
    expect(b.position!.lots).toHaveLength(2)
    b.setStop(11.2, 1)
    b.stepBar(bar([11.5, 11.1, 11.3]), 2)
    expect(b.position).toBeNull()
    const trade = b.trades[0]
    // initial risk = 11.01 - 9.99 = 1.02 per share on 100 shares
    expect(trade.initialRisk).toBeCloseTo(1.02)
    // pnl = (11.2-11.01)*100 + (11.2-11.51)*100 = 19 - 31 = -12
    expect(tradePnl(trade)).toBeCloseTo(-12)
    expect(tradeR(trade)).toBeCloseTo(-12 / 102, 2)
  })

  it('records stop history for the grader', () => {
    const b = new Broker()
    b.placeOrder(buyStop(11.01, 9.99))
    b.stepBar(bar([10.5, 11.1, 11.0]), 0)
    b.setStop(10.5, 1)
    b.setStop(10.9, 2)
    expect(b.position!.stopHistory.map((s) => s.price)).toEqual([9.99, 10.5, 10.9])
  })
})
