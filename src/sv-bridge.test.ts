import { beforeAll, describe, expect, it, vi } from "vitest"
import { createProject, createSection, createSentence, getCells, setCells } from "./state"
import {
  allCellRefs,
  applySvEdits,
  buildSvMapFromRefs,
  callBridge,
  diffSvMap,
  filledCellRefs,
  formatBridgeRequest,
  hasCigeMarks,
  orderedChars,
  parseBridgeLines,
  parseSvNotes,
  readBridgeState,
  svNotesToSections,
} from "./sv-bridge"

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (path: string, text: string) => {
    store.set(path, text)
    // 模拟 SV2 那边的后台脚本：收到 request 就回一条（同 seq）；不认识的不回（清掉旧回信）
    if (path.endsWith("request.txt")) {
      const parsed = parseBridgeLines(text)
      const responsePath = path.replace(/request\.txt$/, "response.txt")
      if (parsed.cmd === "fillLyrics") {
        store.set(
          responsePath,
          `seq=${parsed.seq}\nok=1\nmatched=3\nsvNotes=5\nourChars=4\noverlap=0\nids=t1g1@100,t1g1@200,t1g1@300\nnote=已替换 3 个字\n`,
        )
      } else {
        store.set(responsePath, "")
      }
    }
  }),
  readTextFile: vi.fn(async (path: string) => {
    if (path.endsWith("state.txt")) {
      return "updated=9999999999\nproject=demo.svp\nsvNotes=7\nchars=曾也是\nids=t2g1@11,t2g1@12,t2g1@13\neditSeq=3\nedited=t2g1@12|也|2;t2g1@22|错|3\n"
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
      ids: ["t1g1@100", "t1g1@200", "t1g1@300"],
    })
  })

  it("callBridge：没人回信就超时返回 null（脚本没在跑）", async () => {
    // 用 mock 不会回的命令（模拟脚本没在跑）
    const resp = await callBridge("ping", {}, 300)
    expect(resp).toBeNull()
  })

  it("readBridgeState：读 SV2 脚本上报的状态（含对照表 id / 改字序号 / 改过的字）", async () => {
    const state = await readBridgeState()
    expect(state?.project).toBe("demo.svp")
    expect(state?.svNotes).toBe(7)
    expect(state?.chars).toBe("曾也是")
    expect(state?.running).toBe(true)
    expect(state?.ids).toEqual(["t2g1@11", "t2g1@12", "t2g1@13"])
    expect(state?.editSeq).toBe(3)
    expect(state?.edited).toEqual([
      { id: "t2g1@12", char: "也", seq: 2 },
      { id: "t2g1@22", char: "错", seq: 3 },
    ])
  })
})

describe("格子 ↔ 音符对照表（实时同步用）", () => {
  function demo() {
    const s1 = createSentence([2, 2])
    setCells(s1, ["一", "缕", "", "晖"])
    const s2 = createSentence([2])
    setCells(s2, ["孤", "云"])
    return { project: { ...createProject(), sections: [createSection("段落 1", [s1, s2])] }, s1, s2 }
  }

  it("filledCellRefs 只收带字的格子；allCellRefs 收全部（含空格）", () => {
    const { project, s1, s2 } = demo()
    expect(filledCellRefs(project)).toEqual([
      { sid: s1.id, cell: 0 },
      { sid: s1.id, cell: 1 },
      { sid: s1.id, cell: 3 },
      { sid: s2.id, cell: 0 },
      { sid: s2.id, cell: 1 },
    ])
    expect(allCellRefs(project).length).toBe(6)
    expect(allCellRefs(project)[2]).toEqual({ sid: s1.id, cell: 2 })
  })

  it("buildSvMapFromRefs：格子引用 ↔ id 一一对上，char 记当前的字", () => {
    const { project, s1, s2 } = demo()
    const map = buildSvMapFromRefs(project, filledCellRefs(project), [
      "t1g1@10",
      "t1g1@20",
      "t1g1@30",
      "t1g1@40",
      "t1g1@50",
    ])
    expect(map).toEqual([
      { sid: s1.id, cell: 0, id: "t1g1@10", char: "一" },
      { sid: s1.id, cell: 1, id: "t1g1@20", char: "缕" },
      { sid: s1.id, cell: 3, id: "t1g1@30", char: "晖" },
      { sid: s2.id, cell: 0, id: "t1g1@40", char: "孤" },
      { sid: s2.id, cell: 1, id: "t1g1@50", char: "云" },
    ])
  })

  it("diffSvMap：只有「格子的字 ≠ 上次同步的字」才算要推的", () => {
    const { project, s1 } = demo()
    const map = buildSvMapFromRefs(project, filledCellRefs(project), ["a", "b", "c", "d", "e"])
    expect(diffSvMap(project, map)).toEqual([])
    const cells = getCells(s1)
    cells[1] = "丝"
    setCells(s1, cells)
    expect(diffSvMap(project, map)).toEqual([{ id: "b", char: "丝" }])
  })

  it("applySvEdits：SV 改的字按对照表写回格子；清空/非汉字 → 格子清掉", () => {
    const { project, s1, s2 } = demo()
    const map = buildSvMapFromRefs(project, filledCellRefs(project), ["a", "b", "c", "d", "e"])
    const applied = applySvEdits(project, map, [
      { id: "b", char: "衣" },
      { id: "e", char: "" },
      { id: "zzz", char: "无" },
    ])
    expect(applied).toBe(2)
    expect(getCells(s1)[1]).toBe("衣")
    expect(getCells(s2)[1]).toBe("")
    expect(map.find((entry) => entry.id === "b")?.char).toBe("衣")
    expect(diffSvMap(project, map)).toEqual([])
  })

  it("applySvEdits：`-`（延音）这类非汉字当清空处理", () => {
    const { project, s1 } = demo()
    const map = buildSvMapFromRefs(project, filledCellRefs(project), ["a", "b", "c", "d", "e"])
    const applied = applySvEdits(project, map, [{ id: "a", char: "-" }])
    expect(applied).toBe(1)
    expect(getCells(s1)[0]).toBe("")
  })
})

describe("SV 音符解析 + 按「词格酱」标记重建词格", () => {
  it("parseSvNotes：onset/end/pitch/track/lyric", () => {
    expect(parseSvNotes("100\t200\t60\t1\t刃\n300\t400\t62\t1\t断\n")).toEqual([
      { onset: 100, end: 200, pitch: 60, track: 1, lyric: "刃" },
      { onset: 300, end: 400, pitch: 62, track: 1, lyric: "断" },
    ])
  })

  it("parseSvNotes：带第 6 列（音符身份证）时解析出 id", () => {
    expect(parseSvNotes("100\t200\t60\t1\t刃\tt1g1@100\n")).toEqual([
      { onset: 100, end: 200, pitch: 60, track: 1, lyric: "刃", id: "t1g1@100" },
    ])
  })

  it("有标记 + 带身份证：重建的词格带上 id（和格子一一对齐）", () => {
    const notes = parseSvNotes(
      [
        "0\t10\t60\t1\t一\tt1g1@0",
        "10\t20\t60\t1\t二\tt1g1@10",
        "20\t30\t24\t1\t\tt1g1@20", // C0 分格
        "30\t40\t60\t1\t三\tt1g1@30",
      ].join("\n"),
    )
    expect(svNotesToSections(notes)).toEqual([
      {
        name: "",
        lines: [{ pattern: [2, 1], cells: ["一", "二", "三"], ids: ["t1g1@0", "t1g1@10", "t1g1@30"] }],
      },
    ])
  })

  it("有标记：D0 换段、C#0 换句、C0 分格（空的不生成）", () => {
    const notes = parseSvNotes(
      [
        "0\t10\t60\t1\t一",
        "10\t20\t60\t1\t二",
        "20\t30\t24\t1\t", // C0 分格
        "30\t40\t60\t1\t三",
        "40\t50\t25\t1\t", // C#0 换句
        "50\t60\t60\t1\t四",
        "60\t70\t26\t1\t", // D0 换段
        "70\t80\t60\t1\t五",
      ].join("\n"),
    )
    expect(hasCigeMarks(notes)).toBe(true)
    expect(svNotesToSections(notes)).toEqual([
      {
        name: "",
        lines: [
          { pattern: [2, 1], cells: ["一", "二", "三"] },
          { pattern: [1], cells: ["四"] },
        ],
      },
      { name: "", lines: [{ pattern: [1], cells: ["五"] }] },
    ])
  })

  it("没标记：hasCigeMarks=false；`-` 延音不占格", () => {
    const notes = parseSvNotes("0\t10\t60\t1\t一\n10\t20\t62\t1\t-")
    expect(hasCigeMarks(notes)).toBe(false)
    expect(svNotesToSections(notes)).toEqual([
      { name: "", lines: [{ pattern: [1], cells: ["一"] }] },
    ])
  })
})
