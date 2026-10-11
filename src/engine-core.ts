import { getCells } from "./state"
import type { Project } from "./model/types"

/**
 * 引擎层共享核心：SV2 与 OpenUtau 共用的东西都放这里，避免同一套规则写两份。
 * - EngineNote：引擎里的一个「字位」音符（两个引擎通用）
 * - orderNotes：排序（照「导入 MIDI」那套）——唯一实现
 * - 词格酱标记（C0/C#0/D0）识别 / 重建词格
 * - orderedChars：作词助手这边「填了字的格子」的顺序汉字串
 */

/** 引擎里的一个「字位」音符（SV2 有身份证 id；OpenUtau 没有） */
export interface EngineNote {
  onset: number
  end: number
  track: number
  /** MIDI 音高（OpenUtau 里是 tone）；词格酱标记靠它认 */
  pitch?: number
  lyric: string
  id?: string
}

/** 「词格酱」标记（和导入 MIDI 同一套）：C0=分格、C#0=换句、D0=换段 */
export const CIGE_KEYSWITCH = { group: 24, sentence: 25, section: 26 } as const

const isHanChar = (ch: string): boolean => /[\u4e00-\u9fff]/.test(ch)

/** 只留「歌词是汉字」的音符（SV2 那套字位判定） */
export function hanNotes<Note extends EngineNote>(notes: Note[]): Note[] {
  return notes.filter((note) => isHanChar(note.lyric))
}

/** 作词助手里「填了字的格子」按顺序拼出的汉字串（忽略词格、忽略空） */
export function orderedChars(project: Project): string {
  const chars: string[] = []
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      for (const cell of getCells(sentence)) {
        if (cell.trim() !== "") chars.push(cell.trim())
      }
    }
  }
  return chars.join("")
}

/** 有没有「词格酱」标记 */
export function hasCigeMarks(notes: EngineNote[]): boolean {
  return notes.some(
    (note) =>
      note.pitch === CIGE_KEYSWITCH.group ||
      note.pitch === CIGE_KEYSWITCH.sentence ||
      note.pitch === CIGE_KEYSWITCH.section,
  )
}

export interface EngineSection {
  name: string
  lines: { pattern: number[]; cells: string[]; ids?: string[] }[]
}

/**
 * 照「词格酱」标记重建词格（规则和「导入 MIDI」的 keyswitch 模式一致：
 * D0 换段、C#0 换句、C0 分格；空段/空句/空格不生成）
 */
export function engineNotesToSections(notes: EngineNote[]): EngineSection[] {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const sections: EngineSection[] = []
  const hasIds = notes.some((note) => note.id !== undefined && note.id !== "")
  let section: EngineSection = { name: "", lines: [] }
  let pattern: number[] = []
  let cells: string[] = []
  let ids: string[] = []
  let group = 0
  const flushGroup = (): void => {
    if (group > 0) {
      pattern.push(group)
      group = 0
    }
  }
  const flushLine = (): void => {
    flushGroup()
    if (pattern.length > 0) {
      section.lines.push(hasIds ? { pattern, cells, ids } : { pattern, cells })
    }
    pattern = []
    cells = []
    ids = []
  }
  const flushSection = (): void => {
    flushLine()
    if (section.lines.length > 0) sections.push(section)
    section = { name: "", lines: [] }
  }
  for (const note of sorted) {
    if (note.pitch === CIGE_KEYSWITCH.section) {
      flushSection()
      continue
    }
    if (note.pitch === CIGE_KEYSWITCH.sentence) {
      flushLine()
      continue
    }
    if (note.pitch === CIGE_KEYSWITCH.group) {
      flushGroup()
      continue
    }
    // 只收汉字；`-`（延音）/空/非汉字不占格
    if (!isHanChar(note.lyric)) continue
    group += 1
    cells.push(note.lyric)
    ids.push(note.id ?? "")
  }
  flushSection()
  return sections
}

function tracksOverlap(a: { onset: number; end: number }[], b: { onset: number; end: number }[]): boolean {
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

/**
 * 排序（照「导入 MIDI」那套）：时间不重叠的轨合并循序读字；
 * 重叠的轨聚成一簇，簇里字数多的当主歌、其余当和声，
 * 和声音符插在「重叠最多的主音符」后面。SV2 / OpenUtau 共用这一份。
 */
export function orderNotes<Note extends { onset: number; end: number; track: number }>(
  notes: Note[],
): { order: Note[]; overlap: boolean } {
  const byTrack = new Map<number, Note[]>()
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
  const order: Note[] = []
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
