import {
  Activity,
  AudioLines,
  BadgeCheck,
  ChevronDown,
  CircleHelp,
  Download,
  FileAudio,
  Gauge,
  Grid2X2,
  Hand,
  Headphones,
  Keyboard,
  Layers3,
  MessageCircle,
  Minus,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Waves,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { analyseAudioFile } from './audio'
import {
  CHORD_COLORS,
  INITIAL_CHORDS,
  INITIAL_TEMPO,
  QUALITY_OPTIONS,
  ROOTS,
  buildGrid,
  chordName,
  chordNotes,
  createDemoAnalysis,
  formatTime,
  normalizeTempoMarkers,
  romanNumeral,
  snapTime,
} from './music'
import type {
  ChordAnnotation,
  ChordQuality,
  EditorTool,
  GridDivision,
  TempoMarker,
  WaveformMode,
} from './types'
import { WaveformCanvas } from './WaveformCanvas'

const MIN_ZOOM = 52
const MAX_ZOOM = 360
const FIRST_BEAT_OFFSET = 0.4

type HistoryState = {
  past: ChordAnnotation[][]
  future: ChordAnnotation[][]
}

interface ChordInspectorProps {
  chord?: ChordAnnotation
  keyRoot: string
  keyMode: 'major' | 'minor'
  onClose: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<ChordAnnotation>) => void
}

function ChordInspector({
  chord,
  keyRoot,
  keyMode,
  onClose,
  onDelete,
  onUpdate,
}: ChordInspectorProps) {
  const [query, setQuery] = useState('')
  const notes = chord ? chordNotes(chord) : []
  const numeral = chord ? romanNumeral(keyRoot, keyMode, chord) : '—'
  const filteredQualities = QUALITY_OPTIONS.filter((option) =>
    `${option.label} ${option.short} ${option.value}`.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="inspector-content">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">和弦检查器</span>
          <h2>{chord ? chordName(chord) : '选择一个和弦'}</h2>
        </div>
        <button className="icon-button mobile-only" aria-label="关闭检查器" onClick={onClose}>
          <X size={19} />
        </button>
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
              <strong>{numeral}</strong>
            </div>
            <div>
              <span>构成音</span>
              <strong>{notes.join(' · ') || '—'}</strong>
            </div>
          </div>

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
                  onClick={() => onUpdate({ root })}
                >
                  {root.replace('#', '♯')}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-label">
              <span>和弦性质</span>
              <small>{filteredQualities.length} 种</small>
            </div>
            <div className="quality-list">
              {filteredQualities.map((quality) => (
                <button
                  className={chord.quality === quality.value ? 'selected' : ''}
                  key={quality.value}
                  onClick={() => onUpdate({ quality: quality.value })}
                >
                  <span>{quality.value === 'maj' ? 'maj' : quality.value}</span>
                  <small>{quality.label}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section two-column-fields">
            <label>
              <span>低音（斜线和弦）</span>
              <select
                value={chord.bass ?? ''}
                onChange={(event) => onUpdate({ bass: event.target.value || undefined })}
              >
                <option value="">无</option>
                {ROOTS.map((root) => <option key={root} value={root}>{root}</option>)}
              </select>
            </label>
            <label>
              <span>置信度</span>
              <div className="confidence-field">
                <BadgeCheck size={15} />
                {Math.round((chord.confidence ?? 1) * 100)}%
              </div>
            </label>
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
  const [analysis, setAnalysis] = useState(createDemoAnalysis)
  const [waveformMode, setWaveformMode] = useState<WaveformMode>('waveform')
  const [chords, setChords] = useState<ChordAnnotation[]>(() => {
    const saved = localStorage.getItem('chordtag-annotations')
    if (!saved) return INITIAL_CHORDS
    try {
      return JSON.parse(saved) as ChordAnnotation[]
    } catch {
      return INITIAL_CHORDS
    }
  })
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] })
  const [selectedId, setSelectedId] = useState<string | undefined>('chord-3')
  const [tool, setTool] = useState<EditorTool>('select')
  const [pixelsPerSecond, setPixelsPerSecond] = useState(108)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(900)
  const [currentTime, setCurrentTime] = useState(4.468)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0.82)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [gridDivision, setGridDivision] = useState<GridDivision>(2)
  const [firstBeatOffset, setFirstBeatOffset] = useState(FIRST_BEAT_OFFSET)
  const [tempoMarkers, setTempoMarkers] = useState<TempoMarker[]>(INITIAL_TEMPO)
  const [keyRoot, setKeyRoot] = useState('C')
  const [keyMode, setKeyMode] = useState<'major' | 'minor'>('major')
  const [tempoOpen, setTempoOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const scrollerRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playbackAnchor = useRef({ startedAt: 0, from: 0 })
  const saveTimer = useRef<number | undefined>(undefined)

  const grid = useMemo(
    () => buildGrid(tempoMarkers, analysis.duration, gridDivision),
    [analysis.duration, gridDivision, tempoMarkers],
  )
  const selectedChord = chords.find((chord) => chord.id === selectedId)
  const activeTempo = [...tempoMarkers].reverse().find((marker) => marker.startTime <= currentTime)
    ?? tempoMarkers[0]
  const visibleStart = scrollLeft / pixelsPerSecond
  const visibleEnd = (scrollLeft + viewportWidth) / pixelsPerSecond
  const visibleGrid = grid.filter(
    (marker) => marker.time >= visibleStart - 0.5 && marker.time <= visibleEnd + 0.5,
  )
  const timelineWidth = Math.max(viewportWidth, analysis.duration * pixelsPerSecond)

  const commitAnnotations = useCallback((next: ChordAnnotation[]) => {
    setHistory((current) => ({
      past: [...current.past.slice(-39), chords],
      future: [],
    }))
    setChords(next)
  }, [chords])

  const updateSelected = useCallback((patch: Partial<ChordAnnotation>) => {
    if (!selectedId) return
    commitAnnotations(chords.map((chord) =>
      chord.id === selectedId ? { ...chord, ...patch } : chord,
    ))
  }, [chords, commitAnnotations, selectedId])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    commitAnnotations(chords.filter((chord) => chord.id !== selectedId))
    setSelectedId(undefined)
  }, [chords, commitAnnotations, selectedId])

  const addChordAt = useCallback((time: number) => {
    const marker = [...grid].reverse().find((item) => item.time <= time) ?? grid[0]
    const beatSeconds = marker ? (60 / marker.bpm) * (4 / Number(marker.meter.split('/')[1])) : 0.5
    const meterBeats = marker ? Number(marker.meter.split('/')[0]) : 4
    const start = snapTime(time, grid, analysis.duration)
    const duration = Math.max(0.12, Math.min(beatSeconds * meterBeats, analysis.duration - start))
    const chord: ChordAnnotation = {
      id: `chord-${crypto.randomUUID()}`,
      start,
      duration,
      root: keyRoot,
      quality: keyMode === 'minor' ? 'min' : 'maj',
      color: CHORD_COLORS[chords.length % CHORD_COLORS.length],
      confidence: 1,
    }
    commitAnnotations([...chords, chord].sort((a, b) => a.start - b.start))
    setSelectedId(chord.id)
    setInspectorOpen(true)
  }, [analysis.duration, chords, commitAnnotations, grid, keyMode, keyRoot])

  const undo = useCallback(() => {
    const previous = history.past.at(-1)
    if (!previous) return
    setHistory({
      past: history.past.slice(0, -1),
      future: [chords, ...history.future.slice(0, 39)],
    })
    setChords(previous)
  }, [chords, history])

  const redo = useCallback(() => {
    const next = history.future[0]
    if (!next) return
    setHistory({
      past: [...history.past, chords],
      future: history.future.slice(1),
    })
    setChords(next)
  }, [chords, history])

  const seek = useCallback((time: number) => {
    const bounded = Math.max(0, Math.min(analysis.duration, time))
    setCurrentTime(bounded)
    if (audioRef.current) audioRef.current.currentTime = bounded
    playbackAnchor.current = { startedAt: performance.now(), from: bounded }
  }, [analysis.duration])

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false)
      return
    }
    const start = currentTime >= analysis.duration - 0.02 ? 0 : currentTime
    seek(start)
    playbackAnchor.current = { startedAt: performance.now(), from: start }
    if (analysis.url && audioRef.current) {
      audioRef.current.playbackRate = playbackRate
      void audioRef.current.play()
    }
    setIsPlaying(true)
  }, [analysis.duration, analysis.url, currentTime, isPlaying, playbackRate, seek])

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      const next = analysis.url && audioRef.current
        ? audioRef.current.currentTime
        : playbackAnchor.current.from
          + ((performance.now() - playbackAnchor.current.startedAt) / 1000) * playbackRate
      if (next >= analysis.duration) {
        setCurrentTime(analysis.duration)
        setIsPlaying(false)
        return
      }
      setCurrentTime(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [analysis.duration, analysis.url, isPlaying, playbackRate])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.playbackRate = playbackRate
  }, [playbackRate, volume])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width))
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setSaveState('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem('chordtag-annotations', JSON.stringify(chords))
      setSaveState('saved')
    }, 450)
    return () => window.clearTimeout(saveTimer.current)
  }, [chords])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addChordAt, currentTime, deleteSelected, redo, togglePlayback, undo])

  const setZoom = (nextZoom: number, anchorX = viewportWidth / 2) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
    const anchorTime = (scrollLeft + anchorX) / pixelsPerSecond
    setPixelsPerSecond(next)
    requestAnimationFrame(() => {
      if (scrollerRef.current) {
        scrollerRef.current.scrollLeft = Math.max(0, anchorTime * next - anchorX)
      }
    })
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const anchor = event.clientX - bounds.left
    setZoom(pixelsPerSecond * (event.deltaY > 0 ? 0.9 : 1.1), anchor)
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

  const beginChordDrag = (
    event: ReactPointerEvent,
    chord: ChordAnnotation,
    mode: 'move' | 'start' | 'end',
  ) => {
    if (tool !== 'select') return
    event.stopPropagation()
    event.preventDefault()
    setSelectedId(chord.id)
    const pointerStart = event.clientX
    const original = chords
    const minDuration = grid.length > 1 ? Math.max(0.08, grid[1].time - grid[0].time) : 0.12
    let changed = false

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - pointerStart) / pixelsPerSecond
      changed = changed || Math.abs(delta) > 0.005
      setChords((current) => current.map((item) => {
        if (item.id !== chord.id) return item
        if (mode === 'move') {
          const start = snapTime(chord.start + delta, grid, analysis.duration)
          return { ...item, start: Math.min(analysis.duration - chord.duration, start) }
        }
        if (mode === 'start') {
          const end = chord.start + chord.duration
          const start = Math.min(end - minDuration, snapTime(chord.start + delta, grid, analysis.duration))
          return { ...item, start, duration: end - start }
        }
        const end = Math.max(
          chord.start + minDuration,
          snapTime(chord.start + chord.duration + delta, grid, analysis.duration),
        )
        return { ...item, duration: Math.min(analysis.duration, end) - chord.start }
      }))
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

  const splitChord = (chord: ChordAnnotation, time: number) => {
    if (time <= chord.start + 0.08 || time >= chord.start + chord.duration - 0.08) return
    const splitAt = snapTime(time, grid, analysis.duration)
    const right: ChordAnnotation = {
      ...chord,
      id: `chord-${crypto.randomUUID()}`,
      start: splitAt,
      duration: chord.start + chord.duration - splitAt,
    }
    commitAnnotations(chords.flatMap((item) =>
      item.id === chord.id
        ? [{ ...item, duration: splitAt - item.start }, right]
        : [item],
    ))
    setSelectedId(right.id)
    setTool('select')
  }

  const updateTempo = (patch: Partial<TempoMarker>) => {
    setTempoMarkers((current) => normalizeTempoMarkers(
      current.map((marker) => marker.id === activeTempo.id ? { ...marker, ...patch } : marker),
      firstBeatOffset,
    ))
  }

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

  const handleAudioImport = async (file?: File) => {
    if (!file) return
    setImportProgress(0)
    try {
      const next = await analyseAudioFile(file, setImportProgress)
      if (analysis.url) URL.revokeObjectURL(analysis.url)
      setAnalysis(next)
      setCurrentTime(0)
      setScrollLeft(0)
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
      musicalContext: { tonic: keyRoot, mode: keyMode },
      timeline: {
        firstBeatOffset,
        tempoMap: tempoMarkers.map(({ id: _id, ...marker }) => marker),
      },
      annotations: chords.map((chord) => ({
        id: chord.id,
        start: Number(chord.start.toFixed(6)),
        end: Number((chord.start + chord.duration).toFixed(6)),
        symbol: chordName(chord),
        root: chord.root,
        quality: chord.quality,
        bass: chord.bass ?? null,
        romanNumeral: romanNumeral(keyRoot, keyMode, chord),
        confidence: chord.confidence ?? 1,
      })),
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
          <span className="standard-badge">STANDARD 1.0</span>
        </div>
        <div className="project-heading">
          <span>{analysis.name.replace(/\.[^/.]+$/, '')}</span>
          <span className={`save-state ${saveState}`}><Save size={13} />{saveState === 'saved' ? '已保存到本机' : '保存中'}</span>
        </div>
        <div className="header-actions">
          <button className="text-button subtle"><CircleHelp size={17} /><span>帮助</span></button>
          <button className="filled-button" onClick={exportAnnotations}>
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
          <button><FileAudio size={21} /><span>音频</span></button>
          <button><Layers3 size={21} /><span>结构</span></button>
          <button className="active"><Music2 size={21} /><span>和弦</span></button>
          <button><MessageCircle size={21} /><span>备注</span></button>
        </div>
        <button className="rail-bottom"><Settings2 size={21} /><span>设置</span></button>
      </aside>

      <main className="workspace">
        <div className="workspace-toolbar">
          <div className="tool-cluster">
            <ToolButton active={tool === 'select'} label="选择工具 (V)" onClick={() => setTool('select')}>
              <MousePointer2 size={18} />
            </ToolButton>
            <ToolButton active={tool === 'pan'} label="平移工具 (H)" onClick={() => setTool('pan')}>
              <Hand size={18} />
            </ToolButton>
            <ToolButton active={tool === 'split'} label="切分工具 (S)" onClick={() => setTool('split')}>
              <Scissors size={18} />
            </ToolButton>
            <span className="toolbar-divider" />
            <ToolButton label="撤销" onClick={undo}><Undo2 size={18} /></ToolButton>
            <ToolButton label="重做" onClick={redo}><Redo2 size={18} /></ToolButton>
          </div>

          <div className="context-controls">
            <label className="key-control">
              <span>调性</span>
              <select value={keyRoot} onChange={(event) => setKeyRoot(event.target.value)}>
                {ROOTS.map((root) => <option key={root}>{root}</option>)}
              </select>
              <select value={keyMode} onChange={(event) => setKeyMode(event.target.value as 'major' | 'minor')}>
                <option value="major">大调</option>
                <option value="minor">小调</option>
              </select>
            </label>
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
                        <label><span>拍值</span><select value={activeTempo.denominator} onChange={(event) => updateTempo({ denominator: Number(event.target.value) })}><option>2</option><option>4</option><option>8</option><option>16</option></select></label>
                        <label><span>首拍起点 (秒)</span><input type="number" min="0" step="0.01" value={firstBeatOffset} onChange={(event) => { const value = Number(event.target.value); setFirstBeatOffset(value); setTempoMarkers((current) => normalizeTempoMarkers(current, value)) }} /></label>
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
              <label className="setting-chip grid-chip">
                <Grid2X2 size={16} />
                网格
                <select value={gridDivision} onChange={(event) => setGridDivision(Number(event.target.value) as GridDivision)}>
                  <option value="1">1/4</option>
                  <option value="2">1/8</option>
                  <option value="4">1/16</option>
                  <option value="8">1/32</option>
                </select>
              </label>
              <div className="zoom-control">
                <button aria-label="缩小时间轴" onClick={() => setZoom(pixelsPerSecond * 0.82)}><ZoomOut size={16} /></button>
                <input
                  aria-label="时间轴缩放"
                  max={MAX_ZOOM}
                  min={MIN_ZOOM}
                  type="range"
                  value={pixelsPerSecond}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <button aria-label="放大时间轴" onClick={() => setZoom(pixelsPerSecond * 1.22)}><ZoomIn size={16} /></button>
              </div>
            </div>
          </div>

          <div
            className={`timeline-scroll ${tool === 'pan' ? 'pan-mode' : ''}`}
            onPointerDown={beginPan}
            onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
            onWheel={onWheel}
            ref={scrollerRef}
          >
            <div className="timeline-surface" style={{ width: timelineWidth }}>
              <div className="ruler-row">
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

              <div className="waveform-row">
                <div className="waveform-sticky" style={{ width: viewportWidth }}>
                  <WaveformCanvas
                    analysis={analysis}
                    mode={waveformMode}
                    onSeek={seek}
                    pixelsPerSecond={pixelsPerSecond}
                    playhead={currentTime}
                    scrollLeft={scrollLeft}
                  />
                </div>
                {waveformMode === 'spectrogram' && (
                  <div className="frequency-labels">
                    <span>12k</span><span>1k</span><span>100</span>
                  </div>
                )}
              </div>

              <div className="chord-lane" onDoubleClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                addChordAt((event.clientX - bounds.left) / pixelsPerSecond)
              }}>
                <div className="lane-title">
                  <Music2 size={15} />
                  <span>和弦</span>
                  <small>{chords.length}</small>
                </div>
                {chords.map((chord) => {
                  const numeral = romanNumeral(keyRoot, keyMode, chord)
                  return (
                    <motion.button
                      animate={{ opacity: 1, scale: 1 }}
                      className={`chord-block ${chord.color} ${selectedId === chord.id ? 'selected' : ''}`}
                      initial={{ opacity: 0, scale: 0.96 }}
                      key={chord.id}
                      layout
                      onClick={(event) => {
                        event.stopPropagation()
                        if (tool === 'split') {
                          const bounds = event.currentTarget.getBoundingClientRect()
                          splitChord(chord, chord.start + (event.clientX - bounds.left) / pixelsPerSecond)
                        } else {
                          setSelectedId(chord.id)
                          setInspectorOpen(true)
                        }
                      }}
                      onPointerDown={(event) => beginChordDrag(event, chord, 'move')}
                      style={{
                        left: chord.start * pixelsPerSecond,
                        width: Math.max(18, chord.duration * pixelsPerSecond - 3),
                      }}
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
                    </motion.button>
                  )
                })}
                <button className="quick-add" onClick={() => addChordAt(currentTime)} style={{ left: currentTime * pixelsPerSecond + 8 }}>
                  <Plus size={14} />和弦
                </button>
              </div>

              <div className="timeline-grid" aria-hidden>
                {visibleGrid.map((marker) => (
                  <span
                    className={marker.isBar ? 'bar' : Number.isInteger(marker.beat) ? 'beat' : 'subdivision'}
                    key={`${marker.bar}-${marker.beat}-${marker.time}`}
                    style={{ left: marker.time * pixelsPerSecond }}
                  />
                ))}
              </div>
              <div className="global-playhead" style={{ left: currentTime * pixelsPerSecond }}>
                <span />
              </div>
            </div>
          </div>

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
            <div className="transport-center">
              <Sparkles size={15} />
              <span>双击轨道添加 · 拖动边缘调整时长 · Ctrl + 滚轮缩放</span>
            </div>
            <div className="transport-right">
              <button className="rate-button" onClick={() => setPlaybackRate((rate) => rate === 1 ? 0.75 : rate === 0.75 ? 1.25 : 1)}>
                {playbackRate}×
              </button>
              <Volume2 size={17} />
              <input aria-label="音量" max="1" min="0" step="0.01" type="range" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
            </div>
          </div>
        </section>

        <div className="project-footer">
          <div><Headphones size={16} /><span>{analysis.name}</span><small>{formatTime(analysis.duration)}</small></div>
          <div><SlidersHorizontal size={15} /><span>48 kHz · 24 bit · Stereo</span></div>
          <button onClick={() => fileInputRef.current?.click()}><Upload size={15} />替换音频</button>
        </div>
      </main>

      <aside className="inspector-panel">
        <ChordInspector chord={selectedChord} keyMode={keyMode} keyRoot={keyRoot} onClose={() => setInspectorOpen(false)} onDelete={deleteSelected} onUpdate={updateSelected} />
      </aside>

      <AnimatePresence>
        {inspectorOpen && (
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
              <ChordInspector chord={selectedChord} keyMode={keyMode} keyRoot={keyRoot} onClose={() => setInspectorOpen(false)} onDelete={deleteSelected} onUpdate={updateSelected} />
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
      {analysis.url && <audio onEnded={() => setIsPlaying(false)} ref={audioRef} src={analysis.url} />}

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

