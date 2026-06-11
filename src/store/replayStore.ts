import { create } from 'zustand'
import { Broker } from '../engine/broker'
import { generateSession } from '../engine/candleGen'
import type { Session } from '../engine/candleGen'
import { gradeSession } from '../engine/grader'
import type { SessionReport } from '../engine/grader'
import {
  TICK,
  armedSetupsAt,
  classifySeries,
  expectedTrailStop,
  isValidAddBar,
} from '../engine/strat'
import type { ArmedSetup, BarType, Direction, StopStyle } from '../engine/types'
import { recordSession } from './persist'

/** Bars revealed before the trader takes over — enough context to read structure. */
const WARMUP_BARS = 15

interface ReplayStore {
  seed: number
  session: Session
  types: (BarType | null)[]
  index: number
  playing: boolean
  speedMs: number
  stopStyle: StopStyle
  hints: boolean
  broker: Broker
  report: SessionReport | null
  finished: boolean
  /** Bumped after every broker mutation so React re-renders. */
  version: number

  newSession: (seed?: number) => void
  step: () => void
  setPlaying: (p: boolean) => void
  setSpeedMs: (ms: number) => void
  setStopStyle: (s: StopStyle) => void
  setHints: (h: boolean) => void
  placeEntry: (direction: Direction, price: number, stop: number) => void
  cancelOrder: (id: number) => void
  setStop: (price: number) => void
  setTarget: (price: number | null) => void
  trailStop: () => void
  placeAdd: () => void
  flatten: () => void
}

function freshSession(seed: number) {
  const session = generateSession({ seed, barCount: 180 })
  const types = classifySeries(session.bars)
  const broker = new Broker()
  for (let i = 0; i < WARMUP_BARS; i++) broker.stepBar(session.bars[i], i)
  return { session, types, broker, index: WARMUP_BARS - 1 }
}

export const useReplayStore = create<ReplayStore>((set, get) => {
  const init = freshSession(Math.floor(Math.random() * 1_000_000))

  const finish = () => {
    const { broker, session, types, index } = get()
    const last = session.bars[index]
    broker.closeAll(last.close, index, last.time, 'session-end')
    const report = gradeSession(broker.trades, session.bars, types)
    recordSession({
      date: new Date().toISOString(),
      seed: get().seed,
      trades: report.trades.length,
      totalR: report.totalR,
      winRate: report.winRate,
      entryAvg: report.entryAvg,
      stopsAvg: report.stopsAvg,
      managementAvg: report.managementAvg,
      overall: report.overall,
    })
    set((s) => ({ report, finished: true, playing: false, version: s.version + 1 }))
  }

  return {
    seed: init.session.seed,
    session: init.session,
    types: init.types,
    index: init.index,
    playing: false,
    speedMs: 1200,
    stopStyle: 'tight',
    hints: false,
    broker: init.broker,
    report: null,
    finished: false,
    version: 0,

    newSession: (seed) => {
      const s = seed ?? Math.floor(Math.random() * 1_000_000)
      const fresh = freshSession(s)
      set((st) => ({
        seed: s,
        session: fresh.session,
        types: fresh.types,
        broker: fresh.broker,
        index: fresh.index,
        playing: false,
        report: null,
        finished: false,
        version: st.version + 1,
      }))
    },

    step: () => {
      const { index, session, broker, finished } = get()
      if (finished) return
      if (index >= session.bars.length - 1) {
        finish()
        return
      }
      const next = index + 1
      broker.stepBar(session.bars[next], next)
      set((s) => ({ index: next, version: s.version + 1 }))
      if (next >= session.bars.length - 1) finish()
    },

    setPlaying: (playing) => set({ playing }),
    setSpeedMs: (speedMs) => set({ speedMs }),
    setStopStyle: (stopStyle) => set({ stopStyle }),
    setHints: (hints) => set({ hints }),

    placeEntry: (direction, price, stop) => {
      const { broker, index, session, types, stopStyle } = get()
      const setup = armedSetupsAt(session.bars, types, index).find((s) => s.direction === direction)
      broker.placeOrder({
        direction,
        price,
        qty: 100,
        isAdd: false,
        placedBarIndex: index,
        plannedStop: stop,
        declaredStopStyle: stopStyle,
        scenario: setup?.scenario ?? null,
      })
      set((s) => ({ version: s.version + 1 }))
    },

    cancelOrder: (id) => {
      const { broker } = get()
      broker.cancelOrder(id)
      set((s) => ({ version: s.version + 1 }))
    },

    setStop: (price) => {
      const { broker, index } = get()
      broker.setStop(price, index)
      set((s) => ({ version: s.version + 1 }))
    },

    setTarget: (price) => {
      const { broker } = get()
      broker.setTarget(price)
      set((s) => ({ version: s.version + 1 }))
    },

    trailStop: () => {
      const { broker, index, session, types } = get()
      const pos = broker.position
      if (!pos) return
      const entryBar = pos.lots[0].barIndex
      for (let i = index; i >= entryBar; i--) {
        const want = expectedTrailStop(session.bars, types, i, pos.direction)
        if (want === null) continue
        const improves =
          pos.stopPrice === null ||
          (pos.direction === 'long' ? want > pos.stopPrice : want < pos.stopPrice)
        if (improves) {
          broker.setStop(want, index)
          set((s) => ({ version: s.version + 1 }))
        }
        return
      }
    },

    placeAdd: () => {
      const { broker, index, session, types } = get()
      const pos = broker.position
      if (!pos || !isValidAddBar(types, index, pos.direction)) return
      const last = session.bars[index]
      broker.placeOrder({
        direction: pos.direction,
        price:
          pos.direction === 'long'
            ? Math.round((last.high + TICK) * 100) / 100
            : Math.round((last.low - TICK) * 100) / 100,
        qty: 100,
        isAdd: true,
        placedBarIndex: index,
        plannedStop: null,
        declaredStopStyle: pos.declaredStopStyle,
        scenario: null,
      })
      set((s) => ({ version: s.version + 1 }))
    },

    flatten: () => {
      const { broker, index, session } = get()
      const last = session.bars[index]
      broker.closeAll(last.close, index, last.time, 'manual')
      set((s) => ({ version: s.version + 1 }))
    },
  }
})

/** Setups armed on the current bar — used for hints and stop suggestions. */
export function useArmedSetups(): ArmedSetup[] {
  const session = useReplayStore((s) => s.session)
  const types = useReplayStore((s) => s.types)
  const index = useReplayStore((s) => s.index)
  return armedSetupsAt(session.bars, types, index)
}
