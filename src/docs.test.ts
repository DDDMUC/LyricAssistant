import { beforeEach, describe, expect, it } from "vitest"
import { createDoc, defaultDocs, loadDocs, saveDocs } from "./docs"
import { createProject } from "./state"

beforeEach(() => {
  localStorage.clear()
})

describe("loadDocs", () => {
  it("无存储时返回一个默认文档", () => {
    const state = loadDocs()
    expect(state.docs).toHaveLength(1)
    expect(state.activeId).toBe(state.docs[0].id)
    expect(state.docs[0].filePath).toBeNull()
  })

  it("保存后可读回且 activeId 保留", () => {
    const first = createDoc("第一首")
    const second = createDoc("第二首")
    saveDocs({ activeId: second.id, docs: [first, second] })
    const state = loadDocs()
    expect(state.docs).toHaveLength(2)
    expect(state.activeId).toBe(second.id)
    expect(state.docs[0].project.title).toBe("第一首")
  })

  it("activeId 失效时回落到第一个文档", () => {
    const doc = createDoc("只有一首")
    saveDocs({ activeId: "missing", docs: [doc] })
    expect(loadDocs().activeId).toBe(doc.id)
  })

  it("损坏的文档被丢弃", () => {
    const good = createDoc("好的")
    saveDocs({
      activeId: good.id,
      docs: [good, { id: "bad", project: { version: 9 } }] as never,
    })
    const state = loadDocs()
    expect(state.docs).toHaveLength(1)
    expect(state.docs[0].id).toBe(good.id)
  })

  it("从旧的单工程存储迁移", () => {
    localStorage.setItem(
      "cige-grid-autosave",
      JSON.stringify({ project: createProject(), filePath: "/tmp/a.json" }),
    )
    const state = loadDocs()
    expect(state.docs).toHaveLength(1)
    expect(state.docs[0].filePath).toBe("/tmp/a.json")
    expect(localStorage.getItem("cige-grid-autosave")).toBeNull()
  })

  it("默认文档 id 唯一", () => {
    const a = defaultDocs()
    const b = defaultDocs()
    expect(a.docs[0].id).not.toBe(b.docs[0].id)
  })
})
