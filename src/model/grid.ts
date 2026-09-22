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
  const insertAt = Math.min(flat, total)
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
  if (pattern[g] <= 1) return null
  const nextPattern = pattern.slice()
  nextPattern[g] -= 1
  const nextCells = cells.slice()
  nextCells.splice(flat, 1)
  const nextTotal = totalCells(nextPattern)
  return {
    pattern: nextPattern,
    cells: nextCells,
    cursor: Math.min(flat, nextTotal - 1),
  }
}

export function resizeToPattern(pattern: number[], cells: string[]): string[] {
  const size = totalCells(pattern)
  const next = cells.slice(0, size)
  while (next.length < size) next.push("")
  return next
}
