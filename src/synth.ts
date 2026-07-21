import { Midi, Note } from '@tonaljs/tonal'
import type { ChordAnnotation, ChordTrack } from './types'
import { chordNotes } from './music'

let toneModule: Promise<typeof import('tone')> | undefined
let stopTimer: number | undefined

function loadTone() {
  toneModule ??= import('tone')
  return toneModule
}

function gainToDecibels(value: number) {
  return 20 * Math.log10(Math.max(0.001, Math.min(1, value)))
}

async function createSynth(volume: number) {
  const Tone = await loadTone()
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: {
      attack: 0.015,
      decay: 0.16,
      sustain: 0.34,
      release: 0.7,
    },
  }).toDestination()
  synth.volume.value = gainToDecibels(volume)
  return synth
}

type SynthInstance = Awaited<ReturnType<typeof createSynth>>
const synths = new Map<string, SynthInstance>()

async function getSynth(id: string, volume: number) {
  let synth = synths.get(id)
  if (!synth) {
    synth = await createSynth(volume)
    synths.set(id, synth)
  }
  synth.volume.value = gainToDecibels(volume)
  return synth
}

export function pitchClassesToVoicing(pitchClasses: string[], octave = 4) {
  let previousMidi = Number.NEGATIVE_INFINITY
  return pitchClasses.map((pitchClass, index) => {
    let midi = Midi.toMidi(`${Note.pitchClass(pitchClass)}${octave + (index > 3 ? 1 : 0)}`) ?? 60
    while (midi <= previousMidi) midi += 12
    previousMidi = midi
    return Midi.midiToNoteName(midi, { sharps: true })
  })
}

export function annotationVoicing(chord: ChordAnnotation) {
  if (chord.voicing?.length) return chord.voicing
  const notes = chordNotes(chord)
  const voiced = pitchClassesToVoicing(notes)
  if (!chord.bass) return voiced
  const bassMidi = Midi.toMidi(`${Note.pitchClass(chord.bass)}3`)
  return bassMidi === null
    ? voiced
    : [Midi.midiToNoteName(bassMidi, { sharps: true }), ...voiced]
}

export function inversionVoicing(
  chord: Pick<ChordAnnotation, 'root' | 'quality'>,
  bass?: string,
) {
  const pitchClasses = chordNotes(chord)
  if (!bass || Note.chroma(bass) === Note.chroma(chord.root)) {
    return pitchClassesToVoicing(pitchClasses)
  }
  const inversionIndex = pitchClasses.findIndex((note) => Note.chroma(note) === Note.chroma(bass))
  if (inversionIndex < 0) {
    return [
      ...(pitchClassesToVoicing([bass], 3)),
      ...pitchClassesToVoicing(pitchClasses),
    ]
  }
  const rotated = [...pitchClasses.slice(inversionIndex), ...pitchClasses.slice(0, inversionIndex)]
  return pitchClassesToVoicing(rotated, 3)
}

export async function playNotes(
  notes: string[],
  duration = 0.7,
  volume = 0.75,
  channel = 'preview',
  velocity = 0.72,
) {
  if (!notes.length) return
  const Tone = await loadTone()
  await Tone.start()
  const synth = await getSynth(channel, volume)
  synth.triggerAttackRelease(notes, Math.max(0.06, duration), Tone.now() + 0.025, velocity)
}

export async function playChord(
  chord: ChordAnnotation,
  volume = 0.75,
  channel = 'preview',
) {
  await playNotes(
    annotationVoicing(chord),
    Math.min(2.4, Math.max(0.35, chord.duration)),
    volume,
    channel,
    chord.velocity ?? 0.72,
  )
}

export function stopChordPlayback() {
  window.clearTimeout(stopTimer)
  synths.forEach((synth) => synth.releaseAll())
}

export function setSynthChannelVolume(channel: string, volume: number) {
  synths.get(channel)?.volume.rampTo(gainToDecibels(volume), 0.04)
}

export async function playChordTimeline(
  chords: ChordAnnotation[],
  tracks: ChordTrack[],
  fromTime = 0,
  onEnded?: () => void,
  masterVolume = 1,
  untilTime = Number.POSITIVE_INFINITY,
) {
  stopChordPlayback()
  const Tone = await loadTone()
  await Tone.start()
  const hasSolo = tracks.some((track) => track.solo)
  const availableTracks = tracks.filter((track) => !track.muted && (!hasSolo || track.solo))
  const trackMap = new Map(availableTracks.map((track) => [track.id, track]))
  const fallbackTrack = tracks[0]
  const events = chords
    .filter((chord) => chord.start + chord.duration > fromTime)
    .filter((chord) => chord.start < untilTime)
    .filter((chord) => trackMap.has(chord.trackId ?? fallbackTrack?.id ?? ''))
  if (!events.length) {
    onEnded?.()
    return
  }

  const now = Tone.now() + 0.05
  const trackSynths = new Map(await Promise.all(availableTracks.map(async (track) => (
    [track.id, await getSynth(track.id, track.volume * masterVolume)] as const
  ))))
  let finalTime = 0
  events.forEach((chord) => {
    const track = trackMap.get(chord.trackId ?? fallbackTrack?.id ?? '')
    if (!track) return
    const offset = Math.max(0, chord.start - fromTime)
    const eventStart = Math.max(chord.start, fromTime)
    const elapsedDuration = Math.max(
      0.08,
      Math.min(
        chord.duration - Math.max(0, fromTime - chord.start),
        untilTime - eventStart,
      ),
    )
    const synth = trackSynths.get(track.id)
    if (!synth) return
    synth.triggerAttackRelease(
      annotationVoicing(chord),
      elapsedDuration,
      now + offset,
      chord.velocity ?? 0.7,
    )
    finalTime = Math.max(finalTime, offset + elapsedDuration)
  })

  stopTimer = window.setTimeout(() => onEnded?.(), (finalTime + 0.12) * 1000)
}

