import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AudioAnalysis, WaveformMode } from './types'

const TILE_WIDTH = 1024
const TILE_OVERSCAN = 1

interface WaveformCanvasProps {
  analysis: AudioAnalysis
  mode: WaveformMode
  pixelsPerSecond: number
  scrollContainerRef: RefObject<HTMLDivElement | null>
  timelineWidth: number
  onSeek: (time: number) => void
}

function spectrogramColor(value: number) {
  const intensity = Math.max(0, Math.min(1, value))
  const hue = 258 - intensity * 95
  const saturation = 42 + intensity * 35
  const lightness = 97 - intensity * 48
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

function WaveformTile({
  analysis,
  left,
  mode,
  onSeek,
  pixelsPerSecond,
  width,
}: {
  analysis: AudioAnalysis
  left: number
  mode: WaveformMode
  onSeek: (time: number) => void
  pixelsPerSecond: number
  width: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let frame = 0

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const canvasWidth = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const backingWidth = Math.round(canvasWidth * ratio)
      const backingHeight = Math.round(height * ratio)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, canvasWidth, height)

      const startTime = left / pixelsPerSecond
      context.fillStyle = mode === 'waveform' ? '#fbfaff' : '#f7f5fb'
      context.fillRect(0, 0, canvasWidth, height)

      if (mode === 'waveform') {
        const center = height / 2
        context.strokeStyle = 'rgba(94, 90, 105, .1)'
        context.beginPath()
        context.moveTo(0, center + 0.5)
        context.lineTo(canvasWidth, center + 0.5)
        context.stroke()

        context.fillStyle = '#8273c8'
        for (let x = 0; x < canvasWidth; x += 2) {
          const time = startTime + x / pixelsPerSecond
          const sample = Math.floor((time / analysis.duration) * analysis.peaks.length)
          const peak = analysis.peaks[Math.max(0, Math.min(analysis.peaks.length - 1, sample))] ?? 0
          const shaped = Math.max(1.5, peak * height * 0.43)
          context.globalAlpha = 0.68 + peak * 0.3
          context.fillRect(x, center - shaped, 1.4, shaped * 2)
        }
        context.globalAlpha = 1
      } else {
        const rowHeight = height / Math.max(1, analysis.spectrogram[0]?.length ?? 1)
        for (let x = 0; x < canvasWidth; x += 2) {
          const time = startTime + x / pixelsPerSecond
          const columnIndex = Math.floor((time / analysis.duration) * analysis.spectrogram.length)
          const column = analysis.spectrogram[
            Math.max(0, Math.min(analysis.spectrogram.length - 1, columnIndex))
          ] ?? []
          column.forEach((value, band) => {
            context.fillStyle = spectrogramColor(value)
            context.fillRect(x, height - (band + 1) * rowHeight, 2.2, rowHeight + 0.5)
          })
        }
        const gradient = context.createLinearGradient(0, 0, 0, height)
        gradient.addColorStop(0, 'rgba(251,250,255,.38)')
        gradient.addColorStop(0.5, 'rgba(251,250,255,0)')
        gradient.addColorStop(1, 'rgba(61,51,90,.08)')
        context.fillStyle = gradient
        context.fillRect(0, 0, canvasWidth, height)
      }
    }

    const scheduleDraw = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [analysis, left, mode, pixelsPerSecond])

  return (
    <canvas
      aria-label={mode === 'waveform' ? '音频振幅图，可点击定位' : '音频频谱图，可点击定位'}
      className="waveform-tile"
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const time = (left + event.clientX - bounds.left) / pixelsPerSecond
        onSeek(Math.max(0, Math.min(analysis.duration, time)))
      }}
      ref={canvasRef}
      style={{ left, width }}
    />
  )
}

export function WaveformCanvas({
  analysis,
  mode,
  pixelsPerSecond,
  scrollContainerRef,
  timelineWidth,
  onSeek,
}: WaveformCanvasProps) {
  const [range, setRange] = useState({ first: 0, last: 2 })

  useEffect(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    let frame = 0
    const updateRange = () => {
      const tileCount = Math.max(1, Math.ceil(timelineWidth / TILE_WIDTH))
      const first = Math.max(0, Math.floor(scroller.scrollLeft / TILE_WIDTH) - TILE_OVERSCAN)
      const last = Math.min(
        tileCount - 1,
        Math.ceil((scroller.scrollLeft + scroller.clientWidth) / TILE_WIDTH) + TILE_OVERSCAN,
      )
      setRange((current) => current.first === first && current.last === last
        ? current
        : { first, last })
    }
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateRange)
    }
    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(scroller)
    scroller.addEventListener('scroll', scheduleUpdate, { passive: true })
    scheduleUpdate()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller.removeEventListener('scroll', scheduleUpdate)
    }
  }, [scrollContainerRef, timelineWidth])

  const tiles = Array.from(
    { length: Math.max(0, range.last - range.first + 1) },
    (_, index) => range.first + index,
  )

  return (
    <div className="waveform-tiles" style={{ width: timelineWidth }}>
      {tiles.map((tile) => {
        const left = tile * TILE_WIDTH
        return (
          <WaveformTile
            analysis={analysis}
            key={tile}
            left={left}
            mode={mode}
            onSeek={onSeek}
            pixelsPerSecond={pixelsPerSecond}
            width={Math.min(TILE_WIDTH + 1, timelineWidth - left)}
          />
        )
      })}
    </div>
  )
}

