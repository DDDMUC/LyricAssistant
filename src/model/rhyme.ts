import { pinyin } from "pinyin-pro"
import { COMMON_HAN_ORDER } from "./common-han"
import type { RhymeConstraint } from "./types"

export interface RhymeInfo {
  char: string
  final: string
  key: string
  label: string
}

interface RhymeGroup {
  key: string
  label: string
  finals: string[]
}

const RHYME_GROUPS: RhymeGroup[] = [
  { key: "fahua", label: "发花辙", finals: ["a", "ia", "ua"] },
  { key: "suobo", label: "梭波辙", finals: ["o", "e", "uo"] },
  { key: "miexie", label: "乜斜辙", finals: ["ie", "ue", "ve"] },
  { key: "yiqi", label: "一七辙", finals: ["i", "v", "er"] },
  { key: "gusu", label: "姑苏辙", finals: ["u"] },
  { key: "huailai", label: "怀来辙", finals: ["ai", "uai"] },
  { key: "huidui", label: "灰堆辙", finals: ["ei", "ui"] },
  { key: "yaotiao", label: "遥条辙", finals: ["ao", "iao"] },
  { key: "youqiu", label: "由求辙", finals: ["ou", "iu"] },
  { key: "yanqian", label: "言前辙", finals: ["an", "ian", "uan", "van"] },
  { key: "renchen", label: "人辰辙", finals: ["en", "in", "un", "vn"] },
  { key: "jiangyang", label: "江阳辙", finals: ["ang", "iang", "uang"] },
  { key: "zhongdong", label: "中东辙", finals: ["eng", "ing", "ong", "iong", "ueng"] },
]

const FINAL_TO_GROUP = new Map<string, RhymeGroup>()
for (const group of RHYME_GROUPS) {
  for (const final of group.finals) FINAL_TO_GROUP.set(final, group)
}

const CJK = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]$/

function normalizeFinal(final: string): string {
  return final.toLowerCase().replace(/ü/g, "v").replace(/u:/g, "v")
}

const cache = new Map<string, RhymeInfo | null>()

export function rhymeOfChar(char: string): RhymeInfo | null {
  const cached = cache.get(char)
  if (cached !== undefined) return cached

  let info: RhymeInfo | null = null
  if (CJK.test(char)) {
    try {
      const full = String(pinyin(char, { toneType: "none" }))
      let final = normalizeFinal(String(pinyin(char, { pattern: "final", toneType: "none" })))
      if (full === "yu") final = "v"
      if (full === "ye") final = "ie"
      const group = FINAL_TO_GROUP.get(final)
      if (group) info = { char, final, key: group.key, label: group.label }
    } catch {
      info = null
    }
  }

  cache.set(char, info)
  return info
}

const PINYIN_INITIALS = [
  "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l",
  "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w",
]

/** 拼音（输入法组字串）→ 辙。只认"整串刚好是一个音节"的情况；
 *  打一半（zh）、多音节（nihao）返回 null。 */
export function rhymeOfPinyin(pinyin: string): { final: string; key: string; label: string } | null {
  const raw = pinyin
    .toLowerCase()
    .replace(/ü/g, "v")
    .replace(/[^a-z]/g, "")
  if (!raw) return null
  let initial = ""
  for (const candidate of PINYIN_INITIALS) {
    if (raw.startsWith(candidate)) {
      initial = candidate
      break
    }
  }
  let final = raw.slice(initial.length)
  if (!final) return null
  // ü 的写法：j/q/x + u = ü；yu… = ü…
  if ((initial === "j" || initial === "q" || initial === "x") && final === "u") final = "v"
  if (initial === "y" && (final === "u" || final.startsWith("u"))) final = `v${final.slice(1)}`
  if (initial === "y" && final === "e") final = "ie"
  const group = FINAL_TO_GROUP.get(final)
  return group ? { final, key: group.key, label: group.label } : null
}

export function cellLockAt(
  sentence: { cellLocks?: Record<string, string> },
  index: number,
): string {
  return sentence.cellLocks?.[String(index)] ?? ""
}

export function setCellLockAt(
  sentence: { cellLocks?: Record<string, string> },
  index: number,
  key: string,
): void {
  if (!sentence.cellLocks) sentence.cellLocks = {}
  if (key) sentence.cellLocks[String(index)] = key
  else delete sentence.cellLocks[String(index)]
}

export function isEndingFilled(cells: string[]): boolean {
  const last = cells[cells.length - 1]
  return typeof last === "string" && last.trim().length > 0
}

export function rhymeOfCells(cells: string[]): RhymeInfo | null {
  for (let i = cells.length - 1; i >= 0; i--) {
    const char = cells[i]
    if (!char) continue
    const info = rhymeOfChar(char)
    if (info) return info
  }
  return null
}

const INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
  "y",
  "w",
]

function finalOfReading(reading: string): string {
  let final: string
  if (INITIALS.includes(reading.slice(0, 2))) {
    final = reading.slice(2)
  } else if (INITIALS.includes(reading.slice(0, 1))) {
    final = reading.slice(1)
  } else {
    final = reading
  }
  // qu/ju/xu/yu 后面的 ü 拼音写作 u，还原成 v 才是真韵母
  if (/^[jqxy]/.test(reading) && /^u/.test(final)) {
    final = `v${final.slice(1)}`
  }
  return final
}

const readingsCache = new Map<string, string[]>()

export function readingsOf(char: string): string[] {
  const cached = readingsCache.get(char)
  if (cached !== undefined) return cached

  let finals: string[] = []
  if (CJK.test(char)) {
    try {
      const raw = String(pinyin(char, { toneType: "none", multiple: true }))
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const set = new Set<string>()
      for (const reading of raw) {
        let final = normalizeFinal(finalOfReading(reading))
        if (reading === "yu") final = "v"
        if (reading === "ye") final = "ie"
        set.add(final)
      }
      finals = [...set]
    } catch {
      finals = []
    }
  }

  readingsCache.set(char, finals)
  return finals
}

export function charFitsRhyme(char: string, key: string): boolean {
  if (!key) return true
  const group = RHYME_GROUPS.find((item) => item.key === key)
  if (!group) return true
  const finals = readingsOf(char)
  if (finals.length === 0) return false
  const known = finals.some((final) => FINAL_TO_GROUP.has(final))
  if (!known) return true
  return finals.some((final) => group.finals.includes(final))
}

export interface Pronunciation {
  /** 声母（y/w 照常算声母；零声母 = ""） */
  initial: string
  /** 韵母（规范化：ü→v、iu/ui/un、y/w 还原） */
  final: string
  /** 1-4，0 = 轻声 */
  tone: number
}

/** y/w 开头要还原成规范韵母（y 表和 w 表不一样：yu=v，但 wu=u） */
const Y_FINALS: Record<string, string> = {
  i: "i", ia: "ia", ie: "ie", iao: "iao", iou: "iu", ian: "ian", in: "in",
  iang: "iang", ing: "ing", iong: "iong",
  u: "v", ue: "ve", uan: "van", un: "vn",
}
const W_FINALS: Record<string, string> = {
  u: "u", a: "ua", o: "uo", ai: "uai", ei: "ui", an: "uan", en: "un",
  ang: "uang", eng: "ueng",
}

function parseReading(reading: string): Pronunciation | null {
  const match = reading.match(/^([a-zü]+)([0-5])$/)
  if (!match) return null
  const tone = Number(match[2])
  const raw = match[1].replace(/ü/g, "v")
  let initial = ""
  for (const candidate of PINYIN_INITIALS) {
    if (raw.startsWith(candidate)) {
      initial = candidate
      break
    }
  }
  let final = raw.slice(initial.length)
  if (!final) return null
  if (initial === "y") {
    final = Y_FINALS[final] ?? final
  } else if (initial === "w") {
    final = W_FINALS[final] ?? final
  } else if ((initial === "j" || initial === "q" || initial === "x") && final === "u") {
    final = "v"
  }
  return { initial, final, tone }
}

const pronunciationCache = new Map<string, Pronunciation[]>()

/** 一个字的所有读音（声母/韵母/声调；多音字全给） */
export function pronunciationsOf(char: string): Pronunciation[] {
  const cached = pronunciationCache.get(char)
  if (cached !== undefined) return cached
  let list: Pronunciation[] = []
  if (CJK.test(char)) {
    try {
      const raw = String(pinyin(char, { toneType: "num", multiple: true }))
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      const seen = new Set<string>()
      for (const reading of raw) {
        const parsed = parseReading(reading)
        if (!parsed) continue
        const key = `${parsed.initial}|${parsed.final}|${parsed.tone}`
        if (seen.has(key)) continue
        seen.add(key)
        list.push(parsed)
      }
    } catch {
      list = []
    }
  }
  pronunciationCache.set(char, list)
  return list
}

/** 一个字是否符合押韵组约束：**同一条读音**要同时满足所有勾选项 */
export function charFitsConstraint(char: string, constraint: RhymeConstraint): boolean {
  const list = pronunciationsOf(char)
  if (list.length === 0) return true // 不认识的字符放行（跟 charFitsRhyme 一个策略）
  const hasAny = constraint.rhy !== undefined || constraint.final !== undefined || constraint.initial !== undefined || (constraint.tones?.length ?? 0) > 0
  if (!hasAny) return true
  return list.some((pron) => {
    if (constraint.rhy !== undefined && FINAL_TO_GROUP.get(pron.final)?.key !== constraint.rhy) return false
    if (constraint.final !== undefined && pron.final !== constraint.final) return false
    if (constraint.initial !== undefined && pron.initial !== constraint.initial) return false
    if ((constraint.tones?.length ?? 0) > 0 && !constraint.tones!.includes(pron.tone)) return false
    return true
  })
}

/** 约束的中文描述（徽章/tooltip/状态栏用） */
export function constraintText(constraint: RhymeConstraint): string {
  const parts: string[] = []
  if (constraint.rhy !== undefined) {
    parts.push(`${RHYME_LABEL_BY_KEY.get(constraint.rhy) ?? constraint.rhy}辙`)
  }
  if (constraint.final !== undefined) parts.push(`韵母 ${constraint.final}`)
  if (constraint.initial !== undefined) parts.push(`声母 ${constraint.initial || "零"}`)
  if ((constraint.tones?.length ?? 0) > 0) {
    parts.push(`声调 ${[...constraint.tones!].sort().map((tone) => (tone === 0 ? "轻" : tone)).join("/")}`)
  }
  return parts.join(" · ") || "（没勾任何条件）"
}

let cjkCharsCache: string[] | null = null
function allCjkChars(): string[] {
  if (!cjkCharsCache) {
    const list: string[] = []
    for (let code = 0x4e00; code <= 0x9fff; code++) list.push(String.fromCharCode(code))
    cjkCharsCache = list
  }
  return cjkCharsCache
}

let commonRankCache: Map<string, number> | null = null
function commonRank(char: string): number {
  if (!commonRankCache) {
    commonRankCache = new Map()
    for (let i = 0; i < COMMON_HAN_ORDER.length; i++) {
      const ch = COMMON_HAN_ORDER[i]
      if (!commonRankCache.has(ch)) commonRankCache.set(ch, i)
    }
  }
  return commonRankCache.get(char) ?? Number.MAX_SAFE_INTEGER
}

const candidateCache = new Map<string, string[]>()

/** 满足约束的所有汉字，常用字（GB2312 一级）排前面；首次约 100ms，之后有缓存 */
export function candidateChars(constraint: RhymeConstraint, limit = 240): string[] {
  const key = JSON.stringify([constraint.rhy ?? null, constraint.final ?? null, constraint.initial ?? null, constraint.tones ?? null])
  const cached = candidateCache.get(key)
  if (cached) return cached.slice(0, limit)
  if (candidateCache.size > 40) candidateCache.clear()
  const hits: string[] = []
  for (const char of allCjkChars()) {
    if (charFitsConstraint(char, constraint)) hits.push(char)
  }
  hits.sort(
    (a, b) =>
      commonRank(a) - commonRank(b) || (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0),
  )
  candidateCache.set(key, hits)
  return hits.slice(0, limit)
}

export function isHanChar(char: string): boolean {
  return CJK.test(char)
}

/** 只留汉字：标点、符号、英文、数字一律丢掉（所有写入格子的入口都该先过这里） */
export function hanOnly(text: string): string {
  return [...text].filter((char) => isHanChar(char)).join("")
}

export function rhymeHue(key: string): number {
  const index = RHYME_GROUPS.findIndex((group) => group.key === key)
  if (index < 0) return 210
  return Math.round((index * 360) / RHYME_GROUPS.length)
}

export function rhymeFinals(key: string): string[] {
  return RHYME_GROUPS.find((group) => group.key === key)?.finals ?? []
}

export function rhymeLabels(): string[] {
  return RHYME_GROUPS.map((group) => group.label)
}

export const RHYME_LABEL_BY_KEY: ReadonlyMap<string, string> = new Map(
  RHYME_GROUPS.map((group) => [group.key, group.label.replace(/辙$/, "")]),
)
