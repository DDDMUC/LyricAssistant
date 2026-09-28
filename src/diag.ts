import pkg from "../package.json"

/** 一条诊断记录：时间 + 类别 + 小数据（不记歌词正文 / 提示词全文） */
export interface DiagEntry {
  t: number
  kind: string
  data?: Record<string, unknown>
}

const MAX_ENTRIES = 300
const STORE_KEY = "cige-grid-diag"
const started = Date.now()

const entries: DiagEntry[] = []

/** 记一条（平时只进内存；出错时才整体落盘，崩溃/刷新后还能导出） */
export function diag(kind: string, data?: Record<string, unknown>): void {
  entries.push({ t: Date.now(), kind, data })
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

export function diagError(kind: string, error: unknown, data?: Record<string, unknown>): void {
  const err =
    error instanceof Error
      ? { errorName: error.name, errorMessage: error.message, stack: error.stack ?? "" }
      : { errorMessage: String(error) }
  diag(kind, { ...data, ...err })
  persist()
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // 忽略
  }
}

function loadPersisted(): DiagEntry[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const entry = item as Partial<DiagEntry>
      if (typeof entry.t !== "number" || typeof entry.kind !== "string") return []
      return [{ t: entry.t, kind: entry.kind, data: entry.data }]
    })
  } catch {
    return []
  }
}

function formatEntry(entry: DiagEntry, base: number, absolute: boolean): string {
  const stamp = absolute
    ? new Date(entry.t).toISOString().slice(11, 23)
    : `+${((entry.t - base) / 1000).toFixed(1)}s`
  const data = entry.data && Object.keys(entry.data).length > 0 ? ` ${JSON.stringify(entry.data)}` : ""
  return `[${stamp}] ${entry.kind}${data}`
}

/** 导出用文本：环境信息 + 本次会话条目 + 上次落盘的条目 */
export function diagText(): string {
  const version = (pkg as { version?: string }).version ?? "?"
  const lines: string[] = []
  lines.push("作词助手 · 诊断日志")
  lines.push(`导出时间: ${new Date().toISOString()}`)
  lines.push(`版本: ${version}`)
  lines.push(`平台: ${navigator.userAgent}`)
  lines.push(`—— 本次会话（${entries.length} 条）——`)
  for (const entry of entries) lines.push(formatEntry(entry, started, false))
  const persisted = loadPersisted()
  if (persisted.length > 0) {
    lines.push(`—— 上次出错时落盘的（${persisted.length} 条）——`)
    for (const entry of persisted) lines.push(formatEntry(entry, started, true))
  }
  return lines.join("\n")
}

export function diagCount(): number {
  return entries.length
}

export function diagClear(): void {
  entries.length = 0
}

/** 启动时挂上：未捕获报错 / 未处理的 Promise 都记下来并落盘 */
export function initDiag(): void {
  diag("app", {
    version: (pkg as { version?: string }).version ?? "?",
    ua: navigator.userAgent.slice(0, 120),
  })
  window.addEventListener("error", (event) => {
    diagError("window.error", event.error ?? event.message, {
      source: event.filename,
      line: event.lineno,
    })
  })
  window.addEventListener("unhandledrejection", (event) => {
    diagError("unhandledrejection", event.reason)
  })
}
