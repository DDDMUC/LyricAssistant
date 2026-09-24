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

  it("中文停顿标点不占格，但作为分句边界", () => {
    const parsed = parseLyrics("你好，世界！ 啊")
    const line = parsed.sections[0].lines[0]
    expect(line.pattern).toEqual([2, 2, 1])
    expect(line.cells).toEqual(["你", "好", "世", "界", "啊"])
  })

  it("逗号分句按各自字数成组", () => {
    const parsed = parseLyrics("我生分九野，以正四方象观")
    const line = parsed.sections[0].lines[0]
    expect(line.pattern).toEqual([5, 6])
    expect(line.cells.join("")).toBe("我生分九野以正四方象观")
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

  it("无空行无段落头时每 4 句自动分段", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `第${i + 1}句`).join("\n")
    const parsed = parseLyrics(lines)
    expect(parsed.sections.map((s) => s.lines.length)).toEqual([4, 4, 4])
  })

  it("余 1 句时并进上一段", () => {
    const lines = Array.from({ length: 13 }, (_, i) => `第${i + 1}句`).join("\n")
    const parsed = parseLyrics(lines)
    expect(parsed.sections.map((s) => s.lines.length)).toEqual([4, 4, 5])
  })

  it("不足 5 句不分段", () => {
    const parsed = parseLyrics("一 二\n三 四\n五")
    expect(parsed.sections).toHaveLength(1)
  })

  it("裸关键词识别为段落头", () => {
    const parsed = parseLyrics(
      "Verse\n真的 假的\nChorus\n爱你 哦\n\n副歌 2\n再来 一遍\n(Intro)\n前奏 词\n#verse\n最后 一句",
    )
    expect(parsed.sections.map((s) => s.name)).toEqual([
      "Verse",
      "Chorus",
      "副歌 2",
      "Intro",
      "verse",
    ])
    expect(parsed.sections[3].lines[0].cells).toEqual(["前", "奏", "词"])
  })

  it("含关键词的歌词行不当段落头", () => {
    const parsed = parseLyrics("副歌 真的 假的")
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0].name).toBe("")
    expect(parsed.sections[0].lines[0].pattern).toEqual([2, 2, 2])
  })

  it("※ 也可作备选分隔符", () => {
    const parsed = parseLyrics("你好 吗※你好\n真的｜真的啊")
    expect(parsed.sections[0].lines[0].alts).toEqual([["你", "好", ""]])
    expect(parsed.sections[0].lines[1].alts).toEqual([["真", "的"]])
  })

  it("XXXX 占位只生成词格不填字", () => {
    const parsed = parseLyrics("XXXX XXX\nXX 真的")
    const first = parsed.sections[0].lines[0]
    expect(first.pattern).toEqual([4, 3])
    expect(first.cells).toEqual(new Array(7).fill(""))
    const second = parsed.sections[0].lines[1]
    expect(second.pattern).toEqual([2, 2])
    expect(second.cells).toEqual(["", "", "真", "的"])
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

  it("识别并跳过 credit 行，一条行内多条也拆开", () => {
    const parsed = parseLyrics(
      "作词: 择荇作曲: 叶里\n编曲: 雷震\n混音/母带: mading\n歌曲联合发行: QQ音乐国风集\n我要扶摇直上 坐拥满天星斗",
    )
    expect(parsed.credits).toEqual([
      "作词：择荇",
      "作曲：叶里",
      "编曲：雷震",
      "混音/母带：mading",
      "歌曲联合发行：QQ音乐国风集",
    ])
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0].lines).toHaveLength(1)
    expect(parsed.sections[0].lines[0].cells.join("")).toBe("我要扶摇直上坐拥满天星斗")
  })

  it("英文 credit 也认", () => {
    const parsed = parseLyrics("Lyrics: Someone\nComposer: Someone Else\n真的 假的")
    expect(parsed.credits).toEqual(["Lyrics：Someone", "Composer：Someone Else"])
    expect(parsed.sections[0].lines).toHaveLength(1)
  })

  it("歌词里的冒号不误判为 credit", () => {
    const parsed = parseLyrics("他说：走吧\n真的 假的")
    expect(parsed.credits).toEqual([])
    expect(parsed.sections[0].lines).toHaveLength(2)
  })

  it("带值的和声算 credit，裸「和声」算段落名", () => {
    const parsed = parseLyrics("和声: 叶里\n和声\n真的 假的")
    expect(parsed.credits).toEqual(["和声：叶里"])
    expect(parsed.sections[0].name).toBe("和声")
  })

  it("带冒号的短行不当歌名，除非标签含「名」", () => {
    const text = `演唱: 洛天依
作词: 骆栖淮
混音: 圈太
 导唱协力：小缘
 出品：哔哩哔哩拜年纪
 我生分九野，以正四方象观
 察宇宙晨昏去复始元`
    const parsed = parseLyrics(text)
    expect(parsed.title).toBe("")
    expect(parsed.credits).toContain("导唱协力：小缘")
    expect(parsed.credits).toContain("出品：哔哩哔哩拜年纪")
    expect(parsed.sections[0].lines[0].cells.join("")).toBe("我生分九野以正四方象观")
    expect(parsed.sections[0].lines[0].pattern).toEqual([5, 6])
  })

  it("「歌名：xxx」显式标记当歌名", () => {
    const parsed = parseLyrics("演唱：A\n歌名：某首歌\n我 爱 你")
    expect(parsed.title).toBe("某首歌")
    expect(parsed.credits).toEqual(["演唱：A"])
    expect(parsed.sections[0].lines).toHaveLength(1)
  })

  it("credit 块里的裸行识别为歌名", () => {
    const parsed = parseLyrics(
      "作词：冉语优\n人间应又雪\n演唱：洛天依、言和\n夜 泼墨如雨昏又明",
    )
    expect(parsed.title).toBe("人间应又雪")
    expect(parsed.credits).toEqual(["作词：冉语优", "演唱：洛天依、言和"])
    expect(parsed.sections[0].lines).toHaveLength(1)
  })

  it("下一行不是 credit 时不抢作歌名", () => {
    const parsed = parseLyrics("人间应又雪\n夜 泼墨如雨昏又明")
    expect(parsed.title).toBe("")
    expect(parsed.sections[0].lines).toHaveLength(2)
  })

  it("乐器与分轨类 credit 也识别", () => {
    const parsed = parseLyrics("二胡：二胡妹\n分轨混音/母带：周天澈\n真的 假的")
    expect(parsed.credits).toEqual(["二胡：二胡妹", "分轨混音/母带：周天澈"])
    expect(parsed.sections[0].lines).toHaveLength(1)
  })

  it("跳过注释行与空文本", () => {
    const parsed = parseLyrics("# 注释\n// 注释2\n……\n真的")
    expect(parsed.sections[0].lines).toHaveLength(1)
    expect(parsed.sections[0].lines[0].cells).toEqual(["真", "的"])
  })
})
