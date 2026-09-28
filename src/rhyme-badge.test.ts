import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock, writeMock, readMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  writeMock: vi.fn(async (_text: string) => {}),
  readMock: vi.fn(async () => ""),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: writeMock,
  readText: readMock,
}))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const sentenceEls = () => Array.from(document.querySelectorAll<HTMLElement>(".sentence"))
const badgeOf = (index: number) => sentenceEls()[index].querySelector<HTMLElement>(".rhyme-badge")!
const cellText = (sentenceIndex: number, cellIndex: number) => {
  const el = sentenceEls()[sentenceIndex].querySelector<HTMLInputElement | HTMLElement>(
    `.cell[data-index="${cellIndex}"], .cell-input[data-index="${cellIndex}"]`,
  )!
  return el instanceof HTMLInputElement ? el.value : (el.textContent ?? "").trim()
}
const clickCell = (sentenceIndex: number, cellIndex: number) => {
  const cell = sentenceEls()[sentenceIndex].querySelector<HTMLElement>(
    `.cell[data-index="${cellIndex}"], .cell-input[data-index="${cellIndex}"]`,
  )!
  cell.click()
}

it("逐格锁：徽章看光标那格（锁显示锁、没锁显示辙），可锁任意一格，有锁的格子打字被拦", async () => {
  readMock.mockResolvedValue("东江山")
  const paste = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sentence-controls button"),
  ).find((button) => button.textContent === "粘贴句")!
  paste.click()
  await tick(30)

  // 光标停在最后写入的格子（第 3 格 = 山）→ 言前
  expect(badgeOf(0).textContent).toContain("言前")
  // 第 1 格 东 → 中东；第 2 格 江 → 江阳
  clickCell(0, 0)
  await tick(20)
  expect(badgeOf(0).textContent).toContain("中东")
  clickCell(0, 1)
  await tick(20)
  expect(badgeOf(0).textContent).toContain("江阳")

  // 给第 1 格加锁「中东」
  clickCell(0, 0)
  await tick(20)
  badgeOf(0).click()
  await tick(20)
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  Array.from(dialog.querySelectorAll<HTMLButtonElement>(".rhyme-grid button"))
    .find((button) => button.textContent === "中东")!
    .click()
  await tick(30)
  expect(badgeOf(0).textContent).toContain("中东")
  expect(badgeOf(0).textContent).toContain("🔒")

  // 第 2 格没锁：点它显示自己的辙（江阳），不带锁
  clickCell(0, 1)
  await tick(20)
  expect(badgeOf(0).textContent).toContain("江阳")
  expect(badgeOf(0).textContent).not.toContain("🔒")

  // 光标不在本句 → 看最后有字的一格（第 3 格 山 → 言前）
  clickCell(1, 0)
  await tick(20)
  expect(badgeOf(0).textContent).toContain("言前")

  // 有锁的第 1 格打字被拦：光标回第 1 格，输入不押「中东」的「江」
  clickCell(0, 0)
  await tick(20)
  const input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.value = "江"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  expect(document.querySelector("#status-hint")?.textContent ?? "").toContain("已拦下")
  expect(cellText(0, 0)).toBe("东")
})
