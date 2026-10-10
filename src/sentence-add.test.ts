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

it("工具栏不再有「词格」输入框和「新句」按钮；段落头不再有加句 / 加和声按钮；逐句加句沿用本句词格", () => {
  expect(document.querySelector("#new-pattern")).toBeNull()
  expect(document.querySelector("#btn-add-sentence")).toBeNull()

  // 段落头不再有「＋ 新增一句」「＋ 和声」（和逐句的重复，已去掉）
  const section = document.querySelector<HTMLElement>(".section")!
  const headerTexts = Array.from(
    section.querySelectorAll<HTMLButtonElement>(".section-actions button"),
  ).map((button) => button.textContent)
  expect(headerTexts).not.toContain("+ 新增一句")
  expect(headerTexts).not.toContain("+ 和声")

  // 逐句「+ 新增一句」→ 词格沿用本句
  const sentences = () => Array.from(document.querySelectorAll<HTMLElement>(".section .sentence"))
  const before = sentences().length
  const first = sentences()[0]
  const firstPattern = patternOf(first)
  first.querySelector<HTMLButtonElement>(".sentence-add")!.click()
  const list = sentences()
  expect(list.length).toBe(before + 1)
  expect(patternOf(list[1])).toBe(firstPattern)
})
