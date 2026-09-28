import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const cellAt = (index: number) =>
  document.querySelector<HTMLElement>(
    `.sentence .cell[data-index="${index}"], .sentence .cell-input[data-index="${index}"]`,
  )
const inputIndex = () =>
  document.querySelector<HTMLInputElement>("input.cell-input")?.dataset.index ?? null

const pointerClick = (el: HTMLElement) => {
  const opts = { bubbles: true, cancelable: true, button: 0 }
  el.dispatchEvent(new PointerEvent("pointerdown", opts))
  el.dispatchEvent(new MouseEvent("click", opts))
}

it("组字被打断（没等到 compositionend）也不会把整页冻住", async () => {
  // 开始组字（输入框聚焦着，模拟真实情况）
  let input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.focus()
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))

  // 真实鼠标点别的格子：pointerdown 应该强制收掉卡住的组字态，点击照常生效
  pointerClick(cellAt(3)!)
  await tick(20)
  expect(inputIndex()).toBe("3")

  // blur 兜底：重新开始组字后直接把输入框 blur（IME 残留），点击仍然能走
  input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.focus()
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
  input.dispatchEvent(new Event("blur"))
  pointerClick(cellAt(5)!)
  await tick(20)
  expect(inputIndex()).toBe("5")
})
