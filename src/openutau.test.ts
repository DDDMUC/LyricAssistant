import { describe, expect, it } from "vitest"
import { hasCigeMarks } from "./engine-core"
import { fillUstx, orderOuNotes, ouEligible, parseUstx, readUstxLyrics } from "./openutau"

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

const WITH_MARKS = `name: demo
tracks:
  - track_name: main
voice_parts:
  - track_no: 0
    position: 0
    notes:
      - position: 0
        duration: 480
        tone: 60
        lyric: 一
      - position: 480
        duration: 1
        tone: 24
        lyric: ""
      - position: 480
        duration: 480
        tone: 62
        lyric: 二
`

describe("OpenUtau 文件级桥（.ustx）", () => {
  it("解析：取非静音轨全部音符；- 延音保留在音符里、在「字位」过滤里被排除", () => {
    const { notes } = parseUstx(NO_OVERLAP)
    expect(notes.map((n) => [n.onset, n.end, n.track, n.lyric])).toEqual([
      [0, 480, 0, "la"],
      [480, 960, 0, "-"],
      [960, 1440, 0, "la"],
      [480, 960, 1, "la"],
    ])
    expect(ouEligible(notes).map((n) => [n.onset, n.track])).toEqual([
      [0, 0],
      [960, 0],
      [480, 1],
    ])
  })

  it("不重叠：按时间合并循序读字", () => {
    const { order, overlap } = orderOuNotes(ouEligible(parseUstx(NO_OVERLAP).notes))
    expect(overlap).toBe(false)
    expect(order.map((n) => [n.onset, n.track])).toEqual([
      [0, 0],
      [480, 1],
      [960, 0],
    ])
  })

  it("重叠：字数多的当主歌，和声插在重叠最多的主音符后面", () => {
    const { order, overlap } = orderOuNotes(ouEligible(parseUstx(OVERLAP).notes))
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

  it("词格酱标记：tone 24/25/26 认得出，且标记不占字位", () => {
    const { notes } = parseUstx(WITH_MARKS)
    expect(hasCigeMarks(notes)).toBe(true)
    expect(ouEligible(notes).length).toBe(2)
  })

  it("坏文件：YAML 解析失败直接报错", () => {
    expect(() => parseUstx("voice_parts: [ { : oops")).toThrow()
  })
})
