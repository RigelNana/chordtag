import { useEffect, useRef, type RefObject } from 'react'
import type { AudioAnalysis, WaveformMode } from './types'

interface WaveformCanvasProps {
  analysis: AudioAnalysis
  mode: WaveformMode
  pixelsPerSecond: number
  scrollContainerRef: RefObject<HTMLDivElement | null>
  onSeek: (time: number) => void
}

function spectrogramColor(value: number) {
  const intensity = Math.max(0, Math.min(1, value))
  const hue = 258 - intensity * 95
  const saturation = 42 + intensity * 35
  const lightness = 97 - intensity * 48
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

export function WaveformCanvas({
  analysis,
  mode,
  pixelsPerSecond,
  scrollContainerRef,
  onSeek,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scroller = scrollContainerRef.current
    let frame = 0

    const draw = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const backingWidth = Math.round(width * ratio)
      const backingHeight = Math.round(height * ratio)
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth
        canvas.height = backingHeight
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      // Read the browser's native scroll value at paint time. This avoids the
      // one-render delay that made a sticky waveform drift from DOM annotations.
      const startTime = (scroller?.scrollLeft ?? 0) / pixelsPerSecond
      context.fillStyle = mode === 'waveform' ? '#fbfaff' : '#f7f5fb'
      context.fillRect(0, 0, width, height)

      if (mode === 'waveform') {
        const center = height / 2
        context.strokeStyle = 'rgba(94, 90, 105, .1)'
        context.beginPath()
        context.moveTo(0, center + 0.5)
        context.lineTo(width, center + 0.5)
        context.stroke()

        context.fillStyle = '#8273c8'
        for (let x = 0; x < width; x += 2) {
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
        for (let x = 0; x < width; x += 2) {
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
        context.fillRect(0, 0, width, height)
      }
    }

    const scheduleDraw = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(canvas)
    scroller?.addEventListener('scroll', draw, { passive: true })
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroller?.removeEventListener('scroll', draw)
    }
  }, [analysis, mode, pixelsPerSecond, scrollContainerRef])

  return (
    <canvas
      aria-label={mode === 'waveform' ? '音频振幅图，可点击定位' : '音频频谱图，可点击定位'}
      className="waveform-canvas"
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const time = ((scrollContainerRef.current?.scrollLeft ?? 0) + event.clientX - bounds.left)
          / pixelsPerSecond
        onSeek(Math.max(0, Math.min(analysis.duration, time)))
      }}
      ref={canvasRef}
    />
  )
}

