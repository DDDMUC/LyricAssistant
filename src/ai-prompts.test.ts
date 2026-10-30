import { beforeEach, describe, expect, it } from "vitest"
import {
  AI_PROMPTS_KEY,
  addPage,
  currentPageText,
  gotoPage,
  isBuiltinPage,
  loadPromptPages,
  pageCount,
  removePage,
  savePromptPages,
  setPageText,
} from "./ai-prompts"

beforeEach(() => {
  localStorage.clear()
})

describe("提示词页", () => {
  it("初始只有内置页，取文本拿内置那份", () => {
    const pages = loadPromptPages()
    expect(pageCount(pages.system)).toBe(1)
    expect(isBuiltinPage(pages.system)).toBe(true)
    expect(currentPageText(pages.system, "内置系统提示词")).toBe("内置系统提示词")
  })

  it("新增页：空白一页，并切到新页", () => {
    const pages = loadPromptPages()
    addPage(pages.system)
    expect(pageCount(pages.system)).toBe(2)
    expect(isBuiltinPage(pages.system)).toBe(false)
    expect(currentPageText(pages.system, "内置系统提示词")).toBe("")
  })

  it("改自定义页 + 存 + 读回来", () => {
    const pages = loadPromptPages()
    addPage(pages.system)
    setPageText(pages.system, "我的系统提示词")
    savePromptPages(pages)
    const again = loadPromptPages()
    expect(pageCount(again.system)).toBe(2)
    expect(currentPageText(again.system, "内置")).toBe("我的系统提示词")
  })

  it("内置页改不动（第 1 页固定）", () => {
    const pages = loadPromptPages()
    setPageText(pages.system, "改内置")
    expect(currentPageText(pages.system, "内置")).toBe("内置")
  })

  it("删当前自定义页：落在剩下的自定义页；删完回内置页；内置页删不掉", () => {
    const pages = loadPromptPages()
    addPage(pages.system)
    addPage(pages.system)
    expect(pageCount(pages.system)).toBe(3)
    expect(pages.system.active).toBe(2)
    removePage(pages.system)
    expect(pageCount(pages.system)).toBe(2)
    expect(pages.system.active).toBe(1)
    removePage(pages.system)
    expect(pageCount(pages.system)).toBe(1)
    expect(isBuiltinPage(pages.system)).toBe(true)
    removePage(pages.system)
    expect(pageCount(pages.system)).toBe(1)
  })

  it("切页越界会被夹住", () => {
    const pages = loadPromptPages()
    gotoPage(pages.system, 5)
    expect(pages.system.active).toBe(0)
    addPage(pages.system)
    gotoPage(pages.system, -1)
    expect(pages.system.active).toBe(0)
    gotoPage(pages.system, 99)
    expect(pages.system.active).toBe(1)
  })

  it("坏数据兜底：坏 JSON / 页号越界 / 缺段", () => {
    localStorage.setItem(AI_PROMPTS_KEY, "{oops")
    expect(pageCount(loadPromptPages().system)).toBe(1)
    localStorage.setItem(
      AI_PROMPTS_KEY,
      JSON.stringify({ system: { custom: ["x"], active: 9 } }),
    )
    const pages = loadPromptPages()
    expect(pageCount(pages.system)).toBe(2)
    expect(pages.system.active).toBe(1)
    expect(pages.brief.custom).toEqual([])
    expect(pages.user.custom).toEqual([])
  })
})
