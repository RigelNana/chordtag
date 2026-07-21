import { Note } from '@tonaljs/tonal'

const WHITE_NOTES = [
  'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5',
]

const BLACK_NOTES = [
  { note: 'C#3', afterWhite: 0 },
  { note: 'D#3', afterWhite: 1 },
  { note: 'F#3', afterWhite: 3 },
  { note: 'G#3', afterWhite: 4 },
  { note: 'A#3', afterWhite: 5 },
  { note: 'C#4', afterWhite: 7 },
  { note: 'D#4', afterWhite: 8 },
  { note: 'F#4', afterWhite: 10 },
  { note: 'G#4', afterWhite: 11 },
  { note: 'A#4', afterWhite: 12 },
]

interface PianoKeyboardProps {
  selectedNotes: string[]
  onToggle: (note: string) => void
  compact?: boolean
}

export function PianoKeyboard({
  selectedNotes,
  onToggle,
  compact = false,
}: PianoKeyboardProps) {
  const selected = new Set(selectedNotes)

  return (
    <div
      aria-label="和弦输入钢琴"
      className={`piano-keyboard ${compact ? 'compact' : ''}`}
      role="group"
    >
      <div className="piano-white-keys">
        {WHITE_NOTES.map((note) => (
          <button
            aria-label={note}
            aria-pressed={selected.has(note)}
            className={selected.has(note) ? 'selected' : ''}
            key={note}
            onPointerDown={(event) => {
              event.preventDefault()
              onToggle(note)
            }}
            type="button"
          >
            {(note.startsWith('C') || !compact) && <span>{Note.pitchClass(note)}<small>{Note.octave(note)}</small></span>}
          </button>
        ))}
      </div>
      {BLACK_NOTES.map(({ note, afterWhite }) => (
        <button
          aria-label={note}
          aria-pressed={selected.has(note)}
          className={`piano-black-key ${selected.has(note) ? 'selected' : ''}`}
          key={note}
          onPointerDown={(event) => {
            event.preventDefault()
            onToggle(note)
          }}
          style={{ left: `${((afterWhite + 1) / WHITE_NOTES.length) * 100}%` }}
          type="button"
        >
          {!compact && <span>{Note.pitchClass(note)}</span>}
        </button>
      ))}
    </div>
  )
}

