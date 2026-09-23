import { describe, expect, it } from "vitest"
import { isEndingFilled, rhymeHue, rhymeLabels, rhymeOfCells, rhymeOfChar } from "./rhyme"

describe("rhymeOfChar", () => {
  it("识别常见十三辙", () => {
    expect(rhymeOfChar("光")?.label).toBe("江阳辙")
    expect(rhymeOfChar("方")?.label).toBe("江阳辙")
    expect(rhymeOfChar("你")?.label).toBe("一七辙")
    expect(rhymeOfChar("雨")?.label).toBe("一七辙")
    expect(rhymeOfChar("去")?.label).toBe("一七辙")
    expect(rhymeOfChar("路")?.label).toBe("姑苏辙")
    expect(rhymeOfChar("天")?.label).toBe("言前辙")
    expect(rhymeOfChar("远")?.label).toBe("言前辙")
    expect(rhymeOfChar("心")?.label).toBe("人辰辙")
    expect(rhymeOfChar("风")?.label).toBe("中东辙")
    expect(rhymeOfChar("梦")?.label).toBe("中东辙")
    expect(rhymeOfChar("来")?.label).toBe("怀来辙")
    expect(rhymeOfChar("好")?.label).toBe("遥条辙")
    expect(rhymeOfChar("头")?.label).toBe("由求辙")
    expect(rhymeOfChar("雪")?.label).toBe("乜斜辙")
    expect(rhymeOfChar("夜")?.label).toBe("乜斜辙")
    expect(rhymeOfChar("河")?.label).toBe("梭波辙")
    expect(rhymeOfChar("花")?.label).toBe("发花辙")
    expect(rhymeOfChar("知")?.label).toBe("一七辙")
    expect(rhymeOfChar("儿")?.label).toBe("一七辙")
    expect(rhymeOfChar("为")?.label).toBe("灰堆辙")
  })

  it("非汉字返回 null", () => {
    expect(rhymeOfChar("a")).toBeNull()
    expect(rhymeOfChar("1")).toBeNull()
    expect(rhymeOfChar("，")).toBeNull()
    expect(rhymeOfChar("")).toBeNull()
  })
})

describe("rhymeOfCells", () => {
  it("取最后一个汉字，跳过空位与非汉字", () => {
    expect(rhymeOfCells(["", "风", "", "1"])?.char).toBe("风")
    expect(rhymeOfCells(["你", "好"])?.char).toBe("好")
    expect(rhymeOfCells(["我", "爱", "你", "！"])?.char).toBe("你")
    expect(rhymeOfCells(["", "", ""])).toBeNull()
  })
})

describe("isEndingFilled", () => {
  it("句尾格有字才算写完", () => {
    expect(isEndingFilled(["你", "好"])).toBe(true)
    expect(isEndingFilled(["你", ""])).toBe(false)
    expect(isEndingFilled(["你", " "])).toBe(false)
    expect(isEndingFilled([])).toBe(false)
  })
})

describe("rhymeHue", () => {
  it("同辙同色、未知兜底", () => {
    expect(rhymeHue("jiangyang")).toBe(rhymeHue("jiangyang"))
    expect(rhymeHue("nope")).toBe(210)
  })
})

describe("rhymeLabels", () => {
  it("包含十三辙", () => {
    expect(rhymeLabels()).toHaveLength(13)
    expect(rhymeLabels()).toContain("江阳辙")
  })
})
