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

const sentence0 = () => document.querySelectorAll<HTMLElement>(".sentence")[0]
const cellAt = (index: number) =>
  sentence0().querySelector<HTMLElement>(`.cell[data-index="${index}"], .cell-input[data-index="${index}"]`)!
const cellText = (el: HTMLElement) =>
  el instanceof HTMLInputElement ? el.value.trim() : (el.textContent ?? "").trim()
const togglePickMode = () =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true, cancelable: true }),
  )
const pick = (el: HTMLElement) => {
  const opts = { bubbles: true, cancelable: true, button: 0 }
  el.dispatchEvent(new PointerEvent("pointerdown", opts))
  el.dispatchEvent(new PointerEvent("pointerup", opts))
  el.dispatchEvent(new MouseEvent("click", opts))
}
const statusText = () => document.querySelector("#status-hint")?.textContent ?? ""

it("Ctrl+G 挑格 → 浮动条 → 建韵组：同组高亮、打字拦字、候选替换", async () => {
  // 第 1 格先打「东」当种子（中东辙）
  let input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.value = "东"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)

  // Ctrl+G 挑格模式里挑第 1 格 + 第 3 格（模式里直接点浮动条）
  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)

  // 浮动条出现 + 点「成组」
  const bar = document.querySelector<HTMLElement>(".pick-bar")!
  expect(bar.hidden).toBe(false)
  Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "成组")!
    .click()
  await tick(40)

  const dialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  expect(dialog).toBeTruthy()
  // 标题可拖：按住标题拖 (60, 30) → transform 跟着走
  const handle = dialog.querySelector<HTMLElement>(".dialog-drag-handle")!
  const down = (x: number, y: number) =>
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  handle.dispatchEvent(down(100, 100))
  handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 160, clientY: 130 }))
  expect(dialog.style.transform).toBe("translate(60px, 30px)")
  handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
  // 种子（东）反推出「中东」，且默认只勾「辙」
  const [rhySelect] = Array.from(dialog.querySelectorAll<HTMLSelectElement>("select"))
  expect(rhySelect.value).toBe("zhongdong")
  // 推荐里有「东」（中东字）
  const grid = dialog.querySelector<HTMLElement>(".candidate-grid")!
  expect(grid.textContent).toContain("东")
  // 点推荐字「风」→ 填进第一个空格（第 3 格）
  Array.from(grid.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "风")!
    .click()
  await tick(30)
  expect(cellText(cellAt(2))).toBe("风")

  // 建立韵组
  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(statusText()).toContain("已建立韵组")
  togglePickMode()
  await tick(10)

  // 光标不在组里（还在第 2 格）：只有组员类、不亮
  expect(cellAt(0).classList.contains("group-member")).toBe(true)
  expect(cellAt(0).classList.contains("group-lit")).toBe(false)
  // 光标点进组里（第 1 格）→ 同组两格都亮
  cellAt(0).click()
  await tick(20)
  expect(cellAt(0).classList.contains("group-lit")).toBe(true)
  expect(cellAt(2).classList.contains("group-lit")).toBe(true)

  // 打字拦字：输「江」（江阳）不合中东 → 拦下，格子内容不变
  input = document.querySelector<HTMLInputElement>("input.cell-input")!
  input.value = "江"
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  expect(statusText()).toContain("韵组")
  expect(cellText(cellAt(0))).toBe("东")
  // 合辙的「中」放行
  const input2 = document.querySelector<HTMLInputElement>("input.cell-input")!
  input2.value = "中"
  input2.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  expect(cellText(cellAt(0))).toBe("中")

  // 徽章里能解散
  cellAt(0).click()
  await tick(20)
  document.querySelector<HTMLElement>(".sentence .rhyme-badge")!.click()
  await tick(30)
  const lockDialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  expect(lockDialog.textContent).toContain("韵组")
  Array.from(lockDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "解散这个韵组")!
    .click()
  await tick(30)
  expect(statusText()).toContain("已解散")
  expect(cellAt(0).classList.contains("group-member")).toBe(false)
})

it("退出模式即清空选择；✕ 能清空；点空白处不误清", async () => {
  const bar = () => document.querySelector<HTMLElement>(".pick-bar")!
  const selectedCount = () =>
    document.querySelectorAll(".cell.selected, .cell-input.selected").length
  const enterPick = () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true, cancelable: true }),
    )

  // A：退出模式 → 选择清空、浮动条消失
  enterPick()
  pick(cellAt(0))
  pick(cellAt(1))
  await tick(20)
  expect(bar().hidden).toBe(false)
  expect(selectedCount()).toBe(2)
  enterPick()
  await tick(20)
  expect(selectedCount()).toBe(0)
  expect(bar().hidden).toBe(true)

  // B：误点空白处 → 选中不受影响、浮动条还在（不误清）
  enterPick()
  pick(cellAt(0))
  pick(cellAt(1))
  await tick(20)
  expect(bar().hidden).toBe(false)
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
  await tick(20)
  expect(selectedCount()).toBe(2)
  expect(bar().hidden).toBe(false)

  // C：点 ✕ → 清空
  Array.from(bar().querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "✕")!
    .click()
  await tick(20)
  expect(bar().hidden).toBe(true)
  expect(selectedCount()).toBe(0)

  enterPick()
  await tick(10)
})

it("按住 ⌘G 的自动重复只切换一次", async () => {
  const fire = (repeat: boolean) =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, repeat, bubbles: true, cancelable: true }),
    )
  const selectedCount = () =>
    document.querySelectorAll(".cell.selected, .cell-input.selected").length

  fire(false)
  fire(true)
  fire(true)
  await tick(10)
  pick(cellAt(0))
  expect(selectedCount()).toBe(1)

  fire(false)
  fire(true)
  fire(true)
  await tick(10)
  expect(document.body.classList.contains("pick-mode")).toBe(false)
  expect(selectedCount()).toBe(0)

  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(0)
})

it("按 G 收起：退出模式并清空选择；格子输入框里也收，真正的文本框不抢", async () => {
  const fire = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))

  // 清场（前面用例可能留下选中）
  fire(document.body, "Escape")
  fire(document.body, "Escape")
  await tick(10)

  fire(window, "g", { ctrlKey: true })
  pick(cellAt(0))
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(1)

  fire(document.body, "g")
  await tick(10)
  expect(document.body.classList.contains("pick-mode")).toBe(false)
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(0)

  // 格子输入框里按 g：也收起（焦点常留在格子里）
  const input = document.querySelector<HTMLInputElement>(".cell-input")!
  input.focus()
  fire(window, "g", { ctrlKey: true })
  pick(cellAt(0))
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(1)
  fire(input, "g")
  await tick(10)
  expect(document.body.classList.contains("pick-mode")).toBe(false)
  expect(document.querySelectorAll(".cell.selected, .cell-input.selected").length).toBe(0)

  // 真正的文本框（备注）里按 g：不抢
  const note = document.querySelector<HTMLInputElement>(".sentence-note")!
  note.focus()
  fire(window, "g", { ctrlKey: true })
  note.focus()
  fire(note, "g")
  await tick(10)
  expect(document.body.classList.contains("pick-mode")).toBe(true)
  fire(window, "g", { ctrlKey: true })
  await tick(10)
  expect(document.body.classList.contains("pick-mode")).toBe(false)
})

it("点成员：整组闪 + 出「解散这个韵组」小条；非成员格子的「解散」给提示", async () => {
  const bar = () => document.querySelector<HTMLElement>(".pick-bar")!
  const barButton = (text: string) =>
    Array.from(bar().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === text,
    )!
  const groupCount = () =>
    document.querySelectorAll(".cell.group-member, .cell-input.group-member").length

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  // 第 1 格「东」+ 第 3 格「风」→ 成组（模式里直接点浮动条）
  const first = document.querySelector<HTMLInputElement>("input.cell-input")!
  first.value = "东"
  first.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)
  barButton("成组").click()
  await tick(40)
  const dialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(groupCount()).toBeGreaterThan(0)

  // 成员在挑格模式里点不动：整组闪 + 弹出「解散这个韵组」小条（不进选择）
  pick(cellAt(0))
  await tick(20)
  expect(bar().hidden).toBe(false)
  expect(barButton("解散这个韵组").hidden).toBe(false)
  expect(barButton("复制").hidden).toBe(true)
  expect(cellAt(0).classList.contains("selected")).toBe(false)
  expect(cellAt(0).classList.contains("group-flash")).toBe(true)
  expect(statusText()).toContain("已经在韵组")

  // 一键解散
  barButton("解散这个韵组").click()
  await tick(40)
  expect(statusText()).toContain("已解散")
  expect(groupCount()).toBe(0)
  expect(bar().hidden).toBe(true)

  // 重建一个组 → 选中非成员格 → 「解散」给提示（组还在）
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)
  barButton("成组").click()
  await tick(40)
  const dialog2 = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(dialog2.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(groupCount()).toBeGreaterThan(0)

  pick(cellAt(1))
  await tick(20)
  barButton("解散").click()
  await tick(20)
  expect(statusText()).toContain("没有韵组")
  expect(groupCount()).toBeGreaterThan(0)

  // 有选择时点成员：条子也切成「解散这个韵组」，已挑的格子不丢
  pick(cellAt(0))
  await tick(20)
  expect(barButton("解散这个韵组").hidden).toBe(false)
  expect(barButton("复制").hidden).toBe(true)
  expect(cellAt(1).classList.contains("selected")).toBe(true)
  barButton("解散这个韵组").click()
  await tick(40)
  expect(groupCount()).toBe(0)
  // 解散条退场后，切回正常条（选择还在）
  expect(barButton("复制").hidden).toBe(false)
  expect(cellAt(1).classList.contains("selected")).toBe(true)

  // 清场：✕ 清选择、退出模式
  barButton("✕").click()
  await tick(20)
  togglePickMode()
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("挑格模式下快速双击 = 取消这一格的勾选", async () => {
  const selectedCount = () =>
    document.querySelectorAll(".cell.selected, .cell-input.selected").length
  const bar = () => document.querySelector<HTMLElement>(".pick-bar")!

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(1))
  expect(selectedCount()).toBe(2)

  // 快速双击已选的第 1 格 → 取消它（不是"取消又选上"）
  pick(cellAt(0))
  pick(cellAt(0))
  await tick(10)
  expect(selectedCount()).toBe(1)
  expect(cellAt(0).classList.contains("selected")).toBe(false)
  expect(bar().hidden).toBe(false)

  // 快速双击没选的格子 → 只算一次点击 = 选上
  pick(cellAt(2))
  pick(cellAt(2))
  await tick(10)
  expect(selectedCount()).toBe(2)
  expect(cellAt(2).classList.contains("selected")).toBe(true)

  togglePickMode()
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("成组时：选中格里不合约束的字直接被清空", async () => {
  const bar = () => document.querySelector<HTMLElement>(".pick-bar")!
  const barButton = (text: string) =>
    Array.from(bar().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === text,
    )!

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  // 第 1 格「东」（中东）；第 3 格「江」（江阳，不合，应被清空）
  cellAt(0).click()
  await tick(20)
  let inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "东"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  cellAt(2).click()
  await tick(20)
  inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="2"]')!
  inp.value = "江"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  expect(cellText(cellAt(2))).toBe("江")

  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)
  barButton("成组").click()
  await tick(40)
  const dialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(statusText()).toContain("已清空")
  expect(cellText(cellAt(2))).toBe("")
  expect(cellText(cellAt(0))).toBe("东")
  expect(cellAt(0).classList.contains("group-member")).toBe(true)

  // 收尾：解散这个组（别留给后面的用例）——走徽章
  togglePickMode()
  await tick(10)
  cellAt(0).click()
  await tick(20)
  document.querySelector<HTMLElement>(".sentence .rhyme-badge")!.click()
  await tick(30)
  const lockDialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  Array.from(lockDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "解散这个韵组")!
    .click()
  await tick(40)
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("模式没开但有选中（⌘A）：按 G 也收起（只清选择）", async () => {
  const selectedCount = () =>
    document.querySelectorAll(".cell.selected, .cell-input.selected").length

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
  )
  await tick(20)
  expect(selectedCount()).toBeGreaterThan(0)
  expect(document.body.classList.contains("pick-mode")).toBe(false)

  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true }))
  await tick(20)
  expect(selectedCount()).toBe(0)
})

it("跨句韵组：光标进组 → 两句的成员整格亮；光标离开 → 全都不亮", async () => {
  const barButton = (text: string) =>
    Array.from(
      document.querySelector<HTMLElement>(".pick-bar")!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === text)!
  const litCount = () => document.querySelectorAll(".cell.group-lit, .cell-input.group-lit").length
  // 每次点击都会重渲染整句：一律实时查询，别存旧引用
  const sentenceAt = (index: number) => document.querySelectorAll<HTMLElement>(".sentence")[index]!
  const cellOf = (sentenceIndex: number, cellIndex: number) =>
    sentenceAt(sentenceIndex).querySelector<HTMLElement>(
      `.cell[data-index="${cellIndex}"], .cell-input[data-index="${cellIndex}"]`,
    )!

  // 清场：先解散可能遗留的组（⌘A 全选 → 浮动条「解散」），再清选择
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
  )
  await tick(20)
  const cleanupBar = document.querySelector<HTMLElement>(".pick-bar")!
  if (!cleanupBar.hidden) {
    Array.from(cleanupBar.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "解散")!
      .click()
    await tick(40)
  }
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  expect(document.querySelectorAll(".sentence").length).toBeGreaterThan(1)

  // 第 1 句第 1 格「东」；第 2 句第 1 格「中」（都是中东辙）
  cellOf(0, 0).click()
  await tick(20)
  let inp = sentenceAt(0).querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "东"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  cellOf(1, 0).click()
  await tick(20)
  inp = sentenceAt(1).querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "中"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)

  // 挑两句各一格 → 成组
  togglePickMode()
  pick(cellOf(0, 0))
  pick(cellOf(1, 0))
  await tick(20)
  barButton("成组").click()
  await tick(40)
  const dialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  togglePickMode()
  await tick(10)
  expect(cellOf(0, 0).classList.contains("group-member")).toBe(true)
  expect(cellOf(1, 0).classList.contains("group-member")).toBe(true)

  // 光标先离开组（点第 1 句的第 2 格，非成员）→ 一句都不亮
  cellOf(0, 1).click()
  await tick(20)
  expect(litCount()).toBe(0)

  // 光标在同句内挪进组（点第 1 句第 1 格）→ 第 2 句的成员也必须一起亮（跨句同步）
  cellOf(0, 0).click()
  await tick(20)
  expect(cellOf(0, 0).classList.contains("group-lit")).toBe(true)
  expect(cellOf(1, 0).classList.contains("group-lit")).toBe(true)
  expect(litCount()).toBe(2)

  // 光标再离开 → 全都不亮
  cellOf(1, 1).click()
  await tick(20)
  expect(litCount()).toBe(0)

  // 收尾：解散这个组（走徽章）
  cellOf(0, 0).click()
  await tick(20)
  sentenceAt(0).querySelector<HTMLElement>(".rhyme-badge")!.click()
  await tick(30)
  const lockDialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  Array.from(lockDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "解散这个韵组")!
    .click()
  await tick(40)
  expect(cellOf(0, 0).classList.contains("group-member")).toBe(false)
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("韵组总览：状态栏计数、列表、定位、解散", async () => {
  const chip = () => document.querySelector<HTMLElement>("#status-groups")!
  const groupCount = () =>
    document.querySelectorAll(".cell.group-member, .cell-input.group-member").length

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  // 填「东」「风」→ 成组
  cellAt(0).click()
  await tick(20)
  let inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "东"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  cellAt(2).click()
  await tick(20)
  inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="2"]')!
  inp.value = "风"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)
  Array.from(document.querySelector<HTMLElement>(".pick-bar")!.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "成组")!
    .click()
  await tick(40)
  const buildDialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(buildDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(groupCount()).toBeGreaterThan(0)
  togglePickMode()
  await tick(10)

  // 状态栏计数 + 打开总览
  expect(chip().textContent).toContain("韵组 1")
  chip().click()
  await tick(30)
  const dialog = document.querySelector<HTMLDialogElement>(".rhyme-groups-dialog")!
  expect(dialog.textContent).toContain("韵组 · 1 组")
  const rows = dialog.querySelectorAll<HTMLElement>(".rhyme-group-row")
  expect(rows.length).toBe(1)
  expect(rows[0].textContent).toContain("中东辙")
  expect(rows[0].textContent).toContain("第 1 句")
  expect(rows[0].textContent).toContain("东")
  expect(rows[0].textContent).toContain("风")

  // 定位：弹窗关闭、光标挪到第一格
  Array.from(rows[0].querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "定位")!
    .click()
  await tick(30)
  expect(document.querySelector(".rhyme-groups-dialog")).toBeNull()
  expect(sentence0().querySelector('.cell-input[data-index="0"]')).toBeTruthy()

  // 成员位置是小按钮：每个格子一个（「1格·东」「3格·风」）→ 点它跳那一格
  chip().click()
  await tick(30)
  const dialogLinks = document.querySelector<HTMLDialogElement>(".rhyme-groups-dialog")!
  const cellButtons = Array.from(dialogLinks.querySelectorAll<HTMLButtonElement>(".rhyme-group-cell-button"))
  expect(cellButtons.map((button) => button.textContent).join("|")).toBe("1格·东|3格·风")
  // 点「3格·风」→ 关弹窗 + 光标跳到第 3 格
  cellButtons[1]!.click()
  await tick(30)
  expect(document.querySelector(".rhyme-groups-dialog")).toBeNull()
  expect(sentence0().querySelector('.cell-input[data-index="2"]')).toBeTruthy()

  // 再开 → 行内解散
  chip().click()
  await tick(30)
  const dialog2 = document.querySelector<HTMLDialogElement>(".rhyme-groups-dialog")!
  Array.from(dialog2.querySelectorAll<HTMLButtonElement>(".rhyme-group-row button"))
    .find((button) => button.textContent === "解散")!
    .click()
  await tick(40)
  expect(groupCount()).toBe(0)
  expect(chip().textContent).toContain("韵组 0")
  expect(dialog2.textContent).toContain("还没有韵组")
  Array.from(dialog2.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "关闭")!
    .click()
  await tick(20)
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("浮动条跟着最后挑中的那格走；滚出视野贴边不消失", async () => {
  const bar = () => document.querySelector<HTMLElement>(".pick-bar")!
  const rectOf = (top: number) =>
    ({
      top,
      bottom: top + 54,
      left: 100,
      right: 154,
      width: 54,
      height: 54,
      x: 100,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  const el0 = cellAt(0)
  const el1 = cellAt(1)
  el0.getBoundingClientRect = () => rectOf(100)
  el1.getBoundingClientRect = () => rectOf(600)

  togglePickMode()
  pick(el0)
  await tick(10)
  expect(bar().hidden).toBe(false)
  expect(bar().style.top).toBe("62px")

  pick(el1)
  await tick(10)
  expect(bar().style.top).toBe("562px")

  // 锚点格滚出视野：贴窗口底部，不消失
  el1.getBoundingClientRect = () => rectOf(900)
  window.dispatchEvent(new Event("scroll"))
  await tick(10)
  expect(bar().hidden).toBe(false)
  expect(bar().style.top).toBe(`${window.innerHeight - 40}px`)

  // 取消锚点格（等过双击窗口，避免被当成双击"只算一次点击"）→ 回落到其它选中格
  await tick(600)
  pick(el1)
  await tick(10)
  expect(el1.classList.contains("selected")).toBe(false)
  expect(bar().style.top).toBe("62px")

  togglePickMode()
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})

it("点总览里的约束 → 编辑韵组：改约束、成员不动、新约束生效", async () => {
  const chip = () => document.querySelector<HTMLElement>("#status-groups")!
  const groupCount = () =>
    document.querySelectorAll(".cell.group-member, .cell-input.group-member").length

  // 清场
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)

  // 填「东」「风」→ 建组（中东辙）
  cellAt(0).click()
  await tick(20)
  let inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "东"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  cellAt(2).click()
  await tick(20)
  inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="2"]')!
  inp.value = "风"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  togglePickMode()
  pick(cellAt(0))
  pick(cellAt(2))
  await tick(20)
  Array.from(document.querySelector<HTMLElement>(".pick-bar")!.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "成组")!
    .click()
  await tick(40)
  const buildDialog = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  Array.from(buildDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "建立韵组")!
    .click()
  await tick(40)
  expect(groupCount()).toBeGreaterThan(0)

  // 总览里点约束 → 编辑韵组（预填现有约束）
  chip().click()
  await tick(30)
  const overview = document.querySelector<HTMLDialogElement>(".rhyme-groups-dialog")!
  // 打开时焦点在标题上，不在按钮上（不然约束按钮会一直顶着焦点圈）
  expect(document.activeElement).toBe(overview.querySelector(".dialog-drag-handle"))
  const constraintBtn = overview.querySelector<HTMLButtonElement>(".rhyme-group-constraint")!
  expect(constraintBtn.textContent).toContain("中东辙")
  constraintBtn.click()
  await tick(30)

  const edit = document.querySelector<HTMLDialogElement>(".rhyme-group-dialog")!
  expect(edit.textContent).toContain("编辑韵组")
  const rhySelect = edit.querySelector<HTMLSelectElement>("select")!
  expect(rhySelect.value).toBe("zhongdong")
  rhySelect.value = "jiangyang"
  Array.from(edit.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "保存")!
    .click()
  await tick(40)

  // 汇报 + 总览重开显示新约束 + 成员没动
  expect(statusText()).toContain("已更新韵组约束")
  expect(statusText()).toContain("江阳")
  const overview2 = document.querySelector<HTMLDialogElement>(".rhyme-groups-dialog")!
  expect(overview2.querySelector(".rhyme-group-constraint")!.textContent).toContain("江阳辙")
  expect(cellText(cellAt(0))).toBe("东")
  expect(cellText(cellAt(2))).toBe("风")
  expect(groupCount()).toBeGreaterThan(0)

  // 新约束生效：第 1 格打「江」（江阳）→ 放行（旧的"中东"会拦）
  overview2.close("cancel")
  await tick(20)
  cellAt(0).click()
  await tick(20)
  inp = sentence0().querySelector<HTMLInputElement>('.cell-input[data-index="0"]')!
  inp.value = "江"
  inp.dispatchEvent(new Event("input", { bubbles: true }))
  await tick(20)
  expect(cellText(cellAt(0))).toBe("江")

  // 收尾：徽章解散（打字后光标会前进，先点回组里的第 1 格）
  cellAt(0).click()
  await tick(20)
  document.querySelector<HTMLElement>(".sentence .rhyme-badge")!.click()
  await tick(30)
  const lockDialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  Array.from(lockDialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "解散这个韵组")!
    .click()
  await tick(40)
  expect(groupCount()).toBe(0)
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  await tick(10)
})
