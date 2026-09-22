import { beforeEach, describe, expect, it } from "vitest"
import {
  applyTheme,
  cycleTheme,
  initTheme,
  resolvedTheme,
  themeIcon,
  themeLabel,
  themeState,
} from "./theme"

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    themeState.pref = "auto"
  })

  it("亮色/深色直接解析", () => {
    expect(resolvedTheme("light")).toBe("light")
    expect(resolvedTheme("dark")).toBe("dark")
  })

  it("applyTheme 写入 data-theme 与 localStorage", () => {
    applyTheme("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(localStorage.getItem("cige-grid-theme")).toBe("dark")
    applyTheme("light")
    expect(document.documentElement.dataset.theme).toBe("light")
  })

  it("循环 auto → light → dark", () => {
    themeState.pref = "auto"
    expect(cycleTheme()).toBe("light")
    expect(cycleTheme()).toBe("dark")
    expect(cycleTheme()).toBe("auto")
  })

  it("initTheme 恢复保存值", () => {
    localStorage.setItem("cige-grid-theme", "dark")
    expect(initTheme()).toBe("dark")
    expect(themeState.pref).toBe("dark")
  })

  it("标签文案", () => {
    expect(themeLabel("light")).toBe("亮色")
    expect(themeLabel("dark")).toBe("深色")
    expect(themeLabel("auto")).toBe("跟随系统")
  })

  it("图标：太阳 / 月亮 / 云朵", () => {
    expect(themeIcon("light")).toBe("☀️")
    expect(themeIcon("dark")).toBe("🌙")
    expect(themeIcon("auto")).toBe("☁️")
  })
})
