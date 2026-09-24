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
  rhymeLock?: string
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
