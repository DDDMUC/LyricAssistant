import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock, readMock, writeMock } = vi.hoisted(() => ({
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

const sentenceEls = () => Array.from(document.querySelectorAll<HTMLElement>(".sentence"))
const cellAt = (sentence: HTMLElement, index: number) =>
  sentence.querySelector<HTMLElement>(`.cell[data-index="${index}"], .cell-input[data-index="${index}"]`)!
const cellText = (el: HTMLElement) =>
  el instanceof HTMLInputElement ? el.value.trim() : (el.textContent ?? "").trim()

it("打字只重画当前句：其它句子的 DOM 节点身份不变", async () => {
  const secondRoot = sentenceEls()[1]
  const thirdCell = cellAt(sentenceEls()[2], 0)

  const input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.value = "东"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)

  // 其它句子整棵子树没被动过（节点身份还在）
  expect(sentenceEls()[1]).toBe(secondRoot)
  expect(cellAt(sentenceEls()[2], 0)).toBe(thirdCell)
  // 当前句更新了
  expect(cellText(cellAt(sentenceEls()[0], 0))).toBe("东")
})

it("换格只重画旧句和新句", async () => {
  const fourthRoot = sentenceEls()[3]
  cellAt(sentenceEls()[2], 0).click()
  await tick(20)
  expect(sentenceEls()[3]).toBe(fourthRoot)
  expect(document.querySelector("input.cell-input")?.closest(".sentence")).toBe(sentenceEls()[2])
})

it("增量编辑与全量重渲染（撤销/重做）结果一致", async () => {
  const snapshot = () =>
    `${document.querySelectorAll(".sentence .cell, .sentence .cell-input").length}|${document.querySelector("#sentences")?.textContent ?? ""}`
  const before = snapshot()

  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }),
  )
  await tick(20)
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )
  await tick(20)

  expect(snapshot()).toBe(before)
})
