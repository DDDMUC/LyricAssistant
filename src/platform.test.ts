import { afterEach, describe, expect, it } from "vitest"
import {
  acceptAttr,
  baseName,
  canOverwriteInPlace,
  isDesktop,
  mimeFor,
  saveStrategy,
  saveBytes,
  saveText,
  sourceFromFile,
} from "./platform"

afterEach(() => {
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker
  Object.defineProperty(window, "isSecureContext", { value: undefined, configurable: true })
})

describe("platform", () => {
  it("isDesktop 认 Tauri 环境标记", () => {
    expect(isDesktop()).toBe(false)
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(isDesktop()).toBe(true)
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    expect(isDesktop()).toBe(false)
  })

  it("baseName 兼容两种分隔符", () => {
    expect(baseName("/Users/a/我的歌.json")).toBe("我的歌.json")
    expect(baseName("C:\\Songs\\demo.mid")).toBe("demo.mid")
    expect(baseName("demo.txt")).toBe("demo.txt")
  })

  it("acceptAttr / mimeFor", () => {
    expect(acceptAttr(["txt", "lrc"])).toBe(".txt,.lrc")
    expect(acceptAttr(["*"])).toBe("")
    expect(mimeFor(["json"])).toBe("application/json")
    expect(mimeFor(["mid", "midi"])).toBe("audio/midi")
    expect(mimeFor(["weird"])).toBe("application/octet-stream")
  })

  it("saveStrategy：另存为优先选位置，其次覆盖，再下载", () => {
    expect(saveStrategy(null, false, true)).toBe("picker")
    expect(saveStrategy(null, false, false)).toBe("download")
    expect(saveStrategy(null, true, true)).toBe("picker")
    expect(saveStrategy(null, true, false)).toBe("download")
    const handle = {
      name: "a.json",
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    }
    expect(saveStrategy({ kind: "webfile", name: "a.json", handle }, false, true)).toBe("overwrite")
    expect(saveStrategy({ kind: "webfile", name: "a.json", handle }, true, true)).toBe("picker")
    expect(saveStrategy({ kind: "download", name: "a.json" }, false, true)).toBe("download")
  })

  it("sourceFromFile 读取文本和字节", async () => {
    const file = {
      name: "词.txt",
      text: async () => "北望去",
      arrayBuffer: async () => new TextEncoder().encode("北望去").buffer,
    } as unknown as File
    const source = sourceFromFile(file)
    expect(source.name).toBe("词.txt")
    expect(await source.readText()).toBe("北望去")
    expect([...(await source.readBytes())]).toEqual([...new TextEncoder().encode("北望去")])
  })

  it("网页版没有保存选择器时不能就地覆盖", () => {
    expect(canOverwriteInPlace()).toBe(false)
  })

  it("网页版没有保存选择器：保存退回下载", async () => {
    URL.createObjectURL = () => "blob:test"
    URL.revokeObjectURL = () => {}
    const saved = await saveText({
      suggestedName: "歌词.txt",
      description: "歌词文本",
      extensions: ["txt"],
      contents: "北望去",
    })
    expect(saved).toEqual({ kind: "download", name: "歌词.txt" })
  })

  it("网页版有保存选择器：写进句柄，再保存时原地覆盖", async () => {
    let written = ""
    const handle = {
      name: "我的歌.json",
      createWritable: async () => ({
        write: async (data: unknown) => {
          written = String(data)
        },
        close: async () => {},
      }),
    }
    ;(window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => handle
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true })
    expect(canOverwriteInPlace()).toBe(true)
    const saved = await saveText({
      suggestedName: "我的歌.json",
      description: "词格工程",
      extensions: ["json"],
      contents: JSON.stringify({ a: 1 }),
    })
    expect(saved?.kind).toBe("webfile")
    expect(written).toBe('{"a":1}')

    written = ""
    const again = await saveText({
      suggestedName: "我的歌.json",
      description: "词格工程",
      extensions: ["json"],
      contents: "覆盖内容",
      target: saved,
    })
    expect(again).toBe(saved)
    expect(written).toBe("覆盖内容")
  })

  it("saveBytes 在网页版同样能下载二进制", async () => {
    URL.createObjectURL = () => "blob:test"
    URL.revokeObjectURL = () => {}
    const saved = await saveBytes({
      suggestedName: "demo.mid",
      description: "MIDI 文件",
      extensions: ["mid"],
      bytes: new Uint8Array([1, 2, 3]),
    })
    expect(saved).toEqual({ kind: "download", name: "demo.mid" })
  })
})
