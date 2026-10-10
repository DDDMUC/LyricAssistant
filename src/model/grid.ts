import { totalCells } from "./pattern"

export function cellsFromPattern(pattern: number[]): string[] {
  return Array.from({ length: totalCells(pattern) }, () => "")
}

export function locate(pattern: number[], flat: number): { g: number; o: number } {
  if (flat < 0 || flat >= totalCells(pattern)) {
    throw new Error(`格子下标越界: ${flat}`)
  }
  let acc = 0
  for (let g = 0; g < pattern.length; g++) {
    if (flat < acc + pattern[g]) {
      return { g, o: flat - acc }
    }
    acc += pattern[g]
  }
  throw new Error(`格子下标越界: ${flat}`)
}

export function flatIndex(pattern: number[], g: number, o: number): number {
  let acc = 0
  for (let i = 0; i < g; i++) {
    acc += pattern[i]
  }
  return acc + o
}

export function writeChars(
  cells: string[],
  start: number,
  text: string,
): { cells: string[]; written: number } {
  const next = cells.slice()
  let written = 0
  for (const ch of text) {
    const idx = start + written
    if (idx < 0 || idx >= next.length) break
    next[idx] = ch
    written++
  }
  return { cells: next, written }
}

export function clearCell(cells: string[], index: number): string[] {
  if (index < 0 || index >= cells.length) return cells.slice()
  const next = cells.slice()
  next[index] = ""
  return next
}

export function shiftSentence(cells: string[], dir: -1 | 1): string[] | null {
  const n = cells.length
  if (n === 0) return null
  if (dir === -1) {
    if (cells[0] !== "") return null
    const next = cells.slice()
    for (let i = 0; i < n - 1; i++) next[i] = cells[i + 1]
    next[n - 1] = ""
    return next
  }
  if (cells[n - 1] !== "") return null
  const next = cells.slice()
  for (let i = n - 1; i > 0; i--) next[i] = cells[i - 1]
  next[0] = ""
  return next
}

export function addCellAt(
  pattern: number[],
  cells: string[],
  flat: number,
): { pattern: number[]; cells: string[]; cursor: number } {
  const total = totalCells(pattern)
  if (flat < 0 || flat > total) {
    throw new Error(`插入位置越界: ${flat}`)
  }
  // 加在「光标这一格」的右边（空格子插到光标字右侧，那个字及之后的字不动）
  const insertAt = Math.min(flat + 1, total)
  const { g } = locate(pattern, Math.min(flat, total - 1))
  const nextPattern = pattern.slice()
  nextPattern[g] += 1
  const nextCells = cells.slice()
  nextCells.splice(insertAt, 0, "")
  return { pattern: nextPattern, cells: nextCells, cursor: insertAt }
}

export function removeCellAt(
  pattern: number[],
  cells: string[],
  flat: number,
): { pattern: number[]; cells: string[]; cursor: number } | null {
  const total = totalCells(pattern)
  if (flat < 0 || flat >= total) return null
  const { g } = locate(pattern, flat)
  const nextPattern = pattern.slice()
  if (pattern[g] > 1) {
    nextPattern[g] -= 1
  } else if (pattern.length > 1) {
    nextPattern.splice(g, 1)
  } else {
    return null
  }
  // 删掉「光标这一格」本身，后面的字整体左移补齐（词格少一格，字也少一个）
  const nextTotal = totalCells(nextPattern)
  const nextCells = cells.slice()
  nextCells.splice(flat, 1)
  while (nextCells.length < nextTotal) nextCells.push("")
  nextCells.length = nextTotal
  return {
    pattern: nextPattern,
    cells: nextCells,
    cursor: Math.min(flat, nextTotal - 1),
  }
}

/** 在 flat 处插入 count 个空格子（后面的格子右移）；新格子加入插入点前一个格子所在的分组 */
export function insertCells(
  pattern: number[],
  cells: string[],
  flat: number,
  count: number,
): { pattern: number[]; cells: string[] } {
  const total = totalCells(pattern)
  const at = Math.min(Math.max(0, flat), total)
  const nextPattern = pattern.slice()
  const anchor = Math.max(0, Math.min(at - 1, total - 1))
  const { g } = locate(nextPattern, anchor)
  nextPattern[g] += count
  const nextCells = cells.slice()
  for (let i = 0; i < count; i++) nextCells.splice(at, 0, "")
  return { pattern: nextPattern, cells: nextCells }
}

/** 删除从 flat 开始的 count 个格子（后面的格子左移）；分组依次减 1，减到 0 的分组消失。
    不允许把整句删空——会删空时返回 null（调用方自行决定兜底） */
export function removeCellsAt(
  pattern: number[],
  cells: string[],
  flat: number,
  count: number,
): { pattern: number[]; cells: string[] } | null {
  const total = totalCells(pattern)
  if (total === 0) return null
  const start = Math.max(0, Math.min(flat, total - 1))
  const removable = Math.min(count, total - start)
  if (removable <= 0) return { pattern: pattern.slice(), cells: cells.slice() }
  const nextPattern = pattern.slice()
  const nextCells = cells.slice()
  for (let i = 0; i < removable; i++) {
    if (totalCells(nextPattern) === 0) return null
    const { g } = locate(nextPattern, start)
    if (nextPattern[g] > 1) {
      nextPattern[g] -= 1
    } else if (nextPattern.length > 1) {
      nextPattern.splice(g, 1)
    } else {
      return null
    }
    nextCells.splice(start, 1)
  }
  return { pattern: nextPattern, cells: nextCells }
}

export function splitOrMergePattern(pattern: number[], flat: number): number[] | null {
  const total = totalCells(pattern)
  if (total === 0) return null
  const index = Math.min(Math.max(0, flat), total - 1)
  const { g, o } = locate(pattern, index)
  const next = pattern.slice()
  if (o > 0) {
    next.splice(g, 1, o, pattern[g] - o)
    return next
  }
  if (g > 0) {
    next.splice(g - 1, 2, pattern[g - 1] + pattern[g])
    return next
  }
  return null
}

export function resizeToPattern(pattern: number[], cells: string[]): string[] {
  const size = totalCells(pattern)
  const next = cells.slice(0, size)
  while (next.length < size) next.push("")
  return next
}
