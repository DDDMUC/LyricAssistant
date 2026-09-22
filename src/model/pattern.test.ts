import { describe, expect, it } from "vitest"
import {
  countChars,
  parsePattern,
  patternFromLyrics,
  patternToString,
  totalCells,
} from "./pattern"

describe("parsePattern", () => {
  it("解析 2/2/3", () => {
    expect(parsePattern("2/2/3")).toEqual([2, 2, 3])
  })

  it("接受逗号、顿号、空格分隔", () => {
    expect(parsePattern("2,2,3")).toEqual([2, 2, 3])
    expect(parsePattern("2，2，3")).toEqual([2, 2, 3])
    expect(parsePattern("2、2、3")).toEqual([2, 2, 3])
    expect(parsePattern("2 2 3")).toEqual([2, 2, 3])
  })

  it("拒绝空输入", () => {
    expect(() => parsePattern("")).toThrow()
    expect(() => parsePattern("  ")).toThrow()
    expect(() => parsePattern("//")).toThrow()
  })

  it("拒绝非数字与小于 1", () => {
    expect(() => parsePattern("2/a/3")).toThrow()
    expect(() => parsePattern("0")).toThrow()
    expect(() => parsePattern("-1")).toThrow()
    expect(() => parsePattern("1.5")).toThrow()
  })
})

describe("pattern helpers", () => {
  it("往返转换", () => {
    expect(patternToString(parsePattern("4/3/5"))).toBe("4/3/5")
  })

  it("totalCells", () => {
    expect(totalCells([2, 2, 3])).toBe(7)
    expect(totalCells([8])).toBe(8)
  })
})

describe("countChars", () => {
  it("中文逐字计数", () => {
    expect(countChars("我爱你")).toBe(3)
  })

  it("忽略标点与空白", () => {
    expect(countChars("我 爱 你，真的！")).toBe(5)
    expect(countChars("  ")).toBe(0)
    expect(countChars("……——")).toBe(0)
  })

  it("字母数字逐字符", () => {
    expect(countChars("abc 123")).toBe(6)
  })
})

describe("patternFromLyrics", () => {
  it("无空格整行算一组", () => {
    expect(patternFromLyrics("我爱你\n真的是你")).toEqual([[3], [4]])
  })

  it("空格分组", () => {
    expect(patternFromLyrics("我 爱 你")).toEqual([[1, 1, 1]])
    expect(patternFromLyrics("真的 假的 啊")).toEqual([[2, 2, 1]])
  })

  it("忽略空行", () => {
    expect(patternFromLyrics("\n你好\n\n")).toEqual([[2]])
  })

  it("去掉 UTF-8 BOM", () => {
    expect(patternFromLyrics("﻿我爱你")).toEqual([[3]])
  })

  it("去掉 LRC 时间轴，跳过注释行", () => {
    const text = "[00:01.00]我爱你\n// comment\n# title\n真的是 你啊"
    expect(patternFromLyrics(text)).toEqual([[3], [3, 2]])
  })

  it("导出格式可回读", () => {
    const original = [[2, 2, 3], [4]]
    const exported = original
      .map((groups) =>
        groups
          .map((n) => Array.from({ length: n }, () => "字").join(""))
          .join(" "),
      )
      .join("\n\n")
    expect(patternFromLyrics(exported)).toEqual(original)
  })
})
