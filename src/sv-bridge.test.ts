import { beforeAll, describe, expect, it, vi } from "vitest"
import { createProject, createSection, createSentence, setCells } from "./state"
import {
  callBridge,
  formatBridgeRequest,
  orderedChars,
  parseBridgeLines,
  readBridgeState,
} from "./sv-bridge"

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (path: string, text: string) => {
    store.set(path, text)
    // 模拟 SV2 那边的后台脚本：收到 request 就回一条（同 seq）
    if (path.endsWith("request.txt")) {
      const parsed = parseBridgeLines(text)
      if (parsed.cmd === "fillLyrics") {
        const responsePath = path.replace(/request\.txt$/, "response.txt")
        store.set(
          responsePath,
          `seq=${parsed.seq}\nok=1\nmatched=3\nsvNotes=5\nourChars=4\noverlap=0\nnote=已替换 3 个字\n`,
        )
      }
    }
  }),
  readTextFile: vi.fn(async (path: string) => {
    if (path.endsWith("state.txt")) {
      return "updated=9999999999\nproject=demo.svp\nsvNotes=7\nchars=曾也是\n"
    }
    return store.get(path) ?? ""
  }),
}))

vi.mock("@tauri-apps/api/path", () => ({
  localDataDir: vi.fn(async () => "BRIDGE"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}))

beforeAll(() => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
})

describe("sv-bridge（和 SV2 的行协议 + 信箱）", () => {
  it("orderedChars：按顺序拼「填了字的格子」，忽略空格子", () => {
    const s1 = createSentence([2, 2])
    setCells(s1, ["一", "缕", "", "晖"])
    const s2 = createSentence([2])
    setCells(s2, ["孤", "云"])
    const project = { ...createProject(), sections: [createSection("段落 1", [s1, s2])] }
    expect(orderedChars(project)).toBe("一缕晖孤云")
  })

  it("行协议：formatBridgeRequest 发出去、parseBridgeLines 收回来", () => {
    const text = formatBridgeRequest("123", "fillLyrics", { chars: "一缕", dry: "1" })
    expect(parseBridgeLines(text)).toEqual({ seq: "123", cmd: "fillLyrics", chars: "一缕", dry: "1" })
  })

  it("callBridge：发请求，等到同一 seq 的回信", async () => {
    const resp = await callBridge("fillLyrics", { chars: "一缕王朝", dry: "0" }, 2000)
    expect(resp).toEqual({
      ok: true,
      note: "已替换 3 个字",
      dry: false,
      overlap: false,
      matched: 3,
      svNotes: 5,
      ourChars: 4,
    })
  })

  it("callBridge：没人回信就超时返回 null（脚本没在跑）", async () => {
    // 用 mock 不会回的命令（模拟脚本没在跑）
    const resp = await callBridge("ping", {}, 300)
    expect(resp).toBeNull()
  })

  it("readBridgeState：读 SV2 脚本上报的状态", async () => {
    const state = await readBridgeState()
    expect(state?.project).toBe("demo.svp")
    expect(state?.svNotes).toBe(7)
    expect(state?.chars).toBe("曾也是")
    expect(state?.running).toBe(true)
  })
})
