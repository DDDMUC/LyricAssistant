import { describe, expect, it } from "vitest"
import {
  buildLyricMidi,
  keyswitchCount,
  midiToSections,
  noteTracks,
  parseMidi,
  pickMelodyTrack,
} from "./midi"

function vlq(value: number): number[] {
  const bytes = [value & 0x7f]
  value >>= 7
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80)
    value >>= 7
  }
  return bytes
}

const u16 = (value: number): number[] => [(value >> 8) & 255, value & 255]
const u32 = (value: number): number[] => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
]
const text = (value: string): number[] => [...new TextEncoder().encode(value)]
const meta = (delta: number, type: number, data: number[]): number[] => [
  ...vlq(delta),
  0xff,
  type,
  ...vlq(data.length),
  ...data,
]
const on = (delta: number, note: number, channel = 0): number[] => [
  ...vlq(delta),
  0x90 | channel,
  note,
  100,
]
const off = (delta: number, note: number, channel = 0): number[] => [
  ...vlq(delta),
  0x80 | channel,
  note,
  0,
]

function build(tracksEvents: number[][][], division = 480): Uint8Array {
  const header = [
    ...text("MThd"),
    ...u32(6),
    ...u16(1),
    ...u16(tracksEvents.length),
    ...u16(division),
  ]
  const body = tracksEvents.flatMap((events) => {
    const data = events.flat()
    return [...text("MTrk"), ...u32(data.length), ...data]
  })
  return new Uint8Array([...header, ...body])
}

const melody = [
  on(0, 60),
  off(480, 60),
  on(0, 62),
  off(480, 62),
  on(240, 64),
  off(480, 64),
  on(0, 65),
  off(480, 65),
  on(480, 67),
  off(480, 67),
  on(0, 69),
  off(480, 69),
  meta(0, 0x2f, []),
]

describe("parseMidi", () => {
  it("读音符、轨名与 meta", () => {
    const bytes = build([[meta(0, 0x03, text("Vocal")), ...melody]])
    const file = parseMidi(bytes)
    expect(file.division).toBe(480)
    expect(file.tracks).toHaveLength(1)
    expect(file.tracks[0].name).toBe("Vocal")
    expect(file.tracks[0].notes.map((note) => note.start)).toEqual([
      0, 480, 1200, 1680, 2640, 3120,
    ])
    expect(file.tracks[0].notes.every((note) => note.dur === 480)).toBe(true)
  })

  it("支持 running status", () => {
    const events: number[][] = [
      [...vlq(0), 0x90, 60, 100],
      [...vlq(480), 60, 0],
      [...vlq(0), 62, 100],
      [...vlq(480), 62, 0],
      meta(0, 0x2f, []),
    ]
    const file = parseMidi(build([events]))
    expect(file.tracks[0].notes.map((note) => note.midi)).toEqual([60, 62])
  })
})

describe("midiToSections", () => {
  it("按休止换句、短休止分句，一个音符一格", () => {
    const file = parseMidi(build([melody]))
    const sections = midiToSections(file)
    expect(sections).toHaveLength(1)
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[2, 2], [2]])
    expect(sections[0].lines[0].cells).toEqual(["", "", "", ""])
  })

  it("Marker 分段落，名字取标记文字", () => {
    const file = parseMidi(
      build([
        [
          meta(0, 0x06, text("主歌")),
          meta(2640, 0x06, text("副歌")),
          meta(0, 0x2f, []),
        ],
        melody,
      ]),
    )
    const sections = midiToSections(file)
    expect(sections.map((section) => section.name)).toEqual(["主歌", "副歌"])
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[2, 2]])
    expect(sections[1].lines.map((line) => line.pattern)).toEqual([[2]])
  })

  it("休止阈值可调；0 表示不换句", () => {
    const file = parseMidi(build([melody]))
    const sections = midiToSections(file, { sentenceRestBeats: 0 })
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[2, 2, 2]])
  })

  it("读 Lyric meta 填进格子", () => {
    const events = [
      meta(0, 0x05, text("一")),
      on(0, 60),
      off(480, 60),
      meta(0, 0x05, text("夜")),
      on(0, 62),
      off(480, 62),
      meta(240, 0x2f, []),
    ]
    const file = parseMidi(build([events]))
    const sections = midiToSections(file)
    expect(sections[0].lines[0].cells).toEqual(["一", "夜"])
  })

  it("鼓轨（第 10 通道）不计入", () => {
    const file = parseMidi(
      build([
        [on(0, 60), off(480, 60), on(0, 38, 9), off(480, 38, 9), meta(0, 0x2f, [])],
      ]),
    )
    const sections = midiToSections(file)
    expect(sections[0].lines[0].pattern).toEqual([1])
  })
})

describe("pickMelodyTrack", () => {
  it("优先名字像人声的轨，否则取音符最多的", () => {
    const piano = [on(0, 60), off(480, 60), on(0, 62), off(480, 62), on(0, 64), off(480, 64), meta(0, 0x2f, [])]
    const vocal = [meta(0, 0x03, text("Vocal")), on(0, 72), off(480, 72), meta(0, 0x2f, [])]
    const file = parseMidi(build([piano, vocal]))
    expect(noteTracks(file).map((track) => track.count)).toEqual([3, 1])
    expect(pickMelodyTrack(file)).toBe(1)

    const unnamed = parseMidi(build([piano, [on(0, 72), off(480, 72), meta(0, 0x2f, [])]]))
    expect(pickMelodyTrack(unnamed)).toBe(0)
  })
})

describe("buildLyricMidi", () => {
  it("把字写进 Lyric 事件、替换旧歌词，音符与标记不变", () => {
    const file = parseMidi(
      build([
        [meta(0, 0x06, text("主歌")), meta(0, 0x2f, [])],
        [meta(0, 0x05, text("旧")), ...melody],
      ]),
    )
    const bytes = buildLyricMidi(file, 1, ["一", "夜", "", "春", "风", ""])
    const again = parseMidi(bytes)
    expect(again.tracks[0].markers[0].text).toBe("主歌")
    expect(again.tracks[1].lyrics.map((event) => event.text)).toEqual([
      "一",
      "夜",
      "",
      "春",
      "风",
      "",
    ])
    expect(again.tracks[1].notes.map((note) => note.start)).toEqual([
      0, 480, 1200, 1680, 2640, 3120,
    ])

    const twice = parseMidi(buildLyricMidi(again, 1, ["你", "好", "", "", "", ""]))
    expect(twice.tracks[1].lyrics.map((event) => event.text)).toEqual([
      "你",
      "好",
      "",
      "",
      "",
      "",
    ])
  })
})

const keyswitchMelody = [
  on(0, 60),
  off(240, 60),
  on(0, 62),
  off(240, 62),
  on(0, 24),
  off(30, 24),
  on(0, 64),
  off(240, 64),
  on(0, 25),
  off(30, 25),
  on(0, 65),
  off(240, 65),
  on(0, 26),
  off(30, 26),
  on(0, 67),
  off(240, 67),
  meta(0, 0x2f, []),
]

describe("keyswitch 兼容（词格酱 C0/C#0/D0）", () => {
  it("自动模式识别标记：C0 分句、C#0 换句、D0 换段", () => {
    const file = parseMidi(build([keyswitchMelody]))
    expect(keyswitchCount(file, 0)).toBe(3)
    const sections = midiToSections(file)
    expect(sections.map((section) => section.lines.map((line) => line.pattern))).toEqual([
      [[2, 1], [1]],
      [[1]],
    ])
  })

  it("两个标记之间没音符就不生成空组/空句", () => {
    const file = parseMidi(
      build([
        [
          on(0, 25),
          off(30, 25),
          on(0, 25),
          off(30, 25),
          on(0, 24),
          off(30, 24),
          on(0, 60),
          off(240, 60),
          meta(0, 0x2f, []),
        ],
      ]),
    )
    const sections = midiToSections(file)
    expect(sections).toHaveLength(1)
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[1]])
  })

  it("强制休止模式时标记音当普通音符（用户明确选择）", () => {
    const file = parseMidi(build([keyswitchMelody]))
    const sections = midiToSections(file, { mode: "rest" })
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[8]])
  })

  it("没有标记的普通 MIDI 在自动模式下走原来的休止逻辑", () => {
    const file = parseMidi(build([melody]))
    const sections = midiToSections(file, { mode: "auto" })
    expect(sections[0].lines.map((line) => line.pattern)).toEqual([[2, 2], [2]])
  })

  it("导出跳过标记音，歌词挂在唱歌的音上；可选整个去掉标记音", () => {
    const file = parseMidi(build([keyswitchMelody]))
    const lyrics = ["一", "二", "三", "四"]
    const bytes = buildLyricMidi(file, 0, lyrics, { skipPitches: [24, 25, 26] })
    const again = parseMidi(bytes)
    expect(again.tracks[0].lyrics.map((event) => event.text)).toEqual([...lyrics, ""])
    expect(again.tracks[0].lyrics.map((event) => event.tick)).toEqual([0, 240, 510, 780, 1050])
    expect(again.tracks[0].notes.some((note) => note.midi === 24)).toBe(true)

    const stripped = parseMidi(
      buildLyricMidi(file, 0, lyrics, { skipPitches: [24, 25, 26], stripMarkers: true }),
    )
    expect(stripped.tracks[0].notes.map((note) => note.midi)).toEqual([60, 62, 64, 65, 67])
    expect(stripped.tracks[0].lyrics.map((event) => event.text)).toEqual([...lyrics, ""])
  })
})
