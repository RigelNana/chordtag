export type WaveformMode = 'waveform' | 'spectrogram'

export type ChordQuality =
  | 'maj'
  | 'min'
  | '5'
  | '7'
  | 'maj7'
  | 'm7'
  | 'mMaj7'
  | 'sus2'
  | 'sus4'
  | 'dim'
  | 'dim7'
  | 'm7b5'
  | 'aug'
  | 'add9'
  | 'madd9'
  | '6'
  | 'm6'
  | '6/9'
  | 'm6/9'
  | '7sus4'
  | '9'
  | 'maj9'
  | 'm9'
  | '9sus4'
  | '11'
  | 'm11'
  | '13'
  | 'maj13'
  | 'm13'
  | '13sus4'
  | '7b5'
  | '7#5'
  | '7b9'
  | '7#9'
  | '7#11'
  | '7#5b9'
  | '7#5#9'
  | 'maj7#11'
  | 'maj9#11'
  | 'm9b5'

export interface ChordAnnotation {
  id: string
  start: number
  duration: number
  root: string
  quality: ChordQuality
  bass?: string
  color: ChordColor
  confidence?: number
}

export type ChordColor = 'lavender' | 'mint' | 'peach' | 'sky' | 'rose'

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

export type EditorTool = 'select' | 'pan' | 'split'

export type GridDivision = 1 | 2 | 4 | 8
