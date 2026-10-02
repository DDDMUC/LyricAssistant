import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock, writeMock, readMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  writeMock: vi.fn(async (_text: string) => {}),
  readMock: vi.fn(async () => ""),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: writeMock,
  readText: readMock,
}))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const cells = () => Array.from(document.querySelectorAll<HTMLElement>(".cell, .cell-input"))
const cellText = (el: HTMLElement) =>
  el instanceof HTMLInputElement ? el.value : (el.textContent ?? "").trim()
const lastCopy = () => writeMock.mock.calls[writeMock.mock.calls.length - 1][0] as string

/** 用剪贴板往第一句里粘四个字 */
async function fillFirstSentence(): Promise<void> {
  readMock.mockResolvedValue("甲乙丙丁")
  const paste = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sentence-controls button"),
  ).find((button) => button.textContent === "粘贴句")!
  paste.click()
  await tick(30)
}

/** 造一个框选：从第 1 格拖到第 3 格 */
function marqueeFirstThree(): void {
  const list = cells()
  const start = list[0]
  const end = list[2]
  start.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  const realFromPoint = document.elementFromPoint
  document.elementFromPoint = () => end
  document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 5 }))
  document.elementFromPoint = realFromPoint
  document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
}

it("系统复制（⌘C / 右键）跟着框选走；工具栏「复制」依然复制整首", async () => {
  await fillFirstSentence()
  expect(cells().slice(0, 4).map(cellText)).toEqual(["甲", "乙", "丙", "丁"])

  marqueeFirstThree()
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected")).toHaveLength(3)
  // 系统选区同步成选中的字：右键 → 复制 拿到的就是这些
  expect(window.getSelection()?.toString()).toBe("甲乙丙")

  // ⌘C（我们拦下来的那条）只复制选中的字
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true, cancelable: true }),
  )
  await tick(30)
  expect(lastCopy()).toBe("甲乙丙")
  expect(document.querySelector("#status-hint")?.textContent ?? "").toContain("已复制 3 个字")
  // 复制完框选清掉，系统选区也清掉
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected")).toHaveLength(0)
  expect(window.getSelection()?.toString() ?? "").toBe("")

  // 工具栏「复制 → 歌词」照旧复制整首（不受框选影响）
  marqueeFirstThree()
  document.querySelector<HTMLButtonElement>("#btn-copy")!.click()
  expect(document.querySelector("#menu-copy-lyrics")?.textContent).toBe("歌词")
  document.querySelector<HTMLButtonElement>("#menu-copy-lyrics")!.click()
  await tick(30)
  const whole = lastCopy()
  expect(whole).toContain("甲乙丙丁")
  expect(whole).toContain("X")
})

it("⌘A 全选的是格子（不是整页文字），再复制就是整首选中的字", async () => {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true }),
  )
  const selected = document.querySelectorAll(".cell.selected, .cell-input.selected")
  expect(selected.length).toBe(cells().length)

  const mirrored = window.getSelection()?.toString() ?? ""
  expect(mirrored).toContain("甲乙丙丁")
  expect(mirrored).not.toContain("导入") // 没有把界面文字也选进去
})

const inputIndex = () =>
  document.querySelector<HTMLInputElement>("input.cell-input")?.dataset.index ?? null

it("Ctrl+G 挑格模式：跳着挑格子，复制/删除只作用于选中的格子（不挪光标）", async () => {
  // 清掉上一个用例留下的选择
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
  await fillFirstSentence() // 甲乙丙丁，光标在第 4 格
  const togglePickMode = () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true, cancelable: true }),
    )
  const pick = (el: HTMLElement) => {
    const opts = { bubbles: true, cancelable: true, button: 0 }
    el.dispatchEvent(new PointerEvent("pointerdown", opts))
    el.dispatchEvent(new PointerEvent("pointerup", opts))
    el.dispatchEvent(new MouseEvent("click", opts))
  }

  togglePickMode()
  pick(cells()[0])
  pick(cells()[2])
  await tick(10)

  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(2)
  // G 点击是"挑格子"，不该挪编辑光标
  expect(inputIndex()).toBe("3")

  // ⌘C 只复制这两个（按句分行）
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true, cancelable: true }),
  )
  await tick(30)
  expect(lastCopy()).toBe("甲\n丙")

  // 复制后选择被清；再挑一次 + Backspace：只清掉这两格
  pick(cells()[0])
  pick(cells()[2])
  await tick(10)
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }),
  )
  await tick(30)
  expect(cellText(cells()[0])).toBe("")
  expect(cellText(cells()[1])).toBe("乙")
  expect(cellText(cells()[2])).toBe("")

  togglePickMode()
  await tick(10)
})
