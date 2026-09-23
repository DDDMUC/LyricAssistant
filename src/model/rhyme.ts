import { pinyin } from "pinyin-pro"

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

export function rhymeHue(key: string): number {
  const index = RHYME_GROUPS.findIndex((group) => group.key === key)
  if (index < 0) return 210
  return Math.round((index * 360) / RHYME_GROUPS.length)
}

export function rhymeLabels(): string[] {
  return RHYME_GROUPS.map((group) => group.label)
}
