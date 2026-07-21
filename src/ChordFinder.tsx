import { Chord } from '@tonaljs/tonal'
import { Music2, Play, Plus, RotateCcw, Search, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  QUALITY_FAMILIES,
  QUALITY_OPTIONS,
  ROOTS,
  parseChordSymbol,
  qualityDisplay,
  romanNumeral,
  type ChordFamily,
} from './music'
import { PianoKeyboard } from './PianoKeyboard'
import type { KeyMode } from './types'
import { KEY_MODE_OPTIONS } from './harmony'

interface ChordFinderProps {
  candidates: string[]
  keyMode: KeyMode
  keyRoot: string
  onAudition: (symbol: string) => void
  onChooseQuality: (root: string, quality: string) => void
  onClear: () => void
  onInsert: (symbol: string) => void
  onToggleNote: (note: string) => void
  selectedNotes: string[]
}

const INTERVAL_NAMES: Record<string, string> = {
  '1P': '根音',
  '2m': '降九度',
  '2M': '九度',
  '3m': '小三度',
  '3M': '大三度',
  '4P': '十一度',
  '4A': '升十一度',
  '5d': '降五度',
  '5P': '纯五度',
  '5A': '升五度',
  '6M': '十三度',
  '7d': '减七度',
  '7m': '小七度',
  '7M': '大七度',
}

function structureName(symbol: string, intervals: string[]) {
  const value = `${symbol} ${intervals.join(' ')}`
  if (/sus/i.test(value)) return '挂留和弦'
  if (/dim|°|5d/i.test(value)) return '减和弦体系'
  if (/aug|\\+|5A/i.test(value)) return '增和弦体系'
  if (/13|6M/.test(value)) return '十三和弦 / 延伸结构'
  if (/11|4P|4A/.test(value) && intervals.length > 4) return '十一和弦 / 延伸结构'
  if (/9|2M|2m/.test(value) && intervals.length > 4) return '九和弦 / 延伸结构'
  if (intervals.length >= 4) return '七和弦结构'
  if (intervals.length === 3) return '三和弦结构'
  return '开放或省略音结构'
}

export function ChordFinder({
  candidates,
  keyMode,
  keyRoot,
  onAudition,
  onChooseQuality,
  onClear,
  onInsert,
  onToggleNote,
  selectedNotes,
}: ChordFinderProps) {
  const [family, setFamily] = useState<'all' | ChordFamily>('all')
  const [browseRoot, setBrowseRoot] = useState('C')
  const [query, setQuery] = useState('')
  const primary = candidates[0]
  const analysis = useMemo(() => primary ? Chord.get(primary) : null, [primary])
  const parsed = primary ? parseChordSymbol(primary) : null
  const filtered = QUALITY_OPTIONS.filter((option) => {
    const familyMatch = family === 'all' || option.family === family
    const queryMatch = `${option.label} ${option.short} ${option.value}`
      .toLowerCase()
      .includes(query.toLowerCase())
    return familyMatch && queryMatch
  })

  return (
    <section className="finder-page">
      <div className="feature-page-header finder-heading">
        <div className="page-icon"><Search size={24} /></div>
        <div>
          <span className="eyebrow">Harmony laboratory</span>
          <h1>和弦寻找</h1>
          <p>按下任意琴键，Tonal 会按根音、转位与省略音实时给出候选并完成和声分析。</p>
        </div>
      </div>

      <article className="finder-piano-card">
        <div className="finder-live-header">
          <div>
            <span className="eyebrow">实时输入</span>
            <strong>{primary || (selectedNotes.length ? '正在解析…' : '点击下方琴键')}</strong>
            <small>{selectedNotes.join(' · ') || '尚未选择音符'}</small>
          </div>
          <button className="text-button subtle" disabled={!selectedNotes.length} onClick={onClear}>
            <RotateCcw size={15} />清除
          </button>
        </div>
        <PianoKeyboard selectedNotes={selectedNotes} onToggle={onToggleNote} />

        <div className="finder-candidates">
          {candidates.length ? candidates.map((symbol, index) => (
            <button
              className={index === 0 ? 'primary' : ''}
              key={symbol}
              onClick={() => onInsert(symbol)}
              title={`插入 ${symbol}`}
            >
              <span>{symbol}</span>
              <small>{index === 0 ? '最可能' : `候选 ${index + 1}`}</small>
              <Plus size={14} />
            </button>
          )) : (
            <div className="finder-placeholder"><Sparkles size={16} />选择至少两个不同音高以寻找和弦</div>
          )}
        </div>
      </article>

      {analysis && parsed && (
        <div className="harmony-analysis-grid">
          <article className="harmony-main-card">
            <div className="harmony-symbol">
              <div><span className="eyebrow">首选解析</span><h2>{primary}</h2></div>
              <button onClick={() => onAudition(primary)}><Play size={17} fill="currentColor" />试听</button>
            </div>
            <div className="analysis-note-row">
              {analysis.notes.map((note, index) => (
                <span key={`${note}-${index}`}>
                  <strong>{note}</strong>
                  <small>{INTERVAL_NAMES[analysis.intervals[index]] ?? analysis.intervals[index]}</small>
                </span>
              ))}
            </div>
          </article>
          <article className="harmony-facts-card">
            <div><span>结构分类</span><strong>{structureName(primary, analysis.intervals)}</strong></div>
            <div><span>和弦性质</span><strong>{analysis.quality || analysis.type || '复合结构'}</strong></div>
            <div><span>相对 {keyRoot} {KEY_MODE_OPTIONS.find((mode) => mode.value === keyMode)?.label}</span><strong>{romanNumeral(keyRoot, keyMode, parsed)}</strong></div>
            <div><span>音程公式</span><strong>{analysis.intervals.join(' · ')}</strong></div>
            <div><span>根音 / 低音</span><strong>{parsed.root} / {parsed.bass ?? analysis.notes[0]}</strong></div>
            <div><span>同义标记</span><strong>{analysis.aliases.slice(0, 5).join(' · ') || '—'}</strong></div>
          </article>
        </div>
      )}

      <article className="chord-catalog-card">
        <div className="catalog-heading">
          <div><span className="eyebrow">Tonal ChordType catalog</span><h2>完整和声结构分类</h2></div>
          <label className="search-field">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、别名或结构…" />
          </label>
        </div>
        <div className="catalog-root-row">
          {ROOTS.map((root) => (
            <button className={browseRoot === root ? 'selected' : ''} key={root} onClick={() => setBrowseRoot(root)}>{root}</button>
          ))}
        </div>
        <div className="quality-filters catalog-filters">
          {QUALITY_FAMILIES.map((item) => (
            <button className={family === item.value ? 'selected' : ''} key={item.value} onClick={() => setFamily(item.value)}>{item.label}</button>
          ))}
          <span>{filtered.length} 种结构</span>
        </div>
        <div className="catalog-grid">
          {filtered.map((option) => (
            <button key={option.value} onClick={() => onChooseQuality(browseRoot, option.value)}>
              <Music2 size={14} />
              <span><strong>{browseRoot}{qualityDisplay(option.value)}</strong><small>{option.label || option.short}</small></span>
              <Play size={12} />
            </button>
          ))}
        </div>
      </article>
    </section>
  )
}

