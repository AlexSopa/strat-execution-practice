import { useEffect, useMemo, useState } from 'react'
import CandleChart from '../../components/CandleChart'
import type { ChartMarker, ChartPriceLine } from '../../components/CandleChart'
import { tradePnl, tradeR } from '../../engine/broker'
import { TICK, classifyShape, magnitudeTarget, isValidAddBar, expectedTrailStop } from '../../engine/strat'
import type { Direction } from '../../engine/types'
import { currentPrice, useArmedSetups, useReplayStore } from '../../store/replayStore'
import ReportCard from './ReportCard'

const round2 = (n: number) => Math.round(n * 100) / 100

const TYPE_COLORS: Record<string, string> = {
  '1': '#9aa4b2',
  '2u': '#26a69a',
  '2d': '#ef5350',
  '3': '#f5a623',
}

export default function ReplayMode() {
  const store = useReplayStore()
  const armed = useArmedSetups()
  const { session, types, index, tick, broker, playing, speedMs, hints, finished } = store
  const [showTypes, setShowTypes] = useState(true)
  const [seedInput, setSeedInput] = useState('')

  // Closed bars plus the live developing bar aggregated from its ticks so far.
  const visible = useMemo(() => {
    const closed = session.bars.slice(0, index + 1)
    const dev = session.bars[index + 1]
    if (tick > 0 && dev) {
      const seen = dev.path.slice(0, tick)
      closed.push({
        ...dev,
        high: Math.max(...seen),
        low: Math.min(...seen),
        close: seen[seen.length - 1],
      })
    }
    return closed
  }, [session, index, tick])

  useEffect(() => {
    if (!playing || finished) return
    const id = setInterval(() => useReplayStore.getState().stepTick(), speedMs)
    return () => clearInterval(id)
  }, [playing, speedMs, finished])

  const markers: ChartMarker[] = useMemo(() => {
    if (!showTypes) return []
    // Only closed bars get labels — the developing bar's type isn't known yet.
    const closed = session.bars.slice(0, index + 1)
    const start = Math.max(1, closed.length - 70)
    return closed.slice(start).map((b, k) => {
      const i = start + k
      const t = types[i]
      const shape = classifyShape(b)
      const suffix = shape === 'hammer' ? ' H' : shape === 'shooter' ? ' S' : shape === 'doji' ? ' D' : ''
      return {
        time: b.time,
        text: (t ?? '') + suffix,
        above: t === '2u' || t === '3',
        color: TYPE_COLORS[t ?? '1'],
      }
    })
  }, [index, types, session, showTypes])

  const priceLines: ChartPriceLine[] = useMemo(() => {
    const lines: ChartPriceLine[] = []
    for (const o of broker.pendingOrders) {
      lines.push({
        price: o.price,
        color: '#4d9fff',
        title: `${o.isAdd ? 'add' : 'entry'} ${o.direction === 'long' ? 'buy' : 'sell'} stop`,
        dashed: true,
      })
    }
    const pos = broker.position
    if (pos) {
      const avg = pos.lots.reduce((a, l) => a + l.price * l.qty, 0) / pos.lots.reduce((a, l) => a + l.qty, 0)
      lines.push({ price: round2(avg), color: '#e0e6f0', title: 'avg entry' })
      if (pos.stopPrice !== null) lines.push({ price: pos.stopPrice, color: '#ef5350', title: 'stop' })
      if (pos.targetPrice !== null) lines.push({ price: pos.targetPrice, color: '#26a69a', title: 'target', dashed: true })
    }
    if (hints) {
      for (const s of armed) {
        lines.push({
          price: s.trigger,
          color: s.direction === 'long' ? '#26a69a' : '#ef5350',
          title: `${s.scenario} ${s.direction} trigger`,
          dashed: true,
        })
      }
    }
    return lines
  }, [broker, hints, armed, store.version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="replay-layout">
      <div className="panel chart-panel">
        <CandleChart bars={visible} markers={markers} priceLines={priceLines} followLatest height={480} />
        <div className="transport">
          <button className="btn" onClick={() => store.setPlaying(!playing)} disabled={finished}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className="btn" onClick={() => store.nextBar()} disabled={finished}>
            Next bar ▶
          </button>
          <label>
            Speed
            <select value={speedMs} onChange={(e) => store.setSpeedMs(Number(e.target.value))}>
              <option value={320}>Slow</option>
              <option value={150}>Normal</option>
              <option value={70}>Fast</option>
              <option value={25}>Blitz</option>
            </select>
          </label>
          <span className="muted">
            Bar {index + 1} / {session.bars.length} · {currentPrice(store).toFixed(2)}
          </span>
          <label className="toggle">
            <input type="checkbox" checked={showTypes} onChange={(e) => setShowTypes(e.target.checked)} />
            Bar types
          </label>
          <label className="toggle">
            <input type="checkbox" checked={hints} onChange={(e) => store.setHints(e.target.checked)} />
            Setup hints
          </label>
          <span className="spacer" />
          <input
            className="seed-input"
            placeholder={`seed ${store.seed}`}
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => {
              const s = seedInput.trim() ? Number(seedInput.trim()) : undefined
              store.newSession(Number.isFinite(s) ? s : undefined)
              setSeedInput('')
            }}
          >
            New session
          </button>
        </div>
        {hints && armed.length > 0 && (
          <div className="hint-banner">
            {armed.map((s) => (
              <span key={s.direction + s.scenario} className={s.direction === 'long' ? 'green' : 'red'}>
                {s.scenario} {s.direction} armed — trigger {s.trigger.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="side-panel">
        {broker.position ? <InTradePanel /> : <OrderTicket />}
        <PendingOrders />
        <TradeLog />
      </div>

      {finished && store.report && <ReportCard report={store.report} onNewSession={() => store.newSession()} />}
    </div>
  )
}

function OrderTicket() {
  const store = useReplayStore()
  const armed = useArmedSetups()
  const { session, index, stopStyle } = store
  const last = session.bars[index]

  const defaults = (direction: Direction) => {
    const setup = armed.find((s) => s.direction === direction)
    const entry = direction === 'long' ? round2(last.high + TICK) : round2(last.low - TICK)
    const stop = setup
      ? stopStyle === 'tight'
        ? setup.tightStop
        : setup.setupStop
      : direction === 'long'
        ? round2(last.low - TICK)
        : round2(last.high + TICK)
    return { entry, stop }
  }

  const [long, setLong] = useState(defaults('long'))
  const [short, setShort] = useState(defaults('short'))
  useEffect(() => {
    setLong(defaults('long'))
    setShort(defaults('short'))
  }, [index, stopStyle]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <h3>Order ticket</h3>
      <label className="row">
        Stop style
        <select value={stopStyle} onChange={(e) => store.setStopStyle(e.target.value as 'tight' | 'setup')}>
          <option value="tight">Spread + 0.01 (trigger bar)</option>
          <option value="setup">Setup stop (pattern extreme)</option>
        </select>
      </label>
      <div className="ticket-row">
        <div>
          <div className="muted">Buy stop</div>
          <input type="number" step="0.01" value={long.entry} onChange={(e) => setLong({ ...long, entry: Number(e.target.value) })} />
          <div className="muted">Stop loss</div>
          <input type="number" step="0.01" value={long.stop} onChange={(e) => setLong({ ...long, stop: Number(e.target.value) })} />
          <button className="btn btn-green" onClick={() => store.placeEntry('long', long.entry, long.stop)}>
            Place long
          </button>
        </div>
        <div>
          <div className="muted">Sell stop</div>
          <input type="number" step="0.01" value={short.entry} onChange={(e) => setShort({ ...short, entry: Number(e.target.value) })} />
          <div className="muted">Stop loss</div>
          <input type="number" step="0.01" value={short.stop} onChange={(e) => setShort({ ...short, stop: Number(e.target.value) })} />
          <button className="btn btn-red" onClick={() => store.placeEntry('short', short.entry, short.stop)}>
            Place short
          </button>
        </div>
      </div>
      <p className="muted small">
        Spot a reversal arming, pre-place the stop order at the break of the last bar's extreme ± 0.01, and let
        price come to you. Unfilled orders on failed setups are wins too.
      </p>
    </div>
  )
}

function InTradePanel() {
  const store = useReplayStore()
  const { broker, session, types, index } = store
  const pos = broker.position!
  const last = session.bars[index]
  const mark = currentPrice(store)
  const [stopInput, setStopInput] = useState<string>('')

  const qty = pos.lots.reduce((a, l) => a + l.qty, 0)
  const avg = round2(pos.lots.reduce((a, l) => a + l.price * l.qty, 0) / qty)
  const sign = pos.direction === 'long' ? 1 : -1
  const initialStop = pos.stopHistory.length ? pos.stopHistory[0].price : null
  const riskPerShare = initialStop === null ? null : Math.abs(pos.lots[0].price - initialStop)
  const unrealized = round2(sign * (mark - avg) * qty)
  const unrealizedR =
    riskPerShare && riskPerShare > 0
      ? round2((sign * (mark - pos.lots[0].price)) / riskPerShare)
      : null

  const trailCandidate = (() => {
    for (let i = index; i >= pos.lots[0].barIndex; i--) {
      const want = expectedTrailStop(session.bars, types, i, pos.direction)
      if (want === null) continue
      const improves = pos.stopPrice === null || (pos.direction === 'long' ? want > pos.stopPrice : want < pos.stopPrice)
      return improves ? want : null
    }
    return null
  })()
  const canAdd = isValidAddBar(types, index, pos.direction)
  const target = magnitudeTarget(session.bars, pos.lots[0].barIndex - 1, pos.direction)

  return (
    <div className="card">
      <h3>
        <span className={pos.direction === 'long' ? 'green' : 'red'}>{pos.direction.toUpperCase()}</span> {qty} @ {avg.toFixed(2)}
      </h3>
      <div className="stat-grid">
        <span>Stop</span>
        <strong>{pos.stopPrice?.toFixed(2) ?? '—'}</strong>
        <span>Open P&L</span>
        <strong className={unrealized >= 0 ? 'green' : 'red'}>
          ${unrealized.toFixed(0)}
          {unrealizedR !== null ? ` (${unrealizedR.toFixed(2)}R)` : ''}
        </strong>
        <span>Lots</span>
        <strong>{pos.lots.length}</strong>
      </div>
      <div className="btn-stack">
        <button className="btn" disabled={trailCandidate === null} onClick={() => store.trailStop()}>
          Trail stop {trailCandidate !== null ? `→ ${trailCandidate.toFixed(2)}` : '(no new 2 yet)'}
        </button>
        <button className="btn" disabled={!canAdd} onClick={() => store.placeAdd()}>
          {canAdd
            ? `Add on break of ${(pos.direction === 'long' ? last.high + TICK : last.low - TICK).toFixed(2)}`
            : 'Add (needs inside bar or pullback)'}
        </button>
        {pos.targetPrice === null && target !== null && (
          <button className="btn" onClick={() => store.setTarget(target)}>
            Target at magnitude {target.toFixed(2)}
          </button>
        )}
        <div className="row">
          <input
            type="number"
            step="0.01"
            placeholder="manual stop"
            value={stopInput}
            onChange={(e) => setStopInput(e.target.value)}
          />
          <button
            className="btn"
            disabled={!stopInput || !Number.isFinite(Number(stopInput))}
            onClick={() => {
              store.setStop(Number(stopInput))
              setStopInput('')
            }}
          >
            Set stop
          </button>
        </div>
        <button className="btn btn-muted" onClick={() => store.flatten()}>
          Flatten at {mark.toFixed(2)}
        </button>
      </div>
    </div>
  )
}

function PendingOrders() {
  const store = useReplayStore()
  const orders = store.broker.pendingOrders
  if (!orders.length) return null
  return (
    <div className="card">
      <h3>Working orders</h3>
      {orders.map((o) => (
        <div key={o.id} className="row order-row">
          <span className={o.direction === 'long' ? 'green' : 'red'}>
            {o.isAdd ? 'ADD ' : ''}
            {o.direction === 'long' ? 'BUY' : 'SELL'} stop {o.price.toFixed(2)}
          </span>
          <button className="btn btn-small" onClick={() => store.cancelOrder(o.id)}>
            Cancel
          </button>
        </div>
      ))}
    </div>
  )
}

function TradeLog() {
  const store = useReplayStore()
  const trades = store.broker.trades
  if (!trades.length) return null
  const totalR = trades.reduce((a, tr) => a + (tradeR(tr) ?? 0), 0)
  return (
    <div className="card">
      <h3>
        Closed trades <span className={totalR >= 0 ? 'green' : 'red'}>({totalR >= 0 ? '+' : ''}{totalR.toFixed(2)}R)</span>
      </h3>
      {trades.map((tr, k) => {
        const r = tradeR(tr)
        return (
          <div key={k} className="row order-row">
            <span className={tr.direction === 'long' ? 'green' : 'red'}>
              {tr.direction.toUpperCase()} {tr.lots.length > 1 ? `×${tr.lots.length}` : ''} → {tr.exitReason}
            </span>
            <span className={(r ?? 0) >= 0 ? 'green' : 'red'}>
              {r !== null ? `${r >= 0 ? '+' : ''}${r.toFixed(2)}R` : `$${tradePnl(tr).toFixed(0)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
