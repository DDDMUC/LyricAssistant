import { resizeToPattern } from "./grid"
import { contentChars } from "./pattern"

export interface ParsedLine {
  pattern: number[]
  cells: string[]
  alts: string[][]
  note: string
}

export interface ParsedSection {
  name: string
  lines: ParsedLine[]
}

export interface ParsedLyrics {
  title: string
  sections: ParsedSection[]
}

const NOTE_RE = /[（(]\s*([^（）()]*?)\s*[)）]\s*$/
const TITLE_RE = /^《\s*(.+?)\s*》$/
const PURE_PATTERN_RE = /^\d+(\s*[/,，、+\-\s]\s*\d+)*$/
const ALT_SEP = /\s*[|｜]\s*/

function splitLine(line: string): { pattern: number[]; cells: string[] } | null {
  const pattern: number[] = []
  const cells: string[] = []
  for (const token of line.trim().split(/\s+/)) {
    if (!token) continue
    const chars = contentChars(token)
    if (chars.length === 0) continue
    pattern.push(chars.length)
    cells.push(...chars)
  }
  return pattern.length > 0 ? { pattern, cells } : null
}

function parseContentLine(line: string): ParsedLine | null {
  let note = ""
  const noteMatch = line.match(NOTE_RE)
  if (noteMatch) {
    note = noteMatch[1].trim()
    line = line.slice(0, noteMatch.index).trim()
  }
  if (!line) return null

  if (PURE_PATTERN_RE.test(line)) {
    const pattern = line
      .split(/\D+/)
      .map(Number)
      .filter((n) => n > 0)
    if (pattern.length === 0) return null
    const total = pattern.reduce((a, b) => a + b, 0)
    return { pattern, cells: new Array<string>(total).fill(""), alts: [], note }
  }

  const [primaryPart, ...altParts] = line.split(ALT_SEP)
  const primary = splitLine(primaryPart ?? "")
  if (!primary) return null
  const alts = altParts
    .map(splitLine)
    .filter((part): part is { pattern: number[]; cells: string[] } => part !== null)
    .map((part) => resizeToPattern(primary.pattern, part.cells))
  return { pattern: primary.pattern, cells: primary.cells, alts, note }
}

export function parseLyrics(text: string): ParsedLyrics {
  const result: ParsedLyrics = { title: "", sections: [] }
  let current: ParsedSection | null = null
  let first = true

  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) {
      current = null
      continue
    }

    const bracket = line.match(/^[\[【]([^\]】]*)[\]】]\s*$/)
    if (bracket) {
      const inner = bracket[1].trim()
      if (!inner || /[::]/.test(inner)) continue
      current = { name: inner.slice(0, 24), lines: [] }
      result.sections.push(current)
      continue
    }

    line = line.replace(/^(\[[^\]]*\]\s*)+/, "").trim()
    if (!line) continue
    if (/^(#|\/\/)/.test(line)) continue

    if (first) {
      first = false
      const titleMatch = line.match(TITLE_RE)
      if (titleMatch) {
        result.title = titleMatch[1]
        continue
      }
    }

    if (!current) {
      current = { name: "", lines: [] }
      result.sections.push(current)
    }

    const parsed = parseContentLine(line)
    if (parsed) current.lines.push(parsed)
  }

  result.sections = result.sections.filter((section) => section.lines.length > 0)
  return result
}
