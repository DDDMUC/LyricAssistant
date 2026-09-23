import { describe, expect, it } from "vitest"
import {
  addCellAt,
  cellsFromPattern,
  clearCell,
  flatIndex,
  locate,
  removeCellAt,
  resizeToPattern,
  shiftSentence,
  splitOrMergePattern,
  writeChars,
} from "./grid"
import { totalCells } from "./pattern"

describe("locate / flatIndex", () => {
  const pattern = [2, 2, 3]

  it("定位", () => {
    expect(locate(pattern, 0)).toEqual({ g: 0, o: 0 })
    expect(locate(pattern, 1)).toEqual({ g: 0, o: 1 })
    expect(locate(pattern, 2)).toEqual({ g: 1, o: 0 })
    expect(locate(pattern, 6)).toEqual({ g: 2, o: 2 })
  })

  it("往返", () => {
    for (let i = 0; i < totalCells(pattern); i++) {
      const { g, o } = locate(pattern, i)
      expect(flatIndex(pattern, g, o)).toBe(i)
    }
  })

  it("越界抛错", () => {
    expect(() => locate(pattern, -1)).toThrow()
    expect(() => locate(pattern, 7)).toThrow()
  })
})

describe("writeChars 钉死语义", () => {
  it("覆盖不顶格", () => {
    const cells = ["你", "好", "世", "界"]
    const { cells: next, written } = writeChars(cells, 1, "妙")
    expect(next).toEqual(["你", "妙", "世", "界"])
    expect(written).toBe(1)
  })

  it("多字连续覆盖后续格", () => {
    const cells = ["你", "好", "世", "界"]
    const { cells: next } = writeChars(cells, 1, "妙啊")
    expect(next).toEqual(["你", "妙", "啊", "界"])
  })

  it("写到末尾截断", () => {
    const cells = ["a", "b"]
    const { cells: next, written } = writeChars(cells, 1, "xyz")
    expect(next).toEqual(["a", "x"])
    expect(written).toBe(1)
  })

  it("不修改原数组", () => {
    const cells = ["a", "b"]
    writeChars(cells, 0, "z")
    expect(cells).toEqual(["a", "b"])
  })
})

describe("clearCell", () => {
  it("原地留空不位移", () => {
    const cells = ["你", "好", "世"]
    expect(clearCell(cells, 1)).toEqual(["你", "", "世"])
  })
})

describe("shiftSentence", () => {
  it("右移且末尾为空时成功", () => {
    expect(shiftSentence(["你", "好", ""], 1)).toEqual(["", "你", "好"])
  })

  it("右移末尾非空时拦截", () => {
    expect(shiftSentence(["你", "好", "世"], 1)).toBeNull()
  })

  it("左移且开头为空时成功", () => {
    expect(shiftSentence(["", "你", "好"], -1)).toEqual(["你", "好", ""])
  })

  it("左移开头非空时拦截", () => {
    expect(shiftSentence(["你", "好", "世"], -1)).toBeNull()
  })

  it("保留中间空洞", () => {
    expect(shiftSentence(["", "你", "", ""], 1)).toEqual(["", "", "你", ""])
  })

  it("右移时最右非空则拦截", () => {
    expect(shiftSentence(["", "你", "", "好"], 1)).toBeNull()
  })
})

describe("addCellAt / removeCellAt", () => {
  it("在当前组内加一格", () => {
    const pattern = [2, 2]
    const cells = ["a", "b", "c", "d"]
    const result = addCellAt(pattern, cells, 2)
    expect(result.pattern).toEqual([2, 3])
    expect(result.cells).toEqual(["a", "b", "", "c", "d"])
    expect(result.cursor).toBe(2)
  })

  it("组只剩一格且还有其他组时删掉整组，尾部字进入溢出", () => {
    const pattern = [1, 2]
    const cells = ["a", "b", "c"]
    expect(removeCellAt(pattern, cells, 0)).toEqual({
      pattern: [2],
      cells: ["a", "b"],
      cursor: 0,
      overflow: "c",
    })
  })

  it("全句只剩一组一格时不能删", () => {
    expect(removeCellAt([1], ["a"], 0)).toBeNull()
  })

  it("移除后更新词格并保留尾部字", () => {
    const pattern = [2, 3]
    const cells = ["a", "b", "c", "d", "e"]
    const result = removeCellAt(pattern, cells, 3)
    expect(result).toEqual({
      pattern: [2, 2],
      cells: ["a", "b", "c", "d"],
      cursor: 3,
      overflow: "e",
    })
  })

  it("尾部为空时不产生溢出", () => {
    const pattern = [2, 2]
    const cells = ["a", "b", "c", ""]
    expect(removeCellAt(pattern, cells, 0)?.overflow).toBe("")
  })
})

describe("splitOrMergePattern", () => {
  it("组内断开", () => {
    expect(splitOrMergePattern([4, 3], 2)).toEqual([2, 2, 3])
    expect(splitOrMergePattern([4], 3)).toEqual([3, 1])
  })

  it("分句开头与上一组合并", () => {
    expect(splitOrMergePattern([4, 3], 4)).toEqual([7])
    expect(splitOrMergePattern([2, 3], 2)).toEqual([5])
  })

  it("最前面无法断开或合并", () => {
    expect(splitOrMergePattern([4, 3], 0)).toBeNull()
  })
})

describe("resizeToPattern", () => {
  it("扩长补空", () => {
    expect(resizeToPattern([3], ["a"])).toEqual(["a", "", ""])
  })

  it("缩短截断", () => {
    expect(resizeToPattern([1], ["a", "b", "c"])).toEqual(["a"])
  })
})

describe("cellsFromPattern", () => {
  it("生成空格", () => {
    expect(cellsFromPattern([2, 3])).toEqual(["", "", "", "", ""])
  })
})
