import type { Bar, Direction, Lot, Scenario, StopStyle, Trade } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface EntryOrder {
  id: number
  direction: Direction
  /** Stop-entry price: buy stop (long) above market / sell stop (short) below. */
  price: number
  qty: number
  isAdd: boolean
  placedBarIndex: number
  /** Stop-loss to install when this order fills (initial stop for entries). */
  plannedStop: number | null
  declaredStopStyle: StopStyle
  scenario: Scenario | null
}

export interface OpenPosition {
  direction: Direction
  lots: Lot[]
  stopPrice: number | null
  targetPrice: number | null
  stopHistory: { barIndex: number; price: number }[]
  declaredStopStyle: StopStyle
  scenarioAtEntry: Scenario | null
  entryOrderPrice: number
  entryOrderBarIndex: number
  maxFavorablePrice: number
}

export type BrokerEvent =
  | { type: 'entry-fill'; barIndex: number; price: number; direction: Direction }
  | { type: 'add-fill'; barIndex: number; price: number }
  | { type: 'exit'; barIndex: number; price: number; reason: Trade['exitReason'] }
  | { type: 'stop-set'; barIndex: number; price: number }

export class Broker {
  pendingOrders: EntryOrder[] = []
  position: OpenPosition | null = null
  trades: Trade[] = []
  events: BrokerEvent[] = []
  private nextOrderId = 1
  private lastPrice: number | null = null

  placeOrder(o: Omit<EntryOrder, 'id'>): EntryOrder {
    const order = { ...o, id: this.nextOrderId++ }
    this.pendingOrders.push(order)
    return order
  }

  cancelOrder(id: number) {
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== id)
  }

  setStop(price: number, barIndex: number) {
    if (!this.position) return
    this.position.stopPrice = round2(price)
    this.position.stopHistory.push({ barIndex, price: round2(price) })
    this.events.push({ type: 'stop-set', barIndex, price: round2(price) })
  }

  setTarget(price: number | null) {
    if (this.position) this.position.targetPrice = price === null ? null : round2(price)
  }

  closeAll(price: number, barIndex: number, time: number, reason: Trade['exitReason']) {
    if (!this.position) return
    this.exit(round2(price), barIndex, time, reason)
  }

  private exit(price: number, barIndex: number, time: number, reason: Trade['exitReason']) {
    const p = this.position!
    const firstLot = p.lots[0]
    const initialStop = p.stopHistory.length ? p.stopHistory[0].price : null
    const initialRisk =
      initialStop === null ? 0 : Math.abs(firstLot.price - initialStop)
    this.trades.push({
      direction: p.direction,
      lots: p.lots,
      exitPrice: price,
      exitTime: time,
      exitBarIndex: barIndex,
      exitReason: reason,
      initialRisk,
      stopHistory: p.stopHistory,
      declaredStopStyle: p.declaredStopStyle,
      scenarioAtEntry: p.scenarioAtEntry,
      entryOrderPrice: p.entryOrderPrice,
      entryOrderBarIndex: p.entryOrderBarIndex,
      maxFavorablePrice: p.maxFavorablePrice,
    })
    this.events.push({ type: 'exit', barIndex, price, reason })
    this.position = null
    // Adds die with the position; fresh entries must be re-placed.
    this.pendingOrders = this.pendingOrders.filter((o) => !o.isAdd)
  }

  private fillEntry(order: EntryOrder, price: number, barIndex: number, time: number) {
    this.pendingOrders = this.pendingOrders.filter((o) => o.id !== order.id)
    const lot: Lot = { price, qty: order.qty, time, barIndex, isAdd: order.isAdd }
    if (order.isAdd && this.position) {
      this.position.lots.push(lot)
      this.events.push({ type: 'add-fill', barIndex, price })
      return
    }
    this.position = {
      direction: order.direction,
      lots: [lot],
      stopPrice: order.plannedStop,
      targetPrice: null,
      stopHistory: order.plannedStop === null ? [] : [{ barIndex, price: order.plannedStop }],
      declaredStopStyle: order.declaredStopStyle,
      scenarioAtEntry: order.scenario,
      entryOrderPrice: order.price,
      entryOrderBarIndex: order.placedBarIndex,
      maxFavorablePrice: price,
    }
    this.events.push({ type: 'entry-fill', barIndex, price, direction: order.direction })
  }

  /**
   * Advance one bar, walking its intrabar path segment by segment so that
   * entry/stop/target hits resolve in the order price actually moved.
   */
  stepBar(bar: Bar, barIndex: number) {
    for (let t = 0; t < bar.path.length; t++) this.stepTick(bar, barIndex, t)
  }

  /**
   * Process a single intrabar tick (used by live replay so fills, stop-outs,
   * and adds land mid-bar exactly when price crosses them).
   */
  stepTick(bar: Bar, barIndex: number, tickIdx: number) {
    const price = bar.path[tickIdx]
    const from = tickIdx === 0 ? this.lastPrice : bar.path[tickIdx - 1]
    if (from !== null) {
      // The segment from the prior close to the open is the gap: orders
      // jumped over by a gap fill at the open, not at their own price.
      const gapFill = tickIdx === 0 ? bar.open : null
      this.crossSegment(from, price, gapFill, bar, barIndex)
    }
    if (this.position) {
      this.position.maxFavorablePrice =
        this.position.direction === 'long'
          ? Math.max(this.position.maxFavorablePrice, price)
          : Math.min(this.position.maxFavorablePrice, price)
    }
    if (tickIdx === bar.path.length - 1) this.lastPrice = bar.close
  }

  /** Trigger every order/stop/target whose level lies on [from→to], in crossing order. */
  private crossSegment(from: number, to: number, gapFillPrice: number | null, bar: Bar, barIndex: number) {
    const up = to >= from
    type Hit = { level: number; kind: 'stop' | 'target' | 'order'; order?: EntryOrder }
    for (;;) {
      const hits: Hit[] = []
      const within = (level: number) =>
        up ? level > from && level <= to : level < from && level >= to
      const p = this.position
      if (p) {
        if (p.stopPrice !== null) {
          const hit = p.direction === 'long' ? !up && within(p.stopPrice) : up && within(p.stopPrice)
          if (hit) hits.push({ level: p.stopPrice, kind: 'stop' })
        }
        if (p.targetPrice !== null) {
          const hit = p.direction === 'long' ? up && within(p.targetPrice) : !up && within(p.targetPrice)
          if (hit) hits.push({ level: p.targetPrice, kind: 'target' })
        }
      }
      for (const o of this.pendingOrders) {
        if (o.isAdd && (!p || p.direction !== o.direction)) continue
        if (!o.isAdd && p) continue // one position at a time
        const hit = o.direction === 'long' ? up && within(o.price) : !up && within(o.price)
        if (hit) hits.push({ level: o.price, kind: 'order', order: o })
      }
      if (!hits.length) return
      hits.sort((a, b) => (up ? a.level - b.level : b.level - a.level))
      const first = hits[0]
      const fillPrice = round2(gapFillPrice ?? first.level)
      if (first.kind === 'stop') {
        this.exit(fillPrice, barIndex, bar.time, 'stop')
      } else if (first.kind === 'target') {
        this.exit(fillPrice, barIndex, bar.time, 'target')
      } else {
        this.fillEntry(first.order!, fillPrice, barIndex, bar.time)
      }
      // Re-scan the same segment: a fill can activate the position's stop/target
      // or invalidate remaining orders within this very segment.
      from = first.level
      if (up ? from >= to : from <= to) return
    }
  }
}

/** Total P&L of a closed trade in price terms (per share, qty-weighted). */
export function tradePnl(trade: Trade): number {
  const sign = trade.direction === 'long' ? 1 : -1
  return round2(
    trade.lots.reduce((sum, lot) => sum + sign * (trade.exitPrice - lot.price) * lot.qty, 0),
  )
}

/** R-multiple: P&L relative to the dollars risked on the initial lot. */
export function tradeR(trade: Trade): number | null {
  if (!trade.initialRisk) return null
  const riskDollars = trade.initialRisk * trade.lots[0].qty
  return Math.round((tradePnl(trade) / riskDollars) * 100) / 100
}
