import { describe, expect, it } from "vitest"
import { parseLyrics } from "./lyrics"

describe("parseLyrics", () => {
  it("歌词行生成词格并填入文字", () => {
    const parsed = parseLyrics("真的 假的\n是你 啊")
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0].lines[0].pattern).toEqual([2, 2])
    expect(parsed.sections[0].lines[0].cells).toEqual(["真", "的", "假", "的"])
    expect(parsed.sections[0].lines[1].pattern).toEqual([2, 1])
    expect(parsed.sections[0].lines[1].cells).toEqual(["是", "你", "啊"])
  })

  it("纯数字行只生成空格子", () => {
    const parsed = parseLyrics("4/4")
    expect(parsed.sections[0].lines[0].pattern).toEqual([4, 4])
    expect(parsed.sections[0].lines[0].cells).toEqual(new Array(8).fill(""))
  })

  it("标点不占格也不入格", () => {
    const parsed = parseLyrics("你好，世界！ 啊")
    const line = parsed.sections[0].lines[0]
    expect(line.pattern).toEqual([4, 1])
    expect(line.cells).toEqual(["你", "好", "世", "界", "啊"])
  })

  it("行尾括号提取为备注", () => {
    const parsed = parseLyrics("真的 假的（温柔一点）\n数字行 4/4 (备注)")
    expect(parsed.sections[0].lines[0].note).toBe("温柔一点")
    expect(parsed.sections[0].lines[0].pattern).toEqual([2, 2])
    expect(parsed.sections[0].lines[1].note).toBe("备注")
    expect(parsed.sections[0].lines[1].pattern).toEqual([3, 2])
  })

  it("竖线分隔备选，按主句词格截断补齐", () => {
    const parsed = parseLyrics("真的|真的啊\n你好 吗｜你好")
    const line = parsed.sections[0].lines[0]
    expect(line.pattern).toEqual([2])
    expect(line.alts).toEqual([["真", "的"]])
    expect(parsed.sections[0].lines[1].alts).toEqual([["你", "好", ""]])
  })

  it("标题与段落头", () => {
    const parsed = parseLyrics("《测试歌》\n[Verse]\n真的 假的\n\n[Chorus]\n爱你 哦")
    expect(parsed.title).toBe("测试歌")
    expect(parsed.sections.map((s) => s.name)).toEqual(["Verse", "Chorus"])
    expect(parsed.sections[1].lines[0].cells).toEqual(["爱", "你", "哦"])
  })

  it("空行自动分段", () => {
    const parsed = parseLyrics("第一段 词\n第二句\n\n第三段 词")
    expect(parsed.sections).toHaveLength(2)
    expect(parsed.sections[0].name).toBe("")
    expect(parsed.sections[1].lines[0].cells).toEqual(["第", "三", "段", "词"])
  })

  it("剥离 LRC 时间戳并跳过元数据行", () => {
    const parsed = parseLyrics("[ar:歌手]\n[00:12.34]真的 假的\n[00:15.00][00:20.00]重复 句")
    const lines = parsed.sections[0].lines
    expect(lines).toHaveLength(2)
    expect(lines[0].cells).toEqual(["真", "的", "假", "的"])
    expect(lines[1].cells).toEqual(["重", "复", "句"])
  })

  it("跳过注释行与空文本", () => {
    const parsed = parseLyrics("# 注释\n// 注释2\n……\n真的")
    expect(parsed.sections[0].lines).toHaveLength(1)
    expect(parsed.sections[0].lines[0].cells).toEqual(["真", "的"])
  })
})
