import type { ArmedSetup, Bar, BarType, Direction, Shape } from './types'

export const TICK = 0.01

const round2 = (n: number) => Math.round(n * 100) / 100

export function classifyBar(prev: Bar, cur: Bar): BarType {
  const brokeHigh = cur.high > prev.high
  const brokeLow = cur.low < prev.low
  if (brokeHigh && brokeLow) return '3'
  if (brokeHigh) return '2u'
  if (brokeLow) return '2d'
  return '1'
}

/** types[0] is null — the first bar has no prior bar to compare against. */
export function classifySeries(bars: Bar[]): (BarType | null)[] {
  return bars.map((b, i) => (i === 0 ? null : classifyBar(bars[i - 1], b)))
}

export function classifyShape(bar: Bar): Shape {
  const range = bar.high - bar.low
  if (range <= 0) return 'doji'
  const bodyTop = Math.max(bar.open, bar.close)
  const bodyBottom = Math.min(bar.open, bar.close)
  if (bodyBottom >= bar.high - range / 3) return 'hammer'
  if (bodyTop <= bar.low + range / 3) return 'shooter'
  if (bodyTop - bodyBottom <= range * 0.1) return 'doji'
  return 'plain'
}

const isRed = (b: Bar) => b.close < b.open

/**
 * Reversal setups armed as of the close of bar `i`. The entry is a stop order
 * at the break of bar `i`'s extreme; the reversal completes when it fills.
 *
 * Bullish patterns (mirrored for bearish):
 *   2-2:   [2d]            → buy stop over its high
 *   2-1-2: [2d][1]         → buy stop over the inside bar's high
 *   3-1-2: [3 red][1]      → buy stop over the inside bar's high
 *   1-2-2: [1][2d]         → buy stop over the 2d's high
 *   3-2-2: [3][2d]         → buy stop over the 2d's high
 *
 * When a 2d follows a 1 or a 3 the more specific scenario (1-2-2 / 3-2-2)
 * is reported instead of the plain 2-2.
 */
export function armedSetupsAt(bars: Bar[], types: (BarType | null)[], i: number): ArmedSetup[] {
  const out: ArmedSetup[] = []
  if (i < 1 || i >= bars.length) return out
  const t = types[i]
  const tPrev = i >= 2 ? types[i - 1] : null
  const cur = bars[i]

  const make = (
    scenario: ArmedSetup['scenario'],
    direction: Direction,
    patternStart: number,
  ): ArmedSetup => {
    const patternBars = bars.slice(patternStart, i + 1)
    const patternLow = Math.min(...patternBars.map((b) => b.low))
    const patternHigh = Math.max(...patternBars.map((b) => b.high))
    return direction === 'long'
      ? {
          scenario,
          direction,
          index: i,
          trigger: round2(cur.high + TICK),
          tightStop: round2(cur.low - TICK),
          setupStop: round2(patternLow - TICK),
          patternStart,
        }
      : {
          scenario,
          direction,
          index: i,
          trigger: round2(cur.low - TICK),
          tightStop: round2(cur.high + TICK),
          setupStop: round2(patternHigh + TICK),
          patternStart,
        }
  }

  if (t === '1') {
    if (tPrev === '2d') out.push(make('2-1-2', 'long', i - 1))
    if (tPrev === '2u') out.push(make('2-1-2', 'short', i - 1))
    if (tPrev === '3') {
      // A red outside bar reverses up through the inside bar; green reverses down.
      if (isRed(bars[i - 1])) out.push(make('3-1-2', 'long', i - 1))
      else out.push(make('3-1-2', 'short', i - 1))
    }
  } else if (t === '2d') {
    if (tPrev === '1') out.push(make('1-2-2', 'long', i - 1))
    else if (tPrev === '3') out.push(make('3-2-2', 'long', i - 1))
    else out.push(make('2-2', 'long', i))
  } else if (t === '2u') {
    if (tPrev === '1') out.push(make('1-2-2', 'short', i - 1))
    else if (tPrev === '3') out.push(make('3-2-2', 'short', i - 1))
    else out.push(make('2-2', 'short', i))
  }

  return out
}

/**
 * Magnitude target: the most recent pivot beyond the arming bar's extreme —
 * a prior pivot high above (long) or pivot low below (short).
 */
export function magnitudeTarget(bars: Bar[], i: number, direction: Direction): number | null {
  for (let k = i - 1; k >= 1; k--) {
    if (k + 1 >= bars.length) continue
    if (direction === 'long') {
      if (
        bars[k].high > bars[k - 1].high &&
        bars[k].high >= bars[k + 1].high &&
        bars[k].high > bars[i].high
      ) {
        return bars[k].high
      }
    } else {
      if (
        bars[k].low < bars[k - 1].low &&
        bars[k].low <= bars[k + 1].low &&
        bars[k].low < bars[i].low
      ) {
        return bars[k].low
      }
    }
  }
  return null
}

/**
 * Whether bar `i` arms a valid add-to-winner trigger for an open position:
 * a new actionable signal in the trade's direction — an inside bar break or
 * a pullback bar (2d in a long, 2u in a short) reversing back.
 */
export function isValidAddBar(types: (BarType | null)[], i: number, direction: Direction): boolean {
  const t = types[i]
  if (t === '1') return true
  return direction === 'long' ? t === '2d' : t === '2u'
}

/**
 * The stop a disciplined trader should have after bar `i` closes in their favor:
 * under each successive 2u low (long) / over each 2d high (short).
 * Returns null if bar `i` is not a continuation bar in the trade's direction.
 */
export function expectedTrailStop(
  bars: Bar[],
  types: (BarType | null)[],
  i: number,
  direction: Direction,
): number | null {
  const t = types[i]
  if (direction === 'long' && (t === '2u' || t === '3') && bars[i].close > bars[i].open) {
    return round2(bars[i].low - TICK)
  }
  if (direction === 'short' && (t === '2d' || t === '3') && bars[i].close < bars[i].open) {
    return round2(bars[i].high + TICK)
  }
  return null
}
