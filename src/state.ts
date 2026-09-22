import type { Alternative, Cursor, Project, ProjectStats, Section, Sentence } from "./model/types"
import { cellsFromPattern, resizeToPattern } from "./model/grid"
import { totalCells } from "./model/pattern"

let idCounter = 0

export function newId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

function emptyAlternative(name: string, cells: string[]): Alternative {
  return { id: newId("alt"), name, cells }
}

export function createSentence(pattern: number[]): Sentence {
  const cells = cellsFromPattern(pattern)
  return {
    id: newId("s"),
    pattern,
    alternatives: [emptyAlternative("备选 1", cells)],
    activeAlt: 0,
    note: "",
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
  for (const sentence of sentences) {
    total += totalCells(sentence.pattern)
    for (const ch of getCells(sentence)) {
      if (ch) filled += 1
    }
  }
  return {
    filled,
    total,
    sentences: sentences.length,
    sections: project.sections.length,
    percent: total === 0 ? 0 : Math.round((filled / total) * 100),
  }
}

export function getCells(sentence: Sentence): string[] {
  return sentence.alternatives[sentence.activeAlt].cells
}

export function setCells(sentence: Sentence, cells: string[]): void {
  sentence.alternatives[sentence.activeAlt].cells = cells
}

export function setPattern(sentence: Sentence, pattern: number[]): void {
  sentence.pattern = pattern
  for (const alt of sentence.alternatives) {
    alt.cells = resizeToPattern(pattern, alt.cells)
  }
}

export function addAlternative(sentence: Sentence): void {
  const source = getCells(sentence)
  const name = `备选 ${sentence.alternatives.length + 1}`
  sentence.alternatives.push(emptyAlternative(name, source.slice()))
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
    return {
      version: 2,
      title: legacy.title || "未命名",
      sections: [section],
      updatedAt: legacy.updatedAt || new Date().toISOString(),
    }
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
  return project
}

export function sentenceLine(sentence: Sentence): string {
  const cells = getCells(sentence)
  const parts: string[] = []
  let acc = 0
  for (const size of sentence.pattern) {
    parts.push(cells.slice(acc, acc + size).join(""))
    acc += size
  }
  return parts.join(" ")
}

export function exportLyrics(project: Project): string {
  return project.sections
    .map((section) => section.sentences.map(sentenceLine).join("\n"))
    .join("\n\n")
}

export const autosaveState = { at: null as string | null }
let autosaveListener: (() => void) | null = null

export function onAutosave(cb: () => void): void {
  autosaveListener = cb
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

const AUTOSAVE_KEY = "cige-grid-autosave"

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutosave(store: Store): void {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          project: store.project,
          filePath: store.filePath,
        }),
      )
      const now = new Date()
      autosaveState.at = `${String(now.getHours()).padStart(2, "0")}:${String(
        now.getMinutes(),
      ).padStart(2, "0")}`
      autosaveListener?.()
    } catch {
      // 忽略配额错误
    }
  }, 400)
}

export function loadAutosave(): { project: Project; filePath: string | null } | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { project: Project; filePath: string | null }
    return { project: parseProject(JSON.stringify(data.project)), filePath: data.filePath }
  } catch {
    return null
  }
}
