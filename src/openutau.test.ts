import { describe, expect, it } from "vitest"
import { fillUstx, orderOuNotes, parseUstx, readUstxLyrics } from "./openutau"

const NO_OVERLAP = `name: demo
ustx_version: "0.6"
resolution: 480
tracks:
  - track_name: main
    mute: false
  - track_name: harm
    mute: false
  - track_name: muted
    mute: true
voice_parts:
  - name: main-part
    track_no: 0
    position: 0
    notes:
      - position: 0
        duration: 480
        tone: 60
        lyric: la
      - position: 480
        duration: 480
        tone: 62
        lyric: "-"
      - position: 960
        duration: 480
        tone: 64
        lyric: la
  - name: harm-part
    track_no: 1
    position: 480
    notes:
      - position: 0
        duration: 480
        tone: 55
        lyric: la
  - name: muted-part
    track_no: 2
    position: 0
    notes:
      - position: 0
        duration: 480
        tone: 50
        lyric: la
`

const OVERLAP = `name: demo
ustx_version: "0.6"
tracks:
  - track_name: main
  - track_name: harm
voice_parts:
  - track_no: 0
    position: 0
    notes:
      - position: 0
        duration: 480
        tone: 60
        lyric: a
      - position: 480
        duration: 480
        tone: 62
        lyric: b
      - position: 960
        duration: 480
        tone: 64
        lyric: c
  - track_no: 1
    position: 480
    notes:
      - position: 0
        duration: 480
        tone: 55
        lyric: h
`

describe("OpenUtau 文件级桥（.ustx）", () => {
  it("解析：跳过静音轨、跳过 - 延音，绝对时间 = part.position + note.position", () => {
    const { notes } = parseUstx(NO_OVERLAP)
    expect(notes.map((n) => [n.onset, n.end, n.track, n.lyric])).toEqual([
      [0, 480, 0, "la"],
      [960, 1440, 0, "la"],
      [480, 960, 1, "la"],
    ])
  })

  it("不重叠：按时间合并循序读字", () => {
    const { notes } = parseUstx(NO_OVERLAP)
    const { order, overlap } = orderOuNotes(notes)
    expect(overlap).toBe(false)
    expect(order.map((n) => [n.onset, n.track])).toEqual([
      [0, 0],
      [480, 1],
      [960, 0],
    ])
  })

  it("重叠：字数多的当主歌，和声插在重叠最多的主音符后面", () => {
    const { notes } = parseUstx(OVERLAP)
    const { order, overlap } = orderOuNotes(notes)
    expect(overlap).toBe(true)
    expect(order.map((n) => [n.onset, n.track])).toEqual([
      [0, 0],
      [480, 0],
      [480, 1],
      [960, 0],
    ])
  })

  it("按序填词：替换顺序对上的音符歌词，别的歌词不动", () => {
    const result = fillUstx(OVERLAP, "甲乙丙丁")
    expect(result.matched).toBe(4)
    expect(result.total).toBe(4)
    expect(result.ourChars).toBe(4)
    expect(result.overlap).toBe(true)
    expect(readUstxLyrics(result.text).chars).toBe("甲乙丙丁")
    // 原歌词里的 h 已被替换（不再出现）
    expect(result.text).not.toContain("lyric: h")
  })

  it("字比音符多：只替换能对上的部分，报告剩余", () => {
    const result = fillUstx(OVERLAP, "甲乙丙丁戊")
    expect(result.matched).toBe(4)
    expect(result.ourChars).toBe(5)
  })

  it("读回：按同一顺序读出歌词；延音/静音轨不算", () => {
    const { chars, total } = readUstxLyrics(NO_OVERLAP)
    expect(total).toBe(3)
    expect(chars).toBe("lalala")
  })

  it("坏文件：YAML 解析失败直接报错", () => {
    expect(() => parseUstx("voice_parts: [ { : oops")).toThrow()
  })
})
