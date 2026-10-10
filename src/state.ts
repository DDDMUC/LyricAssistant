import type { Alternative, Cursor, Project, ProjectStats, Section, Sentence, SvMapEntry } from "./model/types"
import { cellsFromPattern, resizeToPattern } from "./model/grid"
import { totalCells } from "./model/pattern"
import { hanOnly } from "./model/rhyme"

let idCounter = 0

export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

function emptyAlternative(name: string, cells: string[]): Alternative {
  return { id: newId("alt"), name, cells }
}

export function createSentence(pattern: number[], role?: "harmony"): Sentence {
  const cells = cellsFromPattern(pattern)
  return {
    id: newId("s"),
    pattern,
    alternatives: [emptyAlternative("备选 1", cells)],
    activeAlt: 0,
    note: "",
    overflow: "",
    rhymeHint: "",
    ...(role === "harmony" ? { role: "harmony" as const } : {}),
  }
}

export function createSection(name: string, sentences: Sentence[]): Section {
  return { id: newId("sec"), name, sentences }
}

export function createProject(): Project {
  const verse = createSection(
    "Verse",
    [[4, 3], [3, 4], [2, 5], [4, 4]].map((p) => createSentence(p)),
  )
  const chorus = createSection(
    "Chorus",
    [[5, 3], [4, 4], [5, 3], [6]].map((p) => createSentence(p)),
  )
  return {
    version: 2,
    title: "未命名歌曲",
    sections: [verse, chorus],
    updatedAt: new Date().toISOString(),
    credits: [],
    source: "",
  }
}

export function allSentences(project: Project): Sentence[] {
  return project.sections.flatMap((section) => section.sentences)
}

export function findSectionBySentence(project: Project, sentenceId: string): Section | undefined {
  return project.sections.find((section) =>
    section.sentences.some((s) => s.id === sentenceId),
  )
}

export function sentenceIndex(project: Project, sentenceId: string): number {
  return allSentences(project).findIndex((s) => s.id === sentenceId)
}

/**
 * 句子序号标签：主歌按整数（1、2、3…），和声 = 最近主歌号.序号（8.1、8.2…），遇新主歌和声序号归零。
 * 传整个工程 = 全局序号；传单段 = 段内序号。工程开头就是和声时按 0.1、0.2 排。
 */
export function sentenceLabels(sentences: Sentence[]): string[] {
  const labels: string[] = []
  let main = 0
  let harmony = 0
  for (const sentence of sentences) {
    if (sentence.role === "harmony") {
      harmony += 1
      labels.push(`${main}.${harmony}`)
    } else {
      main += 1
      harmony = 0
      labels.push(String(main))
    }
  }
  return labels
}

export function sentenceAt(project: Project, index: number): Sentence | undefined {
  return allSentences(project)[index]
}

export function moveSection(project: Project, sectionId: string, dir: -1 | 1): boolean {
  const index = project.sections.findIndex((s) => s.id === sectionId)
  const target = index + dir
  if (index < 0 || target < 0 || target >= project.sections.length) return false
  const [moved] = project.sections.splice(index, 1)
  project.sections.splice(target, 0, moved)
  return true
}

export function statsOf(project: Project): ProjectStats {
  const sentences = allSentences(project)
  let filled = 0
  let total = 0
  let overflow = 0
  for (const sentence of sentences) {
    total += totalCells(sentence.pattern)
    for (const ch of getCells(sentence)) {
      if (ch) filled += 1
    }
    overflow += [...sentence.overflow].filter((ch) => ch.trim() !== "").length
  }
  return {
    filled,
    total,
    sentences: sentences.length,
    sections: project.sections.length,
    percent: total === 0 ? 0 : Math.round((filled / total) * 100),
    overflow,
  }
}

export function getCells(sentence: Sentence): string[] {
  return sentence.alternatives[sentence.activeAlt].cells
}

export function setCells(sentence: Sentence, cells: string[]): void {
  sentence.alternatives[sentence.activeAlt].cells = cells
  if (cells[cells.length - 1]) sentence.rhymeHint = ""
}

export function setPattern(sentence: Sentence, pattern: number[]): void {
  const oldSize = totalCells(sentence.pattern)
  const newSize = totalCells(pattern)
  sentence.pattern = pattern
  sentence.alternatives.forEach((alt, index) => {
    const tail =
      index === sentence.activeAlt ? alt.cells.slice(newSize).filter(Boolean).join("") : ""
    alt.cells = resizeToPattern(pattern, alt.cells)
    if (tail) sentence.overflow = sentence.overflow + tail
  })
  if (newSize > oldSize && sentence.overflow) {
    const cells = getCells(sentence)
    const chars = [...sentence.overflow]
    for (let i = oldSize; i < newSize && chars.length > 0; i++) {
      if (!cells[i]) cells[i] = chars.shift() ?? ""
    }
    setCells(sentence, cells)
    sentence.overflow = chars.join("")
  }
}

/** 只改词格形状、把各备选格子对齐到新形状（不碰溢出）：加/删格、断开分句这类"结构编辑"用 */
export function setPatternShape(sentence: Sentence, pattern: number[]): void {
  sentence.pattern = pattern
  sentence.alternatives.forEach((alt) => {
    alt.cells = resizeToPattern(pattern, alt.cells)
  })
}

export function addAlternative(sentence: Sentence, name?: string): void {
  const source = getCells(sentence)
  const fallback = `备选 ${sentence.alternatives.length + 1}`
  sentence.alternatives.push(emptyAlternative(name || fallback, source.slice()))
  sentence.activeAlt = sentence.alternatives.length - 1
}

export function switchAlternative(sentence: Sentence, index: number): void {
  if (index < 0 || index >= sentence.alternatives.length) return
  sentence.activeAlt = index
}

export function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project
}

interface LegacyProjectV1 {
  version: 1
  title: string
  sentences: Sentence[]
  updatedAt: string
}

function normalizeSentence(sentence: Sentence): void {
  if (!Array.isArray(sentence.pattern) || !Array.isArray(sentence.alternatives)) {
    throw new Error("无效的工程文件：句结构损坏")
  }
  const size = totalCells(sentence.pattern)
  if (sentence.alternatives.length === 0) {
    throw new Error("无效的工程文件：备选为空")
  }
  sentence.activeAlt = Math.min(
    Math.max(0, sentence.activeAlt | 0),
    sentence.alternatives.length - 1,
  )
  for (const alt of sentence.alternatives) {
    alt.cells = resizeToPattern(sentence.pattern, alt.cells)
    while (alt.cells.length < size) alt.cells.push("")
  }
  if (typeof sentence.note !== "string") sentence.note = ""
  if (typeof sentence.overflow !== "string") sentence.overflow = ""
  if (typeof sentence.rhymeHint !== "string") sentence.rhymeHint = ""
  // 老的"整句锁"（只锁句尾）→ 迁移成逐格锁（锁在最后一格）
  if (typeof sentence.rhymeLock === "string" && sentence.rhymeLock) {
    const lastIndex = totalCells(sentence.pattern) - 1
    if (lastIndex >= 0) {
      if (!sentence.cellLocks || typeof sentence.cellLocks !== "object") sentence.cellLocks = {}
      sentence.cellLocks[String(lastIndex)] = sentence.rhymeLock
    }
  }
  delete sentence.rhymeLock
  if (sentence.cellLocks && typeof sentence.cellLocks === "object") {
    const size = totalCells(sentence.pattern)
    const clean: Record<string, string> = {}
    for (const [key, value] of Object.entries(sentence.cellLocks)) {
      const index = Number(key)
      if (Number.isInteger(index) && index >= 0 && index < size && typeof value === "string" && value) {
        clean[String(index)] = value
      }
    }
    if (Object.keys(clean).length > 0) sentence.cellLocks = clean
    else delete sentence.cellLocks
  } else {
    delete sentence.cellLocks
  }
  if (sentence.role !== "harmony") delete sentence.role
  // 押韵组引用：id 字符串 + 格号数组（去掉越界/重复）
  if (Array.isArray(sentence.rhymeGroups)) {
    const size = totalCells(sentence.pattern)
    const refs = sentence.rhymeGroups.flatMap((ref) => {
      if (!ref || typeof ref !== "object") return []
      const item = ref as { id?: unknown; indexes?: unknown }
      if (typeof item.id !== "string" || !item.id || !Array.isArray(item.indexes)) return []
      const indexes = [...new Set(
        item.indexes.filter(
          (index): index is number => typeof index === "number" && Number.isInteger(index) && index >= 0 && index < size,
        ),
      )].sort((a, b) => a - b)
      if (indexes.length === 0) return []
      return [{ id: item.id, indexes }]
    })
    if (refs.length > 0) sentence.rhymeGroups = refs
    else delete sentence.rhymeGroups
  } else {
    delete sentence.rhymeGroups
  }
  if (typeof sentence.id !== "string" || !sentence.id) sentence.id = newId("s")
}

export function parseProject(raw: string): Project {
  const data = JSON.parse(raw) as Project | LegacyProjectV1

  if (data.version === 1 && Array.isArray((data as LegacyProjectV1).sentences)) {
    const legacy = data as LegacyProjectV1
    if (!Array.isArray(legacy.sentences)) {
      throw new Error("无效的工程文件")
    }
    for (const sentence of legacy.sentences) normalizeSentence(sentence)
    const section = createSection("歌词", legacy.sentences)
    const project: Project = {
      version: 2,
      title: legacy.title || "未命名",
      sections: [section],
      updatedAt: legacy.updatedAt || new Date().toISOString(),
      credits: [],
    }
    sanitizeProject(project)
    return project
  }

  const project = data as Project
  if (project.version !== 2 || !Array.isArray(project.sections)) {
    throw new Error("无效的工程文件")
  }
  for (const section of project.sections) {
    if (typeof section.name !== "string" || !Array.isArray(section.sentences)) {
      throw new Error("无效的工程文件：段落结构损坏")
    }
    if (typeof section.id !== "string" || !section.id) section.id = newId("sec")
    for (const sentence of section.sentences) normalizeSentence(sentence)
  }
  if (project.sections.length === 0) {
    project.sections.push(createSection("歌词", [createSentence([2, 2, 3])]))
  }
  project.credits = Array.isArray(project.credits)
    ? project.credits.filter((credit): credit is string => typeof credit === "string" && credit.trim() !== "")
    : []
  // SV2 对照表：结构不合法的条目直接丢掉（旧工程没有这字段，照常能开）
  if (Array.isArray(project.svMap)) {
    const map = project.svMap.filter(
      (entry): entry is SvMapEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof entry.sid === "string" &&
        entry.sid !== "" &&
        typeof entry.id === "string" &&
        entry.id !== "" &&
        typeof entry.cell === "number" &&
        Number.isInteger(entry.cell) &&
        entry.cell >= 0 &&
        typeof entry.char === "string",
    )
    if (map.length > 0) project.svMap = map
    else delete project.svMap
  } else {
    delete project.svMap
  }
  sanitizeProject(project)
  return project
}

/** 老数据兜底：所有备选的格子和溢出里只留汉字（早年版本可能混进过标点、符号、英文） */
/** 押韵组兜底：越界引用已在句子层清过；这里清孤儿组（没被引用 / 只剩 1 格）并核对约束 */
function sanitizeRhymeGroups(project: Project): void {
  const referenced = new Set<string>()
  const counts = new Map<string, number>()
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      for (const ref of sentence.rhymeGroups ?? []) {
        referenced.add(ref.id)
        counts.set(ref.id, (counts.get(ref.id) ?? 0) + ref.indexes.length)
      }
    }
  }
  const groups = (project.rhymeGroups ?? []).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !referenced.has(item.id)) return []
    if ((counts.get(item.id) ?? 0) < 2) return []
    const raw = (item.constraint ?? {}) as Record<string, unknown>
    const constraint: { rhy?: string; final?: string; initial?: string; tones?: number[] } = {}
    if (typeof raw.rhy === "string" && raw.rhy) constraint.rhy = raw.rhy
    if (typeof raw.final === "string") constraint.final = raw.final
    if (typeof raw.initial === "string") constraint.initial = raw.initial
    if (Array.isArray(raw.tones)) {
      const tones = [...new Set(raw.tones.filter((tone): tone is number => typeof tone === "number" && tone >= 0 && tone <= 5))]
      if (tones.length > 0) constraint.tones = tones
    }
    return [{ id: item.id, constraint }]
  })
  // 约束全没了 / 只剩 1 格的组：把句子上的引用也清掉
  const alive = new Set(groups.map((item) => item.id))
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      if (!sentence.rhymeGroups) continue
      sentence.rhymeGroups = sentence.rhymeGroups.filter((ref) => alive.has(ref.id))
      if (sentence.rhymeGroups.length === 0) delete sentence.rhymeGroups
    }
  }
  if (groups.length > 0) project.rhymeGroups = groups
  else delete project.rhymeGroups
}

export function sanitizeProject(project: Project): number {
  let cleaned = 0
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      for (const alt of sentence.alternatives) {
        alt.cells = alt.cells.map((cell) => {
          const han = hanOnly(cell)
          if (han !== cell) cleaned += 1
          return han
        })
      }
      const over = sentence.overflow ?? ""
      const han = hanOnly(over)
      if (han !== over) {
        cleaned += 1
        sentence.overflow = han
      }
    }
  }
  sanitizeRhymeGroups(project)
  return cleaned
}

export function cellsToLine(cells: string[], pattern: number[], fill = "X"): string {
  const parts: string[] = []
  let acc = 0
  for (const size of pattern) {
    const group = cells.slice(acc, acc + size)
    parts.push(group.map((char) => char || fill).join(""))
    acc += size
  }
  return parts.join(" ")
}

export function sentenceLine(sentence: Sentence): string {
  const line = cellsToLine(getCells(sentence), sentence.pattern)
  return sentence.overflow ? line + sentence.overflow : line
}

export function reflowOverflow(project: Project): number {
  let moved = 0
  for (const section of project.sections) {
    for (let index = 0; index < section.sentences.length; index++) {
      const sentence = section.sentences[index]
      const over = sentence.overflow
      if (!over) continue
      sentence.overflow = ""
      moved += [...over].length
      const chars = [...over]
      const next = section.sentences[index + 1]
      if (next) {
        const total = totalCells(next.pattern)
        const combined = [...chars, ...getCells(next)]
        const tail = combined.slice(total).filter(Boolean).join("")
        setCells(next, resizeToPattern(next.pattern, combined))
        if (tail) next.overflow = tail + next.overflow
      } else {
        const created = createSentence([chars.length])
        setCells(created, chars)
        section.sentences.push(created)
      }
    }
  }
  return moved
}

export function applyImportedCredits(
  project: Project,
  credits: string[],
  merge: boolean,
): void {
  if (merge) {
    if (credits.length === 0) return
    project.credits = [...new Set([...(project.credits ?? []), ...credits])]
  } else {
    project.credits = [...credits]
  }
}

export function applyImportedTitle(
  project: Project,
  title: string,
  merge: boolean,
): void {
  if (merge) return
  project.title = title || "未命名歌曲"
}

export function applyImportedSource(
  project: Project,
  text: string,
  merge: boolean,
): void {
  const current = project.source ?? ""
  project.source = merge ? (current ? `${current}\n\n${text}` : text) : text
}

export interface ExportOptions {
  alts: boolean
  note: boolean
  credits: boolean
}

export const ALT_EXPORT_SEP = " ※ "

export function exportSentenceLine(sentence: Sentence, options: ExportOptions): string {
  const lines: string[] = []
  const current = sentenceLine(sentence).trim()
  if (current) lines.push(current)
  if (options.alts) {
    sentence.alternatives.forEach((alt, index) => {
      if (index === sentence.activeAlt) return
      const line = cellsToLine(alt.cells, sentence.pattern).trim()
      if (line && !lines.includes(line)) lines.push(line)
    })
  }
  let line = lines.join(ALT_EXPORT_SEP)
  if (!line) {
    line = sentence.pattern.map((size) => "X".repeat(size)).join(" ")
  }
  if (options.note && sentence.note) line += `（${sentence.note}）`
  if (sentence.role === "harmony") line = `（${line}）`
  return line
}

export function exportLyrics(
  project: Project,
  options: ExportOptions = { alts: false, note: false, credits: false },
): string {
  const body = project.sections
    .map((section) =>
      section.sentences.map((sentence) => exportSentenceLine(sentence, options)).join("\n"),
    )
    .join("\n\n")
  const credits = options.credits ? (project.credits ?? []) : []
  return credits.length > 0 ? `${credits.join("\n")}\n\n${body}` : body
}

export function exportGrid(project: Project, fill = "X"): string {
  return project.sections
    .map((section) => {
      const lines = section.sentences.map((sentence) => {
        const line = sentence.pattern.map((size) => fill.repeat(size)).join(" ")
        return sentence.role === "harmony" ? `（${line}）` : line
      })
      return [`[${section.name || "段落"}]`, ...lines].join("\n")
    })
    .join("\n\n")
}

export const autosaveState = { at: null as string | null }
let autosaveListener: (() => void) | null = null
let autosaveWriter: ((store: Store) => void) | null = null

export function onAutosave(cb: () => void): void {
  autosaveListener = cb
}

export function onAutosaveWrite(cb: (store: Store) => void): void {
  autosaveWriter = cb
}

export function markAutosaved(): void {
  const now = new Date()
  autosaveState.at = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`
  autosaveListener?.()
}

export class Store {
  project: Project
  cursor: Cursor
  undoStack: Project[] = []
  redoStack: Project[] = []
  dirty = false
  filePath: string | null = null

  constructor(project?: Project) {
    this.project = project ?? createProject()
    const first = allSentences(this.project)[0]
    this.cursor = first
      ? { sentenceId: first.id, cell: 0 }
      : { sentenceId: "", cell: 0 }
  }

  findSentence(id: string): Sentence | undefined {
    return allSentences(this.project).find((s) => s.id === id)
  }

  currentSentence(): Sentence | undefined {
    return this.findSentence(this.cursor.sentenceId)
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  pushUndo(): void {
    this.undoStack.push(cloneProject(this.project))
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []
  }

  private applySnapshot(project: Project): void {
    this.project = project
    if (!this.findSentence(this.cursor.sentenceId)) {
      const first = allSentences(this.project)[0]
      if (first) this.cursor = { sentenceId: first.id, cell: 0 }
    } else {
      const sentence = this.currentSentence()!
      this.cursor.cell = Math.min(this.cursor.cell, totalCells(sentence.pattern) - 1)
    }
    this.persist()
  }

  undo(): boolean {
    const prev = this.undoStack.pop()
    if (!prev) return false
    this.redoStack.push(cloneProject(this.project))
    if (this.redoStack.length > 100) this.redoStack.shift()
    this.applySnapshot(prev)
    return true
  }

  redo(): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(cloneProject(this.project))
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.applySnapshot(next)
    return true
  }

  touch(): void {
    this.dirty = true
    this.persist()
  }

  persist(): void {
    this.project.updatedAt = new Date().toISOString()
    scheduleAutosave(this)
  }

  markSaved(): void {
    this.dirty = false
  }

  ensureCursor(): void {
    const sentence = this.currentSentence()
    if (!sentence) {
      const first = allSentences(this.project)[0]
      if (first) this.cursor = { sentenceId: first.id, cell: 0 }
      return
    }
    const size = totalCells(sentence.pattern)
    this.cursor.cell = Math.min(Math.max(0, this.cursor.cell), size - 1)
  }
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutosave(store: Store): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    try {
      autosaveWriter?.(store)
      markAutosaved()
    } catch {
      // 忽略配额错误
    }
  }, 400)
}
