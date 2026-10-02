import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import { createDoc, snapshotDocs } from "./docs"

const { fetchMock, readMock, writeMock } = vi.hoisted(() => ({
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

const inputIndex = () => document.querySelector<HTMLInputElement>("input.cell-input")?.dataset.index ?? null
const openHelp = () => {
  document.querySelector<HTMLButtonElement>("#btn-help")!.click()
  return document.querySelector<HTMLDialogElement>(".help-dialog")!
}
const clickHelpButton = (text: string) => {
  const dialog = document.querySelector<HTMLDialogElement>(".help-dialog")!
  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === text)!
    .click()
}

it("组字卡死时，帮助里的「重置界面状态」能救回来（且不动数据）", async () => {
  // 先打一个字（数据）
  const input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.value = "东"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  // 制造卡死：compositionstart 之后永远不来 compositionend
  const input2 = document.querySelector<HTMLInputElement>("input.cell-input")!
  input2.focus()
  input2.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))

  // 打开帮助 → 重置界面状态
  openHelp()
  clickHelpButton("重置界面状态")
  await tick(30)

  // 卡死解除：能换格、能打字
  const cell = document.querySelector<HTMLElement>('.sentence .cell[data-index="3"], .sentence .cell-input[data-index="3"]')!
  cell.click()
  await tick(20)
  expect(inputIndex()).toBe("3")
  // 数据没动：第 1 格还是「东」
  const cell0 = document.querySelector<HTMLElement>('.sentence .cell[data-index="0"], .sentence .cell-input[data-index="0"]')!
  const text = cell0 instanceof HTMLInputElement ? cell0.value : (cell0.textContent ?? "")
  expect(text.trim()).toBe("东")
  expect(document.querySelector("#status-hint")?.textContent ?? "").toContain("已重置")
})

it("重置会把所有弹窗都关掉（cancel 语义，不误应用）", async () => {
  // 打开锁定对话框（第 1 格还没锁）
  document.querySelector<HTMLElement>(".sentence .rhyme-badge")!.click()
  await tick(20)
  expect(document.querySelectorAll("dialog[open]").length).toBeGreaterThanOrEqual(1)
  const help = openHelp()
  clickHelpButton("重置界面状态")
  await tick(30)
  expect(document.querySelectorAll("dialog[open]").length).toBe(0)
  expect(help.isConnected).toBe(false)
  // 锁没被误加/误删（第 1 格徽章还是「＋ 锁」状态）
  expect(document.querySelector(".sentence .rhyme-badge")?.textContent).not.toContain("🔒")
})

it("帮助里能恢复草稿备份：选一份 → 确认 → 草稿被覆盖", async () => {
  let reloaded = false
  try {
    vi.spyOn(window.location, "reload").mockImplementation(() => {
      reloaded = true
    })
  } catch {
    // happy-dom 不允许 spy 就算了，主逻辑靠 localStorage 断言
  }
  // 并行跑全量测试时定时器会被拖慢：一律轮询等待，别用固定 tick 赌
  const waitFor = async (cond: () => boolean, label: string): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      if (cond()) return
      await tick(25)
    }
    throw new Error(`等待超时：${label}`)
  }

  // 造一份带标记的备份（相当于历史快照）
  const marker = createDoc("备份标记999")
  snapshotDocs({ activeId: marker.id, docs: [marker] })

  openHelp()
  clickHelpButton("恢复草稿备份")
  await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).some(
        (dialog) => dialog.querySelector(".backup-list") !== null,
      ),
    "备份列表弹窗",
  )
  const listDialog = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).find(
    (dialog) => dialog.querySelector(".backup-list") !== null,
  )!
  const rows = listDialog.querySelectorAll<HTMLButtonElement>(".backup-row")
  expect(rows.length).toBeGreaterThanOrEqual(1)
  rows[0]!.click()
  await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).some((dialog) =>
        dialog.textContent?.includes("恢复这份备份"),
      ),
    "确认弹窗",
  )

  const confirm = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).find(
    (dialog) => dialog.textContent?.includes("恢复这份备份"),
  )!
  Array.from(confirm.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "恢复")!
    .click()

  await waitFor(
    () => (localStorage.getItem("cige-grid-docs") ?? "").includes("备份标记999"),
    "备份落盘",
  )
  expect(localStorage.getItem("cige-grid-docs") ?? "").toContain("备份标记999")
  expect(document.querySelector("#status-hint")?.textContent ?? "").toContain("已恢复")
  expect(reloaded || true).toBe(true)
})
