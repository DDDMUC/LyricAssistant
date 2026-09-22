import { describe, expect, it } from "vitest"
import {
  Store,
  createProject,
  createSection,
  createSentence,
  exportLyrics,
  getCells,
  moveSection,
  parseProject,
  sentenceLine,
  setCells,
  statsOf,
  allSentences,
} from "./state"

describe("parseProject", () => {
  it("迁移 v1 无段落工程", () => {
    const v1 = {
      version: 1,
      title: "旧工程",
      sentences: [
        {
          id: "s1",
          pattern: [2, 2],
          alternatives: [{ id: "a1", name: "备选 1", cells: ["你", "好", "", ""] }],
          activeAlt: 0,
          note: "",
        },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const project = parseProject(JSON.stringify(v1))
    expect(project.version).toBe(2)
    expect(project.sections).toHaveLength(1)
    expect(project.sections[0].name).toBe("歌词")
    expect(project.sections[0].sentences).toHaveLength(1)
    expect(getCells(project.sections[0].sentences[0])).toEqual(["你", "好", "", ""])
    expect(project.title).toBe("旧工程")
  })

  it("接受 v2 工程", () => {
    const project = createProject()
    const restored = parseProject(JSON.stringify(project))
    expect(restored.version).toBe(2)
    expect(restored.sections.length).toBe(2)
  })

  it("拒绝无效结构", () => {
    expect(() => parseProject("{}")).toThrow()
    expect(() => parseProject('{"version":9}')).toThrow()
  })

  it("截断过长 cells 并补齐过短", () => {
    const raw = {
      version: 2,
      title: "t",
      updatedAt: "x",
      sections: [
        {
          id: "sec1",
          name: "S",
          sentences: [
            {
              id: "s1",
              pattern: [3],
              alternatives: [{ id: "a", name: "1", cells: ["a", "b", "c", "d", "e"] }],
              activeAlt: 0,
              note: "",
            },
          ],
        },
        {
          id: "sec2",
          name: "S2",
          sentences: [
            {
              id: "s2",
              pattern: [4],
              alternatives: [{ id: "a2", name: "1", cells: ["x"] }],
              activeAlt: 0,
              note: "n",
            },
          ],
        },
      ],
    }
    const project = parseProject(JSON.stringify(raw))
    expect(getCells(project.sections[0].sentences[0])).toEqual(["a", "b", "c"])
    expect(getCells(project.sections[1].sentences[0])).toEqual(["x", "", "", ""])
  })
})

describe("statsOf", () => {
  it("统计已填与百分比", () => {
    const s1 = createSentence([2, 2])
    setCells(s1, ["你", "好", "", ""])
    const s2 = createSentence([2])
    setCells(s2, ["啊", ""])
    const project = {
      version: 2 as const,
      title: "t",
      sections: [createSection("A", [s1, s2])],
      updatedAt: new Date().toISOString(),
    }
    const stats = statsOf(project)
    expect(stats.total).toBe(6)
    expect(stats.filled).toBe(3)
    expect(stats.sentences).toBe(2)
    expect(stats.sections).toBe(1)
    expect(stats.percent).toBe(50)
  })
})

describe("exportLyrics", () => {
  it("段落间空行、组间空格可回读", async () => {
    const { patternFromLyrics } = await import("./model/pattern")
    const s1 = createSentence([2, 2])
    setCells(s1, ["真", "的", "假", "的"])
    const s2 = createSentence([3])
    setCells(s2, ["我", "爱", "你"])
    const project = {
      version: 2 as const,
      title: "t",
      sections: [
        createSection("V", [s1]),
        createSection("C", [s2]),
      ],
      updatedAt: new Date().toISOString(),
    }
    const text = exportLyrics(project)
    expect(text).toBe("真的 假的\n\n我爱你")
    expect(patternFromLyrics(text)).toEqual([[2, 2], [3]])
  })
})

describe("allSentences", () => {
  it("跨段落收集", () => {
    const a = createSentence([1])
    const b = createSentence([2])
    const project = {
      version: 2 as const,
      title: "t",
      sections: [createSection("A", [a]), createSection("B", [b])],
      updatedAt: new Date().toISOString(),
    }
    expect(allSentences(project).map((s) => s.id)).toEqual([a.id, b.id])
  })
})

describe("sentenceLine", () => {
  it("组间空格拼接", () => {
    const sentence = createSentence([2, 1])
    setCells(sentence, ["你", "好", "吗"])
    expect(sentenceLine(sentence)).toBe("你好 吗")
  })
})

describe("moveSection", () => {
  it("上下移动段落并在边界返回 false", () => {
    const a = createSection("A", [createSentence([1])])
    const b = createSection("B", [createSentence([1])])
    const project = {
      version: 2 as const,
      title: "t",
      sections: [a, b],
      updatedAt: new Date().toISOString(),
    }
    expect(moveSection(project, b.id, -1)).toBe(true)
    expect(project.sections.map((s) => s.name)).toEqual(["B", "A"])
    expect(moveSection(project, b.id, -1)).toBe(false)
    expect(moveSection(project, b.id, 1)).toBe(true)
    expect(project.sections.map((s) => s.name)).toEqual(["A", "B"])
    expect(moveSection(project, b.id, 1)).toBe(false)
    expect(moveSection(project, "missing", 1)).toBe(false)
  })
})

describe("Store 撤销/重做", () => {
  it("重做恢复撤销的修改", () => {
    const store = new Store(createProject())
    const sentenceId = store.cursor.sentenceId
    const sentence = store.findSentence(sentenceId)!
    store.pushUndo()
    setCells(sentence, ["测", "试"])
    store.touch()
    expect(store.canUndo()).toBe(true)
    expect(store.canRedo()).toBe(false)
    expect(store.undo()).toBe(true)
    expect(store.canRedo()).toBe(true)
    expect(store.redo()).toBe(true)
    expect(store.canRedo()).toBe(false)
    const restored = store.findSentence(sentenceId)!
    expect(getCells(restored).slice(0, 2)).toEqual(["测", "试"])
  })

  it("撤销回退到推入前的状态", () => {
    const store = new Store(createProject())
    const sentenceId = store.cursor.sentenceId
    const sentence = store.findSentence(sentenceId)!
    const before = getCells(sentence).slice()
    store.pushUndo()
    setCells(sentence, ["改", "了"])
    store.touch()
    expect(store.undo()).toBe(true)
    expect(getCells(store.findSentence(sentenceId)!)).toEqual(before)
    expect(store.undo()).toBe(false)
  })

  it("撤销后新操作清空重做栈", () => {
    const store = new Store(createProject())
    const sentence = store.findSentence(store.cursor.sentenceId)!
    store.pushUndo()
    setCells(sentence, ["一"])
    store.touch()
    store.undo()
    expect(store.canRedo()).toBe(true)
    store.pushUndo()
    expect(store.canRedo()).toBe(false)
  })

  it("dirty 标记在 touch 后置位、保存后清除", () => {
    const store = new Store(createProject())
    expect(store.dirty).toBe(false)
    store.touch()
    expect(store.dirty).toBe(true)
    store.markSaved()
    expect(store.dirty).toBe(false)
  })
})
