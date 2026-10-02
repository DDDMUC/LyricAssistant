import { describe, expect, it } from "vitest"
import { createProject, parseProject } from "../state"
import {
  addRhymeGroup,
  dissolveRhymeGroup,
  dropCellRefs,
  groupAt,
  replaceCellRefs,
  shiftCellRefs,
} from "./rhyme-groups"

const firstTwo = () => {
  const project = createProject()
  const sentences = project.sections.flatMap((section) => section.sentences)
  return { project, a: sentences[0], b: sentences[1] }
}

describe("押韵组（rhyme-groups）", () => {
  it("建组：跨句挂在各自的句子上；同句多格合成一条 ref", () => {
    const { project, a, b } = firstTwo()
    const id = addRhymeGroup(
      project,
      [
        { sentenceId: a.id, index: 0 },
        { sentenceId: a.id, index: 2 },
        { sentenceId: b.id, index: 1 },
      ],
      { rhy: "zhongdong" },
    )!
    expect(id).toBeTruthy()
    expect(project.rhymeGroups).toEqual([{ id, constraint: { rhy: "zhongdong" } }])
    expect(a.rhymeGroups).toEqual([{ id, indexes: [0, 2] }])
    expect(b.rhymeGroups).toEqual([{ id, indexes: [1] }])
    expect(groupAt(project, a, 2)?.constraint).toEqual({ rhy: "zhongdong" })
    expect(groupAt(project, a, 1)).toBeNull()
  })

  it("解散：约束和所有引用一起清掉", () => {
    const { project, a, b } = firstTwo()
    const id = addRhymeGroup(project, [{ sentenceId: a.id, index: 0 }, { sentenceId: b.id, index: 0 }], {
      final: "ong",
    })!
    dissolveRhymeGroup(project, id)
    expect(project.rhymeGroups).toBeUndefined()
    expect(a.rhymeGroups).toBeUndefined()
    expect(b.rhymeGroups).toBeUndefined()
  })

  it("插格右移 / 删格左移：逐格锁和押韵组引用跟着走", () => {
    const { project, a } = firstTwo()
    a.cellLocks = { "2": "yiqi" }
    const id = addRhymeGroup(project, [{ sentenceId: a.id, index: 3 }, { sentenceId: a.id, index: 5 }], {
      rhy: "yiqi",
    })!
    // 在第 1 格前插一格 → 原来 2/3/5 → 3/4/6
    shiftCellRefs(a, 1, 1)
    expect(a.cellLocks).toEqual({ "3": "yiqi" })
    expect(a.rhymeGroups?.[0]?.indexes).toEqual([4, 6])
    // 删除第 3 格（原来的锁位）→ 锁没了，组 4/6 → 3/5
    dropCellRefs(a, 3, 1)
    expect(a.cellLocks).toEqual({})
    expect(a.rhymeGroups?.[0]?.indexes).toEqual([3, 5])
    void id
  })

  it("替换格子：区间内的引用丢掉，后面的跟着位移", () => {
    const { project, a } = firstTwo()
    a.cellLocks = { "1": "yiqi", "4": "gusu" }
    const id = addRhymeGroup(project, [{ sentenceId: a.id, index: 2 }, { sentenceId: a.id, index: 6 }], {
      rhy: "gusu",
    })!
    // 把 [1,2) 换成 2 格：区间内的锁 1 丢掉；4→5；组里 2、6 不在区间内，跟随后移 → 3、7
    replaceCellRefs(a, 1, 1, 2)
    expect(a.cellLocks).toEqual({ "5": "gusu" })
    expect(a.rhymeGroups?.[0]?.indexes).toEqual([3, 7])
    void id
  })

  it("加载兜底：孤儿组 / 只剩 1 格的组会被清掉", () => {
    const raw = JSON.stringify({
      version: 2,
      title: "t",
      sections: [
        {
          id: "sec1",
          name: "",
          sentences: [
            {
              id: "s1",
              pattern: [4, 3],
              alternatives: [{ id: "a1", name: "备选 1", cells: ["", "", "", "", "", "", ""] }],
              activeAlt: 0,
              note: "",
              overflow: "",
              rhymeGroups: [
                { id: "g-alive", indexes: [6] },
                { id: "g-single", indexes: [6] },
                { id: "g-orphan", indexes: [6] },
                { id: "g-out", indexes: [99] },
              ],
            },
            {
              id: "s2",
              pattern: [4, 3],
              alternatives: [{ id: "a1", name: "备选 1", cells: ["", "", "", "", "", "", ""] }],
              activeAlt: 0,
              note: "",
              overflow: "",
              rhymeGroups: [{ id: "g-alive", indexes: [6] }],
            },
          ],
        },
      ],
      updatedAt: "x",
      rhymeGroups: [
        { id: "g-alive", constraint: { rhy: "yiqi" } },
        { id: "g-single", constraint: { rhy: "gusu" } },
        { id: "g-out", constraint: { rhy: "gusu" } },
      ],
    })
    const project = parseProject(raw)
    expect(project.rhymeGroups).toEqual([{ id: "g-alive", constraint: { rhy: "yiqi" } }])
    const [s1] = project.sections[0].sentences
    expect(s1.rhymeGroups).toEqual([{ id: "g-alive", indexes: [6] }])
  })
})
