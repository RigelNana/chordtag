export type WaveformMode = 'waveform' | 'spectrogram'

export type ChordQuality = string

export interface ChordAnnotation {
  id: string
  start: number
  duration: number
  root: string
  quality: ChordQuality
  bass?: string
  color: ChordColor
  confidence?: number
  trackId?: string
  voicing?: string[]
  velocity?: number
}

export type ChordColor = 'lavender' | 'mint' | 'peach' | 'sky' | 'rose'

export interface ChordTrack {
  id: string
  name: string
  volume: number
  muted: boolean
  solo: boolean
  color: ChordColor
}

export type KeyMode =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonic minor'
  | 'melodic minor'

export interface KeyMarker {
  id: string
  startBar: number
  tonic: string
  mode: KeyMode
}

export interface TempoMarker {
  id: string
  startTime: number
  startBar: number
  bpm: number
  numerator: number
  denominator: number
}

export interface BeatMarker {
  time: number
  bar: number
  beat: number
  isBar: boolean
  meter: string
  bpm: number
}

export interface AudioAnalysis {
  duration: number
  peaks: number[]
  spectrogram: number[][]
  name: string
  url?: string
}

export type EditorTool = 'select' | 'pan'

export type GridDivision = 1 | 2 | 4 | 8
