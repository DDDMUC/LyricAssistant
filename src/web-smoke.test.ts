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

  it("能加载主程序，AI 按钮禁用", () => {
    const btn = document.querySelector<HTMLButtonElement>("#btn-ai")
    expect(btn?.disabled).toBe(true)
    expect(document.querySelector("#grid") ?? document.querySelector(".grid")).toBeTruthy()
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
})
