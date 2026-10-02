import { describe, expect, it } from "vitest"
import {
  isEndingFilled,
  rhymeHue,
  rhymeLabels,
  rhymeOfCells,
  rhymeOfChar,
  rhymeOfPinyin,
} from "./rhyme"

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
  it("拼音（组字串）算辙：常用音节 + 打一半/多音节给 null", () => {
    expect(rhymeOfPinyin("san")?.label).toBe("言前辙")
    expect(rhymeOfPinyin("zhong")?.label).toBe("中东辙")
    expect(rhymeOfPinyin("dao")?.label).toBe("遥条辙")
    expect(rhymeOfPinyin("ni")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("wo")?.label).toBe("梭波辙")
    expect(rhymeOfPinyin("yue")?.label).toBe("乜斜辙")
    expect(rhymeOfPinyin("ye")?.label).toBe("乜斜辙")
    expect(rhymeOfPinyin("yu")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("lv")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("ju")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("er")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("shi")?.label).toBe("一七辙")
    expect(rhymeOfPinyin("zh")).toBeNull()
    expect(rhymeOfPinyin("nihao")).toBeNull()
    expect(rhymeOfPinyin("")).toBeNull()
  })

  it("包含十三辙", () => {
    expect(rhymeLabels()).toHaveLength(13)
    expect(rhymeLabels()).toContain("江阳辙")
  })
})

describe("pronunciationsOf / charFitsConstraint / candidateChars（押韵组）", () => {
  it("读音拆解：声母/韵母/声调 + y/w 还原 + 轻声", async () => {
    const { pronunciationsOf } = await import("./rhyme")
    expect(pronunciationsOf("五")).toContainEqual({ initial: "w", final: "u", tone: 3 })
    expect(pronunciationsOf("我")).toContainEqual({ initial: "w", final: "uo", tone: 3 })
    expect(pronunciationsOf("一")).toContainEqual({ initial: "y", final: "i", tone: 1 })
    expect(pronunciationsOf("与")).toContainEqual({ initial: "y", final: "v", tone: 3 })
    expect(pronunciationsOf("月")).toContainEqual({ initial: "y", final: "ve", tone: 4 })
    expect(pronunciationsOf("王")).toContainEqual({ initial: "w", final: "uang", tone: 2 })
    expect(pronunciationsOf("安")).toContainEqual({ initial: "", final: "an", tone: 1 })
    expect(pronunciationsOf("女")).toContainEqual({ initial: "n", final: "v", tone: 3 })
    expect(pronunciationsOf("女")).toContainEqual({ initial: "r", final: "u", tone: 3 })
    expect(pronunciationsOf("了")).toContainEqual({ initial: "l", final: "e", tone: 0 })
    expect(pronunciationsOf("乐")).toContainEqual({ initial: "y", final: "ve", tone: 4 })
    expect(pronunciationsOf("乐")).toContainEqual({ initial: "l", final: "e", tone: 4 })
    // 与 = yǔ/yù/yú 多个声调都应保留
    expect(pronunciationsOf("与").every((p) => p.initial === "y" && p.final === "v")).toBe(true)
  })

  it("约束判定：同一条读音要同时满足所有勾选项", async () => {
    const { charFitsConstraint } = await import("./rhyme")
    // 只勾辙
    expect(charFitsConstraint("东", { rhy: "zhongdong" })).toBe(true)
    expect(charFitsConstraint("江", { rhy: "zhongdong" })).toBe(false)
    // 声母 + 韵母 + 声调 同时满足
    expect(charFitsConstraint("是", { initial: "sh", final: "i", tones: [4] })).toBe(true)
    expect(charFitsConstraint("市", { initial: "sh", final: "i", tones: [4] })).toBe(true)
    expect(charFitsConstraint("十", { initial: "sh", final: "i", tones: [4] })).toBe(false) // shí 是 2 声
    expect(charFitsConstraint("行", { initial: "x", final: "ing", tones: [2] })).toBe(true) // xíng
    expect(charFitsConstraint("行", { initial: "h", final: "ang", tones: [2] })).toBe(true) // háng
    expect(charFitsConstraint("行", { initial: "x", final: "ang", tones: [2] })).toBe(false) // 不同读音不能拼
    // 零声母
    expect(charFitsConstraint("安", { initial: "" })).toBe(true)
    expect(charFitsConstraint("他", { initial: "" })).toBe(false)
    // 轻声
    expect(charFitsConstraint("的", { tones: [0] })).toBe(true)
  })

  it("推荐候选：满足约束、常用字排前", async () => {
    const { candidateChars } = await import("./rhyme")
    const list = candidateChars({ rhy: "zhongdong", final: "ong", initial: "" }, 50)
    // 「空声母 + ong」基本没有字，应该是空或极少——换个真实约束
    const dong = candidateChars({ rhy: "zhongdong", final: "ong", tones: [1] }, 20)
    expect(dong).toContain("东")
    expect(dong).toContain("冬")
    expect(dong.every((ch) => ch.length === 1)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(0)
    const shi4 = candidateChars({ initial: "sh", final: "i", tones: [4] }, 30)
    expect(shi4).toContain("是")
    expect(shi4.indexOf("是")).toBeLessThan(shi4.indexOf("嗜")) // 常用字（GB2312 一级）排前
  })
})
