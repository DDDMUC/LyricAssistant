export interface MidiNote {
  midi: number
  start: number
  dur: number
  channel: number
}

export interface MidiTextEvent {
  tick: number
  text: string
}

export interface MidiRawEvent {
  tick: number
  raw: number[]
}

export interface MidiTrack {
  name: string
  notes: MidiNote[]
  markers: MidiTextEvent[]
  lyrics: MidiTextEvent[]
  events: MidiRawEvent[]
}

export interface MidiFile {
  format: number
  division: number
  tracks: MidiTrack[]
}

export interface MidiLine {
  pattern: number[]
  cells: string[]
}

export interface MidiSection {
  name: string
  lines: MidiLine[]
}

export interface MidiImportOptions {
  trackIndex?: number
  sentenceRestBeats?: number
  useMarkers?: boolean
  /** auto：轨里有 C0/C#0/D0 就按标记切，否则按休止；rest：强制休止 + Marker；keyswitch：强制标记 */
  mode?: "auto" | "rest" | "keyswitch"
}

export interface MidiExportOptions {
  /** 这些音高不算「要唱歌的音」，歌词跳过它们（词格酱的 C0/C#0/D0 标记音） */
  skipPitches?: number[]
  /** 导出时把标记音整个去掉（等于词格酱的「导出纯净 MIDI」） */
  stripMarkers?: boolean
}

/** 词格酱约定的三个切分标记音高（绝对编号；按 Middle C=C3 的 DAW 显示为 C0/C#0/D0） */
export const KEYSWITCH = { group: 24, sentence: 25, section: 26 } as const

const KEYSWITCH_PITCHES = new Set<number>([KEYSWITCH.group, KEYSWITCH.sentence, KEYSWITCH.section])

/** 这条轨里有几个切分标记音（不含鼓轨） */
export function keyswitchCount(file: MidiFile, trackIndex: number): number {
  const track = file.tracks[trackIndex]
  if (!track) return 0
  return track.notes.filter(
    (note) => note.channel !== 9 && KEYSWITCH_PITCHES.has(note.midi),
  ).length
}

class Reader {
  pos = 0
  constructor(private bytes: Uint8Array) {}

  u8(): number {
    return this.bytes[this.pos++] ?? 0
  }

  u16(): number {
    return (this.u8() << 8) | this.u8()
  }

  u32(): number {
    return (this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()
  }

  vlq(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const byte = this.u8()
      value = (value << 7) | (byte & 0x7f)
      if (!(byte & 0x80)) break
    }
    return value
  }

  take(length: number): Uint8Array {
    const slice = this.bytes.subarray(this.pos, this.pos + length)
    this.pos += length
    return slice
  }

  ascii(length: number): string {
    let value = ""
    for (let i = 0; i < length; i++) value += String.fromCharCode(this.u8())
    return value
  }
}

function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(data)
  if (!utf8.includes("\uFFFD")) return utf8
  try {
    return new TextDecoder("gbk").decode(data)
  } catch {
    let value = ""
    for (const byte of data) value += String.fromCharCode(byte)
    return value
  }
}

function parseTrack(reader: Reader, end: number): MidiTrack {
  const track: MidiTrack = { name: "", notes: [], markers: [], lyrics: [], events: [] }
  const open = new Map<number, { midi: number; start: number }>()
  let tick = 0
  let running = 0
  while (reader.pos < end) {
    tick += reader.vlq()
    let status = reader.u8()
    if (status < 0x80) {
      reader.pos -= 1
      status = running
    } else if (status < 0xf0) {
      running = status
    }
    if (status === 0xff) {
      const type = reader.u8()
      const length = reader.vlq()
      const data = reader.take(length)
      track.events.push({ tick, raw: [0xff, type, ...vlqBytes(length), ...data] })
      if (type === 0x03) track.name = decodeText(data)
      else if (type === 0x06) track.markers.push({ tick, text: decodeText(data) })
      else if (type === 0x05) track.lyrics.push({ tick, text: decodeText(data) })
      continue
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = reader.vlq()
      const data = reader.take(length)
      track.events.push({ tick, raw: [status, ...vlqBytes(length), ...data] })
      continue
    }
    const channel = status & 0x0f
    const kind = status & 0xf0
    const data1 = reader.u8()
    const data2 = kind === 0xc0 || kind === 0xd0 ? 0 : reader.u8()
    track.events.push({
      tick,
      raw: kind === 0xc0 || kind === 0xd0 ? [status, data1] : [status, data1, data2],
    })
    if (kind === 0x90 && data2 > 0) {
      open.set(channel * 128 + data1, { midi: data1, start: tick })
    } else if (kind === 0x80 || (kind === 0x90 && data2 === 0)) {
      const key = channel * 128 + data1
      const note = open.get(key)
      if (note) {
        track.notes.push({
          midi: note.midi,
          start: note.start,
          dur: Math.max(1, tick - note.start),
          channel,
        })
        open.delete(key)
      }
    }
  }
  for (const note of open.values()) {
    track.notes.push({ midi: note.midi, start: note.start, dur: 1, channel: 0 })
  }
  track.notes.sort((a, b) => a.start - b.start || a.midi - b.midi)
  return track
}

export function parseMidi(bytes: Uint8Array): MidiFile {
  const reader = new Reader(bytes)
  if (reader.ascii(4) !== "MThd") throw new Error("不是 MIDI 文件（缺少 MThd 头）")
  const headerLength = reader.u32()
  const format = reader.u16()
  reader.u16()
  const division = reader.u16()
  if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间格式的 MIDI")
  reader.pos = 8 + headerLength
  const tracks: MidiTrack[] = []
  while (reader.pos + 8 <= bytes.length) {
    const id = reader.ascii(4)
    const length = reader.u32()
    const end = reader.pos + length
    if (id === "MTrk") tracks.push(parseTrack(reader, end))
    reader.pos = end
  }
  return { format, division, tracks }
}

const MELODY_NAME_RE = /vocal|melody|lead|唱|人声|主旋/i

export function noteTracks(file: MidiFile): { index: number; name: string; count: number }[] {
  return file.tracks
    .map((track, index) => ({
      index,
      name: track.name || `轨 ${index + 1}`,
      count: track.notes.filter((note) => note.channel !== 9).length,
    }))
    .filter((track) => track.count > 0)
}

export function pickMelodyTrack(file: MidiFile): number {
  const candidates = noteTracks(file)
  if (candidates.length === 0) return -1
  const named = candidates.find((track) => MELODY_NAME_RE.test(track.name))
  if (named) return named.index
  return candidates.reduce((best, track) => (track.count > best.count ? track : best)).index
}

function splitNotes(notes: MidiNote[], sentenceTicks: number): number[][] {
  const lines: number[][] = []
  let pattern: number[] = []
  let group = 0
  let prevEnd = -Infinity
  let started = false
  const flushGroup = () => {
    if (group > 0) {
      pattern.push(group)
      group = 0
    }
  }
  const flushLine = () => {
    flushGroup()
    if (pattern.length > 0) {
      lines.push(pattern)
      pattern = []
    }
  }
  for (const note of notes) {
    if (started) {
      const gap = note.start - prevEnd
      if (sentenceTicks > 0 && gap >= sentenceTicks) flushLine()
      else if (gap > 0) flushGroup()
    }
    group += 1
    const end = note.start + note.dur
    if (end > prevEnd) prevEnd = end
    started = true
  }
  flushLine()
  return lines
}

/** 按词格酱的 C0/C#0/D0 切分（空组/空句/空段不生成） */
function keyswitchDraft(notes: MidiNote[]): { name: string; lines: number[][] }[] {
  const sections: { name: string; lines: number[][] }[] = []
  let section: { name: string; lines: number[][] } = { name: "", lines: [] }
  let line: number[] = []
  let group = 0
  const flushGroup = () => {
    if (group > 0) {
      line.push(group)
      group = 0
    }
  }
  const flushLine = () => {
    flushGroup()
    if (line.length > 0) {
      section.lines.push(line)
      line = []
    }
  }
  const flushSection = () => {
    flushLine()
    if (section.lines.length > 0) sections.push(section)
    section = { name: "", lines: [] }
  }
  for (const note of notes) {
    if (note.midi === KEYSWITCH.section) {
      flushSection()
      continue
    }
    if (note.midi === KEYSWITCH.sentence) {
      flushLine()
      continue
    }
    if (note.midi === KEYSWITCH.group) {
      flushGroup()
      continue
    }
    group += 1
  }
  flushSection()
  return sections
}

function restDraft(
  notes: MidiNote[],
  markers: MidiTextEvent[],
  sentenceTicks: number,
): { name: string; lines: number[][] }[] {
  const segments: { name: string; notes: MidiNote[] }[] = []
  if (markers.length > 0) {
    const before = notes.filter((note) => note.start < markers[0].tick)
    if (before.length > 0) segments.push({ name: "", notes: before })
    markers.forEach((marker, index) => {
      const next = markers[index + 1]
      const segment = notes.filter(
        (note) => note.start >= marker.tick && (!next || note.start < next.tick),
      )
      if (segment.length > 0) segments.push({ name: marker.text, notes: segment })
    })
  } else {
    segments.push({ name: "", notes })
  }
  return segments.map((segment) => ({
    name: segment.name,
    lines: splitNotes(segment.notes, sentenceTicks),
  }))
}

export function midiToSections(file: MidiFile, options: MidiImportOptions = {}): MidiSection[] {
  const trackIndex = options.trackIndex ?? pickMelodyTrack(file)
  const track = file.tracks[trackIndex]
  if (!track) return []
  const beat = file.division > 0 ? file.division : 480
  const sentenceTicks = (options.sentenceRestBeats ?? 1) * beat
  const notes = track.notes
    .filter((note) => note.channel !== 9)
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
  if (notes.length === 0) return []

  const mode = options.mode ?? "auto"
  const hasKeyswitch = notes.some((note) => KEYSWITCH_PITCHES.has(note.midi))
  const useKeyswitch = mode === "keyswitch" || (mode === "auto" && hasKeyswitch)

  const draft = useKeyswitch
    ? keyswitchDraft(notes)
    : restDraft(
        notes,
        options.useMarkers === false
          ? []
          : file.tracks
              .flatMap((item) => item.markers)
              .sort((a, b) => a.tick - b.tick)
              .filter(
                (marker, index, all) => index === 0 || marker.tick !== all[index - 1].tick,
              ),
        sentenceTicks,
      )

  const charQueue: string[] = []
  for (const event of track.lyrics.slice().sort((a, b) => a.tick - b.tick)) {
    for (const char of event.text) {
      if (char.trim() !== "") charQueue.push(char)
    }
  }
  let cursor = 0

  return draft
    .map((section) => ({
      name: section.name,
      lines: section.lines.map((pattern) => {
        const total = pattern.reduce((sum, size) => sum + size, 0)
        const cells: string[] = []
        for (let i = 0; i < total; i++) {
          cells.push(cursor < charQueue.length ? charQueue[cursor++] : "")
        }
        return { pattern, cells }
      }),
    }))
    .filter((section) => section.lines.length > 0)
}

function vlqBytes(value: number): number[] {
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

function serializeTrack(events: MidiRawEvent[]): number[] {
  const out: number[] = []
  let prev = 0
  for (const event of events) {
    out.push(...vlqBytes(Math.max(0, event.tick - prev)), ...event.raw)
    prev = event.tick
  }
  const last = events[events.length - 1]
  if (!last || last.raw[0] !== 0xff || last.raw[1] !== 0x2f) {
    out.push(0x00, 0xff, 0x2f, 0x00)
  }
  return out
}

function buildFile(format: number, division: number, trackDatas: number[][]): Uint8Array {
  const out: number[] = []
  for (const char of "MThd") out.push(char.charCodeAt(0))
  out.push(0, 0, 0, 6)
  out.push((format >> 8) & 255, format & 255)
  out.push((trackDatas.length >> 8) & 255, trackDatas.length & 255)
  out.push((division >> 8) & 255, division & 255)
  for (const data of trackDatas) {
    for (const char of "MTrk") out.push(char.charCodeAt(0))
    out.push(
      (data.length >>> 24) & 255,
      (data.length >>> 16) & 255,
      (data.length >>> 8) & 255,
      data.length & 255,
    )
    out.push(...data)
  }
  return new Uint8Array(out)
}

export function buildLyricMidi(
  file: MidiFile,
  trackIndex: number,
  lyrics: string[],
  options: MidiExportOptions = {},
): Uint8Array {
  const encoder = new TextEncoder()
  const skip = new Set(options.skipPitches ?? [])
  const isMarkerNote = (event: MidiRawEvent): boolean => {
    const kind = event.raw[0] & 0xf0
    if (kind !== 0x80 && kind !== 0x90) return false
    if ((event.raw[0] & 0x0f) === 9) return false
    return skip.has(event.raw[1] ?? -1)
  }
  const trackDatas = file.tracks.map((track, index) => {
    if (index !== trackIndex) return serializeTrack(track.events)
    const noteOns = track.events
      .map((event, eventIndex) => ({ event, eventIndex }))
      .filter(
        ({ event }) =>
          (event.raw[0] & 0xf0) === 0x90 &&
          (event.raw[2] ?? 0) > 0 &&
          (event.raw[0] & 0x0f) !== 9 &&
          !isMarkerNote(event),
      )
      .sort(
        (a, b) => a.event.tick - b.event.tick || a.event.raw[1] - b.event.raw[1],
      )
    const lyricBefore = new Map<number, number[]>()
    noteOns.forEach(({ eventIndex }, noteIndex) => {
      const text = encoder.encode(lyrics[noteIndex] ?? "")
      lyricBefore.set(eventIndex, [0xff, 0x05, ...vlqBytes(text.length), ...text])
    })
    const events: MidiRawEvent[] = []
    track.events.forEach((event, eventIndex) => {
      if (options.stripMarkers && skip.size > 0 && isMarkerNote(event)) return
      if (event.raw[0] === 0xff && event.raw[1] === 0x05) return
      const lyric = lyricBefore.get(eventIndex)
      if (lyric) events.push({ tick: event.tick, raw: lyric })
      events.push(event)
    })
    return serializeTrack(events)
  })
  return buildFile(file.format, file.division, trackDatas)
}
