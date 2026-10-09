import { getCells, setCells } from "./state"
import type { Project, SvMapEntry } from "./model/types"
import { isDesktop } from "./platform"

/** SV2 主程序路径（SV 没开时可以一键启动它） */
export const SV2_EXE_PATH = "C:\\Program Files\\Synthesizer V Studio 2 Pro\\synthv-studio.exe"

/** 启动 SV2（走系统打开；失败返回 false） */
export async function launchSv2(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener")
    await openPath(SV2_EXE_PATH)
    return true
  } catch {
    return false
  }
}

/** 和 SV2 脚本约定好的信箱目录：%LOCALAPPDATA%\LyricAssistantBridge */
const BRIDGE_DIR_NAME = "LyricAssistantBridge"

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

/** 行协议（key=value）解析：两边的桥都用这个 */
export function parseBridgeLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=")
    if (at <= 0) continue
    out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

export function formatBridgeRequest(
  seq: string,
  cmd: string,
  extra: Record<string, string> = {},
): string {
  const lines = [`seq=${seq}`, `cmd=${cmd}`]
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}=${value}`)
  return `${lines.join("\n")}\n`
}

export interface BridgeResponse {
  ok: boolean
  note: string
  dry: boolean
  overlap: boolean
  matched: number
  svNotes: number
  ourChars: number
  /** 这次真填（非预演）按序对上的音符身份证（和作词助手的带字格子一一对齐） */
  ids: string[]
}

export interface BridgeState {
  running: boolean
  updated: number
  project: string
  svNotes: number
  chars: string
  /** 和 chars 一一对齐的音符身份证 */
  ids: string[]
  /** SV 那边检测到「用户自己改字」的次数 */
  editSeq: number
  /** SV 那边改过的字（累计，每条带自己的序号）：音符身份证 → 新字 */
  edited: { id: string; char: string; seq: number }[]
}

/** SV 里的一个音符（onset/end 是 blick，pitch 是 MIDI 音高） */
export interface SvNote {
  onset: number
  end: number
  pitch: number
  track: number
  lyric: string
  /** 音符身份证（t<轨>g<组>@<onset>）——新版 bridge.lua 的 dumpNotes 才有 */
  id?: string
}

/** 「词格酱」标记（和导入 MIDI 同一套）：C0=分格、C#0=换句、D0=换段 */
export const SV_KEYSWITCH = { group: 24, sentence: 25, section: 26 } as const

const isHanChar = (ch: string): boolean => /[\u4e00-\u9fff]/.test(ch)

/** 解析 bridge.lua 导出的 notes.txt：onset \t end \t pitch \t track \t lyric [\t id] */
export function parseSvNotes(text: string): SvNote[] {
  const out: SvNote[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    if (parts.length < 5) continue
    const onset = Number(parts[0])
    const end = Number(parts[1])
    const pitch = Number(parts[2])
    const track = Number(parts[3])
    if (![onset, end, pitch, track].every((n) => Number.isFinite(n))) continue
    const id = parts[5] && parts[5].trim() !== "" ? parts[5].trim() : undefined
    out.push({ onset, end, pitch, track, lyric: parts[4] ?? "", ...(id ? { id } : {}) })
  }
  return out
}

export interface SvSection {
  name: string
  lines: { pattern: number[]; cells: string[]; ids?: string[] }[]
}

/**
 * SV 工程里带了「词格酱」标记（C0/C#0/D0）时：照标记生成新词格
 * （规则和「导入 MIDI」的 keyswitch 模式一致：D0 换段、C#0 换句、C0 分格；空段/空句/空格不生成）
 */
export function svNotesToSections(notes: SvNote[]): SvSection[] {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset)
  const sections: SvSection[] = []
  const hasIds = notes.some((note) => note.id !== undefined && note.id !== "")
  let section: SvSection = { name: "", lines: [] }
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
    if (note.pitch === SV_KEYSWITCH.section) {
      flushSection()
      continue
    }
    if (note.pitch === SV_KEYSWITCH.sentence) {
      flushLine()
      continue
    }
    if (note.pitch === SV_KEYSWITCH.group) {
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

/** 有没有「词格酱」标记 */
export function hasCigeMarks(notes: SvNote[]): boolean {
  return notes.some(
    (note) =>
      note.pitch === SV_KEYSWITCH.group ||
      note.pitch === SV_KEYSWITCH.sentence ||
      note.pitch === SV_KEYSWITCH.section,
  )
}

/** 句子 id + 格号 → 现在的字（找不到返回 null） */
function cellChar(project: Project, sid: string, cell: number): string | null {
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      if (sentence.id !== sid) continue
      const cells = getCells(sentence)
      if (cell < 0 || cell >= cells.length) return null
      return (cells[cell] ?? "").trim()
    }
  }
  return null
}

/** 工程里所有格子的引用（段→句→格 顺序，含空格子） */
export function allCellRefs(project: Project): { sid: string; cell: number }[] {
  const refs: { sid: string; cell: number }[] = []
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      const cells = getCells(sentence)
      for (let i = 0; i < cells.length; i++) refs.push({ sid: sentence.id, cell: i })
    }
  }
  return refs
}

/** 工程里「填了字的格子」的引用（和 orderedChars 同一顺序） */
export function filledCellRefs(project: Project): { sid: string; cell: number }[] {
  const refs: { sid: string; cell: number }[] = []
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      const cells = getCells(sentence)
      for (let i = 0; i < cells.length; i++) {
        if ((cells[i] ?? "").trim() !== "") refs.push({ sid: sentence.id, cell: i })
      }
    }
  }
  return refs
}

/** 建对照表：格子引用 ↔ 音符身份证（数量取短的；char = 格子此刻的字） */
export function buildSvMapFromRefs(
  project: Project,
  refs: { sid: string; cell: number }[],
  ids: string[],
): SvMapEntry[] {
  const out: SvMapEntry[] = []
  const count = Math.min(refs.length, ids.length)
  for (let i = 0; i < count; i++) {
    const id = (ids[i] ?? "").trim()
    if (!id) continue
    const ref = refs[i]
    const char = cellChar(project, ref.sid, ref.cell)
    if (char === null) continue
    out.push({ sid: ref.sid, cell: ref.cell, id, char })
  }
  return out
}

/** 找出「格子里的字 ≠ 上次同步时的字」的格子：要写给 SV 的对子（id → 新字） */
export function diffSvMap(project: Project, svMap: SvMapEntry[]): { id: string; char: string }[] {
  const out: { id: string; char: string }[] = []
  for (const entry of svMap) {
    const current = cellChar(project, entry.sid, entry.cell)
    if (current === null || current === entry.char) continue
    out.push({ id: entry.id, char: current })
  }
  return out
}

/** 把 SV 那边改过的字按对照表写回工程（在 mutate 里调）；返回改了几格 */
export function applySvEdits(
  project: Project,
  svMap: SvMapEntry[],
  edited: { id: string; char: string }[],
): number {
  const byId = new Map(svMap.map((entry) => [entry.id, entry]))
  let applied = 0
  for (const item of edited) {
    const entry = byId.get(item.id)
    if (!entry) continue
    const char = /^[\u4e00-\u9fff]$/.test(item.char) ? item.char : ""
    if (entry.char !== char) {
      for (const section of project.sections) {
        const sentence = section.sentences.find((s) => s.id === entry.sid)
        if (!sentence) continue
        const cells = getCells(sentence)
        if (entry.cell < 0 || entry.cell >= cells.length) break
        if (cells[entry.cell] !== char) {
          cells[entry.cell] = char
          setCells(sentence, cells)
          applied += 1
        }
        break
      }
    }
    entry.char = char
  }
  return applied
}

async function fsApi(): Promise<typeof import("@tauri-apps/plugin-fs")> {
  return import("@tauri-apps/plugin-fs")
}

async function bridgePaths(): Promise<{ dir: string; request: string; response: string; state: string }> {
  const { localDataDir, join } = await import("@tauri-apps/api/path")
  const dir = await join(await localDataDir(), BRIDGE_DIR_NAME)
  return {
    dir,
    request: await join(dir, "request.txt"),
    response: await join(dir, "response.txt"),
    state: await join(dir, "state.txt"),
  }
}

/** 给 SV2 那边的后台脚本发一条命令，等它回信；超时（脚本没在跑）返回 null */
export async function callBridge(
  cmd: string,
  extra: Record<string, string> = {},
  timeoutMs = 4000,
): Promise<BridgeResponse | null> {
  if (!isDesktop()) return null
  const fs = await fsApi()
  const paths = await bridgePaths()
  await fs.mkdir(paths.dir, { recursive: true }).catch(() => {})
  const seq = String(Date.now())
  await fs.writeTextFile(paths.request, formatBridgeRequest(seq, cmd, extra))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await fs.readTextFile(paths.response).catch(() => "")
    const parsed = parseBridgeLines(text)
    if (parsed.seq === seq) {
      return {
        ok: parsed.ok === "1",
        note: parsed.note ?? "",
        dry: parsed.dry === "1",
        overlap: parsed.overlap === "1",
        matched: Number(parsed.matched ?? 0),
        svNotes: Number(parsed.svNotes ?? 0),
        ourChars: Number(parsed.ourChars ?? 0),
        ids: (parsed.ids ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return null
}

/** 读 bridge.lua 导出的音符（先发 dumpNotes 让它写 notes.txt） */
export async function readSvNotes(): Promise<SvNote[]> {
  if (!isDesktop()) return []
  const fs = await fsApi()
  const paths = await bridgePaths()
  const { join } = await import("@tauri-apps/api/path")
  const text = await fs.readTextFile(await join(paths.dir, "notes.txt")).catch(() => "")
  return text ? parseSvNotes(text) : []
}

/** 读 SV2 脚本上报的状态（state.txt），判断它还在不在跑 */
export async function readBridgeState(): Promise<BridgeState | null> {
  if (!isDesktop()) return null
  const fs = await fsApi()
  const paths = await bridgePaths()
  const text = await fs.readTextFile(paths.state).catch(() => "")
  if (!text) return null
  const parsed = parseBridgeLines(text)
  const updated = Number(parsed.updated ?? 0)
  const edited = (parsed.edited ?? "")
    .split(";")
    .map((pair) => {
      const parts = pair.split("|")
      if (parts.length < 3 || parts[0] === "") return null
      const seq = Number(parts[2])
      if (!Number.isFinite(seq)) return null
      return { id: parts[0], char: parts[1], seq }
    })
    .filter((item): item is { id: string; char: string; seq: number } => item !== null)
  return {
    running: updated > 0 && Math.floor(Date.now() / 1000) - updated <= 3,
    updated,
    project: parsed.project ?? "",
    svNotes: Number(parsed.svNotes ?? 0),
    chars: parsed.chars ?? "",
    ids: (parsed.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    editSeq: Number(parsed.editSeq ?? 0),
    edited,
  }
}
