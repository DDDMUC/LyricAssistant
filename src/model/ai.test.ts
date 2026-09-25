import { describe, expect, it } from "vitest"
import {
  applyAiResults,
  buildBrief,
  buildChatSystemPrompt,
  buildFixPrompt,
  parseAiSentences,
  previewAiResults,
  sentencePlace,
  splitByPattern,
  validateAiResults,
} from "./ai"
import { createSection, createSentence, getCells, setCells } from "../state"
import type { Project } from "./types"

function projectOf(): Project {
  const s1 = createSentence([4, 4])
  setCells(s1, ["北", "望", "去", "荠", "麦", "如", "雪", "月"])
  s1.note = "开场"
  const s2 = createSentence([4, 4])
  s2.rhymeLock = "jiangyang"
  return {
    version: 2,
    title: "t",
    sections: [createSection("主歌", [s1, s2])],
    updatedAt: new Date().toISOString(),
  }
}

describe("parseAiSentences", () => {
  it("认 JSON、```json 包裹、夹在废话里的 JSON", () => {
    const expected = [{ id: "s1", text: "北望去荠麦如雪" }]
    expect(
      parseAiSentences('{"sentences":[{"id":"s1","text":"北望去荠麦如雪"}]}'),
    ).toEqual(expected)
    expect(
      parseAiSentences('好的：\n```json\n{"sentences":[{"id":"s1","text":"北望去荠麦如雪"}]}\n```'),
    ).toEqual(expected)
    expect(
      parseAiSentences('这是结果 {"sentences":[{"id":"s1","text":"北望去荠麦如雪"}]} 完毕'),
    ).toEqual(expected)
  })

  it("解析不出来就返回空", () => {
    expect(parseAiSentences("我不知道")).toEqual([])
    expect(parseAiSentences("")).toEqual([])
  })
})

describe("validateAiResults", () => {
  it("字数、汉字、锁定辙逐句判", () => {
    const project = projectOf()
    const [s1, s2] = project.sections[0].sentences
    const validation = validateAiResults(project, [
      { id: s1.id, text: "北望山河故人长绝" },
      { id: s2.id, text: "千里江山风光" },
    ])
    expect(validation.issues).toHaveLength(1)
    expect(validation.issues[0].label).toBe("第 1 段第 2 句")
    expect(validation.issues[0].message).toContain("需要 8 字")
    expect(validation.ok).toEqual([{ id: s1.id, text: "北望山河故人长绝" }])
  })

  it("锁定辙：句尾要合辙；非汉字拦下", () => {
    const project = projectOf()
    const [, s2] = project.sections[0].sentences
    const bad = validateAiResults(project, [{ id: s2.id, text: "千里江山秋风冷月" }])
    expect(bad.issues[0].message).toContain("不押「江阳辙」")
    const good = validateAiResults(project, [{ id: s2.id, text: "千里江山一片风光" }])
    expect(good.issues).toHaveLength(0)
    expect(good.ok[0].text).toBe("千里江山一片风光")
    const latin = validateAiResults(project, [{ id: s2.id, text: "千里江山abc光" }])
    expect(latin.issues[0].message).toContain("不是汉字")
  })

  it("没带 id 时按顺序兜底", () => {
    const project = projectOf()
    const validation = validateAiResults(project, [
      { id: "", text: "北望山河故人长绝" },
      { id: "", text: "千里江山一片风光" },
    ])
    expect(validation.issues).toHaveLength(0)
    expect(validation.ok.map((item) => item.id)).toEqual(
      project.sections[0].sentences.map((sentence) => sentence.id),
    )
  })
})

describe("previewAiResults", () => {
  it("从半截 JSON 里抓已经写完的句子（带 id），聊天文字不抓", () => {
    expect(
      previewAiResults('{"sentences":[{"id":"s1","text":"北望去"},{"id":"s2","text":"去界友"}]}'),
    ).toEqual([
      { id: "s1", text: "北望去" },
      { id: "s2", text: "去界友" },
    ])
    expect(previewAiResults('{"sentences":[{"id":"s1","text":"北望')).toEqual([])
    expect(previewAiResults("你好呀，随便聊聊")).toEqual([])
  })
})

describe("splitByPattern", () => {
  it("按词格分组拆句，长短对不上也不丢字", () => {
    expect(splitByPattern("铺开一页白纸让梦慢慢生长", [6, 6])).toEqual([
      "铺开一页白纸",
      "让梦慢慢生长",
    ])
    expect(splitByPattern("北望去荠麦如雪", [2, 10])).toEqual(["北望", "去荠麦如雪"])
    expect(splitByPattern("多了几个字", [2, 2])).toEqual(["多了", "几个", "字"])
  })
})

describe("sentencePlace", () => {
  it("找到句子的段名与序号", () => {
    const project = projectOf()
    const [s1] = project.sections[0].sentences
    expect(sentencePlace(project, s1.id)).toEqual({
      section: "主歌",
      sectionIndex: 0,
      line: 1,
    })
    expect(sentencePlace(project, "不存在")).toBeNull()
  })
})

describe("buildChatSystemPrompt", () => {
  it("是聊天提示词，不要求输出词格 JSON", () => {
    const prompt = buildChatSystemPrompt()
    expect(prompt).toContain("闲聊")
    expect(prompt).not.toContain('{"sentences"')
  })
})

describe("buildBrief", () => {
  it("带段落、字数分组、锁定辙、已有字与要写标记", () => {
    const project = projectOf()
    const brief = buildBrief(project, null, "写一段古风")
    expect(brief).toContain("写一段古风")
    expect(brief).toContain("— 主歌 —")
    expect(brief).toContain("8 字（4+4）")
    expect(brief).toContain("押「江阳辙」（韵母 ang/iang/uang）")
    expect(brief).toContain("已写「北望去荠麦如雪月」")
    expect(brief).toContain("→ 要写")
  })
})

describe("applyAiResults", () => {
  it("空句直填；有字的句子新建 AI 备选", () => {
    const project = projectOf()
    const [s1, s2] = project.sections[0].sentences
    const summary = applyAiResults(project, [
      { id: s1.id, text: "北望山河故人长绝" },
      { id: s2.id, text: "千里江山一片风光" },
    ])
    expect(summary).toEqual({ filled: 2, alternatives: 1 })
    expect(getCells(s1)).toEqual([...("北望山河故人长绝")])
    expect(s1.alternatives).toHaveLength(2)
    expect(s1.alternatives[1].name).toBe("AI")
    expect(s1.activeAlt).toBe(1)
    expect(s2.alternatives).toHaveLength(1)
    expect(getCells(s2).join("")).toBe("千里江山一片风光")
  })
})

describe("buildFixPrompt", () => {
  it("列出问题和上次的写法", () => {
    const project = projectOf()
    const [, s2] = project.sections[0].sentences
    const { issues } = validateAiResults(project, [{ id: s2.id, text: "千里江山秋风冷月" }])
    const prompt = buildFixPrompt(issues, [{ id: s2.id, text: "千里江山秋风冷月" }])
    expect(prompt).toContain("第 1 段第 2 句")
    expect(prompt).toContain("上次：「千里江山秋风冷月」")
  })
})
