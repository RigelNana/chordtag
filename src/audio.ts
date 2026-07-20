import type { AudioAnalysis } from './types'

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

export async function analyseAudioFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<AudioAnalysis> {
  const context = new AudioContext()
  try {
    const encoded = await file.arrayBuffer()
    const buffer = await context.decodeAudioData(encoded)
    const channel = buffer.getChannelData(0)
    const peakCount = Math.min(3200, Math.max(700, Math.round(buffer.duration * 90)))
    const samplesPerPeak = Math.max(1, Math.floor(channel.length / peakCount))
    const peaks = new Array<number>(peakCount)

    for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
      const start = peakIndex * samplesPerPeak
      const end = Math.min(channel.length, start + samplesPerPeak)
      const stride = Math.max(1, Math.floor((end - start) / 64))
      let max = 0
      for (let sample = start; sample < end; sample += stride) {
        max = Math.max(max, Math.abs(channel[sample]))
      }
      peaks[peakIndex] = max
    }
    onProgress?.(0.3)

    // A bounded Goertzel filter bank keeps analysis responsive for long files while
    // preserving the logarithmic frequency detail musicians need in an editor.
    const columns = Math.min(640, Math.max(180, Math.round(buffer.duration * 14)))
    const bandCount = 42
    const windowSize = 256
    const minFrequency = 45
    const maxFrequency = Math.min(15000, buffer.sampleRate / 2 - 100)
    const coefficients = Array.from({ length: bandCount }, (_, band) => {
      const ratio = band / Math.max(1, bandCount - 1)
      const frequency = minFrequency * Math.pow(maxFrequency / minFrequency, ratio)
      return 2 * Math.cos((2 * Math.PI * frequency) / buffer.sampleRate)
    })
    const raw: number[][] = []
    let maximum = 0

    for (let column = 0; column < columns; column += 1) {
      const center = Math.round((column / Math.max(1, columns - 1)) * (channel.length - 1))
      const start = center - Math.floor(windowSize / 2)
      const values = coefficients.map((coefficient) => {
        let previous = 0
        let previousPrevious = 0
        for (let offset = 0; offset < windowSize; offset += 1) {
          const index = start + offset
          const sample = index >= 0 && index < channel.length ? channel[index] : 0
          const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / (windowSize - 1))
          const current = sample * hann + coefficient * previous - previousPrevious
          previousPrevious = previous
          previous = current
        }
        const power = Math.max(
          0,
          previousPrevious * previousPrevious
            + previous * previous
            - coefficient * previous * previousPrevious,
        )
        const value = Math.log1p(Math.sqrt(power))
        maximum = Math.max(maximum, value)
        return value
      })
      raw.push(values)
      if (column % 24 === 0) {
        onProgress?.(0.3 + (column / columns) * 0.65)
        await nextFrame()
      }
    }

    const spectrogram = raw.map((column) =>
      column.map((value) => Math.min(1, Math.pow(value / Math.max(maximum, 0.001), 0.72))),
    )
    onProgress?.(1)

    return {
      duration: buffer.duration,
      peaks,
      spectrogram,
      name: file.name,
      url: URL.createObjectURL(file),
    }
  } finally {
    await context.close()
  }
}

