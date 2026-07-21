import {
  Activity,
  AudioLines,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Focus,
  Gauge,
  Grid2X2,
  Hand,
  Headphones,
  Keyboard,
  Minus,
  MousePointer2,
  Music2,
  Pause,
  Piano,
  Play,
  Plus,
  Redo2,
  Repeat2,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Waves,
  X,
} from 'lucide-react'
import { Chord as TonalChord, Note } from '@tonaljs/tonal'
import { AnimatePresence, motion } from 'motion/react'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { analyseAudioFile } from './audio'
import {
  CHORD_COLORS,
  INITIAL_TEMPO,
  QUALITY_FAMILIES,
  QUALITY_OPTIONS,
  ROOTS,
  type ChordFamily,
  buildGrid,
  chordName,
  chordNotes,
  detectChordCandidates,
  formatTime,
  normalizeTempoMarkers,
  parseChordSymbol,
  qualityDisplay,
  romanNumeral,
  snapTime,
  timeAtBar,
} from './music'
import type {
  AudioAnalysis,
  ChordAnnotation,
  ChordTrack,
  EditorTool,
  GridDivision,
  KeyMarker,
  KeyMode,
  TempoMarker,
  WaveformMode,
} from './types'
import {
  KEY_MODE_OPTIONS,
  analyzeAcrossKeys,
  analyzeHarmonyContext,
  analyzeVoiceLeading,
  tonicChordForKey,
  type HarmonyContext,
  type VoiceLeadingResult,
} from './harmony'
import { ChordFinder } from './ChordFinder'
import { PianoKeyboard } from './PianoKeyboard'
import { WaveformCanvas } from './WaveformCanvas'
import {
  annotationVoicing,
  inversionVoicing,
  pitchClassesToVoicing,
  playChord,
  playChordTimeline,
  playNotes,
  setSynthChannelVolume,
  stopChordPlayback,
} from './synth'

const MIN_ZOOM = 52
const MAX_ZOOM = 360
const FIRST_BEAT_OFFSET = 0
const EMPTY_ANALYSIS: AudioAnalysis = {
  duration: 1,
  peaks: [0],
  spectrogram: [[0]],
  name: '未导入音频',
}
const LEGACY_DEMO_CHORD_IDS = new Set(Array.from({ length: 11 }, (_, index) => `chord-${index + 1}`))
const DEFAULT_TRACKS: ChordTrack[] = [
  { id: 'track-1', name: '和弦轨 1', volume: 0.78, muted: false, solo: false, color: 'lavender' },
]

type HistoryState = {
  past: ChordAnnotation[][]
  future: ChordAnnotation[][]
}

type WorkspacePage = 'chords' | 'finder' | 'settings'

interface MarqueeSelection {
  start: number
  current: number
  trackId: string
}

interface TimeRange {
  start: number
  end: number
}

function removeChordOverlaps(items: ChordAnnotation[]) {
  const cursors = new Map<string, number>()
  return [...items]
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      const trackId = item.trackId ?? DEFAULT_TRACKS[0].id
      const cursor = cursors.get(trackId) ?? 0
      const originalEnd = item.start + item.duration
      const start = Math.max(cursor, item.start)
      const duration = Math.max(0.08, originalEnd - start)
      cursors.set(trackId, start + duration)
      return { ...item, start, duration, trackId }
    })
}

function rippleMoveChord(
  items: ChordAnnotation[],
  chord: ChordAnnotation,
  desiredStart: number,
  durationLimit: number,
  fallbackTrackId: string,
) {
  const trackId = chord.trackId ?? fallbackTrackId
  const track = items
    .filter((item) => (item.trackId ?? fallbackTrackId) === trackId)
    .sort((a, b) => a.start - b.start)
  const others = track.filter((item) => item.id !== chord.id)
  const boundedStart = Math.max(0, Math.min(durationLimit - chord.duration, desiredStart))
  const insertionIndex = others.findIndex((item) => (
    boundedStart < item.start + item.duration / 2
  ))
  const index = insertionIndex < 0 ? others.length : insertionIndex
  const ordered = [...others.slice(0, index), chord, ...others.slice(index)]
  const previousEnd = index > 0
    ? ordered[index - 1].start + ordered[index - 1].duration
    : 0
  let cursor = Math.max(previousEnd, boundedStart)
  const updates = new Map<string, ChordAnnotation>()
  ordered.slice(index).forEach((item) => {
    const start = item.id === chord.id ? cursor : Math.max(item.start, cursor)
    const updated = { ...item, start }
    updates.set(item.id, updated)
    cursor = start + item.duration
  })

  if (cursor > durationLimit) {
    cursor = previousEnd
    ordered.slice(index).forEach((item) => {
      const updated = { ...item, start: cursor }
      updates.set(item.id, updated)
      cursor += item.duration
    })
  }
  return items.map((item) => updates.get(item.id) ?? item)
}

function rippleResizeChord(
  items: ChordAnnotation[],
  chord: ChordAnnotation,
  desiredDuration: number,
  minimumDuration: number,
  durationLimit: number,
  fallbackTrackId: string,
) {
  const trackId = chord.trackId ?? fallbackTrackId
  const ordered = items
    .filter((item) => (item.trackId ?? fallbackTrackId) === trackId)
    .sort((a, b) => a.start - b.start)
  const chordIndex = ordered.findIndex((item) => item.id === chord.id)
  const lastEnd = ordered.reduce((end, item) => Math.max(end, item.start + item.duration), 0)
  const maximumGrowth = Math.max(0, durationLimit - lastEnd)
  const duration = Math.max(
    minimumDuration,
    Math.min(chord.duration + maximumGrowth, desiredDuration),
  )
  const delta = duration - chord.duration
  const updates = new Map<string, ChordAnnotation>([
    [chord.id, { ...chord, duration }],
  ])
  ordered.slice(chordIndex + 1).forEach((item) => {
    updates.set(item.id, { ...item, start: item.start + delta })
  })
  return items.map((item) => updates.get(item.id) ?? item)
}

interface ChordInspectorProps {
  chord?: ChordAnnotation
  harmonyContext?: {
    current: HarmonyContext
    currentLabel: string
    alternate?: HarmonyContext
    alternateLabel?: string
    pivot?: boolean
  }
  keyRoot: string
  keyMode: KeyMode
  onAudition: (chord: ChordAnnotation) => void
  onClose: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<ChordAnnotation>) => void
  tracks: ChordTrack[]
  voiceLeading?: {
    previous?: VoiceLeadingResult
    next?: VoiceLeadingResult
  }
}

interface SelectOption {
  value: string
  label: string
  detail?: string
}

function MaterialSelect({
  ariaLabel,
  className = '',
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  className?: string
  onChange: (value: string) => void
  options: SelectOption[]
  value: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className={`m3-select ${className}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="m3-select-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className={open ? 'rotated' : ''} size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="m3-select-menu"
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            role="listbox"
            transition={{ duration: 0.14 }}
          >
            {options.map((option) => (
              <button
                aria-selected={option.value === value}
                className={option.value === value ? 'selected' : ''}
                key={option.value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
                {option.value === value && <Check size={15} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ChordInspector({
  chord,
  harmonyContext,
  keyRoot,
  keyMode,
  onAudition,
  onClose,
  onDelete,
  onUpdate,
  tracks,
  voiceLeading,
}: ChordInspectorProps) {
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<'all' | ChordFamily>('all')
  const notes = chord ? chordNotes(chord) : []
  const voicing = chord ? annotationVoicing(chord) : []
  const customBass = chord?.bass
  const inversionOptions = chord
    ? [
      { value: chord.root, label: `原位 · ${chord.root}` },
      ...notes
        .filter((note) => Note.chroma(note) !== Note.chroma(chord.root))
        .map((note, index) => ({
          value: Note.pitchClass(note),
          label: `第 ${index + 1} 转位 · ${chord.root}/${Note.pitchClass(note)}`,
        })),
      ...(customBass && !notes.some((note) => Note.chroma(note) === Note.chroma(customBass))
        ? [{ value: customBass, label: `自定义低音 · ${chord.root}/${customBass}` }]
        : []),
    ]
    : []
  const numeral = chord ? romanNumeral(keyRoot, keyMode, chord) : '—'
  const filteredQualities = QUALITY_OPTIONS.filter((option) => {
    const matchesFamily = family === 'all' || option.family === family
    const matchesQuery = `${option.label} ${option.short} ${option.value}`
      .toLowerCase()
      .includes(query.toLowerCase())
    return matchesFamily && matchesQuery
  })

  return (
    <div className="inspector-content">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">和弦检查器</span>
          <h2>{chord ? chordName(chord) : '选择一个和弦'}</h2>
        </div>
        <div className="inspector-header-actions">
          {chord && <button className="audition-button" onClick={() => onAudition(chord)}><Play size={14} fill="currentColor" />试听</button>}
          <button className="icon-button mobile-only" aria-label="关闭检查器" onClick={onClose}><X size={19} /></button>
        </div>
      </div>

      {!chord ? (
        <div className="empty-inspector">
          <div className="empty-icon"><Music2 size={28} /></div>
          <h3>从时间轴开始</h3>
          <p>选择一个片段编辑和弦，或按 <kbd>A</kbd> 在播放头处快速添加。</p>
        </div>
      ) : (
        <>
          <div className="analysis-card">
            <div>
              <span>级数</span>
              <strong>{harmonyContext?.current.roman ?? numeral}</strong>
            </div>
            <div>
              <span>构成音</span>
              <strong>{notes.join(' · ') || '—'}</strong>
            </div>
          </div>

          {harmonyContext && (
            <section className="harmony-assistant-card">
              <div className="assistant-heading">
                <div><span className="eyebrow">和声分析辅助</span><strong>{harmonyContext.currentLabel}</strong></div>
                <span className={harmonyContext.current.diatonic ? 'context-status diatonic' : 'context-status chromatic'}>
                  {harmonyContext.current.classification}
                </span>
              </div>
              <div className="context-facts">
                <div><span>调内覆盖</span><strong>{Math.round(harmonyContext.current.chordToneCoverage * 100)}%</strong></div>
                <div><span>当前级数</span><strong>{harmonyContext.current.roman}</strong></div>
                {harmonyContext.current.secondaryTarget && <div><span>临时主音化</span><strong>V/{harmonyContext.current.secondaryTarget}</strong></div>}
                {harmonyContext.current.borrowedFrom.length > 0 && (
                  <div className="wide"><span>可解释为平行调式借用</span><strong>{harmonyContext.current.borrowedFrom.map((mode) => KEY_MODE_OPTIONS.find((item) => item.value === mode)?.label).join(' · ')}</strong></div>
                )}
              </div>
              {harmonyContext.alternate && (
                <div className={`dual-key-analysis ${harmonyContext.pivot ? 'pivot' : ''}`}>
                  <span>{harmonyContext.pivot ? '共同和弦 / 枢纽候选' : '转调边界双重解释'}</span>
                  <strong>{harmonyContext.currentLabel}：{harmonyContext.current.roman}</strong>
                  <strong>{harmonyContext.alternateLabel}：{harmonyContext.alternate.roman}</strong>
                </div>
              )}
              {(voiceLeading?.previous || voiceLeading?.next) && (
                <div className="voice-leading-row">
                  {voiceLeading.previous && <span>前接：{voiceLeading.previous.totalSemitones} 半音 · 共同音 {voiceLeading.previous.commonTones.join('、') || '无'}</span>}
                  {voiceLeading.next && <span>后接：{voiceLeading.next.totalSemitones} 半音 · 共同音 {voiceLeading.next.commonTones.join('、') || '无'}</span>}
                </div>
              )}
            </section>
          )}

          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索和弦类型"
              placeholder="搜索全部和弦…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <section className="inspector-section">
            <div className="section-label">
              <span>根音</span>
              <small>12 音</small>
            </div>
            <div className="root-grid">
              {ROOTS.map((root) => (
                <button
                  className={chord.root === root ? 'selected' : ''}
                  key={root}
                  onClick={() => onUpdate({
                    root,
                    voicing: inversionVoicing({ root, quality: chord.quality }, chord.bass),
                  })}
                >
                  {root.replace('#', '♯')}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>和弦性质</span>
              <small>{filteredQualities.length} / {QUALITY_OPTIONS.length} 种</small>
            </div>
            <div className="quality-filters" role="tablist" aria-label="和弦种类">
              {QUALITY_FAMILIES.map((option) => (
                <button
                  aria-selected={family === option.value}
                  className={family === option.value ? 'selected' : ''}
                  key={option.value}
                  onClick={() => setFamily(option.value)}
                  role="tab"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="quality-list">
              {filteredQualities.map((quality) => (
                <button
                  className={chord.quality === quality.value ? 'selected' : ''}
                  key={quality.value}
                  onClick={() => onUpdate({
                    quality: quality.value,
                    voicing: inversionVoicing({ root: chord.root, quality: quality.value }, chord.bass),
                  })}
                >
                  <span>{qualityDisplay(quality.value) || 'maj'}</span>
                  <small>{quality.label}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section inversion-section">
            <div className="section-label"><span>转位形式</span><small>按最低和弦音排列声部</small></div>
            <MaterialSelect
              ariaLabel="和弦转位"
              onChange={(bass) => onUpdate({
                bass: bass === chord.root ? undefined : bass,
                voicing: inversionVoicing(chord, bass),
              })}
              options={inversionOptions}
              value={chord.bass ?? chord.root}
            />
          </section>

          <section className="inspector-section two-column-fields">
            <label>
              <span>自定义斜线低音</span>
              <MaterialSelect
                ariaLabel="低音（斜线和弦）"
                onChange={(value) => onUpdate({
                  bass: value || undefined,
                  voicing: value ? inversionVoicing(chord, value) : inversionVoicing(chord),
                })}
                options={[
                  { value: '', label: '无' },
                  ...ROOTS.map((root) => ({ value: root, label: root })),
                ]}
                value={chord.bass ?? ''}
              />
            </label>
            <label>
              <span>置信度</span>
              <div className="confidence-field">
                <BadgeCheck size={15} />
                {Math.round((chord.confidence ?? 1) * 100)}%
              </div>
            </label>
          </section>

          <section className="inspector-section midi-editor-section">
            <div className="section-label"><span>MIDI 与片段</span><small>{voicing.length} 个声部</small></div>
            <label>
              <span>所属轨道</span>
              <MaterialSelect
                ariaLabel="所属和弦轨"
                onChange={(value) => onUpdate({ trackId: value })}
                options={tracks.map((track) => ({ value: track.id, label: track.name }))}
                value={chord.trackId ?? tracks[0]?.id ?? ''}
              />
            </label>
            <div className="timing-fields">
              <label><span>开始 (s)</span><input min="0" step="0.001" type="number" value={Number(chord.start.toFixed(3))} onChange={(event) => onUpdate({ start: Number(event.target.value) })} /></label>
              <label><span>时长 (s)</span><input min="0.08" step="0.001" type="number" value={Number(chord.duration.toFixed(3))} onChange={(event) => onUpdate({ duration: Number(event.target.value) })} /></label>
            </div>
            <label className="velocity-field">
              <span>力度 <b>{Math.round((chord.velocity ?? 0.72) * 127)}</b></span>
              <input max="1" min="0.1" step="0.01" type="range" value={chord.velocity ?? 0.72} onChange={(event) => onUpdate({ velocity: Number(event.target.value) })} />
            </label>
            <div className="voicing-preview">
              {voicing.map((note) => <span key={note}>{note}</span>)}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-label"><span>片段颜色</span></div>
            <div className="color-picker">
              {CHORD_COLORS.map((color) => (
                <button
                  aria-label={`选择 ${color} 色`}
                  className={`${color} ${chord.color === color ? 'selected' : ''}`}
                  key={color}
                  onClick={() => onUpdate({ color })}
                />
              ))}
            </div>
          </section>

          <button className="delete-button" onClick={onDelete}>
            <Trash2 size={16} />
            删除和弦片段
          </button>
        </>
      )}
    </div>
  )
}

function ToolButton({
  active,
  label,
  children,
  onClick,
}: {
  active?: boolean
  label: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      className={`tool-button ${active ? 'active' : ''}`}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function App() {
  const [activePage, setActivePage] = useState<WorkspacePage>('chords')
  const [analysis, setAnalysis] = useState<AudioAnalysis>(EMPTY_ANALYSIS)
  const [hasAudio, setHasAudio] = useState(false)
  const [waveformMode, setWaveformMode] = useState<WaveformMode>('waveform')
  const [tracks, setTracks] = useState<ChordTrack[]>(() => {
    const saved = localStorage.getItem('chordtag-tracks')
    if (!saved) return DEFAULT_TRACKS
    try {
      const parsed = JSON.parse(saved) as ChordTrack[]
      return parsed.length ? parsed : DEFAULT_TRACKS
    } catch {
      return DEFAULT_TRACKS
    }
  })
  const [activeTrackId, setActiveTrackId] = useState(tracks[0]?.id ?? 'track-1')
  const [pianoNotes, setPianoNotes] = useState<string[]>([])
  const [midiVolume, setMidiVolume] = useState(0.78)
  const [isChordPlayback, setIsChordPlayback] = useState(false)
  const [pianoExpanded, setPianoExpanded] = useState(true)
  const [chords, setChords] = useState<ChordAnnotation[]>(() => {
    const saved = localStorage.getItem('chordtag-annotations')
    if (!saved) return []
    try {
      const parsed = JSON.parse(saved) as ChordAnnotation[]
      const isLegacyDemo = parsed.length === LEGACY_DEMO_CHORD_IDS.size
        && parsed.every((chord) => LEGACY_DEMO_CHORD_IDS.has(chord.id))
      return isLegacyDemo ? [] : removeChordOverlaps(parsed)
    } catch {
      return []
    }
  })
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] })
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [marquee, setMarquee] = useState<MarqueeSelection | null>(null)
  const [timeSelection, setTimeSelection] = useState<TimeRange | null>(null)
  const [loopSelection, setLoopSelection] = useState(false)
  const [rangePlayback, setRangePlayback] = useState(false)
  const [tool, setTool] = useState<EditorTool>('select')
  const [pixelsPerSecond, setPixelsPerSecond] = useState(108)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(900)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [volume, setVolume] = useState(0.82)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [gridDivision, setGridDivision] = useState<GridDivision>(2)
  const [firstBeatOffset, setFirstBeatOffset] = useState(FIRST_BEAT_OFFSET)
  const [tempoMarkers, setTempoMarkers] = useState<TempoMarker[]>(INITIAL_TEMPO)
  const [keyMarkers, setKeyMarkers] = useState<KeyMarker[]>(() => {
    const saved = localStorage.getItem('chordtag-key-map')
    if (!saved) return [{ id: 'key-1', startBar: 1, tonic: 'C', mode: 'major' }]
    const parsed = JSON.parse(saved) as KeyMarker[]
    return parsed.length ? parsed : [{ id: 'key-1', startBar: 1, tonic: 'C', mode: 'major' }]
  })
  const [tempoOpen, setTempoOpen] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackAnchor = useRef({ startedAt: 0, from: 0 })
  const saveTimer = useRef<number | undefined>(undefined)
  const zoomRef = useRef(pixelsPerSecond)
  const scrollLeftRef = useRef(0)

  const grid = useMemo(
    () => buildGrid(tempoMarkers, analysis.duration, gridDivision),
    [analysis.duration, gridDivision, tempoMarkers],
  )
  const keyTimeline = useMemo(
    () => [...keyMarkers]
      .sort((a, b) => a.startBar - b.startBar)
      .map((marker) => ({ ...marker, startTime: timeAtBar(marker.startBar, tempoMarkers) })),
    [keyMarkers, tempoMarkers],
  )
  const activeKey = [...keyTimeline].reverse().find((marker) => marker.startTime <= currentTime)
    ?? keyTimeline[0]
  const keyRoot = activeKey.tonic
  const keyMode = activeKey.mode
  const keyForTime = useCallback((time: number) => (
    [...keyTimeline].reverse().find((marker) => marker.startTime <= time) ?? keyTimeline[0]
  ), [keyTimeline])
  const setKeyRoot = (tonic: string) => {
    setKeyMarkers((current) => current.map((marker) =>
      marker.id === activeKey.id ? { ...marker, tonic } : marker,
    ))
  }
  const setKeyMode = (mode: KeyMode) => {
    setKeyMarkers((current) => current.map((marker) =>
      marker.id === activeKey.id ? { ...marker, mode } : marker,
    ))
  }
  const pianoCandidates = useMemo(
    () => detectChordCandidates(pianoNotes).slice(0, 8),
    [pianoNotes],
  )
  const selectedChord = chords.find((chord) => chord.id === selectedId)
  const selectedHarmony = useMemo(() => {
    if (!selectedChord) return undefined
    const currentKey = keyForTime(selectedChord.start)
    const current = analyzeHarmonyContext(selectedChord, currentKey)
    const trackId = selectedChord.trackId ?? tracks[0]?.id
    const ordered = chords
      .filter((chord) => (chord.trackId ?? tracks[0]?.id) === trackId)
      .sort((a, b) => a.start - b.start)
    const chordIndex = ordered.findIndex((chord) => chord.id === selectedChord.id)
    const previousChord = ordered[chordIndex - 1]
    const nextChord = ordered[chordIndex + 1]
    const boundaries = keyTimeline.slice(1).map((marker, index) => ({
      marker,
      previousKey: keyTimeline[index],
    }))
    const adjacentBoundaries = boundaries.filter(({ marker }) => {
      const selectedEnd = selectedChord.start + selectedChord.duration
      if (selectedChord.start < marker.startTime && selectedEnd > marker.startTime) return true
      if (selectedEnd <= marker.startTime) return !nextChord || nextChord.start >= marker.startTime
      return !previousChord || previousChord.start + previousChord.duration <= marker.startTime
    })
    const transition = adjacentBoundaries
      .sort((a, b) => {
        const center = selectedChord.start + selectedChord.duration / 2
        return Math.abs(a.marker.startTime - center) - Math.abs(b.marker.startTime - center)
      })[0]
    const alternateKey = transition
      ? selectedChord.start >= transition.marker.startTime
        ? transition.previousKey
        : transition.marker
      : undefined
    const crossKey = alternateKey
      ? analyzeAcrossKeys(selectedChord, currentKey, alternateKey)
      : undefined
    const modeName = (mode: KeyMode) =>
      KEY_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode
    return {
      context: {
        current,
        currentLabel: `${currentKey.tonic} ${modeName(currentKey.mode)}`,
        alternate: crossKey?.second,
        alternateLabel: alternateKey ? `${alternateKey.tonic} ${modeName(alternateKey.mode)}` : undefined,
        pivot: crossKey?.pivot,
      },
      voiceLeading: {
        previous: previousChord ? analyzeVoiceLeading(previousChord, selectedChord) : undefined,
        next: nextChord ? analyzeVoiceLeading(selectedChord, nextChord) : undefined,
      },
    }
  }, [chords, keyForTime, keyTimeline, selectedChord, tracks])
  const activeTempo = [...tempoMarkers].reverse().find((marker) => marker.startTime <= currentTime)
    ?? tempoMarkers[0]
  const visibleStart = scrollLeft / pixelsPerSecond
  const visibleEnd = (scrollLeft + viewportWidth) / pixelsPerSecond
  const visibleGrid = grid.filter(
    (marker) => marker.time >= visibleStart - 0.5 && marker.time <= visibleEnd + 0.5,
  )
  const timelineWidth = Math.max(viewportWidth, analysis.duration * pixelsPerSecond)
  const timelineHeight = 40 + 190 + tracks.length * 96

  const commitAnnotations = useCallback((next: ChordAnnotation[]) => {
    setSaveState('saving')
    setHistory((current) => ({
      past: [...current.past.slice(-39), chords],
      future: [],
    }))
    setChords(removeChordOverlaps(next))
  }, [chords])

  const selectOnly = useCallback((id: string) => {
    setSelectedId(id)
    setSelectedIds([id])
  }, [])

  const updateSelected = useCallback((patch: Partial<ChordAnnotation>) => {
    if (!selectedId) return
    const selected = chords.find((chord) => chord.id === selectedId)
    if (!selected) return
    if (patch.start !== undefined) {
      commitAnnotations(rippleMoveChord(
        chords,
        selected,
        snapTime(patch.start, grid, analysis.duration),
        analysis.duration,
        tracks[0]?.id ?? 'track-1',
      ))
      return
    }
    if (patch.duration !== undefined) {
      commitAnnotations(rippleResizeChord(
        chords,
        selected,
        patch.duration,
        0.08,
        analysis.duration,
        tracks[0]?.id ?? 'track-1',
      ))
      return
    }
    commitAnnotations(chords.map((chord) =>
      chord.id === selectedId ? { ...chord, ...patch } : chord,
    ))
  }, [analysis.duration, chords, commitAnnotations, grid, selectedId, tracks])

  const deleteSelected = useCallback(() => {
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : []
    if (!ids.length) return
    const deleting = new Set(ids)
    commitAnnotations(chords.filter((chord) => !deleting.has(chord.id)))
    setSelectedId(undefined)
    setSelectedIds([])
    setInspectorOpen(false)
  }, [chords, commitAnnotations, selectedId, selectedIds])

  const deleteChord = useCallback((id: string) => {
    commitAnnotations(chords.filter((chord) => chord.id !== id))
    const remainingSelection = selectedIds.filter((selected) => selected !== id)
    setSelectedIds(remainingSelection)
    if (selectedId === id) {
      setSelectedId(remainingSelection[0])
      if (!remainingSelection.length) setInspectorOpen(false)
    }
  }, [chords, commitAnnotations, selectedId, selectedIds])

  const addChordAt = useCallback((time: number, template: Partial<ChordAnnotation> = {}) => {
    const targetTrackId = template.trackId ?? activeTrackId
    const insertionKey = keyForTime(time)
    const tonicChord = tonicChordForKey(insertionKey)
    const marker = [...grid].reverse().find((item) => item.time <= time) ?? grid[0]
    const beatSeconds = marker ? (60 / marker.bpm) * (4 / Number(marker.meter.split('/')[1])) : 0.5
    const meterBeats = marker ? Number(marker.meter.split('/')[0]) : 4
    const minimum = Math.max(0.08, beatSeconds / Math.max(1, gridDivision))
    let start = snapTime(time, grid, analysis.duration)
    const sorted = chords
      .filter((item) => (item.trackId ?? tracks[0]?.id) === targetTrackId)
      .sort((a, b) => a.start - b.start)
    const exact = sorted.find((item) => Math.abs(item.start - start) < 0.01)
    if (exact) {
      selectOnly(exact.id)
      setInspectorOpen(true)
      return
    }

    const containing = sorted.find((item) =>
      start > item.start + 0.01 && start < item.start + item.duration - 0.01,
    )
    const previous = [...sorted].reverse().find((item) => item.start + item.duration <= start + 0.01)
    if (!containing && previous) start = Math.max(start, previous.start + previous.duration)
    const next = sorted.find((item) => item.start >= start - 0.01)
    const availableEnd = containing
      ? containing.start + containing.duration
      : Math.min(next?.start ?? analysis.duration, analysis.duration)
    const duration = Math.min(beatSeconds * meterBeats, availableEnd - start)
    if (duration < minimum) {
      const neighbor = next ?? previous
      if (neighbor) {
        selectOnly(neighbor.id)
        setInspectorOpen(true)
      }
      return
    }
    const chord: ChordAnnotation = {
      id: `chord-${crypto.randomUUID()}`,
      start,
      duration,
      root: template.root ?? tonicChord.root,
      quality: template.quality ?? tonicChord.quality,
      bass: template.bass,
      color: CHORD_COLORS[chords.length % CHORD_COLORS.length],
      confidence: 1,
      trackId: targetTrackId,
      velocity: template.velocity ?? 0.72,
      voicing: template.voicing,
    }
    const nextChords = containing
      ? chords.flatMap((item) => item.id === containing.id
        ? [{ ...item, duration: start - item.start }, chord]
        : [item])
      : [...chords, chord]
    commitAnnotations(nextChords.sort((a, b) => a.start - b.start))
    selectOnly(chord.id)
    setInspectorOpen(true)
  }, [
    activeTrackId,
    analysis.duration,
    chords,
    commitAnnotations,
    grid,
    gridDivision,
    keyForTime,
    selectOnly,
    tracks,
  ])

  const auditionChord = useCallback((chord: ChordAnnotation) => {
    const track = tracks.find((item) => item.id === (chord.trackId ?? tracks[0]?.id))
    void playChord(chord, track?.volume ?? midiVolume, `preview-${track?.id ?? 'main'}`)
  }, [midiVolume, tracks])

  const auditionSymbol = useCallback((symbol: string) => {
    const details = TonalChord.get(symbol)
    const notes = pitchClassesToVoicing(details.notes)
    void playNotes(notes, 1.1, midiVolume)
  }, [midiVolume])

  const togglePianoNote = useCallback((note: string) => {
    setPianoNotes((current) => current.includes(note)
      ? current.filter((item) => item !== note)
      : [...current, note].sort((a, b) => (Note.midi(a) ?? 0) - (Note.midi(b) ?? 0)))
    void playNotes([note], 0.38, midiVolume, 'piano', 0.66)
  }, [midiVolume])

  const insertDetectedChord = useCallback((symbol: string, replaceSelected = false) => {
    if (!hasAudio) {
      fileInputRef.current?.click()
      return
    }
    const parsed = parseChordSymbol(symbol)
    const voicing = pianoNotes.length
      ? [...pianoNotes]
      : pitchClassesToVoicing(parsed.details.notes)
    const patch: Partial<ChordAnnotation> = {
      root: parsed.root,
      quality: parsed.quality,
      bass: parsed.bass,
      voicing,
      velocity: 0.72,
      trackId: activeTrackId,
    }
    if (replaceSelected && selectedId) {
      updateSelected(patch)
      void playNotes(voicing, 1.1, midiVolume)
      return
    }
    addChordAt(timeSelection?.start ?? currentTime, patch)
    void playNotes(voicing, 1.1, midiVolume)
    setActivePage('chords')
  }, [
    activeTrackId,
    addChordAt,
    currentTime,
    hasAudio,
    midiVolume,
    pianoNotes,
    selectedId,
    timeSelection,
    updateSelected,
  ])

  const chooseChordQuality = useCallback((root: string, quality: string) => {
    const details = TonalChord.get(`${root}${quality}`)
    const notes = pitchClassesToVoicing(details.notes)
    setPianoNotes(notes)
    void playNotes(notes, 1.1, midiVolume)
  }, [midiVolume])

  const addTrack = () => {
    const track: ChordTrack = {
      id: `track-${crypto.randomUUID()}`,
      name: `和弦轨 ${tracks.length + 1}`,
      volume: 0.72,
      muted: false,
      solo: false,
      color: CHORD_COLORS[tracks.length % CHORD_COLORS.length],
    }
    setTracks((current) => [...current, track])
    setActiveTrackId(track.id)
  }

  const updateTrack = (id: string, patch: Partial<ChordTrack>) => {
    setTracks((current) => current.map((track) => track.id === id ? { ...track, ...patch } : track))
  }

  const toggleChordTrackPlayback = () => {
    if (isChordPlayback) {
      stopChordPlayback()
      setIsChordPlayback(false)
      return
    }
    setIsChordPlayback(true)
    void playChordTimeline(chords, tracks, currentTime, () => setIsChordPlayback(false), midiVolume)
  }

  const playSingleChordTrack = (track: ChordTrack) => {
    stopChordPlayback()
    setIsChordPlayback(true)
    void playChordTimeline(
      chords,
      [{ ...track, muted: false, solo: false }],
      currentTime,
      () => setIsChordPlayback(false),
      midiVolume,
    )
  }

  const undo = useCallback(() => {
    const previous = history.past.at(-1)
    if (!previous) return
    setHistory({
      past: history.past.slice(0, -1),
      future: [chords, ...history.future.slice(0, 39)],
    })
    setSaveState('saving')
    setChords(previous)
  }, [chords, history])

  const redo = useCallback(() => {
    const next = history.future[0]
    if (!next) return
    setHistory({
      past: [...history.past, chords],
      future: history.future.slice(1),
    })
    setSaveState('saving')
    setChords(next)
  }, [chords, history])

  const seek = useCallback((time: number) => {
    const bounded = Math.max(0, Math.min(analysis.duration, time))
    setCurrentTime(bounded)
    if (audioRef.current) audioRef.current.currentTime = bounded
    playbackAnchor.current = { startedAt: performance.now(), from: bounded }
  }, [analysis.duration])

  const followPlaybackTime = useCallback((time: number) => {
    if (!followPlayhead || !scrollerRef.current) return
    const scroller = scrollerRef.current
    const playheadPosition = time * zoomRef.current
    const maximumScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    const target = Math.max(
      0,
      Math.min(maximumScroll, playheadPosition - scroller.clientWidth * 0.28),
    )
    if (Math.abs(scroller.scrollLeft - target) > 0.5) scroller.scrollLeft = target
  }, [followPlayhead])

  const togglePlayback = useCallback(async () => {
    if (isPlaying) {
      audioRef.current?.pause()
      stopChordPlayback()
      setIsPlaying(false)
      setIsChordPlayback(false)
      return
    }
    setRangePlayback(false)
    const start = currentTime >= analysis.duration - 0.02 ? 0 : currentTime
    seek(start)
    followPlaybackTime(start)
    playbackAnchor.current = { startedAt: performance.now(), from: start }
    setIsChordPlayback(true)
    await playChordTimeline(
      chords,
      tracks,
      start,
      () => setIsChordPlayback(false),
      midiVolume,
    )
    if (analysis.url && audioRef.current) {
      audioRef.current.playbackRate = playbackRate
      void audioRef.current.play()
    }
    setIsPlaying(true)
  }, [
    analysis.duration,
    analysis.url,
    chords,
    currentTime,
    isPlaying,
    midiVolume,
    playbackRate,
    seek,
    tracks,
    followPlaybackTime,
  ])

  const playSelectedRange = useCallback(async () => {
    if (!timeSelection) return
    audioRef.current?.pause()
    stopChordPlayback()
    seek(timeSelection.start)
    followPlaybackTime(timeSelection.start)
    playbackAnchor.current = { startedAt: performance.now(), from: timeSelection.start }
    setIsChordPlayback(true)
    await playChordTimeline(
      chords,
      tracks,
      timeSelection.start,
      () => setIsChordPlayback(false),
      midiVolume,
      timeSelection.end,
    )
    if (analysis.url && audioRef.current) {
      audioRef.current.playbackRate = playbackRate
      void audioRef.current.play()
    }
    setRangePlayback(true)
    setIsPlaying(true)
  }, [analysis.url, chords, followPlaybackTime, midiVolume, playbackRate, seek, timeSelection, tracks])

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      const next = analysis.url && audioRef.current
        ? audioRef.current.currentTime
        : playbackAnchor.current.from
          + ((performance.now() - playbackAnchor.current.startedAt) / 1000) * playbackRate
      if (rangePlayback && timeSelection && next >= timeSelection.end) {
        if (loopSelection) {
          const start = timeSelection.start
          setIsChordPlayback(true)
          void playChordTimeline(
            chords,
            tracks,
            start,
            () => setIsChordPlayback(false),
            midiVolume,
            timeSelection.end,
          )
          if (audioRef.current) {
            audioRef.current.currentTime = start
            void audioRef.current.play()
          }
          playbackAnchor.current = { startedAt: performance.now(), from: start }
          setCurrentTime(start)
          followPlaybackTime(start)
          frame = requestAnimationFrame(tick)
          return
        }
        audioRef.current?.pause()
        stopChordPlayback()
        setCurrentTime(timeSelection.end)
        setIsPlaying(false)
        setRangePlayback(false)
        return
      }
      if (next >= analysis.duration) {
        stopChordPlayback()
        setCurrentTime(analysis.duration)
        setIsPlaying(false)
        setIsChordPlayback(false)
        return
      }
      setCurrentTime(next)
      followPlaybackTime(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [
    analysis.duration,
    analysis.url,
    chords,
    followPlaybackTime,
    isPlaying,
    loopSelection,
    midiVolume,
    playbackRate,
    rangePlayback,
    timeSelection,
    tracks,
  ])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.playbackRate = playbackRate
  }, [playbackRate, volume])

  useLayoutEffect(() => {
    if (activePage !== 'chords' || !hasAudio) return
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollLeft = scrollLeftRef.current
    let frame = 0
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width))
    observer.observe(scroller)
    frame = requestAnimationFrame(() => setViewportWidth(scroller.clientWidth))
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [activePage, hasAudio])

  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem('chordtag-annotations', JSON.stringify(chords))
      setSaveState('saved')
    }, 450)
    return () => window.clearTimeout(saveTimer.current)
  }, [chords])

  useEffect(() => {
    localStorage.setItem('chordtag-tracks', JSON.stringify(tracks))
  }, [tracks])

  useEffect(() => {
    tracks.forEach((track) => {
      setSynthChannelVolume(track.id, track.volume * midiVolume)
      setSynthChannelVolume(`preview-${track.id}`, track.volume * midiVolume)
    })
    setSynthChannelVolume('preview', midiVolume)
    setSynthChannelVolume('piano', midiVolume)
  }, [midiVolume, tracks])

  useEffect(() => {
    localStorage.setItem('chordtag-key-map', JSON.stringify(keyMarkers))
  }, [keyMarkers])

  useEffect(() => () => stopChordPlayback(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      } else if (event.key.toLowerCase() === 'a') {
        addChordAt(currentTime)
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelected()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (event.key === 'Escape') {
        setInspectorOpen(false)
        setTempoOpen(false)
        if (rangePlayback) {
          audioRef.current?.pause()
          stopChordPlayback()
          setIsPlaying(false)
          setIsChordPlayback(false)
          setRangePlayback(false)
        }
        setTimeSelection(null)
        setLoopSelection(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addChordAt, currentTime, deleteSelected, rangePlayback, redo, togglePlayback, undo])

  const setZoom = (nextZoom: number, anchorX = viewportWidth / 2) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
    const scroller = scrollerRef.current
    const anchorTime = ((scroller?.scrollLeft ?? scrollLeft) + anchorX) / zoomRef.current
    zoomRef.current = next
    setPixelsPerSecond(next)
    requestAnimationFrame(() => {
      if (scroller) {
        scroller.scrollLeft = Math.max(0, anchorTime * next - anchorX)
      }
    })
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const anchor = event.clientX - bounds.left
    setZoom(zoomRef.current * (event.deltaY > 0 ? 0.92 : 1.087), anchor)
  }

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'pan' || !scrollerRef.current) return
    event.preventDefault()
    const startX = event.clientX
    const startScroll = scrollerRef.current.scrollLeft
    const onMove = (moveEvent: PointerEvent) => {
      if (scrollerRef.current) scrollerRef.current.scrollLeft = startScroll - (moveEvent.clientX - startX)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const selectChordsInRange = useCallback((range: TimeRange) => {
    const matches = chords
      .filter((chord) => chord.start < range.end && chord.start + chord.duration > range.start)
      .map((chord) => chord.id)
    setSelectedIds(matches)
    setSelectedId(matches[0])
    return matches
  }, [chords])

  const beginTimeSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== 'select' || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const scroller = scrollerRef.current
    if (!scroller) return
    const viewport = scroller.getBoundingClientRect()
    const timeAtPointer = (clientX: number) => Math.max(
      0,
      Math.min(
        analysis.duration,
        (scroller.scrollLeft + clientX - viewport.left) / zoomRef.current,
      ),
    )
    const start = timeAtPointer(event.clientX)
    let current = start
    let moved = false
    setTimeSelection({ start, end: start })
    setLoopSelection(false)

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.clientX < viewport.left + 36) {
        scroller.scrollLeft -= Math.min(18, viewport.left + 36 - moveEvent.clientX)
      } else if (moveEvent.clientX > viewport.right - 36) {
        scroller.scrollLeft += Math.min(18, moveEvent.clientX - viewport.right + 36)
      }
      current = timeAtPointer(moveEvent.clientX)
      moved = moved || Math.abs(current - start) * zoomRef.current > 4
      setTimeSelection({ start: Math.min(start, current), end: Math.max(start, current) })
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (!moved) {
        setTimeSelection(null)
        seek(start)
        return
      }
      const range = { start: Math.min(start, current), end: Math.max(start, current) }
      setTimeSelection(range)
      selectChordsInRange(range)
      seek(range.start)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const zoomToTimeSelection = () => {
    if (!timeSelection || !scrollerRef.current) return
    const duration = Math.max(0.01, timeSelection.end - timeSelection.start)
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (viewportWidth - 48) / duration))
    zoomRef.current = nextZoom
    setPixelsPerSecond(nextZoom)
    requestAnimationFrame(() => {
      if (scrollerRef.current) {
        scrollerRef.current.scrollLeft = Math.max(0, timeSelection.start * nextZoom - 24)
      }
    })
  }

  const createChordFromTimeSelection = () => {
    if (!timeSelection) return
    const start = snapTime(timeSelection.start, grid, analysis.duration)
    const end = snapTime(timeSelection.end, grid, analysis.duration)
    if (end - start < 0.08) return
    const range = { start, end }
    const intersecting = chords.filter((chord) =>
      (chord.trackId ?? tracks[0]?.id) === activeTrackId
      && chord.start < range.end
      && chord.start + chord.duration > range.start,
    )
    if (intersecting.length) {
      selectChordsInRange(range)
      return
    }
    const tonicChord = tonicChordForKey(keyForTime(start))
    const chord: ChordAnnotation = {
      id: `chord-${crypto.randomUUID()}`,
      start,
      duration: end - start,
      root: tonicChord.root,
      quality: tonicChord.quality,
      color: CHORD_COLORS[chords.length % CHORD_COLORS.length],
      confidence: 1,
      trackId: activeTrackId,
      velocity: 0.72,
    }
    commitAnnotations([...chords, chord])
    selectOnly(chord.id)
    setInspectorOpen(true)
  }

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>, trackId: string) => {
    if (tool !== 'select' || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.chord-block') || target.closest('.lane-title')) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const start = Math.max(0, Math.min(timelineWidth, event.clientX - bounds.left))
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    let current = start
    setMarquee({ start, current, trackId })

    const onMove = (moveEvent: PointerEvent) => {
      current = Math.max(0, Math.min(timelineWidth, moveEvent.clientX - bounds.left))
      setMarquee({ start, current, trackId })
    }
    const onUp = () => {
      const from = Math.min(start, current) / pixelsPerSecond
      const to = Math.max(start, current) / pixelsPerSecond
      const matches = Math.abs(current - start) < 4
        ? []
        : chords
          .filter((chord) => (chord.trackId ?? tracks[0]?.id) === trackId)
          .filter((chord) => chord.start < to && chord.start + chord.duration > from)
          .map((chord) => chord.id)
      const next = additive ? [...new Set([...selectedIds, ...matches])] : matches
      setSelectedIds(next)
      setSelectedId(next[0])
      setMarquee(null)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const beginChordDrag = (
    event: ReactPointerEvent,
    chord: ChordAnnotation,
    mode: 'move' | 'start' | 'end',
  ) => {
    if (tool !== 'select') return
    event.stopPropagation()
    event.preventDefault()
    if (
      !selectedIds.includes(chord.id)
      && !event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
    ) selectOnly(chord.id)
    const pointerStart = event.clientX
    const original = chords
    const minDuration = grid.length > 1 ? Math.max(0.08, grid[1].time - grid[0].time) : 0.12
    const chordTrack = chord.trackId ?? tracks[0]?.id
    const ordered = chords
      .filter((item) => (item.trackId ?? tracks[0]?.id) === chordTrack)
      .sort((a, b) => a.start - b.start)
    const chordIndex = ordered.findIndex((item) => item.id === chord.id)
    const previous = ordered[chordIndex - 1]
    const previousEnd = previous ? previous.start + previous.duration : 0
    let changed = false

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - pointerStart) / zoomRef.current
      changed = changed || Math.abs(delta) > 0.005
      if (changed) setSaveState('saving')
      if (mode === 'move') {
        const desired = snapTime(chord.start + delta, grid, analysis.duration)
        setChords(rippleMoveChord(
          original,
          chord,
          desired,
          analysis.duration,
          tracks[0]?.id ?? 'track-1',
        ))
        return
      }
      if (mode === 'start') {
        const end = chord.start + chord.duration
        const desired = snapTime(chord.start + delta, grid, analysis.duration)
        const start = Math.max(previousEnd, Math.min(end - minDuration, desired))
        setChords(original.map((item) =>
          item.id === chord.id ? { ...item, start, duration: end - start } : item,
        ))
        return
      }
      const desiredEnd = Math.max(
        chord.start + minDuration,
        snapTime(chord.start + chord.duration + delta, grid, analysis.duration),
      )
      setChords(rippleResizeChord(
        original,
        chord,
        desiredEnd - chord.start,
        minDuration,
        analysis.duration,
        tracks[0]?.id ?? 'track-1',
      ))
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (changed) {
        setHistory((current) => ({
          past: [...current.past.slice(-39), original],
          future: [],
        }))
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const applyFirstBeatOffset = (value: number) => {
    const bounded = Math.max(0, Math.min(analysis.duration, value))
    setFirstBeatOffset(bounded)
    setTempoMarkers((current) => normalizeTempoMarkers(current, bounded))
  }

  const beginFirstBeatDrag = (event: ReactPointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const pointerStart = event.clientX
    const offsetStart = firstBeatOffset
    let frame = 0
    const onMove = (moveEvent: PointerEvent) => {
      const next = offsetStart + (moveEvent.clientX - pointerStart) / zoomRef.current
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => applyFirstBeatOffset(next))
    }
    const onUp = () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const updateTempoMarker = (id: string, patch: Partial<TempoMarker>) => {
    setTempoMarkers((current) => normalizeTempoMarkers(
      current.map((marker) => marker.id === id ? { ...marker, ...patch } : marker),
      firstBeatOffset,
    ))
  }

  const updateTempo = (patch: Partial<TempoMarker>) => updateTempoMarker(activeTempo.id, patch)

  const addTempoMarker = () => {
    const currentBar = [...grid].reverse().find((marker) => marker.isBar && marker.time <= currentTime)
    const startBar = currentBar?.bar ?? 1
    const existing = tempoMarkers.find((marker) => marker.startBar === startBar)
    if (existing) return
    const next = [...tempoMarkers, {
      ...activeTempo,
      id: `tempo-${crypto.randomUUID()}`,
      startBar,
      startTime: currentBar?.time ?? firstBeatOffset,
    }]
    setTempoMarkers(normalizeTempoMarkers(next, firstBeatOffset))
  }

  const addKeyMarker = () => {
    const bar = [...grid].reverse().find((marker) => marker.isBar && marker.time <= currentTime)?.bar ?? 1
    if (keyMarkers.some((marker) => marker.startBar === bar)) {
      setKeyOpen(true)
      return
    }
    setKeyMarkers((current) => [...current, {
      id: `key-${crypto.randomUUID()}`,
      startBar: bar,
      tonic: activeKey.tonic,
      mode: activeKey.mode,
    }].sort((a, b) => a.startBar - b.startBar))
    setKeyOpen(true)
  }

  const removeActiveKeyMarker = () => {
    if (activeKey.startBar === 1) return
    setKeyMarkers((current) => current.filter((marker) => marker.id !== activeKey.id))
  }

  const handleAudioImport = async (file?: File) => {
    if (!file) return
    setImportProgress(0)
    try {
      const next = await analyseAudioFile(file, setImportProgress)
      if (analysis.url) URL.revokeObjectURL(analysis.url)
      setAnalysis(next)
      setHasAudio(true)
      setActivePage('chords')
      setCurrentTime(0)
      setScrollLeft(0)
      scrollLeftRef.current = 0
      if (scrollerRef.current) scrollerRef.current.scrollLeft = 0
    } finally {
      setImportProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const exportAnnotations = () => {
    const payload = {
      $schema: 'https://rigelnana.github.io/chordtag/chordtag-annotation.schema.json',
      format: 'ChordTag Annotation Standard',
      version: '1.0.0',
      metadata: {
        title: analysis.name.replace(/\.[^/.]+$/, ''),
        duration: Number(analysis.duration.toFixed(6)),
        createdAt: new Date().toISOString(),
      },
      musicalContext: {
        tonic: keyTimeline[0].tonic,
        mode: keyTimeline[0].mode,
        keyMap: keyTimeline.map((marker) => ({
          startBar: marker.startBar,
          startTime: Number(marker.startTime.toFixed(6)),
          tonic: marker.tonic,
          mode: marker.mode,
        })),
      },
      tracks: tracks.map((track) => ({
        id: track.id,
        name: track.name,
        volume: track.volume,
        muted: track.muted,
        solo: track.solo,
      })),
      timeline: {
        firstBeatOffset,
        tempoMap: tempoMarkers.map((marker) => ({
          startTime: marker.startTime,
          startBar: marker.startBar,
          bpm: marker.bpm,
          numerator: marker.numerator,
          denominator: marker.denominator,
        })),
      },
      annotations: chords.map((chord) => {
        const chordKey = keyForTime(chord.start)
        const harmonic = analyzeHarmonyContext(chord, chordKey)
        return {
          id: chord.id,
          start: Number(chord.start.toFixed(6)),
          end: Number((chord.start + chord.duration).toFixed(6)),
          symbol: chordName(chord),
          root: chord.root,
          quality: chord.quality,
          bass: chord.bass ?? null,
          romanNumeral: harmonic.roman,
          confidence: chord.confidence ?? 1,
          trackId: chord.trackId ?? tracks[0]?.id,
          voicing: chord.voicing ?? annotationVoicing(chord),
          velocity: chord.velocity ?? 0.72,
          keyContext: {
            tonic: chordKey.tonic,
            mode: chordKey.mode,
            startBar: chordKey.startBar,
          },
          harmonicAnalysis: {
            classification: harmonic.classification,
            diatonic: harmonic.diatonic,
            chordToneCoverage: harmonic.chordToneCoverage,
            borrowedFrom: harmonic.borrowedFrom,
            secondaryTarget: harmonic.secondaryTarget ?? null,
          },
        }
      }),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${payload.metadata.title || 'annotations'}.chordtag.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <header className="top-app-bar">
        <div className="brand-lockup">
          <div className="brand-mark"><AudioLines size={21} /></div>
          <strong>ChordTag</strong>
        </div>
        <div className="project-heading">
          <span>{hasAudio ? analysis.name.replace(/\.[^/.]+$/, '') : '未命名项目'}</span>
          <span className={`save-state ${saveState}`}><Save size={13} />{hasAudio ? saveState === 'saved' ? '已保存到本机' : '保存中' : '等待导入音频'}</span>
        </div>
        <div className="header-actions">
          <button className="text-button subtle"><CircleHelp size={17} /><span>帮助</span></button>
          <button className="filled-button" disabled={!hasAudio} onClick={exportAnnotations}>
            <Download size={17} />
            <span>导出标注</span>
          </button>
        </div>
      </header>

      <aside className="navigation-rail">
        <button className="rail-action" onClick={() => fileInputRef.current?.click()}>
          <Plus size={22} />
          <span>导入</span>
        </button>
        <div className="rail-nav">
          <button className={activePage === 'chords' ? 'active' : ''} onClick={() => setActivePage('chords')}><Music2 size={21} /><span>和弦</span></button>
          <button className={activePage === 'finder' ? 'active' : ''} onClick={() => setActivePage('finder')}><Piano size={21} /><span>寻找</span></button>
        </div>
        <button className={`rail-bottom ${activePage === 'settings' ? 'active' : ''}`} onClick={() => setActivePage('settings')}><Settings2 size={21} /><span>设置</span></button>
      </aside>

      <main className="workspace">
        {activePage === 'chords' && hasAudio ? (
          <>
        <div className="workspace-toolbar">
          <div className="tool-cluster">
            <ToolButton active={tool === 'select'} label="选择工具 (V)" onClick={() => setTool('select')}>
              <MousePointer2 size={18} />
            </ToolButton>
            <ToolButton active={tool === 'pan'} label="平移工具 (H)" onClick={() => setTool('pan')}>
              <Hand size={18} />
            </ToolButton>
            <span className="toolbar-divider" />
            <ToolButton label="撤销" onClick={undo}><Undo2 size={18} /></ToolButton>
            <ToolButton label="重做" onClick={redo}><Redo2 size={18} /></ToolButton>
            <AnimatePresence>
              {selectedIds.length > 0 && (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className="selection-actions"
                  exit={{ opacity: 0, scale: 0.96 }}
                  initial={{ opacity: 0, scale: 0.96 }}
                >
                  <span>已选 {selectedIds.length}</span>
                  <button aria-label="删除选中的和弦" onClick={deleteSelected} title="删除选中项">
                    <Trash2 size={15} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="context-controls">
            <div className="key-map-wrapper">
              <div className="key-control">
                <span>第 {activeKey.startBar} 小节起</span>
                <MaterialSelect
                  ariaLabel="调性根音"
                  className="compact"
                  onChange={setKeyRoot}
                  options={ROOTS.map((root) => ({ value: root, label: root }))}
                  value={keyRoot}
                />
                <MaterialSelect
                  ariaLabel="调式"
                  className="compact mode-select"
                  onChange={(value) => setKeyMode(value as KeyMode)}
                  options={KEY_MODE_OPTIONS}
                  value={keyMode}
                />
                <button aria-label="在当前小节添加调性变化" className="key-add-button" onClick={addKeyMarker}><Plus size={14} /></button>
                <button aria-label="查看调性图" className="key-map-button" onClick={() => setKeyOpen((open) => !open)}><ChevronDown size={14} /></button>
              </div>
              <AnimatePresence>
                {keyOpen && (
                  <motion.div animate={{ opacity: 1, y: 0 }} className="key-map-popover" exit={{ opacity: 0, y: -5 }} initial={{ opacity: 0, y: -5 }}>
                    <div className="popover-heading">
                      <div><span className="eyebrow">调性 / 调式图</span><strong>按小节生效</strong></div>
                      <button className="icon-button" onClick={() => setKeyOpen(false)}><X size={16} /></button>
                    </div>
                    <div className="key-marker-list">
                      {keyTimeline.map((marker) => (
                        <button
                          className={marker.id === activeKey.id ? 'active' : ''}
                          key={marker.id}
                          onClick={() => {
                            seek(marker.startTime)
                            setKeyOpen(false)
                          }}
                        >
                          <span>第 {marker.startBar} 小节</span>
                          <strong>{marker.tonic} {KEY_MODE_OPTIONS.find((mode) => mode.value === marker.mode)?.label}</strong>
                        </button>
                      ))}
                    </div>
                    <div className="key-popover-actions">
                      <button className="outlined-wide" onClick={addKeyMarker}><Plus size={14} />当前小节添加变化</button>
                      {activeKey.startBar > 1 && <button className="delete-key-marker" onClick={removeActiveKeyMarker}><Trash2 size={14} />删除当前调性点</button>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button className="keyboard-hint"><Keyboard size={16} /><span>快捷键</span><kbd>?</kbd></button>
          </div>
        </div>

        <section className="editor-card">
          <div className="timeline-toolbar">
            <div className="view-switch" role="group" aria-label="音频视图">
              <button
                className={waveformMode === 'waveform' ? 'active' : ''}
                onClick={() => setWaveformMode('waveform')}
              >
                <Waves size={16} />振幅
              </button>
              <button
                className={waveformMode === 'spectrogram' ? 'active' : ''}
                onClick={() => setWaveformMode('spectrogram')}
              >
                <Activity size={16} />频谱
              </button>
            </div>

            <div className="timeline-settings">
              <button className="setting-chip track-add-chip" onClick={addTrack}>
                <Plus size={15} />轨道 {tracks.length}
              </button>
              <div className="tempo-wrapper">
                <button className="setting-chip" onClick={() => setTempoOpen((open) => !open)}>
                  <Gauge size={16} />
                  <strong>{activeTempo.bpm}</strong> BPM
                  <span className="chip-separator" />
                  {activeTempo.numerator}/{activeTempo.denominator}
                  <ChevronDown size={14} />
                </button>
                <AnimatePresence>
                  {tempoOpen && (
                    <motion.div
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className="tempo-popover"
                      exit={{ opacity: 0, y: -5, scale: 0.98 }}
                      initial={{ opacity: 0, y: -5, scale: 0.98 }}
                    >
                      <div className="popover-heading">
                        <div><span className="eyebrow">速度与拍号</span><strong>第 {activeTempo.startBar} 小节起</strong></div>
                        <button className="icon-button" onClick={() => setTempoOpen(false)}><X size={16} /></button>
                      </div>
                      <div className="tempo-fields">
                        <label><span>BPM</span><input type="number" min="20" max="300" value={activeTempo.bpm} onChange={(event) => updateTempo({ bpm: Number(event.target.value) })} /></label>
                        <label><span>每小节拍数</span><input type="number" min="1" max="16" value={activeTempo.numerator} onChange={(event) => updateTempo({ numerator: Number(event.target.value) })} /></label>
                        <label>
                          <span>拍值</span>
                          <MaterialSelect
                            ariaLabel="拍号分母"
                            onChange={(value) => updateTempo({ denominator: Number(value) })}
                            options={['2', '4', '8', '16'].map((value) => ({ value, label: value }))}
                            value={String(activeTempo.denominator)}
                          />
                        </label>
                        <label><span>首拍起点 (秒)</span><input type="number" min="0" step="0.01" value={firstBeatOffset} onChange={(event) => applyFirstBeatOffset(Number(event.target.value))} /></label>
                      </div>
                      <button className="outlined-wide" onClick={addTempoMarker}><Plus size={16} />在当前小节添加切换</button>
                      <div className="tempo-map">
                        {tempoMarkers.map((marker) => (
                          <span className={marker.id === activeTempo.id ? 'active' : ''} key={marker.id}>
                            {marker.startBar} · {marker.bpm} · {marker.numerator}/{marker.denominator}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="setting-chip grid-chip">
                <Grid2X2 size={16} />
                网格
                <MaterialSelect
                  ariaLabel="网格粒度"
                  className="compact"
                  onChange={(value) => setGridDivision(Number(value) as GridDivision)}
                  options={[
                    { value: '1', label: '1/4' },
                    { value: '2', label: '1/8' },
                    { value: '4', label: '1/16' },
                    { value: '8', label: '1/32' },
                  ]}
                  value={String(gridDivision)}
                />
              </div>
              <div className="zoom-control">
                <button aria-label="缩小时间轴" onClick={() => setZoom(pixelsPerSecond * 0.82)}>−</button>
                <input
                  aria-label="时间轴缩放"
                  max={MAX_ZOOM}
                  min={MIN_ZOOM}
                  type="range"
                  value={pixelsPerSecond}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <button aria-label="放大时间轴" onClick={() => setZoom(pixelsPerSecond * 1.22)}>＋</button>
                <span>{Math.round((pixelsPerSecond / 108) * 100)}%</span>
              </div>
            </div>
          </div>

          <div
            className={`timeline-scroll ${tool === 'pan' ? 'pan-mode' : ''}`}
            onPointerDown={beginPan}
            onScroll={(event) => {
              scrollLeftRef.current = event.currentTarget.scrollLeft
              setScrollLeft(event.currentTarget.scrollLeft)
            }}
            onWheel={onWheel}
            ref={scrollerRef}
          >
            <div className="timeline-surface" style={{ height: timelineHeight, width: timelineWidth }}>
              <div className="ruler-row">
                <button
                  aria-label="拖动首拍起点"
                  className="first-beat-anchor"
                  onPointerDown={beginFirstBeatDrag}
                  style={{ left: firstBeatOffset * pixelsPerSecond }}
                  title="拖动首拍；后续小节线会一起移动"
                  type="button"
                >
                  <span />
                  首拍
                </button>
                {keyTimeline.map((marker) => (
                  <button
                    className="key-change-marker"
                    key={marker.id}
                    onClick={() => seek(marker.startTime)}
                    style={{ left: marker.startTime * pixelsPerSecond }}
                    title={`${marker.tonic} ${KEY_MODE_OPTIONS.find((mode) => mode.value === marker.mode)?.label}`}
                  >
                    {marker.tonic} · {KEY_MODE_OPTIONS.find((mode) => mode.value === marker.mode)?.label}
                  </button>
                ))}
                {visibleGrid.filter((marker) => marker.isBar).map((marker) => (
                  <span
                    className="bar-number"
                    key={`label-${marker.bar}-${marker.time}`}
                    style={{ left: marker.time * pixelsPerSecond }}
                  >
                    <b>{marker.bar}</b>
                    <small>{marker.meter}</small>
                  </span>
                ))}
              </div>

              <div className="waveform-row" onPointerDown={beginTimeSelection}>
                <WaveformCanvas
                  analysis={analysis}
                  mode={waveformMode}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollContainerRef={scrollerRef}
                  timelineWidth={timelineWidth}
                />
                {timeSelection && timeSelection.end > timeSelection.start && (
                  <div
                    className="time-selection"
                    style={{
                      left: timeSelection.start * pixelsPerSecond,
                      width: (timeSelection.end - timeSelection.start) * pixelsPerSecond,
                    }}
                  >
                    <span>
                      {formatTime(timeSelection.start, true)}–{formatTime(timeSelection.end, true)}
                      <b>{(timeSelection.end - timeSelection.start).toFixed(3)} s</b>
                    </span>
                  </div>
                )}
                {waveformMode === 'spectrogram' && (
                  <div className="frequency-labels">
                    <span>12k</span><span>1k</span><span>100</span>
                  </div>
                )}
              </div>

              {tracks.map((track) => {
                const trackChords = chords.filter((chord) =>
                  (chord.trackId ?? tracks[0]?.id) === track.id,
                )
                return (
              <div
                className={`chord-lane ${activeTrackId === track.id ? 'active' : ''}`}
                key={track.id}
                onDoubleClick={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect()
                  setActiveTrackId(track.id)
                  addChordAt((event.clientX - bounds.left) / pixelsPerSecond, { trackId: track.id })
                }}
                onPointerDown={(event) => beginMarquee(event, track.id)}
              >
                <div className={`lane-title ${track.color}`} onPointerDown={() => setActiveTrackId(track.id)}>
                  <Music2 size={15} />
                  <span>{track.name}</span>
                  <small>{trackChords.length}</small>
                  <button
                    aria-label={`${track.muted ? '取消静音' : '静音'} ${track.name}`}
                    className={track.muted ? 'track-toggle active' : 'track-toggle'}
                    onClick={(event) => {
                      event.stopPropagation()
                      updateTrack(track.id, { muted: !track.muted })
                    }}
                    type="button"
                  >
                    M
                  </button>
                  <button
                    aria-label={`播放 ${track.name}`}
                    className="track-play"
                    onClick={(event) => {
                      event.stopPropagation()
                      playSingleChordTrack(track)
                    }}
                    type="button"
                  >
                    <Play size={10} fill="currentColor" />
                  </button>
                  <button
                    aria-label="在播放头处添加和弦"
                    onClick={(event) => {
                      event.stopPropagation()
                      setActiveTrackId(track.id)
                      addChordAt(currentTime, { trackId: track.id })
                    }}
                    type="button"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {trackChords.map((chord) => {
                  const chordKey = keyForTime(chord.start)
                  const numeral = romanNumeral(chordKey.tonic, chordKey.mode, chord)
                  return (
                    <motion.div
                      animate={{ opacity: 1, scale: 1 }}
                      className={`chord-block ${chord.color} ${selectedIds.includes(chord.id) ? 'selected' : ''}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      key={chord.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (event.shiftKey || event.metaKey || event.ctrlKey) {
                          const next = selectedIds.includes(chord.id)
                            ? selectedIds.filter((id) => id !== chord.id)
                            : [...selectedIds, chord.id]
                          setSelectedIds(next)
                          setSelectedId(next.includes(chord.id) ? chord.id : next[0])
                        } else {
                          selectOnly(chord.id)
                        }
                        setInspectorOpen(true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectOnly(chord.id)
                          setInspectorOpen(true)
                        }
                      }}
                      onPointerDown={(event) => beginChordDrag(event, chord, 'move')}
                      role="button"
                      style={{
                        left: chord.start * pixelsPerSecond,
                        width: Math.max(18, chord.duration * pixelsPerSecond - 3),
                      }}
                      tabIndex={0}
                    >
                      <span
                        className="resize-handle start"
                        onPointerDown={(event) => beginChordDrag(event, chord, 'start')}
                      />
                      <span className="chord-main">{chordName(chord)}</span>
                      <span className="chord-roman">{numeral}</span>
                      <span
                        className="resize-handle end"
                        onPointerDown={(event) => beginChordDrag(event, chord, 'end')}
                      />
                      <button
                        aria-label={`试听 ${chordName(chord)}`}
                        className="chord-audition"
                        onClick={(event) => {
                          event.stopPropagation()
                          auditionChord(chord)
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        title="试听和弦"
                        type="button"
                      >
                        <Play size={11} fill="currentColor" />
                      </button>
                      <button
                        aria-label={`删除 ${chordName(chord)}`}
                        className="chord-delete"
                        onClick={(event) => {
                          event.stopPropagation()
                          deleteChord(chord.id)
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        title="删除和弦"
                        type="button"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  )
                })}
                {marquee?.trackId === track.id && (
                  <div
                    className="marquee-selection"
                    style={{
                      left: Math.min(marquee.start, marquee.current),
                      width: Math.abs(marquee.current - marquee.start),
                    }}
                  />
                )}
              </div>
                )
              })}

              <div className="timeline-grid" aria-hidden>
                {visibleGrid.map((marker) => (
                  <span
                    className={marker.isBar ? 'bar' : Number.isInteger(marker.beat) ? 'beat' : 'subdivision'}
                    key={`${marker.bar}-${marker.beat}-${marker.time}`}
                    style={{ left: marker.time * pixelsPerSecond }}
                  />
                ))}
              </div>
              <div className="global-playhead" style={{ left: currentTime * pixelsPerSecond }} />
            </div>
          </div>

          <section className={`piano-dock ${pianoExpanded ? 'expanded' : ''}`}>
            <div className="piano-dock-header">
              <div className="live-chord-name">
                <Piano size={18} />
                <div>
                  <span>钢琴和弦输入</span>
                  <strong>{pianoCandidates[0] || (pianoNotes.length ? '分析中…' : '点击琴键开始')}</strong>
                </div>
              </div>
              <div className="piano-candidate-strip">
                {pianoCandidates.slice(0, 5).map((candidate, index) => (
                  <button
                    className={index === 0 ? 'primary' : ''}
                    key={candidate}
                    onClick={() => insertDetectedChord(candidate, Boolean(selectedChord))}
                    title={selectedChord ? `将所选和弦改为 ${candidate}` : `插入 ${candidate}`}
                  >
                    {candidate}<Plus size={11} />
                  </button>
                ))}
              </div>
              <div className="piano-dock-actions">
                <button className={isChordPlayback ? 'active' : ''} onClick={toggleChordTrackPlayback}>
                  {isChordPlayback ? <Square size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                  {isChordPlayback ? '停止 MIDI' : '播放和弦轨'}
                </button>
                <label><Volume2 size={14} /><input max="1" min="0" step="0.01" type="range" value={midiVolume} onChange={(event) => setMidiVolume(Number(event.target.value))} /></label>
                <button className="dock-collapse" onClick={() => setPianoExpanded((value) => !value)}>{pianoExpanded ? '收起' : '展开'}</button>
              </div>
            </div>
            {pianoExpanded && (
              <>
                <PianoKeyboard compact selectedNotes={pianoNotes} onToggle={togglePianoNote} />
                <div className="track-mixer">
                  {tracks.map((track) => (
                    <div className={`track-mixer-strip ${activeTrackId === track.id ? 'active' : ''}`} key={track.id} onClick={() => setActiveTrackId(track.id)}>
                      <span className={`track-color ${track.color}`} />
                      <strong>{track.name}</strong>
                      <button className={track.muted ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, { muted: !track.muted }) }}>M</button>
                      <button className={track.solo ? 'active solo' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, { solo: !track.solo }) }}>S</button>
                      <button aria-label={`播放 ${track.name}`} onClick={(event) => { event.stopPropagation(); playSingleChordTrack(track) }}><Play size={10} fill="currentColor" /></button>
                      <Volume2 size={13} />
                      <input aria-label={`${track.name} 音量`} max="1" min="0" step="0.01" type="range" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <div className="transport-bar">
            <div className="transport-left">
              <button className="icon-button" aria-label="上一小节" onClick={() => {
                const previous = [...grid].reverse().find((marker) => marker.isBar && marker.time < currentTime - 0.05)
                seek(previous?.time ?? 0)
              }}><Minus size={17} /></button>
              <button className="play-button" aria-label={isPlaying ? '暂停' : '播放'} onClick={togglePlayback}>
                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>
              <div className="time-display">
                <strong>{formatTime(currentTime, true)}</strong>
                <span>/ {formatTime(analysis.duration, true)}</span>
              </div>
            </div>
            <div className={`transport-center ${timeSelection ? 'has-selection' : ''}`}>
              {timeSelection ? (
                <div className="time-selection-actions">
                  <strong>{(timeSelection.end - timeSelection.start).toFixed(3)} s</strong>
                  <button onClick={playSelectedRange} title="播放所选片段"><Play size={13} />播放</button>
                  <button className={loopSelection ? 'active' : ''} onClick={() => setLoopSelection((value) => !value)} title="循环所选片段"><Repeat2 size={13} />循环</button>
                  <button onClick={zoomToTimeSelection} title="缩放到所选范围"><Focus size={13} />适应</button>
                  <button onClick={() => selectChordsInRange(timeSelection)} title="选择范围内的和弦"><Music2 size={13} />和弦</button>
                  <button onClick={createChordFromTimeSelection} title="用空白所选范围创建和弦；已有和弦时改为选择"><Plus size={13} />创建</button>
                  <button aria-label="清除时间选择" onClick={() => {
                    if (rangePlayback) {
                      audioRef.current?.pause()
                      stopChordPlayback()
                      setIsPlaying(false)
                      setIsChordPlayback(false)
                    }
                    setTimeSelection(null)
                    setLoopSelection(false)
                    setRangePlayback(false)
                  }} title="清除范围"><X size={13} /></button>
                </div>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>拖动波形选择片段 · 拖框选择和弦 · Ctrl + 滚轮缩放</span>
                </>
              )}
            </div>
            <div className="transport-right">
              <button
                className={`follow-playhead-button ${followPlayhead ? 'active' : ''}`}
                onClick={() => setFollowPlayhead((value) => !value)}
                title="播放时自动跟随播放头"
              >
                <Focus size={13} />跟随
              </button>
              <button className="rate-button" onClick={() => setPlaybackRate((rate) => rate === 1 ? 0.75 : rate === 0.75 ? 1.25 : 1)}>
                {playbackRate}×
              </button>
              <label className="transport-volume"><Volume2 size={14} /><span>音频</span><input aria-label="原音频音量" max="1" min="0" step="0.01" type="range" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
              <label className="transport-volume midi"><Piano size={14} /><span>MIDI</span><input aria-label="和弦 MIDI 音量" max="1" min="0" step="0.01" type="range" value={midiVolume} onChange={(event) => setMidiVolume(Number(event.target.value))} /></label>
            </div>
          </div>
        </section>

        <div className="project-footer">
          <div><Headphones size={16} /><span>{analysis.name}</span><small>{formatTime(analysis.duration)}</small></div>
          <div><SlidersHorizontal size={15} /><span>48 kHz · 24 bit · Stereo</span></div>
          <button onClick={() => fileInputRef.current?.click()}><Upload size={15} />替换音频</button>
        </div>
          </>
        ) : (
          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="feature-page"
            initial={{ opacity: 0, y: 8 }}
            key={activePage}
          >
            {!hasAudio && activePage === 'chords' && (
              <div className="empty-project-state">
                <div className="empty-project-icon"><AudioLines size={32} /></div>
                <span className="eyebrow">Empty project</span>
                <h1>先导入一段音频</h1>
                <p>项目目前没有默认音频或和弦。导入后即可开始时间轴标注。</p>
                <button className="filled-button" onClick={() => fileInputRef.current?.click()}><Upload size={17} />选择音频文件</button>
              </div>
            )}

            {activePage === 'finder' && (
              <ChordFinder
                candidates={pianoCandidates}
                keyMode={keyMode}
                keyRoot={keyRoot}
                onAudition={auditionSymbol}
                onChooseQuality={chooseChordQuality}
                onClear={() => setPianoNotes([])}
                onInsert={(symbol) => insertDetectedChord(symbol, false)}
                onToggleNote={togglePianoNote}
                selectedNotes={pianoNotes}
              />
            )}

            {activePage === 'settings' && (
              <>
                <div className="feature-page-header">
                  <div className="page-icon"><Settings2 size={24} /></div>
                  <div><span className="eyebrow">Project preferences</span><h1>项目设置</h1><p>设置默认调性、吸附精度和导出格式。</p></div>
                </div>
                <div className="settings-grid">
                  <article className="feature-card setting-card">
                    <div><strong>当前调性段</strong><span>用于所在小节的级数与新增和弦</span></div>
                    <div className="setting-row">
                      <MaterialSelect ariaLabel="设置根音" onChange={setKeyRoot} options={ROOTS.map((root) => ({ value: root, label: root }))} value={keyRoot} />
                      <MaterialSelect ariaLabel="设置调式" onChange={(value) => setKeyMode(value as KeyMode)} options={KEY_MODE_OPTIONS} value={keyMode} />
                    </div>
                  </article>
                  <article className="feature-card setting-card">
                    <div><strong>时间轴吸附</strong><span>拖动与调整时长的最小网格</span></div>
                    <MaterialSelect ariaLabel="设置网格" onChange={(value) => setGridDivision(Number(value) as GridDivision)} options={[{ value: '1', label: '1/4 拍' }, { value: '2', label: '1/8 拍' }, { value: '4', label: '1/16 拍' }, { value: '8', label: '1/32 拍' }]} value={String(gridDivision)} />
                  </article>
                  <article className="feature-card setting-card">
                    <div><strong>标注 JSON</strong><span>包含速度图、调性、和弦与置信度</span></div>
                    <button className="outlined-wide" disabled={!hasAudio} onClick={exportAnnotations}><Download size={16} />导出 JSON</button>
                  </article>
                  <article className="feature-card setting-card">
                    <div><strong>本地自动保存</strong><span>标注只保存在此浏览器，不会上传</span></div>
                    <span className="status-pill"><BadgeCheck size={15} />已启用</span>
                  </article>
                </div>
              </>
            )}
          </motion.section>
        )}
      </main>

      <aside className="inspector-panel">
        {activePage === 'chords' && hasAudio ? (
          <ChordInspector chord={selectedChord} harmonyContext={selectedHarmony?.context} keyMode={keyMode} keyRoot={keyRoot} onAudition={auditionChord} onClose={() => setInspectorOpen(false)} onDelete={deleteSelected} onUpdate={updateSelected} tracks={tracks} voiceLeading={selectedHarmony?.voiceLeading} />
        ) : (
          <div className="side-page-summary">
            <span className="eyebrow">项目概览</span>
            <h2>{hasAudio ? analysis.name.replace(/\.[^/.]+$/, '') : '未命名项目'}</h2>
            <div className="summary-stat"><span>音频时长</span><strong>{hasAudio ? formatTime(analysis.duration, true) : '—'}</strong></div>
            <div className="summary-stat"><span>和弦片段</span><strong>{chords.length}</strong></div>
            <div className="summary-stat"><span>速度段</span><strong>{hasAudio ? tempoMarkers.length : 0}</strong></div>
            <button className="outlined-wide" onClick={() => setActivePage('chords')}><Music2 size={16} />返回和弦时间轴</button>
          </div>
        )}
      </aside>

      <AnimatePresence>
        {inspectorOpen && activePage === 'chords' && (
          <>
            <motion.button animate={{ opacity: 1 }} className="mobile-scrim" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onClick={() => setInspectorOpen(false)} />
            <motion.aside
              animate={{ y: 0 }}
              className="mobile-inspector"
              exit={{ y: '100%' }}
              initial={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              <div className="sheet-handle" />
              <ChordInspector chord={selectedChord} harmonyContext={selectedHarmony?.context} keyMode={keyMode} keyRoot={keyRoot} onAudition={auditionChord} onClose={() => setInspectorOpen(false)} onDelete={deleteSelected} onUpdate={updateSelected} tracks={tracks} voiceLeading={selectedHarmony?.voiceLeading} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <input
        accept="audio/*"
        className="visually-hidden"
        onChange={(event) => void handleAudioImport(event.target.files?.[0])}
        ref={fileInputRef}
        type="file"
      />
      {analysis.url && <audio onEnded={() => {
        stopChordPlayback()
        setIsPlaying(false)
        setIsChordPlayback(false)
      }} ref={audioRef} src={analysis.url} />}

      <AnimatePresence>
        {importProgress !== null && (
          <motion.div animate={{ opacity: 1, y: 0 }} className="analysis-toast" exit={{ opacity: 0, y: 12 }} initial={{ opacity: 0, y: 12 }}>
            <div className="analysis-spinner"><AudioLines size={19} /></div>
            <div><strong>正在解析音频</strong><span>生成振幅与频谱数据… {Math.round(importProgress * 100)}%</span></div>
            <div className="progress-track"><span style={{ '--progress': `${importProgress * 100}%` } as CSSProperties} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

