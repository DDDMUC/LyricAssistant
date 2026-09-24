import { describe, expect, it } from "vitest"
import {
  Store,
  applyImportedCredits,
  applyImportedTitle,
  applyImportedSource,
  autosaveState,
  createProject,
  markAutosaved,
  createSection,
  createSentence,
  exportLyrics,
  getCells,
  moveSection,
  parseProject,
  reflowOverflow,
  sentenceLine,
  setCells,
  setPattern,
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

describe("markAutosaved", () => {
  it("更新时间戳", () => {
    autosaveState.at = null
    markAutosaved()
    expect(autosaveState.at).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe("applyImportedCredits", () => {
  it("覆盖模式：新创作信息替换旧的，空则清空", () => {
    const project = createProject()
    project.credits = ["作词：旧"]
    applyImportedCredits(project, ["作词：新"], false)
    expect(project.credits).toEqual(["作词：新"])
    applyImportedCredits(project, [], false)
    expect(project.credits).toEqual([])
  })

  it("合并模式：去重追加，空则不动", () => {
    const project = createProject()
    project.credits = ["作词：旧"]
    applyImportedCredits(project, ["作词：旧", "作曲：新"], true)
    expect(project.credits).toEqual(["作词：旧", "作曲：新"])
    applyImportedCredits(project, [], true)
    expect(project.credits).toEqual(["作词：旧", "作曲：新"])
  })
})

describe("applyImportedTitle", () => {
  it("覆盖模式：有名字替换，没有清空回未命名", () => {
    const project = createProject()
    project.title = "旧歌名"
    applyImportedTitle(project, "新歌名", false)
    expect(project.title).toBe("新歌名")
    applyImportedTitle(project, "", false)
    expect(project.title).toBe("未命名歌曲")
  })

  it("合并模式：不动标题", () => {
    const project = createProject()
    project.title = "旧歌名"
    applyImportedTitle(project, "新歌名", true)
    expect(project.title).toBe("旧歌名")
  })
})

describe("applyImportedSource", () => {
  it("覆盖模式替换原文", () => {
    const project = createProject()
    project.source = "旧原文"
    applyImportedSource(project, "新原文", false)
    expect(project.source).toBe("新原文")
  })

  it("合并模式保留并追加原文", () => {
    const project = createProject()
    project.source = "旧原文"
    applyImportedSource(project, "新原文", true)
    expect(project.source).toBe("旧原文\n\n新原文")
    applyImportedSource(project, "第三次", true)
    expect(project.source).toBe("旧原文\n\n新原文\n\n第三次")
  })
})

describe("溢出处理", () => {
  function projectOf(sentences: ReturnType<typeof createSentence>[]) {
    return {
      version: 2 as const,
      title: "t",
      sections: [createSection("A", sentences)],
      updatedAt: new Date().toISOString(),
      credits: [] as string[],
    }
  }

  it("statsOf 统计溢出字数", () => {
    const sentence = createSentence([2])
    setCells(sentence, ["你", "好"])
    sentence.overflow = "再见"
    expect(statsOf(projectOf([sentence])).overflow).toBe(2)
  })

  it("缩格时尾部字进入溢出，扩格时回填", () => {
    const sentence = createSentence([4])
    setCells(sentence, ["一", "二", "三", "四"])
    setPattern(sentence, [2])
    expect(getCells(sentence)).toEqual(["一", "二"])
    expect(sentence.overflow).toBe("三四")
    setPattern(sentence, [3])
    expect(getCells(sentence)).toEqual(["一", "二", "三"])
    expect(sentence.overflow).toBe("四")
    setPattern(sentence, [4])
    expect(getCells(sentence)).toEqual(["一", "二", "三", "四"])
    expect(sentence.overflow).toBe("")
  })

  it("reflowOverflow 把溢出顺移到下一句开头", () => {
    const first = createSentence([2])
    setCells(first, ["一", "二"])
    first.overflow = "三四"
    const second = createSentence([4])
    setCells(second, ["五", "", "", ""])
    const project = projectOf([first, second])
    expect(reflowOverflow(project)).toBe(2)
    expect(first.overflow).toBe("")
    expect(getCells(second)).toEqual(["三", "四", "五", ""])
    expect(second.overflow).toBe("")
  })

  it("reflowOverflow 在最后一句溢出时新建一句", () => {
    const only = createSentence([2])
    setCells(only, ["一", "二"])
    only.overflow = "三四"
    const project = projectOf([only])
    expect(reflowOverflow(project)).toBe(2)
    expect(project.sections[0].sentences).toHaveLength(2)
    const created = project.sections[0].sentences[1]
    expect(created.pattern).toEqual([2])
    expect(getCells(created)).toEqual(["三", "四"])
  })

  it("导出歌词带上溢出字", () => {
    const sentence = createSentence([2])
    setCells(sentence, ["你", "好"])
    sentence.overflow = "吗"
    expect(exportLyrics(projectOf([sentence]))).toBe("你好吗")
  })

  it("导出可带备选与备注，并能原样读回", async () => {
    const { parseLyrics } = await import("./model/lyrics")
    const sentence = createSentence([2])
    setCells(sentence, ["你", "好"])
    sentence.note = "温柔"
    sentence.alternatives.push({
      id: "alt-x",
      name: "备选 2",
      cells: ["再", "见"],
    })
    const text = exportLyrics(projectOf([sentence]), { alts: true, note: true, credits: false })
    expect(text).toBe("你好 ※ 再见（温柔）")
    const parsed = parseLyrics(text)
    expect(parsed.sections[0].lines[0].cells).toEqual(["你", "好"])
    expect(parsed.sections[0].lines[0].alts).toEqual([["再", "见"]])
    expect(parsed.sections[0].lines[0].note).toBe("温柔")
  })

  it("导出可带创作信息并原样读回", async () => {
    const { parseLyrics } = await import("./model/lyrics")
    const sentence = createSentence([2])
    setCells(sentence, ["你", "好"])
    const project = projectOf([sentence])
    project.credits = ["作词：某人"]
    const text = exportLyrics(project, { alts: false, note: false, credits: true })
    expect(text.startsWith("作词：某人\n\n")).toBe(true)
    const parsed = parseLyrics(text)
    expect(parsed.credits).toEqual(["作词：某人"])
    expect(parsed.sections[0].lines[0].cells).toEqual(["你", "好"])
  })

  it("空句导出为 XXXX 占位，回读保留词格", async () => {
    const { parseLyrics } = await import("./model/lyrics")
    const sentence = createSentence([4, 3])
    const text = exportLyrics(projectOf([sentence]))
    expect(text).toBe("XXXX XXX")
    const parsed = parseLyrics(text)
    expect(parsed.sections[0].lines[0].pattern).toEqual([4, 3])
    expect(parsed.sections[0].lines[0].cells).toEqual(new Array(7).fill(""))
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
