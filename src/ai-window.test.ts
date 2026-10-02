import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import type { Project } from "./model/types"

// AI 独立窗口（?win=ai&doc=...）：只挂 AI 面板，主工作区不渲染
// 共享状态必须走 vi.hoisted：vi.mock 的工厂要抓的是同一份实例
const state = vi.hoisted(() => ({
  emitCalls: [] as { channel: string; payload: unknown }[],
  listeners: new Map<string, (payload: unknown) => void>(),
  tauriWindow: {
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerSize: vi.fn(() => Promise.resolve({ width: 520, height: 720 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  },
}))

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn((channel: string, payload: unknown) => {
    state.emitCalls.push({ channel, payload })
    return Promise.resolve()
  }),
  listen: vi.fn((channel: string, handler: (event: { payload: unknown }) => void) => {
    state.listeners.set(channel, (payload) => handler({ payload }))
    return Promise.resolve(() => {})
  }),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(() => Promise.resolve([])),
  getCurrentWindow: vi.fn(() => state.tauriWindow),
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(function WebviewWindow() {
    return { once: vi.fn(() => Promise.resolve()) }
  }),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function makeProject(title: string): Project {
  return {
    title,
    credits: [],
    source: "",
    sections: [
      {
        name: "副歌",
        sentences: [
          {
            id: "s1",
            pattern: [4, 4],
            cells: ["春", "风", "", ""],
            alternates: [],
            rhyme: null,
            lock: [false, false, false, false],
            harmony: false,
            note: "",
          },
        ],
      },
    ],
  } as unknown as Project
}

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  window.history.replaceState({}, "", "/?win=ai&doc=doc-1")
  localStorage.setItem(
    "cige-grid-docs",
    JSON.stringify({
      activeId: "doc-1",
      docs: [
        {
          id: "doc-1",
          project: makeProject("草木青时"),
          filePath: null,
          updatedAt: new Date(0).toISOString(),
        },
      ],
    }),
  )
  localStorage.setItem("cige-grid-ai-convos", JSON.stringify({ activeId: null, convos: [] }))
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("AI 窗口模式：主工作区不加载，只剩 AI 面板铺满", () => {
  expect(document.body.classList.contains("ai-window")).toBe(true)
  // AI 面板直接可见（不是 hidden）
  expect(document.querySelector<HTMLElement>("#ai-panel")!.hasAttribute("hidden")).toBe(false)
  // 主工作区没有词格渲染出来
  expect(document.querySelector("#sentences")!.children.length).toBe(0)
  // 窗口自己的控件露出来
  expect(document.querySelector<HTMLElement>("#btn-ai-win-new")!.hidden).toBe(false)
  expect(document.querySelector<HTMLElement>("#btn-ai-win-close")!.hidden).toBe(false)
  // 主窗口的 AI 开关按钮在 AI 窗口里藏起来
  expect(document.querySelector<HTMLElement>("#btn-ai")!.hidden).toBe(true)
})

it("打开就问主窗口要一次快照", () => {
  const ready = state.emitCalls.find((call) => (call as { channel: string }).channel === "ai-ready")
  expect(ready).toBeTruthy()
  expect((ready as { payload: { docId: string } }).payload.docId).toBe("doc-1")
})

it("收到主窗口的快照：标题跟着换，范围提示按快照算", () => {
  const push = state.listeners.get("project-sync-doc-1")
  expect(push).toBeTruthy()
  push!({
    docId: "doc-1",
    title: "另一首",
    project: makeProject("另一首"),
    targetIds: ["s1"],
    scope: "selected",
  })
  expect(document.querySelector<HTMLElement>("#ai-win-title")!.textContent).toContain("另一首")
  expect(document.querySelector<HTMLElement>("#ai-hint")!.textContent).toContain("选中 1 句")
})

it("「放回」主窗口：发 ai-redock 并把窗藏起来", async () => {
  state.emitCalls.length = 0
  const redock = document.querySelector<HTMLButtonElement>("#btn-ai-redock")!
  expect(redock.hidden).toBe(false)
  redock.click()
  await tick(0)
  const call = state.emitCalls.find((item) => item.channel === "ai-redock")
  expect(call).toBeTruthy()
  expect((call as { payload: { docId: string } }).payload.docId).toBe("doc-1")
  expect(state.tauriWindow.hide).toHaveBeenCalled()
})
