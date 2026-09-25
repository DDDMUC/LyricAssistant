import { copyText, readClipboardText } from "./clipboard"
import {
  canOverwriteInPlace,
  isDesktop,
  onFileDrop,
  pickFile,
  saveBytes,
  saveText,
  type FileSource,
  type SavedFile,
} from "./platform"
import {
  EFFORT_LEVELS,
  loadAiSettings,
  maxTokensFor,
  modelLabel,
  requestChat,
  resolveTarget,
  saveAiSettings,
  supportsEffortFor,
  testAiConnection,
  type AiProvider,
  type ChatMessage,
} from "./ai-client"
import {
  applyAiResults,
  buildBrief,
  buildChatSystemPrompt,
  buildFixPrompt,
  buildSystemPrompt,
  parseAiSentences,
  previewAiResults,
  sentencePlace,
  splitByPattern,
  validateAiResults,
  type AiIssue,
  type AiSentenceResult,
} from "./model/ai"
import {
  addCellAt,
  clearCell,
  removeCellAt,
  shiftSentence,
  splitOrMergePattern,
  writeChars,
} from "./model/grid"
import {
  buildDocsBackup,
  createDoc,
  createDocFrom,
  loadDocs,
  parseDocsBackup,
  saveDocs,
  type DocRecord,
} from "./docs"
import { parseLyrics } from "./model/lyrics"
import {
  KEYSWITCH,
  buildLyricMidi,
  keyswitchCount,
  midiToSections,
  noteTracks,
  parseMidi,
  pickMelodyTrack,
  type MidiFile,
  type MidiSection,
} from "./model/midi"
import { parsePattern, patternToString, totalCells } from "./model/pattern"
import {
  RHYME_LABEL_BY_KEY,
  charFitsRhyme,
  isEndingFilled,
  isHanChar,
  rhymeHue,
  rhymeOfCells,
} from "./model/rhyme"
import type { Project, Section, Sentence } from "./model/types"
import type { ExportOptions } from "./state"
import {
  autosaveState,
  Store,
  addAlternative,
  applyImportedCredits,
  applyImportedTitle,
  applyImportedSource,
  allSentences,
  createProject,
  createSection,
  createSentence,
  exportGrid,
  exportLyrics,
  findSectionBySentence,
  getCells,
  markAutosaved,
  moveSection,
  onAutosave,
  onAutosaveWrite,
  parseProject,
  reflowOverflow,
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
const scrollProgressEl = document.querySelector("#scroll-progress") as HTMLElement
const titleEl = document.querySelector("#project-title") as HTMLInputElement
const newPatternEl = document.querySelector("#new-pattern") as HTMLInputElement
const statusStatsEl = document.querySelector("#status-stats") as HTMLElement
const statusHintEl = document.querySelector("#status-hint") as HTMLElement
const statusPathEl = document.querySelector("#status-path") as HTMLElement
const statusAutosaveEl = document.querySelector("#status-autosave") as HTMLElement
const statusRhymeEl = document.querySelector("#status-rhyme") as HTMLElement
const themeBtn = document.querySelector("#btn-theme") as HTMLButtonElement
const docListEl = document.querySelector("#doc-list") as HTMLElement
const newDocBtn = document.querySelector("#btn-new-doc") as HTMLButtonElement
const resizerEl = document.querySelector("#sidebar-resizer") as HTMLElement
const reflowBtn = document.querySelector("#btn-reflow") as HTMLButtonElement
const creditsBtn = document.querySelector("#btn-credits") as HTMLButtonElement
const sourceBtn = document.querySelector("#btn-source") as HTMLButtonElement
const sourcePanel = document.querySelector("#source-panel") as HTMLElement
const sourceTextEl = document.querySelector("#source-text") as HTMLTextAreaElement
const sourceCloseBtn = document.querySelector("#btn-source-close") as HTMLButtonElement
const editorActionsEl = document.querySelector("#editor-actions") as HTMLElement

const sidebarToggleBtns = ["#btn-sidebar", "#btn-sidebar-expand"]
  .map((selector) => document.querySelector(selector))
  .filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
const undoBtn = document.querySelector("#btn-undo") as HTMLButtonElement
const redoBtn = document.querySelector("#btn-redo") as HTMLButtonElement
const clearAllBtn = document.querySelector("#btn-clear-all") as HTMLButtonElement
const btnAi = document.querySelector("#btn-ai") as HTMLButtonElement
const aiPanel = document.querySelector("#ai-panel") as HTMLElement
const aiResizer = document.querySelector("#ai-resizer") as HTMLElement
const aiMessagesEl = document.querySelector("#ai-messages") as HTMLElement
const aiInput = document.querySelector("#ai-input") as HTMLTextAreaElement
const aiScopeChip = document.querySelector("#ai-scope-chip") as HTMLButtonElement
const aiModelChip = document.querySelector("#ai-model-chip") as HTMLButtonElement
const aiEffortChip = document.querySelector("#ai-effort-chip") as HTMLButtonElement
const btnAiSend = document.querySelector("#btn-ai-send") as HTMLButtonElement
const aiHint = document.querySelector("#ai-hint") as HTMLElement

let composing = false
// 组字刚结束置 true：紧接着的第一次 Backspace 原地不动、什么都不做，
// 避免删光拼音后连打删除键把前一格的字一起带走
let imeJustEnded = false
let statusOverride: { text: string; isError: boolean } | null = null
let statusOverrideTimer: ReturnType<typeof setTimeout> | null = null

let selection: { from: { sentenceId: string; cell: number }; to: { sentenceId: string; cell: number } } | null = null
let dragStart: { sentenceId: string; index: number; moved: boolean } | null = null
let justDragged = false
let midiSession: {
  file: MidiFile
  trackIndex: number
  offset: number
  sections: MidiSection[]
  skipPitches: number[]
} | null = null

const docsState = loadDocs()
const saveTargets = new Map<string, SavedFile>()
const initialDoc = docsState.docs.find((doc) => doc.id === docsState.activeId)
const store = new Store(initialDoc ? initialDoc.project : createProject())
if (initialDoc?.filePath) store.filePath = initialDoc.filePath

function updateScrollProgress(): void {
  const max = document.documentElement.scrollHeight - window.innerHeight
  const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  scrollProgressEl.style.transform = `scaleX(${ratio})`
}

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
  if (store.filePath) {
    statusPathEl.textContent = store.dirty ? `● ${store.filePath}` : store.filePath
    statusPathEl.classList.toggle("dirty", store.dirty)
    return
  }
  statusPathEl.textContent = isDesktop()
    ? "草稿自动保存中 · 尚未保存为工程文件"
    : canOverwriteInPlace()
      ? "网页版 · 草稿自动保存中（保存可直接覆盖）"
      : "网页版 · 草稿自动保存中（保存=下载文件）"
  statusPathEl.classList.remove("dirty")
}

function renderStatusBar(): void {
  const stats =
    docsState.docs.length === 0
      ? { filled: 0, total: 0, sentences: 0, sections: 0, percent: 0, overflow: 0 }
      : statsOf(store.project)
  statusStatsEl.textContent =
    `已填 ${stats.filled} / ${stats.total} 格 · 完成 ${stats.percent}% · ` +
    `句数 ${stats.sentences} · 段落 ${stats.sections}` +
    (stats.overflow > 0 ? ` · 溢出 ${stats.overflow} 字` : "")
  reflowBtn.hidden = stats.overflow === 0
  creditsBtn.hidden = (store.project.credits ?? []).length === 0

  if (statusOverride) {
    statusHintEl.textContent = statusOverride.text
    statusHintEl.classList.toggle("error", statusOverride.isError)
  } else {
    statusHintEl.textContent =
      "点格子输入 · Backspace 删当前格 · Alt+←/→ 整句挪动 · Ctrl/Cmd+S 保存 · Ctrl/Cmd+Z 撤销 · Shift+Cmd+Z 重做"
    statusHintEl.classList.remove("error")
  }

  undoBtn.disabled = !store.canUndo()
  redoBtn.disabled = !store.canRedo()

  statusRhymeEl.textContent = rhymeSummaryText()

  updatePathStatus()
  statusAutosaveEl.textContent = autosaveState.at
    ? `已自动保存 ${autosaveState.at}`
    : "自动保存已开启"
  document.title = `${store.dirty ? "● " : ""}${store.project.title || "未命名"} · 作词助手`
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

function persistDocs(): void {
  saveDocs(docsState)
  markAutosaved()
}

function syncActiveDoc(): void {
  const doc = docsState.docs.find((d) => d.id === docsState.activeId)
  if (!doc) return
  doc.project = store.project
  doc.filePath = store.filePath
  doc.updatedAt = store.project.updatedAt
  persistDocs()
}

function renderDocList(): void {
  docListEl.replaceChildren()
  docsState.docs.forEach((doc) => {
    const item = document.createElement("div")
    item.className = `doc-item${doc.id === docsState.activeId ? " active" : ""}`
    item.title = doc.filePath ?? "未保存到文件"

    const title = document.createElement("span")
    title.className = "doc-title"
    title.textContent = doc.project.title || "未命名"
    title.title = "双击重命名"
    title.addEventListener("dblclick", (event) => {
      event.stopPropagation()
      startRenameDoc(doc, item, title)
    })
    item.appendChild(title)

    const stats = statsOf(doc.project)
    const meta = document.createElement("span")
    meta.className = "doc-meta"
    meta.textContent = `${stats.sentences} 句`
    item.appendChild(meta)

    const del = document.createElement("button")
    del.type = "button"
    del.className = "doc-del"
    del.textContent = "×"
    del.title = "删除这个歌词文件"
    del.addEventListener("click", (event) => {
      event.stopPropagation()
      deleteDoc(doc.id)
    })
    item.appendChild(del)

    item.addEventListener("click", () => switchDoc(doc.id))
    docListEl.appendChild(item)
  })
}

function renameDoc(docId: string, rawName: string): void {
  const doc = docsState.docs.find((item) => item.id === docId)
  if (!doc) return
  const name = rawName.trim() || doc.project.title || "未命名"
  if (name === doc.project.title) {
    renderDocList()
    return
  }
  if (docId === docsState.activeId) {
    mutate(() => {
      store.project.title = name
    })
  } else {
    doc.project.title = name
    doc.updatedAt = new Date().toISOString()
    persistDocs()
    renderDocList()
  }
  setStatus(`已重命名为「${name}」`)
}

function startRenameDoc(doc: DocRecord, item: HTMLElement, label: HTMLElement): void {
  const input = document.createElement("input")
  input.className = "doc-rename-input"
  input.value = doc.project.title
  input.spellcheck = false
  item.replaceChild(input, label)
  input.focus()
  input.select()

  let done = false
  const commit = (save: boolean): void => {
    if (done) return
    done = true
    if (save) renameDoc(doc.id, input.value)
    else renderDocList()
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit(true)
    } else if (event.key === "Escape") {
      event.preventDefault()
      commit(false)
    }
  })
  input.addEventListener("blur", () => commit(true))
  input.addEventListener("click", (event) => event.stopPropagation())
  input.addEventListener("pointerdown", (event) => event.stopPropagation())
}

function activateDoc(doc: DocRecord): void {
  store.project = doc.project
  store.filePath = doc.filePath
  store.dirty = false
  store.undoStack = []
  store.redoStack = []
  const first = allSentences(doc.project)[0]
  store.cursor = { sentenceId: first?.id ?? "", cell: 0 }
  store.ensureCursor()
}

function switchDoc(id: string): void {
  if (id === docsState.activeId) return
  const target = docsState.docs.find((doc) => doc.id === id)
  if (!target) return
  syncActiveDoc()
  docsState.activeId = id
  activateDoc(target)
  persistDocs()
  render()
  focusCellInput()
  setStatus(`已切换到「${target.project.title || "未命名"}」`)
}

function addDoc(): void {
  syncActiveDoc()
  const doc = createDoc(`未命名 ${docsState.docs.length + 1}`)
  docsState.docs.push(doc)
  docsState.activeId = doc.id
  activateDoc(doc)
  persistDocs()
  render()
  titleEl.focus()
  titleEl.select()
  setStatus("已新建歌词文件")
}

function deleteDoc(id: string): void {
  const doc = docsState.docs.find((item) => item.id === id)
  if (!doc) return
  confirmDeleteDoc(id, doc.project.title || "未命名")
}

function confirmDeleteDoc(id: string, name: string): void {
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "删除歌词文件"

  const text = document.createElement("p")
  text.textContent = `确定删除「${name}」？删除后无法恢复。`

  const actions = document.createElement("div")
  actions.className = "dialog-actions"

  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"

  const ok = document.createElement("button")
  ok.type = "submit"
  ok.value = "ok"
  ok.textContent = "删除"
  ok.className = "danger"

  actions.append(cancel, ok)
  form.append(title, text, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    dialog.remove()
    if (action === "ok") performDeleteDoc(id, name)
  })
  dialog.showModal()
}

function resetStoreToEmpty(): void {
  store.project = createProject()
  store.filePath = null
  store.undoStack = []
  store.redoStack = []
  store.dirty = false
  store.cursor = { sentenceId: "", cell: 0 }
  docsState.activeId = ""
}

function performDeleteDoc(id: string, name: string): void {
  const index = docsState.docs.findIndex((doc) => doc.id === id)
  if (index < 0) return
  docsState.docs.splice(index, 1)
  if (docsState.activeId === id) {
    if (docsState.docs.length === 0) {
      resetStoreToEmpty()
    } else {
      const next = docsState.docs[Math.max(0, index - 1)]
      docsState.activeId = next.id
      activateDoc(next)
    }
    render()
    focusCellInput()
  } else {
    renderDocList()
  }
  persistDocs()
  setStatus(`已删除「${name}」`)
}

function openSourcePanel(): void {
  closeAiPanel()
  sourcePanel.hidden = false
  sourceTextEl.value = store.project.source ?? ""
}

function closeSourcePanel(): void {
  sourcePanel.hidden = true
}

function syncSourcePanel(): void {
  const hasSource = !!store.project.source
  sourceBtn.hidden = !hasSource
  sourceTextEl.value = store.project.source ?? ""
  if (!hasSource) sourcePanel.hidden = true
}

function renderEmptyState(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "empty-state"

  const title = document.createElement("p")
  title.className = "empty-title"
  title.textContent = "还没有歌词"

  const hint = document.createElement("p")
  hint.className = "empty-hint"
  hint.textContent = "点「＋ 新建歌词」或「导入」开始"

  wrap.append(title, hint)
  return wrap
}

function render(): void {
  if (composing) return
  const prevScrollY = window.scrollY
  const empty = docsState.docs.length === 0
  if (empty) {
    titleEl.value = ""
    titleEl.disabled = true
  } else {
    titleEl.value = store.project.title
    titleEl.disabled = false
  }
  sentencesEl.replaceChildren()
  editorActionsEl.hidden = empty
  clearAllBtn.hidden = empty

  if (empty) {
    sentencesEl.appendChild(renderEmptyState())
  } else {
    store.project.sections.forEach((section, sectionIdx) => {
      sentencesEl.appendChild(renderSection(section, sectionIdx))
    })
  }

  renderStatusBar()
  renderDocList()
  syncSourcePanel()
  updateAiHint()
  if (selection && (!store.findSentence(selection.from.sentenceId) || !store.findSentence(selection.to.sentenceId))) {
    selection = null
  }
  paintSelection()
  // replaceChildren 会先清空容器，高度瞬间归零导致 scrollTop 被钳到 0，这里补回
  if (window.scrollY !== prevScrollY) window.scrollTo(0, prevScrollY)
  updateScrollProgress()
}

function clearSelection(): void {
  selection = null
  paintSelection()
}

function consumeJustDragged(): boolean {
  if (!justDragged) return false
  justDragged = false
  return true
}

function selectionSpans(): { sentence: Sentence; from: number; to: number }[] {
  if (!selection) return []
  const ordered = allSentences(store.project)
  const fromIndex = ordered.findIndex((s) => s.id === selection!.from.sentenceId)
  const toIndex = ordered.findIndex((s) => s.id === selection!.to.sentenceId)
  if (fromIndex < 0 || toIndex < 0) return []
  const spans: { sentence: Sentence; from: number; to: number }[] = []
  for (let i = fromIndex; i <= toIndex; i++) {
    const sentence = ordered[i]
    const total = totalCells(sentence.pattern)
    const from = i === fromIndex ? selection!.from.cell : 0
    const to = i === toIndex ? selection!.to.cell : total - 1
    const start = Math.max(0, from)
    const end = Math.min(total - 1, to)
    if (end >= start) spans.push({ sentence, from: start, to: end })
  }
  return spans
}

function setSelectionBetween(
  a: { sentenceId: string; cell: number },
  b: { sentenceId: string; cell: number },
): void {
  const ordered = allSentences(store.project)
  const ai = ordered.findIndex((s) => s.id === a.sentenceId)
  const bi = ordered.findIndex((s) => s.id === b.sentenceId)
  if (ai < 0 || bi < 0) return
  const forward = ai < bi || (ai === bi && a.cell <= b.cell)
  selection = forward ? { from: a, to: b } : { from: b, to: a }
}

function paintSelection(): void {
  document
    .querySelectorAll(".cell.selected, .cell-input.selected")
    .forEach((el) => el.classList.remove("selected"))
  for (const span of selectionSpans()) {
    const root = document.querySelector(`.sentence[data-id="${span.sentence.id}"]`)
    if (!root) continue
    root.querySelectorAll<HTMLElement>(".cell, .cell-input").forEach((el) => {
      const index = Number(el.dataset.index)
      if (index >= span.from && index <= span.to) el.classList.add("selected")
    })
  }
}

function removeSelectedCells(): void {
  const spans = selectionSpans()
  if (spans.length === 0) return
  clearSelection()
  mutate(() => {
    for (const span of spans) {
      const sentence = store.findSentence(span.sentence.id)
      if (!sentence) continue
      const cells = getCells(sentence).slice()
      for (let i = span.from; i <= span.to; i++) cells[i] = ""
      setCells(sentence, cells)
    }
  })
  focusCellInput()
  setStatus("已清空选中的格子")
}

async function copySelection(): Promise<void> {
  const spans = selectionSpans()
  if (spans.length === 0) return
  const text = spans
    .map((span) => getCells(span.sentence).slice(span.from, span.to + 1).filter(Boolean).join(""))
    .join("\n")
  const count = [...text.replace(/\n/g, "")].length
  const ok = await copyText(text)
  setStatus(ok ? `已复制 ${count} 个字` : "复制失败", !ok)
  clearSelection()
}

function bindSelection(): void {
  sentencesEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    const cell = (event.target as HTMLElement).closest<HTMLElement>(".cell, .cell-input")
    if (!cell) return
    justDragged = false
    dragStart = {
      sentenceId: cell.dataset.sentenceId ?? "",
      index: Number(cell.dataset.index),
      moved: false,
    }
  })

  document.addEventListener("pointermove", (event) => {
    if (!dragStart) return
    const el = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)
      ?.closest<HTMLElement>(".cell, .cell-input")
    if (!el) return
    const sentenceId = el.dataset.sentenceId ?? ""
    const index = Number(el.dataset.index)
    if (sentenceId === dragStart.sentenceId && index === dragStart.index && !dragStart.moved) return
    dragStart.moved = true
    window.getSelection()?.removeAllRanges()
    setSelectionBetween(
      { sentenceId: dragStart.sentenceId, cell: dragStart.index },
      { sentenceId, cell: index },
    )
    paintSelection()
  })

  document.addEventListener("pointerup", () => {
    if (!dragStart) return
    if (dragStart.moved) justDragged = true
    else clearSelection()
    dragStart = null
  })
  document.addEventListener("pointercancel", () => {
    dragStart = null
  })

  document.addEventListener(
    "keydown",
    (event) => {
      if (!selection) return
      if (event.key === "Escape") {
        event.preventDefault()
        clearSelection()
        return
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault()
        event.stopPropagation()
        removeSelectedCells()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault()
        event.stopPropagation()
        void copySelection()
      }
    },
    { capture: true },
  )
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

  const addHarmonyBtn = document.createElement("button")
  addHarmonyBtn.type = "button"
  addHarmonyBtn.textContent = "+ 和声"
  addHarmonyBtn.title = "在本段末尾加一句和声（与上一句同时唱的背景人声）"
  addHarmonyBtn.addEventListener("click", () => addHarmonyToSection(section.id))
  actions.appendChild(addHarmonyBtn)

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

  return root
}

function addSentenceAfter(sentenceId: string): void {
  try {
    const pattern = parsePattern(newPatternEl.value)
    newPatternEl.classList.remove("invalid")
    mutate(() => {
      const section = findSectionBySentence(store.project, sentenceId)
      if (!section) return
      const index = section.sentences.findIndex((s) => s.id === sentenceId)
      if (index < 0) return
      const sentence = createSentence(pattern)
      section.sentences.splice(index + 1, 0, sentence)
      store.cursor = { sentenceId: sentence.id, cell: 0 }
    })
    focusCellInput()
    setStatus("已加句")
  } catch (err) {
    newPatternEl.classList.add("invalid")
    setStatus(err instanceof Error ? err.message : String(err), true)
  }
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

function addHarmonyToSection(sectionId: string): void {
  const section = store.project.sections.find((s) => s.id === sectionId)
  if (!section) return
  const prev = section.sentences[section.sentences.length - 1]
  let pattern: number[]
  try {
    pattern = prev ? prev.pattern.slice() : parsePattern(newPatternEl.value)
    newPatternEl.classList.remove("invalid")
  } catch (err) {
    newPatternEl.classList.add("invalid")
    setStatus(err instanceof Error ? err.message : String(err), true)
    return
  }
  mutate(() => {
    const target = store.project.sections.find((s) => s.id === sectionId)
    if (!target) return
    const sentence = createSentence(pattern, "harmony")
    target.sentences.push(sentence)
    store.cursor = { sentenceId: sentence.id, cell: 0 }
  })
  setStatus("已加和声句")
  focusCellInput()
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
  const isHarmony = sentence.role === "harmony"
  const root = document.createElement("article")
  root.className = `sentence${isActive ? " active" : ""}${isHarmony ? " harmony" : ""}`
  root.dataset.id = sentence.id

  root.addEventListener("click", (event) => {
    if (consumeJustDragged()) return
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

  if (isHarmony) {
    const tag = document.createElement("span")
    tag.className = "harmony-tag"
    tag.textContent = "和声"
    tag.title = "和声句：与上一句同时唱的背景人声（导出时带括号）"
    side.appendChild(tag)
  }
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

  const renameAltBtn = document.createElement("button")
  renameAltBtn.type = "button"
  renameAltBtn.className = "alt-rename"
  renameAltBtn.textContent = "✎"
  renameAltBtn.title = "重命名当前备选"
  altCombo.appendChild(renameAltBtn)

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

  renameAltBtn.addEventListener("click", () =>
    startRenameAlternative(sentence.id, altCombo, altSelect),
  )

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

  const clearBtn = document.createElement("button")
  clearBtn.type = "button"
  clearBtn.textContent = "清空"
  clearBtn.title = "清空这一句当前备选的所有字（韵辙保留，可撤销）"
  clearBtn.addEventListener("click", () => {
    mutate(() => {
      const s = store.findSentence(sentence.id)
      if (!s) return
      rememberRhyme(s)
      setCells(s, getCells(s).map(() => ""))
      s.overflow = ""
      store.cursor = { sentenceId: sentence.id, cell: 0 }
    })
    focusCellInput()
    setStatus("已清空该句，韵辙保留")
  })
  controls.appendChild(clearBtn)

  const removeCellBtn = document.createElement("button")
  removeCellBtn.type = "button"
  removeCellBtn.textContent = "−"
  removeCellBtn.title = "删除光标所在格；该组只剩 1 格时连同分组一起删 (Cmd/Ctrl+[)"
  removeCellBtn.addEventListener("click", () => removeCellHere(sentence.id))
  controls.appendChild(removeCellBtn)

  const addCellBtn = document.createElement("button")
  addCellBtn.type = "button"
  addCellBtn.textContent = "+"
  addCellBtn.title = "光标所在分句加一格 (Cmd/Ctrl+])"
  addCellBtn.addEventListener("click", () => addCellHere(sentence.id))
  controls.appendChild(addCellBtn)

  const splitBtn = document.createElement("button")
  splitBtn.type = "button"
  splitBtn.textContent = "／"
  splitBtn.title = "在光标处断开分句；在分句开头则与上一分句合并 (Cmd/Ctrl+\\)"
  splitBtn.addEventListener("click", () => splitHere(sentence.id))
  controls.appendChild(splitBtn)

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

  const dupBtn = document.createElement("button")
  dupBtn.type = "button"
  dupBtn.textContent = "⧉"
  dupBtn.title = "复制本句词格，在下方插入新句"
  dupBtn.addEventListener("click", () => duplicateSentence(sentence.id))
  controls.appendChild(dupBtn)

  const harmonyBtn = document.createElement("button")
  harmonyBtn.type = "button"
  harmonyBtn.textContent = "和声"
  harmonyBtn.className = `harmony-toggle${isHarmony ? " on" : ""}`
  harmonyBtn.title = isHarmony ? "取消和声标记" : "标为和声句（与上一句同时唱的背景人声）"
  harmonyBtn.addEventListener("click", () => toggleHarmony(sentence.id))
  controls.appendChild(harmonyBtn)

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
  controls.appendChild(copyBtn)
  controls.appendChild(pasteBtn)
  controls.appendChild(clearBtn)

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
          if (consumeJustDragged()) return
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

  if (sentence.overflow) {
    const overflowEl = document.createElement("span")
    overflowEl.className = "sentence-overflow"
    overflowEl.textContent = `＋${sentence.overflow}`
    overflowEl.title = "超出词格的字；点顶栏「整理溢出」可顺移到下一句"
    row.appendChild(overflowEl)
  }

  const addAfterBtn = document.createElement("button")
  addAfterBtn.type = "button"
  addAfterBtn.className = "add-sentence-inline sentence-add"
  addAfterBtn.textContent = "+ 新增一句"
  addAfterBtn.title = "在这一句下面新增一句"
  addAfterBtn.addEventListener("click", () => addSentenceAfter(sentence.id))
  grid.appendChild(addAfterBtn)

  const sideRight = document.createElement("div")
  sideRight.className = "sentence-side-right"

  const rhyme = rhymeOfCells(cells)
  const lockKey = sentence.rhymeLock ?? ""
  const lockLabel = RHYME_LABEL_BY_KEY.get(lockKey)
  const badge = document.createElement("span")
  if (lockLabel) {
    const mismatch = rhyme !== null && rhyme.key !== lockKey
    badge.className = mismatch ? "rhyme-badge locked mismatch" : "rhyme-badge locked"
    badge.textContent = `${lockLabel} 🔒`
    badge.title = mismatch && rhyme
      ? `已锁「${lockLabel}」· 但句尾是「${rhyme.char}」（${rhyme.label}），不合辙`
      : `已锁「${lockLabel}」· 点击解锁`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(lockKey)))
  } else if (rhyme) {
    const ended = isEndingFilled(cells)
    badge.className = ended ? "rhyme-badge" : "rhyme-badge pending"
    badge.textContent = rhyme.label.replace(/辙$/, "")
    badge.title = ended
      ? `韵脚「${rhyme.char}」· 韵母 ${rhyme.final} · ${rhyme.label} · 点击加锁`
      : `韵脚「${rhyme.char}」· 韵母 ${rhyme.final} · ${rhyme.label}（句尾未填，暂不统计）`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(rhyme.key)))
  } else if (RHYME_LABEL_BY_KEY.get(sentence.rhymeHint ?? "")) {
    const hintKey = sentence.rhymeHint as string
    const hintLabel = RHYME_LABEL_BY_KEY.get(hintKey) as string
    badge.className = "rhyme-badge pending"
    badge.textContent = hintLabel.replace(/辙$/, "")
    badge.title = `清空时记住的辙「${hintLabel}」（未锁定）· 点击可加锁`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(hintKey)))
  } else {
    badge.className = "rhyme-badge empty"
    badge.textContent = "＋ 锁"
    badge.title = "锁定韵辙：写句尾时只允许押这个辙的字"
  }
  badge.addEventListener("click", (event) => {
    event.stopPropagation()
    openRhymeLockDialog(sentence.id, lockKey)
  })
  sideRight.appendChild(badge)

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

const SIDEBAR_WIDTH_KEY = "cige-grid-sidebar-width"
const SIDEBAR_COLLAPSED_KEY = "cige-grid-sidebar-collapsed"
const SIDEBAR_DEFAULT_WIDTH = 188
const SIDEBAR_MIN_WIDTH = 140
const SIDEBAR_MAX_WIDTH = 420

function setSidebarCollapsed(collapsed: boolean): void {
  document.documentElement.classList.toggle("sidebar-collapsed", collapsed)
  const sidebar = document.querySelector(".sidebar") as HTMLElement | null
  if (sidebar) sidebar.inert = collapsed
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0")
  } catch {
    // 忽略配额错误
  }
}

function setSidebarWidth(width: number): void {
  const clamped = Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  )
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`)
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
  } catch {
    // 忽略配额错误
  }
}

function initSidebarResizer(): void {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(saved) && saved > 0) setSidebarWidth(saved)
    setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1")
  } catch {
    setSidebarCollapsed(false)
  }

  sidebarToggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setSidebarCollapsed(
        !document.documentElement.classList.contains("sidebar-collapsed"),
      )
    })
  })

  resizerEl.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    const sidebar = document.querySelector(".sidebar") as HTMLElement | null
    if (!sidebar) return
    const startX = event.clientX
    const startWidth = sidebar.getBoundingClientRect().width
    resizerEl.classList.add("dragging")
    document.body.classList.add("resizing")
    document.body.style.userSelect = "none"
    resizerEl.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent): void => {
      setSidebarWidth(startWidth + (moveEvent.clientX - startX))
    }
    const onUp = (): void => {
      resizerEl.classList.remove("dragging")
      document.body.classList.remove("resizing")
      document.body.style.userSelect = ""
      resizerEl.removeEventListener("pointermove", onMove)
      resizerEl.removeEventListener("pointerup", onUp)
      resizerEl.removeEventListener("pointercancel", onUp)
    }

    resizerEl.addEventListener("pointermove", onMove)
    resizerEl.addEventListener("pointerup", onUp)
    resizerEl.addEventListener("pointercancel", onUp)
  })

  resizerEl.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH))
}

function focusCellInput(): void {
  const input = sentencesEl.querySelector<HTMLInputElement>("input.cell-input")
  if (input) {
    input.focus()
    const len = input.value.length
    input.setSelectionRange(len, len)
  }
}

function startRenameAlternative(
  sentenceId: string,
  combo: HTMLElement,
  select: HTMLSelectElement,
): void {
  const sentence = store.findSentence(sentenceId)
  const alt = sentence?.alternatives[sentence.activeAlt]
  if (!alt) return

  const input = document.createElement("input")
  input.className = "alt-rename-input"
  input.value = alt.name
  input.spellcheck = false
  combo.replaceChild(input, select)
  input.focus()
  input.select()

  let done = false
  const commit = (save: boolean): void => {
    if (done) return
    done = true
    if (save) {
      const name = input.value.trim() || alt.name
      mutate(() => {
        const target = store.findSentence(sentenceId)
        const targetAlt = target?.alternatives[sentence.activeAlt]
        if (targetAlt) targetAlt.name = name
      })
    } else {
      render()
    }
    focusCellInput()
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commit(true)
    } else if (e.key === "Escape") {
      e.preventDefault()
      commit(false)
    }
  })
  input.addEventListener("blur", () => commit(true))
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
    imeJustEnded = true
    commitInput(input)
  })

  input.addEventListener("blur", () => {
    input.style.width = ""
  })

  input.addEventListener("input", () => {
    clearSelection()
    if (composing) {
      const len = input.value.length
      input.style.width = len > 1 ? `${Math.max(54, (len + 1) * 16)}px` : ""
      return
    }
    commitInput(input)
  })

  input.addEventListener("keydown", (e) => {
    if (composing) return

    // 输入框内容超出当前格的原字 = 组字/追加输入过程中，交给浏览器删字符，
    // 不能把格子里已有的字一起清掉（keydown 早于 compositionstart 触发，
    // 所以 composing 标志靠不住，用值判断才稳）
    const base = input.dataset.base ?? ""
    const editing = input.value !== base

    if (e.key === "Backspace") {
      if (editing) return
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
      // 当前格空。组字刚结束的那一下：什么都不做——拼音刚删空，
      // 光标就该留在当前格里，哪也不去，更不碰前一格
      if (imeJustEnded) {
        imeJustEnded = false
        return
      }
      // 平时在空格上按 Backspace：删掉前一格的字并左移（这是另一个明确动作）
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
      if (editing) return
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
  // 只收汉字：打字/粘贴里夹带的英文、拼音、数字一律跳过
  const text = [...(base ? raw.replace(base, "") : raw)]
    .filter((char) => isHanChar(char))
    .join("")
  if (!text) {
    input.value = base
    return
  }
  const sentenceId = input.dataset.sentenceId ?? ""
  const start = store.cursor.cell
  input.value = ""

  const sentence = store.findSentence(sentenceId)
  if (!sentence) return

  const lockKey = sentence.rhymeLock ?? ""
  if (lockKey) {
    const total = totalCells(sentence.pattern)
    const lastIndex = total - 1
    const chars = [...text]
    for (let i = start, j = 0; i <= lastIndex && j < chars.length; i++, j++) {
      if (i !== lastIndex) continue
      if (!charFitsRhyme(chars[j], lockKey)) {
        setStatus(`『${chars[j]}』不押「${RHYME_LABEL_BY_KEY.get(lockKey) ?? lockKey}」，已拦下`, true)
        return
      }
    }
  }

  store.pushUndo()
  const result = writeChars(getCells(sentence), start, text)
  setCells(sentence, result.cells)
  const excess = [...text].slice(result.written).join("")
  if (excess) sentence.overflow = sentence.overflow + excess
  store.cursor.cell = Math.min(start + result.written, totalCells(sentence.pattern) - 1)
  store.touch()
  render()
  focusCellInput()

  setStatus(excess ? `多余 ${countRaw(excess)} 字已记为溢出` : "已填入")
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

function addCellHere(sentenceId: string): void {
  if (store.cursor.sentenceId !== sentenceId) store.cursor = { sentenceId, cell: 0 }
  mutate(() => {
    const target = store.findSentence(sentenceId)
    if (!target) return
    const result = addCellAt(target.pattern, getCells(target), store.cursor.cell)
    setPattern(target, result.pattern)
    setCells(target, result.cells)
    store.cursor.cell = result.cursor
  })
  focusCellInput()
}

function removeCellHere(sentenceId: string): void {
  if (store.cursor.sentenceId !== sentenceId) store.cursor = { sentenceId, cell: 0 }
  const target = store.findSentence(sentenceId)
  if (!target) return
  const result = removeCellAt(target.pattern, getCells(target), store.cursor.cell)
  if (!result) {
    setStatus("这句只剩一格，不能再删", true)
    return
  }
  mutate(() => {
    const s = store.findSentence(sentenceId)
    if (!s) return
    setPattern(s, result.pattern)
    setCells(s, result.cells)
    if (result.overflow) s.overflow = s.overflow + result.overflow
    store.cursor.cell = result.cursor
  })
  focusCellInput()
  setStatus(result.overflow ? "已删格，尾部字记为溢出" : "已删格")
}

function splitHere(sentenceId: string): void {
  if (store.cursor.sentenceId !== sentenceId) store.cursor = { sentenceId, cell: 0 }
  const target = store.findSentence(sentenceId)
  if (!target) return
  const next = splitOrMergePattern(target.pattern, store.cursor.cell)
  if (!next) {
    setStatus("光标在最前面的分句开头，无法断开或合并", true)
    return
  }
  const merged = next.length < target.pattern.length
  mutate(() => {
    const s = store.findSentence(sentenceId)
    if (!s) return
    setPattern(s, next)
  })
  focusCellInput()
  setStatus(merged ? "已与上一分句合并" : "已在光标处断开分句")
}

function duplicateSentence(sentenceId: string): void {
  mutate(() => {
    const section = findSectionBySentence(store.project, sentenceId)
    if (!section) return
    const index = section.sentences.findIndex((s) => s.id === sentenceId)
    if (index < 0) return
    const copy = createSentence(section.sentences[index].pattern.slice())
    section.sentences.splice(index + 1, 0, copy)
    store.cursor = { sentenceId: copy.id, cell: 0 }
  })
  focusCellInput()
  setStatus("已复制本句词格")
}

function toggleHarmony(sentenceId: string): void {
  mutate(() => {
    const s = store.findSentence(sentenceId)
    if (!s) return
    if (s.role === "harmony") delete s.role
    else s.role = "harmony"
  })
  setStatus(store.findSentence(sentenceId)?.role === "harmony" ? "已标为和声句" : "已取消和声")
}

function clearAllCells(): void {
  if (docsState.docs.length === 0) return
  const isAllEmpty = store.project.sections.every((section) =>
    section.sentences.every((sentence) =>
      sentence.alternatives.every((alt) => alt.cells.every((cell) => !cell)),
    ),
  )
  if (isAllEmpty) {
    setStatus("所有格子本来就是空的", true)
    return
  }
  mutate(() => {
    store.project.sections.forEach((section) => {
      section.sentences.forEach((sentence) => {
        rememberRhyme(sentence)
        sentence.alternatives.forEach((alt) => {
          alt.cells = alt.cells.map(() => "")
        })
        sentence.overflow = ""
      })
    })
    const first = store.project.sections[0]?.sentences[0]
    if (first) store.cursor = { sentenceId: first.id, cell: 0 }
  })
  focusCellInput()
  setStatus("已清空所有格子，韵辙与歌名保留（Cmd/Ctrl+Z 可撤销）")
}

function rememberRhyme(sentence: Sentence): void {
  if (sentence.rhymeLock) return
  const cells = getCells(sentence)
  if (!isEndingFilled(cells)) return
  const rhyme = rhymeOfCells(cells)
  if (rhyme) sentence.rhymeHint = rhyme.key
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
  // 只收汉字：英文、拼音、数字、标点一律跳过
  const chars = Array.from(text).filter((char) => isHanChar(char))
  if (chars.length === 0) {
    setStatus("剪贴板里没有汉字", true)
    return
  }
  const sentence = store.findSentence(sentenceId)
  if (!sentence) return
  const total = totalCells(sentence.pattern)
  const written = Math.min(chars.length, total)
  const lockKey = sentence.rhymeLock ?? ""
  if (lockKey && written > 0) {
    const lastChar = chars[written - 1]
    if (!charFitsRhyme(lastChar, lockKey)) {
      setStatus(`『${lastChar}』不押「${RHYME_LABEL_BY_KEY.get(lockKey) ?? lockKey}」，已拦下`, true)
      return
    }
  }
  const cells = getCells(sentence).slice()
  for (let i = 0; i < written; i++) cells[i] = chars[i]
  const excess = chars.slice(written).join("")
  store.pushUndo()
  setCells(sentence, cells)
  if (excess) sentence.overflow = sentence.overflow + excess
  store.cursor = { sentenceId, cell: Math.max(0, written - 1) }
  store.touch()
  render()
  focusCellInput()
  setStatus(excess ? `已粘贴，多余 ${excess.length} 字记为溢出` : "已粘贴该句")
}

async function copyLyrics(): Promise<void> {
  const ok = await copyText(exportLyrics(store.project))
  setStatus(ok ? "已复制歌词到剪贴板" : "复制失败", !ok)
}

async function copyGrid(): Promise<void> {
  const ok = await copyText(exportGrid(store.project))
  setStatus(ok ? "已复制词格到剪贴板" : "复制失败", !ok)
}

async function saveProject(saveAs: boolean): Promise<void> {
  if (docsState.docs.length === 0) {
    setStatus("没有可保存的歌词", true)
    return
  }
  try {
    const docId = docsState.activeId
    store.project.updatedAt = new Date().toISOString()
    const saved = await saveText({
      suggestedName: store.filePath ?? `${store.project.title || "未命名"}.json`,
      description: "词格工程",
      extensions: ["json"],
      pickerId: "cige-project",
      contents: JSON.stringify(store.project, null, 2),
      target: saveAs ? null : (saveTargets.get(docId) ?? null),
      forcePicker: saveAs,
    })
    if (!saved) return
    saveTargets.set(docId, saved)
    store.filePath = saved.kind === "path" && saved.path ? saved.path : saved.name
    store.markSaved()
    store.persist()
    renderStatusBar()
    setStatus(
      saved.kind === "download"
        ? `已下载「${saved.name}」（网页版没有覆盖权限，再次保存会再下载一份）`
        : "已保存工程",
    )
  } catch (err) {
    setStatus(`保存失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function openProject(source?: FileSource): Promise<void> {
  try {
    let src = source
    if (!src) {
      src = (await pickFile({
        description: "词格文件（工程 / 草稿备份）",
        extensions: ["json"],
        allFiles: false,
      })) ?? undefined
      if (!src) return
    }
    const raw = await src.readText()
    const backup = parseDocsBackup(raw)
    if (backup) {
      docsState.docs = backup.docs
      docsState.activeId = backup.activeId
      const active =
        docsState.docs.find((doc) => doc.id === docsState.activeId) ?? docsState.docs[0]
      activateDoc(active)
      persistDocs()
      render()
      focusCellInput()
      setStatus(`已从草稿备份恢复 ${docsState.docs.length} 个歌词文件`)
      return
    }
    const project = parseProject(raw)
    syncActiveDoc()
    const doc = createDocFrom(project, src.path ?? src.name)
    docsState.docs.push(doc)
    docsState.activeId = doc.id
    activateDoc(doc)
    persistDocs()
    render()
    focusCellInput()
    setStatus(`已打开「${project.title || "未命名"}」`)
  } catch (err) {
    setStatus(`打开失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

const EXPORT_OPTIONS_KEY = "cige-grid-export-options"

function loadExportOptions(): ExportOptions {
  try {
    const raw = localStorage.getItem(EXPORT_OPTIONS_KEY)
    if (raw) {
      const data = JSON.parse(raw) as { alts?: unknown; note?: unknown; credits?: unknown }
      return {
        alts: data.alts === true,
        note: data.note === true,
        credits: data.credits === true,
      }
    }
  } catch {
    // 忽略
  }
  return { alts: false, note: false, credits: false }
}

function saveExportOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(EXPORT_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    // 忽略
  }
}

async function exportDraftsBackup(): Promise<void> {
  try {
    syncActiveDoc()
    const saved = await saveText({
      suggestedName: "词格草稿备份.json",
      description: "词格草稿备份",
      extensions: ["json"],
      pickerId: "cige-backup",
      contents: JSON.stringify(buildDocsBackup(docsState), null, 2),
    })
    if (!saved) return
    setStatus(
      saved.kind === "download"
        ? `已下载 ${docsState.docs.length} 个歌词文件的草稿备份`
        : `已导出 ${docsState.docs.length} 个歌词文件的草稿备份`,
    )
  } catch (err) {
    setStatus(`导出失败: ${err instanceof Error ? err.message : err}`, true)
  }
}



function openRhymeLockDialog(sentenceId: string, current: string): void {
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "锁定韵辙"

  const hint = document.createElement("p")
  hint.textContent = "锁定后，这句的句尾只能输入押该辙的字（多音字任一读音命中即放行）。"

  const grid = document.createElement("div")
  grid.className = "rhyme-grid"

  RHYME_LABEL_BY_KEY.forEach((label, key) => {
    const btn = document.createElement("button")
    btn.type = "submit"
    btn.value = key
    btn.textContent = label
    if (key === current) btn.className = "primary"
    btn.style.setProperty("--rhyme-hue", String(rhymeHue(key)))
    grid.appendChild(btn)
  })

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const unlock = document.createElement("button")
  unlock.type = "submit"
  unlock.value = ""
  unlock.textContent = "解锁"
  unlock.className = "danger"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  actions.append(unlock, cancel)

  form.append(title, hint, grid, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    dialog.remove()
    if (action === "cancel") return
    const key = action || ""
    if (key === current) return
    mutate(() => {
      const target = store.findSentence(sentenceId)
      if (!target) return
      target.rhymeLock = key
    })
    setStatus(key ? `已锁「${RHYME_LABEL_BY_KEY.get(key)}」，句尾只能押这个辙` : "已解锁")
  })
  dialog.showModal()
}

function openCreditsDialog(): void {
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "创作信息"

  const hint = document.createElement("p")
  hint.textContent =
    "每行一条，例如「作词：择荇」。不会生成词格；导出歌词时可选择写在 TXT 顶部。"

  const textarea = document.createElement("textarea")
  textarea.value = (store.project.credits ?? []).join("\n")
  textarea.placeholder = "作词：择荇\n作曲：叶里"

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  const ok = document.createElement("button")
  ok.type = "submit"
  ok.value = "ok"
  ok.textContent = "保存"
  actions.append(cancel, ok)

  form.append(title, hint, textarea, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    dialog.remove()
    if (action !== "ok") return
    const credits = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    mutate(() => {
      store.project.credits = credits
    })
    setStatus(credits.length > 0 ? `已保存 ${credits.length} 条创作信息` : "已清空创作信息")
  })
  dialog.showModal()
  textarea.focus()
}

function askExportOptions(): Promise<ExportOptions | null> {
  return new Promise((resolve) => {
    const current = loadExportOptions()
    const sentences = allSentences(store.project)
    const altCount = sentences.filter((sentence) => sentence.alternatives.length > 1).length
    const noteCount = sentences.filter((sentence) => sentence.note).length

    const dialog = document.createElement("dialog")
    const form = document.createElement("form")
    form.method = "dialog"
    form.className = "dialog-body"

    const title = document.createElement("strong")
    title.textContent = "导出歌词"

    const intro = document.createElement("p")
    intro.textContent = `全篇有 ${altCount} 句带备选、${noteCount} 句带备注。勾选要一并写进 TXT 的内容。`

    const label1 = document.createElement("label")
    label1.className = "dialog-check"
    const check1 = document.createElement("input")
    check1.type = "checkbox"
    check1.checked = current.alts
    label1.append(check1, document.createTextNode("导出全部备选（同句用 ※ 分隔）"))

    const label2 = document.createElement("label")
    label2.className = "dialog-check"
    const check2 = document.createElement("input")
    check2.type = "checkbox"
    check2.checked = current.note
    label2.append(check2, document.createTextNode("导出备注（写在句末的（）里）"))

    const credits = store.project.credits ?? []
    let check3: HTMLInputElement | null = null
    let label3: HTMLLabelElement | null = null
    if (credits.length > 0) {
      label3 = document.createElement("label")
      label3.className = "dialog-check"
      check3 = document.createElement("input")
      check3.type = "checkbox"
      check3.checked = current.credits
      label3.append(check3, document.createTextNode("带上创作信息（写在歌词上方）"))
    }

    const hint = document.createElement("p")
    hint.textContent = "导出的 TXT 可以原样再导入，备选、备注和创作信息会一起读回来。"

    const actions = document.createElement("div")
    actions.className = "dialog-actions"
    const cancel = document.createElement("button")
    cancel.type = "submit"
    cancel.value = "cancel"
    cancel.textContent = "取消"
    const ok = document.createElement("button")
    ok.type = "submit"
    ok.value = "ok"
    ok.textContent = "导出"
    actions.append(cancel, ok)

    form.append(title, intro, label1, label2, ...(label3 ? [label3] : []), hint, actions)
    dialog.appendChild(form)
    document.body.appendChild(dialog)
    dialog.addEventListener("close", () => {
      const action = dialog.returnValue
      dialog.remove()
      if (action !== "ok") {
        resolve(null)
        return
      }
      const options = {
        alts: check1.checked,
        note: check2.checked,
        credits: check3 ? check3.checked : false,
      }
      saveExportOptions(options)
      resolve(options)
    })
    dialog.showModal()
  })
}

async function exportText(): Promise<void> {
  const options = await askExportOptions()
  if (!options) return
  try {
    const saved = await saveText({
      suggestedName: `${store.project.title || "歌词"}.txt`,
      description: "歌词文本",
      extensions: ["txt"],
      pickerId: "cige-export",
      contents: exportLyrics(store.project, options),
    })
    if (!saved) return
    setStatus(saved.kind === "download" ? "已下载歌词" : "已导出歌词")
  } catch (err) {
    setStatus(`导出失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function exportGridText(): Promise<void> {
  try {
    const saved = await saveText({
      suggestedName: `${store.project.title || "未命名"} 词格.txt`,
      description: "词格文本",
      extensions: ["txt"],
      pickerId: "cige-export",
      contents: exportGrid(store.project),
    })
    if (!saved) return
    setStatus(saved.kind === "download" ? "已下载词格" : "已导出词格")
  } catch (err) {
    setStatus(`导出失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

function askMidiExportOptions(): Promise<{ stripMarkers: boolean } | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog")
    const form = document.createElement("form")
    form.method = "dialog"
    form.className = "dialog-body"

    const title = document.createElement("strong")
    title.textContent = "导出带歌词 MIDI"

    const hint = document.createElement("p")
    hint.textContent =
      "这份 MIDI 里有词格酱的切分标记音（C0/C#0/D0）。默认原样保留，继续拿回词格酱或 DAW 里都还能用。"

    const label = document.createElement("label")
    label.className = "dialog-check"
    const check = document.createElement("input")
    check.type = "checkbox"
    label.append(check, document.createTextNode("去掉切分标记音（整个删掉，导出一份干净文件）"))

    const actions = document.createElement("div")
    actions.className = "dialog-actions"
    const cancel = document.createElement("button")
    cancel.type = "submit"
    cancel.value = "cancel"
    cancel.textContent = "取消"
    const ok = document.createElement("button")
    ok.type = "submit"
    ok.value = "ok"
    ok.textContent = "导出"
    actions.append(cancel, ok)

    form.append(title, hint, label, actions)
    dialog.appendChild(form)
    document.body.appendChild(dialog)
    dialog.addEventListener("close", () => {
      const action = dialog.returnValue
      dialog.remove()
      resolve(action === "ok" ? { stripMarkers: check.checked } : null)
    })
    dialog.showModal()
  })
}

async function exportLyricMidi(): Promise<void> {
  const session = midiSession
  if (!session) {
    setStatus("这次会话还没导入过 MIDI，先「导入 → 选择 MIDI…」", true)
    return
  }
  const current = store.project.sections.slice(session.offset)
  if (current.length !== session.sections.length) {
    setStatus(
      `词格和导入的 MIDI 对不上：现在是 ${current.length} 段，导入时是 ${session.sections.length} 段`,
      true,
    )
    return
  }
  for (let si = 0; si < session.sections.length; si++) {
    const currentLines = current[si].sentences
    const baseLines = session.sections[si].lines
    if (currentLines.length !== baseLines.length) {
      setStatus(
        `词格和导入的 MIDI 对不上：第 ${si + 1} 段现在是 ${currentLines.length} 句，导入时是 ${baseLines.length} 句`,
        true,
      )
      return
    }
    for (let li = 0; li < baseLines.length; li++) {
      const currentCells = totalCells(currentLines[li].pattern)
      const baseCells = baseLines[li].pattern.reduce((sum, size) => sum + size, 0)
      if (currentCells !== baseCells) {
        setStatus(
          `词格和导入的 MIDI 对不上：第 ${si + 1} 段第 ${li + 1} 句现在是 ${currentCells} 格，导入时是 ${baseCells} 格`,
          true,
        )
        return
      }
    }
  }
  const lyrics: string[] = []
  for (const section of current) {
    for (const sentence of section.sentences) {
      for (const cell of getCells(sentence)) lyrics.push(cell)
    }
  }
  const exportOptions =
    session.skipPitches.length > 0 ? await askMidiExportOptions() : { stripMarkers: false }
  if (!exportOptions) return
  try {
    const saved = await saveBytes({
      suggestedName: `${store.project.title || "未命名"} 带歌词.mid`,
      description: "MIDI 文件",
      extensions: ["mid"],
      pickerId: "cige-export",
      bytes: buildLyricMidi(session.file, session.trackIndex, lyrics, {
        skipPitches: session.skipPitches,
        stripMarkers: exportOptions.stripMarkers,
      }),
    })
    if (!saved) return
    setStatus(
      saved.kind === "download"
        ? `已下载带歌词 MIDI（${lyrics.filter(Boolean).length} 个字）`
        : `已导出带歌词 MIDI（${lyrics.filter(Boolean).length} 个字）`,
    )
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
      if (docsState.docs.length === 0) {
        const doc = createDoc()
        docsState.docs.push(doc)
        docsState.activeId = doc.id
        store.project = doc.project
        store.filePath = null
        store.undoStack = []
        store.redoStack = []
        store.cursor = { sentenceId: "", cell: 0 }
      }
      const imported = parsed.sections.map((section, i) => {
        const sentences = section.lines.map((line) => {
          const sentence = createSentence(line.pattern, line.harmony ? "harmony" : undefined)
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
        const name = section.name || `段落 ${i + 1}`
        return createSection(name, sentences)
      })
      if (merge) {
        store.project.sections.push(...imported)
      } else {
        store.project.sections = imported
      }
      const first = imported[0]?.sentences[0]
      if (first) store.cursor = { sentenceId: first.id, cell: 0 }
  applyImportedCredits(store.project, parsed.credits, merge)
  applyImportedTitle(store.project, parsed.title || fileTitle || "", merge)
  applyImportedSource(store.project, text, merge)
    })
    const creditNote =
      parsed.credits.length > 0 ? `，创作信息 ${parsed.credits.length} 条` : ""
    setStatus((merge ? `已合并 ${total} 句歌词` : `已导入 ${total} 句歌词`) + creditNote)
    return true
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true)
    return false
  }
}

/** 打开新的应用弹窗前，先把还开着的旧弹窗收掉（等同替用户按「取消」），避免叠成两层 */
function dismissOpenDialogs(): void {
  document
    .querySelectorAll<HTMLDialogElement>("dialog[open]")
    .forEach((item) => item.close("cancel"))
}

function openImportDialog(initialText?: string, fileTitle?: string): void {
  dismissOpenDialogs()
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
        <button value="midi" type="submit">选择 MIDI…</button>
        <button value="ok" type="submit">导入</button>
      </div>
    </form>
  `
  document.body.appendChild(dialog)
  const textarea = dialog.querySelector("textarea")!
  if (initialText !== undefined) {
    textarea.value = initialText
    if (fileTitle) textarea.dataset.fileTitle = fileTitle
  }
  const mergeInput = dialog.querySelector<HTMLInputElement>("#import-merge")!
  const modeInputs = Array.from(
    dialog.querySelectorAll<HTMLInputElement>('input[name="import-mode"]'),
  )
  dialog.addEventListener("close", async () => {
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
    if (action === "midi") {
      dialog.remove()
      void pickMidiFile()
      return
    }
    const merge = mergeInput.checked
    const fillLyrics = modeInputs.find((el) => el.checked)?.value !== "grid"
    dialog.remove()
    if (action === "ok") {
      const imported = await applyLyricsText(
        textarea.value,
        textarea.dataset.fileTitle,
        merge,
        fillLyrics,
      )
      if (imported) openSourcePanel()
    }
  })
  dialog.showModal()
  textarea.focus()
}

async function pickLyricsFileInto(textarea: HTMLTextAreaElement): Promise<void> {
  try {
    const source = await pickFile({
      description: "歌词文本",
      extensions: ["txt", "lrc", "md", "text"],
    })
    if (!source) return
    const raw = await source.readText()
    textarea.value = raw
    textarea.dataset.filePath = source.path ?? source.name
    const title = source.name.replace(/\.(txt|lrc|md|text)$/i, "")
    if (title) textarea.dataset.fileTitle = title
    setStatus(`已读入 ${source.name}，确认后点「导入」`)
  } catch (err) {
    setStatus(`读取失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function pickMidiFile(): Promise<void> {
  try {
    const source = await pickFile({
      description: "MIDI 文件",
      extensions: ["mid", "midi"],
    })
    if (!source) return
    await loadMidiFromSource(source)
  } catch (err) {
    setStatus(`读取 MIDI 失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

async function loadMidiFromSource(source: FileSource): Promise<void> {
  try {
    const bytes = await source.readBytes()
    const file = parseMidi(bytes)
    openMidiDialog(file, source.name)
  } catch (err) {
    setStatus(`读取 MIDI 失败: ${err instanceof Error ? err.message : err}`, true)
  }
}

function bindDrop(): void {
  const hint = document.createElement("div")
  hint.className = "drop-hint"
  hint.textContent = "松手导入：.mid / .txt / .lrc / .md / .json"
  hint.hidden = true
  document.body.appendChild(hint)
  onFileDrop({
    onEnter: () => {
      hint.hidden = false
    },
    onLeave: () => {
      hint.hidden = true
    },
    onDrop: (sources) => {
      hint.hidden = true
      void handleDropSources(sources)
    },
  })
}

async function handleDropSources(sources: FileSource[]): Promise<void> {
  const source = sources[0]
  if (!source) return
  const name = source.name
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "mid" || ext === "midi") {
    await loadMidiFromSource(source)
    return
  }
  if (ext === "json") {
    await openProject(source)
    return
  }
  if (["txt", "lrc", "md", "text"].includes(ext)) {
    try {
      const raw = await source.readText()
      openImportDialog(raw, name.replace(/\.[^.]+$/, ""))
    } catch (err) {
      setStatus(`读取失败: ${err instanceof Error ? err.message : err}`, true)
    }
    return
  }
  setStatus(`不认识的文件：${name}`, true)
}

function openMidiDialog(file: MidiFile, baseName: string): void {
  dismissOpenDialogs()
  const tracks = noteTracks(file)
  if (tracks.length === 0) {
    setStatus("这个 MIDI 里没有音符", true)
    return
  }
  const markerCount = file.tracks.reduce((n, track) => n + track.markers.length, 0)

  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = baseName ? `导入 MIDI：${baseName}` : "导入 MIDI"

  const trackLabel = document.createElement("label")
  trackLabel.className = "dialog-field"
  trackLabel.append(document.createTextNode("轨道"))
  const trackSelect = document.createElement("select")
  for (const track of tracks) {
    const option = document.createElement("option")
    option.value = String(track.index)
    option.textContent = `${track.name}（${track.count} 个音）`
    trackSelect.appendChild(option)
  }
  trackSelect.value = String(pickMelodyTrack(file))
  trackLabel.appendChild(trackSelect)

  const modeLabel = document.createElement("label")
  modeLabel.className = "dialog-field"
  modeLabel.append(document.createTextNode("分段依据"))
  const modeSelect = document.createElement("select")
  const modeOptions: [string, string][] = [
    ["auto", "自动（有 C0/C#0/D0 就按标记）"],
    ["rest", "休止 + Marker"],
    ["keyswitch", "词格酱标记（C0/C#0/D0）"],
  ]
  for (const [value, label] of modeOptions) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    modeSelect.appendChild(option)
  }
  modeLabel.appendChild(modeSelect)

  const modeNote = document.createElement("p")
  modeNote.className = "dialog-note"

  const restLabel = document.createElement("label")
  restLabel.className = "dialog-field"
  restLabel.append(document.createTextNode("换句休止"))
  const restSelect = document.createElement("select")
  const restOptions: [string, string][] = [
    ["1", "≥ 1 拍"],
    ["2", "≥ 2 拍"],
    ["0.5", "≥ 半拍"],
    ["0", "不按休止换句"],
  ]
  for (const [value, label] of restOptions) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    restSelect.appendChild(option)
  }
  restLabel.appendChild(restSelect)

  const markerLabel = document.createElement("label")
  markerLabel.className = "dialog-check"
  const markerCheck = document.createElement("input")
  markerCheck.type = "checkbox"
  markerCheck.checked = markerCount > 0
  markerCheck.disabled = markerCount === 0
  markerLabel.append(
    markerCheck,
    document.createTextNode(
      markerCount > 0
        ? `用 Marker 分段落（文件里有 ${markerCount} 个标记）`
        : "用 Marker 分段落（文件里没有标记）",
    ),
  )

  const mergeLabel = document.createElement("label")
  mergeLabel.className = "dialog-check"
  const mergeCheck = document.createElement("input")
  mergeCheck.type = "checkbox"
  mergeLabel.append(mergeCheck, document.createTextNode("合并到现有歌词（不覆盖）"))

  const preview = document.createElement("div")
  preview.className = "midi-preview"

  const build = (): MidiSection[] =>
    midiToSections(file, {
      trackIndex: Number(trackSelect.value),
      sentenceRestBeats: Number(restSelect.value),
      useMarkers: markerCheck.checked,
      mode: modeSelect.value as "auto" | "rest" | "keyswitch",
    })

  const usesKeyswitch = (): boolean =>
    modeSelect.value === "keyswitch" ||
    (modeSelect.value === "auto" &&
      keyswitchCount(file, Number(trackSelect.value)) > 0)

  const refresh = (): void => {
    const sections = build()
    const lines = sections.reduce((n, section) => n + section.lines.length, 0)
    const cells = sections.reduce(
      (n, section) =>
        n +
        section.lines.reduce(
          (m, line) => m + line.pattern.reduce((sum, size) => sum + size, 0),
          0,
        ),
      0,
    )
    const sample = sections
      .flatMap((section) => section.lines)
      .slice(0, 4)
      .map((line) => line.pattern.map((size) => "X".repeat(size)).join(" "))
      .join("　")
    preview.textContent = `${sections.length} 段 · ${lines} 句 · ${cells} 格${sample ? `　${sample}` : ""}`

    const count = keyswitchCount(file, Number(trackSelect.value))
    const keyswitch = usesKeyswitch()
    restSelect.disabled = keyswitch
    markerCheck.disabled = keyswitch || markerCount === 0
    if (keyswitch) {
      modeNote.textContent =
        count > 0
          ? `已识别 ${count} 个切分标记（C0=分句、C#0=换句、D0=换段，即绝对音高 24/25/26）；「换句休止」和 Marker 不参与`
          : "没找到 C0/C#0/D0 标记（绝对音高 24/25/26，按 Middle C=C3 的 DAW 显示）；将整段作为一句导入"
    } else if (modeSelect.value === "auto" && count === 0) {
      modeNote.textContent = "文件里没有 C0/C#0/D0 标记，按「休止 + Marker」切"
    } else {
      modeNote.textContent = ""
    }
  }
  trackSelect.addEventListener("change", refresh)
  modeSelect.addEventListener("change", refresh)
  restSelect.addEventListener("change", refresh)
  markerCheck.addEventListener("change", refresh)

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  const ok = document.createElement("button")
  ok.type = "submit"
  ok.value = "ok"
  ok.textContent = "导入"
  actions.append(cancel, ok)

  form.append(title, trackLabel, modeLabel, restLabel, markerLabel, modeNote, mergeLabel, preview, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  refresh()
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    const sections = build()
    const trackIndex = Number(trackSelect.value)
    const skipPitches =
      usesKeyswitch() && keyswitchCount(file, trackIndex) > 0
        ? [KEYSWITCH.group, KEYSWITCH.sentence, KEYSWITCH.section]
        : []
    dialog.remove()
    if (action !== "ok") return
    applyMidiSections(file, trackIndex, sections, mergeCheck.checked, skipPitches)
  })
  dialog.showModal()
}

function applyMidiSections(
  file: MidiFile,
  trackIndex: number,
  sections: MidiSection[],
  merge: boolean,
  skipPitches: number[] = [],
): void {
  const total = sections.reduce((n, section) => n + section.lines.length, 0)
  if (total === 0) {
    setStatus("没有可导入的音符", true)
    return
  }
  let offset = 0
  mutate(() => {
    if (docsState.docs.length === 0) {
      const doc = createDoc()
      docsState.docs.push(doc)
      docsState.activeId = doc.id
      store.project = doc.project
      store.filePath = null
      store.undoStack = []
      store.redoStack = []
      store.cursor = { sentenceId: "", cell: 0 }
    }
    const imported = sections.map((section, index) => {
      const sentences = section.lines.map((line) => {
        const sentence = createSentence(line.pattern)
        setCells(sentence, line.cells)
        return sentence
      })
      return createSection(section.name || `段落 ${index + 1}`, sentences)
    })
    if (merge) {
      offset = store.project.sections.length
      store.project.sections.push(...imported)
    } else {
      offset = 0
      store.project.sections = imported
    }
    const first = imported[0]?.sentences[0]
    if (first) store.cursor = { sentenceId: first.id, cell: 0 }
  })
  midiSession = { file, trackIndex, offset, sections, skipPitches }
  focusCellInput()
  setStatus(`已从 MIDI 导入 ${total} 句词格（填完字可「导出 → 带歌词 MIDI」）`)
}

const AI_WIDTH_KEY = "cige-grid-ai-width"
const AI_SCOPE_KEY = "cige-grid-ai-scope"

type AiScope = "all" | "empty" | "section" | "selected"

const AI_SCOPE_OPTIONS: { value: AiScope; label: string }[] = [
  { value: "all", label: "整首" },
  { value: "empty", label: "只填空句" },
  { value: "section", label: "当前段" },
  { value: "selected", label: "选中的句子" },
]

function loadAiScope(): AiScope {
  const stored = localStorage.getItem(AI_SCOPE_KEY)
  return AI_SCOPE_OPTIONS.some((option) => option.value === stored)
    ? (stored as AiScope)
    : "all"
}

let aiScope: AiScope = loadAiScope()

function setAiScope(scope: AiScope): void {
  aiScope = scope
  localStorage.setItem(AI_SCOPE_KEY, scope)
  renderAiChips()
  updateAiHint()
}
const AI_OPEN_KEY = "cige-grid-ai-open"
const AI_DEFAULT_WIDTH = 320
const AI_MIN_WIDTH = 260
const AI_MAX_WIDTH = 520

interface AiVersion {
  text: string
  thinkingText?: string
  thinkingMs?: number
  finishReason?: string
  note?: string
  parsed?: AiSentenceResult[]
  ok?: AiSentenceResult[]
  issues?: AiIssue[]
  applied?: boolean
}

interface AiBubble {
  role: "user" | "assistant" | "system"
  text: string
  streaming?: boolean
  error?: string
  thinkingOpen?: boolean
  request?: string
  versions: AiVersion[]
  versionIndex: number
}

let aiBubbles: AiBubble[] = []
let aiBusy = false
let aiAbort: AbortController | null = null
let aiStreamEl: HTMLElement | null = null
let aiStreamThinkEl: HTMLElement | null = null
let aiStreamThinkLabelEl: HTMLElement | null = null

let aiSettings = loadAiSettings()

function currentProvider(): AiProvider {
  return (
    aiSettings.providers.find((provider) => provider.id === aiSettings.providerId) ??
    aiSettings.providers[0]
  )
}

function setChip(button: HTMLButtonElement, label: string, title: string): void {
  button.replaceChildren()
  const text = document.createElement("span")
  text.className = "ai-chip-text"
  text.textContent = label
  const caret = document.createElement("span")
  caret.className = "ai-chip-caret"
  caret.textContent = "⌄"
  button.append(text, caret)
  button.title = title
}

function renderAiChips(): void {
  const provider = currentProvider()
  const model = aiSettings.model
  setChip(
    aiModelChip,
    model ? modelLabel(model) : "选择模型",
    provider
      ? `${provider.name} · ${model || "未选模型"} · 点击切换模型`
      : "点击切换模型",
  )
  const effort = EFFORT_LEVELS.find((level) => level.value === aiSettings.effort)
  setChip(aiEffortChip, effort ? effort.label : "Default", "推理等级")
  const scope = AI_SCOPE_OPTIONS.find((option) => option.value === aiScope)
  setChip(aiScopeChip, scope ? scope.label : "整首", "生成范围")
}

function openScopePop(): void {
  openAiPop(aiScopeChip, (pop) => {
    for (const option of AI_SCOPE_OPTIONS) {
      const item = document.createElement("button")
      item.type = "button"
      item.textContent = option.label
      if (option.value === aiScope) {
        item.classList.add("current")
        const tick = document.createElement("span")
        tick.className = "tick"
        tick.textContent = "✓"
        item.appendChild(tick)
      }
      item.addEventListener("click", () => {
        setAiScope(option.value)
        closeAiPops()
      })
      pop.appendChild(item)
    }
  })
}

function closeAiPops(): void {
  document.querySelectorAll(".ai-pop").forEach((el) => el.remove())
  document
    .querySelectorAll<HTMLElement>(".ai-chip")
    .forEach((el) => delete el.dataset.open)
}

function openAiPop(anchor: HTMLElement, build: (pop: HTMLElement) => void): void {
  const wasOpen = anchor.dataset.open === "1"
  closeAiPops()
  if (wasOpen) return
  anchor.dataset.open = "1"
  const pop = document.createElement("div")
  pop.className = "ai-pop"
  build(pop)
  document.querySelector(".ai-composer")?.appendChild(pop)
  const onDocClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (pop.contains(target) || anchor.contains(target)) return
    closeAiPops()
    document.removeEventListener("click", onDocClick)
  }
  setTimeout(() => document.addEventListener("click", onDocClick), 0)
}

function chooseModel(providerId: string, model: string): void {
  aiSettings = { ...aiSettings, providerId, model }
  saveAiSettings(aiSettings)
  renderAiChips()
  closeAiPops()
}

function openModelPop(): void {
  openAiPop(aiModelChip, (pop) => {
    const search = document.createElement("input")
    search.type = "text"
    search.placeholder = "搜索模型"
    pop.appendChild(search)
    const list = document.createElement("div")
    pop.appendChild(list)
    const render = () => {
      const keyword = search.value.trim().toLowerCase()
      list.replaceChildren()
      for (const provider of aiSettings.providers) {
        const models = provider.models.filter(
          (model) =>
            model.toLowerCase().includes(keyword) ||
            modelLabel(model).toLowerCase().includes(keyword),
        )
        if (models.length === 0) continue
        const title = document.createElement("div")
        title.className = "ai-pop-title"
        title.textContent = provider.name
        list.appendChild(title)
        for (const model of models) {
          const item = document.createElement("button")
          item.type = "button"
          item.textContent = modelLabel(model)
          item.title = model
          if (provider.id === aiSettings.providerId && model === aiSettings.model) {
            item.classList.add("current")
            const tick = document.createElement("span")
            tick.className = "tick"
            tick.textContent = "✓"
            item.appendChild(tick)
          }
          item.addEventListener("click", () => chooseModel(provider.id, model))
          list.appendChild(item)
        }
      }
      if (list.childElementCount === 0) {
        const empty = document.createElement("div")
        empty.className = "ai-pop-title"
        empty.textContent = "没有匹配的模型，去「管理模型」加"
        list.appendChild(empty)
      }
    }
    search.addEventListener("input", render)
    render()
    const foot = document.createElement("div")
    foot.className = "ai-pop-foot"
    const manage = document.createElement("button")
    manage.type = "button"
    manage.textContent = "管理模型"
    manage.addEventListener("click", () => {
      closeAiPops()
      openAiSettings()
    })
    foot.appendChild(manage)
    pop.appendChild(foot)
    search.focus()
  })
}

function openEffortPop(): void {
  openAiPop(aiEffortChip, (pop) => {
    const provider = currentProvider()
    for (const level of EFFORT_LEVELS) {
      const item = document.createElement("button")
      item.type = "button"
      item.textContent = level.label
      if (level.value === aiSettings.effort) {
        item.classList.add("current")
        const tick = document.createElement("span")
        tick.className = "tick"
        tick.textContent = "✓"
        item.appendChild(tick)
      }
      item.addEventListener("click", () => {
        aiSettings = { ...aiSettings, effort: level.value }
        saveAiSettings(aiSettings)
        renderAiChips()
        closeAiPops()
      })
      pop.appendChild(item)
    }
    const note = document.createElement("div")
    note.className = "ai-pop-title"
    if (!provider?.supportsThinking) {
      note.textContent = "这个接口没勾「思考参数」，选了也不会发（去 ⚙ 勾上）"
    } else if (!supportsEffortFor(aiSettings.model, provider.supportsEffort)) {
      note.textContent = `${modelLabel(aiSettings.model) || "当前模型"} 只支持开关思考：Low / High / Max 都按「开启」发，None 关掉`
    } else {
      note.textContent = "会按 thinking + reasoning_effort 一起传"
    }
    pop.appendChild(note)
  })
}

function setAiWidth(width: number): void {
  const clamped = Math.max(AI_MIN_WIDTH, Math.min(AI_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--ai-width", `${clamped}px`)
  localStorage.setItem(AI_WIDTH_KEY, String(clamped))
}

function openAiPanel(): void {
  closeSourcePanel()
  aiPanel.hidden = false
  aiResizer.hidden = false
  btnAi.setAttribute("aria-expanded", "true")
  localStorage.setItem(AI_OPEN_KEY, "1")
  updateAiHint()
  renderAiMessages()
  aiInput.focus()
}

function closeAiPanel(): void {
  closeAiPops()
  aiPanel.hidden = true
  aiResizer.hidden = true
  btnAi.setAttribute("aria-expanded", "false")
  localStorage.setItem(AI_OPEN_KEY, "0")
}

function toggleAiPanel(): void {
  if (aiPanel.hidden) openAiPanel()
  else closeAiPanel()
}

function initAiResizer(): void {
  const stored = Number(localStorage.getItem(AI_WIDTH_KEY))
  setAiWidth(Number.isFinite(stored) && stored > 0 ? stored : AI_DEFAULT_WIDTH)
  aiResizer.addEventListener("dblclick", () => setAiWidth(AI_DEFAULT_WIDTH))
  aiResizer.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = aiPanel.getBoundingClientRect().width
    aiResizer.classList.add("dragging")
    const onMove = (move: PointerEvent) => setAiWidth(startWidth - (move.clientX - startX))
    const onUp = () => {
      aiResizer.classList.remove("dragging")
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  })
}

function aiTargetIds(): string[] | null {
  const scope = aiScope
  const sentences = allSentences(store.project)
  if (scope === "empty") {
    return sentences
      .filter((sentence) => getCells(sentence).every((cell) => !cell))
      .map((sentence) => sentence.id)
  }
  if (scope === "section") {
    const section = findSectionBySentence(store.project, store.cursor.sentenceId)
    return section ? section.sentences.map((sentence) => sentence.id) : null
  }
  if (scope === "selected") return selectionSpans().map((span) => span.sentence.id)
  return null
}

function updateAiHint(): void {
  const scope = aiScope
  const ids = aiTargetIds()
  if (scope === "selected") {
    aiHint.textContent =
      ids && ids.length > 0
        ? `选中 ${ids.length} 句（连同整首词格一起发给模型）`
        : "先在格子里框选要写的句子"
    return
  }
  const count = ids ? ids.length : allSentences(store.project).length
  const label = scope === "all" ? "整首" : scope === "empty" ? "只填空句" : "当前段"
  aiHint.textContent = `已自动附上词格：${label} ${count} 句`
}

function scrollAiToBottom(): void {
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight
}

function updateStreamText(bubble: AiBubble): void {
  const version = aiVersionOf(bubble)
  const text = version?.text ?? ""
  if (aiStreamEl?.classList.contains("ai-lines")) {
    const items = previewAiResults(text)
    fillAiLines(aiStreamEl, aiLineViews(version, items))
  } else if (aiStreamEl) {
    aiStreamEl.textContent = text || "…"
  }
  scrollAiToBottom()
}

function aiLineViews(
  version: AiVersion | null,
  items: AiSentenceResult[],
): {
  groups: string[]
  label: string
  section: string
  bad: boolean
}[] {
  const bad = new Set((version?.issues ?? []).map((issue) => issue.sentenceId))
  return items.map((item) => {
    const place = item.id ? sentencePlace(store.project, item.id) : null
    const sentence = item.id ? store.findSentence(item.id) : undefined
    return {
      groups: sentence ? splitByPattern(item.text, sentence.pattern) : [item.text],
      label: place ? String(place.line) : "",
      section: place ? place.section : "",
      bad: bad.has(item.id),
    }
  })
}

function fillAiLines(
  container: HTMLElement,
  views: { groups: string[]; label: string; section: string; bad: boolean }[],
): void {
  container.replaceChildren()
  if (views.length === 0) {
    const pending = document.createElement("div")
    pending.className = "ai-line pending"
    pending.textContent = "…"
    container.appendChild(pending)
    return
  }
  let currentSection = ""
  for (const view of views) {
    if (view.section && view.section !== currentSection) {
      currentSection = view.section
      const head = document.createElement("div")
      head.className = "ai-line-section"
      head.textContent = currentSection
      container.appendChild(head)
    }
    const line = document.createElement("div")
    line.className = `ai-line${view.bad ? " bad" : ""}`
    const label = document.createElement("span")
    label.className = "ai-line-label"
    label.textContent = view.label
    const text = document.createElement("span")
    text.className = "ai-line-text"
    const groups = view.groups.length > 0 ? view.groups : [""]
    groups.forEach((group, index) => {
      if (index > 0) {
        const gap = document.createElement("span")
        gap.className = "ai-line-gap"
        text.appendChild(gap)
      }
      text.appendChild(document.createTextNode(group))
    })
    line.append(label, text)
    container.appendChild(line)
  }
}

function thinkingLabel(version: AiVersion, streaming: boolean): string {
  const seconds = Math.max(1, Math.round((version.thinkingMs ?? 0) / 1000))
  return streaming ? `思考中… ${seconds} 秒` : `已思考（用时 ${seconds} 秒）`
}

function aiIconButton(label: string, paths: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "ai-icon-btn"
  button.title = label
  button.setAttribute("aria-label", label)
  button.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  button.addEventListener("click", onClick)
  return button
}

function renderAiMessages(): void {
  aiStreamEl = null
  aiStreamThinkEl = null
  aiStreamThinkLabelEl = null
  aiMessagesEl.replaceChildren()
  if (aiBubbles.length === 0) {
    const empty = document.createElement("div")
    empty.className = "ai-msg system"
    empty.textContent = "说要求（比如「写一段古风」），或点上面的「按词格写整首」。"
    aiMessagesEl.appendChild(empty)
    return
  }
  aiBubbles.forEach((bubble) => {
    const el = document.createElement("div")
    el.className = `ai-msg ${bubble.role}`
    if (bubble.error) el.classList.add("error")
    const version = aiVersionOf(bubble)
    const bodyText = version ? version.text : bubble.text
    if (bubble.role === "assistant" && version && (version.thinkingText ?? "") !== "") {
      const toggle = document.createElement("button")
      toggle.type = "button"
      toggle.className = `ai-think-toggle${bubble.thinkingOpen ? " open" : ""}`
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      icon.setAttribute("viewBox", "0 0 16 16")
      icon.setAttribute("width", "13")
      icon.setAttribute("height", "13")
      icon.setAttribute("aria-hidden", "true")
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
      path.setAttribute("d", "M8 1.4l1.6 4.2 4.2 1.6-4.2 1.6L8 13l-1.6-4.2L2.2 7.2l4.2-1.6z")
      path.setAttribute("fill", "currentColor")
      icon.appendChild(path)
      const label = document.createElement("span")
      label.textContent = thinkingLabel(version, Boolean(bubble.streaming))
      const caret = document.createElement("span")
      caret.className = "caret"
      caret.textContent = "›"
      toggle.append(icon, label, caret)
      toggle.addEventListener("click", () => {
        bubble.thinkingOpen = !bubble.thinkingOpen
        renderAiMessages()
      })
      el.appendChild(toggle)
      if (bubble.streaming) {
        aiStreamThinkEl = toggle
        aiStreamThinkLabelEl = label
      }
      if (bubble.thinkingOpen) {
        const body = document.createElement("div")
        body.className = "ai-think"
        body.textContent = version.thinkingText ?? ""
        el.appendChild(body)
      }
    }
    const useLines =
      bubble.role === "assistant" &&
      !bubble.error &&
      ((version?.parsed?.length ?? 0) > 0 ||
        (bubble.streaming && bodyText.trimStart().startsWith("{")))
    if (useLines && version) {
      const items: AiSentenceResult[] =
        version.parsed && version.parsed.length > 0
          ? version.parsed
          : previewAiResults(bodyText)
      const list = document.createElement("div")
      list.className = "ai-lines"
      fillAiLines(list, aiLineViews(version, items))
      el.appendChild(list)
      if (bubble.streaming) aiStreamEl = list
    } else {
      const text = document.createElement("div")
      text.textContent = bubble.error
        ? `出错了：${bubble.error}`
        : bodyText || (bubble.streaming ? "…" : "")
      el.appendChild(text)
      if (bubble.streaming) aiStreamEl = text
    }
    if (version?.note) {
      const note = document.createElement("div")
      note.className = "ai-note"
      note.textContent = version.note
      el.appendChild(note)
    }
    if (version?.issues && version.issues.length > 0) {
      const issues = document.createElement("div")
      issues.className = "ai-note"
      issues.textContent = `没过的句子：${version.issues.map((issue) => `${issue.label} ${issue.message}`).join("；")}`
      el.appendChild(issues)
    }
    if (
      bubble.role === "assistant" &&
      !bubble.error &&
      version &&
      (version.text.trim() !== "" || bubble.versions.length > 1)
    ) {
      const actions = document.createElement("div")
      actions.className = "ai-actions"
      if (version.ok && version.ok.length > 0) {
        const apply = document.createElement("button")
        apply.type = "button"
        apply.className = "ai-apply"
        apply.textContent = version.applied ? "已填入" : "填入词格"
        apply.disabled = !!version.applied
        apply.addEventListener("click", () => applyAiBubble(bubble))
        actions.appendChild(apply)
      }
      actions.appendChild(
        aiIconButton(
          "复制",
          '<rect x="9" y="9" width="13" height="13" rx="2.6"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
          () => {
            void copyText(version.text).then((ok) => setStatus(ok ? "已复制" : "复制失败", !ok))
          },
        ),
      )
      actions.appendChild(aiVersionNav(bubble))
      if (bubble.request) {
        actions.appendChild(
          aiIconButton(
            "重跑",
            '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
            () => void rerunAi(bubble),
          ),
        )
      }
      el.appendChild(actions)
    }
    aiMessagesEl.appendChild(el)
  })
  scrollAiToBottom()
}

function aiVersionNav(bubble: AiBubble): HTMLElement {
  const nav = document.createElement("span")
  nav.className = "ai-versions"
  const total = bubble.versions.length
  if (total <= 1) return nav
  const back = document.createElement("button")
  back.type = "button"
  back.textContent = "‹"
  back.disabled = bubble.versionIndex <= 0
  back.title = "上一版"
  back.addEventListener("click", () => {
    if (bubble.versionIndex <= 0) return
    bubble.versionIndex -= 1
    bubble.error = undefined
    renderAiMessages()
  })
  const count = document.createElement("span")
  count.textContent = `${bubble.versionIndex + 1}/${total}`
  const forward = document.createElement("button")
  forward.type = "button"
  forward.textContent = "›"
  forward.disabled = bubble.versionIndex >= total - 1
  forward.title = "下一版"
  forward.addEventListener("click", () => {
    if (bubble.versionIndex >= total - 1) return
    bubble.versionIndex += 1
    bubble.error = undefined
    renderAiMessages()
  })
  nav.append(back, count, forward)
  return nav
}

function pushAiBubble(partial: Partial<AiBubble> & Pick<AiBubble, "role" | "text">): AiBubble {
  const bubble: AiBubble = { versions: [], versionIndex: 0, ...partial }
  aiBubbles.push(bubble)
  renderAiMessages()
  return bubble
}

function aiVersionOf(bubble: AiBubble): AiVersion | null {
  return bubble.role === "assistant" ? bubble.versions[bubble.versionIndex] ?? null : null
}

function aiHistoryUntil(target?: AiBubble): ChatMessage[] {
  const list = target ? aiBubbles.slice(0, aiBubbles.indexOf(target)) : aiBubbles
  return list
    .filter((bubble) => bubble.role === "user" || bubble.role === "assistant")
    .slice(-6)
    .map((bubble) => ({
      role: bubble.role as "user" | "assistant",
      content: (bubble.role === "assistant" ? aiVersionOf(bubble)?.text ?? "" : bubble.text).slice(0, 2000),
    }))
    .filter((message) => message.content.trim() !== "")
}

function applyAiBubble(bubble: AiBubble): void {
  const version = aiVersionOf(bubble)
  if (!version || !version.ok || version.ok.length === 0 || version.applied) return
  let filled = 0
  let alternatives = 0
  mutate(() => {
    const summary = applyAiResults(store.project, version.ok ?? [])
    filled = summary.filled
    alternatives = summary.alternatives
  })
  version.applied = true
  renderAiMessages()
  focusCellInput()
  setStatus(
    `AI 已填 ${filled} 句${alternatives > 0 ? `，其中 ${alternatives} 句进了「AI」备选` : ""}（可撤销）`,
  )
}

function updateAiSendButton(): void {
  btnAiSend.textContent = aiBusy ? "■" : "↑"
  btnAiSend.title = aiBusy ? "停止" : "发送（Enter）"
}

function requireAiTarget(): boolean {
  const target = resolveTarget(aiSettings)
  if (!target) {
    setStatus("先在 ⚙ 里填接口地址 / 模型", true)
    openAiSettings()
    return false
  }
  const provider = currentProvider()
  if (provider?.builtin && !target.apiKey.trim()) {
    setStatus(`还没填 ${provider.name} 的 API Key（点 ⚙ 设置）`, true)
    openAiSettings()
    return false
  }
  return true
}

async function sendAi(text: string): Promise<void> {
  if (!isDesktop()) {
    setStatus("AI 填词仅桌面版可用（网页版暂不支持）", true)
    return
  }
  const trimmed = text.trim()
  if (!trimmed || aiBusy) return
  if (!requireAiTarget()) return
  const history = aiHistoryUntil()
  pushAiBubble({ role: "user", text: trimmed })
  aiInput.value = ""
  const reply = pushAiBubble({
    role: "assistant",
    text: "",
    streaming: true,
    request: trimmed,
    versions: [{ text: "" }],
  })
  await runAiGeneration(reply, reply.versions[0], trimmed, history)
}

async function rerunAi(bubble: AiBubble): Promise<void> {
  if (aiBusy || bubble.role !== "assistant" || !bubble.request) return
  if (!requireAiTarget()) return
  const history = aiHistoryUntil(bubble)
  bubble.versions.push({ text: "" })
  bubble.versionIndex = bubble.versions.length - 1
  bubble.error = undefined
  bubble.thinkingOpen = false
  renderAiMessages()
  await runAiGeneration(bubble, bubble.versions[bubble.versionIndex], bubble.request, history)
}

async function runAiGeneration(
  bubble: AiBubble,
  version: AiVersion,
  requestText: string,
  history: ChatMessage[],
): Promise<void> {
  const target = resolveTarget(aiSettings)
  if (!target) return
  const targets = aiTargetIds()
  bubble.streaming = true
  aiBusy = true
  aiAbort = new AbortController()
  updateAiSendButton()
  const started = Date.now()
  const scopeIds =
    targets && targets.length > 0
      ? targets
      : allSentences(store.project).map((sentence) => sentence.id)
  const cells = allSentences(store.project)
    .filter((sentence) => scopeIds.includes(sentence.id))
    .reduce((total, sentence) => total + totalCells(sentence.pattern), 0)
  const thinkingOn = target.supportsThinking && aiSettings.effort !== "none"
  const maxTokens = maxTokensFor(cells, thinkingOn, aiSettings.effort, aiSettings.maxOutput)
  let thinkingStart = 0
  const onReasoning = (delta: string) => {
    const now = Date.now()
    if (!thinkingStart) thinkingStart = now
    version.thinkingMs = now - thinkingStart
    version.thinkingText = (version.thinkingText ?? "") + delta
    if (!aiStreamThinkEl) renderAiMessages()
    if (aiStreamThinkLabelEl) aiStreamThinkLabelEl.textContent = thinkingLabel(version, true)
  }
  try {
    const writing = targets === null || targets.length > 0
    const messages: ChatMessage[] = [
      { role: "system", content: writing ? buildSystemPrompt() : buildChatSystemPrompt() },
      ...history,
      {
        role: "user",
        content: writing
          ? `${requestText}\n\n${buildBrief(store.project, targets, requestText)}`
          : requestText,
      },
    ]
    let raw = await requestChat(target, messages, {
      signal: aiAbort.signal,
      maxTokens,
      onReasoning,
      onFinish: (reason) => {
        version.finishReason = reason
      },
      onDelta: (delta) => {
        version.text += delta
        updateStreamText(bubble)
      },
    })
    let results = parseAiSentences(raw)
    let validation = validateAiResults(store.project, results)
    let rounds = 0
    while (validation.issues.length > 0 && rounds < 3) {
      rounds += 1
      version.note = `校验没过，第 ${rounds} 次修正中…`
      version.text = ""
      renderAiMessages()
      raw = await requestChat(
        target,
        [
          ...messages,
          { role: "assistant", content: raw },
          { role: "user", content: buildFixPrompt(validation.issues, results) },
        ],
        {
          signal: aiAbort.signal,
          maxTokens,
          onReasoning,
          onFinish: (reason) => {
            version.finishReason = reason
          },
          onDelta: (delta) => {
            version.text += delta
            updateStreamText(bubble)
          },
        },
      )
      const fixed = parseAiSentences(raw)
      if (fixed.length === 0) break
      const issueIds = validation.issues.map((issue) => issue.sentenceId)
      const byId = new Map(results.map((result) => [result.id, result]))
      fixed.forEach((result, index) => {
        const id = result.id || issueIds[index] || ""
        if (id) byId.set(id, { id, text: result.text })
      })
      results = [...byId.values()]
      validation = validateAiResults(store.project, results)
    }
    bubble.streaming = false
    version.parsed = results
    version.ok = validation.ok
    version.issues = validation.issues
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const model = ` · ${target.model}`
    const thinkCount = [...(version.thinkingText ?? "")].length
    const thinking = thinkCount > 0 ? ` · 思考 ${thinkCount} 字` : ""
    const truncated = version.finishReason === "length" ? " · ⚠ 输出被额度截断" : ""
    if (results.length === 0) {
      version.note = `没解析到句子，原样显示${model}${thinking}${truncated} · 用时 ${seconds}s`
    } else {
      version.note = `✓ ${validation.ok.length} 句通过${
        validation.issues.length > 0 ? `，${validation.issues.length} 句仍没过` : ""
      }${rounds > 0 ? ` · 自动修正 ${rounds} 次` : ""}${model}${thinking}${truncated} · 用时 ${seconds}s`
    }
    renderAiMessages()
  } catch (err) {
    bubble.streaming = false
    if (aiAbort?.signal.aborted) {
      version.note = "已停止"
    } else {
      bubble.error = err instanceof Error ? err.message : String(err)
      setStatus(`AI 出错：${bubble.error}`, true)
    }
    renderAiMessages()
  } finally {
    aiBusy = false
    aiAbort = null
    updateAiSendButton()
  }
}

function parseList(value: string): string[] {
  return value
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function openAiSettings(): void {
  closeAiPops()
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "AI 接口设置"
  const intro = document.createElement("p")
  intro.textContent =
    "内置 DeepSeek 和小米 MiMo：填上对应的 API Key 就能用；也能改用自定义接口。Key 只存在这台电脑上。"
  form.append(title, intro)

  const rows: {
    provider: AiProvider
    baseEl: HTMLInputElement
    modelsEl: HTMLInputElement
    keyEl: HTMLInputElement
    resultEl: HTMLElement
    thinkEl?: HTMLInputElement
    effortEl?: HTMLInputElement
  }[] = []

  for (const provider of aiSettings.providers) {
    const block = document.createElement("div")
    block.className = "ai-provider"
    const name = document.createElement("strong")
    name.textContent = provider.name
    block.appendChild(name)

    let thinkEl: HTMLInputElement | undefined
    let effortEl: HTMLInputElement | undefined
    if (provider.builtin) {
      const note = document.createElement("div")
      note.className = "ai-provider-note"
      note.textContent = provider.supportsEffort
        ? "思考：开关 + 强度（low / high / max）"
        : "思考：仅开关（没有强度档）"
      block.appendChild(note)
    } else {
      const thinkLabel = document.createElement("label")
      thinkLabel.className = "dialog-check"
      thinkEl = document.createElement("input")
      thinkEl.type = "checkbox"
      thinkEl.checked = provider.supportsThinking
      thinkLabel.append(
        thinkEl,
        document.createTextNode("支持 thinking 开关（thinking: enabled / disabled）"),
      )
      const effortLabel = document.createElement("label")
      effortLabel.className = "dialog-check"
      effortEl = document.createElement("input")
      effortEl.type = "checkbox"
      effortEl.checked = provider.supportsEffort
      effortLabel.append(
        effortEl,
        document.createTextNode("支持 reasoning_effort（low / high / max）"),
      )
      block.append(thinkLabel, effortLabel)
    }

    const baseEl = document.createElement("input")
    baseEl.type = "text"
    baseEl.placeholder = "接口地址"
    baseEl.value = provider.baseUrl
    const baseLabel = document.createElement("label")
    baseLabel.className = "dialog-field"
    baseLabel.append(document.createTextNode("地址"), baseEl)

    const modelsEl = document.createElement("input")
    modelsEl.type = "text"
    modelsEl.placeholder = "模型，逗号分隔"
    modelsEl.value = provider.models.join(", ")
    const modelsLabel = document.createElement("label")
    modelsLabel.className = "dialog-field"
    modelsLabel.append(document.createTextNode("模型"), modelsEl)

    const keyEl = document.createElement("input")
    keyEl.type = "password"
    keyEl.placeholder = provider.builtin ? "API Key（sk-…）" : "API Key（可留空）"
    keyEl.value = provider.apiKey
    const keyLabel = document.createElement("label")
    keyLabel.className = "dialog-field"
    keyLabel.append(document.createTextNode("Key"), keyEl)

    const resultEl = document.createElement("p")
    const testBtn = document.createElement("button")
    testBtn.type = "button"
    testBtn.className = "ai-provider-test"
    testBtn.textContent = "测试"
    const testRow = document.createElement("div")
    testRow.className = "ai-provider-testrow"
    testRow.append(testBtn, resultEl)

    const temperature = aiSettings.temperature
    testBtn.addEventListener("click", () => {
      const models = parseList(modelsEl.value)
      resultEl.textContent = "连接中…"
      void testAiConnection({
        baseUrl: baseEl.value,
        apiKey: keyEl.value,
        model: models[0] ?? "",
        effort: "default",
        auth: provider.auth,
        tokenParam: provider.tokenParam,
        supportsThinking: thinkEl ? thinkEl.checked : provider.supportsThinking,
        supportsEffort: effortEl ? effortEl.checked : provider.supportsEffort,
        temperature,
      })
        .then((message) => {
          resultEl.textContent = message
        })
        .catch((err) => {
          resultEl.textContent = err instanceof Error ? err.message : String(err)
        })
    })

    block.append(baseLabel, modelsLabel, keyLabel, testRow)
    form.appendChild(block)
    rows.push({ provider, baseEl, modelsEl, keyEl, resultEl, thinkEl, effortEl })
  }

  const tempEl = document.createElement("input")
  tempEl.type = "number"
  tempEl.min = "0"
  tempEl.max = "2"
  tempEl.step = "0.1"
  tempEl.value = String(aiSettings.temperature)
  const tempLabel = document.createElement("label")
  tempLabel.className = "dialog-field"
  tempLabel.append(document.createTextNode("温度"), tempEl)

  const limitEl = document.createElement("select")
  const limitOptions: [string, string][] = [
    ["none", "不限制（交给接口默认）"],
    ["auto", "自动（按词格估一个保险丝）"],
  ]
  for (const [value, label] of limitOptions) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    limitEl.appendChild(option)
  }
  limitEl.value = aiSettings.maxOutput
  const limitLabel = document.createElement("label")
  limitLabel.className = "dialog-field"
  limitLabel.append(document.createTextNode("输出上限"), limitEl)

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  const ok = document.createElement("button")
  ok.type = "submit"
  ok.value = "ok"
  ok.textContent = "保存"
  actions.append(cancel, ok)

  form.append(tempLabel, limitLabel, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    dialog.remove()
    if (dialog.returnValue !== "ok") return
    const providers = rows.map(
      ({ provider, baseEl, modelsEl, keyEl, thinkEl, effortEl }) => ({
        ...provider,
        baseUrl: baseEl.value.trim(),
        models: parseList(modelsEl.value),
        apiKey: keyEl.value.trim(),
        supportsThinking: thinkEl ? thinkEl.checked : provider.supportsThinking,
        supportsEffort: effortEl ? effortEl.checked : provider.supportsEffort,
      }),
    )
    let providerId = aiSettings.providerId
    let model = aiSettings.model
    const currentProvider = providers.find((item) => item.id === providerId)
    if (currentProvider && !currentProvider.models.includes(model)) {
      model = currentProvider.models[0] ?? ""
    }
    if (!currentProvider || !model) {
      const fallback = providers.find(
        (item) => item.models.length > 0 && item.baseUrl.trim() !== "",
      )
      if (fallback) {
        providerId = fallback.id
        model = fallback.models[0]
      }
    }
    aiSettings = {
      providers,
      providerId,
      model,
      effort: aiSettings.effort,
      temperature: Number(tempEl.value) || 0.8,
      maxOutput: limitEl.value === "auto" ? "auto" : "none",
    }
    saveAiSettings(aiSettings)
    renderAiChips()
    setStatus("AI 设置已保存")
  })
  dialog.showModal()
}

function openAiPromptView(): void {
  const targets = aiTargetIds()
  const userText = aiInput.value.trim() || "（这里会带上你在输入框里写的要求）"
  const scopeLabel = AI_SCOPE_OPTIONS.find((option) => option.value === aiScope)?.label ?? "整首"
  const target = resolveTarget(aiSettings)
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "发给模型的提示词"

  const hint = document.createElement("p")
  hint.textContent = `系统提示词每次都一样；范围「${scopeLabel}」只影响下面第二段——标「→ 要写」的句子会让模型生成，其余只作上下文。当前模型：${
    target ? modelLabel(target.model) : "（还没配）"
  }`

  const sysTitle = document.createElement("div")
  sysTitle.className = "ai-provider-note"
  sysTitle.textContent = "① 系统提示词（固定）"
  const sysArea = document.createElement("textarea")
  sysArea.readOnly = true
  sysArea.className = "ai-pre"
  sysArea.value = buildSystemPrompt()

  const userTitle = document.createElement("div")
  userTitle.className = "ai-provider-note"
  userTitle.textContent = "② 本次请求（附在你说的话后面）"
  const userArea = document.createElement("textarea")
  userArea.readOnly = true
  userArea.className = "ai-pre"
  userArea.value = buildBrief(store.project, targets, userText)

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const close = document.createElement("button")
  close.type = "submit"
  close.value = "ok"
  close.textContent = "知道了"
  actions.appendChild(close)

  form.append(title, hint, sysTitle, sysArea, userTitle, userArea, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())
  dialog.showModal()
}

function initAiPanel(): void {
  if (!isDesktop()) {
    btnAi.disabled = true
    btnAi.title = "AI 填词仅桌面版可用（网页版暂不支持）"
    btnAi.setAttribute("aria-label", btnAi.title)
    return
  }
  initAiResizer()
  renderAiChips()
  updateAiSendButton()
  updateAiHint()
  btnAi.addEventListener("click", toggleAiPanel)
  document.querySelector("#btn-ai-close")?.addEventListener("click", closeAiPanel)
  document.querySelector("#btn-ai-settings")?.addEventListener("click", openAiSettings)
  document.querySelector("#btn-ai-prompt")?.addEventListener("click", openAiPromptView)
  aiModelChip.addEventListener("click", openModelPop)
  aiEffortChip.addEventListener("click", openEffortPop)
  document.querySelector("#btn-ai-clear")?.addEventListener("click", () => {
    aiBubbles = []
    renderAiMessages()
    setStatus("AI 对话已清空")
  })
  document.querySelector("#btn-ai-write-all")?.addEventListener("click", () => {
    setAiScope("all")
    void sendAi(aiInput.value.trim() || "按词格写完整首歌词。")
  })
  aiScopeChip.addEventListener("click", openScopePop)
  btnAiSend.addEventListener("click", () => {
    if (aiBusy) {
      aiAbort?.abort()
      return
    }
    void sendAi(aiInput.value)
  })
  aiInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    if (!aiBusy) void sendAi(aiInput.value)
  })
  if (localStorage.getItem(AI_OPEN_KEY) === "1") openAiPanel()
}

function refreshThemeButton(): void {
  themeBtn.textContent = themeIcon(themeState.pref)
  themeBtn.title = `主题：${themeLabel(themeState.pref)}（点击切换）`
  themeBtn.setAttribute("aria-label", themeBtn.title)
}

function setupMenu(
  buttonSel: string,
  menuSel: string,
  onPick: (id: string) => void,
): void {
  const btn = document.querySelector<HTMLButtonElement>(buttonSel)
  const menu = document.querySelector<HTMLElement>(menuSel)
  if (!btn || !menu) return
  let open = false
  const set = (value: boolean) => {
    open = value
    menu.hidden = !value
    btn.setAttribute("aria-expanded", String(value))
  }
  btn.addEventListener("click", (event) => {
    event.stopPropagation()
    set(!open)
  })
  menu.addEventListener("click", (event) => event.stopPropagation())
  document.addEventListener("click", () => set(false))
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") set(false)
  })
  menu.querySelectorAll("button").forEach((item) => {
    item.addEventListener("click", () => {
      set(false)
      onPick(item.id)
    })
  })
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

  document.querySelector("#btn-import-lyrics")?.addEventListener("click", () => openImportDialog())
  newDocBtn.addEventListener("click", addDoc)
  creditsBtn.addEventListener("click", openCreditsDialog)
  sourceBtn.addEventListener("click", () => {
    if (sourcePanel.hidden) openSourcePanel()
    else closeSourcePanel()
  })
  sourceCloseBtn.addEventListener("click", closeSourcePanel)
  statusPathEl.title = isDesktop()
    ? "点这里保存草稿备份（全部歌词文件）"
    : "点这里把全部歌词文件的草稿备份下载下来"
  statusPathEl.addEventListener("click", () => void exportDraftsBackup())
  reflowBtn.addEventListener("click", () => {
    store.pushUndo()
    const moved = reflowOverflow(store.project)
    if (!moved) {
      store.undoStack.pop()
      setStatus("没有溢出", true)
      return
    }
    store.ensureCursor()
    store.touch()
    render()
    focusCellInput()
    setStatus(`已顺移 ${moved} 个字`)
  })
  document.querySelector("#btn-save")?.addEventListener("click", () => void saveProject(false))
  document.querySelector("#btn-save-as")?.addEventListener("click", () => void saveProject(true))
  document.querySelector("#btn-open")?.addEventListener("click", () => void openProject())
  setupMenu("#btn-export", "#export-menu", (id) => {
    if (id === "menu-export-lyrics") void exportText()
    else if (id === "menu-export-grid") void exportGridText()
    else if (id === "menu-export-midi") void exportLyricMidi()
  })
  setupMenu("#btn-copy", "#copy-menu", (id) => {
    if (id === "menu-copy-lyrics") void copyLyrics()
    else if (id === "menu-copy-grid") void copyGrid()
  })
  undoBtn.addEventListener("click", doUndo)
  redoBtn.addEventListener("click", doRedo)
  clearAllBtn.addEventListener("click", clearAllCells)

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
      return
    }
    if (key === "[") {
      e.preventDefault()
      if (store.cursor.sentenceId) addCellHere(store.cursor.sentenceId)
      return
    }
    if (key === "]") {
      e.preventDefault()
      if (store.cursor.sentenceId) removeCellHere(store.cursor.sentenceId)
      return
    }
    if (key === "\\") {
      e.preventDefault()
      if (store.cursor.sentenceId) splitHere(store.cursor.sentenceId)
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
onAutosaveWrite((s) => {
  const doc = docsState.docs.find((d) => d.id === docsState.activeId)
  if (!doc) return
  doc.project = s.project
  doc.filePath = s.filePath
  doc.updatedAt = s.project.updatedAt
  saveDocs(docsState)
})
bindToolbar()
initSidebarResizer()
bindSelection()
bindDrop()
initAiPanel()
window.addEventListener("scroll", updateScrollProgress, { passive: true })
window.addEventListener("resize", updateScrollProgress)
render()
focusCellInput()

export type { Project }
