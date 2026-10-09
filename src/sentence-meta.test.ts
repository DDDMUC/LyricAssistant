import { beforeEach, describe, expect, it } from "vitest"
import { applyMetaLayout, initMetaLayout, metaLayoutLabel, metaLayoutState } from "./sentence-meta"

describe("sentence-meta（句子工具条排版）", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("meta-reserve")
    metaLayoutState.value = "compact"
  })

  it("applyMetaLayout 写 html class 与 localStorage", () => {
    applyMetaLayout("reserve")
    expect(document.documentElement.classList.contains("meta-reserve")).toBe(true)
    expect(localStorage.getItem("cige-grid-meta-layout")).toBe("reserve")
    applyMetaLayout("compact")
    expect(document.documentElement.classList.contains("meta-reserve")).toBe(false)
    expect(localStorage.getItem("cige-grid-meta-layout")).toBe("compact")
  })

  it("initMetaLayout 恢复保存值；没存过默认 compact", () => {
    localStorage.setItem("cige-grid-meta-layout", "reserve")
    expect(initMetaLayout()).toBe("reserve")
    expect(metaLayoutState.value).toBe("reserve")
    localStorage.clear()
    expect(initMetaLayout()).toBe("compact")
    expect(document.documentElement.classList.contains("meta-reserve")).toBe(false)
  })

  it("标签文案", () => {
    expect(metaLayoutLabel("compact")).toContain("不占位")
    expect(metaLayoutLabel("reserve")).toContain("占位")
  })
})
