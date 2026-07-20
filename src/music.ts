import { Chord, ChordType, Note, Progression } from '@tonaljs/tonal'
import type {
  AudioAnalysis,
  BeatMarker,
  ChordAnnotation,
  ChordColor,
  ChordQuality,
  GridDivision,
  TempoMarker,
} from './types'

export const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

export type ChordFamily = 'basic' | 'seventh' | 'extended' | 'altered'

export const QUALITY_FAMILIES: Array<{ value: 'all' | ChordFamily; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'basic', label: '基础' },
  { value: 'seventh', label: '七和弦' },
  { value: 'extended', label: '延伸' },
  { value: 'altered', label: '变化' },
]

export interface ChordQualityOption {
  value: ChordQuality
  label: string
  short: string
  family: ChordFamily
}

const LEGACY_QUALITY: Record<string, string> = {
  maj: 'maj',
  min: 'm',
  '6/9': '6add9',
  'm6/9': 'm69',
}

function preferredAlias(name: string, aliases: readonly string[]) {
  if (name === 'major') return 'maj'
  if (name === 'minor') return 'min'
  return aliases.find((alias) => alias && /^[A-Za-z0-9+#/()-]+$/.test(alias))
    ?? aliases.find(Boolean)
    ?? name
}

function chordFamily(name: string, alias: string): ChordFamily {
  const value = `${name} ${alias}`.toLowerCase()
  if (/(#|b|alt|lydian|phryg|augmented seventh)/.test(value)) return 'altered'
  if (/(9|11|13|ninth|eleventh|thirteenth)/.test(value)) return 'extended'
  if (/(7|seventh|half-diminished|diminished seventh)/.test(value)) return 'seventh'
  return 'basic'
}

export const QUALITY_OPTIONS: ChordQualityOption[] = ChordType.all()
  .map((type) => {
    const value = preferredAlias(type.name, type.aliases)
    return {
      value,
      label: type.name || value,
      short: type.aliases.filter(Boolean).join(' · ') || value,
      family: chordFamily(type.name, value),
    }
  })
  .filter((option, index, options) =>
    option.value && options.findIndex((candidate) => candidate.value === option.value) === index,
  )
  .sort((a, b) => {
    const order: Record<ChordFamily, number> = { basic: 0, seventh: 1, extended: 2, altered: 3 }
    return order[a.family] - order[b.family] || a.label.localeCompare(b.label)
  })

export const CHORD_COLORS: ChordColor[] = ['lavender', 'mint', 'peach', 'sky', 'rose']

export function qualityDisplay(quality: ChordQuality) {
  const normalized = LEGACY_QUALITY[quality] ?? quality
  if (normalized === 'maj' || normalized === 'M' || normalized === '^') return ''
  return normalized.replaceAll('b', '♭').replaceAll('#', '♯')
}

export function chordName(chord: Pick<ChordAnnotation, 'root' | 'quality' | 'bass'>) {
  return `${chord.root}${qualityDisplay(chord.quality)}${chord.bass ? `/${chord.bass}` : ''}`
}

export function tonalChordName(chord: Pick<ChordAnnotation, 'root' | 'quality'>) {
  return `${chord.root}${LEGACY_QUALITY[chord.quality] ?? chord.quality}`
}

export function chordNotes(chord: Pick<ChordAnnotation, 'root' | 'quality'>) {
  return Chord.get(tonalChordName(chord)).notes.map((note) => Note.simplify(note))
}

export function romanNumeral(
  keyRoot: string,
  mode: 'major' | 'minor',
  chord: Pick<ChordAnnotation, 'root' | 'quality'>,
) {
  try {
    const raw = Progression.toRomanNumerals(keyRoot, [tonalChordName(chord)])[0] ?? ''
    const degree = raw.match(/^([b#]*)([IViv]+)/)
    if (!degree) return raw || '—'
    const chordData = Chord.get(tonalChordName(chord))
    const minorDegree = chordData.quality === 'Minor' || chordData.quality === 'Diminished'
    const accidental = degree[1]
    const numeral = minorDegree ? degree[2].toLowerCase() : degree[2].toUpperCase()
    const rawSuffix = qualityDisplay(chord.quality)
    const suffix = minorDegree ? rawSuffix.replace(/^m(?:in)?/, '') : rawSuffix
    return `${accidental.replace('b', '♭')}${numeral}${suffix}`
  } catch {
    const keyChroma = Note.chroma(keyRoot)
    const chordChroma = Note.chroma(chord.root)
    if (keyChroma === undefined || chordChroma === undefined) return '—'
    const degree = (chordChroma - keyChroma + 12) % 12
    const map = mode === 'major'
      ? ['I', '♭II', 'ii', '♭III', 'iii', 'IV', '♭V', 'V', '♭VI', 'vi', '♭VII', 'vii°']
      : ['i', '♭II', 'ii°', 'III', '♭IV', 'iv', '♭V', 'V', 'VI', '♭VII', 'vii°', 'VII']
    return map[degree]
  }
}

export function barDuration(marker: TempoMarker) {
  return marker.numerator * (60 / marker.bpm) * (4 / marker.denominator)
}

export function normalizeTempoMarkers(markers: TempoMarker[], firstBeatOffset: number) {
  const sorted = [...markers].sort((a, b) => a.startBar - b.startBar)
  return sorted.map((marker, index) => {
    if (index === 0) return { ...marker, startBar: 1, startTime: firstBeatOffset }
    const previous = sorted[index - 1]
    const previousNormalized = index === 1
      ? { ...previous, startBar: 1, startTime: firstBeatOffset }
      : sorted[index - 1]
    const priorStart = index === 1
      ? firstBeatOffset
      : firstBeatOffset + sorted.slice(0, index - 1).reduce((time, item, itemIndex) => {
        const next = sorted[itemIndex + 1]
        return time + (next.startBar - item.startBar) * barDuration(item)
      }, 0)
    return {
      ...marker,
      startTime: priorStart + (marker.startBar - previousNormalized.startBar) * barDuration(previous),
    }
  })
}

export function buildGrid(
  markers: TempoMarker[],
  duration: number,
  division: GridDivision,
): BeatMarker[] {
  const result: BeatMarker[] = []
  const sorted = [...markers].sort((a, b) => a.startBar - b.startBar)

  sorted.forEach((marker, markerIndex) => {
    const next = sorted[markerIndex + 1]
    const beatSeconds = (60 / marker.bpm) * (4 / marker.denominator)
    const lastBar = next?.startBar ?? Number.POSITIVE_INFINITY
    let bar = marker.startBar
    let barTime = marker.startTime

    while (bar < lastBar && barTime <= duration) {
      for (let beat = 1; beat <= marker.numerator; beat += 1) {
        for (let part = 0; part < division; part += 1) {
          const time = barTime + (beat - 1 + part / division) * beatSeconds
          if (time > duration) break
          result.push({
            time,
            bar,
            beat: beat + part / division,
            isBar: beat === 1 && part === 0,
            meter: `${marker.numerator}/${marker.denominator}`,
            bpm: marker.bpm,
          })
        }
      }
      bar += 1
      barTime += marker.numerator * beatSeconds
    }
  })
  return result
}

export function snapTime(time: number, grid: BeatMarker[], duration: number) {
  if (!grid.length) return Math.max(0, Math.min(duration, time))
  let low = 0
  let high = grid.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (grid[middle].time < time) low = middle + 1
    else high = middle
  }
  const right = grid[low]
  const left = grid[Math.max(0, low - 1)]
  const nearest = Math.abs(right.time - time) < Math.abs(left.time - time) ? right : left
  return Math.max(0, Math.min(duration, nearest.time))
}

function seededNoise(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function createDemoAnalysis(): AudioAnalysis {
  const duration = 23.4
  const peakCount = 1800
  const peaks = Array.from({ length: peakCount }, (_, index) => {
    const time = (index / peakCount) * duration
    const phrase = 0.42 + 0.4 * Math.sin((time / duration) * Math.PI)
    const pulse = 0.38 + 0.62 * Math.pow(Math.abs(Math.sin(time * Math.PI * 2)), 0.4)
    return Math.min(0.98, (0.12 + seededNoise(index) * 0.55) * phrase * pulse)
  })
  const columns = 520
  const bands = 42
  const spectrogram = Array.from({ length: columns }, (_, column) =>
    Array.from({ length: bands }, (_, band) => {
      const time = (column / columns) * duration
      const harmonic = Math.pow(Math.max(0, Math.sin((band + 2) * 0.55 + time * 1.8)), 3)
      const lowEnergy = Math.exp(-band / 18) * (0.45 + peaks[Math.floor((column / columns) * peakCount)] * 0.7)
      return Math.min(1, lowEnergy + harmonic * 0.32 + seededNoise(column * bands + band) * 0.08)
    }),
  )
  return { duration, peaks, spectrogram, name: 'Midnight Sketch.wav' }
}

export function formatTime(seconds: number, includeMillis = false) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${minutes}:${rest.toFixed(includeMillis ? 3 : 1).padStart(includeMillis ? 6 : 4, '0')}`
}

export const INITIAL_TEMPO: TempoMarker[] = [
  { id: 'tempo-1', startTime: 0.4, startBar: 1, bpm: 118, numerator: 4, denominator: 4 },
  { id: 'tempo-2', startTime: 8.536, startBar: 5, bpm: 96, numerator: 6, denominator: 8 },
  { id: 'tempo-3', startTime: 16.036, startBar: 9, bpm: 126, numerator: 3, denominator: 4 },
]

export const INITIAL_CHORDS: ChordAnnotation[] = [
  { id: 'chord-1', start: 0.4, duration: 2.034, root: 'C', quality: 'maj7', color: 'lavender', confidence: 0.98 },
  { id: 'chord-2', start: 2.434, duration: 2.034, root: 'E', quality: 'm7', bass: 'G', color: 'mint', confidence: 0.96 },
  { id: 'chord-3', start: 4.468, duration: 2.034, root: 'A', quality: 'm7', color: 'sky', confidence: 0.94 },
  { id: 'chord-4', start: 6.502, duration: 2.034, root: 'F', quality: 'maj7', color: 'peach', confidence: 0.97 },
  { id: 'chord-5', start: 8.536, duration: 1.875, root: 'D', quality: 'm7', color: 'mint', confidence: 0.91 },
  { id: 'chord-6', start: 10.411, duration: 1.875, root: 'G', quality: '7', color: 'rose', confidence: 0.95 },
  { id: 'chord-7', start: 12.286, duration: 1.875, root: 'C', quality: 'maj9', color: 'lavender', confidence: 0.93 },
  { id: 'chord-8', start: 14.161, duration: 1.875, root: 'A', quality: 'm7', bass: 'C', color: 'sky', confidence: 0.9 },
  { id: 'chord-9', start: 16.036, duration: 1.429, root: 'F', quality: 'maj7', color: 'peach', confidence: 0.96 },
  { id: 'chord-10', start: 17.465, duration: 1.429, root: 'G', quality: '7', color: 'rose', confidence: 0.98 },
  { id: 'chord-11', start: 18.894, duration: 2.857, root: 'C', quality: 'maj7', color: 'lavender', confidence: 0.99 },
]

