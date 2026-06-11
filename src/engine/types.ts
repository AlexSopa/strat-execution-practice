export interface Bar {
  time: number
  open: number
  high: number
  low: number
  close: number
  /** Ordered intrabar prices from open to close; min === low, max === high. */
  path: number[]
}

export type BarType = '1' | '2u' | '2d' | '3'
export type Shape = 'hammer' | 'shooter' | 'doji' | 'plain'
export type Direction = 'long' | 'short'
export type Scenario = '2-2' | '2-1-2' | '3-1-2' | '1-2-2' | '3-2-2'

export interface ArmedSetup {
  scenario: Scenario
  direction: Direction
  /** Index of the bar whose break is the entry trigger (the last closed bar of the armed pattern). */
  index: number
  /** Entry stop price: arming bar high + 0.01 (long) / low - 0.01 (short). */
  trigger: number
  /** Spread + 0.01 stop: opposite extreme of the arming bar. */
  tightStop: number
  /** Setup stop: extreme of the whole pattern. */
  setupStop: number
  /** Index of the first bar in the pattern. */
  patternStart: number
}

export type StopStyle = 'tight' | 'setup'

export interface Lot {
  price: number
  qty: number
  time: number
  barIndex: number
  isAdd: boolean
}

export interface Trade {
  direction: Direction
  lots: Lot[]
  exitPrice: number
  exitTime: number
  exitBarIndex: number
  exitReason: 'stop' | 'target' | 'manual' | 'session-end'
  /** Risk per share at entry (entry - initial stop), for R math. */
  initialRisk: number
  stopHistory: { barIndex: number; price: number }[]
  declaredStopStyle: StopStyle
  scenarioAtEntry: Scenario | null
  entryOrderPrice: number
  entryOrderBarIndex: number
  maxFavorablePrice: number
}
