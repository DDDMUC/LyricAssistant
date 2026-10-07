import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

// 目录里的预设模型（带 DSH 标的档位）不该显示「思考：不适用」——
// 档位跟着「模型」走，不跟「这家勾没勾开关」走（请求那边本来就按目录档位发 reasoning_effort）
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
  // 用一家「目录提供商」（火山方舟 Agent Plan）的 deepseek-v4.1-flash——目录里带了档位
  localStorage.setItem(
    "cige-grid-ai",
    JSON.stringify({
      providerId: "volcengine-agent-plan",
      model: "deepseek-v4.1-flash",
      providers: [{ id: "volcengine-agent-plan", apiKey: "sk-test" }],
    }),
  )
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("目录预设模型的思考档位：不显示「不适用」，点开有档位可选", async () => {
  document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  await tick(20)
  const chip = document.querySelector<HTMLButtonElement>("#ai-effort-chip")!
  expect(chip.disabled).toBe(false)
  expect(chip.textContent).toContain("Default")
  expect(chip.textContent).not.toContain("不适用")
  chip.click()
  const levels = Array.from(document.querySelectorAll<HTMLButtonElement>(".ai-pop button")).map(
    (button) => button.textContent?.replace("✓", ""),
  )
  expect(levels).toContain("Default")
  expect(levels).toContain("Low")
  expect(levels).toContain("High")
  expect(levels).toContain("Max")
})
