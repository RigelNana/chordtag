import { Chord, ChordType, Note, Scale } from '@tonaljs/tonal'
import type {
  BeatMarker,
  ChordAnnotation,
  ChordColor,
  ChordQuality,
  GridDivision,
  KeyMode,
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

export function parseChordSymbol(symbol: string) {
  const normalizedSymbol = symbol.replace(/^([A-G](?:#|b)?)M(?=\/|$)/, '$1')
  const bassMatch = normalizedSymbol.match(/\/([A-G](?:#|b)?)$/)
  const baseSymbol = bassMatch
    ? normalizedSymbol.slice(0, -bassMatch[0].length)
    : normalizedSymbol
  const baseDetails = Chord.get(baseSymbol)
  const root = baseDetails.tonic || Note.pitchClass(baseDetails.notes[0] ?? 'C') || 'C'
  const qualityToken = baseSymbol.slice(root.length)
  const quality = qualityToken === '' || qualityToken === 'M' ? 'maj' : qualityToken
  const details = bassMatch
    ? Chord.getChord(quality === 'maj' ? '' : quality, root, bassMatch[1])
    : baseDetails
  return {
    root,
    quality,
    bass: bassMatch?.[1],
    details,
  }
}

export function detectChordCandidates(notes: string[]) {
  if (notes.length < 2) return []
  const ordered = [...notes].sort((a, b) => (Note.midi(a) ?? 0) - (Note.midi(b) ?? 0))
  const bass = Note.pitchClass(ordered[0])
  const bassChroma = Note.chroma(bass)
  return Chord.detect(ordered)
    .flatMap((symbol) => {
      const parsed = parseChordSymbol(symbol)
      const chordChromas = parsed.details.notes.map((note) => Note.chroma(note))
      const isChordToneBass = bassChroma !== undefined && chordChromas.includes(bassChroma)
      const isInversion = isChordToneBass && Note.chroma(parsed.root) !== bassChroma
      if (!isInversion) return [symbol]
      const base = `${parsed.root}${parsed.quality === 'maj' ? '' : parsed.quality}`
      return [`${base}/${bass}`, symbol]
    })
    .filter((symbol, index, candidates) => candidates.indexOf(symbol) === index)
    .sort((a, b) => {
      const complexity = (symbol: string) => {
        const parsed = parseChordSymbol(symbol)
        const alteredIntervals = parsed.details.intervals.filter((interval) => /[Ad]/.test(interval)).length
        const explicitAlterations = (parsed.quality.match(/[#b]/g) ?? []).length
        return alteredIntervals * 4 + explicitAlterations * 2 + parsed.quality.length / 100
      }
      return complexity(a) - complexity(b)
    })
}

export function tonalChordName(chord: Pick<ChordAnnotation, 'root' | 'quality'>) {
  return `${chord.root}${LEGACY_QUALITY[chord.quality] ?? chord.quality}`
}

export function chordNotes(chord: Pick<ChordAnnotation, 'root' | 'quality'>) {
  return Chord.get(tonalChordName(chord)).notes.map((note) => Note.simplify(note))
}

export function romanNumeral(
  keyRoot: string,
  mode: KeyMode,
  chord: Pick<ChordAnnotation, 'root' | 'quality'>,
) {
  const scale = Scale.get(`${keyRoot} ${mode}`).notes
  const root = Note.get(chord.root)
  if (!scale.length || root.chroma === undefined) return '—'

  const degreeIndex = scale.findIndex((note) => Note.get(note).letter === root.letter)
  if (degreeIndex < 0) return '—'
  const degreeChroma = Note.chroma(scale[degreeIndex]) ?? 0
  const alteration = ((root.chroma - degreeChroma + 18) % 12) - 6
  const accidental = alteration > 0
    ? '♯'.repeat(alteration)
    : '♭'.repeat(Math.abs(alteration))
  const chordData = Chord.get(tonalChordName(chord))
  const lowercase = chordData.quality === 'Minor' || chordData.quality === 'Diminished'
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degreeIndex]
  const numeral = lowercase ? roman.toLowerCase() : roman
  const rawSuffix = qualityDisplay(chord.quality)
  const suffix = lowercase ? rawSuffix.replace(/^m(?:in)?/, '') : rawSuffix
  return `${accidental}${numeral}${suffix.replace(/^dim/, '°').replace(/^7♭5$/, 'ø7')}`
}

export function barDuration(marker: TempoMarker) {
  return marker.numerator * (60 / marker.bpm) * (4 / marker.denominator)
}

export function timeAtBar(bar: number, markers: TempoMarker[]) {
  const marker = [...markers]
    .sort((a, b) => a.startBar - b.startBar)
    .reverse()
    .find((item) => item.startBar <= bar)
  if (!marker) return 0
  return marker.startTime + (bar - marker.startBar) * barDuration(marker)
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

export function formatTime(seconds: number, includeMillis = false) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${minutes}:${rest.toFixed(includeMillis ? 3 : 1).padStart(includeMillis ? 6 : 4, '0')}`
}

export const INITIAL_TEMPO: TempoMarker[] = [
  { id: 'tempo-1', startTime: 0, startBar: 1, bpm: 120, numerator: 4, denominator: 4 },
]

