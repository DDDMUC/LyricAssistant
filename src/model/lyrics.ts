import { resizeToPattern } from "./grid"
import { contentChars } from "./pattern"
import { isHanChar } from "./rhyme"

export interface ParsedLine {
  pattern: number[]
  cells: string[]
  alts: string[][]
  note: string
  harmony?: boolean
}

export interface ParsedSection {
  name: string
  lines: ParsedLine[]
}

export interface ParsedLyrics {
  title: string
  sections: ParsedSection[]
  credits: string[]
}

const NOTE_RE = /[（(]\s*([^（）()]*?)\s*[)）]\s*$/
const FULL_PAREN_RE = /^[（(]\s*(.+?)\s*[)）]$/
const TITLE_RE = /^《\s*(.+?)\s*》$/
const PURE_PATTERN_RE = /^\d+(\s*[/,，、+\-\s]\s*\d+)*$/
const ALT_SEP = /\s*[|｜※]\s*/
const GROUP_SPLIT_RE = /[\s，。、；：？！]+/u
const PLACEHOLDER_RE = /^[XxＸｘ×✕✖]+$/
const PLACEHOLDER_CHAR_RE = /^[XxＸｘ×✕✖]$/
const LINES_PER_SECTION = 4

const SECTION_WORDS = new Set([
  "prechorus",
  "verse",
  "chorus",
  "bridge",
  "intro",
  "outro",
  "hook",
  "refrain",
  "rap",
  "drop",
  "tag",
  "主歌",
  "副歌",
  "预副歌",
  "导歌",
  "桥段",
  "前奏",
  "间奏",
  "尾奏",
  "说唱",
  "独白",
  "和声",
])

const CREDIT_WORDS = [
  "作词",
  "填词",
  "作曲",
  "编曲",
  "制作",
  "监制",
  "混音",
  "母带",
  "录音",
  "配唱",
  "和声",
  "和音",
  "吉他",
  "贝斯",
  "键盘",
  "弦乐",
  "原唱",
  "翻唱",
  "后期",
  "音效",
  "统筹",
  "企划",
  "策划",
  "发行",
  "出品",
  "封面",
  "海报",
  "曲绘",
  "动画",
  "视频",
  "分镜",
  "字幕",
  "调教",
  "调校",
  "修音",
  "鸣谢",
  "演奏",
  "演唱",
  "乐器",
  "二胡",
  "古琴",
  "琵琶",
  "竹笛",
  "笛子",
  "箫",
  "古筝",
  "马头琴",
  "唢呐",
  "笙",
  "阮",
  "埙",
  "竖琴",
  "小提琴",
  "大提琴",
  "中提琴",
  "长笛",
  "口琴",
  "手风琴",
  "钢琴",
  "合成器",
  "打击乐",
  "伴唱",
  "人声",
  "念白",
  "监唱",
  "导唱",
  "协力",
  "合作",
  "协助",
  "顾问",
  "合唱",
  "合声编写",
  "联合监制",
  "特别鸣谢",
  "录音棚",
  "混音棚",
]

const CREDIT_WORDS_EN = [
  "lyricist",
  "lyrics",
  "composer",
  "arranger",
  "arrangement",
  "producer",
  "mixing",
  "mastering",
  "vocal",
  "vocals",
  "harmony",
  "guitar",
  "bass",
  "drums",
  "strings",
  "piano",
  "keyboard",
  "recording",
  "recorded",
  "mix",
  "master",
  "pv",
  "op",
  "sp",
]

function isCreditLabel(label: string): boolean {
  const trimmed = label.trim()
  if (!trimmed || trimmed.length > 12) return false
  if (/[\u4e00-\u9fff]/.test(trimmed)) {
    return CREDIT_WORDS.some((word) => trimmed.includes(word))
  }
  const lower = trimmed.toLowerCase()
  return CREDIT_WORDS_EN.some((word) => lower.includes(word))
}

function nextCreditStart(value: string): number {
  let best = -1
  for (const word of [...CREDIT_WORDS, ...CREDIT_WORDS_EN]) {
    const pattern = new RegExp(`${word}\\s*[:：]`, /^[a-z]/.test(word) ? "i" : "")
    const match = pattern.exec(value)
    if (match && match.index > 0 && (best < 0 || match.index < best)) {
      best = match.index
    }
  }
  return best
}

function extractCredits(line: string): string[] | null {
  const entries: string[] = []
  let rest = line.trim()
  while (rest) {
    const match = rest.match(/^([^:：]{1,12})\s*[:：]\s*(.+)$/)
    if (!match) return null
    const label = match[1].trim()
    if (!isCreditLabel(label)) return null
    const value = match[2]
    const cut = nextCreditStart(value)
    const entryValue = (cut > 0 ? value.slice(0, cut) : value).trim()
    if (!entryValue) return null
    entries.push(`${label}：${entryValue}`)
    rest = cut > 0 ? value.slice(cut).trim() : ""
  }
  return entries.length > 0 ? entries : null
}

function nextMeaningful(lines: string[], from: number): string | null {
  for (let index = from + 1; index < lines.length; index++) {
    const value = lines[index].trim()
    if (value) return value
  }
  return null
}

const LABEL_COLON_RE = /^([^:：]{1,12})[:：]\s*(.+)$/

function isBareTitleLine(line: string): boolean {
  if (line.length < 2 || line.length > 24) return false
  if (/\s/.test(line)) return false
  if (PURE_PATTERN_RE.test(line)) return false
  if (PLACEHOLDER_RE.test(line)) return false
  if (TITLE_RE.test(line)) return false
  const labeled = line.match(LABEL_COLON_RE)
  if (labeled) return labeled[1].includes("名")
  return true
}

function labelTitleOf(line: string): string | null {
  const labeled = line.match(LABEL_COLON_RE)
  if (!labeled || !labeled[1].includes("名")) return null
  const value = labeled[2].trim()
  return value || null
}

function sectionNameOf(line: string): string | null {
  let name = line
    .trim()
    .replace(/^[\[【(（#＃]+\s*/, "")
    .replace(/\s*[\]】)）]+\s*$/, "")
    .replace(/[:：]\s*$/, "")
    .trim()
  if (!name || name.length > 24) return null
  const normalized = name
    .toLowerCase()
    .replace(/[\s\-—－]+/g, "")
    .replace(/\d+$/, "")
  return SECTION_WORDS.has(normalized) ? name : null
}

function chunkLines(lines: ParsedLine[]): ParsedSection[] {
  const groups: ParsedLine[][] = []
  let group: ParsedLine[] = []
  let mains = 0
  for (const line of lines) {
    if (!line.harmony && mains >= LINES_PER_SECTION) {
      groups.push(group)
      group = []
      mains = 0
    }
    group.push(line)
    if (!line.harmony) mains += 1
  }
  if (group.length) groups.push(group)
  if (groups.length > 1) {
    const last = groups[groups.length - 1]
    if (last.filter((line) => !line.harmony).length === 1) {
      groups.pop()
      groups[groups.length - 1].push(...last)
    }
  }
  return groups.map((group) => ({ name: "", lines: group }))
}

function splitLine(line: string): { pattern: number[]; cells: string[] } | null {
  const pattern: number[] = []
  const cells: string[] = []
  for (const token of line.trim().split(GROUP_SPLIT_RE)) {
    if (!token) continue
    if (PLACEHOLDER_RE.test(token)) {
      const size = [...token].length
      pattern.push(size)
      cells.push(...new Array<string>(size).fill(""))
      continue
    }
    const chars: string[] = []
    for (const char of contentChars(token)) {
      if (PLACEHOLDER_CHAR_RE.test(char)) chars.push("")
      else if (isHanChar(char)) chars.push(char)
      // 汉字以外（英文、拼音、数字……）一律跳过，不占格
    }
    if (chars.length === 0) continue
    pattern.push(chars.length)
    cells.push(...chars)
  }
  return pattern.length > 0 ? { pattern, cells } : null
}

function parseLineContent(
  text: string,
): { pattern: number[]; cells: string[]; alts: string[][] } | null {
  if (PURE_PATTERN_RE.test(text)) {
    const pattern = text
      .split(/\D+/)
      .map(Number)
      .filter((n) => n > 0)
    if (pattern.length === 0) return null
    const total = pattern.reduce((a, b) => a + b, 0)
    return { pattern, cells: new Array<string>(total).fill(""), alts: [] }
  }

  const [primaryPart, ...altParts] = text.split(ALT_SEP)
  const primary = splitLine(primaryPart ?? "")
  if (!primary) return null
  const alts = altParts
    .map(splitLine)
    .filter((part): part is { pattern: number[]; cells: string[] } => part !== null)
    .map((part) => resizeToPattern(primary.pattern, part.cells))
  return { pattern: primary.pattern, cells: primary.cells, alts }
}

function parseContentLine(line: string): ParsedLine | null {
  const full = line.match(FULL_PAREN_RE)
  if (full) {
    const inner = full[1].trim()
    const content = inner ? parseLineContent(inner) : null
    if (content) return { ...content, note: "", harmony: true }
  }

  let note = ""
  const noteMatch = line.match(NOTE_RE)
  if (noteMatch) {
    note = noteMatch[1].trim()
    line = line.slice(0, noteMatch.index).trim()
  }
  if (!line) return null

  const content = parseLineContent(line)
  return content ? { ...content, note } : null
}

export function parseLyrics(text: string): ParsedLyrics {
  const result: ParsedLyrics = { title: "", sections: [], credits: [] }
  let current: ParsedSection | null = null
  let first = true
  let hadHeader = false
  let hasContent = false
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/)

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    let line = rawLines[lineIndex].trim()
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
      hadHeader = true
      continue
    }

    line = line.replace(/^(\[[^\]]*\]\s*)+/, "").trim()
    if (!line) continue

    const creditEntries = extractCredits(line)
    if (creditEntries) {
      result.credits.push(...creditEntries)
      continue
    }

    const sectionName = sectionNameOf(line)
    if (sectionName) {
      current = { name: sectionName, lines: [] }
      result.sections.push(current)
      hadHeader = true
      continue
    }

    if (/^(#|\/\/)/.test(line)) continue

    const labeledTitle = labelTitleOf(line)
    if (labeledTitle && result.title === "" && !hasContent) {
      result.title = labeledTitle
      continue
    }

    if (result.title === "" && !hasContent) {
      const next = nextMeaningful(rawLines, lineIndex)
      if (next && extractCredits(next) !== null && isBareTitleLine(line)) {
        result.title = line
        continue
      }
    }

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
    if (parsed) {
      current.lines.push(parsed)
      hasContent = true
    }
  }

  result.sections = result.sections.filter((section) => section.lines.length > 0)
  if (!hadHeader && result.sections.length <= 1 && result.sections[0]) {
    result.sections = chunkLines(result.sections[0].lines)
  }
  result.credits = [...new Set(result.credits)]
  return result
}
