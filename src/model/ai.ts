import { addAlternative, allSentences, getCells, setCells } from "../state"
import { totalCells } from "./pattern"
import { RHYME_LABEL_BY_KEY, charFitsRhyme, isHanChar, rhymeFinals } from "./rhyme"
import type { Project } from "./types"

export interface AiSentenceResult {
  id: string
  text: string
}

export interface AiIssue {
  sentenceId: string
  label: string
  message: string
}

export interface AiValidation {
  ok: AiSentenceResult[]
  issues: AiIssue[]
}

export interface AiApplySummary {
  filled: number
  alternatives: number
}

export function buildSystemPrompt(): string {
  return [
    "你是中文歌词作者，按用户给的「词格」填词。",
    "硬性规则（必须全部满足）：",
    "1. 每句只输出汉字，字数必须和该句词格完全一致，不能多、不能少；不得出现标点、数字、字母、空格。",
    "2. 词格里的分组（如 4+4）是旋律停顿，句意要在停顿处自然断开。",
    "3. 标了「押 X 辙」的句子，最后一个字的韵母必须属于该辙（会给出韵母表）。",
    "4. 标了「和声」的句子是与上一句同时唱的背景人声，内容要和上一句呼应。",
    "5. 只输出 JSON，不要输出任何解释或多余文字。",
    '输出格式：{"sentences":[{"id":"句子id","text":"这一句的汉字"}]}',
    "只需要输出要求你写的句子。",
  ].join("\n")
}

export function buildChatSystemPrompt(): string {
  return [
    "你是「作词助手」里的 AI，陪用户聊写词、押韵、词格这些事，也能随便闲聊。",
    "用中文回答，简洁、自然、不啰嗦；用户没让写词就不要输出 JSON。",
  ].join("\n")
}

export function sentencePlace(
  project: Project,
  sentenceId: string,
): { section: string; sectionIndex: number; line: number } | null {
  for (let si = 0; si < project.sections.length; si++) {
    const section = project.sections[si]
    const index = section.sentences.findIndex((s) => s.id === sentenceId)
    if (index >= 0) {
      return {
        section: section.name || `段落 ${si + 1}`,
        sectionIndex: si,
        line: index + 1,
      }
    }
  }
  return null
}

function sentenceLabel(project: Project, sentenceId: string): string {
  const place = sentencePlace(project, sentenceId)
  return place ? `第 ${place.sectionIndex + 1} 段第 ${place.line} 句` : "未知句"
}

/** 从还在流式的 JSON 里，把已经写完的句子抓出来，好在气泡里逐行显示 */
export function previewAiResults(raw: string): AiSentenceResult[] {
  const results: AiSentenceResult[] = []
  const paired = /"id"\s*:\s*"([^"\\]*)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = paired.exec(raw)) !== null) {
    results.push({ id: match[1], text: unescapeJson(match[2]) })
  }
  if (results.length > 0) return results
  const textOnly = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  while ((match = textOnly.exec(raw)) !== null) {
    results.push({ id: "", text: unescapeJson(match[1]) })
  }
  return results
}

function unescapeJson(value: string): string {
  return value.replace(/\\(.)/g, "$1")
}

/** 按词格分组把一句拆开（UI 里分组之间要断开，跟格子里一样） */
export function splitByPattern(text: string, pattern: number[]): string[] {
  const chars = [...text]
  const groups: string[] = []
  let acc = 0
  for (const size of pattern) {
    groups.push(chars.slice(acc, acc + size).join(""))
    acc += size
  }
  if (acc < chars.length) groups.push(chars.slice(acc).join(""))
  return groups.filter((group) => group !== "")
}

export function buildBrief(
  project: Project,
  sentenceIds: string[] | null,
  userBrief: string,
): string {
  const targetSet = sentenceIds ? new Set(sentenceIds) : null
  const lines: string[] = []
  lines.push(`【写作要求】${userBrief.trim() || "（无特别要求，按词格写通顺的中文歌词）"}`)
  lines.push("")
  lines.push("【词格】")
  project.sections.forEach((section, si) => {
    lines.push(`— ${section.name || `段落 ${si + 1}`} —`)
    section.sentences.forEach((sentence) => {
      const total = totalCells(sentence.pattern)
      const want = !targetSet || targetSet.has(sentence.id)
      const parts: string[] = [`${sentence.id}｜${total} 字（${sentence.pattern.join("+")}）`]
      if (sentence.role === "harmony") parts.push("和声（与上一句同时唱）")
      if (sentence.rhymeLock) {
        const label = RHYME_LABEL_BY_KEY.get(sentence.rhymeLock) ?? sentence.rhymeLock
        parts.push(`押「${label.replace(/辙$/, "")}辙」（韵母 ${rhymeFinals(sentence.rhymeLock).join("/")}）`)
      }
      if (sentence.note) parts.push(`备注「${sentence.note}」`)
      const existing = getCells(sentence).join("")
      if (existing.trim()) parts.push(`已写「${existing}」`)
      parts.push(want ? "→ 要写" : "（不用写）")
      lines.push(`- ${parts.join("，")}`)
    })
  })
  lines.push("")
  lines.push('请只输出标了「→ 要写」的句子，格式：{"sentences":[{"id":"句子id","text":"汉字"}]}')
  return lines.join("\n")
}

function extractSentenceList(data: unknown): AiSentenceResult[] | null {
  let list: unknown[] | null = null
  if (Array.isArray(data)) list = data
  else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>
    for (const key of ["sentences", "lines", "result", "data"]) {
      if (Array.isArray(record[key])) {
        list = record[key] as unknown[]
        break
      }
    }
  }
  if (!list) return null
  const out: AiSentenceResult[] = []
  for (const item of list) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ id: "", text: item })
      continue
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      const text =
        typeof record.text === "string"
          ? record.text
          : typeof record.line === "string"
            ? record.line
            : ""
      const id = typeof record.id === "string" ? record.id : ""
      if (text.trim()) out.push({ id, text })
    }
  }
  return out.length > 0 ? out : null
}

export function parseAiSentences(raw: string): AiSentenceResult[] {
  const text = raw.trim()
  if (!text) return []
  const candidates: string[] = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1])
  candidates.push(text)
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const list = extractSentenceList(JSON.parse(candidate) as unknown)
      if (list) return list
    } catch {
      continue
    }
  }
  return []
}

export function validateAiResults(
  project: Project,
  results: AiSentenceResult[],
): AiValidation {
  const ok: AiSentenceResult[] = []
  const issues: AiIssue[] = []
  const sentences = allSentences(project)
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]))
  const used = new Set<string>()
  results.forEach((result, index) => {
    let sentence = result.id ? byId.get(result.id) : undefined
    if (!sentence) {
      const fallback = sentences[index]
      if (fallback && !used.has(fallback.id)) sentence = fallback
    }
    if (!sentence || used.has(sentence.id)) return
    used.add(sentence.id)
    const label = sentenceLabel(project, sentence.id)
    const chars = [...result.text]
    const total = totalCells(sentence.pattern)
    if (chars.length !== total) {
      issues.push({
        sentenceId: sentence.id,
        label,
        message: `需要 ${total} 字（${sentence.pattern.join("+")}），收到 ${chars.length} 字「${result.text}」`,
      })
      return
    }
    const bad = chars.find((char) => !isHanChar(char))
    if (bad) {
      issues.push({
        sentenceId: sentence.id,
        label,
        message: `「${bad}」不是汉字，只能写汉字`,
      })
      return
    }
    const lock = sentence.rhymeLock ?? ""
    if (lock && chars.length > 0 && !charFitsRhyme(chars[chars.length - 1], lock)) {
      const name = (RHYME_LABEL_BY_KEY.get(lock) ?? lock).replace(/辙$/, "")
      issues.push({
        sentenceId: sentence.id,
        label,
        message: `句尾「${chars[chars.length - 1]}」不押「${name}辙」，请换一个押韵的字`,
      })
      return
    }
    ok.push({ id: sentence.id, text: chars.join("") })
  })
  return { ok, issues }
}

export function buildFixPrompt(issues: AiIssue[], previous: AiSentenceResult[]): string {
  const byId = new Map(previous.map((result) => [result.id, result.text]))
  const lines = [
    "上一次的输出有问题，请修正后只重新输出这些句子（JSON 格式同上，只输出这些）：",
  ]
  for (const issue of issues) {
    const old = byId.get(issue.sentenceId)
    lines.push(`- ${issue.label}（id ${issue.sentenceId}）：${issue.message}${old ? `（上次：「${old}」）` : ""}`)
  }
  return lines.join("\n")
}

export function applyAiResults(project: Project, results: AiSentenceResult[]): AiApplySummary {
  const byId = new Map(allSentences(project).map((sentence) => [sentence.id, sentence]))
  let filled = 0
  let alternatives = 0
  for (const result of results) {
    const sentence = byId.get(result.id)
    if (!sentence) continue
    const chars = [...result.text]
    if (chars.length !== totalCells(sentence.pattern)) continue
    if (getCells(sentence).some((cell) => cell !== "")) {
      addAlternative(sentence, "AI")
      alternatives += 1
    }
    setCells(sentence, chars)
    sentence.overflow = ""
    filled += 1
  }
  return { filled, alternatives }
}
