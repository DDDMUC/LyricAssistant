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
  /** 押韵组（跨句的组：每句存自己的部分，id 相同） */
  rhymeGroups?: RhymeGroupRef[]
  /** 逐格韵辙锁：格索引（字符串）→ 辙 key；锁住的格子只收押该辙的字 */
  cellLocks?: Record<string, string>
  /** 老字段（只锁句尾）：读旧工程时自动迁移进 cellLocks，不再写 */
  rhymeLock?: string
  rhymeHint?: string
  role?: "harmony"
}

/** 押韵组的约束：勾哪几项就查哪几项（同一条读音要同时满足） */
export interface RhymeConstraint {
  /** 辙 key（十三辙之一） */
  rhy?: string
  /** 韵母（规范化：ü→v、iu/ui/un；"零声母"用 initial: ""） */
  final?: string
  initial?: string
  /** 声调：1-4，0 = 轻声 */
  tones?: number[]
}

/** 句子上的押韵组引用：组 id + 这句里参与的格号 */
export interface RhymeGroupRef {
  id: string
  indexes: number[]
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
  /** 押韵组约束（项目级）：id → 约束 */
  rhymeGroups?: { id: string; constraint: RhymeConstraint }[]
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
