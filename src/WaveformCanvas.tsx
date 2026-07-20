import { useEffect, useRef, useState } from 'react'
import type { AudioAnalysis, WaveformMode } from './types'

interface WaveformCanvasProps {
  analysis: AudioAnalysis
  mode: WaveformMode
  pixelsPerSecond: number
  scrollLeft: number
  playhead: number
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
  scrollLeft,
  playhead,
  onSeek,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 900, height: 188 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.max(1, width), height: Math.max(1, height) })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, size.width, size.height)

    const startTime = scrollLeft / pixelsPerSecond
    const visibleDuration = size.width / pixelsPerSecond
    context.fillStyle = mode === 'waveform' ? '#fbfaff' : '#f7f5fb'
    context.fillRect(0, 0, size.width, size.height)

    if (mode === 'waveform') {
      const center = size.height / 2
      context.strokeStyle = 'rgba(94, 90, 105, .1)'
      context.beginPath()
      context.moveTo(0, center + 0.5)
      context.lineTo(size.width, center + 0.5)
      context.stroke()

      context.fillStyle = '#8273c8'
      for (let x = 0; x < size.width; x += 2) {
        const time = startTime + x / pixelsPerSecond
        const sample = Math.floor((time / analysis.duration) * analysis.peaks.length)
        const peak = analysis.peaks[Math.max(0, Math.min(analysis.peaks.length - 1, sample))] ?? 0
        const shaped = Math.max(1.5, peak * size.height * 0.43)
        context.globalAlpha = 0.68 + peak * 0.3
        context.fillRect(x, center - shaped, 1.4, shaped * 2)
      }
      context.globalAlpha = 1
    } else {
      const rowHeight = size.height / Math.max(1, analysis.spectrogram[0]?.length ?? 1)
      for (let x = 0; x < size.width; x += 2) {
        const time = startTime + x / pixelsPerSecond
        const columnIndex = Math.floor((time / analysis.duration) * analysis.spectrogram.length)
        const column = analysis.spectrogram[
          Math.max(0, Math.min(analysis.spectrogram.length - 1, columnIndex))
        ] ?? []
        column.forEach((value, band) => {
          context.fillStyle = spectrogramColor(value)
          context.fillRect(x, size.height - (band + 1) * rowHeight, 2.2, rowHeight + 0.5)
        })
      }
      const gradient = context.createLinearGradient(0, 0, 0, size.height)
      gradient.addColorStop(0, 'rgba(251,250,255,.38)')
      gradient.addColorStop(0.5, 'rgba(251,250,255,0)')
      gradient.addColorStop(1, 'rgba(61,51,90,.08)')
      context.fillStyle = gradient
      context.fillRect(0, 0, size.width, size.height)
    }

    if (playhead >= startTime && playhead <= startTime + visibleDuration) {
      const x = (playhead - startTime) * pixelsPerSecond
      context.strokeStyle = '#5f4bb6'
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(x + 0.5, 0)
      context.lineTo(x + 0.5, size.height)
      context.stroke()
      context.fillStyle = '#5f4bb6'
      context.beginPath()
      context.moveTo(x - 5, 0)
      context.lineTo(x + 6, 0)
      context.lineTo(x + 0.5, 7)
      context.closePath()
      context.fill()
    }
  }, [analysis, mode, pixelsPerSecond, playhead, scrollLeft, size])

  return (
    <canvas
      aria-label={mode === 'waveform' ? '音频振幅图，可点击定位' : '音频频谱图，可点击定位'}
      className="waveform-canvas"
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const time = (scrollLeft + event.clientX - bounds.left) / pixelsPerSecond
        onSeek(Math.max(0, Math.min(analysis.duration, time)))
      }}
      ref={canvasRef}
    />
  )
}

