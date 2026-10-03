import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import { createDoc } from "./docs"

// 文档栏独立窗口（?win=docs）：只挂侧边栏；里面的一切操作都是"意向"，发回主窗口执行
const listeners = new Map<string, (payload: unknown) => void>()
const emitCalls: { channel: string; payload: unknown }[] = []
const movedHandlers: (() => void)[] = []

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn((channel: string, payload: unknown) => {
    emitCalls.push({ channel, payload })
    return Promise.resolve()
  }),
  listen: vi.fn((channel: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(channel, (payload) => handler({ payload }))
    return Promise.resolve(() => {})
  }),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(() => Promise.resolve([])),
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerSize: vi.fn(() => Promise.resolve({ width: 300, height: 760 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn((handler: () => void) => {
      movedHandlers.push(handler)
      return Promise.resolve(() => {})
    }),
  })),
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(function WebviewWindow() {
    return { once: vi.fn(() => Promise.resolve()) }
  }),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

function seedDocs(count: number): void {
  const docs = Array.from({ length: count }, (_, i) => createDoc(`歌 ${i + 1}`))
  localStorage.setItem(
    "cige-grid-docs",
    JSON.stringify({ activeId: docs[0].id, docs }),
  )
}

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  window.history.replaceState({}, "", "/?win=docs")
  seedDocs(3)
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("文档栏窗口模式：主工作区不加载，只挂侧边栏", () => {
  expect(document.body.classList.contains("docs-window")).toBe(true)
  expect(document.querySelector("#sentences")!.children.length).toBe(0)
  // 「拆出」藏起来、「放回」露出来
  expect(document.querySelector<HTMLElement>("#btn-docs-win")!.hidden).toBe(true)
  expect(document.querySelector<HTMLElement>("#btn-docs-redock")!.hidden).toBe(false)
  // 列表照常画
  expect(document.querySelectorAll<HTMLElement>(".doc-item").length).toBe(3)
})

it("打开就问主窗口要一次列表", () => {
  const ready = emitCalls.find((call) => call.channel === "docs-ready")
  expect(ready).toBeTruthy()
})

it("点文档 / 新建 / 删除 / 改名 / 新会话：只发意向，本地不切换", () => {
  emitCalls.length = 0
  const before = document.querySelector<HTMLElement>(".doc-item.active")?.textContent ?? ""
  // 点第二首歌
  document.querySelectorAll<HTMLElement>(".doc-item")[1].click()
  // 新建
  document.querySelector<HTMLButtonElement>("#btn-new-doc")!.click()
  // 删第一首
  document.querySelectorAll<HTMLElement>(".doc-del")[0].click()
  // 新会话
  document.querySelector<HTMLButtonElement>("#btn-new-convo")!.click()

  const intents = emitCalls
    .filter((call) => call.channel === "docs-intent")
    .map((call) => (call.payload as { type: string }).type)
  expect(intents).toEqual(["activate", "new-doc", "delete", "new-convo"])
  // 本地列表没被改动（还停在主窗口推来的那份）
  expect(document.querySelectorAll<HTMLElement>(".doc-item").length).toBe(3)
  expect(document.querySelector<HTMLElement>(".doc-item.active")?.textContent ?? "").toBe(before)
})

it("主窗口推来新列表：本地副本跟着换", () => {
  const push = listeners.get("docs-sync")
  expect(push).toBeTruthy()
  const docs = [createDoc("远方的歌"), createDoc("第二首")]
  push!({ docs, activeId: docs[1].id })
  const items = document.querySelectorAll<HTMLElement>(".doc-item")
  expect(items.length).toBe(2)
  expect(items[1].textContent).toContain("第二首")
  expect(items[1].classList.contains("active")).toBe(true)
  expect(items[0].textContent).toContain("远方的歌")
})
