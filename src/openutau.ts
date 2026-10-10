import { parseDocument } from "yaml"
import type { Document } from "yaml"

/**
 * OpenUtau 的「文件级」桥（.ustx 工程文件）：
 * OpenUtau 没有 SV2 那种常驻脚本 + 文件信箱，所以只能读/写它的工程文件——
 * 等价于 SV 弹窗里的「预演 / 按序填词 / 读回」三个按钮（不含实时同步）。
 *
 * .ustx 是 YAML（官方文档 USTX File Format）：voice_parts[].notes[] 里每个音符有
 * position / duration / tone / lyric；绝对时间 = part.position + note.position。
 * 排序规则和 SV 那套一致：时间不重叠的轨合并循序读；重叠的轨聚成一簇，
 * 字数多的当主歌、其余当和声，和声音符插在「重叠最多的主音符」后面。
 */

export interface OuNote {
  onset: number
  end: number
  track: number
  lyric: string
  /** 该音符在文档里的路径（setIn 用） */
  path: (string | number)[]
}

/** 不算「字位」的歌词：-（延音）、br（换气）、R（休止） */
const SKIP_LYRICS = new Set(["-", "br", "R"])

interface RawNote {
  position?: unknown
  duration?: unknown
  lyric?: unknown
}
interface RawPart {
  track_no?: unknown
  position?: unknown
  notes?: unknown
}

export interface OuParsed {
  doc: Document
  notes: OuNote[]
}

/** 解析 .ustx：取出所有「字位」音符（跳过静音轨、延音/换气/休止） */
export function parseUstx(text: string): OuParsed {
  const doc = parseDocument(text)
  if (doc.errors.length > 0) {
    throw new Error(`不是有效的 USTX 工程（YAML 解析失败）：${doc.errors[0].message}`)
  }
  const data = doc.toJS() as { tracks?: unknown; voice_parts?: unknown }
  const tracks = Array.isArray(data.tracks) ? (data.tracks as { mute?: unknown }[]) : []
  const parts = Array.isArray(data.voice_parts) ? (data.voice_parts as RawPart[]) : []
  const notes: OuNote[] = []
  parts.forEach((part, p) => {
    const track = typeof part.track_no === "number" ? part.track_no : 0
    if (tracks[track]?.mute === true) return
    const partPosition = typeof part.position === "number" ? part.position : 0
    const list = Array.isArray(part.notes) ? (part.notes as RawNote[]) : []
    list.forEach((note, n) => {
      const pos = typeof note.position === "number" ? note.position : 0
      const dur = typeof note.duration === "number" ? note.duration : 0
      const lyric = note.lyric === undefined || note.lyric === null ? "" : String(note.lyric)
      if (SKIP_LYRICS.has(lyric.trim())) return
      const onset = partPosition + pos
      notes.push({
        onset,
        end: onset + dur,
        track,
        lyric,
        path: ["voice_parts", p, "notes", n],
      })
    })
  })
  return { doc, notes }
}

function tracksOverlap(a: OuNote[], b: OuNote[]): boolean {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a[i]
    const y = b[j]
    if (x.onset < y.end && y.onset < x.end) return true
    if (x.end <= y.onset) i += 1
    else j += 1
  }
  return false
}

/** 排序（照「导入 MIDI」那套）：返回读字的顺序 + 有没有检测到时间重叠 */
export function orderOuNotes(notes: OuNote[]): { order: OuNote[]; overlap: boolean } {
  const byTrack = new Map<number, OuNote[]>()
  for (const note of notes) {
    const list = byTrack.get(note.track)
    if (list) list.push(note)
    else byTrack.set(note.track, [note])
  }
  const tracks = [...byTrack.values()].map((list) => list.slice().sort((a, b) => a.onset - b.onset))
  const count = tracks.length
  if (count === 0) return { order: [], overlap: false }

  const parent = Array.from({ length: count }, (_, i) => i)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]]
      root = parent[root]
    }
    return root
  }
  let overlap = false
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (tracksOverlap(tracks[i], tracks[j])) {
        overlap = true
        parent[find(i)] = find(j)
      }
    }
  }
  const clusters = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    const root = find(i)
    const members = clusters.get(root)
    if (members) members.push(i)
    else clusters.set(root, [i])
  }
  const mains: number[] = []
  const harmonies: number[] = []
  for (const members of clusters.values()) {
    members.sort((a, b) => tracks[b].length - tracks[a].length || a - b)
    members.forEach((mi, rank) => {
      if (rank === 0) mains.push(mi)
      else harmonies.push(mi)
    })
  }
  const order: OuNote[] = []
  for (const mi of mains) order.push(...tracks[mi])
  order.sort((a, b) => a.onset - b.onset)
  for (const mi of harmonies) {
    for (const hn of tracks[mi]) {
      let best = -1
      let bestOverlap = 0
      order.forEach((mn, idx) => {
        const ov = Math.min(mn.end, hn.end) - Math.max(mn.onset, hn.onset)
        if (ov > bestOverlap) {
          bestOverlap = ov
          best = idx
        }
      })
      if (best === -1) {
        order.forEach((mn, idx) => {
          if (mn.onset <= hn.onset) best = idx
        })
      }
      order.splice(best + 1, 0, hn)
    }
  }
  return { order, overlap }
}

export interface OuFillResult {
  text: string
  matched: number
  total: number
  ourChars: number
  overlap: boolean
}

/** 把我们的歌词按顺序写进 .ustx（返回新文本；不落盘） */
export function fillUstx(text: string, chars: string): OuFillResult {
  const { doc, notes } = parseUstx(text)
  const { order, overlap } = orderOuNotes(notes)
  const list = [...chars]
  const matched = Math.min(list.length, order.length)
  for (let i = 0; i < matched; i++) {
    doc.setIn([...order[i].path, "lyric"], list[i])
  }
  return { text: doc.toString(), matched, total: order.length, ourChars: list.length, overlap }
}

/** 从 .ustx 按顺序读回歌词 */
export function readUstxLyrics(text: string): { chars: string; total: number; overlap: boolean } {
  const { notes } = parseUstx(text)
  const { order, overlap } = orderOuNotes(notes)
  return { chars: order.map((note) => note.lyric).join(""), total: order.length, overlap }
}
