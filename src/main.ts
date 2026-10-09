import { copyText, readClipboardText } from "./clipboard"
import { fillMarkdown } from "./markdown"
import { APP_VERSION } from "./version"
import { emit, listen } from "@tauri-apps/api/event"
import { LogicalPosition } from "@tauri-apps/api/dpi"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import {
  getAllWindows,
  getCurrentWindow,
  type Window as TauriWindow,
} from "@tauri-apps/api/window"
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
  BUILTIN_PROVIDERS,
  EFFORT_LEVELS,
  PINNED_PROVIDER_IDS,
  THINKING_LEVELS,
  discoverModels,
  effortLevelsFor,
  effortOf,
  loadAiSettings,
  maxTokensFor,
  modelLabel,
  requestChat,
  resolveTarget,
  saveAiSettings,
  testAiConnection,
  withEffort,
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
  loadDocSnapshots,
  restoreDocSnapshot,
  snapshotDocs,
  parseDocsBackup,
  saveDocs,
  type DocRecord,
} from "./docs"
import { parseLyrics } from "./model/lyrics"
import {
  KEYSWITCH,
  buildLyricMidi,
  keyswitchCount,
  midiSourceText,
  midiTitle,
  midiToSections,
  noteTracks,
  parseMidi,
  pickMelodyTrack,
  type MidiFile,
  type MidiSection,
} from "./model/midi"
import { parsePattern, patternToString, totalCells } from "./model/pattern"
import { findMatches, replaceInSentence, type SearchMatch } from "./model/search"
import { diag, diagError, diagText, initDiag } from "./diag"
import {
  RHYME_LABEL_BY_KEY,
  charFitsRhyme,
  isEndingFilled,
  hanOnly,
  isHanChar,
  rhymeHue,
  rhymeOfCells,
  rhymeOfChar,
  cellLockAt,
  setCellLockAt,
  rhymeOfPinyin,
  charFitsConstraint,
  constraintText,
  pronunciationsOf,
  rhymeFinals,
  candidateChars,
} from "./model/rhyme"
import {
  addRhymeGroup,
  autoGroupByRhyme,
  dissolveRhymeGroup,
  groupAt,
  shiftCellRefs,
  dropCellRefs,
  replaceCellRefs,
  updateRhymeGroupConstraint,
  type RhymeAspect,
} from "./model/rhyme-groups"
import type { Project, RhymeConstraint, Section, Sentence } from "./model/types"
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
import { applyTheme, initTheme, themeIcon, themeLabel, themeState, type ThemePref } from "./theme"
import {
  applyMetaLayout,
  initMetaLayout,
  metaLayoutLabel,
  metaLayoutState,
  type MetaLayout,
} from "./sentence-meta"
import { bindZoomShortcuts, initZoom } from "./zoom"
import { callBridge, launchSv2, orderedChars, readBridgeState } from "./sv-bridge"

const sentencesEl = document.querySelector("#sentences") as HTMLElement
const scrollProgressEl = document.querySelector("#scroll-progress") as HTMLElement
const titleEl = document.querySelector("#project-title") as HTMLInputElement
const statusStatsEl = document.querySelector("#status-stats") as HTMLElement
const statusHintEl = document.querySelector("#status-hint") as HTMLElement
const statusPathEl = document.querySelector("#status-path") as HTMLElement
const statusAutosaveEl = document.querySelector("#status-autosave") as HTMLElement
const statusRhymeEl = document.querySelector("#status-rhyme") as HTMLElement
const statusGroupsEl = document.querySelector("#status-groups") as HTMLElement
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
const aiExportBarEl = document.querySelector("#ai-export-bar") as HTMLElement
const btnAiExportAll = document.querySelector("#btn-ai-export-all") as HTMLButtonElement
const aiExportCountEl = document.querySelector("#ai-export-count") as HTMLSpanElement
const aiExportThinkEl = document.querySelector("#ai-export-think") as HTMLInputElement
const btnAiExportGo = document.querySelector("#btn-ai-export-go") as HTMLButtonElement

/** AI 独立窗口模式：`?win=ai&doc=<docId>`——同一份页面，只挂 AI 面板，主工作区不渲染。
 *  主窗口那边的 AI 按钮负责开 / 聚焦这个窗（每篇歌词一个窗，关窗=隐藏，生成继续）。 */
const AI_WINDOW_MODE = new URLSearchParams(window.location.search).get("win") === "ai"
const AI_WINDOW_DOC_ID = new URLSearchParams(window.location.search).get("doc") ?? ""
const AI_WIN_GEO_KEY = "cige-grid-ai-win-geometry"

/** 文档栏独立窗口模式：`?win=docs`——同一份页面，只挂侧边栏。
 *  默认**不拆**（还是主窗口左侧边栏）；用户点「拆出」才拆，点「放回」或关窗即收回。 */
const DOCS_WINDOW_MODE = new URLSearchParams(window.location.search).get("win") === "docs"
const DOCS_DETACHED_KEY = "cige-grid-docs-detached"
const DOCS_WINDOW_LABEL = "docs"
const DOCS_SYNC_CHANNEL = "docs-sync"
const DOCS_INTENT_CHANNEL = "docs-intent"
const DOCS_READY_CHANNEL = "docs-ready"
const DOCS_REDOCK_CHANNEL = "docs-redock"

/** Windows 桌面版（主窗与拆出窗都用自绘标题栏；见下方 win-desktop 初始化） */
const IS_WINDOWS_DESKTOP = isDesktop() && /Windows/i.test(navigator.userAgent)

function aiWindowLabel(docId: string): string {
  return `ai-${docId}`
}
function syncChannel(docId: string): string {
  return `project-sync-${docId}`
}
function applyChannel(docId: string): string {
  return `ai-apply-${docId}`
}
function scopeChannel(docId: string): string {
  return `ai-scope-${docId}`
}
const AI_READY_CHANNEL = "ai-ready"
const AI_REDOCK_CHANNEL = "ai-redock"
/** 拖回主窗口时的停靠高亮（独立窗 → 主窗口） */
const DOCK_HOVER_AI = "ai-dock-hover"
const DOCK_HOVER_DOCS = "docs-dock-hover"
/** 拖出的独立窗与主窗口重叠到这个比例，就算"拖回来了" */
let aiDetached = false

/** 事件监听注册：失败（比如没有 IPC 环境）也别变成未处理的 rejection */
function listenQuiet(channel: string, handler: (event: { payload: unknown }) => void): void {
  try {
    void Promise.resolve(listen(channel, handler)).catch((err) => {
      diag("listen.failed", { channel, err: String(err) })
    })
  } catch (err) {
    diag("listen.failed", { channel, err: String(err) })
  }
}

/** 事件只发不收：发不出去（比如没有 IPC 环境）也别变成未处理的 rejection */
function emitQuiet(channel: string, payload: unknown): void {
  try {
    void Promise.resolve(emit(channel, payload)).catch((err) => {
      diag("emit.failed", { channel, err: String(err) })
    })
  } catch (err) {
    diag("emit.failed", { channel, err: String(err) })
  }
}

/** 主窗口 → AI 窗口的工程快照 */
interface ProjectSync {
  docId: string
  title: string
  project: Project
  /** 目标句子（scope 算好的）；null = 整首 */
  targetIds: string[] | null
  scope: string
}

/** AI 窗口里的 project 只是只读镜像（主窗口推快照过来） */
let projectMirror: Project | null = null
/** 主窗口随快照推来的目标句子（scope 已在主窗口算好） */
let projectMirrorTargetIds: string[] | null = null
function aiProject(): Project {
  return AI_WINDOW_MODE ? (projectMirror ?? store.project) : store.project
}

let composing = false
// 正在组字的那个输入框：render() 只在它仍然聚焦时才避让（防止 composition 卡死把整页冻住）
let composingInput: HTMLInputElement | null = null
// 组字刚结束置 true：紧接着的第一次 Backspace 原地不动、什么都不做，
// 避免删光拼音后连打删除键把前一格的字一起带走
let imeJustEnded = false
let statusOverride: { text: string; isError: boolean } | null = null
let statusOverrideTimer: ReturnType<typeof setTimeout> | null = null

// 选中的格子：句子 id → 格号集合（拖拽=一段；挑格模式里点格子=任意加减）
const pickedCells = new Map<string, Set<number>>()
// 挑格模式（Ctrl/⌘+G 切换）：点击格子加/减选择，不挪编辑光标
let pickSuppressClick = false
// 浮动条跟随的锚点：最后挑中的那格（挑格点击 / 拖拽终点）
let selectionAnchor: { sentenceId: string; index: number } | null = null
// "解散这个押韵组"小条：挑格模式里点到成员（没在选择中）时出现
let pickDissolve: { groupId: string } | null = null
let pickDissolveTimer: ReturnType<typeof setTimeout> | null = null
// 挑格模式下最近一次点格，用于识别"快速双击 = 取消勾选"
let pickLastClick: { sentenceId: string; index: number; time: number; wasPicked: boolean } | null = null
let pickMode = false
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

/** 开发版标记：只在 `npm run tauri dev` 的窗口里显示，打包后自动消失 */
const IS_DEV = import.meta.env.DEV

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
  } else if (pickMode) {
    // 挑格模式常驻提示：模式开没开一眼可见，按 G / Esc 必有反应
    statusHintEl.textContent = "挑格模式：点格子加/减 · 按 G 或 Esc 收起"
    statusHintEl.classList.remove("error")
  } else {
    // 默认不占位：快捷键都在「帮助」弹窗里了
    statusHintEl.textContent = ""
    statusHintEl.classList.remove("error")
  }

  undoBtn.disabled = !store.canUndo()
  redoBtn.disabled = !store.canRedo()

  const groupCount = (store.project.rhymeGroups ?? []).length
  statusGroupsEl.textContent = `韵组 ${groupCount}`
  statusGroupsEl.classList.toggle("dim", groupCount === 0)
  statusGroupsEl.hidden = docsState.docs.length === 0

  statusRhymeEl.textContent = rhymeSummaryText()

  updatePathStatus()
  statusAutosaveEl.textContent = autosaveState.at
    ? `已自动保存 ${autosaveState.at}`
    : "自动保存已开启"
  document.title = `${store.dirty ? "● " : ""}${store.project.title || "未命名"} · 作词助手${IS_DEV ? "（开发版）" : ""}`
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

const COLLAPSED_DOCS_KEY = "cige-grid-collapsed-docs"

function loadCollapsedDocs(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_DOCS_KEY)
    if (raw) {
      const list = JSON.parse(raw) as unknown
      if (Array.isArray(list)) {
        return new Set(list.filter((id): id is string => typeof id === "string"))
      }
    }
  } catch {
    // 忽略
  }
  return new Set()
}

const collapsedDocs = loadCollapsedDocs()

function saveCollapsedDocs(): void {
  try {
    localStorage.setItem(COLLAPSED_DOCS_KEY, JSON.stringify([...collapsedDocs]))
  } catch {
    // 忽略
  }
}

function toggleDocCollapsed(docId: string): void {
  if (collapsedDocs.has(docId)) collapsedDocs.delete(docId)
  else collapsedDocs.add(docId)
  saveCollapsedDocs()
  renderDocList()
}

/** 组头小图标：平时是文件夹，悬停换成折叠三角；展开 ▾ / 折叠 ▸（和文件夹同一个位置） */
function docToggleIcon(docId: string, collapsed: boolean): HTMLElement {
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = `doc-toggle${collapsed ? " collapsed" : ""}`
  btn.title = collapsed ? "展开会话" : "收起会话"
  btn.setAttribute("aria-label", btn.title)
  btn.innerHTML =
    '<span class="doc-folder">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
    "</span>" +
    '<span class="doc-caret">' +
    '<svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 11 8l-5.5 4.5Z" fill="currentColor"/></svg>' +
    "</span>"
  btn.addEventListener("click", (event) => {
    event.stopPropagation()
    toggleDocCollapsed(docId)
  })
  return btn
}

function convoBody(list: AiConversation[], key: string): HTMLElement {
  const body = document.createElement("div")
  body.className = "convo-group-body"
  const expanded = convosExpandedGroups.has(key)
  const visible = expanded ? list : list.slice(0, CONVO_PREVIEW_COUNT)
  for (const convo of visible) body.appendChild(convoRow(convo))
  if (!expanded && list.length > CONVO_PREVIEW_COUNT) {
    const more = document.createElement("button")
    more.type = "button"
    more.className = "ai-convo-more"
    more.textContent = `展开其余 ${list.length - CONVO_PREVIEW_COUNT} 个会话`
    more.addEventListener("click", () => {
      convosExpandedGroups.add(key)
      renderDocList()
    })
    body.appendChild(more)
  }
  return body
}

let sidebarRenderedSig = ""

function sidebarSig(): string {
  return `${docsState.activeId}\u0001${activeConvoId}\u0001${convos
    .map((convo) => `${convo.id}\u0000${convo.docId ?? ""}\u0000${convo.title}\u0000${convo.updatedAt}`)
    .join("\u0002")}`
}

/** 工作区树只在会话/选中状态真有变化时重建（渲染 AI 消息不必每次刷侧栏） */
function refreshDocListIfChanged(): void {
  if (sidebarSig() === sidebarRenderedSig) return
  renderDocList()
}

/** 工作区：每一首歌一张卡片（组头 = 歌词行，卡片里是它的 AI 对话） */
function renderDocList(): void {
  docListEl.replaceChildren()
  const showConvos = isDesktop()
  for (const doc of docsState.docs) {
    const card = document.createElement("div")
    card.className = "doc-card"

    const item = document.createElement("div")
    item.className = `doc-item${doc.id === docsState.activeId ? " active" : ""}`
    item.title = doc.filePath ?? "未保存到文件"
    item.appendChild(docToggleIcon(doc.id, collapsedDocs.has(doc.id)))

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
    card.appendChild(item)

    if (showConvos && !collapsedDocs.has(doc.id)) {
      const list = convos
        .filter((convo) => convo.docId === doc.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      if (list.length > 0) card.appendChild(convoBody(list, doc.id))
    }
    docListEl.appendChild(card)
  }
  sidebarRenderedSig = sidebarSig()
  if (!DOCS_WINDOW_MODE) scheduleDocsSync()
}

function renameDoc(docId: string, rawName: string): void {
  if (DOCS_WINDOW_MODE) {
    emitQuiet(DOCS_INTENT_CHANNEL, { type: "rename", id: docId, name: rawName })
    return
  }
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
  syncAiConvoToDoc()
}

function switchDoc(id: string): void {
  if (DOCS_WINDOW_MODE) {
    emitQuiet(DOCS_INTENT_CHANNEL, { type: "activate", id })
    return
  }
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

/** 建一份新的空歌词并切过去（「新建歌词」按钮和「新建导入」共用） */
function addDocCore(): void {
  syncActiveDoc()
  const doc = createDoc(`未命名 ${docsState.docs.length + 1}`)
  docsState.docs.push(doc)
  docsState.activeId = doc.id
  // 新建歌词自动带一条新会话
  const convo = createConvo(doc.id)
  convos.unshift(convo)
  setActiveConvo(convo.id)
  activateDoc(doc)
  persistDocs()
  render()
}

function addDoc(): void {
  if (DOCS_WINDOW_MODE) {
    emitQuiet(DOCS_INTENT_CHANNEL, { type: "new-doc" })
    return
  }
  addDocCore()
  titleEl.focus()
  titleEl.select()
  setStatus("已新建歌词文件")
}

function deleteDoc(id: string): void {
  if (DOCS_WINDOW_MODE) {
    emitQuiet(DOCS_INTENT_CHANNEL, { type: "delete", id })
    return
  }
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
  if (collapsedDocs.delete(id)) saveCollapsedDocs()
  // 这个文件的 AI 对话一起删掉（面板怎么收在结尾统一处理）
  if (convos.some((convo) => convo.docId === id)) {
    convos = convos.filter((convo) => convo.docId !== id)
    persistConvos(false)
  }
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
  // AI 面板跟着收拾：当前会话可能刚被删掉；一篇歌词都不剩了，也不留会话
  if (docsState.docs.length === 0 || (activeConvoId && !convos.some((convo) => convo.id === activeConvoId))) {
    activeConvoId = ""
    syncTurnsFromConvo()
  } else if (docsState.activeId) {
    syncAiConvoToDoc()
  }
  renderAiMessages(false)
  setStatus(`已删除「${name}」`)
}

function openSourcePanel(): void {
  closeAiPanel()
  sourcePanel.hidden = false
  document.documentElement.classList.add("source-open")
  sourceTextEl.value = store.project.source ?? ""
}

function closeSourcePanel(): void {
  sourcePanel.hidden = true
  document.documentElement.classList.remove("source-open")
}

function syncSourcePanel(): void {
  const hasSource = !!store.project.source
  sourceBtn.hidden = !hasSource
  sourceTextEl.value = store.project.source ?? ""
  if (!hasSource) closeSourcePanel()
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
  // 组字期间绝不重绘（换掉输入框会打断输入法）；卡死状态由 pointerdown 兜底收掉
  if (composing) return
  // AI 独立窗口：没有主工作区要画
  if (AI_WINDOW_MODE) return
  const renderStarted = performance.now()
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
  // 选中集合的失效清理：句子没了 / 格号越界就从集合里剔掉
  for (const [sentenceId, set] of [...pickedCells]) {
    const sentence = store.findSentence(sentenceId)
    if (!sentence) {
      pickedCells.delete(sentenceId)
      continue
    }
    const total = totalCells(sentence.pattern)
    for (const index of [...set]) {
      if (index < 0 || index >= total) set.delete(index)
    }
    if (set.size === 0) pickedCells.delete(sentenceId)
  }
  paintSelection()
  paintGroupLit()
  syncFind()
  // replaceChildren 会先清空容器，高度瞬间归零导致 scrollTop 被钳到 0，这里补回
  if (window.scrollY !== prevScrollY) window.scrollTo(0, prevScrollY)
  updateScrollProgress()
  const renderMs = performance.now() - renderStarted
  if (renderMs > 50) {
    const sentences = allSentences(store.project)
    diag("render.slow", {
      ms: Math.round(renderMs),
      sentences: sentences.length,
      cells: sentences.reduce((sum, item) => sum + totalCells(item.pattern), 0),
    })
  }
}

/** 只重画某一句（就地替换旧节点）。找不到就返回 false，交调用方退回全量 */
function repaintSentence(sentenceId: string): boolean {
  const sentence = store.findSentence(sentenceId)
  if (!sentence) return false
  const root = sentencesEl.querySelector<HTMLElement>(`.sentence[data-id="${sentenceId}"]`)
  if (!root) return false
  const index = allSentences(store.project).findIndex((item) => item.id === sentenceId)
  root.replaceWith(renderSentence(sentence, index))
  paintGroupLit()
  return true
}

/** 轻量重画一批句子 + 状态栏 / 查找高亮 / 框选高亮；任何一句找不到就退回全量 */
function repaintSentences(ids: Iterable<string>): void {
  const list = [...new Set(ids)].filter((id) => store.findSentence(id) !== undefined)
  let ok = true
  for (const id of list) {
    if (!repaintSentence(id)) ok = false
  }
  if (!ok) {
    render()
    return
  }
  renderStatusBar()
  syncFind()
  paintSelection()
}

/** 单句编辑（打字、删格、挪动、加锁…）：只重画这一句，别整页重建 */
function mutateSentence(sentenceId: string, fn: () => void): void {
  store.pushUndo()
  fn()
  store.ensureCursor()
  store.touch()
  repaintSentences([sentenceId])
}

/** 换格：只重画旧句 + 新句，不整页重建 */
function moveCursorInPlace(next: { sentenceId: string; cell: number }): void {
  const prev = store.cursor.sentenceId
  store.cursor = next
  repaintSentences(prev && prev !== next.sentenceId ? [prev, next.sentenceId] : [next.sentenceId])
  focusCellInput()
}

function clearSelection(): void {
  clearGroupDissolve()
  pickedCells.clear()
  pickLastClick = null
  selectionAnchor = null
  paintSelection()
}

function consumeJustDragged(): boolean {
  if (!justDragged) return false
  justDragged = false
  return true
}

/** 把"选中的格子集合"按句归拢成连续段（复制/删除/AI 范围都吃这个） */
function selectionSpans(): { sentence: Sentence; from: number; to: number }[] {
  if (pickedCells.size === 0) return []
  const spans: { sentence: Sentence; from: number; to: number }[] = []
  for (const sentence of allSentences(store.project)) {
    const set = pickedCells.get(sentence.id)
    if (!set || set.size === 0) continue
    const total = totalCells(sentence.pattern)
    const indexes = [...set].filter((index) => index >= 0 && index < total).sort((a, b) => a - b)
    let start = -1
    let prev = -1
    for (const index of indexes) {
      if (start < 0) {
        start = index
        prev = index
        continue
      }
      if (index === prev + 1) {
        prev = index
        continue
      }
      spans.push({ sentence, from: start, to: prev })
      start = index
      prev = index
    }
    if (start >= 0) spans.push({ sentence, from: start, to: prev })
  }
  return spans
}

/** 用一段连续区间**替换**当前选择（拖拽框选、⌘A 用） */
function setSelectionBetween(
  a: { sentenceId: string; cell: number },
  b: { sentenceId: string; cell: number },
): void {
  pickedCells.clear()
  const ordered = allSentences(store.project)
  const ai = ordered.findIndex((s) => s.id === a.sentenceId)
  const bi = ordered.findIndex((s) => s.id === b.sentenceId)
  if (ai < 0 || bi < 0) return
  const forward = ai < bi || (ai === bi && a.cell <= b.cell)
  const from = forward ? a : b
  const to = forward ? b : a
  const fromIndex = ordered.findIndex((s) => s.id === from.sentenceId)
  const toIndex = ordered.findIndex((s) => s.id === to.sentenceId)
  for (let i = fromIndex; i <= toIndex; i++) {
    const sentence = ordered[i]
    const total = totalCells(sentence.pattern)
    const start = i === fromIndex ? Math.max(0, from.cell) : 0
    const end = i === toIndex ? Math.min(total - 1, to.cell) : total - 1
    if (end < start) continue
    const set = new Set<number>()
    for (let index = start; index <= end; index++) set.add(index)
    pickedCells.set(sentence.id, set)
  }
}

/** 把一格加入/移出选择（挑格模式下点格子调用；可跨句任意挑） */
/** 把一格移出选择（快速双击取消时用；不在选择里就什么也不做） */
function unpickCell(sentenceId: string, index: number): void {
  clearGroupDissolve()
  const set = pickedCells.get(sentenceId)
  if (!set?.has(index)) return
  set.delete(index)
  if (set.size === 0) pickedCells.delete(sentenceId)
  if (selectionAnchor?.sentenceId === sentenceId && selectionAnchor.index === index) {
    selectionAnchor = null
  }
  paintSelection()
}

function togglePicked(sentenceId: string, index: number): void {
  clearGroupDissolve()
  const set = pickedCells.get(sentenceId) ?? new Set<number>()
  if (set.has(index)) set.delete(index)
  else set.add(index)
  if (set.size === 0) pickedCells.delete(sentenceId)
  else pickedCells.set(sentenceId, set)
  // 浮动条跟着最后挑中的那格走
  if (pickedCells.get(sentenceId)?.has(index)) selectionAnchor = { sentenceId, index }
  else if (selectionAnchor?.sentenceId === sentenceId && selectionAnchor.index === index) {
    selectionAnchor = null
  }
  paintSelection()
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
  syncNativeSelection()
  refreshPickBar()
}

function removeSelectedCells(): void {
  const spans = selectionSpans()
  if (spans.length === 0) return
  clearSelection()
  store.pushUndo()
  for (const span of spans) {
    const sentence = store.findSentence(span.sentence.id)
    if (!sentence) continue
    const cells = getCells(sentence).slice()
    for (let i = span.from; i <= span.to; i++) cells[i] = ""
    setCells(sentence, cells)
  }
  store.touch()
  repaintSentences(spans.map((span) => span.sentence.id))
  focusCellInput()
  setStatus("已清空选中的格子")
}

/** 框选中的字：每句一行，只算有字的格子 */
function selectedCellsText(): string {
  return selectionSpans()
    .map((span) => getCells(span.sentence).slice(span.from, span.to + 1).filter(Boolean).join(""))
    .join("\n")
}

// 隐藏镜像：框选时把系统选区同步成选中的字，这样「右键 → 复制」也拿到选中的内容
const copyMirror = document.createElement("div")
copyMirror.className = "copy-mirror"
copyMirror.setAttribute("aria-hidden", "true")
document.body.appendChild(copyMirror)

let mirrorActive = false

function syncNativeSelection(): void {
  const text = selectedCellsText()
  const native = window.getSelection()
  if (text) {
    copyMirror.textContent = text
    if (native) {
      native.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(copyMirror)
      native.addRange(range)
    }
    mirrorActive = true
    return
  }
  // 没有框选、也从没设置过镜像 → 绝不去碰系统选区（打字时动它会把输入法组字打断）
  if (!mirrorActive) return
  copyMirror.textContent = ""
  native?.removeAllRanges()
  mirrorActive = false
}

async function copySelection(): Promise<void> {
  const spans = selectionSpans()
  if (spans.length === 0) return
  const text = selectedCellsText()
  const count = [...text.replace(/\n/g, "")].length
  const ok = await copyText(text)
  setStatus(ok ? `已复制 ${count} 个字` : "复制失败", !ok)
  clearSelection()
}

function setPickMode(on: boolean): void {
  pickMode = on
  clearGroupDissolve()
  pickLastClick = null
  document.body.classList.toggle("pick-mode", on)
  if (on) {
    // 进模式先把焦点从输入框移开：G / Esc 才收得动，输入法也不会截键
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable)
    ) {
      active.blur()
    }
  } else {
    clearSelection()
  }
  setStatus(on ? "挑格模式：点格子加/减（按 G 或 Esc 收起）" : "已退出挑格模式（选择已清空）")
}

/** Ctrl/⌘ + G：切换"挑格模式"；模式中直接按 G / Esc = 收起（退模式 + 清空选择）。输入框里不抢 g 的打字 */
function bindPickMode(): void {
  window.addEventListener("keydown", (event) => {
    if (event.isComposing || event.repeat) return
    const target = event.target as HTMLElement | null
    const isCellInput = target instanceof HTMLInputElement && target.classList.contains("cell-input")
    const typing =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target?.isContentEditable)
    // 按 G：收起——在模式里就退模式；没模式但有选中（拖拽/⌘A 选的）就取消选中
    // 格子输入框里也收（焦点常留在格子里）；真正的文本框（备注 / AI 输入）不抢 g 的打字
    if (
      (!typing || isCellInput) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "g"
    ) {
      if (!pickMode && pickedCells.size === 0) return
      event.preventDefault()
      if (pickMode) setPickMode(false)
      else clearSelection()
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    if (event.key.toLowerCase() !== "g") return
    if (!isCellInput && typing) return
    event.preventDefault()
    setPickMode(!pickMode)
  })
}

function bindSelection(): void {
  sentencesEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    const cell = (event.target as HTMLElement).closest<HTMLElement>(".cell, .cell-input")
    if (!cell) return
    if (pickMode) {
      // 挑格子：不挪编辑光标、不进拖拽流程（pointerup 也就不会清空选择）
      event.preventDefault()
      pickSuppressClick = true
      const sentenceId = cell.dataset.sentenceId ?? ""
      const index = Number(cell.dataset.index)
      // 已在押韵组里的格子：挑不动——整组闪一下提示（一次性，不常亮）
      const sentence = store.findSentence(sentenceId)
      const existingGroup = sentence ? groupAt(store.project, sentence, index) : null
      if (existingGroup) {
        pickLastClick = null
        flashGroup(existingGroup.id)
        showGroupDissolveBar(existingGroup.id)
        setStatus(`这一格已经在韵组里（${constraintText(existingGroup.constraint)}）——点条上的「解散这个韵组」可以解散；已挑的格子不受影响`)
        return
      }
      const picked = pickedCells.get(sentenceId)?.has(index) ?? false
      const now = Date.now()
      if (
        pickLastClick !== null &&
        pickLastClick.sentenceId === sentenceId &&
        pickLastClick.index === index &&
        now - pickLastClick.time <= 500
      ) {
        // 快速双击 = 只算一次点击：看"第一下之前"是什么状态（已选→取消；没选→选上），误点了双击就退
        if (pickLastClick.wasPicked) unpickCell(sentenceId, index)
        else if (!picked) togglePicked(sentenceId, index)
        pickLastClick = null
      } else {
        pickLastClick = { sentenceId, index, time: now, wasPicked: picked }
        togglePicked(sentenceId, index)
      }
      return
    }
    pickSuppressClick = false
    justDragged = false
    dragStart = {
      sentenceId: cell.dataset.sentenceId ?? "",
      index: Number(cell.dataset.index),
      moved: false,
    }
    selectionAnchor = { sentenceId: dragStart.sentenceId, index: dragStart.index }
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
    setSelectionBetween(
      { sentenceId: dragStart.sentenceId, cell: dragStart.index },
      { sentenceId, cell: index },
    )
    selectionAnchor = { sentenceId, index }
    paintSelection()
  })

  // 任何一次 click 结束后兜底清掉"挑格点击抑制"：点到光标格（input）时没有格子按钮来消费它
  document.addEventListener("click", (event) => {
    pickSuppressClick = false
    if (!pickDissolve) return
    const target = event.target as HTMLElement | null
    if (target?.closest(".pick-bar, .cell, .cell-input, dialog")) return
    clearGroupDissolve()
    refreshPickBar()
  })

  document.addEventListener("pointerup", () => {
    if (!dragStart) {
      refreshPickBar()
      return
    }
    if (dragStart.moved) justDragged = true
    else clearSelection()
    dragStart = null
    refreshPickBar()
  })
  document.addEventListener("pointercancel", () => {
    dragStart = null
  })

  document.addEventListener(
    "keydown",
    (event) => {
      // ⌘A / Ctrl+A：全选这首歌词的格子（而不是把整页文字都选上）
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target?.isContentEditable
        ) {
          return
        }
        const ordered = allSentences(store.project)
        const first = ordered[0]
        const last = ordered[ordered.length - 1]
        if (!first || !last) return
        event.preventDefault()
        setSelectionBetween(
          { sentenceId: first.id, cell: 0 },
          { sentenceId: last.id, cell: totalCells(last.pattern) - 1 },
        )
        selectionAnchor = null
        paintSelection()
        return
      }
      if (!event.isComposing && event.key === "Escape" && pickMode) {
        event.preventDefault()
        setPickMode(false)
        return
      }
      if (!event.isComposing && event.key === "Escape" && pickedCells.size === 0 && pickDissolve) {
        event.preventDefault()
        clearGroupDissolve()
        refreshPickBar()
        return
      }
      if (pickedCells.size === 0) return
      if (!event.isComposing && event.key === "Escape") {
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

const findPanel = document.createElement("div")
findPanel.className = "find-panel"
findPanel.hidden = true
findPanel.innerHTML = `
  <div class="find-row">
    <span class="find-label">查找</span>
    <input class="find-input" type="text" autocomplete="off" spellcheck="false" placeholder="输入查找词" />
    <button class="find-prev" type="button" title="上一处（Shift+Enter）">‹</button>
    <span class="find-count">0/0</span>
    <button class="find-next" type="button" title="下一处（Enter）">›</button>
    <button class="find-close" type="button" title="关闭（Esc）">✕</button>
  </div>
  <div class="find-row">
    <span class="find-label">替换</span>
    <input class="find-replace" type="text" autocomplete="off" spellcheck="false" placeholder="替换词为空时，删掉命中的格子" />
    <button class="find-replace-one" type="button">替换</button>
    <button class="find-replace-all primary" type="button">全曲替换</button>
  </div>
  <div class="find-note">替换会按字数增删格子（词格跟着变），可一次撤销</div>
`
document.body.appendChild(findPanel)

const findInput = findPanel.querySelector<HTMLInputElement>(".find-input")!
const findReplaceInput = findPanel.querySelector<HTMLInputElement>(".find-replace")!
const findCountEl = findPanel.querySelector<HTMLElement>(".find-count")!
const findReplaceOneBtn = findPanel.querySelector<HTMLButtonElement>(".find-replace-one")!
const findReplaceAllBtn = findPanel.querySelector<HTMLButtonElement>(".find-replace-all")!

let findMatchList: SearchMatch[] = []
let findIndex = 0

function openFindPanel(): void {
  findPanel.hidden = false
  findIndex = 0
  syncFind()
  findInput.focus()
  findInput.select()
  scrollToCurrentMatch()
}

function closeFindPanel(): void {
  findPanel.hidden = true
  document
    .querySelectorAll(".cell.find-hit, .cell-input.find-hit")
    .forEach((el) => el.classList.remove("find-hit", "current"))
  focusCellInput()
}

function toggleFindPanel(): void {
  if (findPanel.hidden) openFindPanel()
  else closeFindPanel()
}

function syncFind(): void {
  if (findPanel.hidden) return
  findMatchList = findMatches(allSentences(store.project), findInput.value)
  findIndex = findMatchList.length === 0 ? 0 : Math.min(findIndex, findMatchList.length - 1)
  paintFindHits()
  updateFindCount()
}

function updateFindCount(): void {
  const total = findMatchList.length
  findCountEl.textContent = total === 0 ? "0/0" : `${findIndex + 1}/${total}`
  findReplaceAllBtn.textContent = total > 0 ? `全曲替换 ${total}` : "全曲替换"
  findReplaceOneBtn.disabled = total === 0
  findReplaceAllBtn.disabled = total === 0
}

function paintFindHits(): void {
  document
    .querySelectorAll(".cell.find-hit, .cell-input.find-hit")
    .forEach((el) => el.classList.remove("find-hit", "current"))
  if (findPanel.hidden) return
  findMatchList.forEach((match, index) => {
    const root = document.querySelector<HTMLElement>(`.sentence[data-id="${match.sentenceId}"]`)
    if (!root) return
    root.querySelectorAll<HTMLElement>(".cell, .cell-input").forEach((el) => {
      const cellIndex = Number(el.dataset.index)
      if (cellIndex < match.start || cellIndex >= match.start + match.length) return
      el.classList.add("find-hit")
      if (index === findIndex) el.classList.add("current")
    })
  })
}

function scrollToCurrentMatch(): void {
  const match = findMatchList[findIndex]
  if (!match) return
  document
    .querySelector<HTMLElement>(
      `.sentence[data-id="${match.sentenceId}"] .cell.current, .sentence[data-id="${match.sentenceId}"] .cell-input.current`,
    )
    ?.scrollIntoView({ block: "center", behavior: "smooth" })
}

function goFind(delta: number): void {
  if (findMatchList.length === 0) return
  findIndex = (findIndex + delta + findMatchList.length) % findMatchList.length
  paintFindHits()
  updateFindCount()
  scrollToCurrentMatch()
}

function findReplacement(): string | null {
  const raw = findReplaceInput.value
  const replacement = hanOnly(raw)
  if (raw.trim() !== "" && replacement === "") {
    setStatus("只收汉字：替换词里没有汉字", true)
    return null
  }
  return replacement
}

function replaceCurrentMatch(): void {
  if (findMatchList.length === 0) return
  const match = findMatchList[findIndex]
  const sentence = store.findSentence(match.sentenceId)
  if (!sentence) return
  const replacement = findReplacement()
  if (replacement === null) return
  const afterStart = match.start + [...replacement].length
  mutate(() => {
    replaceCellRefs(sentence, match.start, match.length, [...replacement].length)
    replaceInSentence(sentence, match.start, match.length, replacement)
  })
  findMatchList = findMatches(allSentences(store.project), findInput.value)
  const at = findMatchList.findIndex(
    (item) => item.sentenceId === sentence.id && item.start >= afterStart,
  )
  findIndex = at >= 0 ? at : 0
  paintFindHits()
  updateFindCount()
  scrollToCurrentMatch()
  setStatus(
    findMatchList.length > 0 ? `已替换 1 处（还剩 ${findMatchList.length} 处）` : "已替换 1 处",
  )
}

function replaceAllMatches(): void {
  if (findMatchList.length === 0) return
  const total = findMatchList.length
  const replacement = findReplacement()
  if (replacement === null) return
  const bySentence = new Map<string, SearchMatch[]>()
  for (const match of findMatchList) {
    const list = bySentence.get(match.sentenceId) ?? []
    list.push(match)
    bySentence.set(match.sentenceId, list)
  }
  mutate(() => {
    for (const [sentenceId, list] of bySentence) {
      const sentence = store.findSentence(sentenceId)
      if (!sentence) continue
      for (const match of [...list].sort((a, b) => b.start - a.start)) {
        replaceCellRefs(sentence, match.start, match.length, [...replacement].length)
    replaceInSentence(sentence, match.start, match.length, replacement)
      }
    }
  })
  findIndex = 0
  syncFind()
  scrollToCurrentMatch()
  setStatus(`已全曲替换 ${total} 处`)
}

function initFindPanel(): void {
  const btnFind = document.querySelector<HTMLButtonElement>("#btn-find")
  btnFind?.addEventListener("click", toggleFindPanel)
  findPanel.querySelector(".find-close")?.addEventListener("click", closeFindPanel)
  findPanel.querySelector(".find-prev")?.addEventListener("click", () => goFind(-1))
  findPanel.querySelector(".find-next")?.addEventListener("click", () => goFind(1))
  findReplaceOneBtn.addEventListener("click", replaceCurrentMatch)
  findReplaceAllBtn.addEventListener("click", replaceAllMatches)
  findInput.addEventListener("input", () => {
    findIndex = 0
    syncFind()
    scrollToCurrentMatch()
  })
  for (const input of [findInput, findReplaceInput]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        goFind(event.shiftKey ? -1 : 1)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        closeFindPanel()
      }
    })
  }
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

/** 在这一句下面插一句：词格沿用这一句 */
function addSentenceAfter(sentenceId: string): void {
  const source = store.findSentence(sentenceId)
  if (!source) return
  const pattern = source.pattern.slice()
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
}

/** 在本段末尾加一句：词格沿用本段最后一句（空段默认 4+4） */
function addSentenceToSection(sectionId: string): void {
  const section = store.project.sections.find((s) => s.id === sectionId)
  if (!section) return
  const last = section.sentences[section.sentences.length - 1]
  const pattern = last ? last.pattern.slice() : [4, 4]
  mutate(() => {
    const target = store.project.sections.find((s) => s.id === sectionId)
    if (!target) return
    const sentence = createSentence(pattern)
    target.sentences.push(sentence)
    store.cursor = { sentenceId: sentence.id, cell: 0 }
  })
  setStatus("已加句")
  focusCellInput()
}

function addHarmonyToSection(sectionId: string): void {
  const section = store.project.sections.find((s) => s.id === sectionId)
  if (!section) return
  const prev = section.sentences[section.sentences.length - 1]
  const pattern = prev ? prev.pattern.slice() : [4, 4]
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

/** 押韵组高亮：所有组同色；光标在哪格，同组所有格子亮起 */
function applyGroupClasses(el: HTMLElement, sentence: Sentence, index: number): void {
  const group = groupAt(store.project, sentence, index)
  if (!group) return
  el.classList.add("group-member")
  const cursorSentence = store.findSentence(store.cursor.sentenceId)
  const activeGroup = cursorSentence
    ? groupAt(store.project, cursorSentence, store.cursor.cell)
    : null
  if (activeGroup?.id === group.id) el.classList.add("group-lit")
}

/**
 * 押韵组的显示规则（用户定稿）：只显示"当前格所在的组"——
 * 光标在哪一格，同组所有格子整格亮起（跨句同步）；光标不在组里就不显示任何标记。
 * 只切类不重画，挂在 render / repaintSentence 尾部。
 */
function paintGroupLit(): void {
  const cursorSentence = store.findSentence(store.cursor.sentenceId)
  const activeGroup = cursorSentence ? groupAt(store.project, cursorSentence, store.cursor.cell) : null
  document
    .querySelectorAll<HTMLElement>(".cell.group-member, .cell-input.group-member")
    .forEach((el) => {
      const sentence = store.findSentence(el.dataset.sentenceId ?? "")
      const index = Number(el.dataset.index)
      const group = sentence ? groupAt(store.project, sentence, index) : null
      el.classList.toggle(
        "group-lit",
        group !== null && activeGroup !== null && group.id === activeGroup.id,
      )
    })
}

/** 当前 DOM 里属于这个组的所有格子元素 */
function groupMemberEls(groupId: string): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(".cell.group-member, .cell-input.group-member"),
  ].filter((el) => {
    const sentence = store.findSentence(el.dataset.sentenceId ?? "")
    const group = sentence ? groupAt(store.project, sentence, Number(el.dataset.index)) : null
    return group?.id === groupId
  })
}

/** 整组闪一下（一次性，不常亮）：挑格模式里点到已有组的格子时提示 */
let groupFlashTimer: ReturnType<typeof setTimeout> | null = null
let groupFlashEls: HTMLElement[] = []
function flashGroup(groupId: string): void {
  if (groupFlashTimer) clearTimeout(groupFlashTimer)
  for (const el of groupFlashEls) el.classList.remove("group-flash")
  groupFlashEls = groupMemberEls(groupId)
  for (const el of groupFlashEls) {
    void el.offsetWidth // 强制回流，保证连续点击时动画能重新开始
    el.classList.add("group-flash")
  }
  groupFlashTimer = setTimeout(() => {
    for (const el of groupFlashEls) el.classList.remove("group-flash")
    groupFlashEls = []
    groupFlashTimer = null
  }, 650)
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
    mutateSentence(sentence.id, () => {
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
    mutateSentence(sentence.id, () => {
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
    mutateSentence(sentence.id, () => {
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
        applyGroupClasses(input, sentence, i)
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
        applyGroupClasses(cell, sentence, i)
        cell.addEventListener("click", () => {
          if (consumeJustDragged()) return
          if (pickSuppressClick) {
            pickSuppressClick = false
            return
          }
          moveCursorInPlace({ sentenceId: sentence.id, cell: i })
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

  // 逐格韵辙锁：徽章看"正在看的那一格"——光标在哪格看哪格；
  // 光标不在本句时看最后有字的一格（都没有就看句尾）
  const lastIndex = Math.max(0, cells.length - 1)
  const cursorHere = store.cursor.sentenceId === sentence.id
  let watchIndex = Math.min(Math.max(0, store.cursor.cell), lastIndex)
  if (!cursorHere) {
    watchIndex = lastIndex
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i]) {
        watchIndex = i
        break
      }
    }
  }
  const watchChar = cells[watchIndex] ?? ""
  const watchRhyme = watchChar ? rhymeOfChar(watchChar) : null
  const watchLock = cellLockAt(sentence, watchIndex)
  const lockLabel = RHYME_LABEL_BY_KEY.get(watchLock)
  const badge = document.createElement("span")
  if (lockLabel) {
    const mismatch = watchRhyme !== null && watchRhyme.key !== watchLock
    badge.className = mismatch ? "rhyme-badge locked mismatch" : "rhyme-badge locked"
    badge.textContent = `${lockLabel} 🔒`
    badge.title = mismatch && watchRhyme
      ? `第 ${watchIndex + 1} 格已锁「${lockLabel}」，但这里是「${watchRhyme.char}」（${watchRhyme.label}），不合辙 · 点击解锁`
      : `第 ${watchIndex + 1} 格已锁「${lockLabel}」· 点击解锁`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(watchLock)))
  } else if (watchRhyme) {
    badge.className = "rhyme-badge"
    badge.textContent = watchRhyme.label.replace(/辙$/, "")
    badge.title = `第 ${watchIndex + 1} 格「${watchRhyme.char}」· 韵母 ${watchRhyme.final} · ${watchRhyme.label} · 点击给这格加锁`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(watchRhyme.key)))
  } else if (watchIndex === lastIndex && RHYME_LABEL_BY_KEY.get(sentence.rhymeHint ?? "")) {
    const hintKey = sentence.rhymeHint as string
    const hintLabel = RHYME_LABEL_BY_KEY.get(hintKey) as string
    badge.className = "rhyme-badge pending"
    badge.textContent = hintLabel.replace(/辙$/, "")
    badge.title = `清空时记住的辙「${hintLabel}」（未锁）· 点击给句尾加锁`
    badge.style.setProperty("--rhyme-hue", String(rhymeHue(hintKey)))
  } else {
    badge.className = "rhyme-badge empty"
    badge.textContent = "＋ 锁"
    badge.title = `给第 ${watchIndex + 1} 格加锁：写这格时只允许押这个辙的字`
  }
  badge.addEventListener("click", (event) => {
    event.stopPropagation()
    openRhymeLockDialog(sentence.id, watchIndex, watchLock)
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
const SIDEBAR_DEFAULT_WIDTH = 240
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 400

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

/** 工具栏高度不固定（会换行），量出来给面板吸顶 / 高度算 */
function trackTopbarHeight(): void {
  const topbar = document.querySelector<HTMLElement>(".topbar")
  if (!topbar) return
  const apply = () => {
    document.documentElement.style.setProperty(
      "--topbar-h",
      `${Math.round(topbar.getBoundingClientRect().height)}px`,
    )
  }
  apply()
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(apply).observe(topbar)
  }
  window.addEventListener("resize", apply)
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
      // 已经拆出去了：展开按钮的活儿变成"把文档栏窗聚焦回来"
      if (document.documentElement.classList.contains("docs-detached")) {
        void focusDocsWindow()
        return
      }
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
  moveCursorInPlace({ sentenceId: next.id, cell: nextCell })
}

document.addEventListener(
  "pointerdown",
  (event) => {
    // 点到正在组字的输入框以外的任何地方 = 放弃这次组字（唯一的强制收口，
    // 用来解开"compositionend 永远不来"的卡死；blur/切窗不清，免得误伤输入法）
    if (composing && composingInput && event.target !== composingInput) {
      restoreComposingBadge()
      diag("ime.forced-clear")
      composing = false
      composingInput = null
    }
  },
  { capture: true },
)

// 组字时给徽章"打草稿"：显示这段拼音的辙；选定/放弃后恢复或重渲染
const composingBadgeSaved = new WeakMap<
  HTMLElement,
  { className: string; text: string; title: string; hue: string }
>()

function composingBadge(): HTMLElement | null {
  if (!composingInput) return null
  const sentenceId = composingInput.dataset.sentenceId ?? ""
  return document.querySelector<HTMLElement>(
    `.sentence[data-id="${sentenceId}"] .rhyme-badge`,
  )
}

function restoreComposingBadge(): void {
  const badge = composingBadge()
  if (!badge) return
  const saved = composingBadgeSaved.get(badge)
  if (!saved) return
  badge.className = saved.className
  badge.textContent = saved.text
  badge.title = saved.title
  badge.style.setProperty("--rhyme-hue", saved.hue)
}

function paintComposingBadge(): void {
  const badge = composingBadge()
  if (!badge) return
  const pinyin = composingInput?.value ?? ""
  const info = rhymeOfPinyin(pinyin)
  if (!info) {
    restoreComposingBadge()
    return
  }
  if (!composingBadgeSaved.has(badge)) {
    composingBadgeSaved.set(badge, {
      className: badge.className,
      text: badge.textContent ?? "",
      title: badge.title,
      hue: badge.style.getPropertyValue("--rhyme-hue"),
    })
  }
  badge.className = "rhyme-badge pending"
  badge.textContent = info.label.replace(/辙$/, "")
  badge.title = `正在拼「${pinyin}」→ ${info.label}；选定后自动换成那个字的辙`
  badge.style.setProperty("--rhyme-hue", String(rhymeHue(info.key)))
}

function bindCellInput(input: HTMLInputElement, sentenceId: string, index: number): void {
  input.addEventListener("focus", () => {
    store.cursor = { sentenceId, cell: index }
  })

  input.addEventListener("compositionstart", () => {
    composing = true
    composingInput = input
    diag("ime.start")
  })

  input.addEventListener("compositionupdate", () => {
    paintComposingBadge()
  })

  input.addEventListener("compositionend", () => {
    restoreComposingBadge()
    composing = false
    composingInput = null
    input.style.width = ""
    imeJustEnded = true
    diag("ime.end", { len: input.value.length })
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
      paintComposingBadge()
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
        mutateSentence(sentenceId, () => {
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
      mutateSentence(sentenceId, () => {
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
      mutateSentence(sentenceId, () => {
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
        moveCursorInPlace({ sentenceId, cell: store.cursor.cell - 1 })
      }
      return
    }
    if (e.key === "ArrowRight" && !e.shiftKey) {
      e.preventDefault()
      const s = store.findSentence(sentenceId)
      if (!s) return
      if (store.cursor.cell < totalCells(s.pattern) - 1) {
        moveCursorInPlace({ sentenceId, cell: store.cursor.cell + 1 })
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
      // 句尾回车：光标到「下一句的第一个字」
      const idx = sentenceIndex(store.project, sentenceId)
      const next = sentenceAt(store.project, idx + 1)
      if (next) moveCursorInPlace({ sentenceId: next.id, cell: 0 })
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

  // 格子里原来的字还在、新字跟在后头（追加）→ 从下一格开始写；
  // 原来的字被替掉了（全选重打、粘贴覆盖等）→ 还是写当前格
  const appended = base !== "" && raw.startsWith(base)
  const writeFrom = appended ? start + 1 : start

  // 逐格锁：有锁的格子只收押该辙的字（写到哪格查哪格）
  {
    const total = totalCells(sentence.pattern)
    const chars = [...text]
    for (let i = writeFrom, j = 0; i < total && j < chars.length; i++, j++) {
      const lock = cellLockAt(sentence, i)
      if (lock && !charFitsRhyme(chars[j], lock)) {
        const name = (RHYME_LABEL_BY_KEY.get(lock) ?? lock).replace(/辙$/, "")
        input.value = base
        setStatus(`第 ${i + 1} 格锁了「${name}」，「${chars[j]}」不押，已拦下`, true)
        return
      }
      const group = groupAt(store.project, sentence, i)
      if (group && !charFitsConstraint(chars[j], group.constraint)) {
        input.value = base
        setStatus(`第 ${i + 1} 格在韵组里（${constraintText(group.constraint)}），「${chars[j]}」不合，已拦下`, true)
        return
      }
    }
  }

  store.pushUndo()
  const result = writeChars(getCells(sentence), writeFrom, text)
  setCells(sentence, result.cells)
  const excess = [...text].slice(result.written).join("")
  if (excess) sentence.overflow = sentence.overflow + excess
  // 光标停在「最后写到的那个格子」——刚输入的字右侧，而不是下一格的左侧
  store.cursor.cell = Math.min(
    writeFrom + Math.max(result.written, 1) - 1,
    totalCells(sentence.pattern) - 1,
  )
  store.touch()
  repaintSentences([sentence.id])
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
  mutateSentence(sentence.id, () => {
    const target = store.findSentence(sentence.id)
    if (!target) return
    setCells(target, next)
  })
  if (sentence.id === store.cursor.sentenceId) focusCellInput()
  setStatus("整句已挪动")
}

function addCellHere(sentenceId: string): void {
  if (store.cursor.sentenceId !== sentenceId) store.cursor = { sentenceId, cell: 0 }
  mutateSentence(sentenceId, () => {
    const target = store.findSentence(sentenceId)
    if (!target) return
    const result = addCellAt(target.pattern, getCells(target), store.cursor.cell)
    shiftCellRefs(target, result.cursor, 1)
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
  mutateSentence(sentenceId, () => {
    const s = store.findSentence(sentenceId)
    if (!s) return
    dropCellRefs(s, store.cursor.cell, 1)
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
  mutateSentence(sentenceId, () => {
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
  mutateSentence(sentenceId, () => {
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
  if (Object.keys(sentence.cellLocks ?? {}).length > 0) return
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
  // 逐格锁 / 押韵组：粘进来的字落在受限格子上也要合
  for (let i = 0; i < written; i++) {
    const lock = cellLockAt(sentence, i)
    if (lock && !charFitsRhyme(chars[i], lock)) {
      const name = (RHYME_LABEL_BY_KEY.get(lock) ?? lock).replace(/辙$/, "")
      setStatus(`第 ${i + 1} 格锁了「${name}」，「${chars[i]}」不押，已拦下`, true)
      return
    }
    const group = groupAt(store.project, sentence, i)
    if (group && !charFitsConstraint(chars[i], group.constraint)) {
      setStatus(`第 ${i + 1} 格在韵组里（${constraintText(group.constraint)}），「${chars[i]}」不合，已拦下`, true)
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
  repaintSentences([sentenceId])
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
      // 默认文件名跟当前歌名走——改了歌名再「另存为」不该还拿旧文件名；
      // 「保存工程」有已绑定的 target 时根本不弹这个框（直接覆盖原文件）
      suggestedName: `${store.project.title || "未命名"}.json`,
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



function openRhymeLockDialog(sentenceId: string, cellIndex: number, current: string): void {
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = `锁定第 ${cellIndex + 1} 格的韵辙`

  const hint = document.createElement("p")
  hint.textContent = `锁定后，第 ${cellIndex + 1} 格只能输入押该辙的字（多音字任一读音命中即放行）；点徽章可随时解锁。`

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

  form.append(title, hint, grid)

  // 这格在押韵组里：给一个解散入口
  {
    const sentence = store.findSentence(sentenceId)
    const group = sentence ? groupAt(store.project, sentence, cellIndex) : null
    if (group) {
      const row = document.createElement("p")
      row.className = "dialog-note"
      const info = document.createElement("span")
      info.textContent = `这一格在韵组里（${constraintText(group.constraint)}）`
      const dissolve = document.createElement("button")
      dissolve.type = "button"
      dissolve.className = "dialog-inline-btn"
      dissolve.textContent = "解散这个韵组"
      dissolve.addEventListener("click", () => {
        dialog.close("cancel")
        mutate(() => {
          dissolveRhymeGroup(store.project, group.id)
        })
        setStatus("已解散韵组")
      })
      row.append(info, " ", dissolve)
      form.appendChild(row)
    }
  }

  form.appendChild(actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    dialog.remove()
    if (action === "cancel") return
    const key = action || ""
    if (key === current) return
    mutateSentence(sentenceId, () => {
      const target = store.findSentence(sentenceId)
      if (!target) return
      setCellLockAt(target, cellIndex, key)
    })
    setStatus(
      key
        ? `已锁第 ${cellIndex + 1} 格「${RHYME_LABEL_BY_KEY.get(key) ?? key}」，这格只能押这个辙`
        : `已解锁第 ${cellIndex + 1} 格`,
    )
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

/** SV2 桥：把作词助手的歌词按序填进 SV2（预演 / 真填），或把 SV2 的歌词读回来 */
async function openSvBridgeDialog(): Promise<void> {
  dismissOpenDialogs()
  const dialog = document.createElement("dialog")
  dialog.innerHTML = `
    <form method="dialog" class="dialog-body">
      <button class="dialog-close" value="cancel" type="submit" title="关闭" aria-label="关闭">×</button>
      <strong>作词助手 ⇄ Synthesizer V Studio 2</strong>
      <p>把当前工程里<b>填了字的格子</b>按顺序填进 SV2（与词格、旋律无关）：所有轨的带字音符时间不重叠时，第 i 个字替换第 i 个；有重叠就按「导入 MIDI」的规则（字数多的当主歌，和声挂在重叠的主句后）。只替换能对上的部分。</p>
      <p class="dialog-note" id="sv-bridge-status">正在检查 SV2 脚本…</p>
      <div class="dialog-actions">
        <button type="button" id="sv-bridge-launch">启动 SV2</button>
        <button type="button" id="sv-bridge-preview">预演</button>
        <button type="button" id="sv-bridge-fill">按序填词到 SV2</button>
        <button type="button" id="sv-bridge-read">从 SV2 读回歌词</button>
      </div>
      <p class="dialog-note" id="sv-bridge-result"></p>
    </form>
  `
  document.body.appendChild(dialog)
  const statusEl = dialog.querySelector<HTMLElement>("#sv-bridge-status")!
  const resultEl = dialog.querySelector<HTMLElement>("#sv-bridge-result")!

  const refreshStatus = async (): Promise<void> => {
    const state = await readBridgeState()
    if (!state) {
      statusEl.textContent = "还没看到 SV2 脚本的状态——去 SV2 里跑「脚本 → 作词助手 → LyricAssistant bridge」"
      return
    }
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - state.updated)
    statusEl.textContent = state.running
      ? `SV2 脚本运行中 · 工程「${state.project || "未保存"}」· 带字音符 ${state.svNotes} 个`
      : `SV2 脚本好像没在跑（状态是 ${seconds} 秒前的）——去 SV2 里跑一下脚本`
  }
  void refreshStatus()

  const run = async (dry: boolean): Promise<void> => {
    const chars = orderedChars(store.project)
    if (!chars) {
      resultEl.textContent = "当前工程一个字都没有"
      return
    }
    resultEl.textContent = dry ? "预演中…" : "发送中…"
    const resp = await callBridge("fillLyrics", { chars, dry: dry ? "1" : "0" })
    if (!resp) {
      resultEl.textContent = "SV2 那边没响应——先在 SV2 里跑「脚本 → 作词助手 → LyricAssistant bridge」"
      return
    }
    resultEl.textContent = resp.note || (resp.ok ? "完成" : "SV2 报错")
    if (!dry && resp.ok) setStatus(`SV2：已替换 ${resp.matched} 个字`)
    void refreshStatus()
  }
  dialog.querySelector("#sv-bridge-launch")!.addEventListener("click", () => {
    void (async () => {
      const ok = await launchSv2()
      resultEl.textContent = ok
        ? "已启动 SV2——等它打开后在 SV2 里跑「脚本 → 作词助手 → LyricAssistant bridge」"
        : "没能启动 SV2（路径不对 / 权限没给？）"
      if (ok) void refreshStatus()
    })()
  })
  dialog.querySelector("#sv-bridge-preview")!.addEventListener("click", () => void run(true))
  dialog.querySelector("#sv-bridge-fill")!.addEventListener("click", () => void run(false))
  dialog.querySelector("#sv-bridge-read")!.addEventListener("click", () => {
    void (async () => {
      const state = await readBridgeState()
      if (!state || !state.chars) {
        resultEl.textContent = "没读到 SV2 的歌词（脚本没在跑？）"
        return
      }
      dialog.close()
      openImportDialog(state.chars, "SV2")
    })()
  })
  dialog.showModal()
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
    diag("import.lyrics", {
      chars: text.length,
      sections: parsed.sections.length,
      lines: total,
      merge,
      fillLyrics,
    })
    if (total === 0) {
      diag("import.lyrics.empty", { chars: text.length })
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
      <p>每行一句，空格分组，空行分段；<strong>连续超过 8 句会自动断开</strong>（在第 4、5 句之间，连续不超过 9 句）。支持《标题》、[段落名]、行尾（备注）、<code>|</code> 分隔备选、纯数字行只生成词格。例：<code>真的 假的 啊</code> → 2/2/1。可直接粘贴、从剪贴板读入，或选择 .txt / .lrc / .md 文件。</p>
      <textarea placeholder="《歌名》&#10;[Verse]&#10;真的 假的（温柔）|真的啊"></textarea>
      <div class="dialog-radios">
        <label><input type="radio" name="import-mode" value="lyrics" checked /> 同时导入歌词</label>
        <label><input type="radio" name="import-mode" value="grid" /> 仅词格</label>
      </div>
      <div class="dialog-radios">
        <label><input type="radio" name="import-target" value="current" checked /> 覆盖导入</label>
        <label><input type="radio" name="import-target" value="new" /> 新建导入</label>
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
  const targetInputs = Array.from(
    dialog.querySelectorAll<HTMLInputElement>('input[name="import-target"]'),
  )
  const importNewOf = (): boolean =>
    targetInputs.some((el) => el.checked && el.value === "new")
  const syncTarget = (): void => {
    // 「新建导入」下「合并到现有」没意义，灰掉
    mergeInput.disabled = importNewOf()
  }
  targetInputs.forEach((el) => el.addEventListener("change", syncTarget))
  syncTarget()
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
    const importNew = importNewOf()
    const merge = mergeInput.checked && !importNew
    const fillLyrics = modeInputs.find((el) => el.checked)?.value !== "grid"
    dialog.remove()
    if (action === "ok") {
      if (importNew) addDocCore()
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
  const autoOption = document.createElement("option")
  autoOption.value = "-1"
  autoOption.textContent = "自动（单轨直接用；多轨不重叠就合并）"
  trackSelect.appendChild(autoOption)
  for (const track of tracks) {
    const option = document.createElement("option")
    option.value = String(track.index)
    option.textContent = `${track.name}（${track.count} 个音）`
    trackSelect.appendChild(option)
  }
  trackSelect.value = "-1"
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
    // 导出要写回某一条真轨：自动模式落回人声 / 音最多的那轨
    const exportTrack = trackIndex >= 0 ? trackIndex : Math.max(0, pickMelodyTrack(file))
    dialog.remove()
    if (action !== "ok") return
    applyMidiSections(file, exportTrack, sections, mergeCheck.checked, skipPitches)
  })
  dialog.showModal()
}

/** 各轨的版权声明（meta 0x02），去重去空 */
function copyrightsOf(file: MidiFile): string[] {
  return [...new Set(file.tracks.map((track) => track.copyright.trim()).filter(Boolean))]
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
  const sourceText = midiSourceText(file)
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
        const sentence = createSentence(line.pattern, line.harmony ? "harmony" : undefined)
        setCells(sentence, line.cells)
        return sentence
      })
      return createSection(section.name || `段落 ${index + 1}`, sentences)
    })
    if (merge) {
      offset = store.project.sections.length
      store.project.sections.push(...imported)
      // 合并导入：只补识别到的版权，歌名不动；歌词事件非空就追加到原文（和文本导入一致）
      const found = copyrightsOf(file)
      if (found.length > 0) {
        store.project.credits = [...new Set([...(store.project.credits ?? []), ...found])]
      }
      if (sourceText) applyImportedSource(store.project, sourceText, true)
    } else {
      offset = 0
      store.project.sections = imported
      // 和文本导入一样的防护：识别不到就清空旧的，不留上一首的残留
      store.project.title = midiTitle(file) || "未命名歌曲"
      store.project.credits = copyrightsOf(file)
      store.project.source = sourceText
    }
    const first = imported[0]?.sentences[0]
    if (first) store.cursor = { sentenceId: first.id, cell: 0 }
  })
  midiSession = { file, trackIndex, offset, sections, skipPitches }
  diag("import.midi", {
    tracks: file.tracks.length,
    trackIndex,
    sections: sections.length,
    lines: total,
    sourceChars: sourceText.length,
    merge,
  })
  focusCellInput()
  setStatus(`已从 MIDI 导入 ${total} 句词格（填完字可「导出 → 带歌词 MIDI」）`)
}

const AI_WIDTH_KEY = "cige-grid-ai-width"
const AI_SCOPE_KEY = "cige-grid-ai-scope"

type AiScope = "all" | "empty" | "section" | "selected" | "chat"

const AI_SCOPE_OPTIONS: { value: AiScope; label: string }[] = [
  { value: "all", label: "整首" },
  { value: "empty", label: "空句" },
  { value: "section", label: "选段" },
  { value: "selected", label: "选句" },
  { value: "chat", label: "对话" },
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
  // AI 独立窗口里改的范围要告诉主窗口：它那边要靠 scope 算下一次快照的目标
  if (AI_WINDOW_MODE) emitQuiet(scopeChannel(AI_WINDOW_DOC_ID), scope)
}
const AI_OPEN_KEY = "cige-grid-ai-open"
const AI_CONVOS_KEY = "cige-grid-ai-convos"
const AI_DEFAULT_WIDTH = 400
const AI_MIN_WIDTH = 400

/** 最宽能拉到「把作词区整个盖住」：工作区（右侧栏以左、工具栏以下）的宽度 */
function aiMaxWidth(): number {
  const body = document.querySelector<HTMLElement>(".workbench-body")
  const width = body ? body.getBoundingClientRect().width : window.innerWidth - 200
  return Math.max(AI_MIN_WIDTH, Math.round(width))
}

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
  streaming?: boolean
  error?: string
  /** 思维链展开状态（每个回复版本各记各的） */
  thinkingOpen?: boolean
  /** 分支后缀：选了这条回复时，后面跟着的那一轮（版本树按"选中回复"往下走）。
   *  编辑 / 重跑产生的新回复 next 为空 → 从它开始长新后缀；旧回复的 next 保留 → 翻页可回。 */
  next?: AiTurn
}

/** 一个输入版本：文本 + 它自己的回复版本链（编辑产生输入版本，重跑产生回复版本） */
interface AiInputVersion {
  text: string
  replies: AiVersion[]
  replyIndex: number
  /** 点蓝圈展开 / 收起原文 */
  /** 正在就地编辑 */
  editing?: boolean
}

/** 一轮对话 = 输入版本链。照 DeepSeek：输入版本和回复版本是两套独立的兄弟链 */
interface AiTurn {
  inputs: AiInputVersion[]
  inputIndex: number
}

interface AiConversation {
  id: string
  /** 归到哪个歌词文件（文件删了就落到「未分组」） */
  docId: string | null
  title: string
  createdAt: number
  updatedAt: number
  turns: AiTurn[]
}

let convos: AiConversation[] = []
let activeConvoId = ""
let aiTurns: AiTurn[] = []

function newConvoId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createConvo(docId: string | null): AiConversation {
  const now = Date.now()
  return { id: newConvoId(), docId, title: "", createdAt: now, updatedAt: now, turns: [] }
}

function activeConvo(): AiConversation | null {
  return convos.find((convo) => convo.id === activeConvoId) ?? null
}

function syncTurnsFromConvo(): void {
  aiTurns = activeConvo()?.turns ?? []
}

/** 会话存储格式版本：2 = 分支树（回复带 next）；老数据（无版本号）= 线性列表，读时迁移 */
const AI_CONVOS_SCHEMA = 2

function writeConvos(): void {
  try {
    localStorage.setItem(
      AI_CONVOS_KEY,
      JSON.stringify({ schema: AI_CONVOS_SCHEMA, activeId: activeConvoId, convos }),
    )
  } catch {
    // 忽略
  }
}

/** 立即落盘（切会话 / 改名 / 删除等关键节点用） */
function persistConvos(touch = true): void {
  const convo = activeConvo()
  if (convo && touch) convo.updatedAt = Date.now()
  writeConvos()
}

let convosWriteTimer: number | undefined

/** 高频渲染不许每次同步写盘：300ms 合并成一次 */
function persistConvosSoon(touch: boolean): void {
  const convo = activeConvo()
  if (convo && touch) convo.updatedAt = Date.now()
  if (convosWriteTimer !== undefined) window.clearTimeout(convosWriteTimer)
  convosWriteTimer = window.setTimeout(() => {
    convosWriteTimer = undefined
    writeConvos()
  }, 300)
}

function flushConvosWrite(): void {
  if (convosWriteTimer === undefined) return
  window.clearTimeout(convosWriteTimer)
  convosWriteTimer = undefined
  writeConvos()
}

window.addEventListener("beforeunload", () => {
  flushConvosWrite()
  flushAiWidthWrite()
})
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    flushConvosWrite()
    flushAiWidthWrite()
  }
})

function setActiveConvo(id: string): void {
  if (aiExporting) exitAiExportMode()
  activeConvoId = id
  syncTurnsFromConvo()
  persistConvos(false)
}

function latestConvoOfDoc(docId: string | null): AiConversation | null {
  return (
    [...convos]
      .filter((item) => item.docId === docId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  )
}

/** 切歌词文件时，把面板切到那个文件最近的会话；没有就先空着（发消息时再懒建） */
function syncAiConvoToDoc(): void {
  const docId = docsState.activeId || null
  const convo = activeConvo()
  if (convo && convo.docId === docId) return
  const latest = latestConvoOfDoc(docId)
  if (latest) setActiveConvo(latest.id)
  else {
    activeConvoId = ""
    syncTurnsFromConvo()
  }
  if (aiExporting) exitAiExportMode()
  renderAiMessages(false)
  scrollAiToBottom()
}

/** 发消息前保证有一个挂在当前文件下的会话（没有就建一个） */
function ensureConvoForDoc(): void {
  const docId = docsState.activeId || null
  const convo = activeConvo()
  if (convo && convo.docId === docId) return
  const latest = latestConvoOfDoc(docId)
  if (latest) {
    setActiveConvo(latest.id)
    return
  }
  const created = createConvo(docId)
  convos.unshift(created)
  setActiveConvo(created.id)
}

/** 规范化一轮（递归）：校验结构、清掉流式/编辑态、把 next 链捋好 */
function normalizeTurn(raw: unknown, depth = 0): AiTurn | null {
  if (!raw || typeof raw !== "object" || depth > 1500) return null
  const data = raw as { inputs?: unknown; inputIndex?: unknown }
  if (!Array.isArray(data.inputs) || data.inputs.length === 0) return null
  const inputs: AiInputVersion[] = []
  for (const rawInput of data.inputs) {
    if (!rawInput || typeof rawInput !== "object") continue
    const input = rawInput as { text?: unknown; replies?: unknown; replyIndex?: unknown }
    if (typeof input.text !== "string" || !Array.isArray(input.replies)) continue
    const replies: AiVersion[] = []
    for (const rawReply of input.replies) {
      if (!rawReply || typeof rawReply !== "object") continue
      const reply = rawReply as AiVersion
      reply.streaming = false
      const next = normalizeTurn(reply.next, depth + 1)
      if (next) reply.next = next
      else delete reply.next
      replies.push(reply)
    }
    if (replies.length === 0) replies.push({ text: "" })
    const replyIndex =
      typeof input.replyIndex === "number" &&
      input.replyIndex >= 0 &&
      input.replyIndex < replies.length
        ? input.replyIndex
        : replies.length - 1
    inputs.push({ text: input.text, replies, replyIndex, editing: false })
  }
  if (inputs.length === 0) return null
  const inputIndex =
    typeof data.inputIndex === "number" && data.inputIndex >= 0 && data.inputIndex < inputs.length
      ? data.inputIndex
      : inputs.length - 1
  return { inputs, inputIndex }
}

/** 老格式（线性 turns、没有 next）→ 单分支树：后续轮挂到"当时选中的回复"下 */
function migrateFlatTurns(rawTurns: unknown[]): AiTurn[] {
  const flat: AiTurn[] = []
  for (const raw of rawTurns) {
    const source = (raw ?? {}) as { inputs?: unknown; inputIndex?: unknown }
    const turn = normalizeTurn({ inputs: source.inputs, inputIndex: source.inputIndex })
    if (turn) flat.push(turn)
  }
  for (let i = flat.length - 2; i >= 0; i--) {
    const reply = currentReply(flat[i])
    if (reply) reply.next = flat[i + 1]
  }
  return flat.length > 0 ? [flat[0]] : []
}

function loadConvos(): void {
  try {
    const raw = localStorage.getItem(AI_CONVOS_KEY)
    if (raw) {
      const data = JSON.parse(raw) as { schema?: unknown; activeId?: unknown; convos?: unknown }
      const isBranchSchema = data.schema === AI_CONVOS_SCHEMA
      if (Array.isArray(data.convos)) {
        convos = data.convos.flatMap((item) => {
          if (!item || typeof item !== "object") return []
          const rawConvo = item as Partial<AiConversation>
          if (typeof rawConvo.id !== "string" || !Array.isArray(rawConvo.turns)) return []
          const convo: AiConversation = {
            id: rawConvo.id,
            docId: typeof rawConvo.docId === "string" ? rawConvo.docId : null,
            title: typeof rawConvo.title === "string" ? rawConvo.title : "",
            createdAt: typeof rawConvo.createdAt === "number" ? rawConvo.createdAt : Date.now(),
            updatedAt: typeof rawConvo.updatedAt === "number" ? rawConvo.updatedAt : Date.now(),
            turns: [],
          }
          // 新格式：树根一轮，递归清洗；老格式：线性列表迁移成单分支树
          if (isBranchSchema) {
            const root = normalizeTurn(rawConvo.turns[0])
            convo.turns = root ? [root] : []
          } else {
            convo.turns = migrateFlatTurns(rawConvo.turns)
          }
          return [convo]
        })
        activeConvoId =
          typeof data.activeId === "string" && convos.some((convo) => convo.id === data.activeId)
            ? data.activeId
            : (convos[0]?.id ?? "")
      }
    }
  } catch {
    // 忽略
  }
  if (convos.length === 0) {
    const created = createConvo(docsState.activeId || null)
    convos = [created]
    activeConvoId = created.id
  }
  syncTurnsFromConvo()
}

loadConvos()

function currentInput(turn: AiTurn): AiInputVersion {
  return turn.inputs[turn.inputIndex]
}

function currentReply(turn: AiTurn): AiVersion {
  const input = currentInput(turn)
  return input.replies[input.replyIndex]
}

/** 当前分支的完整路径：从根这一轮开始，每轮沿"选中的输入 + 选中的回复"的 next 往下走 */
function branchPath(): AiTurn[] {
  const path: AiTurn[] = []
  let turn: AiTurn | undefined = aiTurns[0]
  let guard = 0
  while (turn && guard < 2000) {
    path.push(turn)
    turn = currentReply(turn)?.next
    guard += 1
  }
  return path
}

/** 某一轮在当前分支里的显示序号（repaintKeepingScroll 用） */
function pathIndexOf(turn: AiTurn): number {
  return branchPath().indexOf(turn)
}

/** 正在流式的这条回复是否正显示在面板里（用户可能翻到别的版本去了） */
function isReplyDisplayed(reply: AiVersion): boolean {
  return branchPath().some((turn) => currentReply(turn) === reply)
}
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
  const target = resolveTarget(aiSettings)
  const effort = effortOf(aiSettings)
  // 档位是「模型」的属性（我们实测的 / 目录里 DSH 标的）——模型自带档位就不算「不适用」，
  // 不跟「这家勾没勾开关」走（请求那边本来就是按目录档位发 reasoning_effort）
  const levels = target ? effortLevelsFor(model, provider?.supportsEffort ?? false) : []
  if (target && !target.supportsThinking && levels.length === 0) {
    setChip(aiEffortChip, "思考：不适用", "这个接口不发思考参数（去 ⚙ 勾上）")
    aiEffortChip.disabled = true
  } else if (target && !target.supportsEffort) {
    setChip(
      aiEffortChip,
      effort === "none" ? "思考：关" : "思考：开",
      "思考开关（这个模型没有强度档，官方默认开启）",
    )
    aiEffortChip.disabled = false
  } else {
    const label = EFFORT_LEVELS.find((level) => level.value === effort)?.label ?? "Default"
    setChip(aiEffortChip, label, "推理等级")
    aiEffortChip.disabled = false
  }
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

/** 点弹层 / 芯片以外的地方 → 收起弹层。
 *  这个监听**只挂一次**——以前是每开一次弹层挂一个、关的时候不摘，
 *  第二次开时旧监听把新弹层当"外面"，鼠标一点（比如点搜索框）就把整个框关掉。 */
document.addEventListener("click", (event) => {
  const el = event.target instanceof Element ? event.target : null
  if (el?.closest(".ai-pop") || el?.closest(".ai-chip")) return
  closeAiPops()
})

function openAiPop(anchor: HTMLElement, build: (pop: HTMLElement) => void): void {
  const wasOpen = anchor.dataset.open === "1"
  closeAiPops()
  if (wasOpen) return
  anchor.dataset.open = "1"
  const pop = document.createElement("div")
  pop.className = "ai-pop"
  build(pop)
  document.querySelector(".ai-composer")?.appendChild(pop)
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
        // 只列「加过的」：常驻两家 / 填过 Key 的 / 自定义的——和设置页卡片同一套规则
        if (provider.id === "custom" && !provider.apiKey.trim() && !provider.baseUrl.trim()) continue
        if (provider.builtin && !PINNED_PROVIDER_IDS.includes(provider.id) && !provider.apiKey.trim())
          continue
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
      openSettingsDialog("ai")
    })
    foot.appendChild(manage)
    pop.appendChild(foot)
    search.focus()
  })
}

function openEffortPop(): void {
  openAiPop(aiEffortChip, (pop) => {
    const target = resolveTarget(aiSettings)
    const current = effortOf(aiSettings)
    const thinkingOnly = Boolean(target && !target.supportsEffort)
    const provider = currentProvider()
    const options = thinkingOnly
      ? THINKING_LEVELS
      : target
        ? effortLevelsFor(target.model, provider?.supportsEffort ?? false)
        : EFFORT_LEVELS
    for (const level of options) {
      const item = document.createElement("button")
      item.type = "button"
      item.textContent = level.label
      const isCurrent = thinkingOnly
        ? (level.value === "none") === (current === "none")
        : level.value === current
      if (isCurrent) {
        item.classList.add("current")
        const tick = document.createElement("span")
        tick.className = "tick"
        tick.textContent = "✓"
        item.appendChild(tick)
      }
      item.addEventListener("click", () => {
        aiSettings = withEffort(aiSettings, level.value)
        saveAiSettings(aiSettings)
        renderAiChips()
        closeAiPops()
      })
      pop.appendChild(item)
    }
  })
}

let aiCurrentWidth = AI_DEFAULT_WIDTH
let aiRestoreWidth = AI_DEFAULT_WIDTH

function aiCovered(): boolean {
  return aiCurrentWidth >= aiMaxWidth() - 2
}

const AI_EXPAND_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14.5" y2="9.5"/><line x1="3" y1="21" x2="9.5" y2="14.5"/></svg>'
const AI_COLLAPSE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'

function refreshAiExpandBtn(): void {
  const btn = document.querySelector<HTMLButtonElement>("#btn-ai-expand")
  if (!btn) return
  const covered = aiCovered()
  btn.innerHTML = covered ? AI_COLLAPSE_ICON : AI_EXPAND_ICON
  btn.title = covered ? "缩回面板" : "铺满工作区"
  btn.setAttribute("aria-label", btn.title)
}

let aiWidthWriteTimer: number | undefined

function flushAiWidthWrite(): void {
  if (aiWidthWriteTimer === undefined) return
  window.clearTimeout(aiWidthWriteTimer)
  aiWidthWriteTimer = undefined
  localStorage.setItem(AI_WIDTH_KEY, String(aiCurrentWidth))
}

/** 拖拽时别每次 pointermove 都同步写盘：200ms 合并成一次 */
function persistAiWidth(): void {
  if (aiWidthWriteTimer !== undefined) window.clearTimeout(aiWidthWriteTimer)
  aiWidthWriteTimer = window.setTimeout(() => {
    aiWidthWriteTimer = undefined
    localStorage.setItem(AI_WIDTH_KEY, String(aiCurrentWidth))
  }, 200)
}

function setAiWidth(width: number): void {
  const clamped = Math.max(AI_MIN_WIDTH, Math.min(aiMaxWidth(), Math.round(width)))
  aiCurrentWidth = clamped
  document.documentElement.style.setProperty("--ai-width", `${clamped}px`)
  persistAiWidth()
  refreshAiExpandBtn()
}

function openAiPanel(): void {
  if (aiDetached) return
  closeSourcePanel()
  aiPanel.hidden = false
  aiResizer.hidden = false
  document.documentElement.classList.add("ai-open")
  btnAi.setAttribute("aria-expanded", "true")
  localStorage.setItem(AI_OPEN_KEY, "1")
  updateAiHint()
  renderAiMessages(false)
  scrollAiToBottom()
  aiInput.focus()
}

function closeAiPanel(): void {
  closeAiPops()
  aiPanel.hidden = true
  aiResizer.hidden = true
  document.documentElement.classList.remove("ai-open")
  btnAi.setAttribute("aria-expanded", "false")
  localStorage.setItem(AI_OPEN_KEY, "0")
}

function toggleAiPanel(): void {
  if (aiDetached) return
  if (aiPanel.hidden) openAiPanel()
  else closeAiPanel()
}

/** AI 面板拆出去 / 放回来（默认内嵌，只有用户点「拆出」才拆；不落盘，重开应用一律回到内嵌） */
function setAiDetached(detached: boolean): void {
  aiDetached = detached
  document.documentElement.classList.toggle("ai-detached", detached)
  if (detached) {
    // 内嵌那份让位给独立窗
    closeAiPanel()
    document.querySelector<HTMLElement>("#btn-ai-detach")?.setAttribute("hidden", "")
    if (btnAi && !AI_WINDOW_MODE) btnAi.title = "聚焦这一篇的 AI 面板窗口（已拆出）"
  } else {
    document.querySelector<HTMLElement>("#btn-ai-detach")?.removeAttribute("hidden")
    if (btnAi && !AI_WINDOW_MODE) btnAi.title = "打开 / 收起 AI 面板"
    // 「放回」是用户明确要它回来：直接打开内嵌面板（不管拆出前是开是关）
    openAiPanel()
  }
  const redockMain = document.querySelector<HTMLElement>("#btn-ai-redock-main")
  if (redockMain) redockMain.hidden = !detached
  updateAiHint()
}

function initAiResizer(): void {
  const stored = Number(localStorage.getItem(AI_WIDTH_KEY))
  // 老默认（320 / 576）自动升级到新默认 400；自己拖过的宽度保留
  const initial =
    Number.isFinite(stored) && stored > 0 && stored !== 320 && stored !== 576
      ? stored
      : AI_DEFAULT_WIDTH
  setAiWidth(initial)
  window.addEventListener("resize", () => setAiWidth(aiCurrentWidth))
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
  // AI 独立窗口：没有格子可选，直接用主窗口随快照推过来的目标
  if (AI_WINDOW_MODE) return projectMirrorTargetIds
  const scope = aiScope
  if (scope === "chat") return []
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
  if (scope === "chat") {
    aiHint.textContent = "对话模式：不附带词格，直接聊"
    return
  }
  const ids = aiTargetIds()
  if (scope === "selected") {
    aiHint.textContent =
      ids && ids.length > 0
        ? `选中 ${ids.length} 句（连同整首词格一起发给模型）`
        : "先在格子里框选要写的句子"
    return
  }
  const count = ids ? ids.length : allSentences(aiProject()).length
  const label = scope === "all" ? "整首" : scope === "empty" ? "只填空句" : "当前段"
  aiHint.textContent = `已自动附上词格：${label} ${count} 句`
}

let aiStickBottom = true
let aiStreamDirty: AiVersion | null = null
let aiStreamFrame = 0

function aiNearBottom(): boolean {
  return aiMessagesEl.scrollHeight - aiMessagesEl.scrollTop - aiMessagesEl.clientHeight < 80
}

// Markdown 回复里的链接：不在应用里开页面，交给系统浏览器
aiMessagesEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null
  const anchor = target?.closest?.("a")
  if (!anchor) return
  event.preventDefault()
  void openExternal(anchor.getAttribute("href") ?? "")
})

aiMessagesEl.addEventListener("scroll", () => {
  aiStickBottom = aiNearBottom()
})

/** 无条件跳到底：明确的用户动作（发消息、切会话、开面板） */
function scrollAiToBottom(): void {
  aiStickBottom = true
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight
}

/** 只在贴底时跟随；生成中用户往上翻就不拽回 */
function followAiScroll(): void {
  if (!aiStickBottom) return
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight
}

/** 流式 delta 先标脏，一帧最多画一次（防成串数据一帧叠几十次重画） */
function queueStreamText(reply: AiVersion): void {
  aiStreamDirty = reply
  if (aiStreamFrame) return
  aiStreamFrame = requestAnimationFrame(() => {
    aiStreamFrame = 0
    const pending = aiStreamDirty
    aiStreamDirty = null
    if (pending) paintStreamText(pending)
  })
}

function cancelStreamPaint(): void {
  aiStreamDirty = null
  if (aiStreamFrame) {
    cancelAnimationFrame(aiStreamFrame)
    aiStreamFrame = 0
  }
}

/** 正文一开始是普通文本块；第一个 { 到了就换成按行预览的容器 */
function upgradeStreamToLines(container: HTMLElement): HTMLElement {
  const list = document.createElement("div")
  list.className = "ai-lines"
  container.replaceWith(list)
  aiStreamEl = list
  return list
}

function paintStreamText(reply: AiVersion): void {
  if (!aiStreamEl) return
  const text = reply.text ?? ""
  if (aiStreamEl.classList.contains("ai-lines")) {
    const items = previewAiResults(text)
    // 没有新句子就整帧不动 DOM：流式只在整句完成时重画一次
    const sig = items.map((item) => `${item.id}\u0000${item.text}`).join("\u0001")
    if (aiStreamEl.dataset.streamSig === sig) return
    aiStreamEl.dataset.streamSig = sig
    fillAiLines(aiStreamEl, aiLineViews(reply, items))
  } else if (text.trimStart().startsWith("{")) {
    const list = upgradeStreamToLines(aiStreamEl)
    const items = previewAiResults(text)
    list.dataset.streamSig = items.map((item) => `${item.id}\u0000${item.text}`).join("\u0001")
    fillAiLines(list, aiLineViews(reply, items))
  } else {
    // 聊天 / 没解析成句子的回复：按 Markdown 渲染（原文没变就不重画）
    if (aiStreamEl.dataset.mdText === text) return
    aiStreamEl.dataset.mdText = text
    aiStreamEl.classList.add("ai-md")
    fillMarkdown(aiStreamEl, text || "…")
  }
  followAiScroll()
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

function turnEl(index: number): HTMLElement | null {
  return aiMessagesEl.querySelector<HTMLElement>(`[data-turn="${index}"]`)
}

/** 切换版本时保持这一轮在屏幕上的位置（照 DeepSeek 的滚动位置恢复） */
function repaintKeepingScroll(turnIndex: number, mutate: () => void): void {
  const before = turnEl(turnIndex)?.getBoundingClientRect().top ?? 0
  mutate()
  renderAiMessages()
  const after = turnEl(turnIndex)?.getBoundingClientRect().top ?? 0
  if (before !== 0 && after !== 0) aiMessagesEl.scrollTop += after - before
}

/** 对话导出：选择模式。最小单位是**每条消息**（你发的 / 助手回的），不是整轮 */
let aiExporting = false
const aiExportPicked = new Set<string>()

/** 勾选键：第几轮 + 这条是输入还是回复 */
function exportKey(turnIndex: number, kind: "input" | "reply"): string {
  return `${turnIndex}:${kind}`
}

function enterAiExportMode(): void {
  if (aiExporting) return
  if (branchPath().length === 0) {
    setStatus("还没有对话，没什么可导的", true)
    return
  }
  aiExporting = true
  aiExportPicked.clear()
  document.documentElement.classList.add("ai-exporting")
  aiExportBarEl.hidden = false
  renderAiMessages(false)
  updateAiExportBar()
  setStatus("勾选要导出的对话，再点「导出 Markdown」")
}

function exitAiExportMode(): void {
  if (!aiExporting) return
  aiExporting = false
  aiExportPicked.clear()
  document.documentElement.classList.remove("ai-exporting")
  aiExportBarEl.hidden = true
  renderAiMessages(false)
}

function toggleAiExportPick(key: string, el?: HTMLElement): void {
  if (aiExportPicked.has(key)) aiExportPicked.delete(key)
  else aiExportPicked.add(key)
  if (el) el.classList.toggle("picked", aiExportPicked.has(key))
  updateAiExportBar()
}

/** 给一条消息挂勾选圈：点消息正文 / 点圈都切换这一条 */
function applyExportPick(el: HTMLElement, key: string): void {
  el.classList.toggle("picked", aiExportPicked.has(key))
  const pick = document.createElement("button")
  pick.type = "button"
  pick.className = "ai-pick"
  pick.title = "勾选这一条"
  pick.setAttribute("aria-pressed", aiExportPicked.has(key) ? "true" : "false")
  pick.innerHTML =
    '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-check" /></svg>'
  pick.addEventListener("click", (event) => {
    event.stopPropagation()
    toggleAiExportPick(key, el)
  })
  el.appendChild(pick)
  el.addEventListener("click", () => toggleAiExportPick(key, el))
}

function updateAiExportBar(): void {
  const total = branchPath().length * 2
  // 「组对话」按碰到的轮次数（照 DeepSeek：4 条全勾 = 2 组）
  const turnsTouched = new Set(
    [...aiExportPicked]
      .map((key) => Number(key.split(":")[0]))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < branchPath().length),
  )
  aiExportCountEl.textContent = `已选择 ${turnsTouched.size} 组对话`
  btnAiExportAll.classList.toggle("all", total > 0 && aiExportPicked.size >= total)
  btnAiExportGo.disabled = aiExportPicked.size === 0
}

/** 把勾选的轮次拼成 Markdown：当前分支版本；思考可选（默认带） */
async function exportAiConversation(): Promise<void> {
  const path = branchPath()
  const picked = [...aiExportPicked]
    .map((key) => {
      const [turnIndex, kind] = key.split(":") as [string, "input" | "reply"]
      return { turn: Number(turnIndex), kind }
    })
    .filter(
      (item) =>
        Number.isInteger(item.turn) &&
        item.turn >= 0 &&
        item.turn < path.length &&
        (item.kind === "input" || item.kind === "reply"),
    )
    .sort((a, b) => a.turn - b.turn || (a.kind === b.kind ? 0 : a.kind === "input" ? -1 : 1))
  if (picked.length === 0) return
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const title = store.project.title || "未命名歌曲"
  const provider = currentProvider()
  const model = provider
    ? `${provider.name} · ${modelLabel(aiSettings.model)}`
    : modelLabel(aiSettings.model)
  const lines: string[] = []
  lines.push(`# 对话导出 · ${title}`, "")
  lines.push(`- 时间：${stamp}`, `- 模型：${model}`, `- 共 ${picked.length} 条消息（当前版本）`, "")
  for (const item of picked) {
    const turn = path[item.turn]
    if (item.kind === "input") {
      const input = currentInput(turn)
      lines.push("---", "", "**你：**", "", input.text.trim() || "（空）", "")
      continue
    }
    const reply = currentReply(turn)
    lines.push("---", "", "**助手：**", "")
    const thinking = (reply.thinkingText ?? "").trim()
    if (aiExportThinkEl.checked && thinking) {
      const seconds = Math.max(1, Math.round((reply.thinkingMs ?? 0) / 1000))
      lines.push(`> **思考**（用时 ${seconds} 秒）：`)
      for (const line of thinking.split("\n")) lines.push(`> ${line}`)
      lines.push("")
    }
    lines.push(reply.error ? `（出错了：${reply.error}）` : reply.text.trim() || "（空）", "")
  }
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "对话"
  const fileStamp = stamp.replace(/[-: ]/g, "")
  try {
    const saved = await saveText({
      suggestedName: `对话-${safeTitle}-${fileStamp}.md`,
      description: "对话记录",
      extensions: ["md"],
      pickerId: "cige-convo-export",
      contents: lines.join("\n"),
      forcePicker: true,
    })
    if (!saved) return
    setStatus(saved.kind === "download" ? `已下载「${saved.name}」` : "对话已导出")
    exitAiExportMode()
  } catch (err) {
    setStatus(`导出失败：${err instanceof Error ? err.message : err}`, true)
  }
}

function renderAiMessages(touchConvo = true): void {
  cancelStreamPaint()
  aiStreamEl = null
  aiStreamThinkEl = null
  aiStreamThinkLabelEl = null
  aiMessagesEl.replaceChildren()
  persistConvosSoon(touchConvo)
  const path = branchPath()
  if (path.length === 0) return
  path.forEach((turn, turnIndex) => {
    const wrapper = document.createElement("div")
    wrapper.className = "ai-turn"
    wrapper.dataset.turn = String(turnIndex)

    const input = currentInput(turn)
    const reply = currentReply(turn)

    const userEl = document.createElement("div")
    userEl.className = "ai-msg user"
    fillUserBubble(userEl, turn, input)
    wrapper.appendChild(userEl)

    const assistantEl = document.createElement("div")
    assistantEl.className = `ai-msg assistant${reply.error ? " error" : ""}`
    fillAssistantRow(assistantEl, turn, input, reply)
    wrapper.appendChild(assistantEl)

    if (aiExporting) {
      applyExportPick(userEl, exportKey(turnIndex, "input"))
      applyExportPick(assistantEl, exportKey(turnIndex, "reply"))
    }
    aiMessagesEl.appendChild(wrapper)
  })
  followAiScroll()
  refreshDocListIfChanged()
}

function fillAssistantRow(
  el: HTMLElement,
  turn: AiTurn,
  input: AiInputVersion,
  reply: AiVersion,
): void {
  // 照 DeepSeek：回复的版本翻页在内容右上（紧贴用户消息下方那一行）
  if (input.replies.length > 1) {
    const top = document.createElement("div")
    top.className = "ai-actions ai-actions-top"
    top.appendChild(
      aiVersionNav(input.replyIndex, input.replies.length, (delta) =>
        switchReply(turn, input, delta),
      ),
    )
    el.appendChild(top)
  }
  if ((reply.thinkingText ?? "") !== "") {
    const toggle = document.createElement("button")
    toggle.type = "button"
    toggle.className = `ai-think-toggle${reply.thinkingOpen ? " open" : ""}`
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
    label.textContent = thinkingLabel(reply, Boolean(reply.streaming))
    const caret = document.createElement("span")
    caret.className = "caret"
    caret.textContent = "⌄"
    toggle.append(icon, label, caret)
    toggle.addEventListener("click", () => {
      reply.thinkingOpen = !reply.thinkingOpen
      renderAiMessages()
      // 折叠态也要跨刷新留住：落盘一次（touch=false 不动会话排序）
      persistConvosSoon(false)
    })
    el.appendChild(toggle)
    if (reply.streaming) {
      aiStreamThinkEl = toggle
      aiStreamThinkLabelEl = label
    }
    if (reply.thinkingOpen) {
      const body = document.createElement("div")
      body.className = "ai-think"
      body.textContent = reply.thinkingText ?? ""
      el.appendChild(body)
    }
  }

  const bodyText = reply.text
  const useLines =
    !reply.error &&
    ((reply.parsed?.length ?? 0) > 0 || (reply.streaming && bodyText.trimStart().startsWith("{")))
  if (useLines) {
    const items: AiSentenceResult[] =
      reply.parsed && reply.parsed.length > 0 ? reply.parsed : previewAiResults(bodyText)
    const list = document.createElement("div")
    list.className = "ai-lines"
    fillAiLines(list, aiLineViews(reply, items))
    el.appendChild(list)
    if (reply.streaming) aiStreamEl = list
  } else {
    const text = document.createElement("div")
    if (reply.error) {
      text.textContent = `出错了：${reply.error}`
    } else {
      text.classList.add("ai-md")
      fillMarkdown(text, bodyText || (reply.streaming ? "…" : ""))
      if (reply.streaming) text.dataset.mdText = bodyText
    }
    el.appendChild(text)
    if (reply.streaming) aiStreamEl = text
  }
  if (reply.note) {
    const note = document.createElement("div")
    note.className = "ai-note"
    note.textContent = reply.note
    el.appendChild(note)
  }
  if (reply.issues && reply.issues.length > 0) {
    const issues = document.createElement("div")
    issues.className = "ai-note"
    issues.textContent = `没过的句子：${reply.issues.map((issue) => `${issue.label} ${issue.message}`).join("；")}`
    el.appendChild(issues)
  }

  if (!reply.error && (reply.text.trim() !== "" || input.replies.length > 1)) {
    const actions = document.createElement("div")
    actions.className = "ai-actions"
    if (reply.ok && reply.ok.length > 0) {
      const apply = document.createElement("button")
      apply.type = "button"
      apply.className = "ai-apply"
      apply.textContent = reply.applied ? "已填入" : "填入词格"
      apply.disabled = !!reply.applied
      apply.addEventListener("click", () => applyAiReply(reply))
      actions.appendChild(apply)
    }
    actions.appendChild(
      aiIconButton(
        "复制",
        '<rect x="9" y="9" width="13" height="13" rx="2.6"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        () => {
          void copyText(reply.text).then((ok) => setStatus(ok ? "已复制" : "复制失败", !ok))
        },
      ),
    )
    // 重跑：生成中不显示（跑完了再出现）
    if (!reply.streaming) {
      actions.appendChild(
        aiIconButton(
          "重跑",
          '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
          () => void rerunAi(turn, input),
        ),
      )
    }
    el.appendChild(actions)
  }
}

function switchInput(turn: AiTurn, delta: number): void {
  const next = turn.inputIndex + delta
  if (next < 0 || next >= turn.inputs.length) return
  repaintKeepingScroll(pathIndexOf(turn), () => {
    turn.inputIndex = next
    turn.inputs[next].editing = false
  })
}

function switchReply(turn: AiTurn, input: AiInputVersion, delta: number): void {
  const next = input.replyIndex + delta
  if (next < 0 || next >= input.replies.length) return
  repaintKeepingScroll(pathIndexOf(turn), () => {
    input.replyIndex = next
  })
}

function aiVersionNav(
  index: number,
  total: number,
  onIndexChange: (delta: number) => void,
): HTMLElement {
  const nav = document.createElement("span")
  nav.className = "ai-versions"
  if (total <= 1) return nav
  const back = document.createElement("button")
  back.type = "button"
  back.textContent = "‹"
  back.disabled = index <= 0
  back.title = "上一版"
  back.addEventListener("click", () => {
    if (index <= 0) return
    onIndexChange(-1)
  })
  const count = document.createElement("span")
  count.textContent = `${index + 1} / ${total}`
  const forward = document.createElement("button")
  forward.type = "button"
  forward.textContent = "›"
  forward.disabled = index >= total - 1
  forward.title = "下一版"
  forward.addEventListener("click", () => {
    if (index >= total - 1) return
    onIndexChange(1)
  })
  nav.append(back, count, forward)
  return nav
}

function fillUserBubble(el: HTMLElement, turn: AiTurn, input: AiInputVersion): void {

  if (input.editing) {
    const box = document.createElement("div")
    box.className = "ai-user-edit-box"
    const area = document.createElement("textarea")
    area.className = "ai-user-edit"
    area.rows = 1
    area.value = input.text
    const actions = document.createElement("div")
    actions.className = "ai-user-edit-actions"
    const cancel = document.createElement("button")
    cancel.type = "button"
    cancel.className = "ai-edit-cancel"
    cancel.textContent = "取消"
    cancel.addEventListener("click", () => {
      input.editing = false
      renderAiMessages()
    })
    const send = document.createElement("button")
    send.type = "button"
    send.className = "ai-edit-send"
    send.textContent = "发送"
    const submit = () => {
      const text = area.value.trim()
      if (!text) return
      input.editing = false
      commitUserEdit(turn, text)
    }
    send.addEventListener("click", submit)
    area.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        submit()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        input.editing = false
        renderAiMessages()
      }
    })
    actions.append(cancel, send)
    box.append(area, actions)
    el.appendChild(box)
    const autoGrow = () => {
      area.style.height = "auto"
      area.style.height = `${Math.min(area.scrollHeight, 160)}px`
    }
    area.addEventListener("input", autoGrow)
    queueMicrotask(() => {
      autoGrow()
      area.focus()
      area.setSelectionRange(area.value.length, area.value.length)
    })
    return
  }

  const text = document.createElement("div")
  text.className = "ai-user-text"
  text.textContent = input.text
  el.appendChild(text)

  const actions = document.createElement("div")
  actions.className = "ai-actions"
  actions.appendChild(
    aiIconButton(
      "复制",
      '<rect x="9" y="9" width="13" height="13" rx="2.6"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
      () => {
        void copyText(input.text).then((ok) => setStatus(ok ? "已复制" : "复制失败", !ok))
      },
    ),
  )
  actions.appendChild(
    aiIconButton(
      "编辑",
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      () => {
        if (aiBusy) {
          setStatus("等这次生成完再改", true)
          return
        }
        input.editing = true
        renderAiMessages()
      },
    ),
  )
  if (turn.inputs.length > 1) {
    actions.appendChild(
      aiVersionNav(turn.inputIndex, turn.inputs.length, (delta) => switchInput(turn, delta)),
    )
  }
  el.appendChild(actions)
}

/** 改用户输入：追加一个输入版本（旧版留档可翻），并生成它的第一版回复 */
function commitUserEdit(turn: AiTurn, text: string): void {
  const input: AiInputVersion = { text, replies: [{ text: "" }], replyIndex: 0 }
  turn.inputs.push(input)
  turn.inputIndex = turn.inputs.length - 1
  const history = aiHistoryMessages(turn)
  renderAiMessages()
  scrollAiToBottom()
  void runAiGeneration(input.replies[0], text, history)
}

function turnMessages(turn: AiTurn): ChatMessage[] {
  const input = currentInput(turn)
  const reply = currentReply(turn)
  const messages: ChatMessage[] = [{ role: "user", content: input.text.slice(0, 2000) }]
  if (reply.text.trim() !== "") messages.push({ role: "assistant", content: reply.text.slice(0, 2000) })
  return messages
}

function aiHistoryMessages(before?: AiTurn): ChatMessage[] {
  const path = branchPath()
  const list = before ? path.slice(0, Math.max(0, path.indexOf(before))) : path
  return list.flatMap(turnMessages).slice(-6)
}

function applyAiReply(reply: AiVersion): void {
  if (!reply.ok || reply.ok.length === 0 || reply.applied) return
  // AI 独立窗口：自己不碰工程，把结果丢回主窗口去填（那边 mutate + 撤销 + 保存一条龙）
  if (AI_WINDOW_MODE) {
    emitQuiet(applyChannel(AI_WINDOW_DOC_ID), { ok: reply.ok })
    reply.applied = true
    renderAiMessages()
    persistConvosSoon(false)
    setStatus(`已让主窗口填入 ${reply.ok.length} 句（在主窗口里可撤销）`)
    return
  }
  let filled = 0
  let alternatives = 0
  mutate(() => {
    const summary = applyAiResults(store.project, reply.ok ?? [])
    filled = summary.filled
    alternatives = summary.alternatives
  })
  reply.applied = true
  renderAiMessages()
  focusCellInput()
  setStatus(
    `AI 已填 ${filled} 句${alternatives > 0 ? `，其中 ${alternatives} 句进了「AI」备选` : ""}（可撤销）`,
  )
  pushProjectSync()
}

function updateAiSendButton(): void {
  btnAiSend.textContent = aiBusy ? "■" : "↑"
  btnAiSend.title = aiBusy ? "停止" : "发送（Enter）"
}

function requireAiTarget(): boolean {
  const target = resolveTarget(aiSettings)
  if (!target) {
    setStatus("先在 ⚙ 里填接口地址 / 模型", true)
    openSettingsDialog("ai")
    return false
  }
  const provider = currentProvider()
  if (provider?.builtin && !target.apiKey.trim()) {
    setStatus(`还没填 ${provider.name} 的 API Key（点 ⚙ 设置）`, true)
    openSettingsDialog("ai")
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
  ensureConvoForDoc()
  const convo = activeConvo()
  if (convo && convo.title.trim() === "") {
    const chars = [...trimmed]
    convo.title = chars.slice(0, 20).join("") + (chars.length > 20 ? "…" : "")
  }
  const history = aiHistoryMessages()
  aiInput.value = ""
  const turn: AiTurn = {
    inputs: [{ text: trimmed, replies: [{ text: "" }], replyIndex: 0 }],
    inputIndex: 0,
  }
  // 挂到当前分支的末尾：有新轮就从"选中的回复"往下续；空对话才当根
  const path = branchPath()
  if (path.length === 0) {
    aiTurns.push(turn)
  } else {
    currentReply(path[path.length - 1]).next = turn
  }
  renderAiMessages()
  scrollAiToBottom()
  flushConvosWrite()
  await runAiGeneration(turn.inputs[0].replies[0], trimmed, history)
}

async function rerunAi(turn: AiTurn, input: AiInputVersion): Promise<void> {
  if (aiBusy) return
  if (!requireAiTarget()) return
  const history = aiHistoryMessages(turn)
  const reply: AiVersion = { text: "" }
  input.replies.push(reply)
  input.replyIndex = input.replies.length - 1
  renderAiMessages()
  scrollAiToBottom()
  await runAiGeneration(reply, input.text, history)
}

async function runAiGeneration(
  version: AiVersion,
  requestText: string,
  history: ChatMessage[],
): Promise<void> {
  const target = resolveTarget(aiSettings)
  if (!target) return
  const targets = aiTargetIds()
  version.streaming = true
  aiBusy = true
  aiAbort = new AbortController()
  updateAiSendButton()
  const started = Date.now()
  diag("ai.request", { model: target.model, history: history.length })
  const scopeIds =
    targets && targets.length > 0
      ? targets
      : allSentences(aiProject()).map((sentence) => sentence.id)
  const cells = allSentences(aiProject())
    .filter((sentence) => scopeIds.includes(sentence.id))
    .reduce((total, sentence) => total + totalCells(sentence.pattern), 0)
  const effort = effortOf(aiSettings)
  const thinkingOn = target.supportsThinking && effort !== "none"
  const maxTokens = maxTokensFor(cells, thinkingOn, effort, aiSettings.maxOutput)
  let thinkingStart = 0
  const onReasoning = (delta: string) => {
    const now = Date.now()
    if (!thinkingStart) thinkingStart = now
    version.thinkingMs = now - thinkingStart
    version.thinkingText = (version.thinkingText ?? "") + delta
    if (!aiStreamThinkEl && isReplyDisplayed(version)) renderAiMessages()
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
          ? `${requestText}\n\n${buildBrief(aiProject(), targets, requestText)}`
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
        if (aiStreamEl) queueStreamText(version)
        else if (isReplyDisplayed(version)) renderAiMessages()
      },
    })
    let results = parseAiSentences(raw)
    let validation = validateAiResults(aiProject(), results)
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
            if (aiStreamEl) queueStreamText(version)
            else if (isReplyDisplayed(version)) renderAiMessages()
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
      validation = validateAiResults(aiProject(), results)
    }
    version.streaming = false
    version.parsed = results
    version.ok = validation.ok
    version.issues = validation.issues
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    diag("ai.done", {
      ms: Date.now() - started,
      results: results.length,
      ok: validation.ok.length,
      issues: validation.issues.length,
      rounds,
    })
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
    version.streaming = false
    if (aiAbort?.signal.aborted) {
      version.note = "已停止"
      diag("ai.abort", { ms: Date.now() - started })
    } else {
      version.error = err instanceof Error ? err.message : String(err)
      diagError("ai.error", err, { ms: Date.now() - started })
      setStatus(`AI 出错：${version.error}`, true)
    }
    renderAiMessages()
  } finally {
    aiBusy = false
    aiAbort = null
    updateAiSendButton()
  }
}

/** 打开外部链接：桌面走系统浏览器，网页开新标签 */
async function openExternal(url: string): Promise<void> {
  const value = url.trim()
  if (!value) return
  if (isDesktop()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener")
      await openUrl(value)
      return
    } catch {
      // 插件不可用（权限没给等）就退回网页方式
    }
  }
  window.open(value, "_blank", "noopener")
}


const HELP_GUIDE: string[] = [
  "<b>格子</b>：点格子直接打字，一格一字——<b>只收汉字</b>（英文、拼音、数字、标点自动跳过）",
  "<b>词格</b>：句子左边的小框改这句的词格（如 <code>4/4</code> 表示 4+4）；「＋ 新增一句」沿用本句 / 本段最后一句的词格",
  "<b>韵辙</b>：右侧徽章显示<b>光标所在那一格</b>的辙，点它给<b>这一格</b>加锁（任意一格都能锁）；锁住的格子只收押该辙的字；正在打拼音时徽章会实时显示这段拼音的辙",
  "<b>韵组</b>：<b>拖拽框选</b>一段格子，或按 <kbd>Ctrl/⌘+G</kbd> 进「挑格模式」后点格子加/减（跨句跳着挑；按 <kbd>G</kbd> 或 <kbd>Esc</kbd> 退）→ 选中后格子上方会出现小浮动条（复制 / 清空 / 成组 / 解散 / ✕）→ 点「成组」勾要锁的项（<b>辙 / 韵母 / 声母 / 声调</b>，默认只锁辙）→ 这几格互相押：**光标在哪一格 → 同组所有格子（跨句也算）整格亮起**，光标不在组里时不显示任何标记、**建组时不合约束的字直接清空**、打字不合会被拦；对话框里还有「<b>推荐同韵字</b>」（常用字排前，点字直接填入）；想解散：点成员格子弹出的「解散这个韵组」小条 / 状态栏「韵组 N」总览里逐组解散 / 点那格的徽章 →「解散这个韵组」",
  "<b>一键成组</b>：工具条「<b>成组</b>」——勾维度（<b>辙 / 韵母 / 声母 / 声调</b>，默认只按辙）就把<b>全曲</b>有字的格子按这个维度自动归组并锁起来（同辙的字一组、同韵母的一组）；<b>已经在韵组里的格子不动</b>、只出现一次的不建组；一步可撤销",
  "<b>状态栏 · 韵脚</b>：底部那串「韵脚 江阳×12 …」是**整首每句最后一个有字的格**的辙统计（按出现次数排序）——句尾还空着时，看的就是它前面最近的有字格；用来一眼看清押韵分布",
  "<b>和声</b>：句子上「和声」按钮标记 / 取消；段落头「＋ 和声」在段尾加一句",
  "<b>备选</b>：句首「备选 N ◇」可以开新备选，写不同版本",
  "<b>导入</b>：<code>导入</code> 收歌词（可直接粘贴、选 <code>.txt/.lrc/.md</code>、或把文件拖进窗口）与 <code>选择 MIDI…</code>；导入会自动断句（连续 8 句以内不动，超过就在第 4、5 句之间断；一小节 ≤16 字、一句 ≤32 字）；多轨 MIDI：不重叠的带词轨合并循序读字，重叠的按字数定主歌 / 和声；MIDI 里带的歌词事件会整段抄进原文",
  "<b>导出 / 复制</b>：导出 → 歌词 / 词格 / 带歌词 MIDI（写回原 MIDI）；复制 → 歌词 / 词格",
  "<b>查找替换</b>：工具栏「查找」或 <kbd>Cmd/Ctrl+F</kbd>；替换会<b>按字数改词格</b>（短了删格、长了插格），可一步撤销",
  "<b>文档栏（左栏）</b>：歌词分组，每组下面是它的 AI 会话；鼠标悬浮歌名行时左边的文件夹会变成三角，点它折叠 / 展开；「＋ 新建对话」开新会话",
  "<b>AI 面板（桌面版）</b>：点工具栏「AI」开一个<b>独立窗口</b>（每篇歌词一个，关窗＝隐藏、生成继续；主窗口一保存就把最新词格推过去；「填入词格」写回主窗口，可撤销；Enter 发送 / Esc 收弹层）；选模型和等级 → 说要求；范围可选 整首 / 空句 / 选段 / 选句 / 对话（对话＝不附词格，直接聊；网页版是内嵌面板，其余相同）；回复能翻页（输入版本 × 回复版本）",
  "<b>保存</b>：草稿自动存本机；<code>保存工程</code> 存成 <code>.json</code> 文件，可换机 / 分享",
  "<b>网页版</b>：AI 不可用；Chrome / Edge 保存就地覆盖，Safari 走下载",
]

const HELP_KEYS: string[] = [
  "输入：<kbd>Enter</kbd> 下一句 · <kbd>←</kbd><kbd>→</kbd> 换格 · <kbd>↑</kbd><kbd>↓</kbd> 换句 · <kbd>Alt+←/→</kbd> 整句挪动 · <kbd>Backspace</kbd> 删当前格（空格时删前一格）",
  "框选：按住拖动选一串格子（连续一段）→ <kbd>Backspace</kbd>/<kbd>Delete</kbd> 清空 · <kbd>Cmd/Ctrl+C</kbd> 复制选中 · <kbd>Esc</kbd> 取消；<kbd>Cmd/Ctrl+A</kbd> 全选格子",
  "跳着选：<b><kbd>Ctrl/⌘+G</kbd> 进「挑格模式」</b>点格子加/减（跨句任意挑；再点取消；**已在韵组里的格子挑不动**——点它会整组闪一下、弹出「解散这个韵组」小条（1.2 秒自动收）；**误点了一格，快速双击那一格就退**；按 <kbd>G</kbd> 或 <kbd>Esc</kbd> 收起（退出模式并清空选择））；选中后上方出现浮动条（复制 / 清空 / 成组 / 解散 / ✕ 取消；误点空白处不会清掉已挑的格子）",
  "全局：<kbd>Cmd/Ctrl+S</kbd> 保存工程（加 <kbd>Shift</kbd> 另存为）· <kbd>Cmd/Ctrl+Z</kbd> 撤销 · <kbd>Shift+Cmd/Ctrl+Z</kbd> 重做 · <kbd>Cmd/Ctrl+F</kbd> 查找替换",
  "AI：输入框 <kbd>Enter</kbd> 发送（<kbd>Shift+Enter</kbd> 换行）；编辑消息 <kbd>Enter</kbd> 发送、<kbd>Esc</kbd> 取消",
  "弹窗：<kbd>Esc</kbd> 关闭；查找面板 <kbd>Enter</kbd> 下一处、<kbd>Shift+Enter</kbd> 上一处",
]

/** 帮助：使用说明 + 快捷键 + 导出诊断日志 */
type SettingsSection = "appearance" | "ai" | "data" | "about"

/** 统一设置（标题栏 ⚙）：外观 / AI / 数据 / 关于 */
function openSettingsDialog(initial: SettingsSection = "appearance"): void {
  const dialog = document.createElement("dialog")
  dialog.className = "settings-dialog"
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body settings-body"

  const head = document.createElement("div")
  head.className = "settings-head"
  const title = document.createElement("strong")
  title.textContent = "设置"
  const done = document.createElement("button")
  done.type = "submit"
  done.value = "ok"
  done.className = "dialog-inline-btn"
  done.textContent = "完成"
  head.append(title, done)

  const main = document.createElement("div")
  main.className = "settings-main"
  const nav = document.createElement("nav")
  nav.className = "settings-nav"
  const pane = document.createElement("div")
  pane.className = "settings-pane"
  main.append(nav, pane)
  form.append(head, main)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())

  const ids: SettingsSection[] = ["appearance", "ai", "data", "about"]
  const labels: Record<SettingsSection, string> = {
    appearance: "外观",
    ai: "模型",
    data: "数据",
    about: "关于",
  }
  const icons: Record<SettingsSection, string> = {
    appearance: "ic-set-appearance",
    ai: "ic-set-model",
    data: "ic-set-data",
    about: "ic-set-about",
  }
  const navButtons = new Map<SettingsSection, HTMLButtonElement>()
  let current: SettingsSection | null = null
  /** 强制重画当前这一节（模型页保存/取消后要回到列表，用得到） */
  const reRender = (): void => {
    if (!current) return
    for (const [key, button] of navButtons) button.classList.toggle("active", key === current)
    pane.replaceChildren(settingsSectionView(current, reRender))
  }
  const select = (section: SettingsSection): void => {
    if (current === section) return
    current = section
    reRender()
    pane.scrollTop = 0
  }
  for (const id of ids) {
    const button = document.createElement("button")
    button.type = "button"
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    icon.setAttribute("class", "btn-icon")
    icon.setAttribute("viewBox", "0 0 24 24")
    icon.setAttribute("aria-hidden", "true")
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")
    use.setAttribute("href", `#${icons[id]}`)
    icon.appendChild(use)
    const label = document.createElement("span")
    label.textContent = labels[id]
    button.append(icon, label)
    button.addEventListener("click", () => select(id))
    navButtons.set(id, button)
    nav.appendChild(button)
  }
  // 点面板外面的区域（背景）自动关：和 DSH 一样。
  // 只有点在 dialog 本体（背景层 / 面板留白）上才判坐标，且必须落在面板矩形之外——
  // 面板留白不关、里面任何按钮都不关；合成点击（0,0）也不会误判。
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    if (outside) dialog.close("cancel")
  })
  select(initial)
  dialog.showModal()
}

function settingsSectionView(section: SettingsSection, reRender?: () => void): HTMLElement {
  if (section === "appearance") return settingsAppearanceView()
  if (section === "ai") return settingsAiView(reRender ?? (() => {}))
  if (section === "data") return settingsDataView()
  return settingsAboutView()
}

function settingsSection(title: string, hint?: string): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "settings-section"
  const head = document.createElement("div")
  head.className = "settings-title"
  head.textContent = title
  wrap.appendChild(head)
  if (hint) {
    const text = document.createElement("p")
    text.className = "settings-hint"
    text.textContent = hint
    wrap.appendChild(text)
  }
  return wrap
}

function settingsAppearanceView(): HTMLElement {
  const box = document.createElement("div")
  const wrap = settingsSection("主题", "选界面的亮暗。")
  const list = document.createElement("div")
  list.className = "settings-choices"
  for (const pref of ["auto", "light", "dark"] as ThemePref[]) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "settings-choice"
    row.classList.toggle("active", themeState.pref === pref)
    const icon = document.createElement("span")
    icon.className = "settings-choice-icon"
    icon.textContent = themeIcon(pref)
    const label = document.createElement("span")
    label.textContent = themeLabel(pref)
    const tick = document.createElement("span")
    tick.className = "tick"
    tick.textContent = "✓"
    row.append(icon, label, tick)
    row.addEventListener("click", () => {
      applyTheme(pref)
      for (const other of list.querySelectorAll(".settings-choice")) {
        other.classList.toggle("active", other === row)
      }
      setStatus(`主题：${themeLabel(pref)}`)
    })
    list.appendChild(row)
  }
  wrap.appendChild(list)
  box.appendChild(wrap)

  // 句子工具条排版：两种都留着，用户自己选（占位不跳版 / 不占位更紧凑）
  const metaWrap = settingsSection("句子工具条", "「备选 / 备注 / 按钮」那一条怎么排。")
  const metaList = document.createElement("div")
  metaList.className = "settings-choices"
  for (const value of ["compact", "reserve"] as MetaLayout[]) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "settings-choice"
    row.classList.toggle("active", metaLayoutState.value === value)
    const label = document.createElement("span")
    label.textContent = metaLayoutLabel(value)
    const tick = document.createElement("span")
    tick.className = "tick"
    tick.textContent = "✓"
    row.append(label, tick)
    row.addEventListener("click", () => {
      applyMetaLayout(value)
      for (const other of metaList.querySelectorAll(".settings-choice")) {
        other.classList.toggle("active", other === row)
      }
      setStatus(`句子工具条：${metaLayoutLabel(value)}`)
    })
    metaList.appendChild(row)
  }
  metaWrap.appendChild(metaList)
  box.appendChild(metaWrap)
  return box
}

/** 下一个自定义服务商的编号（custom-1 / custom-2 …，内置那个 custom 占位不占号） */
function nextCustomProviderId(): string {
  const used = new Set(aiSettings.providers.map((item) => item.id))
  let n = 1
  while (used.has(`custom-${n}`)) n += 1
  return `custom-${n}`
}

/** 删掉一个自定义服务商；如果删的是当前用的，回退到第一个有 Key 的 */
function removeCustomProvider(provider: AiProvider): void {
  const rest = aiSettings.providers.filter((item) => item.id !== provider.id)
  let providerId = aiSettings.providerId
  let model = aiSettings.model
  if (providerId === provider.id) {
    const fallback =
      rest.find((item) => item.apiKey.trim() && item.models.length > 0) ?? rest[0] ?? null
    providerId = fallback?.id ?? ""
    model = fallback?.models[0] ?? ""
  }
  aiSettings = { ...aiSettings, providers: rest, providerId, model }
  saveAiSettings(aiSettings)
  renderAiChips()
  setStatus(`已删除「${provider.name}」`)
}

/** 把编辑器里填的写回设置；返回是否成功 */
function applyModelEditor(
  editing: AiProvider | null,
  form: {
    providerId: string
    key: string
    baseUrl: string
    models: string[]
    name: string
    supportsThinking: boolean
    supportsEffort: boolean
  },
): boolean {
  const providers = aiSettings.providers.map((item) =>
    item.id === form.providerId
      ? {
          ...item,
          apiKey: form.key,
          baseUrl: form.baseUrl,
          models: form.models.length > 0 ? form.models : item.models,
        }
      : item,
  )
  const saved = providers.find((item) => item.id === form.providerId)!
  // 还没有可用的当前服务商（或当前那个没 Key）→ 切到这个刚配好的
  const current = providers.find((item) => item.id === aiSettings.providerId)
  const needSwitch =
    !current || !current.apiKey.trim() || current.models.length === 0 || !!editing === false
  const providerId = needSwitch ? saved.id : aiSettings.providerId
  const activeProvider = providers.find((item) => item.id === providerId)!
  const model = activeProvider.models.includes(aiSettings.model)
    ? aiSettings.model
    : (activeProvider.models[0] ?? "")
  aiSettings = { ...aiSettings, providers, providerId, model }
  saveAiSettings(aiSettings)
  renderAiChips()
  return true
}

interface SettingsModelEditorConfig {
  /** null = 新建；非 null = 编辑这个服务商 */
  provider: AiProvider | null
  tab: "builtin" | "custom"
  onCancel: () => void
  onSaved: (message: string) => void
}

/** 自定义提供商可选协议（值 = schema 标识符；界面显示产品名，照 DSH） */
const API_PROTOCOLS: Array<{ value: AiProvider["api"]; label: string }> = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
]

/** 「模型目录」小节（照 DSH）：状态行 + 行编辑 + ＋添加模型 / 恢复默认模型 / 获取可用模型 */
function settingsModelCatalog(config: {
  models: string[]
  /** 出厂目录（内置才有）；null = 没有基线，不给「恢复默认模型」 */
  defaultModels: () => string[] | null
  api: () => AiProvider["api"]
  baseUrl: () => string
  apiKey: () => string
  auth: () => "bearer" | "both"
  onMessage: (text: string, isError?: boolean) => void
}): { el: HTMLElement; read: () => string[]; set: (models: string[]) => void; refresh: () => void } {
  let rows = config.models.slice()
  const box = document.createElement("div")
  box.className = "settings-catalog"

  const head = document.createElement("div")
  head.className = "settings-catalog-head"
  const title = document.createElement("span")
  title.className = "settings-catalog-title"
  title.textContent = "模型目录"
  const status = document.createElement("span")
  status.className = "settings-catalog-status"
  const fetchBtn = document.createElement("button")
  fetchBtn.type = "button"
  fetchBtn.className = "settings-inline-btn"
  fetchBtn.textContent = "获取可用模型"
  const resetBtn = document.createElement("button")
  resetBtn.type = "button"
  resetBtn.className = "settings-inline-btn"
  resetBtn.textContent = "恢复默认模型"
  head.append(title, status, fetchBtn, resetBtn)

  const empty = document.createElement("div")
  empty.className = "settings-catalog-empty"
  empty.textContent = "模型列表为空：模型选择器里不会出现这家；目录外的模型 id 仍可直接发送。"
  const list = document.createElement("div")
  list.className = "settings-catalog-list"

  const foot = document.createElement("div")
  foot.className = "settings-catalog-actions"
  const addBtn = document.createElement("button")
  addBtn.type = "button"
  addBtn.className = "settings-inline-btn"
  addBtn.textContent = "＋ 添加模型"
  foot.appendChild(addBtn)

  const picker = document.createElement("div")
  picker.className = "settings-model-picker"
  picker.hidden = true
  const pickerList = document.createElement("div")
  pickerList.className = "settings-model-picker-list"
  const pickerFoot = document.createElement("div")
  pickerFoot.className = "settings-model-picker-actions"
  const pickerCancel = document.createElement("button")
  pickerCancel.type = "button"
  pickerCancel.className = "settings-inline-btn"
  pickerCancel.textContent = "取消"
  const pickerAdd = document.createElement("button")
  pickerAdd.type = "button"
  pickerAdd.className = "primary"
  pickerAdd.textContent = "添加所选"
  pickerFoot.append(pickerCancel, pickerAdd)
  picker.append(pickerList, pickerFoot)

  const read = (): string[] => rows.map((row) => row.trim()).filter((row) => row !== "")

  const syncStatus = (): void => {
    const now = read()
    const def = config.defaultModels()
    const sameAsDefault = def !== null && now.length === def.length && now.every((m, i) => m === def[i])
    status.textContent =
      now.length === 0 ? "" : def === null || !sameAsDefault ? "已自定义模型目录" : "正在使用默认模型"
    resetBtn.hidden = def === null || sameAsDefault
    fetchBtn.hidden = config.api() === "anthropic-messages"
    empty.hidden = now.length > 0
  }

  const renderRows = (): void => {
    list.replaceChildren()
    rows.forEach((value, index) => {
      const row = document.createElement("div")
      row.className = "settings-model-row"
      const input = document.createElement("input")
      input.type = "text"
      input.value = value
      input.placeholder = "模型 id"
      input.addEventListener("input", () => {
        rows[index] = input.value
        syncStatus()
      })
      const del = document.createElement("button")
      del.type = "button"
      del.className = "settings-model-del"
      del.textContent = "✕"
      del.title = "删掉这一行"
      del.addEventListener("click", () => {
        rows.splice(index, 1)
        renderRows()
      })
      row.append(input, del)
      list.appendChild(row)
    })
    syncStatus()
  }

  const set = (models: string[]): void => {
    rows = models.slice()
    picker.hidden = true
    renderRows()
  }

  addBtn.addEventListener("click", () => {
    rows.push("")
    renderRows()
    list.lastElementChild?.querySelector<HTMLInputElement>("input")?.focus()
  })

  resetBtn.addEventListener("click", () => {
    const def = config.defaultModels()
    if (def) set(def)
  })

  fetchBtn.addEventListener("click", () => {
    fetchBtn.disabled = true
    config.onMessage("正在获取可用模型…")
    void discoverModels({
      baseUrl: config.baseUrl(),
      api: config.api(),
      apiKey: config.apiKey(),
      auth: config.auth(),
    })
      .then((ids) => {
        pickerList.replaceChildren()
        const known = new Set(read())
        for (const id of ids) {
          const label = document.createElement("label")
          label.className = "settings-model-pick"
          const check = document.createElement("input")
          check.type = "checkbox"
          check.value = id
          check.checked = known.has(id)
          const name = document.createElement("span")
          name.className = "settings-model-id-text"
          name.textContent = id
          label.append(check, name)
          pickerList.appendChild(label)
        }
        picker.hidden = false
        config.onMessage(`拿到 ${ids.length} 个模型；勾选后点「添加所选」`)
      })
      .catch((err) => {
        config.onMessage(err instanceof Error ? err.message : String(err), true)
        picker.hidden = true
      })
      .finally(() => {
        fetchBtn.disabled = false
      })
  })

  pickerCancel.addEventListener("click", () => {
    picker.hidden = true
  })

  pickerAdd.addEventListener("click", () => {
    const chosen = Array.from(pickerList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((check) => check.checked)
      .map((check) => check.value)
    const known = new Set(read())
    let added = 0
    for (const id of chosen) {
      if (known.has(id)) continue
      rows.push(id)
      known.add(id)
      added += 1
    }
    renderRows()
    picker.hidden = true
    config.onMessage(added > 0 ? `已加入 ${added} 个模型` : "这些模型都已经在了")
  })

  box.append(head, empty, list, foot, picker)
  renderRows()
  return { el: box, read, set, refresh: syncStatus }
}

/** 模型设置的内嵌编辑器（照参考图：两个分页 + 表单 + 取消/保存） */
function settingsModelEditor(config: SettingsModelEditorConfig): HTMLElement {
  const editing = config.provider
  /** 只有「添加」才显示分页和「提供商」下拉；卡片里编辑用紧凑面板（对齐 DSH） */
  const adding = editing === null
  let tab: "builtin" | "custom" = config.tab
  const wrap = document.createElement("div")
  wrap.className = "settings-editor"

  const tabBuiltin = document.createElement("button")
  tabBuiltin.type = "button"
  tabBuiltin.className = "settings-tab"
  tabBuiltin.textContent = "预设提供商"
  tabBuiltin.addEventListener("click", () => {
    tab = "builtin"
    render()
  })
  const tabCustom = document.createElement("button")
  tabCustom.type = "button"
  tabCustom.className = "settings-tab"
  tabCustom.textContent = "自定义"
  tabCustom.addEventListener("click", () => {
    tab = "custom"
    render()
  })
  const tabs = document.createElement("div")
  tabs.className = "settings-tabs"
  tabs.append(tabBuiltin, tabCustom)

  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const box = document.createElement("label")
    box.className = "settings-field"
    box.append(document.createTextNode(label), control)
    if (hint) {
      const note = document.createElement("span")
      note.className = "hint"
      note.textContent = hint
      box.appendChild(note)
    }
    return box
  }

  const render = (): void => {
    wrap.replaceChildren()
    if (adding) wrap.appendChild(tabs)
    tabBuiltin.classList.toggle("active", tab === "builtin")
    tabCustom.classList.toggle("active", tab === "custom")

    // 编辑态：顶部一行「名字 + id」（对齐 DSH）
    if (editing) {
      const title = document.createElement("div")
      title.className = "settings-editor-title"
      const titleName = document.createElement("span")
      titleName.className = "settings-editor-name"
      titleName.textContent = editing.name
      const titleId = document.createElement("span")
      titleId.className = "settings-editor-id"
      titleId.textContent = editing.id
      title.append(titleName, titleId)
      wrap.appendChild(title)
    }

    const keyEl = document.createElement("input")
    keyEl.type = "password"
    keyEl.placeholder = "输入 API 密钥"
    keyEl.value = editing?.apiKey ?? ""
    const keyRow = document.createElement("div")
    keyRow.className = "row"
    keyRow.append(keyEl)
    // 显示 / 隐藏（password ←→ text，不然填了既看不见也没法核对）
    const reveal = document.createElement("button")
    reveal.type = "button"
    reveal.className = "settings-inline-btn"
    reveal.textContent = "显示"
    reveal.title = "显示 / 隐藏密钥"
    reveal.addEventListener("click", () => {
      const show = keyEl.type === "password"
      keyEl.type = show ? "text" : "password"
      reveal.textContent = show ? "隐藏" : "显示"
    })
    keyRow.append(reveal)
    // 复制当前 Key
    const keyCopy = document.createElement("button")
    keyCopy.type = "button"
    keyCopy.className = "settings-inline-btn"
    keyCopy.textContent = "复制"
    keyCopy.title = "把当前 Key 复制到剪贴板"
    keyCopy.addEventListener("click", () => {
      const value = keyEl.value.trim()
      if (!value) {
        setStatus("还没填 Key", true)
        return
      }
      void copyText(value).then((ok) => setStatus(ok ? "已复制 Key" : "复制失败", !ok))
    })
    keyRow.append(keyCopy)
    if (editing?.keyUrl) {
      const get = document.createElement("button")
      get.type = "button"
      get.className = "settings-inline-btn"
      get.textContent = "获取 Key"
      get.addEventListener("click", () => void openExternal(editing.keyUrl ?? ""))
      keyRow.append(get)
    }

    const cancel = document.createElement("button")
    cancel.type = "button"
    cancel.className = "settings-inline-btn"
    cancel.textContent = "取消"
    cancel.addEventListener("click", config.onCancel)
    const save = document.createElement("button")
    save.type = "button"
    save.className = "primary"
    save.textContent = "保存"
    const actions = document.createElement("div")
    actions.className = "settings-editor-actions"
    actions.append(cancel, save)

    // ===== 卡片里编辑：紧凑面板（对齐 DSH：名字+id / 密钥 / 自定义设置 / 取消·保存），没有分页、没有「提供商」下拉 =====
    if (editing) {
      const nameEl = document.createElement("input")
      nameEl.type = "text"
      nameEl.value = editing.name
      const baseEl = document.createElement("input")
      baseEl.type = "text"
      baseEl.value = editing.baseUrl
      const protoEl = document.createElement("select")
      for (const item of API_PROTOCOLS) {
        const option = document.createElement("option")
        option.value = item.value
        option.textContent = item.label
        protoEl.appendChild(option)
      }
      protoEl.value = editing.api
      const thinkEl = document.createElement("input")
      thinkEl.type = "checkbox"
      thinkEl.checked = editing.supportsThinking
      const thinkRow = document.createElement("label")
      thinkRow.className = "settings-field"
      thinkRow.append(thinkEl, document.createTextNode("支持 thinking 开关（thinking: enabled / disabled）"))
      const effortEl = document.createElement("input")
      effortEl.type = "checkbox"
      effortEl.checked = editing.supportsEffort
      const effortRow = document.createElement("label")
      effortRow.className = "settings-field"
      effortRow.append(effortEl, document.createTextNode("支持 reasoning_effort（low / high / max）"))

      const resultEl = document.createElement("span")
      resultEl.className = "hint"
      resultEl.hidden = true
      const say = (text: string, isError = false): void => {
        resultEl.hidden = false
        resultEl.textContent = text
        resultEl.classList.toggle("error", isError)
      }

      const apiOf = (): AiProvider["api"] =>
        editing.builtin ? editing.api : (protoEl.value as AiProvider["api"])
      const catalog = settingsModelCatalog({
        models: editing.models,
        // 内置用出厂目录当基线；自定义没有基线
        defaultModels: () =>
          editing.builtin
            ? (BUILTIN_PROVIDERS.find((item) => item.id === editing.id)?.models ?? null)
            : null,
        api: apiOf,
        baseUrl: () => baseEl.value,
        apiKey: () => keyEl.value,
        auth: () => editing.auth,
        onMessage: say,
      })

      const collapseBody = document.createElement("div")
      collapseBody.className = "body"
      if (!editing.builtin) collapseBody.append(field("显示名称", nameEl))
      collapseBody.append(
        field("API 地址", baseEl, editing.builtin ? "一般不用改" : "到 /v1 为止；不填 /v1 会按官方路径补"),
      )
      if (!editing.builtin) collapseBody.append(field("API 协议", protoEl, "以产品名显示，存的是协议标识符"))
      collapseBody.append(catalog.el)
      if (!editing.builtin) collapseBody.append(thinkRow, effortRow)
      const collapse = document.createElement("details")
      collapse.className = "settings-collapse"
      const summary = document.createElement("summary")
      summary.textContent = "自定义设置"
      collapse.append(summary, collapseBody)

      // 自定义：地址占位和提示跟着协议走（照 DSH）
      if (!editing.builtin) {
        const baseHint = collapse.querySelector(".settings-field .hint")
        protoEl.addEventListener("change", () => {
          const anthropic = protoEl.value === "anthropic-messages"
          baseEl.placeholder = anthropic ? "https://gateway.example" : ""
          if (baseHint) {
            baseHint.textContent = anthropic
              ? "请填写兼容 Anthropic Messages 协议的地址（会按 /v1/messages 补）"
              : "到 /v1 为止；不填 /v1 会按官方路径补"
          }
          catalog.refresh()
        })
      }

      // 「测试」：改完 Key / 地址能立刻试通一下（小的，跟「显示 / 复制」同款）
      const testBtn = document.createElement("button")
      testBtn.type = "button"
      testBtn.className = "settings-inline-btn"
      testBtn.textContent = "测试"
      testBtn.addEventListener("click", () => {
        const models = catalog.read()
        say("连接中…")
        void testAiConnection({
          baseUrl: baseEl.value,
          api: apiOf(),
          apiKey: keyEl.value,
          model: models[0] ?? "",
          effort: "default",
          auth: editing.auth,
          tokenParam: editing.tokenParam,
          supportsThinking: editing.builtin ? editing.supportsThinking : thinkEl.checked,
          supportsEffort: editing.builtin ? editing.supportsEffort : effortEl.checked,
          temperature: aiSettings.temperature,
        })
          .then((message) => {
            say(message)
          })
          .catch((err) => {
            say(err instanceof Error ? err.message : String(err), true)
          })
      })
      actions.prepend(testBtn)

      save.addEventListener("click", () => {
        const models = catalog.read()
        if (models.length === 0) {
          say("至少留一个模型", true)
          return
        }
        if (editing.builtin) {
          applyModelEditor(editing, {
            providerId: editing.id,
            key: keyEl.value.trim(),
            baseUrl: baseEl.value.trim(),
            models,
            name: editing.name,
            supportsThinking: editing.supportsThinking,
            supportsEffort: editing.supportsEffort,
          })
          config.onSaved(`已保存「${editing.name}」`)
          return
        }
        const name = nameEl.value.trim() || editing.name
        const providers = aiSettings.providers.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                name,
                baseUrl: baseEl.value.trim(),
                api: protoEl.value as AiProvider["api"],
                models,
                apiKey: keyEl.value.trim(),
                supportsThinking: thinkEl.checked,
                supportsEffort: effortEl.checked,
              }
            : item,
        )
        aiSettings = { ...aiSettings, providers }
        saveAiSettings(aiSettings)
        renderAiChips()
        config.onSaved(`已保存「${name}」`)
      })

      wrap.append(field("API 密钥", keyRow), collapse, actions, resultEl)
      return
    }

    if (tab === "custom") {
      const nameEl = document.createElement("input")
      nameEl.type = "text"
      nameEl.placeholder = "显示名称"
      const baseEl = document.createElement("input")
      baseEl.type = "text"
      baseEl.placeholder = "https://…（到 /v1 为止）"
      const protoEl = document.createElement("select")
      for (const item of API_PROTOCOLS) {
        const option = document.createElement("option")
        option.value = item.value
        option.textContent = item.label
        protoEl.appendChild(option)
      }
      protoEl.value = "openai-completions"
      const thinkEl = document.createElement("input")
      thinkEl.type = "checkbox"
      const thinkRow = document.createElement("label")
      thinkRow.className = "settings-field"
      thinkRow.append(
        thinkEl,
        document.createTextNode("支持 thinking 开关（thinking: enabled / disabled）"),
      )
      const effortEl = document.createElement("input")
      effortEl.type = "checkbox"
      const effortRow = document.createElement("label")
      effortRow.className = "settings-field"
      effortRow.append(effortEl, document.createTextNode("支持 reasoning_effort（low / high / max）"))

      const resultEl = document.createElement("span")
      resultEl.className = "hint"
      resultEl.hidden = true
      const say = (text: string, isError = false): void => {
        resultEl.hidden = false
        resultEl.textContent = text
        resultEl.classList.toggle("error", isError)
      }

      const catalog = settingsModelCatalog({
        models: [],
        defaultModels: () => null,
        api: () => protoEl.value as AiProvider["api"],
        baseUrl: () => baseEl.value,
        apiKey: () => keyEl.value,
        auth: () => "bearer",
        onMessage: say,
      })

      const baseField = field("API 地址", baseEl, "到 /v1 为止；不填 /v1 会按官方路径补")
      const baseHint = baseField.querySelector(".hint")
      protoEl.addEventListener("change", () => {
        const anthropic = protoEl.value === "anthropic-messages"
        baseEl.placeholder = anthropic ? "https://gateway.example" : "https://…（到 /v1 为止）"
        if (baseHint) {
          baseHint.textContent = anthropic
            ? "请填写兼容 Anthropic Messages 协议的地址（会按 /v1/messages 补）"
            : "到 /v1 为止；不填 /v1 会按官方路径补"
        }
        catalog.refresh()
      })

      save.addEventListener("click", () => {
        const models = catalog.read()
        if (models.length === 0) {
          say("至少填一个模型", true)
          return
        }
        const id = nextCustomProviderId()
        const providers = [
          ...aiSettings.providers,
          {
            id,
            name: nameEl.value.trim() || "自定义",
            baseUrl: baseEl.value.trim(),
            api: protoEl.value as AiProvider["api"],
            models,
            apiKey: keyEl.value.trim(),
            auth: "bearer" as const,
            tokenParam: "max_tokens" as const,
            supportsThinking: thinkEl.checked,
            supportsEffort: effortEl.checked,
            builtin: false,
          },
        ]
        const providerId = id
        const activeProvider = providers.find((item) => item.id === providerId)!
        const model = activeProvider.models.includes(aiSettings.model)
          ? aiSettings.model
          : (activeProvider.models[0] ?? "")
        aiSettings = { ...aiSettings, providers, providerId, model }
        saveAiSettings(aiSettings)
        renderAiChips()
        config.onSaved("已添加自定义服务商")
      })
      wrap.append(
        field("显示名称", nameEl),
        baseField,
        field("API 协议", protoEl, "以产品名显示，存的是协议标识符"),
        field("API 密钥", keyRow),
        catalog.el,
        thinkRow,
        effortRow,
        actions,
        resultEl,
      )
      return
    }

    // 第三方：从内置目录里挑一家填 Key（添加流程）。
    // 已经加过的（常驻两家 / 填过 Key 已经占卡片的）不再列出来
    const options = aiSettings.providers.filter(
      (item) =>
        item.builtin &&
        item.id !== "custom" &&
        !PINNED_PROVIDER_IDS.includes(item.id) &&
        !item.apiKey.trim(),
    )
    // 排序：中文在前（按拼音）、英文在后（按首字母）
    const isCjkName = (name: string): boolean => /^[\u3400-\u9fff]/.test(name)
    const zhName = new Intl.Collator("zh-Hans-CN", { usage: "sort", sensitivity: "base" })
    const enName = new Intl.Collator("en", { usage: "sort", sensitivity: "base" })
    options.sort((a, b) => {
      const aCjk = isCjkName(a.name)
      const bCjk = isCjkName(b.name)
      if (aCjk !== bCjk) return aCjk ? -1 : 1
      return (aCjk ? zhName : enName).compare(a.name, b.name)
    })
    const select = document.createElement("select")
    for (const item of options) {
      const option = document.createElement("option")
      option.value = item.id
      option.textContent = item.name
      select.appendChild(option)
    }
    select.value = options[0]?.id ?? ""
    let provider = options.find((item) => item.id === select.value) ?? options[0]
    keyEl.value = provider?.apiKey ?? ""
    if (provider?.keyUrl) {
      // 换服务商时「获取 Key」链接跟着换
      const get = keyRow.querySelector("button")
      if (get) get.onclick = () => void openExternal(provider?.keyUrl ?? "")
    }

    const baseEl = document.createElement("input")
    baseEl.type = "text"
    baseEl.value = provider?.baseUrl ?? ""

    const resultEl = document.createElement("span")
    resultEl.className = "hint"
    resultEl.hidden = true
    const say = (text: string, isError = false): void => {
      resultEl.hidden = false
      resultEl.textContent = text
      resultEl.classList.toggle("error", isError)
    }

    const catalog = settingsModelCatalog({
      models: provider?.models ?? [],
      defaultModels: () =>
        provider ? (BUILTIN_PROVIDERS.find((item) => item.id === provider.id)?.models ?? null) : null,
      api: () => provider?.api ?? "openai-completions",
      baseUrl: () => baseEl.value,
      apiKey: () => keyEl.value,
      auth: () => provider?.auth ?? "bearer",
      onMessage: say,
    })

    const syncSelected = (): void => {
      provider = options.find((item) => item.id === select.value) ?? options[0]
      keyEl.value = provider?.apiKey ?? ""
      baseEl.value = provider?.baseUrl ?? ""
      resultEl.hidden = true
      catalog.set(provider?.models ?? [])
    }
    select.addEventListener("change", syncSelected)

    const testBtn = document.createElement("button")
    testBtn.type = "button"
    testBtn.className = "settings-inline-btn"
    testBtn.textContent = "测试"
    testBtn.addEventListener("click", () => {
      if (!provider) return
      const models = catalog.read()
      say("连接中…")
      void testAiConnection({
        baseUrl: baseEl.value,
        api: provider.api,
        apiKey: keyEl.value,
        model: models[0] ?? "",
        effort: "default",
        auth: provider.auth,
        tokenParam: provider.tokenParam,
        supportsThinking: provider.supportsThinking,
        supportsEffort: provider.supportsEffort,
        temperature: aiSettings.temperature,
      })
        .then((message) => {
          say(message)
        })
        .catch((err) => {
          say(err instanceof Error ? err.message : String(err), true)
        })
    })

    const collapse = document.createElement("details")
    collapse.className = "settings-collapse"
    const summary = document.createElement("summary")
    summary.textContent = "自定义设置"
    const body = document.createElement("div")
    body.className = "body"
    body.append(field("接口地址", baseEl, "一般不用改"), catalog.el)
    collapse.append(summary, body)

    save.addEventListener("click", () => {
      if (!provider) return
      const models = catalog.read()
      if (models.length === 0) {
        say("至少留一个模型", true)
        return
      }
      applyModelEditor(editing, {
        providerId: provider.id,
        key: keyEl.value.trim(),
        baseUrl: baseEl.value.trim(),
        models,
        name: provider.name,
        supportsThinking: provider.supportsThinking,
        supportsEffort: provider.supportsEffort,
      })
      config.onSaved(`已保存「${provider.name}」`)
    })

    wrap.append(
      field(
        "提供商",
        select,
        options.length > 0
          ? "从内置目录里选 OpenAI、Anthropic、Kimi 等，填入 API 密钥即可使用"
          : "内置提供商都已经加过了；要加新的用上面的「自定义」",
      ),
      field("API 密钥", keyRow),
      collapse,
      field("连接", testBtn, "发一句最小请求试通"),
      resultEl,
      actions,
    )
  }

  render()
  return wrap
}

/** 设置 · 模型页：服务商卡片列表（照参考图）+ 添加 / 预设 */
function settingsAiView(reRender: () => void): HTMLElement {
  const wrap = settingsSection("模型")
  const intro = document.createElement("p")
  intro.className = "settings-intro"
  intro.textContent = "填入各提供商的 API 密钥即可使用其模型；每张卡片下面选它当前用哪个模型。Key 只存在这台电脑上。"
  wrap.appendChild(intro)

  const cards = document.createElement("div")
  cards.className = "settings-cards"
  wrap.appendChild(cards)

  /** 正在原地展开的卡片：服务商 id，或 "__add__"（展开「新建自定义」那张）；一次只展开一张 */
  let expandedId: string | null = null
  /** 底部的「＋ 添加模型提供商」（建在下面；展开新建卡时把它藏起来） */
  let addBtn: HTMLButtonElement | null = null

  const buildList = (): void => {
    cards.replaceChildren()
    for (const provider of aiSettings.providers) {
      // 内置的 custom 占位（没配过）不占卡片
      if (provider.id === "custom" && !provider.apiKey.trim() && !provider.baseUrl.trim()) continue
      // 照 DSH：列表 ≠ 目录。常驻只有 DeepSeek / 小米；其余内置填过 Key 才算「配过」才占卡片
      // （想用哪家去「＋ 添加模型提供商」里挑；预设目录没动）
      if (provider.builtin && !PINNED_PROVIDER_IDS.includes(provider.id) && !provider.apiKey.trim()) continue
      const card = document.createElement("div")
      card.className = "settings-card"

      const expanded = provider.id === expandedId
      const head = document.createElement("div")
      head.className = "settings-card-head"
      const name = document.createElement("span")
      name.className = "settings-card-name"
      name.textContent = provider.name
      head.append(name)
      if (!provider.builtin) {
        const tag = document.createElement("span")
        tag.className = "settings-tag"
        tag.textContent = "自定义"
        head.appendChild(tag)
      }
      // 状态点放在名字（标签）后面，照 DSH
      const dot = document.createElement("span")
      dot.className = `settings-dot${provider.apiKey.trim() ? " on" : ""}`
      dot.title = provider.apiKey.trim() ? "已填 Key" : "还没填 Key"
      head.appendChild(dot)
      const actions = document.createElement("div")
      actions.className = "settings-card-actions"
      const edit = document.createElement("button")
      edit.type = "button"
      edit.textContent = "编辑"
      actions.appendChild(edit)
      edit.addEventListener("click", () => {
        // 原地展开：编辑器长在这张卡片里（别的卡片不动）；再点一下收起
        expandedId = expanded ? null : provider.id
        buildList()
      })
      if (!provider.builtin) {
        const del = document.createElement("button")
        del.type = "button"
        del.className = "danger"
        del.textContent = "删除"
        del.addEventListener("click", () => {
          removeCustomProvider(provider)
          buildList()
        })
        actions.appendChild(del)
      }
      head.appendChild(actions)
      card.appendChild(head)

      if (expanded) {
        // 展开态：编辑器挂在卡片里，原来的「编辑 / 删除」都留着
        card.appendChild(
          settingsModelEditor({
            provider,
            tab: provider.builtin ? "builtin" : "custom",
            onCancel: () => {
              expandedId = null
              reRender()
            },
            onSaved: (message) => {
              expandedId = null
              setStatus(message)
              reRender()
            },
          }),
        )
      }
      cards.appendChild(card)
    }
    // 「添加」也是原地展开：在列表末尾长出一张新卡，别的卡片不动
    if (expandedId === "__add__") {
      const card = document.createElement("div")
      card.className = "settings-card"
      card.appendChild(
        settingsModelEditor({
          provider: null,
          tab: "custom",
          onCancel: () => {
            expandedId = null
            reRender()
          },
          onSaved: (message) => {
            expandedId = null
            setStatus(message)
            reRender()
          },
        }),
      )
      cards.appendChild(card)
    }
    if (addBtn) addBtn.hidden = expandedId === "__add__"
  }

  const add = document.createElement("button")
  add.type = "button"
  add.className = "settings-add"
  add.textContent = "＋ 添加模型提供商"
  add.addEventListener("click", () => {
    expandedId = "__add__"
    buildList()
  })
  addBtn = add
  wrap.appendChild(add)

  const presets = document.createElement("div")
  presets.className = "settings-presets"
  presets.append(document.createTextNode("服务商预设"))
  const refresh = document.createElement("button")
  refresh.type = "button"
  refresh.textContent = "刷新"
  refresh.addEventListener("click", () => {
    buildList()
    setStatus("服务商预设已刷新")
  })
  presets.appendChild(refresh)
  wrap.appendChild(presets)

  buildList()
  return wrap
}

function settingsDataView(): HTMLElement {
  const wrap = settingsSection("数据与维护", "都在本机操作，不联网。")
  const rows: { label: string; hint: string; run: () => void }[] = [
    {
      label: "恢复草稿备份",
      hint: "从本机自动留存的最多 5 份快照里恢复（恢复前会把当前状态也留一份）",
      run: () => openDraftBackupsDialog(),
    },
    {
      label: "导出诊断日志",
      hint: "运行信息 + 最近内部事件（不含歌词正文和提示词），出问题时发给开发者",
      run: () => void exportDiagLog(),
    },
    {
      label: "重置界面状态",
      hint: "输入框点不动 / 卡住时点这里：收拾残局，不碰数据",
      run: () => resetUiState(),
    },
  ]
  for (const row of rows) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "settings-data-row"
    const name = document.createElement("strong")
    name.textContent = row.label
    const hint = document.createElement("span")
    hint.textContent = row.hint
    button.append(name, hint)
    button.addEventListener("click", row.run)
    wrap.appendChild(button)
  }
  return wrap
}

function settingsAboutView(): HTMLElement {
  const wrap = settingsSection("作词助手", `版本 ${APP_VERSION}`)
  const help = document.createElement("button")
  help.type = "button"
  help.className = "dialog-inline-btn"
  help.textContent = "使用说明与快捷键…"
  help.addEventListener("click", () => openHelpDialog())
  wrap.appendChild(help)
  return wrap
}

function openHelpDialog(): void {
  const dialog = document.createElement("dialog")
  dialog.className = "help-dialog"
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"

  const title = document.createElement("strong")
  title.textContent = "帮助"
  form.appendChild(title)

  const section = (heading: string, items: string[]): void => {
    const head = document.createElement("div")
    head.className = "help-title"
    head.textContent = heading
    const list = document.createElement("ul")
    list.className = "help-list"
    for (const item of items) {
      const li = document.createElement("li")
      li.innerHTML = item
      list.appendChild(li)
    }
    form.append(head, list)
  }
  section("使用说明", HELP_GUIDE)
  section("快捷键", HELP_KEYS)

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const close = document.createElement("button")
  close.type = "submit"
  close.value = "ok"
  close.textContent = "知道了"
  actions.append(close)

  form.appendChild(actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())
  dialog.showModal()
}

function formatBackupTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 恢复草稿备份：列出快照 → 确认 → 覆盖当前草稿并重载（恢复前把当前也留一份） */
function openDraftBackupsDialog(): void {
  const snapshots = loadDocSnapshots().slice().sort((a, b) => b.t - a.t)
  if (snapshots.length === 0) {
    setStatus("还没有草稿备份（自动保存过几次之后就会出现）", true)
    return
  }
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.textContent = "恢复草稿备份"
  const hint = document.createElement("p")
  hint.textContent = "选一份覆盖当前草稿；恢复前会把当前状态也留一份，随时可以再换回来。"
  const list = document.createElement("div")
  list.className = "backup-list"
  for (const snapshot of snapshots) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "backup-row"
    const sentences = snapshot.docs.reduce(
      (total, doc) => total + allSentences(doc.project).length,
      0,
    )
    row.textContent = `${formatBackupTime(snapshot.t)} · ${snapshot.docs.length} 个歌词文件 · ${sentences} 句`
    row.addEventListener("click", () => confirmRestoreBackup(snapshot.t, dialog))
    list.appendChild(row)
  }
  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  actions.appendChild(cancel)
  form.append(title, hint, list, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())
  dialog.showModal()
}

function confirmRestoreBackup(t: number, parent: HTMLDialogElement): void {
  parent.close("cancel")
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.textContent = "恢复这份备份？"
  const text = document.createElement("p")
  text.textContent = `会用 ${formatBackupTime(t)} 的草稿覆盖当前内容（当前状态会先留一份备份）。`
  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  const ok = document.createElement("button")
  ok.type = "submit"
  ok.value = "ok"
  ok.textContent = "恢复"
  ok.className = "danger"
  actions.append(cancel, ok)
  form.append(title, text, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const action = dialog.returnValue
    dialog.remove()
    if (action !== "ok") return
    // 先落盘当前状态并留一份（可反悔），再覆盖并重载
    syncActiveDoc()
    persistDocs()
    snapshotDocs(docsState)
    if (!restoreDocSnapshot(t)) {
      setStatus("恢复失败：找不到这份备份", true)
      return
    }
    diag("drafts.restore", { t })
    setStatus("已恢复草稿备份，正在重载…")
    try {
      window.location.reload()
    } catch {
      render()
    }
  })
  dialog.showModal()
}

// ---------- 押韵组：框选浮动条 / 建组对话框 / 推荐同韵字 ----------

const pickBar = document.createElement("div")
pickBar.className = "pick-bar"
pickBar.hidden = true

function pickBarButton(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.textContent = label
  if (className) button.className = className
  button.addEventListener("click", onClick)
  return button
}

let pickBarCopyBtn: HTMLButtonElement | null = null
let pickBarClearBtn: HTMLButtonElement | null = null
let pickBarGroupBtn: HTMLButtonElement | null = null
let pickBarDissolveBtn: HTMLButtonElement | null = null
let dissolvePressAt = 0

function initPickBar(): void {
  pickBarCopyBtn = pickBarButton("复制", () => void copySelection())
  pickBarClearBtn = pickBarButton("清空", () => removeSelectedCells())
  pickBarGroupBtn = pickBarButton("成组", () => openRhymeGroupDialog(), "pick-rhyme")
  pickBarDissolveBtn = pickBarButton("解散", () => {
    // pointerdown 已处理过就别重复（真机上 click 有时会晚到/被吞）
    if (Date.now() - dissolvePressAt < 500) return
    if (pickDissolve) dissolveFlashedGroup()
    else dissolveSelectedGroups()
  })
  // 解散小条：按下的那一刻就生效——不赌 click 一定到
  pickBarDissolveBtn.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !pickDissolve) return
    event.preventDefault()
    dissolvePressAt = Date.now()
    dissolveFlashedGroup()
  })
  pickBar.append(
    pickBarCopyBtn,
    pickBarClearBtn,
    pickBarGroupBtn,
    pickBarDissolveBtn,
    pickBarButton("✕", () => {
      if (pickDissolve) {
        clearGroupDissolve()
        refreshPickBar()
      } else {
        clearSelection()
      }
    }, "pick-close"),
  )
  document.body.appendChild(pickBar)
  window.addEventListener("scroll", () => refreshPickBar(), { passive: true })
}

/** 挑格模式里点到成员（没有选择时）：出"解散这个押韵组"小条（1.2 秒自动收；光标在条上不收 / 点别处收） */
function showGroupDissolveBar(groupId: string): void {
  pickDissolve = { groupId }
  startGroupDissolveTimer()
  refreshPickBar()
}

function startGroupDissolveTimer(): void {
  if (pickDissolveTimer) clearTimeout(pickDissolveTimer)
  pickDissolveTimer = setTimeout(() => {
    // 鼠标还停在条上就先不收：不然你刚要点它就消失了
    let hovering = false
    try {
      hovering = pickBar.matches(":hover")
    } catch {
      hovering = false
    }
    if (hovering) {
      startGroupDissolveTimer()
      return
    }
    pickDissolve = null
    pickDissolveTimer = null
    refreshPickBar()
  }, 1200)
}

function clearGroupDissolve(): void {
  if (!pickDissolve) return
  pickDissolve = null
  if (pickDissolveTimer) clearTimeout(pickDissolveTimer)
  pickDissolveTimer = null
  refreshPickBar()
}

/** 解散小条上的动作：解散那一组 */
function dissolveFlashedGroup(): void {
  const id = pickDissolve?.groupId
  if (!id) return
  clearGroupDissolve()
  mutate(() => {
    dissolveRhymeGroup(store.project, id)
  })
  setStatus("已解散韵组")
}

/** 状态栏「押韵组 N」：点开总览 */
function bindStatusGroups(): void {
  statusGroupsEl.title = "查看这首歌的韵组"
  statusGroupsEl.addEventListener("click", () => openRhymeGroupsOverview())
}

/** 押韵组总览：有几组、什么约束、成员在哪；可悬停闪现 / 定位 / 解散 */
function openRhymeGroupsOverview(): void {
  const dialog = document.createElement("dialog")
  dialog.className = "rhyme-groups-dialog"
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.className = "dialog-drag-handle"
  title.tabIndex = -1
  const hint = document.createElement("p")
  hint.className = "rhyme-groups-hint"
  hint.textContent = "悬停一行会在网格里闪一下；「定位」把光标挪到那里；成员格子在挑格模式里点不动（会闪）"
  const list = document.createElement("div")
  list.className = "rhyme-groups-list"
  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const close = document.createElement("button")
  close.type = "submit"
  close.value = "cancel"
  close.textContent = "关闭"

  const renderList = (): void => {
    const groups = store.project.rhymeGroups ?? []
    title.textContent = `韵组 · ${groups.length} 组`
    hint.hidden = groups.length === 0
    list.replaceChildren()
    if (groups.length === 0) {
      const empty = document.createElement("p")
      empty.className = "rhyme-groups-empty"
      empty.textContent = "这首歌还没有韵组。拖拽框选或按 Ctrl/⌘+G 挑格子 → 浮动条「成组」。"
      list.appendChild(empty)
      return
    }
    const sentences = allSentences(store.project)
    for (const group of groups) {
      const row = document.createElement("div")
      row.className = "rhyme-group-row"

      const main = document.createElement("div")
      main.className = "rhyme-group-main"
      const constraint = document.createElement("button")
      constraint.type = "button"
      constraint.className = "rhyme-group-constraint"
      constraint.title = "点它改这个组的约束"
      constraint.textContent = constraintText(group.constraint)
      constraint.addEventListener("click", () => {
        dialog.close("cancel")
        openRhymeGroupEditDialog(group.id)
      })
      /** 跳到某一格：关弹窗 + 光标挪过去 + 滚到可见 + 整组闪一下 */
      const locate = (sentenceId: string, index: number): void => {
        dialog.close("cancel")
        moveCursorInPlace({ sentenceId, cell: index })
        const el = sentencesEl.querySelector<HTMLElement>(
          `.sentence[data-id="${sentenceId}"] .cell[data-index="${index}"], ` +
            `.sentence[data-id="${sentenceId}"] .cell-input[data-index="${index}"]`,
        )
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", behavior: "smooth" })
        }
        flashGroup(group.id)
      }

      // 成员位置：按句分组，每个格子一个小按钮（「3格·空」「4格·风」），点了跳到那一格
      const membersText = document.createElement("span")
      membersText.className = "rhyme-group-members"
      let first: { sentenceId: string; index: number } | null = null
      let firstPart = true
      sentences.forEach((sentence, sentenceIndex) => {
        const ref = (sentence.rhymeGroups ?? []).find((item) => item.id === group.id)
        if (!ref) return
        const cells = getCells(sentence)
        const indexes = [...ref.indexes].sort((a, b) => a - b)
        if (!firstPart) membersText.append(document.createTextNode("；"))
        firstPart = false
        membersText.append(document.createTextNode(`第 ${sentenceIndex + 1} 句 `))
        indexes.forEach((index) => {
          if (!first) first = { sentenceId: sentence.id, index }
          const button = document.createElement("button")
          button.type = "button"
          button.className = "rhyme-group-cell-button"
          button.textContent = `${index + 1}格·${cells[index] || "空"}`
          button.title = `点它跳到第 ${index + 1} 格`
          button.addEventListener("click", () => locate(sentence.id, index))
          membersText.appendChild(button)
        })
      })
      main.append(constraint, membersText)

      const locateBtn = document.createElement("button")
      locateBtn.type = "button"
      locateBtn.textContent = "定位"
      locateBtn.addEventListener("click", () => {
        const target = first as { sentenceId: string; index: number } | null
        if (target) locate(target.sentenceId, target.index)
      })
      const dissolve = document.createElement("button")
      dissolve.type = "button"
      dissolve.textContent = "解散"
      dissolve.addEventListener("click", () => {
        mutate(() => {
          dissolveRhymeGroup(store.project, group.id)
        })
        setStatus("已解散韵组")
        renderList()
      })
      row.append(main, locateBtn, dissolve)
      row.addEventListener("mouseenter", () => flashGroup(group.id))
      list.appendChild(row)
    }
  }

  renderList()
  actions.append(close)
  form.append(title, hint, list, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())
  makeDialogDraggable(dialog, title)
  dialog.showModal()
  title.focus()
}

/** 让对话框可以按标题拖着走：限制在窗口内，至少留 80px 可见 */
function makeDialogDraggable(dialog: HTMLDialogElement, handle: HTMLElement): void {
  let dragging = false
  let offsetX = 0
  let offsetY = 0
  let startX = 0
  let startY = 0
  let baseX = 0
  let baseY = 0
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return
    dragging = true
    startX = event.clientX
    startY = event.clientY
    baseX = offsetX
    baseY = offsetY
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      /* happy-dom 等环境可能不支持 */
    }
    event.preventDefault()
  })
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return
    let x = baseX + (event.clientX - startX)
    let y = baseY + (event.clientY - startY)
    const dialogWidth = dialog.offsetWidth
    const dialogHeight = dialog.offsetHeight
    if (dialogWidth > 0 && window.innerWidth > 0) {
      const centeredLeft = (window.innerWidth - dialogWidth) / 2
      const centeredTop = (window.innerHeight - dialogHeight) / 2
      x = Math.min(Math.max(x, -(dialogWidth - 80) - centeredLeft), window.innerWidth - 80 - centeredLeft)
      y = Math.min(
        Math.max(y, Math.min(0, -(dialogHeight - 80) - centeredTop)),
        Math.max(0, window.innerHeight - 80 - centeredTop),
      )
    }
    offsetX = x
    offsetY = y
    dialog.style.transform = `translate(${x}px, ${y}px)`
  })
  const stop = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    try {
      handle.releasePointerCapture(event.pointerId)
    } catch {
      /* 忽略 */
    }
  }
  handle.addEventListener("pointerup", stop)
  handle.addEventListener("pointercancel", stop)
}

/** 浮动条「解散」：把选中格子所在的押韵组全部解散 */
function dissolveSelectedGroups(): void {
  const ids = new Set<string>()
  for (const [sentenceId, indexes] of pickedCells) {
    const sentence = store.findSentence(sentenceId)
    if (!sentence) continue
    for (const index of indexes) {
      const group = groupAt(store.project, sentence, index)
      if (group) ids.add(group.id)
    }
  }
  if (ids.size === 0) {
    setStatus("选中的格子里没有韵组", true)
    return
  }
  mutate(() => {
    for (const id of ids) dissolveRhymeGroup(store.project, id)
  })
  clearSelection()
  setStatus(ids.size === 1 ? "已解散韵组" : `已解散 ${ids.size} 个韵组`)
}

/** 有选择时把浮动条贴在第一个选中格上方 */
function refreshPickBar(): void {
  // 按钮形态：选择模式（复制/清空/成组/解散/✕） vs 点成员后的解散小条（解散这个押韵组/✕）
  const dissolving = pickDissolve !== null
  if (pickBarCopyBtn) pickBarCopyBtn.hidden = dissolving
  if (pickBarClearBtn) pickBarClearBtn.hidden = dissolving
  if (pickBarGroupBtn) pickBarGroupBtn.hidden = dissolving
  if (pickBarDissolveBtn) pickBarDissolveBtn.textContent = dissolving ? "解散这个韵组" : "解散"

  // 解散小条优先：贴在那一组第一个成员格上方（不管有没有已挑的格子）
  if (pickDissolve && !dragStart) {
    const member = groupMemberEls(pickDissolve.groupId)[0]
    if (member) {
      positionPickBarAbove(member)
      return
    }
  }
  if (pickedCells.size === 0) {
    pickBar.hidden = true
    return
  }
  if (dragStart) {
    pickBar.hidden = true
    return
  }
  const anchorEl = anchorCellEl()
  const first = anchorEl ?? document.querySelector<HTMLElement>(".cell.selected, .cell-input.selected")
  if (!first) {
    pickBar.hidden = true
    return
  }
  positionPickBarAbove(first)
}

/** 锚点格（最后挑中的那格）还在选择里的话，返回它的元素 */
function anchorCellEl(): HTMLElement | null {
  if (!selectionAnchor) return null
  if (!(pickedCells.get(selectionAnchor.sentenceId)?.has(selectionAnchor.index) ?? false)) return null
  return document.querySelector<HTMLElement>(
    `.sentence[data-id="${selectionAnchor.sentenceId}"] .cell[data-index="${selectionAnchor.index}"], ` +
      `.sentence[data-id="${selectionAnchor.sentenceId}"] .cell-input[data-index="${selectionAnchor.index}"]`,
  )
}

/** 把浮动条贴在某个格子上方（滚出视野也贴边不消失） */
function positionPickBarAbove(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const left = Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150)
  const top = Math.min(Math.max(rect.top - 38, 8), window.innerHeight - 40)
  pickBar.style.left = `${left}px`
  pickBar.style.top = `${top}px`
  pickBar.hidden = false
}

const GROUP_FINALS = [
  "a", "o", "e", "i", "u", "v", "er", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong",
  "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong",
  "ua", "uo", "uai", "ui", "uan", "un", "uang", "ueng", "ve", "van", "vn",
]
const GROUP_INITIALS = [
  "", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
  "zh", "ch", "sh", "r", "z", "c", "s", "y", "w",
]

function openRhymeGroupDialog(): void {
  const spans = selectionSpans()
  const cells: { sentenceId: string; index: number }[] = []
  for (const span of spans) {
    for (let index = span.from; index <= span.to; index++) {
      cells.push({ sentenceId: span.sentence.id, index })
    }
  }
  if (cells.length < 2) {
    setStatus("先选中至少 2 个格子（拖拽框选，或按住 G 逐个点）", true)
    return
  }
  for (const cell of cells) {
    const sentence = store.findSentence(cell.sentenceId)
    if (sentence && groupAt(store.project, sentence, cell.index)) {
      setStatus("选中的格子里已经有人属于别的韵组了，先解散那个组", true)
      return
    }
  }
  // 预填：拿第一个有字的选中格当种子
  let seed = null
  for (const cell of cells) {
    const sentence = store.findSentence(cell.sentenceId)
    const char = sentence ? getCells(sentence)[cell.index] : ""
    if (char) {
      seed = pronunciationsOf(char)[0] ?? null
      if (seed) break
    }
  }
  openRhymeGroupConstraintDialog({
    title: `建立韵组（${cells.length} 格）`,
    hint: "勾哪几项就锁哪几项；同一条读音要同时满足。建组时，选中格里不合约束的字会被直接清空；建好后这几格之间互相押，打字不合会被拦。",
    okLabel: "建立韵组",
    cells,
    seed,
    initialConstraint: null,
    onSubmit: (constraint) => {
      let clearedCount = 0
      mutate(() => {
        addRhymeGroup(store.project, cells, constraint)
        // 选中的格里，有字但不合约束的：直接清空（⌘Z 可一步恢复）
        for (const cell of cells) {
          const sentence = store.findSentence(cell.sentenceId)
          if (!sentence) continue
          const char = getCells(sentence)[cell.index]
          if (char && !charFitsConstraint(char, constraint)) {
            setCells(sentence, clearCell(getCells(sentence), cell.index))
            clearedCount += 1
          }
        }
      })
      clearSelection()
      focusCellInput()
      setStatus(
        `已建立韵组（${cells.length} 格）：${constraintText(constraint)}${
          clearedCount > 0 ? `——已清空 ${clearedCount} 格不合的字` : ""
        }`,
        clearedCount > 0,
      )
    },
  })
}

/** 某个韵组的全部成员格（按文档顺序） */
function groupMemberCells(groupId: string): { sentenceId: string; index: number }[] {
  const cells: { sentenceId: string; index: number }[] = []
  for (const sentence of allSentences(store.project)) {
    const ref = (sentence.rhymeGroups ?? []).find((item) => item.id === groupId)
    if (!ref) continue
    for (const index of [...ref.indexes].sort((a, b) => a - b)) {
      cells.push({ sentenceId: sentence.id, index })
    }
  }
  return cells
}

/** 点总览里的约束（「发花辙」那处）进来：只改约束，成员一个不动 */
function openRhymeGroupEditDialog(groupId: string): void {
  const group = (store.project.rhymeGroups ?? []).find((item) => item.id === groupId)
  if (!group) {
    setStatus("这个韵组已经不在了", true)
    return
  }
  const cells = groupMemberCells(groupId)
  if (cells.length === 0) {
    setStatus("这个韵组没有成员格", true)
    return
  }
  let seed = null
  for (const cell of cells) {
    const sentence = store.findSentence(cell.sentenceId)
    const char = sentence ? getCells(sentence)[cell.index] : ""
    if (char) {
      seed = pronunciationsOf(char)[0] ?? null
      if (seed) break
    }
  }
  const before = constraintText(group.constraint)
  openRhymeGroupConstraintDialog({
    title: `编辑韵组（${cells.length} 格）`,
    hint: "改这个组的约束：勾哪几项就锁哪几项；只改约束，成员格子一个不动。",
    okLabel: "保存",
    cells,
    seed,
    initialConstraint: group.constraint,
    onSubmit: (constraint) => {
      mutate(() => {
        updateRhymeGroupConstraint(store.project, groupId, constraint)
      })
      setStatus(`已更新韵组约束：${before} → ${constraintText(constraint)}`)
      openRhymeGroupsOverview()
    },
  })
}

/** 一键成组：勾维度 → 全曲有字的格子自动归组锁起来 */
function openAutoGroupDialog(): void {
  const dialog = document.createElement("dialog")
  dialog.className = "rhyme-group-dialog auto-group-dialog"
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.className = "dialog-drag-handle"
  title.tabIndex = -1
  title.textContent = "一键成组"
  const hint = document.createElement("p")
  hint.textContent =
    "按勾选的维度把全曲有字的格子自动归组（同辙的字一组、同韵母的一组……）；已经在韵组里的格子不动，只出现一次的不会建组。可撤销。"
  form.append(title, hint)

  const aspects: { id: RhymeAspect; label: string; hint: string }[] = [
    { id: "rhy", label: "辙", hint: "同辙一组（默认）" },
    { id: "final", label: "韵母", hint: "同韵母一组" },
    { id: "initial", label: "声母", hint: "同声母一组（双声）" },
    { id: "tone", label: "声调", hint: "同声调一组" },
  ]
  const checks: { id: RhymeAspect; input: HTMLInputElement }[] = []
  for (const aspect of aspects) {
    const label = document.createElement("label")
    label.className = "dialog-check"
    const input = document.createElement("input")
    input.type = "checkbox"
    input.checked = aspect.id === "rhy"
    checks.push({ id: aspect.id, input })
    label.append(input, document.createTextNode(`${aspect.label}（${aspect.hint}）`))
    form.appendChild(label)
  }

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "button"
  cancel.textContent = "取消"
  cancel.addEventListener("click", () => dialog.close("cancel"))
  const ok = document.createElement("button")
  ok.type = "button"
  ok.className = "primary"
  ok.textContent = "自动成组"
  ok.addEventListener("click", () => dialog.close("ok"))
  actions.append(cancel, ok)
  form.appendChild(actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => {
    const picked = checks.filter((item) => item.input.checked).map((item) => item.id)
    dialog.remove()
    if (dialog.returnValue !== "ok") return
    if (picked.length === 0) {
      setStatus("先勾一个维度再成组", true)
      return
    }
    const labelText = picked
      .map((id) => aspects.find((aspect) => aspect.id === id)!.label)
      .join(" · ")
    // 先在克隆上跑一遍：没活干就别多压一步撤销
    const plan = autoGroupByRhyme(structuredClone(store.project), picked)
    if (plan.groups === 0) {
      setStatus("没有可成组的格子（没字、都已在韵组里、或同类只有一个）", true)
      return
    }
    mutate(() => {
      autoGroupByRhyme(store.project, picked)
    })
    focusCellInput()
    setStatus(`已按〈${labelText}〉成组：${plan.groups} 组 / ${plan.cells} 格（可撤销）`)
  })
  dialog.showModal()
}

/** 建组 / 编辑组共用的约束对话框 */
interface RhymeGroupConstraintConfig {
  title: string
  hint: string
  okLabel: string
  cells: { sentenceId: string; index: number }[]
  seed: { final: string; initial: string; tone: number } | null
  initialConstraint: RhymeConstraint | null
  onSubmit: (constraint: RhymeConstraint) => void
}

function openRhymeGroupConstraintDialog(config: RhymeGroupConstraintConfig): void {
  const cells = config.cells
  const seed = config.seed
  const dialog = document.createElement("dialog")
  dialog.className = "rhyme-group-dialog"
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.className = "dialog-drag-handle"
  title.tabIndex = -1
  title.textContent = config.title
  const hint = document.createElement("p")
  hint.textContent = config.hint

  const makeRow = (label: string, control: HTMLElement): { row: HTMLLabelElement; check: HTMLInputElement } => {
    const row = document.createElement("label")
    row.className = "dialog-field group-field"
    const check = document.createElement("input")
    check.type = "checkbox"
    row.append(check, document.createTextNode(label), control)
    return { row, check }
  }

  const rhySelect = document.createElement("select")
  RHYME_LABEL_BY_KEY.forEach((label, key) => {
    const option = document.createElement("option")
    option.value = key
    option.textContent = label
    rhySelect.appendChild(option)
  })
  // 用种子的韵母反推辙
  if (seed) {
    const matched = [...RHYME_LABEL_BY_KEY.keys()].find((key) => rhymeFinals(key).includes(seed.final))
    if (matched) rhySelect.value = matched
  }

  const finalSelect = document.createElement("select")
  for (const final of GROUP_FINALS) {
    const option = document.createElement("option")
    option.value = final
    option.textContent = final
    finalSelect.appendChild(option)
  }
  if (seed) finalSelect.value = seed.final

  const initialSelect = document.createElement("select")
  for (const initial of GROUP_INITIALS) {
    const option = document.createElement("option")
    option.value = initial
    option.textContent = initial === "" ? "零声母" : initial
    initialSelect.appendChild(option)
  }
  if (seed) initialSelect.value = seed.initial

  const toneBox = document.createElement("span")
  toneBox.className = "group-tones"
  const toneChecks: HTMLInputElement[] = []
  for (const [value, label] of [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [0, "轻"]] as [number, string][]) {
    const toneLabel = document.createElement("label")
    const check = document.createElement("input")
    check.type = "checkbox"
    check.value = String(value)
    if (seed && seed.tone === value) check.checked = true
    toneChecks.push(check)
    toneLabel.append(check, document.createTextNode(label))
    toneBox.appendChild(toneLabel)
  }

  const rhyRow = makeRow("辙", rhySelect)
  rhyRow.check.checked = true
  const finalRow = makeRow("韵母", finalSelect)
  const initialRow = makeRow("声母", initialSelect)
  const toneRow = makeRow("声调", toneBox)

  // 编辑已有组：按现有约束预填勾选与取值
  const initial = config.initialConstraint
  if (initial) {
    rhyRow.check.checked = initial.rhy !== undefined
    finalRow.check.checked = initial.final !== undefined
    initialRow.check.checked = initial.initial !== undefined
    const tones = initial.tones ?? []
    toneRow.check.checked = tones.length > 0
    for (const check of toneChecks) check.checked = tones.includes(Number(check.value))
    if (initial.rhy !== undefined) rhySelect.value = initial.rhy
    if (initial.final !== undefined) finalSelect.value = initial.final
    if (initial.initial !== undefined) initialSelect.value = initial.initial
  }

  const buildConstraint = (): RhymeConstraint => {
    const constraint: RhymeConstraint = {}
    if (rhyRow.check.checked) constraint.rhy = rhySelect.value
    if (finalRow.check.checked) constraint.final = finalSelect.value
    if (initialRow.check.checked) constraint.initial = initialSelect.value
    const tones = toneChecks.filter((check) => check.checked).map((check) => Number(check.value))
    if (toneRow.check.checked && tones.length > 0) constraint.tones = tones
    return constraint
  }

  const previewTitle = document.createElement("div")
  previewTitle.className = "ai-provider-note"
  const preview = document.createElement("div")
  preview.className = "candidate-grid"
  const renderPreview = (): void => {
    const constraint = buildConstraint()
    const list = candidateChars(constraint, 120)
    previewTitle.textContent = `推荐同韵字（${list.length}${list.length >= 120 ? "+" : ""}）：点一个字填进选中格`
    preview.replaceChildren()
    for (const char of list) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.textContent = char
      chip.title = constraintText(constraint)
      chip.addEventListener("click", () => pickCandidate(char, cells, constraint))
      preview.appendChild(chip)
    }
  }
  for (const control of [rhySelect, finalSelect, initialSelect, ...toneChecks]) {
    control.addEventListener("change", renderPreview)
  }
  for (const row of [rhyRow, finalRow, initialRow, toneRow]) {
    row.check.addEventListener("change", renderPreview)
  }
  renderPreview()

  const actions = document.createElement("div")
  actions.className = "dialog-actions"
  const cancel = document.createElement("button")
  cancel.type = "submit"
  cancel.value = "cancel"
  cancel.textContent = "取消"
  const ok = document.createElement("button")
  ok.type = "button"
  ok.textContent = config.okLabel
  ok.className = "primary"
  ok.disabled = cells.length < 2
  ok.addEventListener("click", () => {
    const constraint = buildConstraint()
    if (Object.keys(constraint).length === 0) {
      setStatus("至少勾一项（辙 / 韵母 / 声母 / 声调）", true)
      return
    }
    dialog.close("cancel")
    config.onSubmit(constraint)
  })
  actions.append(cancel, ok)

  form.append(title, hint, rhyRow.row, finalRow.row, initialRow.row, toneRow.row, previewTitle, preview, actions)
  dialog.appendChild(form)
  document.body.appendChild(dialog)
  dialog.addEventListener("close", () => dialog.remove())
  makeDialogDraggable(dialog, title)
  dialog.showModal()
  title.focus()
}

/** 把推荐字填进选中格：优先光标那格，其次第一个空格，都没有就第一格 */
function pickCandidate(
  char: string,
  cells: { sentenceId: string; index: number }[],
  constraint: RhymeConstraint,
): void {
  const fitsCell = (cell: { sentenceId: string; index: number }): boolean => {
    const sentence = store.findSentence(cell.sentenceId)
    if (!sentence) return false
    const lock = cellLockAt(sentence, cell.index)
    if (lock && !charFitsRhyme(char, lock)) return false
    return true
  }
  const preferred = cells.find(
    (cell) => cell.sentenceId === store.cursor.sentenceId && cell.index === store.cursor.cell,
  )
  const empty = cells.find((cell) => {
    const sentence = store.findSentence(cell.sentenceId)
    return sentence && !getCells(sentence)[cell.index] && fitsCell(cell)
  })
  const target = preferred && fitsCell(preferred) ? preferred : empty ?? cells[0]
  const sentence = store.findSentence(target.sentenceId)
  if (!sentence) return
  mutateSentence(target.sentenceId, () => {
    const s = store.findSentence(target.sentenceId)
    if (!s) return
    const cellsNext = getCells(s).slice()
    cellsNext[target.index] = char
    setCells(s, cellsNext)
  })
  setStatus(`已填入「${char}」（${constraintText(constraint)}）`)
}

/** 重置界面状态：把可能卡住的全局交互状态收干净（不碰任何数据） */
function resetUiState(): void {
  diag("ui.reset")
  restoreComposingBadge()
  composing = false
  composingInput = null
  justDragged = false
  dragStart = null
  imeJustEnded = false
  pickSuppressClick = false
  pickLastClick = null
  pickMode = false
  document.body.classList.remove("pick-mode")
  pickedCells.clear()
  // 关掉所有弹窗（用 cancel 语义，避免误应用锁/导入等）
  document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((dialog) => dialog.close("cancel"))
  closeAiPops()
  render()
  focusCellInput()
  setStatus("界面状态已重置（数据没动）")
}

/** 导出诊断日志：桌面端走保存对话框，网页版直接下载 */
async function exportDiagLog(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
  try {
    const saved = await saveText({
      suggestedName: `作词助手-诊断-${stamp}.txt`,
      description: "诊断日志",
      extensions: ["txt"],
      pickerId: "cige-diag",
      contents: diagText(),
    })
    if (!saved) return
    diag("diag.export", { kind: saved.kind })
    setStatus(saved.kind === "download" ? "已下载诊断日志" : "已导出诊断日志")
  } catch (err) {
    diagError("diag.export.error", err)
    setStatus("导出诊断日志失败", true)
  }
}

function openAiPromptView(): void {
  const targets = aiTargetIds()
  const writing = targets === null || targets.length > 0
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
  hint.textContent = writing
    ? `范围「${scopeLabel}」只影响下面第二段——标「→ 要写」的句子会让模型生成，其余只作上下文。当前模型：${
        target ? modelLabel(target.model) : "（还没配）"
      }`
    : `对话模式：不附带词格，只发你说的话。当前模型：${target ? modelLabel(target.model) : "（还没配）"}`

  const sysTitle = document.createElement("div")
  sysTitle.className = "ai-provider-note"
  sysTitle.textContent = "① 系统提示词（固定）"
  const sysArea = document.createElement("textarea")
  sysArea.readOnly = true
  sysArea.className = "ai-pre"
  sysArea.value = writing ? buildSystemPrompt() : buildChatSystemPrompt()

  const userTitle = document.createElement("div")
  userTitle.className = "ai-provider-note"
  userTitle.textContent = writing ? "② 本次请求（附在你说的话后面）" : "② 你说的话"
  const userArea = document.createElement("textarea")
  userArea.readOnly = true
  userArea.className = "ai-pre"
  userArea.value = writing ? buildBrief(store.project, targets, userText) : userText

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

const CONVO_PREVIEW_COUNT = 5
const convosExpandedGroups = new Set<string>()

function relTimeText(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天`
  const date = new Date(ts)
  const now = new Date()
  const md = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}年${md}`
}

function convoRow(convo: AiConversation): HTMLElement {
  const row = document.createElement("div")
  row.className = `ai-convo-row${convo.id === activeConvoId ? " active" : ""}`
  const title = document.createElement("span")
  title.className = "ai-convo-title"
  title.textContent = convo.title || "新会话"
  title.title = "双击改标题"
  const time = document.createElement("span")
  time.className = "ai-convo-time"
  time.textContent = relTimeText(convo.updatedAt)
  const del = document.createElement("button")
  del.type = "button"
  del.className = "ai-convo-del"
  del.title = "删除对话"
  del.setAttribute("aria-label", "删除对话")
  del.textContent = "✕"
  del.addEventListener("click", (event) => {
    event.stopPropagation()
    confirmDeleteConvo(convo)
  })
  title.addEventListener("dblclick", (event) => {
    event.stopPropagation()
    startRenameConvo(convo, title)
  })
  row.append(title, time, del)
  row.addEventListener("click", () => {
    if (convo.docId && convo.docId !== docsState.activeId && docsState.docs.some((doc) => doc.id === convo.docId)) {
      switchDoc(convo.docId)
    }
    if (convo.id !== activeConvoId) {
      setActiveConvo(convo.id)
      renderAiMessages(false)
      scrollAiToBottom()
    }
    if (aiPanel.hidden) openAiPanel()
    renderDocList()
  })
  return row
}

function startRenameConvo(convo: AiConversation, titleEl: HTMLElement): void {
  const input = document.createElement("input")
  input.className = "ai-convo-rename"
  input.value = convo.title
  titleEl.replaceWith(input)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  const commit = (save: boolean) => {
    if (save) {
      convo.title = input.value.trim()
      persistConvos()
    }
    renderDocList()
  }
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      commit(true)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      commit(false)
    }
  })
  input.addEventListener("blur", () => commit(true))
  input.addEventListener("click", (event) => event.stopPropagation())
}

function confirmDeleteConvo(convo: AiConversation): void {
  const dialog = document.createElement("dialog")
  const form = document.createElement("form")
  form.method = "dialog"
  form.className = "dialog-body"
  const title = document.createElement("strong")
  title.textContent = "删除对话"
  const text = document.createElement("p")
  text.textContent = `确定删除「${convo.title || "新会话"}」？删除后无法恢复。`
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
    if (action !== "ok") return
    const wasActive = convo.id === activeConvoId
    convos = convos.filter((item) => item.id !== convo.id)
    if (wasActive) {
      const fallback = latestConvoOfDoc(convo.docId) ?? [...convos].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
      if (fallback) {
        setActiveConvo(fallback.id)
      } else {
        activeConvoId = ""
        syncTurnsFromConvo()
      }
      renderAiMessages(false)
      scrollAiToBottom()
    }
    persistConvos(false)
    renderDocList()
    setStatus("已删除对话")
  })
  dialog.showModal()
}

function newConvo(): void {
  if (DOCS_WINDOW_MODE) {
    emitQuiet(DOCS_INTENT_CHANNEL, { type: "new-convo" })
    return
  }
  const created = createConvo(docsState.activeId || null)
  convos.unshift(created)
  setActiveConvo(created.id)
  renderAiMessages()
  scrollAiToBottom()
  if (aiPanel.hidden) openAiPanel()
  renderDocList()
  aiInput.focus()
  setStatus("已新建对话")
}

/** 把未知类型的错误说成人话（Tauri 的事件 payload 常常不是 Error） */
function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** 主窗口 → AI 窗口推工程快照（scope/目标句子在主窗口算好，AI 窗口只读） */
function pushProjectSync(docId?: string): void {
  if (AI_WINDOW_MODE || !isDesktop() || !aiDetached) return
  const id = docId ?? docsState.activeId
  if (!id) return
  const payload: ProjectSync = {
    docId: id,
    title: store.project.title || "未命名歌曲",
    project: store.project,
    targetIds: aiTargetIds(),
    scope: aiScope,
  }
  emitQuiet(syncChannel(id), payload)
}

/** 把尺寸钳到当前屏幕工作区内（各留 40px），两个拆出窗共用 */
function screenClampedSize(width: number, height: number): { width: number; height: number } {
  try {
    const scr = window.screen
    width = Math.min(width, Math.max(200, (scr.availWidth || width) - 40))
    height = Math.min(height, Math.max(300, (scr.availHeight || height) - 40))
  } catch {
    // window.screen 不可用就用原值
  }
  return { width: Math.round(width), height: Math.round(height) }
}

/** 拆出 AI 时的尺寸：宽 = 内嵌面板**最窄**宽（写死 400，不再跟内嵌当前宽度走），高 = 拆出时主窗口的高度 */
function detachedAiDefaultSize(): { width: number; height: number } {
  const height = Math.round(window.outerHeight || window.innerHeight || 780)
  return screenClampedSize(AI_MIN_WIDTH, height)
}

/** 拆出窗口的尺寸：一律用写死的最窄宽（不沿用上次拉大的尺寸）；只记住上次的位置 */
function readAiWinGeometry(): { width: number; height: number; x?: number; y?: number } {
  const geo: { width: number; height: number; x?: number; y?: number } = detachedAiDefaultSize()
  try {
    const raw = localStorage.getItem(AI_WIN_GEO_KEY)
    if (raw) {
      const data = JSON.parse(raw) as { x?: unknown; y?: unknown }
      if (typeof data.x === "number" && typeof data.y === "number") {
        geo.x = data.x
        geo.y = data.y
      }
    }
  } catch {
    // 解析失败：默认尺寸 + 自动位置
  }
  return geo
}

/** 新窗别压在主机窗上：能放右边就贴右边，放不下就级联到右下 */
function aiWindowPlacement(): { x?: number; y?: number } {
  try {
    const screen = window.screen as Screen & { availLeft?: number; availTop?: number }
    const avail = {
      w: screen.availWidth,
      h: screen.availHeight,
      left: screen.availLeft ?? 0,
      top: screen.availTop ?? 0,
    }
    const mainX = window.screenX
    const mainY = window.screenY
    const mainW = window.outerWidth
    const geo = readAiWinGeometry()
    const x = mainX + mainW + 10
    if (x + geo.width <= avail.left + avail.w) return { x, y: Math.max(avail.top, mainY) }
    return { x: mainX + 80, y: mainY + 60 }
  } catch {
    return {}
  }
}

function writeAiWinGeometry(): void {
  if (!isDesktop()) return
  void (async () => {
    try {
      const win = getCurrentWindow()
      const [size, position] = await Promise.all([win.outerSize(), win.outerPosition()])
      localStorage.setItem(
        AI_WIN_GEO_KEY,
        JSON.stringify({ width: size.width, height: size.height, x: position.x, y: position.y }),
      )
    } catch {
      // 拿不到尺寸就算了，不影响隐藏
    }
  })()
}

/** 已拆出去就把那篇的 AI 窗聚焦回来；没开就开一个 */
async function focusAiWindow(docId: string): Promise<void> {
  try {
    const opened = (await getAllWindows()).find((win) => win.label === aiWindowLabel(docId))
    if (opened) {
      await opened.show()
      await opened.setFocus()
      pushProjectSync(docId)
      return
    }
    await openAiWindow(docId)
  } catch (err) {
    setStatus(`AI 窗口打开失败：${describeErr(err)}`, true)
    diagError("ai.window.error", err)
  }
}

/** 主窗口启动时清掉残留的独立 AI 窗（AI 面板不持久，启动一律回到内嵌；否则重载后会两处都有面板） */
async function hideOrphanAiWindows(): Promise<void> {
  if (!isDesktop()) return
  try {
    const wins = await getAllWindows()
    for (const win of wins) {
      if (win.label.startsWith("ai-")) {
        try {
          await win.hide()
        } catch {
          // 单个窗失败不影响其它
        }
      }
    }
  } catch (err) {
    diagError("ai.orphan.cleanup", err)
  }
}

/** 主窗口里点「放回」：先藏掉独立 AI 窗，再收回内嵌（否则独立窗还开着＝两处都有面板） */
async function redockAiFromMain(): Promise<void> {
  await hideOrphanAiWindows()
  setAiDetached(false)
  openAiPanel()
}

/** 面板头按住往外拖：生成 / 唤出独立窗并跟随鼠标。
 *  松手留在松手的位置；要收回得把指针拖进停靠区再松手（那个窗自己判定），或用「放回」。 */
/** 让一个窗跟着指针走：同一时刻最多一个 setPosition 在飞、只追最新坐标。
 *  窗口可能是异步建出来的（拆出时）、也可能就是自己（独立窗里拖头），所以取窗用回调。 */
function createPointerFollower(getWin: () => TauriWindow | null): {
  move: (x: number, y: number) => void
  clear: () => void
} {
  let latest: { x: number; y: number } | null = null
  let sending = false
  const flush = (): void => {
    if (sending || !latest) return
    const win = getWin()
    if (!win) return
    const pos = latest
    latest = null
    sending = true
    void win
      .setPosition(new LogicalPosition(pos.x, pos.y))
      .catch(() => {})
      .finally(() => {
        sending = false
        flush()
      })
  }
  return {
    move: (x, y) => {
      latest = { x, y }
      flush()
    },
    clear: () => {
      latest = null
    },
  }
}

function bindPanelDragOut(
  handle: HTMLElement,
  spawn: (x: number, y: number) => Promise<TauriWindow | null>,
  cancel: () => void,
): void {
  let drag: {
    startX: number
    startY: number
    offsetX: number
    offsetY: number
    win: TauriWindow | null
    spawning: boolean
    moved: boolean
  } | null = null

  // 位置更新走 follower：同一时刻最多一个 setPosition 在飞，只追最新坐标
  const follower = createPointerFollower(() => drag?.win ?? null)

  const move = (e: PointerEvent): void => {
    if (!drag) return
    if (!drag.moved) {
      if (Math.abs(e.screenX - drag.startX) + Math.abs(e.screenY - drag.startY) < 8) return
      drag.moved = true
      document.documentElement.classList.add("panel-dragging")
    }
    const x = Math.round(e.screenX - drag.offsetX)
    const y = Math.round(e.screenY - drag.offsetY)
    if (!drag.win) {
      if (drag.spawning) return
      drag.spawning = true
      const current = drag
      void spawn(x, y)
        .then((win) => {
          if (drag === current) current.win = win
          else if (win) void win.destroy().catch(() => {})
        })
        .finally(() => {
          if (drag === current) current.spawning = false
        })
      return
    }
    follower.move(x, y)
  }

  const up = (e: PointerEvent): void => {
    if (!drag) return
    const current = drag
    drag = null
    follower.clear()
    handle.removeEventListener("pointermove", move)
    handle.removeEventListener("pointerup", up)
    handle.removeEventListener("pointercancel", up)
    try {
      handle.releasePointerCapture(e.pointerId)
    } catch {
      // 没捕获过就算了
    }
    document.documentElement.classList.remove("panel-dragging")
    if (!current.moved) return
    // 建窗没成功：把拆出状态收回内嵌
    if (!current.win) {
      cancel()
      return
    }
    // 松手在哪就留在哪；要不要吸回，交给那个窗自己的「指针进停靠区」判定
  }

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest("button, input, textarea, select, a")) return
    const rect = handle.getBoundingClientRect()
    drag = {
      startX: e.screenX,
      startY: e.screenY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      win: null,
      spawning: false,
      moved: false,
    }
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // 不支持捕获也能用：move/up 仍然按元素派发
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
}

/** 左键是否还按着（原生窗口拖动只有 onMoved，读不到松手；失败就当已松开） */
async function mouseLeftDown(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    return Boolean(await invoke("mouse_left_down"))
  } catch {
    return false
  }
}

/** 把独立窗滑到主窗停靠边（磁吸动画）：AI 靠右、文档栏靠左 */
async function slideToDock(win: TauriWindow, dockSide: "right" | "left"): Promise<void> {
  try {
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()])
    const main = (await getAllWindows()).find((item) => item.label === "main")
    if (main) {
      const [mainPos, mainSize] = await Promise.all([main.outerPosition(), main.outerSize()])
      const targetX = dockSide === "right" ? mainPos.x + mainSize.width - size.width : mainPos.x
      const targetY = mainPos.y
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        await win
          .setPosition(
            new LogicalPosition(
              Math.round(pos.x + (targetX - pos.x) * t),
              Math.round(pos.y + (targetY - pos.y) * t),
            ),
          )
          .catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 18))
      }
    }
  } catch {
    // 拿不到位置就直接往下走（照旧收回内嵌）
  }
}

/** 独立窗里按住面板头 = 拖这个窗（跟手规则和拆出时一致）；松手后吸不吸交给停靠区判定 */
function bindDetachedWindowDrag(handle: HTMLElement): void {
  const follower = createPointerFollower(() => getCurrentWindow())
  let drag: { startX: number; startY: number; offsetX: number; offsetY: number } | null = null

  const move = (e: PointerEvent): void => {
    if (!drag) return
    if (Math.abs(e.screenX - drag.startX) + Math.abs(e.screenY - drag.startY) < 8) return
    document.documentElement.classList.add("panel-dragging")
    follower.move(Math.round(e.screenX - drag.offsetX), Math.round(e.screenY - drag.offsetY))
  }

  const up = (e: PointerEvent): void => {
    if (!drag) return
    drag = null
    follower.clear()
    handle.removeEventListener("pointermove", move)
    handle.removeEventListener("pointerup", up)
    handle.removeEventListener("pointercancel", up)
    try {
      handle.releasePointerCapture(e.pointerId)
    } catch {
      // 没捕获过就算了
    }
    document.documentElement.classList.remove("panel-dragging")
  }

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest("button, input, textarea, select, a")) return
    const rect = handle.getBoundingClientRect()
    drag = {
      startX: e.screenX,
      startY: e.screenY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      // 不支持捕获也能用：move/up 仍然按元素派发
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  })
}

/** 停靠判定：指针贴着主窗侧边多近算「要停靠」（写死 20px，和悬浮窗宽度无关） */
const DOCK_EDGE_PX = 20

/** 独立窗拖回主窗口：指针进停靠区才高亮；松手还在停靠区 → 滑过去磁吸收回内嵌。
 *  窗口压在主窗上面、但指针不在停靠区时：什么都不吸，爱放哪放哪。 */
function bindDockBack(
  win: TauriWindow,
  hoverChannel: string,
  dockSide: "right" | "left",
  redock: () => void,
): void {
  let hovering = false
  let stopTimer: number | undefined
  let hideTimer: number | undefined
  let snapping = false
  let snappedTimer: number | undefined

  // 拖拽期间主窗几何基本不变：缓存 500ms，省掉每次 onMoved 的 IPC 查询
  let zoneCache: {
    x: number
    y: number
    width: number
    height: number
  } | null = null
  let zoneCacheAt = 0
  let lastZoneCheck = 0

  const zoneGeometry = async (): Promise<typeof zoneCache> => {
    const now = Date.now()
    if (zoneCache && now - zoneCacheAt <= 500) return zoneCache
    const main = (await getAllWindows()).find((item) => item.label === "main")
    if (!main) return null
    const [mainPos, mainSize] = await Promise.all([main.outerPosition(), main.outerSize()])
    zoneCache = {
      x: mainPos.x,
      y: mainPos.y,
      width: mainSize.width,
      height: mainSize.height,
    }
    zoneCacheAt = now
    return zoneCache
  }

  /** 浮窗的竖边离主窗的竖边多近算「要停靠」：写死 20px，**看窗口自己的边、不看鼠标**。
   *  浮窗左/右缘 ↔ 主窗左/右缘，任意一对在 20px 内就亮（对上原位＝右缘对右缘也算）。
   *  keep=true（框已经亮着）时放宽 80px——迟滞，避免边缘抖一下就让虚线框一闪一闪。 */
  const inDockZone = async (keep = false): Promise<boolean> => {
    const geo = await zoneGeometry()
    if (!geo) return false
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()])
    const pad = keep ? 80 : 0
    const centerY = pos.y + size.height / 2
    if (centerY < geo.y - pad || centerY > geo.y + geo.height + pad) return false
    const mainEdges = [geo.x, geo.x + geo.width]
    const winEdges = [pos.x, pos.x + size.width]
    return winEdges.some((edge) =>
      mainEdges.some((mainEdge) => Math.abs(edge - mainEdge) <= DOCK_EDGE_PX + pad),
    )
  }

  /** 更新停靠高亮：进带立刻亮；离带晚 140ms 再熄——避免边界抖动让虚线框「一闪一闪」 */
  const applyHover = (over: boolean): void => {
    if (snapping) return
    if (over) {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
        hideTimer = undefined
      }
      if (!hovering) {
        hovering = true
        emitQuiet(hoverChannel, { over: true })
      }
      return
    }
    if (!hovering || hideTimer !== undefined) return
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined
      if (hovering) {
        hovering = false
        emitQuiet(hoverChannel, { over: false })
      }
    }, 140)
  }

  const onMoved = (): void => {
    if (snapping) return
    // 高亮不用跟满帧：60ms 查一次就够，拖的时候少打点 IPC
    const now = Date.now()
    if (now - lastZoneCheck >= 60) {
      lastZoneCheck = now
      void inDockZone(hovering).then(applyHover).catch(() => {})
    }
    if (stopTimer !== undefined) window.clearTimeout(stopTimer)
    stopTimer = window.setTimeout(() => {
      stopTimer = undefined
      void settle()
    }, 220)
  }

  /** 停手后：还按着鼠标就继续等（不吸）；真松手了、指针还在停靠区，才磁吸收回 */
  const settle = async (): Promise<void> => {
    if (!hovering) return
    if (await mouseLeftDown()) {
      stopTimer = window.setTimeout(() => {
        stopTimer = undefined
        void settle()
      }, 120)
      return
    }
    hovering = false
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer)
      hideTimer = undefined
    }
    emitQuiet(hoverChannel, { over: false })
    if (!(await inDockZone(true))) return
    void snapBackDocked()
  }
  // 没有 onMoved（测试桩 / 老环境）就退化成只有「放回」按钮的旧行为
  try {
    void Promise.resolve(win.onMoved(onMoved)).catch(() => {})
  } catch {
    // 忽略
  }

  /** 磁吸动画：滑向主窗停靠边，然后收回内嵌、藏起自己。
   *  一进来就置 snapping：滑动会不停 setPosition、触发 onMoved；若不屏蔽，刚熄掉的虚线框会被重新点亮，
   *  settle 也会被重新武装、反复收回——表现就是「吸回后虚线还闪几秒」。 */
  const snapBackDocked = async (): Promise<void> => {
    snapping = true
    if (stopTimer !== undefined) {
      window.clearTimeout(stopTimer)
      stopTimer = undefined
    }
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer)
      hideTimer = undefined
    }
    hovering = false
    emitQuiet(hoverChannel, { over: false })
    try {
      await slideToDock(win, dockSide)
      redock()
      await win.hide().catch(() => {})
    } finally {
      // 藏好、事件静下来后再放开：之后重拆出来还能正常磁吸
      if (snappedTimer !== undefined) window.clearTimeout(snappedTimer)
      snappedTimer = window.setTimeout(() => {
        snappedTimer = undefined
        snapping = false
      }, 400)
    }
  }
}

/** 跨窗事件（只在主窗口启动时挂一次）：别的窗口发来的「放回 / 要快照 / 文档栏意向」。
 *  必须挂在启动这里——挂在「开窗」分支里的话，主窗口一刷新（dev 热更）就丢了，
 *  而窗还在（走「已存在」分支不再注册），磁吸/放回就没人接。 */
function bindCrossWindowEvents(): void {
  // AI 窗口「放回」或磁吸回来 → 收回内嵌（setAiDetached 里会打开内嵌面板）
  listenQuiet(AI_REDOCK_CHANNEL, (event) => {
    diag("ai.redock", { docId: (event.payload as { docId?: string } | null)?.docId ?? "" })
    setAiDetached(false)
  })
  // AI 窗口要一次当前状态（刚打开、或隐藏后重新显示）
  listenQuiet(AI_READY_CHANNEL, (event) => {
    const id = (event.payload as { docId?: string } | null)?.docId
    diag("ai.ready", { docId: id ?? "" })
    if (id) pushProjectSync(id)
  })
  // 文档栏窗「放回」或磁吸回来 → 收回主窗口
  listenQuiet(DOCS_REDOCK_CHANNEL, () => setDocsDetached(false))
  listenQuiet(DOCS_READY_CHANNEL, () => pushDocsSync())
  // 文档栏里的操作都是「意向」：真正动工程 / 弹确认的还在主窗口
  listenQuiet(DOCS_INTENT_CHANNEL, (event) => {
    const intent = event.payload as {
      type?: string
      id?: string
      name?: string
    } | null
    switch (intent?.type) {
      case "activate":
        if (intent.id) switchDoc(intent.id)
        break
      case "new-doc":
        addDoc()
        break
      case "delete":
        if (intent.id) deleteDoc(intent.id)
        break
      case "rename":
        if (intent.id) renameDoc(intent.id, intent.name ?? "")
        break
      case "new-convo":
        newConvo()
        break
    }
  })
}

/** 主窗口监听停靠高亮：显示 / 隐藏对应那条预览 */
function bindDockPreviews(): void {
  listenQuiet(DOCK_HOVER_AI, (event) => {
    const preview = document.querySelector<HTMLElement>("#ai-dock-preview")
    if (preview) preview.hidden = !(event.payload as { over?: boolean } | null)?.over
  })
  listenQuiet(DOCK_HOVER_DOCS, (event) => {
    const preview = document.querySelector<HTMLElement>("#docs-dock-preview")
    if (preview) preview.hidden = !(event.payload as { over?: boolean } | null)?.over
  })
}

/** 开 / 聚焦某篇歌词的 AI 窗口（每篇一个，label = ai-<docId>；已存在就 show + focus） */
async function openAiWindow(docId: string, at?: { x: number; y: number }): Promise<TauriWindow | null> {
  try {
    return await openAiWindowInner(docId, at)
  } catch (err) {
    setStatus(`AI 窗口打开失败：${describeErr(err)}`, true)
    diagError("ai.window.error", err)
    return null
  }
}

const aiDocChannelsBound = new Set<string>()

/** 按篇绑的 AI 通道（「填入词格」回来 / 生成范围同步）：同一篇只绑一次，拖出时走「窗已存在」分支也不会漏 */
function bindAiDocChannels(docId: string): void {
  if (aiDocChannelsBound.has(docId)) return
  aiDocChannelsBound.add(docId)
  // 「填入词格」从 AI 窗口回来：主窗口 mutate + 撤销栈 + 保存
  listenQuiet(applyChannel(docId), (event) => {
    const ok = (event.payload as { ok?: AiSentenceResult[] } | null)?.ok
    if (!ok || ok.length === 0) return
    let filled = 0
    let alternatives = 0
    mutate(() => {
      const summary = applyAiResults(store.project, ok)
      filled = summary.filled
      alternatives = summary.alternatives
    })
    focusCellInput()
    setStatus(
      `AI 已填 ${filled} 句${alternatives > 0 ? `，其中 ${alternatives} 句进了「AI」备选` : ""}（可撤销）`,
    )
    pushProjectSync(docId)
  })
  // AI 窗口里改了生成范围：主窗口这边的 scope 跟着变（下一次快照的目标才对）
  listenQuiet(scopeChannel(docId), (event) => {
    setAiScope(event.payload as AiScope)
  })
}

async function openAiWindowInner(docId: string, at?: { x: number; y: number }): Promise<TauriWindow | null> {
  bindAiDocChannels(docId)
  const label = aiWindowLabel(docId)
  const opened = (await getAllWindows()).find((win) => win.label === label)
  if (opened) {
    await opened.show()
    await opened.setFocus()
    // 拖出时让旧窗直接落到鼠标位置
    if (at) await opened.setPosition(new LogicalPosition(Math.round(at.x), Math.round(at.y))).catch(() => {})
    setAiDetached(true)
    pushProjectSync(docId)
    return opened
  }
  const url = `${window.location.origin}${window.location.pathname}?win=ai&doc=${encodeURIComponent(docId)}`
  const geo = readAiWinGeometry()
  const place = at ?? (geo.x !== undefined && geo.y !== undefined ? { x: geo.x, y: geo.y } : aiWindowPlacement())
  const doc = docsState.docs.find((item) => item.id === docId)
  const win = new WebviewWindow(label, {
    url,
    title: `AI 面板 · ${doc?.project.title || "未命名歌曲"}`,
    width: geo.width,
    height: geo.height,
    minWidth: AI_MIN_WIDTH,
    minHeight: 420,
    // Windows：和主窗一样用页面内自绘标题栏；macOS 保留系统窗框
    decorations: !IS_WINDOWS_DESKTOP,
    ...place,
  })
  await win.once("tauri://created", () => pushProjectSync(docId))
  await win.once("tauri://error", (err: unknown) => {
    setStatus(`AI 窗口打开失败：${describeErr(err)}`, true)
    diagError("ai.window.error", err)
    // 没拆成：收回内嵌，别让用户两边都摸不到
    setAiDetached(false)
  })
  return win
}

/** AI 独立窗口模式初始化：只挂 AI 面板，等主窗口推快照 */
/** 主窗口 → 文档栏窗口推全量列表（DocRecord 可直接 JSON，两份窗口各自的 docsState 用同一份数据） */
function pushDocsSync(): void {
  if (DOCS_WINDOW_MODE || !isDesktop()) return
  emitQuiet(DOCS_SYNC_CHANNEL, { docs: docsState.docs, activeId: docsState.activeId })
}

let docsSyncTimer: number | undefined
/** 列表重画很频繁（切换 / 新建 / 改名 / 建组都会）：合并成一次推送 */
function scheduleDocsSync(): void {
  if (DOCS_WINDOW_MODE || !isDesktop()) return
  if (docsSyncTimer !== undefined) window.clearTimeout(docsSyncTimer)
  docsSyncTimer = window.setTimeout(() => {
    docsSyncTimer = undefined
    pushDocsSync()
  }, 60)
}

/** 文档栏是否拆在主窗口外（拆出时主窗口的侧边栏让位） */
function setDocsDetached(detached: boolean): void {
  document.documentElement.classList.toggle("docs-detached", detached)
  const sidebar = document.querySelector<HTMLElement>(".sidebar")
  if (sidebar) sidebar.inert = detached
  const redockMain = document.querySelector<HTMLElement>("#btn-docs-redock-main")
  if (redockMain) redockMain.hidden = !detached
  try {
    localStorage.setItem(DOCS_DETACHED_KEY, detached ? "1" : "0")
  } catch {
    // 忽略配额错误
  }
}

/** 主窗口里点占位块的「放回」：藏掉文档栏窗 + 收回内嵌 */
async function redockDocsWindow(): Promise<void> {
  try {
    const opened = (await getAllWindows()).find((win) => win.label === DOCS_WINDOW_LABEL)
    if (opened) await opened.hide()
  } catch (err) {
    diagError("docs.redock.error", err)
  }
  setDocsDetached(false)
}

/** 已拆出去就把那个窗聚焦回来；没开就开一个 */
async function focusDocsWindow(): Promise<void> {
  try {
    const opened = (await getAllWindows()).find((win) => win.label === DOCS_WINDOW_LABEL)
    if (opened) {
      await opened.show()
      await opened.setFocus()
      return
    }
    await openDocsWindow()
  } catch (err) {
    setStatus(`文档栏窗口打开失败：${describeErr(err)}`, true)
    diagError("docs.window.error", err)
  }
}

/** 开文档栏独立窗口（单实例；默认不拆，只有用户点「拆出」或上次就是拆开状态才走这里） */
async function openDocsWindow(at?: { x: number; y: number }): Promise<TauriWindow | null> {
  try {
    const opened = (await getAllWindows()).find((win) => win.label === DOCS_WINDOW_LABEL)
    if (opened) {
      await opened.show()
      await opened.setFocus()
      if (at) await opened.setPosition(new LogicalPosition(Math.round(at.x), Math.round(at.y))).catch(() => {})
      setDocsDetached(true)
      pushDocsSync()
      return opened
    }
    const url = `${window.location.origin}${window.location.pathname}?win=docs`
    // 宽 = 左栏内嵌最窄宽（写死 240）；高 = 拆出时主窗口高度
    const docsSize = screenClampedSize(SIDEBAR_MIN_WIDTH, Math.round(window.outerHeight || window.innerHeight || 780))
    const win = new WebviewWindow(DOCS_WINDOW_LABEL, {
      url,
      title: "文档栏",
      width: docsSize.width,
      height: docsSize.height,
      minWidth: SIDEBAR_MIN_WIDTH,
      minHeight: 420,
      // Windows：和主窗一样用页面内自绘标题栏；macOS 保留系统窗框
      decorations: !IS_WINDOWS_DESKTOP,
      ...(at ? { x: Math.round(at.x), y: Math.round(at.y) } : {}),
    })
    await win.once("tauri://created", () => {
      setDocsDetached(true)
      pushDocsSync()
    })
    await win.once("tauri://error", (err: unknown) => {
      setStatus(`文档栏窗口打开失败：${describeErr(err)}`, true)
      diagError("docs.window.error", err)
    })
    return win
  } catch (err) {
    setStatus(`文档栏窗口打开失败：${describeErr(err)}`, true)
    diagError("docs.window.error", err)
    return null
  }
}

/** 文档栏独立窗口模式初始化：只挂侧边栏铺满，操作以意向发回主窗口 */
function initDocsWindowMode(): void {
  document.body.classList.add("docs-window")
  // 按住文档栏的头 = 拖这个窗（原来手型光标拖不动）
  const docsHead = document.querySelector<HTMLElement>(".sidebar-head")
  if (docsHead) bindDetachedWindowDrag(docsHead)
  bindDockBack(getCurrentWindow(), DOCK_HOVER_DOCS, "left", () => emitQuiet(DOCS_REDOCK_CHANNEL, {}))
  document.querySelector<HTMLElement>("#btn-docs-win")?.setAttribute("hidden", "")
  document.querySelector<HTMLElement>("#btn-docs-redock")?.removeAttribute("hidden")
  // Windows 自绘标题栏上的标题
  const barTitle = document.querySelector<HTMLElement>(".titlebar-title")
  if (barTitle) barTitle.textContent = "文档栏"
  const win = getCurrentWindow()
  // 关窗 = 放回主窗口（用户不会因此够不着文档列表）
  const redock = async (): Promise<void> => {
    emitQuiet(DOCS_REDOCK_CHANNEL, {})
    await win.hide()
  }
  void win.onCloseRequested(async (event) => {
    event.preventDefault()
    await redock()
  })
  document.querySelector("#btn-docs-redock")?.addEventListener("click", () => void redock())
  // 标题栏右上角那个「✕」在这个窗口里其实就是「放回主窗口」（关窗＝收回，见上）——
  // 图标 / 悬停色 / 提示都换成「放回」，别用红叉骗人
  const titleClose = document.querySelector<HTMLButtonElement>("#win-close")
  if (titleClose) {
    titleClose.classList.remove("close")
    titleClose.title = "放回主窗口"
    titleClose.setAttribute("aria-label", "放回主窗口")
    titleClose.innerHTML =
      '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-frame" /><use href="#ic-arrow-in" /><use href="#ic-arrow-in-head" /></svg>'
  }
  // 这两个按钮的 handler 平时挂在 bindToolbar / initAiPanel 里，文档栏窗口模式自己绑
  document.querySelector("#btn-new-doc")?.addEventListener("click", () => addDoc())
  document.querySelector("#btn-new-convo")?.addEventListener("click", () => newConvo())
  document.querySelector("#btn-sidebar")?.setAttribute("hidden", "")
  // 主窗口推来的全量列表：直接换成本地副本再画（复用 renderDocList 那一套）
  void listen(DOCS_SYNC_CHANNEL, (event) => {
    const payload = event.payload as { docs?: unknown; activeId?: unknown } | null
    const docs = Array.isArray(payload?.docs) ? (payload!.docs as DocRecord[]) : null
    if (docs) docsState.docs = docs
    if (typeof payload?.activeId === "string") docsState.activeId = payload.activeId
    renderDocList()
  })
  emitQuiet(DOCS_READY_CHANNEL, {})
  // 先用本地（localStorage，同源共享）画一版，主窗口的快照随后到
  renderDocList()
}

function initAiWindowMode(): void {
  document.body.classList.add("ai-window")
  // 按住 AI 面板的头 = 拖这个窗（原来手型光标拖不动）
  const aiHeadEl = document.querySelector<HTMLElement>("#ai-panel .ai-head")
  if (aiHeadEl) bindDetachedWindowDrag(aiHeadEl)
  btnAi.hidden = true
  if (AI_WINDOW_DOC_ID && docsState.docs.some((doc) => doc.id === AI_WINDOW_DOC_ID)) {
    docsState.activeId = AI_WINDOW_DOC_ID
  }
  const winTitle = document.querySelector<HTMLElement>("#ai-win-title")
  const barTitle = document.querySelector<HTMLElement>(".titlebar-title")
  const doc = docsState.docs.find((item) => item.id === AI_WINDOW_DOC_ID)
  const aiTitle = `AI 面板 · ${doc?.project.title || "未命名歌曲"}`
  if (winTitle) winTitle.textContent = aiTitle
  if (barTitle) barTitle.textContent = aiTitle
  const win = getCurrentWindow()
  // 拖回主窗口 → 高亮停靠位；停手还在上面 → 磁吸收回内嵌
  bindDockBack(win, DOCK_HOVER_AI, "right", () => emitQuiet(AI_REDOCK_CHANNEL, { docId: AI_WINDOW_DOC_ID }))
  // 关窗 = 隐藏：流式生成继续跑，不丢状态
  void win.onCloseRequested(async (event) => {
    event.preventDefault()
    writeAiWinGeometry()
    await win.hide()
  })
  // 「放回」：收回主窗口内嵌（主窗口那边恢复面板、清除拆出状态）
  const redockBtn = document.querySelector<HTMLButtonElement>("#btn-ai-redock")
  if (redockBtn) {
    redockBtn.hidden = false
    redockBtn.addEventListener("click", async () => {
      diag("ai.redock.click", { docId: AI_WINDOW_DOC_ID })
      emitQuiet(AI_REDOCK_CHANNEL, { docId: AI_WINDOW_DOC_ID })
      writeAiWinGeometry()
      await win.hide()
    })
  }
  const newBtn = document.querySelector<HTMLButtonElement>("#btn-ai-win-new")
  const closeBtn = document.querySelector<HTMLButtonElement>("#btn-ai-win-close")
  if (newBtn) {
    newBtn.hidden = false
    newBtn.addEventListener("click", () => {
      newConvo()
      aiInput.focus()
    })
  }
  if (closeBtn) {
    closeBtn.hidden = false
    closeBtn.addEventListener("click", async () => {
      writeAiWinGeometry()
      await win.hide()
    })
  }
  // 快捷键：Esc 收 AI 弹层；Enter 发送在 aiInput 上本来就绑着
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) closeAiPops()
  })
  // 收主窗口推来的快照（打开时问一次，之后随主窗口的改动持续推）
  void listen<ProjectSync>(syncChannel(AI_WINDOW_DOC_ID), (event) => {
    diag("ai.sync", { docId: AI_WINDOW_DOC_ID })
    projectMirror = event.payload.project
    projectMirrorTargetIds = event.payload.targetIds
    if (event.payload.scope) setAiScope(event.payload.scope as AiScope)
    if (winTitle) winTitle.textContent = `AI 面板 · ${event.payload.title || "未命名歌曲"}`
    if (barTitle) barTitle.textContent = `AI 面板 · ${event.payload.title || "未命名歌曲"}`
    updateAiHint()
  })
  emitQuiet(AI_READY_CHANNEL, { docId: AI_WINDOW_DOC_ID })
  // 画一版消息区：没人发过消息时至少显示引导语，别留一片空白
  renderAiMessages(false)
  scrollAiToBottom()
}

function initAiPanel(): void {
  if (!isDesktop()) {
    btnAi.disabled = true
    btnAi.title = "AI 填词仅桌面版可用（网页版暂不支持）"
    btnAi.setAttribute("aria-label", btnAi.title)
    document.querySelector<HTMLElement>("#btn-new-convo")?.setAttribute("hidden", "")
    return
  }
  if (AI_WINDOW_MODE) {
    initAiWindowMode()
  } else {
    initAiResizer()
    // 桌面端默认内嵌（和以前一样开合）；点「拆出」才变成独立窗口
    btnAi.title = "打开 / 收起 AI 面板"
    btnAi.addEventListener("click", () => {
      if (aiDetached) void focusAiWindow(docsState.activeId)
      else toggleAiPanel()
    })
    document.querySelector<HTMLButtonElement>("#btn-ai-redock-main")?.addEventListener("click", () => {
      void redockAiFromMain()
    })
    document.querySelector<HTMLButtonElement>("#btn-ai-detach")?.addEventListener("click", () => {
      // 点了就让位（不等窗口真正建出来）；建窗失败会自动收回
      setAiDetached(true)
      void openAiWindow(docsState.activeId)
    })
    // PS 式：按住 AI 面板头往外拖 = 拆出并跟随鼠标；松手还在主窗口里 = 作废
    const aiHead = aiPanel.querySelector<HTMLElement>(".ai-head")
    if (aiHead) {
      bindPanelDragOut(
        aiHead,
        async (x, y) => {
          setAiDetached(true)
          return await openAiWindow(docsState.activeId, { x, y })
        },
        () => setAiDetached(false),
      )
    }
  }
  renderAiChips()
  updateAiSendButton()
  updateAiHint()
  // 滚轮跟着鼠标走：指针在 AI 面板里（但不在消息区）也滚消息区，别去滚中间的词格
  aiPanel.addEventListener(
    "wheel",
    (event) => {
      const el = event.target instanceof Element ? event.target : null
      if (el?.closest(".ai-messages, .ai-pop")) return
      if (el instanceof HTMLTextAreaElement && el.scrollHeight > el.clientHeight) return
      aiMessagesEl.scrollTop += event.deltaY
      event.preventDefault()
    },
    { passive: false },
  )
  document.querySelector("#btn-ai-expand")?.addEventListener("click", () => {
    if (aiCovered()) {
      setAiWidth(aiRestoreWidth || AI_DEFAULT_WIDTH)
    } else {
      aiRestoreWidth = aiCurrentWidth
      setAiWidth(aiMaxWidth())
    }
  })
  document.querySelector("#btn-new-convo")?.addEventListener("click", newConvo)
  document.querySelector("#btn-ai-prompt")?.addEventListener("click", openAiPromptView)
  document.querySelector("#btn-ai-export")?.addEventListener("click", () => {
    if (aiExporting) exitAiExportMode()
    else enterAiExportMode()
  })
  btnAiExportAll.addEventListener("click", () => {
    const total = branchPath().length * 2
    if (total > 0 && aiExportPicked.size >= total) {
      aiExportPicked.clear()
    } else {
      for (let i = 0; i < branchPath().length; i++) {
        aiExportPicked.add(exportKey(i, "input"))
        aiExportPicked.add(exportKey(i, "reply"))
      }
    }
    renderAiMessages(false)
    updateAiExportBar()
  })
  document.querySelector("#btn-ai-export-cancel")?.addEventListener("click", exitAiExportMode)
  btnAiExportGo.addEventListener("click", () => void exportAiConversation())
  aiModelChip.addEventListener("click", openModelPop)
  aiEffortChip.addEventListener("click", openEffortPop)
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
  if (AI_WINDOW_MODE) {
    aiPanel.hidden = false
    scrollAiToBottom()
} else if (localStorage.getItem(AI_OPEN_KEY) === "1") {
    openAiPanel()
  }
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

  document.querySelector("#btn-import-lyrics")?.addEventListener("click", () => openImportDialog())
  document.querySelector("#btn-sv")?.addEventListener("click", () => void openSvBridgeDialog())
  document.querySelector("#btn-help")?.addEventListener("click", openHelpDialog)
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

  document.querySelector("#btn-settings")?.addEventListener("click", () => openSettingsDialog())
  document.querySelector("#btn-auto-group")?.addEventListener("click", openAutoGroupDialog)

  window.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (e.repeat && key !== "z" && key !== "y") return
    if (key === "f") {
      e.preventDefault()
      toggleFindPanel()
      return
    }
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

initDiag()
initTheme()
initMetaLayout()
initZoom()
bindZoomShortcuts((zoom) => setStatus(`界面缩放：${Math.round(zoom * 100)}%`))
// Windows 桌面版：系统标题栏已去掉（见 Rust 端 set_decorations(false)），用页面内自绘标题栏，自己实现窗口控制
if (IS_WINDOWS_DESKTOP) {
  document.documentElement.classList.add("win-desktop")
  const win = getCurrentWindow()
  const maxBtn = document.querySelector<HTMLButtonElement>("#win-max")
  const syncMax = async (): Promise<void> => {
    if (!maxBtn) return
    let maximized = false
    try {
      maximized = await win.isMaximized()
    } catch {
      // 拿不到状态就按未最大化显示
    }
    maxBtn.textContent = maximized ? "❐" : "▢"
    maxBtn.title = maximized ? "还原" : "最大化"
    maxBtn.setAttribute("aria-label", maxBtn.title)
  }
  const toggleMax = (): void => {
    void win.toggleMaximize().then(syncMax)
  }
  document.querySelector("#win-min")?.addEventListener("click", () => void win.minimize())
  maxBtn?.addEventListener("click", toggleMax)
  void win.onResized(() => void syncMax())
  void syncMax()
  document.querySelector("#win-close")?.addEventListener("click", () => void win.close())
  // 双击标题栏空白处切换最大化（原生行为）
  document.querySelector<HTMLElement>(".titlebar")?.addEventListener("dblclick", (event) => {
    if ((event.target as HTMLElement).closest(".titlebar-controls")) return
    toggleMax()
  })
}
trackTopbarHeight()
if (IS_DEV && !DOCS_WINDOW_MODE && !AI_WINDOW_MODE) {
  const titlebarTitle = document.querySelector<HTMLElement>(".titlebar-title")
  if (titlebarTitle) titlebarTitle.textContent = "作词助手（开发版）"
}
onAutosave(() => renderStatusBar())
onAutosaveWrite((s) => {
  // AI 窗口里的 project 只是镜像：不回写、不自动保存（那是主窗口的事）
  if (AI_WINDOW_MODE) return
  const doc = docsState.docs.find((d) => d.id === docsState.activeId)
  if (!doc) return
  doc.project = s.project
  doc.filePath = s.filePath
  doc.updatedAt = s.project.updatedAt
  saveDocs(docsState)
  pushProjectSync()
})
if (DOCS_WINDOW_MODE) {
  // 独立文档栏窗口：只挂侧边栏铺满，操作以意向发回主窗口
  initDocsWindowMode()
} else if (AI_WINDOW_MODE) {
  // 独立 AI 窗口：只挂 AI 面板 + 状态提示，主工作区那一整套不初始化
  initAiPanel()
} else {
  bindToolbar()
  initSidebarResizer()
  bindSelection()
  bindPickMode()
  initPickBar()
  bindStatusGroups()
  bindDrop()
  initFindPanel()
  initAiPanel()
  window.addEventListener("scroll", updateScrollProgress, { passive: true })
  window.addEventListener("resize", updateScrollProgress)
  render()
  focusCellInput()
  // 清掉残留的独立 AI 窗（默认内嵌；避免重载后主窗口与独立窗两处都有面板）
  void hideOrphanAiWindows()
  // 跨窗事件（放回 / 磁吸回来 / 文档栏意向）在主窗口启动时挂一次
  bindCrossWindowEvents()
  // 文档栏：默认内嵌（左侧边栏）；上次是拆开状态就把窗找回来
  const docsWinBtn = document.querySelector<HTMLButtonElement>("#btn-docs-win")
  if (docsWinBtn && isDesktop()) {
    docsWinBtn.addEventListener("click", () => void openDocsWindow())
    document
      .querySelector<HTMLButtonElement>("#btn-docs-redock-main")
      ?.addEventListener("click", () => void redockDocsWindow())
    if (localStorage.getItem(DOCS_DETACHED_KEY) === "1") void openDocsWindow()
    // PS 式：按住侧栏头往外拖 = 拆出并跟随鼠标；松手还在主窗口里 = 作废
    const sidebarHead = document.querySelector<HTMLElement>(".sidebar-head")
    if (sidebarHead) {
      bindPanelDragOut(
        sidebarHead,
        async (x, y) => {
          setDocsDetached(true)
          return await openDocsWindow({ x, y })
        },
        () => setDocsDetached(false),
      )
    }
  } else {
    docsWinBtn?.setAttribute("hidden", "")
  }
  // 独立窗拖回来时，主窗口里高亮它的停靠位
  bindDockPreviews()
}

export type { Project }
