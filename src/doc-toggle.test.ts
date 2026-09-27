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

it("新建歌词自动带一条新会话；三角折叠不切歌、状态记住、可再展开", async () => {
  const newBtn = document.querySelector<HTMLButtonElement>("#btn-new-doc")!
  newBtn.click()
  newBtn.click()

  const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".doc-card"))
  expect(cards().length).toBeGreaterThanOrEqual(3)

  // 每首歌都自动带了一条会话
  for (const card of cards()) {
    expect(card.querySelectorAll(".ai-convo-row").length).toBeGreaterThanOrEqual(1)
  }

  // 折叠倒数第二张歌（非当前选中）
  const second = cards()[cards().length - 2]
  const activeTitle = () => document.querySelector(".doc-item.active .doc-title")?.textContent
  const before = activeTitle()
  second.querySelector<HTMLButtonElement>(".doc-toggle")!.click()

  expect(cards()[cards().length - 2].querySelectorAll(".ai-convo-row").length).toBe(0)
  // 点三角没有切歌
  expect(activeTitle()).toBe(before)
  // 折叠状态记住了
  const stored = JSON.parse(localStorage.getItem("cige-grid-collapsed-docs") ?? "[]") as string[]
  expect(stored.length).toBe(1)

  // 再点展开
  cards()[cards().length - 2].querySelector<HTMLButtonElement>(".doc-toggle")!.click()
  expect(cards()[cards().length - 2].querySelectorAll(".ai-convo-row").length).toBeGreaterThanOrEqual(1)
  expect(
    JSON.parse(localStorage.getItem("cige-grid-collapsed-docs") ?? "[]") as string[],
  ).toEqual([])
})
