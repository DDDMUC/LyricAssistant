import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

// 启动回归：AI 面板「可拆但不默认拆」——启动一律内嵌（老标记也应被忽略）
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(() => Promise.resolve([])),
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerSize: vi.fn(() => Promise.resolve({ width: 520, height: 720 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(function WebviewWindow() {
    return { once: vi.fn(() => Promise.resolve()) }
  }),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  localStorage.setItem("cige-grid-ai-detached", "1")
  localStorage.setItem("cige-grid-ai-open", "0")
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("默认不拆：就算上次是拆开状态，启动也回到内嵌（不自动开窗）", async () => {
  await tick(30)
  expect(document.documentElement.classList.contains("ai-detached")).toBe(false)
  expect(document.querySelector<HTMLElement>("#btn-ai-redock-main")!.hidden).toBe(true)
})
