import html from "../index.html?raw"
import { beforeAll, describe, expect, it } from "vitest"

function demoMidi(): Uint8Array {
  const vlq = (value: number): number[] => {
    const bytes = [value & 0x7f]
    value >>= 7
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80)
      value >>= 7
    }
    return bytes
  }
  const u16 = (v: number): number[] => [(v >> 8) & 255, v & 255]
  const u32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
  const text = (s: string): number[] => [...new TextEncoder().encode(s)]
  const on = (note: number): number[] => [...vlq(0), 0x90, note, 100]
  const off = (note: number): number[] => [...vlq(240), 0x80, note, 0]
  const data = [
    ...on(60),
    ...off(60),
    ...on(24),
    ...off(24),
    ...on(62),
    ...off(62),
    ...vlq(0),
    0xff,
    0x2f,
    0,
  ]
  return new Uint8Array([
    ...text("MThd"),
    ...u32(6),
    ...u16(1),
    ...u16(1),
    ...u16(480),
    ...text("MTrk"),
    ...u32(data.length),
    ...data,
  ])
}

describe("网页环境", () => {
  beforeAll(async () => {
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
    document.body.innerHTML = body
    await import("./main")
  })

  it("能加载主程序，AI 按钮禁用；工具栏横跨工作区（面板铺满也挡不住）", () => {
    const btn = document.querySelector<HTMLButtonElement>("#btn-ai")
    expect(btn?.disabled).toBe(true)
    expect(document.querySelector("#grid") ?? document.querySelector(".grid")).toBeTruthy()
    expect(document.querySelector(".workbench > .topbar")).toBeTruthy()
    expect(document.querySelector(".workbench-body > .main-col")).toBeTruthy()
  })

  it("「导入 → 选择 MIDI…」会关掉导入弹窗，不留两层", async () => {
    document.querySelector<HTMLButtonElement>("#btn-import-lyrics")!.click()
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")
    expect(dialog).toBeTruthy()
    const midiBtn = Array.from(dialog!.querySelectorAll("button")).find(
      (button) => button.textContent === "选择 MIDI…",
    )!
    midiBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector("dialog[open]")).toBeNull()
  })

  it("开着弹窗时拖入 MIDI：先收掉旧弹窗，导入完成后不残留", async () => {
    document.querySelector<HTMLButtonElement>("#btn-import-lyrics")!.click()
    expect(document.querySelectorAll("dialog[open]").length).toBe(1)

    const file = new File([new Uint8Array(demoMidi())], "demo.mid")
    const event = new Event("drop", { bubbles: true }) as Event & { dataTransfer?: unknown }
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [file] } })
    window.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const dialogs = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"))
    expect(dialogs.length).toBe(1)
    expect(dialogs[0].textContent).toContain("导入 MIDI")
    expect(dialogs[0].textContent).toContain("demo.mid")

    const ok = Array.from(dialogs[0].querySelectorAll("button")).find(
      (button) => button.textContent === "导入",
    )!
    ok.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector("dialog[open]")).toBeNull()
  })

  it("查找替换：计数 → 替换一处 → 全曲替换 → 变长自动插格子", async () => {
    document.querySelector<HTMLButtonElement>("#btn-import-lyrics")!.click()
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
    dialog.querySelector("textarea")!.value = "人间 天上\n人间 云间"
    const importOk = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "导入",
    )!
    importOk.click()
    await new Promise((resolve) => setTimeout(resolve, 30))

    document.querySelector<HTMLButtonElement>("#btn-find")!.click()
    const findInput = document.querySelector<HTMLInputElement>(".find-input")!
    const replaceInput = document.querySelector<HTMLInputElement>(".find-replace")!
    const count = (): string => document.querySelector(".find-count")!.textContent ?? ""
    findInput.value = "间"
    findInput.dispatchEvent(new Event("input"))
    expect(count()).toBe("1/3")

    replaceInput.value = "内"
    document.querySelector<HTMLButtonElement>(".find-replace-one")!.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(count()).toBe("1/2")

    document.querySelector<HTMLButtonElement>(".find-replace-all")!.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(count()).toBe("0/0")

    const cellCount = (index: number): number =>
      document.querySelectorAll(".sentence")[index].querySelectorAll(".cell, .cell-input").length
    expect(cellCount(0)).toBe(4)
    expect(cellCount(1)).toBe(4)

    findInput.value = "云"
    findInput.dispatchEvent(new Event("input"))
    replaceInput.value = "月牙"
    document.querySelector<HTMLButtonElement>(".find-replace-one")!.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(cellCount(1)).toBe(5)
    document.querySelector<HTMLButtonElement>(".find-close")!.click()
    expect(document.querySelector(".find-panel")!.hasAttribute("hidden")).toBe(true)
  })
})

it("MIDI 导入的元数据防护：识别不到就清空旧的歌名 / 原文 / 创作信息", async () => {
  const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const titleInput = () =>
    document.querySelector<HTMLInputElement>("#project-title")!.value

  // 先用文本导入造出"上一首"的歌名、原文、创作信息
  document.querySelector<HTMLButtonElement>("#btn-import-lyrics")!.click()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  dialog.querySelector("textarea")!.value = "《旧歌名》\n作词：某人\n真的 假的"
  Array.from(dialog.querySelectorAll("button"))
    .find((button) => button.textContent === "导入")!
    .click()
  await tick(30)
  expect(titleInput()).toBe("旧歌名")
  expect(document.querySelector<HTMLElement>("#btn-source")!.hidden).toBe(false)
  expect(document.querySelector<HTMLElement>("#btn-credits")!.hidden).toBe(false)

  // 再拖入一个没有轨名 / 版权的 MIDI → 旧的歌名 / 原文 / 创作信息都应被清掉
  const file = new File([new Uint8Array(demoMidi())], "demo.mid")
  const event = new Event("drop", { bubbles: true }) as Event & { dataTransfer?: unknown }
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [file] } })
  window.dispatchEvent(event)
  await tick(30)
  const midiDialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  Array.from(midiDialog.querySelectorAll("button"))
    .find((button) => button.textContent === "导入")!
    .click()
  await tick(30)

  expect(titleInput()).toBe("未命名歌曲")
  expect(document.querySelector<HTMLElement>("#btn-source")!.hidden).toBe(true)
  expect(document.querySelector<HTMLElement>("#btn-credits")!.hidden).toBe(true)
})
