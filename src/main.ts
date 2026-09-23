import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { copyText, readClipboardText } from "./clipboard"
import {
  addCellAt,
  clearCell,
  removeCellAt,
  shiftSentence,
  writeChars,
} from "./model/grid"
import { parseLyrics } from "./model/lyrics"
import { parsePattern, patternToString, totalCells } from "./model/pattern"
import { isEndingFilled, rhymeHue, rhymeOfCells } from "./model/rhyme"
import type { Project, Section, Sentence } from "./model/types"
import {
  autosaveState,
  Store,
  addAlternative,
  allSentences,
  createProject,
  createSection,
  createSentence,
  exportLyrics,
  findSectionBySentence,
  getCells,
  loadAutosave,
  moveSection,
  onAutosave,
  parseProject,
  sentenceAt,
  sentenceIndex,
  sentenceLine,
  setCells,
  setPattern,
  statsOf,
  switchAlternative,
} from "./state"
import { cycleTheme, initTheme, themeIcon, themeLabel, themeState } from "./theme"

const sentencesEl = document.querySelector("#sentences") as HTMLElement
const titleEl = document.querySelector("#project-title") as HTMLInputElement
const newPatternEl = document.querySelector("#new-pattern") as HTMLInputElement
const statusStatsEl = document.querySelector("#status-stats") as HTMLElement
const statusHintEl = document.querySelector("#status-hint") as HTMLElement
const statusPathEl = document.querySelector("#status-path") as HTMLElement
const statusAutosaveEl = document.querySelector("#status-autosave") as HTMLElement
const statusRhymeEl = document.querySelector("#status-rhyme") as HTMLElement
const themeBtn = document.querySelector("#btn-theme") as HTMLButtonElement
const undoBtn = document.querySelector("#btn-undo") as HTMLButtonElement
const redoBtn = document.querySelector("#btn-redo") as HTMLButtonElement

let composing = false
let statusOverride: { text: string; isError: boolean } | null = null
let statusOverrideTimer: ReturnType<typeof setTimeout> | null = null

const autosaved = loadAutosave()
const store = autosaved ? new Store(autosaved.project) : new Store(createProject())
if (autosaved?.filePath) store.filePath = autosaved.filePath

function setStatus(text: string, isError = false): void {
  statusOverride = { text, isError }
  if (statusOverrideTimer) clearTimeout(statusOverrideTimer)
  statusOverrideTimer = setTimeout(() => {
    statusOverride = null
    renderStatusBar()
  }, 4000)
  renderStatusBar()
}

function updatePathStatus(): void {
  const path = store.filePath ? store.filePath : "未保存到文件"
  statusPathEl.textContent = store.dirty ? `● ${path}` : path
  statusPathEl.classList.toggle("dirty", store.dirty)
}

function renderStatusBar(): void {
  const stats = statsOf(store.project)
  statusStatsEl.textContent =
    `已填 ${stats.filled} / ${stats.total} 格 · 完成 ${stats.percent}% · ` +
    `句数 ${stats.sentences} · 段落 ${stats.sections}`

  if (statusOverride) {
    statusHintEl.textContent = statusOverride.text
    statusHintEl.classList.toggle("error", statusOverride.isError)
  } else {
    statusHintEl.textContent =
      "点格子输入 · Backspace 原地删 · Alt+←/→ 整句挪动 · Ctrl/Cmd+S 保存 · Ctrl/Cmd+Z 撤销 · Shift+Cmd+Z 重做"
    statusHintEl.classList.remove("error")
  }

  undoBtn.disabled = !store.canUndo()
  redoBtn.disabled = !store.canRedo()

  statusRhymeEl.textContent = rhymeSummaryText()

  updatePathStatus()
  statusAutosaveEl.textContent = autosaveState.at ? `已自动保存 ${autosaveState.at}` : ""
  document.title = `${store.dirty ? "● " : ""}${store.project.title || "词格"} · 词格`
}

function rhymeSummaryText(): string {
  const counts = new Map<string, { label: string; count: number }>()
  for (const sentence of allSentences(store.project)) {
    const cells = getCells(sentence)
    if (!isEndingFilled(cells)) continue
    const rhyme = rhymeOfCells(cells)
    if (!rhyme) continue
    const entry = counts.get(rhyme.key) ?? { label: rhyme.label, count: 0 }
    entry.count += 1
    counts.set(rhyme.key, entry)
  }
  if (counts.size === 0) return ""
  const parts = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .map((entry) => `${entry.label.replace(/辙$/, "")}×${entry.count}`)
  return `韵脚 ${parts.join(" ")}`
}

function mutate(fn: () => void): void {
  store.pushUndo()
  fn()
  store.ensureCursor()
  store.touch()
  render()
}

function render(): void {
  if (composing) return
  titleEl.value = store.project.title
  sentencesEl.replaceChildren()

  store.project.sections.forEach((section, sectionIdx) => {
    sentencesEl.appendChild(renderSection(section, sectionIdx))
  })

  renderStatusBar()
}

function renderSection(section: Section, sectionIdx: number): HTMLElement {
  const root = document.createElement("section")
  root.className = "section"
  root.dataset.sectionId = section.id

  const header = document.createElement("div")
  header.className = "section-header"

  const nameInput = document.createElement("input")
  nameInput.className = "section-name"
  nameInput.value = section.name
  nameInput.setAttribute("aria-label", "段落名称")
  nameInput.addEventListener("change", () => {
    mutate(() => {
      const target = store.project.sections.find((s) => s.id === section.id)
      if (target) target.name = nameInput.value || "段落"
    })
  })
  header.appendChild(nameInput)

  const cells = section.sentences.reduce(
    (acc, s) => acc + totalCells(s.pattern),
    0,
  )
  const meta = document.createElement("span")
  meta.className = "section-meta"
  meta.textContent = `${section.sentences.length} 句 · ${cells} 格`
  header.appendChild(meta)

  const actions = document.createElement("div")
  actions.className = "section-actions"

  const addBtn = document.createElement("button")
  addBtn.type = "button"
  addBtn.textContent = "+ 新增一句"
  addBtn.addEventListener("click", () => addSentenceToSection(section.id))
  actions.appendChild(addBtn)

  const addSectionBtn = document.createElement("button")
  addSectionBtn.type = "button"
  addSectionBtn.textContent = "+ 段"
  addSectionBtn.title = "在此段后插入新段落"
  addSectionBtn.addEventListener("click", () => addSectionAfter(section.id))
  actions.appendChild(addSectionBtn)

  const upSectionBtn = document.createElement("button")
  upSectionBtn.type = "button"
  upSectionBtn.textContent = "↑"
  upSectionBtn.title = "上移段落"
  upSectionBtn.disabled = sectionIdx === 0
  upSectionBtn.addEventListener("click", () => moveSectionBy(section.id, -1))
  actions.appendChild(upSectionBtn)

  const downSectionBtn = document.createElement("button")
  downSectionBtn.type = "button"
  downSectionBtn.textContent = "↓"
  downSectionBtn.title = "下移段落"
  downSectionBtn.disabled = sectionIdx === store.project.sections.length - 1
  downSectionBtn.addEventListener("click", () => moveSectionBy(section.id, 1))
  actions.appendChild(downSectionBtn)

  const delSectionBtn = document.createElement("button")
  delSectionBtn.type = "button"
  delSectionBtn.textContent = "删段落"
  delSectionBtn.className = "danger"
  delSectionBtn.addEventListener("click", () => {
    mutate(() => {
      if (store.project.sections.length <= 1) {
        store.project.sections = [
          createSection("歌词", [createSentence([4, 4])]),
        ]
        return
      }
      store.project.sections = store.project.sections.filter((s) => s.id !== section.id)
    })
    store.ensureCursor()
    render()
    setStatus("已删段落")
  })
  actions.appendChild(delSectionBtn)

  header.appendChild(actions)
  root.appendChild(header)

  let indexBase = 0
  for (let i = 0; i < sectionIdx; i++) {
    indexBase += store.project.sections[i].sentences.length
  }

  section.sentences.forEach((sentence, i) => {
    root.appendChild(renderSentence(sentence, indexBase + i))
  })

  const addInline = document.createElement("button")
  addInline.type = "button"
  addInline.textContent = "+ 新增一句"
  addInline.className = "add-sentence-inline"
  addInline.addEventListener("click", () => addSentenceToSection(section.id))
  root.appendChild(addInline)

  return root
}

function addSentenceToSection(sectionId: string): void {
  try {
    const pattern = parsePattern(newPatternEl.value)
    newPatternEl.classList.remove("invalid")
    mutate(() => {
      const section = store.project.sections.find((s) => s.id === sectionId)
      if (!section) return
      const sentence = createSentence(pattern)
      section.sentences.push(sentence)
      store.cursor = { sentenceId: sentence.id, cell: 0 }
    })
    setStatus("已加句")
    focusCellInput()
  } catch (err) {
    newPatternEl.classList.add("invalid")
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
}

function addSectionAfter(sectionId: string): void {
  mutate(() => {
    const index = store.project.sections.findIndex((s) => s.id === sectionId)
    const section = createSection(
      `段落 ${store.project.sections.length + 1}`,
      [createSentence([4, 4])],
    )
    store.project.sections.splice(index < 0 ? store.project.sections.length : index + 1, 0, section)
    store.cursor = { sentenceId: section.sentences[0].id, cell: 0 }
  })
  setStatus("已加段落")
  focusCellInput()
}

function moveSectionBy(sectionId: string, dir: -1 | 1): void {
  const index = store.project.sections.findIndex((s) => s.id === sectionId)
  const target = index + dir
  if (index < 0 || target < 0 || target >= store.project.sections.length) return
  mutate(() => {
    moveSection(store.project, sectionId, dir)
  })
  setStatus(dir < 0 ? "段落已上移" : "段落已下移")
}

function renderSentence(sentence: Sentence, index: number): HTMLElement {
  const isActive = sentence.id === store.cursor.sentenceId
  const root = document.createElement("article")
  root.className = `sentence${isActive ? " active" : ""}`
  root.dataset.id = sentence.id

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement
    if (target.closest("input, button, select, textarea")) return
    if (store.cursor.sentenceId === sentence.id) {
      focusCellInput()
      return
    }
    store.cursor = { sentenceId: sentence.id, cell: 0 }
    render()
    focusCellInput()
  })

  const cells = getCells(sentence)

  const row = document.createElement("div")
  row.className = "sentence-row"

  const side = document.createElement("div")
  side.className = "sentence-side"

  const indexEl = document.createElement("span")
  indexEl.className = "sentence-index"
  indexEl.textContent = String(index + 1)
  side.appendChild(indexEl)

  const patternInput = document.createElement("input")
  patternInput.className = "pattern-input sentence-pattern"
  patternInput.value = patternToString(sentence.pattern)
  patternInput.spellcheck = false
  patternInput.addEventListener("change", () => {
    try {
      const pattern = parsePattern(patternInput.value)
      patternInput.classList.remove("invalid")
      mutate(() => {
        const target = store.findSentence(sentence.id)
        if (target) setPattern(target, pattern)
      })
    } catch (err) {
      patternInput.classList.add("invalid")
      setStatus(err instanceof Error ? err.message : String(err), true)
    }
  })
  side.appendChild(patternInput)
  row.appendChild(side)

  const meta = document.createElement("div")
  meta.className = "sentence-meta"

  const noteInput = document.createElement("input")
  noteInput.className = "sentence-note"
  noteInput.placeholder = "备注"
  noteInput.title = "备注（不占格子，导出时可选带上）"
  noteInput.value = sentence.note
  noteInput.addEventListener("change", () => {
    mutate(() => {
      const target = store.findSentence(sentence.id)
      if (target) target.note = noteInput.value
    })
  })


  const altCombo = document.createElement("span")
  altCombo.className = "alt-combo"

  const altSelect = document.createElement("select")
  altSelect.className = "alt-select"
  sentence.alternatives.forEach((alt, i) => {
    const opt = document.createElement("option")
    opt.value = String(i)
    opt.textContent = alt.name
    if (i === sentence.activeAlt) opt.selected = true
    altSelect.appendChild(opt)
  })
  altSelect.addEventListener("change", () => {
    mutate(() => {
      const target = store.findSentence(sentence.id)
      if (target) switchAlternative(target, Number(altSelect.value))
    })
  })
  altCombo.appendChild(altSelect)

  const addAltBtn = document.createElement("button")
  addAltBtn.type = "button"
  addAltBtn.className = "alt-add"
  addAltBtn.textContent = "+"
  addAltBtn.title = "新增备选"
  addAltBtn.addEventListener("click", () => {
    mutate(() => {
      const target = store.findSentence(sentence.id)
      if (target) addAlternative(target)
    })
  })
  altCombo.appendChild(addAltBtn)

  const controls = document.createElement("div")
  controls.className = "sentence-controls"

  const copyBtn = document.createElement("button")
  copyBtn.type = "button"
  copyBtn.textContent = "复制句"
  copyBtn.title = "复制这句歌词到剪贴板"
  copyBtn.addEventListener("click", () => void copySentence(sentence.id))
  controls.appendChild(copyBtn)

  const pasteBtn = document.createElement("button")
  pasteBtn.type = "button"
  pasteBtn.textContent = "粘贴句"
  pasteBtn.title = "用剪贴板文字覆盖这句，多余字截断"
  pasteBtn.addEventListener("click", () => void pasteSentence(sentence.id))
  controls.appendChild(pasteBtn)

  const addCellBtn = document.createElement("button")
  addCellBtn.type = "button"
  addCellBtn.textContent = "+"
  addCellBtn.title = "光标所在分句加一格"
  addCellBtn.addEventListener("click", () => {
    if (!isActive) store.cursor = { sentenceId: sentence.id, cell: 0 }
    mutate(() => {
      const target = store.findSentence(sentence.id)
      if (!target) return
      const result = addCellAt(target.pattern, getCells(target), store.cursor.cell)
      setPattern(target, result.pattern)
      setCells(target, result.cells)
      store.cursor.cell = result.cursor
    })
  })
  controls.appendChild(addCellBtn)

  const removeCellBtn = document.createElement("button")
  removeCellBtn.type = "button"
  removeCellBtn.textContent = "-"
  removeCellBtn.title = "删除光标所在格（仅当前分句）"
  removeCellBtn.addEventListener("click", () => {
    if (!isActive) store.cursor = { sentenceId: sentence.id, cell: 0 }
    mutate(() => {
      const target = store.findSentence(sentence.id)
      if (!target) return
      const result = removeCellAt(target.pattern, getCells(target), store.cursor.cell)
      if (!result) {
        setStatus("每个分句至少保留 1 格", true)
        return
      }
      setPattern(target, result.pattern)
      setCells(target, result.cells)
      store.cursor.cell = result.cursor
      setStatus("已删格")
    })
  })
  controls.appendChild(removeCellBtn)

  const shiftLeftBtn = document.createElement("button")
  shiftLeftBtn.type = "button"
  shiftLeftBtn.textContent = "←"
  shiftLeftBtn.title = "整句左移一格 (Alt+←)"
  shiftLeftBtn.addEventListener("click", () => doShift(sentence.id, -1))
  controls.appendChild(shiftLeftBtn)

  const shiftRightBtn = document.createElement("button")
  shiftRightBtn.type = "button"
  shiftRightBtn.textContent = "→"
  shiftRightBtn.title = "整句右移一格 (Alt+→)"
  shiftRightBtn.addEventListener("click", () => doShift(sentence.id, 1))
  controls.appendChild(shiftRightBtn)

  const delBtn = document.createElement("button")
  delBtn.type = "button"
  delBtn.textContent = "删句"
  delBtn.className = "danger"
  delBtn.addEventListener("click", () => {
    mutate(() => {
      const section = findSectionBySentence(store.project, sentence.id)
      if (!section) return
      if (allSentences(store.project).length <= 1) {
        store.project.sections = [
          createSection("歌词", [createSentence([4, 4])]),
        ]
        return
      }
      section.sentences = section.sentences.filter((s) => s.id !== sentence.id)
      if (section.sentences.length === 0 && store.project.sections.length > 1) {
        store.project.sections = store.project.sections.filter((s) => s.id !== section.id)
      }
    })
    store.ensureCursor()
    render()
    focusCellInput()
    setStatus("已删句")
  })
  controls.appendChild(delBtn)

  const grid = document.createElement("div")
  grid.className = "grid"
  let cellIdx = 0

  sentence.pattern.forEach((size, g) => {
    if (g > 0) {
      const gap = document.createElement("span")
      gap.className = "group-gap"
      grid.appendChild(gap)
    }
    const groupEl = document.createElement("div")
    groupEl.className = "group"
    for (let o = 0; o < size; o++) {
      const i = cellIdx
      cellIdx += 1
      if (isActive && i === store.cursor.cell) {
        const input = document.createElement("input")
        input.className = "cell-input"
        input.dataset.sentenceId = sentence.id
        input.dataset.index = String(i)
        const base = cells[i] ?? ""
        input.value = base
        input.dataset.base = base
        input.autocomplete = "off"
        input.spellcheck = false
        bindCellInput(input, sentence.id, i)
        groupEl.appendChild(input)
      } else {
        const cell = document.createElement("button")
        cell.type = "button"
        cell.className = `cell${cells[i] ? "" : " empty"}`
        cell.textContent = cells[i]
        cell.dataset.sentenceId = sentence.id
        cell.dataset.index = String(i)
        cell.addEventListener("click", () => {
          store.cursor = { sentenceId: sentence.id, cell: i }
          render()
          focusCellInput()
        })
        groupEl.appendChild(cell)
      }
    }
    grid.appendChild(groupEl)
  })

  row.appendChild(grid)

  const sideRight = document.createElement("div")
  sideRight.className = "sentence-side-right"

  const rhyme = rhymeOfCells(cells)
  if (rhyme) {
    const ended = isEndingFilled(cells)
    const badge = document.createElement("span")
    badge.className = ended ? "rhyme-badge" : "rhyme-badge pending"
    badge.textContent = rhyme.label.replace(/辙$/, "")
    badge.title = ended
      ? `韵脚「${rhyme.char}」· 韵母 ${rhyme.final} · ${rhyme.label}`
      : `韵脚「${rhyme.char}」· 韵母 ${rhyme.final} · ${rhyme.label}（句尾未填，暂不统计）`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(rhyme.key)))
    sideRight.appendChild(badge)
  }

  const filled = cells.filter((char) => char.trim() !== "").length
  const progress = document.createElement("span")
  progress.className = "sentence-progress"
  progress.textContent = `${filled}/${cells.length}`
  sideRight.appendChild(progress)

  row.appendChild(sideRight)

  meta.append(altCombo, noteInput, controls)
  root.appendChild(meta)

  root.appendChild(row)

  return root
}

function focusCellInput(): void {
  const input = sentencesEl.querySelector<HTMLInputElement>("input.cell-input")
  if (input) {
    input.focus()
    const len = input.value.length
    input.setSelectionRange(len, len)
  }
}

function moveCursorToFlatIndex(currentId: string, nextFlat: number): void {
  const next = sentenceAt(store.project, nextFlat)
  if (!next) return
  const currentIdx = sentenceIndex(store.project, currentId)
  const current = sentenceAt(store.project, currentIdx)
  const nextCell = current
    ? Math.min(store.cursor.cell, totalCells(next.pattern) - 1)
    : 0
  store.cursor = { sentenceId: next.id, cell: nextCell }
  render()
  focusCellInput()
}

function bindCellInput(input: HTMLInputElement, sentenceId: string, index: number): void {
  input.addEventListener("focus", () => {
    store.cursor = { sentenceId, cell: index }
  })

  input.addEventListener("compositionstart", () => {
    composing = true
  })

  input.addEventListener("compositionend", () => {
    composing = false
    input.style.width = ""
    commitInput(input)
  })

  input.addEventListener("blur", () => {
    input.style.width = ""
  })

  input.addEventListener("input", () => {
    if (composing) {
      const len = input.value.length
      input.style.width = len > 1 ? `${Math.max(54, (len + 1) * 16)}px` : ""
      return
    }
    commitInput(input)
  })

  input.addEventListener("keydown", (e) => {
    if (composing) return

    if (e.key === "Backspace") {
      e.preventDefault()
      if (input.value.length > 0) {
        mutate(() => {
          const s = store.findSentence(sentenceId)
          if (!s) return
          setCells(s, clearCell(getCells(s), store.cursor.cell))
        })
        focusCellInput()
        return
      }
      const sentence = store.findSentence(sentenceId)
      if (!sentence) return
      const target = store.cursor.cell - 1
      if (target < 0) return
      mutate(() => {
        const s = store.findSentence(sentenceId)
        if (!s) return
        setCells(s, clearCell(getCells(s), target))
        store.cursor.cell = target
      })
      focusCellInput()
      return
    }

    if (e.key === "Delete") {
      e.preventDefault()
      mutate(() => {
        const s = store.findSentence(sentenceId)
        if (!s) return
        setCells(s, clearCell(getCells(s), store.cursor.cell))
      })
      focusCellInput()
      return
    }

    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault()
      doShift(sentenceId, -1)
      return
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault()
      doShift(sentenceId, 1)
      return
    }

    if (e.key === "ArrowLeft" && !e.shiftKey) {
      e.preventDefault()
      if (store.cursor.cell > 0) {
        store.cursor.cell -= 1
        render()
        focusCellInput()
      }
      return
    }
    if (e.key === "ArrowRight" && !e.shiftKey) {
      e.preventDefault()
      const s = store.findSentence(sentenceId)
      if (!s) return
      if (store.cursor.cell < totalCells(s.pattern) - 1) {
        store.cursor.cell += 1
        render()
        focusCellInput()
      }
      return
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const idx = sentenceIndex(store.project, sentenceId)
      const nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1
      moveCursorToFlatIndex(sentenceId, nextIdx)
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      const idx = sentenceIndex(store.project, sentenceId)
      moveCursorToFlatIndex(sentenceId, idx + 1)
    }
  })
}

function commitInput(input: HTMLInputElement): void {
  const base = input.dataset.base ?? ""
  const raw = input.value
  if (!raw) {
    input.value = base
    return
  }
  if (base && raw === base) return
  const text = base ? raw.replace(base, "") : raw
  if (!text) {
    input.value = base
    return
  }
  const sentenceId = input.dataset.sentenceId ?? ""
  const start = store.cursor.cell
  input.value = ""

  const sentence = store.findSentence(sentenceId)
  if (!sentence) return

  store.pushUndo()
  const result = writeChars(getCells(sentence), start, text)
  setCells(sentence, result.cells)
  store.cursor.cell = Math.min(start + result.written, totalCells(sentence.pattern) - 1)
  store.touch()
  render()
  focusCellInput()

  const total = totalCells(sentence.pattern)
  if (start + result.written >= total && countRaw(text) > result.written) {
    setStatus("已写到词格末尾，多余字未写入", true)
  } else {
    setStatus("已填入")
  }
}

function countRaw(text: string): number {
  let n = 0
  for (const _ch of text) n += 1
  return n
}

function doShift(sentenceId: string, dir: -1 | 1): void {
  const sentence = store.findSentence(sentenceId)
  if (!sentence) return
  const next = shiftSentence(getCells(sentence), dir)
  if (!next) {
    setStatus(dir === -1 ? "左移会挤出词格，已拦住" : "右移会挤出词格，已拦住", true)
    return
  }
  store.pushUndo()
  setCells(sentence, next)
  store.touch()
  render()
  if (sentence.id === store.cursor.sentenceId) focusCellInput()
  setStatus("整句已挪动")
}

async function copySentence(sentenceId: string): Promise<void> {
  const sentence = store.findSentence(sentenceId)
  if (!sentence) return
  const ok = await copyText(sentenceLine(sentence))
  setStatus(ok ? "已复制该句" : "复制失败", !ok)
}

async function pasteSentence(sentenceId: string): Promise<void> {
  const text = await readClipboardText()
  if (text === null) {
    setStatus("读取剪贴板失败", true)
    return
  }
  const chars = Array.from(text.replace(/\s+/gu, ""))
  if (chars.length === 0) {
    setStatus("剪贴板没有可用文字", true)
    return
  }
  const sentence = store.findSentence(sentenceId)
  if (!sentence) return
  const total = totalCells(sentence.pattern)
  const written = Math.min(chars.length, total)
  const cells = getCells(sentence).slice()
  for (let i = 0; i < written; i++) cells[i] = chars[i]
  store.pushUndo()
  setCells(sentence, cells)
  store.cursor = { sentenceId, cell: Math.max(0, written - 1) }
  store.touch()
  render()
  focusCellInput()
  setStatus(chars.length > written ? "已粘贴，多余字未写入" : "已粘贴该句")
}

async function copyLyrics(): Promise<void> {
  const ok = await copyText(exportLyrics(store.project))
  setStatus(ok ? "已复制歌词到剪贴板" : "复制失败", !ok)
}

async function saveProject(saveAs: boolean): Promise<void> {
  try {
    let path = store.filePath
    if (saveAs || !path) {
      const chosen = await saveFileDialog({
        filters: [{ name: "词格工程", extensions: ["json"] }],
        defaultPath: path ?? `${store.project.title || "未命名"}.json`,
      })
      if (!chosen) return
      path = chosen
    }
    store.project.updatedAt = new Date().toISOString()
    await writeTextFile(path, JSON.stringify(store.project, null, 2))
    store.filePath = path
    store.markSaved()
    store.persist()
    renderStatusBar()
    setStatus("已保存工程")
  } catch (err) {
    setStatus(`保存失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function openProject(): Promise<void> {
  try {
    const chosen = await openFileDialog({
      multiple: false,
      filters: [{ name: "词格工程", extensions: ["json"] }],
    })
    if (!chosen || Array.isArray(chosen)) return
    const raw = await readTextFile(chosen)
    const project = parseProject(raw)
    store.pushUndo()
    store.project = project
    store.filePath = chosen
    const first = allSentences(project)[0]
    store.cursor = { sentenceId: first?.id ?? "", cell: 0 }
    store.ensureCursor()
    store.markSaved()
    store.persist()
    render()
    setStatus("已打开工程")
  } catch (err) {
    setStatus(`打开失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function exportText(): Promise<void> {
  try {
    const chosen = await saveFileDialog({
      filters: [{ name: "歌词文本", extensions: ["txt"] }],
      defaultPath: `${store.project.title || "歌词"}.txt`,
    })
    if (!chosen) return
    await writeTextFile(chosen, exportLyrics(store.project))
    setStatus("已导出歌词")
  } catch (err) {
    setStatus(`导出失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

function applyLyricsText(
  text: string,
  fileTitle?: string,
  merge = false,
  fillLyrics = true,
): boolean {
  try {
    const parsed = parseLyrics(text)
    const total = parsed.sections.reduce((n, section) => n + section.lines.length, 0)
    if (total === 0) {
      setStatus("没有识别到歌词行", true)
      return false
    }
    mutate(() => {
      const imported = parsed.sections.map((section, i) => {
        const sentences = section.lines.map((line) => {
          const sentence = createSentence(line.pattern)
          if (fillLyrics) {
            setCells(sentence, line.cells)
            for (const altCells of line.alts) {
              addAlternative(sentence)
              setCells(sentence, altCells)
            }
            switchAlternative(sentence, 0)
            if (line.note) sentence.note = line.note
          }
          return sentence
        })
        const name =
          section.name || (parsed.sections.length === 1 ? "导入" : `导入 ${i + 1}`)
        return createSection(name, sentences)
      })
      if (merge) {
        store.project.sections.push(...imported)
      } else {
        store.project.sections = imported
      }
      const first = imported[0]?.sentences[0]
      if (first) store.cursor = { sentenceId: first.id, cell: 0 }
      const title = parsed.title || fileTitle
      if (title && !merge) {
        store.project.title = title
        titleEl.value = title
      }
    })
    setStatus(merge ? `已合并 ${total} 句歌词` : `已导入 ${total} 句歌词`)
    return true
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
    return false
  }
}

function openImportDialog(): void {
  const dialog = document.createElement("dialog")
  dialog.innerHTML = `
    <form method="dialog" class="dialog-body">
      <button class="dialog-close" value="cancel" type="submit" title="关闭" aria-label="关闭">×</button>
      <strong>导入歌词</strong>
      <p>每行一句，空格分组，空行分段。支持《标题》、[段落名]、行尾（备注）、<code>|</code> 分隔备选、纯数字行只生成词格。例：<code>真的 假的 啊</code> → 2/2/1。可直接粘贴、从剪贴板读入，或选择 .txt / .lrc / .md 文件。</p>
      <textarea placeholder="《歌名》&#10;[Verse]&#10;真的 假的（温柔）|真的啊"></textarea>
      <div class="dialog-radios">
        <label><input type="radio" name="import-mode" value="lyrics" checked /> 同时导入歌词</label>
        <label><input type="radio" name="import-mode" value="grid" /> 仅词格</label>
      </div>
      <label class="dialog-check">
        <input type="checkbox" id="import-merge" />
        合并到现有歌词（不覆盖）
      </label>
      <div class="dialog-actions">
        <button value="clip" type="submit">从剪贴板</button>
        <button value="file" type="submit">选择文件…</button>
        <button value="ok" type="submit">导入</button>
      </div>
    </form>
  `
  document.body.appendChild(dialog)
  const textarea = dialog.querySelector("textarea")!
  const mergeInput = dialog.querySelector<HTMLInputElement>("#import-merge")!
  const modeInputs = Array.from(
    dialog.querySelectorAll<HTMLInputElement>('input[name="import-mode"]'),
  )
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    if (action === "file") {
      void pickLyricsFileInto(textarea).then(() => {
        dialog.showModal()
      })
      return
    }
    if (action === "clip") {
      void readClipboardText().then((text) => {
        if (text === null) {
          setStatus("读取剪贴板失败", true)
        } else {
          textarea.value = text
          delete textarea.dataset.fileTitle
          setStatus("已从剪贴板读入")
        }
        dialog.showModal()
      })
      return
    }
    const merge = mergeInput.checked
    const fillLyrics = modeInputs.find((el) => el.checked)?.value !== "grid"
    dialog.remove()
    if (action === "ok") {
      applyLyricsText(textarea.value, textarea.dataset.fileTitle, merge, fillLyrics)
    }
  })
  dialog.showModal()
  textarea.focus()
}

async function pickLyricsFileInto(textarea: HTMLTextAreaElement): Promise<void> {
  try {
    const chosen = await openFileDialog({
      multiple: false,
      filters: [
        { name: "歌词文本", extensions: ["txt", "lrc", "md", "text"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (!chosen || Array.isArray(chosen)) return
    const raw = await readTextFile(chosen)
    textarea.value = raw
    textarea.dataset.filePath = chosen
    const base = chosen.split("/").pop() ?? ""
    const title = base.replace(/\.(txt|lrc|md|text)$/i, "")
    if (title) textarea.dataset.fileTitle = title
    setStatus(`已读入 ${base}，确认后点「导入」`)
  } catch (err) {
    setStatus(`读取失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

function refreshThemeButton(): void {
  themeBtn.textContent = themeIcon(themeState.pref)
  themeBtn.title = `主题：${themeLabel(themeState.pref)}（点击切换）`
  themeBtn.setAttribute("aria-label", themeBtn.title)
}

function bindToolbar(): void {
  titleEl.addEventListener("change", () => {
    mutate(() => {
      store.project.title = titleEl.value
    })
  })

  document.querySelector("#btn-add-sentence")?.addEventListener("click", () => {
    const sectionId =
      findSectionBySentence(store.project, store.cursor.sentenceId)?.id ??
      store.project.sections[0]?.id
    if (sectionId) addSentenceToSection(sectionId)
  })

  document.querySelector("#btn-import-lyrics")?.addEventListener("click", openImportDialog)
  document.querySelector("#btn-save")?.addEventListener("click", () => void saveProject(false))
  document.querySelector("#btn-save-as")?.addEventListener("click", () => void saveProject(true))
  document.querySelector("#btn-open")?.addEventListener("click", () => void openProject())
  document.querySelector("#btn-export")?.addEventListener("click", () => void exportText())
  document.querySelector("#btn-copy-lyrics")?.addEventListener("click", () => void copyLyrics())
  undoBtn.addEventListener("click", doUndo)
  redoBtn.addEventListener("click", doRedo)

  themeBtn.addEventListener("click", () => {
    cycleTheme()
    refreshThemeButton()
    setStatus(`主题：${themeLabel(themeState.pref)}`)
  })

  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === "s") {
      e.preventDefault()
      void saveProject(e.shiftKey)
      return
    }
    if (key === "z") {
      e.preventDefault()
      if (e.shiftKey) doRedo()
      else doUndo()
      return
    }
    if (key === "y" && e.ctrlKey) {
      e.preventDefault()
      doRedo()
    }
  })
}

function doUndo(): void {
  if (!store.undo()) {
    setStatus("没有可撤销的操作", true)
    return
  }
  render()
  focusCellInput()
  setStatus("已撤销")
}

function doRedo(): void {
  if (!store.redo()) {
    setStatus("没有可重做的操作", true)
    return
  }
  render()
  focusCellInput()
  setStatus("已重做")
}

initTheme()
refreshThemeButton()
onAutosave(() => renderStatusBar())
bindToolbar()
render()
focusCellInput()

export type { Project }
