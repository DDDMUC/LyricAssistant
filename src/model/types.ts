export interface Alternative {
  id: string
  name: string
  cells: string[]
}

export interface Sentence {
  id: string
  pattern: number[]
  alternatives: Alternative[]
  activeAlt: number
  note: string
  overflow: string
  /** 逐格韵辙锁：格索引（字符串）→ 辙 key；锁住的格子只收押该辙的字 */
  cellLocks?: Record<string, string>
  /** 老字段（只锁句尾）：读旧工程时自动迁移进 cellLocks，不再写 */
  rhymeLock?: string
  rhymeHint?: string
  role?: "harmony"
}

export interface Section {
  id: string
  name: string
  sentences: Sentence[]
}

export interface Project {
  version: 2
  title: string
  sections: Section[]
  updatedAt: string
  credits?: string[]
  source?: string
}

export interface Cursor {
  sentenceId: string
  cell: number
}

export interface ProjectStats {
  filled: number
  total: number
  sentences: number
  sections: number
  percent: number
  overflow: number
}
