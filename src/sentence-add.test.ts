import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const patternOf = (el: Element) => el.querySelector<HTMLInputElement>(".sentence-pattern")!.value

it("工具栏不再有「词格」输入框和「新句」按钮；加句沿用已有词格", () => {
  expect(document.querySelector("#new-pattern")).toBeNull()
  expect(document.querySelector("#btn-add-sentence")).toBeNull()

  // 段落「＋ 新增一句」→ 词格沿用本段最后一句
  const section = document.querySelector<HTMLElement>(".section")!
  const sentences = () => Array.from(document.querySelectorAll<HTMLElement>(".section .sentence"))
  const before = sentences().length
  const lastPattern = patternOf(sentences()[before - 1])
  Array.from(section.querySelectorAll<HTMLButtonElement>(".section-actions button"))
    .find((button) => button.textContent === "+ 新增一句")!
    .click()
  const after = sentences()
  expect(after.length).toBe(before + 1)
  expect(patternOf(after[after.length - 1])).toBe(lastPattern)

  // 逐句「+ 新增一句」→ 词格沿用本句
  const first = sentences()[0]
  const firstPattern = patternOf(first)
  first.querySelector<HTMLButtonElement>(".sentence-add")!.click()
  const list = sentences()
  expect(patternOf(list[1])).toBe(firstPattern)
})
