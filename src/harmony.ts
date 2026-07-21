import { Chord, Note, Scale } from '@tonaljs/tonal'
import {
  chordNotes,
  romanNumeral,
  tonalChordName,
} from './music'
import type { ChordAnnotation, KeyMode } from './types'

export const KEY_MODE_OPTIONS: Array<{ value: KeyMode; label: string }> = [
  { value: 'major', label: '大调' },
  { value: 'minor', label: '自然小调' },
  { value: 'dorian', label: '多利亚' },
  { value: 'phrygian', label: '弗里几亚' },
  { value: 'lydian', label: '利底亚' },
  { value: 'mixolydian', label: '混合利底亚' },
  { value: 'locrian', label: '洛克利亚' },
  { value: 'harmonic minor', label: '和声小调' },
  { value: 'melodic minor', label: '旋律小调' },
]

export interface HarmonicKey {
  tonic: string
  mode: KeyMode
}

export interface HarmonyContext {
  roman: string
  diatonic: boolean
  scaleNotes: string[]
  chordToneCoverage: number
  borrowedFrom: KeyMode[]
  secondaryTarget?: string
  classification: string
}

export interface VoiceLeadingResult {
  commonTones: string[]
  totalSemitones: number
  averageSemitones: number
}

function pitchClassSet(notes: string[]) {
  return new Set(notes.map((note) => Note.chroma(note)).filter((value) => value !== undefined))
}

export function analyzeHarmonyContext(
  chord: Pick<ChordAnnotation, 'root' | 'quality'>,
  key: HarmonicKey,
): HarmonyContext {
  const scaleNotes = Scale.get(`${key.tonic} ${key.mode}`).notes
  const scaleSet = pitchClassSet(scaleNotes)
  const tones = chordNotes(chord)
  const toneChromas = tones.map((note) => Note.chroma(note)).filter((value) => value !== undefined)
  const containedTones = toneChromas.filter((chroma) => scaleSet.has(chroma)).length
  const chordToneCoverage = toneChromas.length ? containedTones / toneChromas.length : 0
  const diatonic = chordToneCoverage === 1
  const borrowedFrom = KEY_MODE_OPTIONS
    .map((option) => option.value)
    .filter((mode) => mode !== key.mode)
    .filter((mode) => {
      const parallelSet = pitchClassSet(Scale.get(`${key.tonic} ${mode}`).notes)
      return toneChromas.length > 0 && toneChromas.every((chroma) => parallelSet.has(chroma))
    })

  const details = Chord.get(tonalChordName(chord))
  const isDominantStructure = details.intervals.includes('3M') && details.intervals.includes('7m')
  const target = isDominantStructure ? Note.transpose(chord.root, '4P') : undefined
  const targetInScale = target !== undefined && scaleSet.has(Note.chroma(target))
  const secondaryTarget = targetInScale
    ? romanNumeral(key.tonic, key.mode, { root: target!, quality: 'maj' })
    : undefined
  const classification = diatonic
    ? '调内音阶和弦'
    : secondaryTarget
      ? '副属 / 临时主音化'
      : borrowedFrom.length
        ? '平行调式借用'
        : '半音和声或转调连接'

  return {
    roman: romanNumeral(key.tonic, key.mode, chord),
    diatonic,
    scaleNotes,
    chordToneCoverage,
    borrowedFrom,
    secondaryTarget,
    classification,
  }
}

function circularDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 12
  return Math.min(distance, 12 - distance)
}

export function analyzeVoiceLeading(
  from: Pick<ChordAnnotation, 'root' | 'quality'>,
  to: Pick<ChordAnnotation, 'root' | 'quality'>,
): VoiceLeadingResult {
  const fromNotes = chordNotes(from)
  const toNotes = chordNotes(to)
  const fromChromas = fromNotes.map((note) => Note.chroma(note)).filter((value): value is number => value !== undefined)
  const toChromas = toNotes.map((note) => Note.chroma(note)).filter((value): value is number => value !== undefined)
  const commonTones = fromNotes.filter((note) => toChromas.includes(Note.chroma(note) ?? -1))
  const size = Math.max(fromChromas.length, toChromas.length)
  if (!size) return { commonTones: [], totalSemitones: 0, averageSemitones: 0 }

  const costs = Array.from({ length: size }, (_, source) =>
    Array.from({ length: size }, (_, targetIndex) => {
      if (source >= fromChromas.length || targetIndex >= toChromas.length) return 3
      return circularDistance(fromChromas[source], toChromas[targetIndex])
    }),
  )
  let states = new Map<number, number>([[0, 0]])
  for (let source = 0; source < size; source += 1) {
    const nextStates = new Map<number, number>()
    states.forEach((cost, mask) => {
      for (let targetIndex = 0; targetIndex < size; targetIndex += 1) {
        const bit = 1 << targetIndex
        if (mask & bit) continue
        const nextMask = mask | bit
        const nextCost = cost + costs[source][targetIndex]
        const known = nextStates.get(nextMask)
        if (known === undefined || nextCost < known) nextStates.set(nextMask, nextCost)
      }
    })
    states = nextStates
  }
  const totalSemitones = states.get((1 << size) - 1) ?? 0
  return {
    commonTones,
    totalSemitones,
    averageSemitones: totalSemitones / size,
  }
}

export function analyzeAcrossKeys(
  chord: Pick<ChordAnnotation, 'root' | 'quality'>,
  first: HarmonicKey,
  second: HarmonicKey,
) {
  const firstAnalysis = analyzeHarmonyContext(chord, first)
  const secondAnalysis = analyzeHarmonyContext(chord, second)
  return {
    first: firstAnalysis,
    second: secondAnalysis,
    pivot: firstAnalysis.diatonic && secondAnalysis.diatonic,
  }
}

