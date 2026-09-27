import { insertCells, removeCellsAt, resizeToPattern } from "./grid"
import { hanOnly } from "./rhyme"
import type { Sentence } from "./types"

export interface SearchMatch {
  sentenceId: string
  /** 句内第几格起（0 基，按当前备选） */
  start: number
  /** 命中几格（= 查找词字数） */
  length: number
}

/** 在若干句子里找匹配：不跨句、不重叠；按每句当前备选的正文；查找词只取汉字 */
export function findMatches(sentences: Sentence[], query: string): SearchMatch[] {
  const q = hanOnly(query)
  if (!q) return []
  const matches: SearchMatch[] = []
  for (const sentence of sentences) {
    const text = sentenceText(sentence)
    let from = 0
    while (from + q.length <= text.length) {
      const at = text.indexOf(q, from)
      if (at < 0) break
      matches.push({ sentenceId: sentence.id, start: at, length: q.length })
      from = at + q.length
    }
  }
  return matches
}

export function sentenceText(sentence: Sentence): string {
  return activeCells(sentence).join("")
}

function activeCells(sentence: Sentence): string[] {
  return sentence.alternatives[sentence.activeAlt]?.cells ?? []
}

/** 词格变了：把当前备选换成新格子，其它备选按新长度对齐（多退少补空格） */
function applyPatternCells(sentence: Sentence, pattern: number[], cells: string[]): void {
  sentence.pattern = pattern
  sentence.alternatives.forEach((alt, index) => {
    alt.cells =
      index === sentence.activeAlt
        ? resizeToPattern(pattern, cells)
        : resizeToPattern(pattern, alt.cells)
  })
  const next = activeCells(sentence)
  if (next[next.length - 1]) sentence.rhymeHint = ""
}

/**
 * 替换句内第 start 格起、length 格长的命中（就地改句子的词格和字）。
 * 替换词更短 → 删掉命中段末尾多出的格子（后面的字左移）；
 * 更长 → 命中段末尾插空格子（后面的字右移）；留空 → 删掉命中段。
 * 会删空整句时退化为清空这些格子（保留词格）。
 * 替换词同样只收汉字（标点、符号会被丢掉，全无汉字时等同留空=删格）。
 */
export function replaceInSentence(
  sentence: Sentence,
  start: number,
  length: number,
  replacement: string,
): boolean {
  const cells = activeCells(sentence).slice()
  if (start < 0 || length <= 0 || start + length > cells.length) return false
  const chars = [...hanOnly(replacement)]
  if (chars.length === 0) {
    const removed = removeCellsAt(sentence.pattern, cells, start, length)
    if (!removed) {
      for (let i = start; i < start + length; i++) cells[i] = ""
      applyPatternCells(sentence, sentence.pattern.slice(), cells)
      return true
    }
    applyPatternCells(sentence, removed.pattern, removed.cells)
    return true
  }
  if (chars.length <= length) {
    for (let i = 0; i < length; i++) cells[start + i] = chars[i] ?? ""
    if (chars.length < length) {
      const removed = removeCellsAt(
        sentence.pattern,
        cells,
        start + chars.length,
        length - chars.length,
      )
      if (!removed) {
        applyPatternCells(sentence, sentence.pattern.slice(), cells)
        return true
      }
      applyPatternCells(sentence, removed.pattern, removed.cells)
      return true
    }
    applyPatternCells(sentence, sentence.pattern.slice(), cells)
    return true
  }
  for (let i = 0; i < length; i++) cells[start + i] = chars[i] ?? ""
  const insertCount = chars.length - length
  const inserted = insertCells(sentence.pattern, cells, start + length, insertCount)
  const merged = inserted.cells.slice()
  for (let i = 0; i < insertCount; i++) merged[start + length + i] = chars[length + i] ?? ""
  applyPatternCells(sentence, inserted.pattern, merged)
  return true
}
