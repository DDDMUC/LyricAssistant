import { pronunciationsOf, rhymeKeyOfFinal } from "./rhyme"
import type { Project, RhymeConstraint, Sentence } from "./types"

export function createRhymeGroupId(): string {
  return `rg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 某个格子在哪个押韵组里（找不到返回 null） */
export function groupAt(
  project: Project,
  sentence: Sentence,
  index: number,
): { id: string; constraint: RhymeConstraint } | null {
  for (const ref of sentence.rhymeGroups ?? []) {
    if (!ref.indexes.includes(index)) continue
    const found = project.rhymeGroups?.find((item) => item.id === ref.id)
    if (found) return { id: ref.id, constraint: found.constraint }
  }
  return null
}

/** 建组：把若干格子归到一个新组（同一句的多个格合成一条 ref） */
export function addRhymeGroup(
  project: Project,
  cells: { sentenceId: string; index: number }[],
  constraint: RhymeConstraint,
): string | null {
  const bySentence = new Map<string, number[]>()
  for (const cell of cells) {
    const list = bySentence.get(cell.sentenceId) ?? []
    list.push(cell.index)
    bySentence.set(cell.sentenceId, list)
  }
  if (bySentence.size === 0) return null
  const id = createRhymeGroupId()
  project.rhymeGroups = [...(project.rhymeGroups ?? []), { id, constraint }]
  for (const [sentenceId, indexes] of bySentence) {
    const sentence = project.sections
      .flatMap((section) => section.sentences)
      .find((item) => item.id === sentenceId)
    if (!sentence) continue
    sentence.rhymeGroups = [
      ...(sentence.rhymeGroups ?? []),
      { id, indexes: [...new Set(indexes)].sort((a, b) => a - b) },
    ]
  }
  return id
}

/** 一键成组的维度 */
export type RhymeAspect = "rhy" | "final" | "initial" | "tone"

/** 一键成组：按勾选的维度把全曲有字的格子归组。
 *  - 只处理**不在任何韵组里**的格子；每个桶用自己的值建一条约束（发花辙一组、中东辙一组…）
 *  - 只出现一次的桶不建组（互相押才有意义）
 *  返回建了几组、覆盖几格。 */
export function autoGroupByRhyme(
  project: Project,
  aspects: RhymeAspect[],
): { groups: number; cells: number } {
  if (aspects.length === 0) return { groups: 0, cells: 0 }
  const buckets = new Map<string, { sentenceId: string; index: number }[]>()
  const bucketPron = new Map<string, { final: string; initial: string; tone: number }>()
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      const cells = sentence.alternatives[sentence.activeAlt]?.cells ?? []
      for (let index = 0; index < cells.length; index++) {
        const char = cells[index]
        if (!char || !char.trim()) continue
        if (sentence.rhymeGroups?.some((ref) => ref.indexes.includes(index))) continue
        const pron = pronunciationsOf(char)[0]
        if (!pron) continue
        const rhyKey = rhymeKeyOfFinal(pron.final)
        if (aspects.includes("rhy") && !rhyKey) continue
        const key = aspects
          .map((aspect) => {
            if (aspect === "rhy") return rhyKey ?? ""
            if (aspect === "final") return pron.final
            if (aspect === "initial") return pron.initial
            return String(pron.tone)
          })
          .join("\u0001")
        const list = buckets.get(key) ?? []
        list.push({ sentenceId: sentence.id, index })
        buckets.set(key, list)
        if (!bucketPron.has(key)) bucketPron.set(key, pron)
      }
    }
  }
  let groups = 0
  let cells = 0
  for (const [key, list] of buckets) {
    if (list.length < 2) continue
    const pron = bucketPron.get(key)!
    const constraint: RhymeConstraint = {}
    if (aspects.includes("rhy")) constraint.rhy = rhymeKeyOfFinal(pron.final)
    if (aspects.includes("final")) constraint.final = pron.final
    if (aspects.includes("initial")) constraint.initial = pron.initial
    if (aspects.includes("tone")) constraint.tones = [pron.tone]
    addRhymeGroup(project, list, constraint)
    groups += 1
    cells += list.length
  }
  return { groups, cells }
}

/** 改一个已有韵组的约束（成员一个不动） */
export function updateRhymeGroupConstraint(
  project: Project,
  id: string,
  constraint: RhymeConstraint,
): boolean {
  const group = (project.rhymeGroups ?? []).find((item) => item.id === id)
  if (!group) return false
  group.constraint = constraint
  return true
}

/** 解散一个组：项目里的约束和所有句子上的引用一起清掉 */
export function dissolveRhymeGroup(project: Project, id: string): void {
  const rest = (project.rhymeGroups ?? []).filter((item) => item.id !== id)
  if (rest.length > 0) project.rhymeGroups = rest
  else delete project.rhymeGroups
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      if (!sentence.rhymeGroups) continue
      sentence.rhymeGroups = sentence.rhymeGroups.filter((ref) => ref.id !== id)
      if (sentence.rhymeGroups.length === 0) delete sentence.rhymeGroups
    }
  }
}

/** 在 at 处插入 count 个格子：后面的引用整体右移 */
export function shiftCellRefs(sentence: Sentence, at: number, count: number): void {
  if (count === 0) return
  if (sentence.cellLocks) {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(sentence.cellLocks)) {
      const index = Number(key)
      next[String(index >= at ? index + count : index)] = value
    }
    sentence.cellLocks = next
  }
  for (const ref of sentence.rhymeGroups ?? []) {
    ref.indexes = ref.indexes.map((index) => (index >= at ? index + count : index))
  }
}

/** 从 at 处删掉 count 个格子：区间内的引用丢掉，后面的左移 */
export function dropCellRefs(sentence: Sentence, at: number, count: number): void {
  if (count <= 0) return
  if (sentence.cellLocks) {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(sentence.cellLocks)) {
      const index = Number(key)
      if (index >= at && index < at + count) continue
      next[String(index >= at + count ? index - count : index)] = value
    }
    sentence.cellLocks = next
  }
  for (const ref of sentence.rhymeGroups ?? []) {
    ref.indexes = ref.indexes
      .filter((index) => !(index >= at && index < at + count))
      .map((index) => (index >= at + count ? index - count : index))
  }
}

/** 替换：删掉 [at, at+removed) 再插入 inserted 个格子（查找替换用） */
export function replaceCellRefs(sentence: Sentence, at: number, removed: number, inserted: number): void {
  if (removed > 0) dropCellRefs(sentence, at, removed)
  if (inserted > 0) shiftCellRefs(sentence, at, inserted)
}
