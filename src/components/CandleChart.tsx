import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
} from 'lightweight-charts'
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { Bar } from '../engine/types'

export interface ChartMarker {
  time: number
  text: string
  above: boolean
  color?: string
}

export interface ChartPriceLine {
  price: number
  color: string
  title: string
  dashed?: boolean
}

export interface DraggableLine {
  price: number
  color?: string
  title?: string
  onMove: (price: number) => void
}

interface Props {
  bars: Bar[]
  markers?: ChartMarker[]
  priceLines?: ChartPriceLine[]
  /** A horizontal line the user can grab and drag; onMove fires on release. */
  draggableLine?: DraggableLine
  onPriceClick?: (price: number) => void
  height?: number
  /** Keep the latest bar in view as data streams in (replay). */
  followLatest?: boolean
  /** Fit all bars in view (quiz snippets). */
  fit?: boolean
}

export default function CandleChart({
  bars,
  markers = [],
  priceLines = [],
  draggableLine,
  onPriceClick,
  height = 420,
  followLatest = false,
  fit = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])
  const dragLineRef = useRef<IPriceLine | null>(null)
  const dragStateRef = useRef<{ dragging: boolean; price: number }>({ dragging: false, price: 0 })
  const dragPropsRef = useRef(draggableLine)
  dragPropsRef.current = draggableLine
  const clickRef = useRef(onPriceClick)
  clickRef.current = onPriceClick

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = createChart(el, {
      height,
      layout: {
        background: { color: '#0d1017' },
        textColor: '#8b95a7',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#161b26' },
        horzLines: { color: '#161b26' },
      },
      rightPriceScale: { borderColor: '#222a3a' },
      timeScale: {
        borderColor: '#222a3a',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      crosshair: {
        horzLine: { labelBackgroundColor: '#2a3550' },
        vertLine: { labelBackgroundColor: '#2a3550' },
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    chart.subscribeClick((param) => {
      if (!param.point || !seriesRef.current || !clickRef.current) return
      const price = seriesRef.current.coordinateToPrice(param.point.y)
      if (price !== null) clickRef.current(Math.round(price * 100) / 100)
    })
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    // --- draggable line: hover shows a grab cursor, drag moves the line,
    // --- release commits the new price. Chart pan is paused while dragging.
    const lineY = () => {
      const dl = dragPropsRef.current
      if (!dl || !seriesRef.current) return null
      return seriesRef.current.priceToCoordinate(dragStateRef.current.dragging ? dragStateRef.current.price : dl.price)
    }
    const eventY = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top
    const GRAB = 8
    const onPointerDown = (e: PointerEvent) => {
      const y = lineY()
      if (y === null || Math.abs(eventY(e) - y) > GRAB) return
      dragStateRef.current = { dragging: true, price: dragPropsRef.current!.price }
      chart.applyOptions({ handleScroll: false, handleScale: false })
      el.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragStateRef.current.dragging) {
        const y = lineY()
        el.style.cursor = y !== null && Math.abs(eventY(e) - y) <= GRAB ? 'ns-resize' : ''
        return
      }
      const price = seriesRef.current?.coordinateToPrice(eventY(e))
      if (price == null) return
      dragStateRef.current.price = Math.round(price * 100) / 100
      dragLineRef.current?.applyOptions({ price: dragStateRef.current.price })
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragStateRef.current.dragging) return
      dragStateRef.current.dragging = false
      chart.applyOptions({ handleScroll: true, handleScale: true })
      el.releasePointerCapture(e.pointerId)
      dragPropsRef.current?.onMove(dragStateRef.current.price)
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
      priceLinesRef.current = []
      dragLineRef.current = null
    }
  }, [height])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    if (dragStateRef.current.dragging) return // don't fight an in-progress drag
    if (!draggableLine) {
      if (dragLineRef.current) {
        series.removePriceLine(dragLineRef.current)
        dragLineRef.current = null
      }
      return
    }
    if (dragLineRef.current) {
      dragLineRef.current.applyOptions({ price: draggableLine.price })
    } else {
      dragLineRef.current = series.createPriceLine({
        price: draggableLine.price,
        color: draggableLine.color ?? '#ef5350',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: draggableLine.title ?? 'stop ⇕',
      })
    }
  }, [draggableLine])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.setData(
      bars.map((b) => ({
        time: b.time as UTCTimestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )
    if (fit) {
      chart.timeScale().fitContent()
    } else if (followLatest) {
      const len = bars.length
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, len - 70), to: len + 6 })
    }
  }, [bars, fit, followLatest])

  useEffect(() => {
    if (!markersRef.current) return
    const ms: SeriesMarker<Time>[] = markers.map((m) => ({
      time: m.time as UTCTimestamp,
      position: m.above ? 'aboveBar' : 'belowBar',
      shape: 'circle',
      size: 0,
      color: m.color ?? '#8b95a7',
      text: m.text,
    }))
    markersRef.current.setMarkers(ms)
  }, [markers])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    for (const pl of priceLinesRef.current) series.removePriceLine(pl)
    priceLinesRef.current = priceLines.map((pl) =>
      series.createPriceLine({
        price: pl.price,
        color: pl.color,
        lineWidth: 1,
        lineStyle: pl.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: pl.title,
      }),
    )
  }, [priceLines])

  return <div ref={containerRef} style={{ width: '100%' }} />
}
