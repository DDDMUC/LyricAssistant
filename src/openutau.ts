import { parseDocument } from "yaml"
import type { Document } from "yaml"
import { CIGE_KEYSWITCH, orderNotes, type EngineNote } from "./engine-core"

/**
 * OpenUtau 的「文件级」桥（.ustx 工程文件）：
 * OpenUtau 没有 SV2 那种常驻脚本 + 文件信箱，所以只能读/写它的工程文件——
 * 等价于 SV 弹窗里的「预演 / 按序填词 / 读回」三个按钮（不含实时同步）。
 *
 * .ustx 是 YAML（官方文档 USTX File Format）：voice_parts[].notes[] 里每个音符有
 * position / duration / tone / lyric；绝对时间 = part.position + note.position。
 * 排序、词格酱标记重建等通用规则都在 engine-core.ts（和 SV2 共用同一份）。
 */

export interface OuNote extends EngineNote {
  /** 该音符在文档里的路径（setIn 用） */
  path: (string | number)[]
}

/** 不算「字位」的歌词：-（延音）、br（换气）、R（休止） */
const SKIP_LYRICS = new Set(["-", "br", "R"])

/** 不是「词格酱」标记音符（C0/C#0/D0） */
function isCigeMark(pitch: number | undefined): boolean {
  return (
    pitch === CIGE_KEYSWITCH.group ||
    pitch === CIGE_KEYSWITCH.sentence ||
    pitch === CIGE_KEYSWITCH.section
  )
}

interface RawNote {
  position?: unknown
  duration?: unknown
  tone?: unknown
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

/** 解析 .ustx：取出非静音轨的**全部**音符（带 pitch=tone，含词格酱标记；不做歌词过滤） */
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
      const pitch = typeof note.tone === "number" ? note.tone : undefined
      const lyric = note.lyric === undefined || note.lyric === null ? "" : String(note.lyric)
      const onset = partPosition + pos
      notes.push({
        onset,
        end: onset + dur,
        track,
        pitch,
        lyric,
        path: ["voice_parts", p, "notes", n],
      })
    })
  })
  return { doc, notes }
}

/** 「字位」过滤：非延音/换气/休止，且不是词格酱标记（标记不占字位、填词也不会去动它） */
export function ouEligible(notes: OuNote[]): OuNote[] {
  return notes.filter((note) => !SKIP_LYRICS.has(note.lyric.trim()) && !isCigeMark(note.pitch))
}

/** 排序（共享实现；保留这个名字方便既有调用/测试） */
export const orderOuNotes = orderNotes

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
  const { order, overlap } = orderNotes(ouEligible(notes))
  const list = [...chars]
  const matched = Math.min(list.length, order.length)
  for (let i = 0; i < matched; i++) {
    doc.setIn([...order[i].path, "lyric"], list[i])
  }
  return { text: doc.toString(), matched, total: order.length, ourChars: list.length, overlap }
}

/** 从 .ustx 按顺序读回「字位」歌词（按序填格那一路用；词格酱标记那一路走 engine-core 的重建） */
export function readUstxLyrics(text: string): { chars: string; total: number; overlap: boolean } {
  const { notes } = parseUstx(text)
  const { order, overlap } = orderNotes(ouEligible(notes))
  return { chars: order.map((note) => note.lyric).join(""), total: order.length, overlap }
}
