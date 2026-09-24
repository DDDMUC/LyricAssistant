import { beforeEach, describe, expect, it } from "vitest"
import {
  buildDocsBackup,
  createDoc,
  createDocFrom,
  defaultDocs,
  loadDocs,
  parseDocsBackup,
  saveDocs,
} from "./docs"
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

  it("activeId 失效时回落为空", () => {
    const doc = createDoc("只有一首")
    saveDocs({ activeId: "missing", docs: [doc] })
    const state = loadDocs()
    expect(state.activeId).toBe("")
    expect(state.docs).toHaveLength(1)
  })

  it("空状态可保存并在重启后保持空", () => {
    saveDocs({ activeId: "", docs: [] })
    expect(loadDocs().docs).toHaveLength(0)
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

describe("删除全部工程", () => {
  it("删到 0 个后仍保持空状态，重启不自动恢复", () => {
    const first = createDoc("第一首")
    const second = createDoc("第二首")
    let state = { activeId: first.id, docs: [first, second] }
    saveDocs(state)
    state = { activeId: state.activeId, docs: state.docs.slice(1) }
    state = { activeId: state.activeId, docs: state.docs.slice(1) }
    saveDocs(state)
    const reloaded = loadDocs()
    expect(reloaded.docs).toHaveLength(0)
    expect(reloaded.activeId).toBe("")
  })

  it("空状态下导入会创建第一个工程", () => {
    saveDocs({ activeId: "", docs: [] })
    expect(loadDocs().docs).toHaveLength(0)
    const doc = createDocFrom(createProject(), null)
    const state = { activeId: doc.id, docs: [doc] }
    saveDocs(state)
    const reloaded = loadDocs()
    expect(reloaded.docs).toHaveLength(1)
    expect(reloaded.activeId).toBe(doc.id)
  })

  it("新建工程仍带自动编号（命名行为未改）", () => {
    const doc = createDoc("未命名 6")
    expect(doc.project.title).toBe("未命名 6")
    const anon = createDoc()
    expect(anon.project.title).toBe("未命名歌曲")
  })
})

describe("草稿备份", () => {
  it("导出后可原样恢复", () => {
    const first = createDoc("第一首")
    const second = createDoc("第二首")
    second.project.credits = ["作词：某人"]
    const state = { activeId: second.id, docs: [first, second] }
    const backup = buildDocsBackup(state)
    const restored = parseDocsBackup(JSON.stringify(backup))
    expect(restored).not.toBeNull()
    expect(restored?.activeId).toBe(second.id)
    expect(restored?.docs).toHaveLength(2)
    expect(restored?.docs[1].project.title).toBe("第二首")
    expect(restored?.docs[1].project.credits).toEqual(["作词：某人"])
  })

  it("拒绝非备份文件与损坏内容", () => {
    expect(parseDocsBackup("{}")).toBeNull()
    expect(parseDocsBackup("[]")).toBeNull()
    expect(parseDocsBackup("not json")).toBeNull()
    expect(
      parseDocsBackup(JSON.stringify({ format: "cige-grid-drafts", docs: [{ id: "x" }] })),
    ).toBeNull()
  })
})