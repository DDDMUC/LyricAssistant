import { describe, expect, it } from "vitest"
import { addAlternative, createSentence, getCells, setCells } from "../state"
import { findMatches, replaceInSentence, sentenceText } from "./search"

function make(pattern: number[], text: string) {
  const sentence = createSentence(pattern)
  setCells(sentence, [...text])
  return sentence
}

describe("findMatches", () => {
  it("只在一句内找、不跨句、不重叠", () => {
    const a = make([3, 3], "恰似一江春水")
    const b = make([6], "向东流人间人间")
    expect(findMatches([a, b], "人间")).toEqual([
      { sentenceId: b.id, start: 3, length: 2 },
      { sentenceId: b.id, start: 5, length: 2 },
    ])
    expect(findMatches([a, b], "水向")).toEqual([])
    expect(findMatches([a, b], "   ")).toEqual([])
    expect(findMatches([a, b], "恰似")).toEqual([
      { sentenceId: a.id, start: 0, length: 2 },
    ])
    // 查找词里的标点符号自动丢掉："人-间" 按 "人间" 找
    expect(findMatches([a, b], "人-间")).toEqual([
      { sentenceId: b.id, start: 3, length: 2 },
      { sentenceId: b.id, start: 5, length: 2 },
    ])
  })
})

describe("replaceInSentence", () => {
  it("等长：换字，词格不变", () => {
    const sentence = make([2, 2], "恰似一江")
    expect(replaceInSentence(sentence, 0, 2, "仿佛")).toBe(true)
    expect(sentenceText(sentence)).toBe("仿佛一江")
    expect(sentence.pattern).toEqual([2, 2])
  })

  it("替换词里的标点符号丢掉、不占格", () => {
    const sentence = make([2, 2], "恰似一江")
    expect(replaceInSentence(sentence, 0, 2, "仿—佛！")).toBe(true)
    expect(sentenceText(sentence)).toBe("仿佛一江")
    expect(sentence.pattern).toEqual([2, 2])
  })

  it("更短：命中段末尾删格子，后面的字左移", () => {
    const sentence = make([2, 2, 3], "恰似一江春水向")
    expect(replaceInSentence(sentence, 4, 2, "秋")).toBe(true)
    expect(sentenceText(sentence)).toBe("恰似一江秋向")
    expect(sentence.pattern).toEqual([2, 2, 2])
  })

  it("更长：命中段后插空格子，后面的字右移", () => {
    const sentence = make([2, 2, 3], "恰似一江春水向")
    expect(replaceInSentence(sentence, 4, 2, "秋风萧瑟")).toBe(true)
    expect(sentenceText(sentence)).toBe("恰似一江秋风萧瑟向")
    expect(sentence.pattern).toEqual([2, 2, 5])
  })

  it("跨分组命中：短了各组分别记账", () => {
    const sentence = make([2, 2], "恰似一江")
    expect(replaceInSentence(sentence, 1, 2, "")).toBe(true)
    expect(sentenceText(sentence)).toBe("恰江")
    expect(sentence.pattern).toEqual([1, 1])
  })

  it("删空整句时退化为清空、保留词格", () => {
    const sentence = make([2], "人间")
    expect(replaceInSentence(sentence, 0, 2, "")).toBe(true)
    expect(sentenceText(sentence)).toBe("")
    expect(sentence.pattern).toEqual([2])
  })

  it("替换后其它备选按新词格对齐，尾格填字会清韵辙提示", () => {
    const sentence = make([2], "人间")
    sentence.rhymeHint = "江阳"
    addAlternative(sentence, "备选")
    expect(replaceInSentence(sentence, 0, 1, "你好")).toBe(true)
    expect(sentence.pattern).toEqual([3])
    expect(getCells(sentence)).toEqual(["你", "好", "间"])
    expect(sentence.alternatives[0].cells).toEqual(["人", "间", ""])
    expect(sentence.rhymeHint).toBe("")
  })
})
