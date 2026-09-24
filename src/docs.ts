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

export function saveDocs(state: DocsState): void {
  localStorage.setItem(DOCS_KEY, JSON.stringify(state))
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
