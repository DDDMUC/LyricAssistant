import { describe, expect, it } from "vitest"
import { charFitsRhyme, readingsOf } from "./rhyme"

describe("readingsOf", () => {
  it("返回全部读音的韵母并去重", () => {
    expect(readingsOf("乐").sort()).toEqual(["ao", "e", "ve"].sort())
    expect(readingsOf("了").sort()).toEqual(["e", "iao"].sort())
    expect(readingsOf("行").sort()).toEqual(["ang", "eng", "ing"].sort())
    expect(readingsOf("重")).toEqual(["ong"])
    expect(readingsOf("光")).toEqual(["uang"])
  })

  it("j/q/x/y 后的 ü 还原成 v", () => {
    expect(readingsOf("去")).toEqual(["v"])
    expect(readingsOf("女").sort()).toEqual(["u", "v"].sort())
    expect(readingsOf("居")).toEqual(["v"])
    expect(readingsOf("语")).toEqual(["v"])
    expect(readingsOf("月")).toEqual(["ve"])
    expect(readingsOf("雪")).toEqual(["ve"])
    expect(readingsOf("军")).toEqual(["vn"])
    expect(readingsOf("群")).toEqual(["vn"])
    expect(readingsOf("远")).toEqual(["van"])
  })

  it("声母剥离正确", () => {
    expect(readingsOf("知")).toEqual(["i"])
    expect(readingsOf("是")).toEqual(["i"])
    expect(readingsOf("而")).toEqual(["er"])
    expect(readingsOf("安")).toEqual(["an"])
  })

  it("非汉字返回空", () => {
    expect(readingsOf("")).toEqual([])
    expect(readingsOf("a")).toEqual([])
    expect(readingsOf("1")).toEqual([])
  })
})

describe("charFitsRhyme", () => {
  it("多音字按任一读音判定", () => {
    expect(charFitsRhyme("乐", "suobo")).toBe(true)
    expect(charFitsRhyme("乐", "miexie")).toBe(true)
    expect(charFitsRhyme("乐", "yaotiao")).toBe(true)
    expect(charFitsRhyme("乐", "jiangyang")).toBe(false)

    expect(charFitsRhyme("行", "jiangyang")).toBe(true)
    expect(charFitsRhyme("行", "zhongdong")).toBe(true)
    expect(charFitsRhyme("行", "fahua")).toBe(false)
  })

  it("单读音字严格判定", () => {
    expect(charFitsRhyme("国", "suobo")).toBe(true)
    expect(charFitsRhyme("国", "jiangyang")).toBe(false)
    expect(charFitsRhyme("白", "huailai")).toBe(true)
    expect(charFitsRhyme("白", "suobo")).toBe(false)
  })

  it("未上锁或未知辙一律放行", () => {
    expect(charFitsRhyme("国", "")).toBe(true)
    expect(charFitsRhyme("国", "不存在的辙")).toBe(true)
  })

  it("汉字按韵母判", () => {
    expect(charFitsRhyme("啊", "jiangyang")).toBe(false)
    expect(charFitsRhyme("啊", "fahua")).toBe(true)
  })

  it("锁定后非汉字一律拦下", () => {
    expect(charFitsRhyme("1", "jiangyang")).toBe(false)
    expect(charFitsRhyme("a", "jiangyang")).toBe(false)
    expect(charFitsRhyme("A", "jiangyang")).toBe(false)
    expect(charFitsRhyme("3", "yiqi")).toBe(false)
    expect(charFitsRhyme("，", "jiangyang")).toBe(false)
  })

  it("未上锁时任何字符都放行", () => {
    expect(charFitsRhyme("1", "")).toBe(true)
    expect(charFitsRhyme("a", "")).toBe(true)
  })

  it("ü 系字按真实韵母判", () => {
    expect(charFitsRhyme("去", "yiqi")).toBe(true)
    expect(charFitsRhyme("去", "gusu")).toBe(false)
    expect(charFitsRhyme("雨", "yiqi")).toBe(true)
    expect(charFitsRhyme("月", "miexie")).toBe(true)
    expect(charFitsRhyme("雪", "miexie")).toBe(true)
    expect(charFitsRhyme("雪", "suobo")).toBe(false)
    expect(charFitsRhyme("军", "renchen")).toBe(true)
    expect(charFitsRhyme("远", "yanqian")).toBe(true)
  })
})
