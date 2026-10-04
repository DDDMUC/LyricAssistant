import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import type { Project } from "./model/types"

// AI 独立窗口（?win=ai&doc=...）：只挂 AI 面板，主工作区不渲染
// 共享状态必须走 vi.hoisted：vi.mock 的工厂要抓的是同一份实例
const state = vi.hoisted(() => ({
  cursor: { x: 0, y: 0 },
  movedHandlers: [] as (() => void)[],
  emitCalls: [] as { channel: string; payload: unknown }[],
  listeners: new Map<string, (payload: unknown) => void>(),
  tauriWindow: {
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    setPosition: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerSize: vi.fn(() => Promise.resolve({ width: 520, height: 720 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn((handler: () => void) => {
      state.movedHandlers.push(handler)
      return Promise.resolve(() => {})
    }),
  },
}))

const coreMock = vi.hoisted(() => {
  const core = { mouseDown: false, invoke: vi.fn(async () => core.mouseDown) }
  return core
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: coreMock.invoke }))

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
  cursorPosition: vi.fn(async () => state.cursor),
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

it("独立窗拖回主窗口：指针进停靠区先高亮，停手还在区里就磁吸收回", async () => {
  state.emitCalls.length = 0
  // 独立窗在 (800, 150)，400×700；主窗在 (400, 100)，1100×800
  // 右停靠区 = x∈[1100,1500]：指针放到 1300 才该亮
  state.cursor = { x: 1300, y: 500 }
  state.tauriWindow.outerPosition.mockResolvedValue({ x: 800, y: 150 })
  state.tauriWindow.outerSize.mockResolvedValue({ width: 400, height: 700 })
  const { getAllWindows } = await import("@tauri-apps/api/window")
  vi.mocked(getAllWindows).mockResolvedValue([
    {
      label: "main",
      outerPosition: vi.fn(() => Promise.resolve({ x: 400, y: 100 })),
      outerSize: vi.fn(() => Promise.resolve({ width: 1100, height: 800 })),
    },
  ] as never)

  // 触发窗口移动事件
  expect(state.movedHandlers.length).toBeGreaterThan(0)
  state.movedHandlers[0]!()
  await tick(60)
  const hover = state.emitCalls.find((call) => call.channel === "ai-dock-hover")
  expect(hover).toBeTruthy()
  expect((hover as { payload: { over: boolean } }).payload.over).toBe(true)

  // 停手 220ms 后开始磁吸：滑 6 步 + 收回内嵌 + 藏窗
  await tick(600)
  const redock = state.emitCalls.find((call) => call.channel === "ai-redock")
  expect(redock).toBeTruthy()
  expect(state.tauriWindow.setPosition).toHaveBeenCalled()
  expect(state.tauriWindow.hide).toHaveBeenCalled()
})

it("窗口压在主窗上面、指针不在停靠区：不亮不吸，能随便放", async () => {
  state.emitCalls.length = 0
  state.tauriWindow.hide.mockClear()
  state.tauriWindow.setPosition.mockClear()
  // 窗口整个盖在主窗中间（重叠很多），但指针在主窗左半边、离右停靠区远
  state.cursor = { x: 700, y: 500 }
  state.tauriWindow.outerPosition.mockResolvedValue({ x: 550, y: 150 })
  state.tauriWindow.outerSize.mockResolvedValue({ width: 400, height: 700 })
  const { getAllWindows } = await import("@tauri-apps/api/window")
  vi.mocked(getAllWindows).mockResolvedValue([
    {
      label: "main",
      outerPosition: vi.fn(() => Promise.resolve({ x: 400, y: 100 })),
      outerSize: vi.fn(() => Promise.resolve({ width: 1100, height: 800 })),
    },
  ] as never)

  coreMock.mouseDown = true
  state.movedHandlers[0]!()
  await tick(400)
  expect(state.emitCalls.some((call) => call.channel === "ai-dock-hover")).toBe(false)

  coreMock.mouseDown = false
  await tick(500)
  expect(state.emitCalls.some((call) => call.channel === "ai-redock")).toBe(false)
  expect(state.tauriWindow.hide).not.toHaveBeenCalled()
})

it("磁吸：鼠标还按着不吸，松手才吸回", async () => {
  state.emitCalls.length = 0
  state.tauriWindow.hide.mockClear()
  state.tauriWindow.setPosition.mockClear()
  state.cursor = { x: 1300, y: 500 }
  state.tauriWindow.outerPosition.mockResolvedValue({ x: 800, y: 150 })
  state.tauriWindow.outerSize.mockResolvedValue({ width: 400, height: 700 })
  const { getAllWindows } = await import("@tauri-apps/api/window")
  vi.mocked(getAllWindows).mockResolvedValue([
    {
      label: "main",
      outerPosition: vi.fn(() => Promise.resolve({ x: 400, y: 100 })),
      outerSize: vi.fn(() => Promise.resolve({ width: 1100, height: 800 })),
    },
  ] as never)

  // 按着不放：停手 220ms 也不吸，一直等
  coreMock.mouseDown = true
  state.movedHandlers[0]!()
  await tick(700)
  expect(state.emitCalls.some((call) => call.channel === "ai-redock")).toBe(false)
  expect(state.tauriWindow.hide).not.toHaveBeenCalled()

  // 松手：这才滑回去、收回内嵌
  coreMock.mouseDown = false
  await tick(400)
  expect(state.emitCalls.some((call) => call.channel === "ai-redock")).toBe(true)
  expect(state.tauriWindow.hide).toHaveBeenCalled()
})
