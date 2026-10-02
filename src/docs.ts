import { createProject, parseProject } from "./state"
import type { Project } from "./model/types"

export interface DocRecord {
  id: string
  project: Project
  filePath: string | null
  updatedAt: string
}

export interface DocsState {
  activeId: string
  docs: DocRecord[]
}

const DOCS_KEY = "cige-grid-docs"
const LEGACY_KEY = "cige-grid-autosave"

let counter = 0

function newDocId(): string {
  counter += 1
  return `doc-${Date.now().toString(36)}-${counter}`
}

export function createDocFrom(project: Project, filePath: string | null): DocRecord {
  return {
    id: newDocId(),
    project,
    filePath,
    updatedAt: project.updatedAt,
  }
}

export function createDoc(title?: string): DocRecord {
  const project = createProject()
  if (title) project.title = title
  return {
    id: newDocId(),
    project,
    filePath: null,
    updatedAt: project.updatedAt,
  }
}

export function defaultDocs(): DocsState {
  const doc = createDoc()
  return { activeId: doc.id, docs: [doc] }
}

function normalizeDoc(raw: unknown): DocRecord | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as {
    id?: unknown
    project?: unknown
    filePath?: unknown
    updatedAt?: unknown
  }
  if (typeof data.id !== "string" || !data.id) return null
  try {
    const project = parseProject(JSON.stringify(data.project))
    return {
      id: data.id,
      project,
      filePath: typeof data.filePath === "string" ? data.filePath : null,
      updatedAt:
        typeof data.updatedAt === "string" ? data.updatedAt : project.updatedAt,
    }
  } catch {
    return null
  }
}

export function loadDocs(): DocsState {
  try {
    const raw = localStorage.getItem(DOCS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { activeId?: unknown; docs?: unknown }
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.docs)) {
        const docs = parsed.docs
          .map(normalizeDoc)
          .filter((doc): doc is DocRecord => doc !== null)
        const activeId =
          typeof parsed.activeId === "string" && docs.some((doc) => doc.id === parsed.activeId)
            ? parsed.activeId
            : ""
        return { activeId, docs }
      }
    }
  } catch {
    // 继续尝试旧数据或默认
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const data = JSON.parse(legacy) as { project?: unknown; filePath?: unknown }
      const doc: DocRecord = {
        id: newDocId(),
        project: parseProject(JSON.stringify(data.project)),
        filePath: typeof data.filePath === "string" ? data.filePath : null,
        updatedAt: new Date().toISOString(),
      }
      localStorage.removeItem(LEGACY_KEY)
      return { activeId: doc.id, docs: [doc] }
    }
  } catch {
    // 忽略
  }

  return defaultDocs()
}

const BACKUP_KEY = "cige-grid-docs-backup"
const BACKUP_LIMIT = 5
const BACKUP_INTERVAL_MS = 10 * 60_000
const BACKUP_EVERY_SAVES = 20

export interface DocsSnapshot {
  t: number
  docs: DocRecord[]
  activeId: string
}

let saveCount = 0
let lastSnapshotAt = 0

function persistSnapshots(list: DocsSnapshot[]): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list))
  } catch {
    // 容量不够：降级只留最新的一份
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(list.length - 1)))
    } catch {
      // 实在放不下就算了
    }
  }
}

/** 立即留一份草稿快照（最近 5 份，超出丢最旧） */
export function snapshotDocs(state: DocsState): void {
  const list = loadDocSnapshots()
  list.push({ t: Date.now(), docs: state.docs, activeId: state.activeId })
  while (list.length > BACKUP_LIMIT) list.shift()
  persistSnapshots(list)
  lastSnapshotAt = Date.now()
  saveCount = 0
}

/** 自动留档：每 10 分钟或每 20 次保存留一份（避免把存储撑爆） */
function maybeSnapshot(state: DocsState): void {
  saveCount += 1
  const due =
    lastSnapshotAt === 0 ||
    Date.now() - lastSnapshotAt >= BACKUP_INTERVAL_MS ||
    saveCount >= BACKUP_EVERY_SAVES
  if (!due || state.docs.length === 0) return
  snapshotDocs(state)
}

/** 测试用：把快照节流计数清零 */
export function resetDocsSnapshotState(): void {
  saveCount = 0
  lastSnapshotAt = 0
}

export function loadDocSnapshots(): DocsSnapshot[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const snap = item as Partial<DocsSnapshot>
      if (typeof snap.t !== "number" || !Array.isArray(snap.docs)) return []
      return [{ t: snap.t, docs: snap.docs, activeId: typeof snap.activeId === "string" ? snap.activeId : "" }]
    })
  } catch {
    return []
  }
}

/** 按时间戳恢复某份快照（覆盖当前草稿）；找不到返回 false */
export function restoreDocSnapshot(t: number): boolean {
  const snapshot = loadDocSnapshots().find((item) => item.t === t)
  if (!snapshot) return false
  localStorage.setItem(
    DOCS_KEY,
    JSON.stringify({ activeId: snapshot.activeId, docs: snapshot.docs }),
  )
  return true
}

export function saveDocs(state: DocsState): void {
  localStorage.setItem(DOCS_KEY, JSON.stringify(state))
  maybeSnapshot(state)
}

export interface DocsBackup {
  format: "cige-grid-drafts"
  version: 1
  exportedAt: string
  activeId: string
  docs: DocRecord[]
}

export function buildDocsBackup(state: DocsState): DocsBackup {
  return {
    format: "cige-grid-drafts",
    version: 1,
    exportedAt: new Date().toISOString(),
    activeId: state.activeId,
    docs: state.docs,
  }
}

export function parseDocsBackup(raw: string): DocsState | null {
  try {
    const data = JSON.parse(raw) as {
      format?: unknown
      activeId?: unknown
      docs?: unknown
    }
    if (data.format !== "cige-grid-drafts" || !Array.isArray(data.docs)) return null
    const docs = data.docs
      .map(normalizeDoc)
      .filter((doc): doc is DocRecord => doc !== null)
    if (docs.length === 0) return null
    const activeId = docs.some((doc) => doc.id === data.activeId)
      ? String(data.activeId)
      : docs[0].id
    return { activeId, docs }
  } catch {
    return null
  }
}
