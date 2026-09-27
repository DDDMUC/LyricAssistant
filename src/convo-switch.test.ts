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

it("点其它会话：原位高亮切换，不跳到第一位", () => {
  const btn = document.querySelector<HTMLButtonElement>("#btn-new-convo")!
  btn.click()
  btn.click()
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".ai-convo-row"))
  expect(rows().length).toBe(3)
  expect(rows()[0].classList.contains("active")).toBe(true)

  rows()[2].click()
  const after = rows()
  expect(after.length).toBe(3)
  const activeIndex = after.findIndex((row) => row.classList.contains("active"))
  expect(activeIndex).toBe(2)
})
