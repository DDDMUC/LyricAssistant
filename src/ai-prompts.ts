/** AI 提示词页：① 系统提示词 / ② 本次请求 / ③ 你说的话，各自一叠页。
 *
 *  第 1 页永远是软件内置（默认）页——① 是软件写死的系统提示词、② 是自动生成的本次请求、
 *  ③ 是输入框里那句——固定、只读、不能删；第 2 页起是用户自定义页，可新增 / 删除 / 编辑。
 *  只存自定义页和当前页号：内置页不落盘，跟着软件更新走。 */

export const AI_PROMPTS_KEY = "cige-grid-ai-prompts"

export interface PromptPages {
  /** 自定义页（第 1 页内置页不在这里） */
  custom: string[]
  /** 当前页号：0 = 内置页，1..custom.length = 自定义页 */
  active: number
}

export interface AiPromptPages {
  system: PromptPages
  brief: PromptPages
  user: PromptPages
}

function emptyPages(): PromptPages {
  return { custom: [], active: 0 }
}

function normalizePages(raw: unknown): PromptPages {
  if (!raw || typeof raw !== "object") return emptyPages()
  const value = raw as { custom?: unknown; active?: unknown }
  const custom = Array.isArray(value.custom)
    ? value.custom.filter((page): page is string => typeof page === "string")
    : []
  const active =
    typeof value.active === "number" && Number.isFinite(value.active)
      ? Math.min(Math.max(Math.trunc(value.active), 0), custom.length)
      : 0
  return { custom, active }
}

export function loadPromptPages(): AiPromptPages {
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(AI_PROMPTS_KEY) ?? "null")
  } catch {
    raw = null
  }
  const data = (raw ?? {}) as Partial<Record<keyof AiPromptPages, unknown>>
  return {
    system: normalizePages(data.system),
    brief: normalizePages(data.brief),
    user: normalizePages(data.user),
  }
}

export function savePromptPages(pages: AiPromptPages): void {
  localStorage.setItem(
    AI_PROMPTS_KEY,
    JSON.stringify({ system: pages.system, brief: pages.brief, user: pages.user }),
  )
}

/** 一共几页（含内置页） */
export function pageCount(pages: PromptPages): number {
  return pages.custom.length + 1
}

export function isBuiltinPage(pages: PromptPages): boolean {
  return pages.active === 0
}

/** 当前页文本：内置页用调用方给的那份（内置提示词 / 自动生成的请求 / 输入框那句） */
export function currentPageText(pages: PromptPages, builtin: string): string {
  if (pages.active === 0) return builtin
  return pages.custom[pages.active - 1] ?? builtin
}

/** 改当前自定义页（内置页改不动） */
export function setPageText(pages: PromptPages, text: string): void {
  if (pages.active === 0) return
  pages.custom[pages.active - 1] = text
}

/** 新增一页（空白）并切过去 */
export function addPage(pages: PromptPages): void {
  pages.custom.push("")
  pages.active = pages.custom.length
}

/** 删掉当前自定义页（内置页删不掉）；删完落在剩下的自定义页上，没有了就回内置页 */
export function removePage(pages: PromptPages): void {
  if (pages.active === 0) return
  pages.custom.splice(pages.active - 1, 1)
  pages.active = Math.min(pages.active - 1, pages.custom.length)
}

/** 切页（越界夹住） */
export function gotoPage(pages: PromptPages, index: number): void {
  pages.active = Math.min(Math.max(Math.trunc(index), 0), pages.custom.length)
}
