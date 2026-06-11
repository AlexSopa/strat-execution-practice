import { useMemo, useState } from 'react'
import CandleChart from '../../components/CandleChart'
import type { ChartMarker, ChartPriceLine } from '../../components/CandleChart'
import { SCENARIOS, makeBar, mulberry32, patternSpecs } from '../../engine/candleGen'
import type { Rng } from '../../engine/candleGen'
import { armedSetupsAt, classifySeries, classifyShape } from '../../engine/strat'
import type { ArmedSetup, Bar, BarType, Scenario } from '../../engine/types'
import { loadStats, recordQuizAnswer } from '../../store/persist'

interface Question {
  bars: Bar[]
  types: (BarType | null)[]
  setup: ArmedSetup | null // null → "no reversal armed"
}

function firstBar(rng: Rng): Bar {
  const o = 100 + (rng() - 0.5) * 4
  const r = 1.2 + rng()
  const open = Math.round(o * 100) / 100
  const high = Math.round((o + r * 0.6) * 100) / 100
  const low = Math.round((o - r * 0.4) * 100) / 100
  const close = Math.round((o + r * 0.1) * 100) / 100
  return { time: 1704207600, open, high, low, close, path: [open, low, high, close] }
}

function weightedScenario(rng: Rng): Scenario {
  const misses = loadStats().quiz.missesByScenario
  const weights = SCENARIOS.map((s) => 1 + (misses[s] ?? 0))
  let x = rng() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < SCENARIOS.length; i++) {
    x -= weights[i]
    if (x <= 0) return SCENARIOS[i]
  }
  return SCENARIOS[SCENARIOS.length - 1]
}

function generateQuestion(seed: number): Question {
  const rng = mulberry32(seed)
  const bars: Bar[] = [firstBar(rng)]
  const contextTypes: BarType[] = ['2u', '2d', '1', '3']
  const contextLen = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < contextLen; i++) {
    bars.push(makeBar(rng, bars[bars.length - 1], { type: contextTypes[Math.floor(rng() * contextTypes.length)] }))
  }
  if (rng() < 0.72) {
    const scenario = weightedScenario(rng)
    const dir = rng() < 0.5 ? 'long' : 'short'
    for (const spec of patternSpecs(rng, scenario, dir)) {
      bars.push(makeBar(rng, bars[bars.length - 1], spec))
    }
  } else {
    // Decoy: end on a bar that arms nothing — a 3, or a 1 after a 1.
    if (rng() < 0.5) {
      bars.push(makeBar(rng, bars[bars.length - 1], { type: '3' }))
    } else {
      bars.push(makeBar(rng, bars[bars.length - 1], { type: '1' }))
      bars.push(makeBar(rng, bars[bars.length - 1], { type: '1' }))
    }
  }
  const types = classifySeries(bars)
  const setups = armedSetupsAt(bars, types, bars.length - 1)
  return { bars, types, setup: setups[0] ?? null }
}

const TYPE_COLORS: Record<string, string> = { '1': '#9aa4b2', '2u': '#26a69a', '2d': '#ef5350', '3': '#f5a623' }

type Phase = 'scenario' | 'side' | 'level' | 'reveal'

export default function QuizMode() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [phase, setPhase] = useState<Phase>('scenario')
  const [scenarioPick, setScenarioPick] = useState<Scenario | 'none' | null>(null)
  const [sidePick, setSidePick] = useState<'long' | 'short' | null>(null)
  const [levelPick, setLevelPick] = useState<number | null>(null)
  const [streak, setStreak] = useState(0)
  const [score, setScore] = useState({ asked: 0, correct: 0 })

  const q = useMemo(() => generateQuestion(seed), [seed])
  const last = q.bars[q.bars.length - 1]
  const tolerance = Math.max(0.06, (last.high - last.low) * 0.2)

  const scenarioCorrect = scenarioPick !== null && (q.setup ? scenarioPick === q.setup.scenario : scenarioPick === 'none')
  const sideCorrect = q.setup ? sidePick === q.setup.direction : true
  const levelCorrect = q.setup && levelPick !== null ? Math.abs(levelPick - q.setup.trigger) <= tolerance : true
  const allCorrect = scenarioCorrect && sideCorrect && levelCorrect

  const finishQuestion = (sc: boolean, si: boolean, lv: boolean) => {
    recordQuizAnswer({
      scenarioCorrect: sc,
      sideCorrect: si,
      levelCorrect: lv,
      actualScenario: q.setup?.scenario ?? 'none',
    })
    setScore((s) => ({ asked: s.asked + 1, correct: s.correct + (sc && si && lv ? 1 : 0) }))
    setStreak((st) => (sc && si && lv ? st + 1 : 0))
    setPhase('reveal')
  }

  const next = () => {
    setSeed(Math.floor(Math.random() * 1_000_000))
    setPhase('scenario')
    setScenarioPick(null)
    setSidePick(null)
    setLevelPick(null)
  }

  const markers: ChartMarker[] = useMemo(() => {
    if (phase !== 'reveal') return []
    return q.bars.slice(1).map((b, k) => {
      const t = q.types[k + 1]
      const shape = classifyShape(b)
      const suffix = shape === 'hammer' ? ' H' : shape === 'shooter' ? ' S' : shape === 'doji' ? ' D' : ''
      return { time: b.time, text: (t ?? '') + suffix, above: t === '2u' || t === '3', color: TYPE_COLORS[t ?? '1'] }
    })
  }, [phase, q])

  const priceLines: ChartPriceLine[] = useMemo(() => {
    const lines: ChartPriceLine[] = []
    if (phase === 'reveal' && q.setup) {
      lines.push({
        price: q.setup.trigger,
        color: q.setup.direction === 'long' ? '#26a69a' : '#ef5350',
        title: `${q.setup.scenario} trigger`,
        dashed: true,
      })
      lines.push({ price: q.setup.tightStop, color: '#ef5350', title: 'tight stop', dashed: true })
      if (q.setup.setupStop !== q.setup.tightStop) {
        lines.push({ price: q.setup.setupStop, color: '#b06ab3', title: 'setup stop', dashed: true })
      }
    }
    if (levelPick !== null) lines.push({ price: levelPick, color: '#4d9fff', title: 'your level' })
    return lines
  }, [phase, q, levelPick])

  const explanation = () => {
    if (!q.setup) {
      const t = q.types[q.bars.length - 1]
      return t === '3'
        ? 'The last bar is a 3 (outside bar) — wait for the next bar before arming anything.'
        : 'The last bar is an inside 1 after another non-directional bar — no reversal is armed yet.'
    }
    const s = q.setup
    return `${s.scenario} ${s.direction} armed: ${s.direction === 'long' ? 'buy' : 'sell'} stop at ${s.trigger.toFixed(2)} (last bar ${s.direction === 'long' ? 'high' : 'low'} ± 0.01). Stops: ${s.tightStop.toFixed(2)} tight (spread + 0.01) or ${s.setupStop.toFixed(2)} at the setup extreme.`
  }

  return (
    <div className="quiz-layout">
      <div className="panel">
        <CandleChart
          bars={q.bars}
          markers={markers}
          priceLines={priceLines}
          fit
          height={380}
          onPriceClick={
            phase === 'level'
              ? (price) => {
                  setLevelPick(price)
                  const lv = q.setup ? Math.abs(price - q.setup.trigger) <= tolerance : true
                  finishQuestion(scenarioCorrect, sideCorrect, lv)
                }
              : undefined
          }
        />
      </div>
      <div className="side-panel">
        <div className="card">
          <div className="quiz-score">
            <span>
              Score {score.correct}/{score.asked}
            </span>
            <span>🔥 {streak}</span>
          </div>

          {phase === 'scenario' && (
            <>
              <h3>What's armed on the last bar?</h3>
              <div className="btn-stack">
                {SCENARIOS.map((s) => (
                  <button
                    key={s}
                    className="btn"
                    onClick={() => {
                      setScenarioPick(s)
                      const sc = q.setup ? s === q.setup.scenario : false
                      if (!q.setup) finishQuestion(sc, true, true)
                      else setPhase('side')
                    }}
                  >
                    {s} reversal
                  </button>
                ))}
                <button
                  className="btn btn-muted"
                  onClick={() => {
                    setScenarioPick('none')
                    finishQuestion(q.setup === null, q.setup === null, q.setup === null)
                  }}
                >
                  No reversal armed
                </button>
              </div>
            </>
          )}

          {phase === 'side' && (
            <>
              <h3>Which side?</h3>
              <div className="btn-stack">
                <button
                  className="btn btn-green"
                  onClick={() => {
                    setSidePick('long')
                    setPhase('level')
                  }}
                >
                  Long — buy the break
                </button>
                <button
                  className="btn btn-red"
                  onClick={() => {
                    setSidePick('short')
                    setPhase('level')
                  }}
                >
                  Short — sell the break
                </button>
              </div>
            </>
          )}

          {phase === 'level' && (
            <>
              <h3>Click the trigger level on the chart</h3>
              <p className="muted small">Where exactly does your stop order go?</p>
            </>
          )}

          {phase === 'reveal' && (
            <>
              <h3 className={allCorrect ? 'green' : 'red'}>{allCorrect ? 'Correct ✓' : 'Not quite'}</h3>
              {!scenarioCorrect && (
                <p className="small red">
                  Scenario: you said {scenarioPick === 'none' ? 'no setup' : scenarioPick}, it was{' '}
                  {q.setup ? q.setup.scenario : 'no setup'}.
                </p>
              )}
              {q.setup && !sideCorrect && sidePick !== null && (
                <p className="small red">Side: it reverses {q.setup.direction}, not {sidePick}.</p>
              )}
              {q.setup && levelPick !== null && !levelCorrect && (
                <p className="small red">
                  Level: you clicked {levelPick.toFixed(2)}, trigger is {q.setup.trigger.toFixed(2)}.
                </p>
              )}
              <p className="small">{explanation()}</p>
              <button className="btn btn-green" onClick={next}>
                Next question →
              </button>
            </>
          )}
        </div>
        <div className="card muted small">
          Reversal cheat sheet: <strong>2-2</strong> a 2 against the move, break it back · <strong>2-1-2</strong>{' '}
          2, inside pause, break the other way · <strong>3-1-2</strong> outside bar, pause, reverse ·{' '}
          <strong>1-2-2</strong> inside, failed break, reverse · <strong>3-2-2</strong> outside bar, failed
          continuation, reverse.
        </div>
      </div>
    </div>
  )
}
