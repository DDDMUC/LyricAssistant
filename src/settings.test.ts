import html from "../index.html?raw"
import { beforeAll, expect, it, vi } from "vitest"
import { APP_VERSION } from "./version"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => {}),
  readText: vi.fn(async () => ""),
}))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const openSettings = (section?: string): HTMLDialogElement => {
  document.querySelector<HTMLButtonElement>("#btn-settings")!.click()
  const dialog = document.querySelector<HTMLDialogElement>(".settings-dialog")!
  // 导航文字：外观 / 模型 / 数据 / 关于（"ai" 是内部 id）
  const label = section === "ai" ? "模型" : section
  if (label) {
    Array.from(dialog.querySelectorAll<HTMLButtonElement>(".settings-nav button"))
      .find((button) => button.textContent === label)!
      .click()
  }
  return dialog
}

it("标题栏 ⚙ 打开设置：分类是 外观 / 模型 / 数据 / 关于（主题按钮已收走）", () => {
  expect(document.querySelector("#btn-theme")).toBeNull()
  // 图标是内联 SVG（六瓣花形齿轮），不再用 emoji
  expect(document.querySelector("#btn-settings svg")).toBeTruthy()
  expect(document.querySelector("#ic-flower-gear")).toBeTruthy()
  expect(document.querySelector("#ic-flower-gear-dot")).toBeTruthy()
  const dialog = openSettings()
  const navs = Array.from(dialog.querySelectorAll<HTMLButtonElement>(".settings-nav button"))
  expect(navs.map((button) => button.textContent)).toEqual(["外观", "模型", "数据", "关于"])
  // 每个分类都带小图标
  expect(navs.every((button) => button.querySelector("svg use"))).toBe(true)
  expect(navs[0]!.classList.contains("active")).toBe(true)
  expect(dialog.textContent).toContain("主题")
  dialog.close()
  expect(document.querySelector(".settings-dialog")).toBeNull()
})

it("外观：点主题立即生效并记住（跟系统 / 亮色 / 深色）", () => {
  const dialog = openSettings()
  const choices = Array.from(dialog.querySelectorAll<HTMLButtonElement>(".settings-choice"))
  expect(choices).toHaveLength(3)
  expect(choices[0]!.textContent).toContain("跟随系统")
  expect(choices[1]!.textContent).toContain("亮色")
  expect(choices[2]!.textContent).toContain("深色")

  choices[2]!.click()
  expect(document.documentElement.dataset.theme).toBe("dark")
  expect(localStorage.getItem("cige-grid-theme")).toBe("dark")
  expect(choices[2]!.classList.contains("active")).toBe(true)

  choices[1]!.click()
  expect(document.documentElement.dataset.theme).toBe("light")
  expect(localStorage.getItem("cige-grid-theme")).toBe("light")

  choices[0]!.click()
  expect(localStorage.getItem("cige-grid-theme")).toBe("auto")
  dialog.close()
})

it("点设置面板外面的区域自动关（面板里面 / 留白都不关）", () => {
  const dialog = openSettings()
  Object.defineProperty(dialog, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 600,
      bottom: 500,
      width: 500,
      height: 400,
      toJSON: () => ({}),
    }),
  })
  // 面板里面：不关
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 300, clientY: 300 }))
  expect(document.querySelector(".settings-dialog")).not.toBeNull()
  // 背景（矩形之外）：关
  dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }))
  expect(document.querySelector(".settings-dialog")).toBeNull()
})

it("模型：服务商卡片列表（状态点 / 当前 / 编辑）+ 添加按钮", () => {
  const dialog = openSettings("ai")
  expect(dialog.textContent).toContain("填入各提供商的 API 密钥即可使用其模型")
  expect(dialog.textContent).toContain("Key 只存在这台电脑上")
  const cards = dialog.querySelectorAll<HTMLElement>(".settings-card")
  expect(cards.length).toBeGreaterThan(10)
  // 第一张是 DeepSeek 且是当前服务商；未填 Key 时状态点不亮
  expect(cards[0]!.querySelector(".settings-card-name")?.textContent).toContain("DeepSeek")
  expect(cards[0]!.classList.contains("current")).toBe(true)
  expect(cards[0]!.querySelector(".settings-dot")?.classList.contains("on")).toBe(false)
  // 「＋ 添加模型提供商」＋「服务商预设 · 刷新」
  expect(
    Array.from(dialog.querySelectorAll("button")).some((b) => b.textContent === "＋ 添加模型提供商"),
  ).toBe(true)
  expect(dialog.textContent).toContain("服务商预设")
  dialog.close()
})

it("数据：三个维护操作都在；关于：版本 + 帮助入口", () => {
  const dialog = openSettings("数据")
  const dataButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>(".settings-data-row")).map(
    (button) => button.textContent ?? "",
  )
  expect(dataButtons.some((text) => text.startsWith("恢复草稿备份"))).toBe(true)
  expect(dataButtons.some((text) => text.startsWith("导出诊断日志"))).toBe(true)
  expect(dataButtons.some((text) => text.startsWith("重置界面状态"))).toBe(true)

  Array.from(dialog.querySelectorAll<HTMLButtonElement>(".settings-nav button"))
    .find((button) => button.textContent === "关于")!
    .click()
  expect(dialog.textContent).toContain("作词助手")
  expect(dialog.textContent).toContain(APP_VERSION)

  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "使用说明与快捷键…")!
    .click()
  const helpDialog = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).find(
    (element) => element.classList.contains("help-dialog"),
  )
  expect(helpDialog).toBeTruthy()
  helpDialog!.close()
  dialog.close()
})
