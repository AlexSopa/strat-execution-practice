import { tradeR } from './broker'
import { armedSetupsAt, expectedTrailStop, isValidAddBar } from './strat'
import type { ArmedSetup, Bar, BarType, Scenario, Trade } from './types'

export interface TradeGrade {
  entry: number
  stops: number
  management: number
  r: number | null
  scenario: Scenario | null
  notes: string[]
}

export interface SessionReport {
  trades: TradeGrade[]
  entryAvg: number
  stopsAvg: number
  managementAvg: number
  overall: number
  totalR: number
  winRate: number | null
  byScenario: Partial<Record<Scenario, { count: number; totalR: number }>>
}

const LEVEL_TOL = 0.02
const STOP_TOL = 0.03

function matchSetup(trade: Trade, bars: Bar[], types: (BarType | null)[]): ArmedSetup | null {
  const setups = armedSetupsAt(bars, types, trade.entryOrderBarIndex).filter(
    (s) => s.direction === trade.direction,
  )
  if (!setups.length) return null
  setups.sort(
    (a, b) => Math.abs(a.trigger - trade.entryOrderPrice) - Math.abs(b.trigger - trade.entryOrderPrice),
  )
  return setups[0]
}

export function gradeTrade(trade: Trade, bars: Bar[], types: (BarType | null)[]): TradeGrade {
  const notes: string[] = []
  const long = trade.direction === 'long'
  const setup = matchSetup(trade, bars, types)

  // ---- Entry: right setup, right level, placed before the break ----
  let entry: number
  if (!setup) {
    entry = 15
    notes.push('No armed reversal setup on the bar where the entry order was placed — that was a chase.')
  } else {
    const diff = Math.abs(trade.entryOrderPrice - setup.trigger)
    if (diff <= LEVEL_TOL) {
      entry = 100
    } else if (diff <= 0.1) {
      entry = 75
      notes.push(`Entry was ${diff.toFixed(2)} away from the ${setup.scenario} trigger ${setup.trigger.toFixed(2)}.`)
    } else {
      entry = 45
      notes.push(`Entry level ${trade.entryOrderPrice.toFixed(2)} is far from the ${setup.scenario} trigger ${setup.trigger.toFixed(2)}.`)
    }
  }

  // ---- Stops: initial stop matches the declared style; never widened ----
  let stops = 0
  const initialStop = trade.stopHistory.length ? trade.stopHistory[0] : null
  if (!initialStop) {
    notes.push('Traded with no stop in place.')
  } else {
    if (setup) {
      const expected = trade.declaredStopStyle === 'tight' ? setup.tightStop : setup.setupStop
      const diff = Math.abs(initialStop.price - expected)
      if (diff <= STOP_TOL) stops += 70
      else if (diff <= 0.1) {
        stops += 50
        notes.push(`Initial stop ${initialStop.price.toFixed(2)} drifts from the ${trade.declaredStopStyle} stop ${expected.toFixed(2)}.`)
      } else {
        stops += 25
        notes.push(`Initial stop ${initialStop.price.toFixed(2)} doesn't match the declared ${trade.declaredStopStyle} stop ${expected.toFixed(2)}.`)
      }
    } else {
      stops += 40
    }
    const widened = trade.stopHistory.some((s, k) => {
      if (k === 0) return false
      const prev = trade.stopHistory[k - 1].price
      return long ? s.price < prev - 0.001 : s.price > prev + 0.001
    })
    if (widened) notes.push('Stop was widened after entry — never give a trade more room.')
    else stops += 30
  }

  // ---- Management: trail under each continuation bar, capture the move, add well ----
  const entryBarIndex = trade.lots[0].barIndex
  let obligations = 0
  let met = 0
  for (let i = entryBarIndex; i < trade.exitBarIndex && i < bars.length; i++) {
    const want = expectedTrailStop(bars, types, i, trade.direction)
    if (want === null) continue
    const stopAtBar = [...trade.stopHistory].filter((s) => s.barIndex <= i).pop()
    const already = stopAtBar !== undefined && (long ? stopAtBar.price >= want - STOP_TOL : stopAtBar.price <= want + STOP_TOL)
    const improves = stopAtBar === undefined || (long ? want > stopAtBar.price : want < stopAtBar.price)
    if (already || !improves) continue
    obligations++
    const trailed = trade.stopHistory.some(
      (s) => s.barIndex >= i && s.barIndex <= i + 1 && (long ? s.price >= want - STOP_TOL : s.price <= want + STOP_TOL),
    )
    if (trailed) met++
  }
  let management = obligations === 0 ? 60 : Math.round((met / obligations) * 60)
  if (obligations > 0 && met < obligations) {
    notes.push(`Trailed ${met} of ${obligations} continuation bars — keep moving the stop with each 2 in your favor.`)
  }

  const r = tradeR(trade)
  const firstLot = trade.lots[0]
  const mfeR = trade.initialRisk
    ? Math.abs(trade.maxFavorablePrice - firstLot.price) / trade.initialRisk
    : 0
  // Giving back the last leg is the cost of disciplined trailing — a fully
  // trailed trade earns full capture credit no matter where the top was.
  const fullyTrailed = obligations > 0 && met === obligations
  const cleanInitialStopOut = obligations === 0 && trade.exitReason === 'stop'
  if (mfeR >= 1 && r !== null && !fullyTrailed && !cleanInitialStopOut) {
    const captured = Math.max(0, r) / mfeR
    management += Math.round(Math.min(1, captured) * 25)
    if (captured < 0.4) notes.push(`Trade ran ${mfeR.toFixed(1)}R in your favor but you kept ${Math.max(0, r).toFixed(1)}R.`)
  } else {
    management += 25
  }

  const adds = trade.lots.slice(1)
  const badAdds = adds.filter(
    (lot) => lot.barIndex < 1 || !isValidAddBar(types, lot.barIndex - 1, trade.direction),
  )
  if (adds.length && badAdds.length) {
    management += 5
    notes.push(`${badAdds.length} add(s) weren't at a fresh actionable signal (inside-bar break or pullback reversal).`)
  } else {
    management += 15
  }

  return {
    entry,
    stops,
    management: Math.min(100, management),
    r,
    scenario: setup?.scenario ?? trade.scenarioAtEntry,
    notes,
  }
}

export function gradeSession(trades: Trade[], bars: Bar[], types: (BarType | null)[]): SessionReport {
  const grades = trades.map((tr) => gradeTrade(tr, bars, types))
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const rs = grades.map((g) => g.r).filter((r): r is number => r !== null)
  const byScenario: SessionReport['byScenario'] = {}
  for (const g of grades) {
    if (!g.scenario) continue
    const slot = (byScenario[g.scenario] ??= { count: 0, totalR: 0 })
    slot.count++
    slot.totalR = Math.round((slot.totalR + (g.r ?? 0)) * 100) / 100
  }
  const entryAvg = avg(grades.map((g) => g.entry))
  const stopsAvg = avg(grades.map((g) => g.stops))
  const managementAvg = avg(grades.map((g) => g.management))
  return {
    trades: grades,
    entryAvg,
    stopsAvg,
    managementAvg,
    overall: avg([entryAvg, stopsAvg, managementAvg]),
    totalR: Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100,
    winRate: rs.length ? Math.round((rs.filter((r) => r > 0).length / rs.length) * 100) : null,
    byScenario,
  }
}
