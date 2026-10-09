import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import { createProject, createSection, createSentence } from "./state"
import type { Project } from "./model/types"

// 打字光标：输入后停在「刚写的那一格」（右侧），追加输入才进下一格；句尾回车 → 下一句第一个字
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => {}),
  readText: vi.fn(async () => ""),
}))
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

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 当前聚焦的格子输入框（.cell-input 只有一个） */
const activeInput = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>("input.cell-input")

const typeInto = async (input: HTMLInputElement, value: string): Promise<void> => {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
}

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  // 一份两句的工程：第一句 4 格、第二句 4 格
  const s1 = createSentence([4])
  const s2 = createSentence([4])
  const project: Project = {
    ...createProject(),
    sections: [createSection("段落 1", [s1, s2])],
  }
  localStorage.setItem(
    "cige-grid-docs",
    JSON.stringify({ activeId: "doc-1", docs: [{ id: "doc-1", project, filePath: null }] }),
  )
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
  await tick(30)
})

it("输入一个字后，光标停在那一格（不是下一格的左侧）", async () => {
  const first = activeInput()!
  expect(first.dataset.index).toBe("0")
  await typeInto(first, "预")
  const after = activeInput()!
  expect(after.dataset.index).toBe("0")
  expect(after.value).toBe("预")
  // 光标在字右侧（selectionStart = 字后面）
  expect(after.selectionStart).toBe(1)
})

it("光标停着的格子里再打字：新字落到下一格，光标跟过去", async () => {
  const input = activeInput()!
  expect(input.dataset.index).toBe("0")
  // 模拟「在已有字后面接着打」：输入框里变成 预树
  await typeInto(input, input.value + "树")
  const after = activeInput()!
  expect(after.dataset.index).toBe("1")
  expect(after.value).toBe("树")
  const cells = Array.from(document.querySelectorAll<HTMLElement>(".sentence .cell, .sentence .cell-input")).map(
    (el) => (el.classList.contains("cell-input") ? (el as HTMLInputElement).value : (el.textContent ?? "")),
  )
  expect(cells.slice(0, 2).join("")).toBe("预树")
})

it("句尾回车：光标到下一句的第一个字", async () => {
  // 走到第一句最后一个格子（3）
  let input = activeInput()!
  while (input.dataset.index !== "3") {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
    await tick(10)
    input = activeInput()!
  }
  const firstSentenceId = input.dataset.sentenceId
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
  await tick(20)
  const after = activeInput()!
  expect(after.dataset.sentenceId).not.toBe(firstSentenceId)
  expect(after.dataset.index).toBe("0")
})
