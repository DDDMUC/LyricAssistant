import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import { createDoc } from "./docs"

// 删歌词文件时，AI 面板要跟着收拾（级联删对话 + 面板重画）
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => {}),
  readText: vi.fn(async () => ""),
}))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 造一篇歌词 + 一段挂在它下面的对话（分支树格式） */
function seedDocWithConvo(): { docId: string; title: string } {
  const doc = createDoc("要删的歌")
  const convo = {
    id: "c1",
    docId: doc.id,
    title: "聊了一句",
    createdAt: 0,
    updatedAt: 0,
    turns: [
      {
        inputs: [
          {
            text: "写一句",
            replyIndex: 0,
            replies: [{ text: "春风过回廊" }],
          },
        ],
        inputIndex: 0,
      },
    ],
  }
  localStorage.setItem(
    "cige-grid-docs",
    JSON.stringify({ activeId: doc.id, docs: [doc] }),
  )
  localStorage.setItem(
    "cige-grid-ai-convos",
    JSON.stringify({ schema: 2, activeId: "c1", convos: [convo] }),
  )
  return { docId: doc.id, title: "要删的歌" }
}

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  seedDocWithConvo()
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("删歌词：AI 面板里的对话跟着删掉（删到 0 篇也不留残影）", async () => {
  // 打开 AI 面板，先看到那段对话
  document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  await tick(40)
  expect(document.querySelectorAll(".ai-msg").length).toBeGreaterThan(0)
  expect(document.querySelector("#status-hint")?.textContent ?? "").toBe("")

  // 侧栏 × → 确认 → 删除
  document.querySelector<HTMLButtonElement>(".doc-del")!.click()
  await tick(40)
  const confirm = document.querySelector<HTMLDialogElement>("dialog[open]")!
  expect(confirm.textContent).toContain("删除")
  Array.from(confirm.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "删除")!
    .click()
  await tick(60)

  // 对话连根删掉：面板里不该再有消息
  expect(document.querySelectorAll(".ai-msg")).toHaveLength(0)
  // 存档里也不留
  const stored = JSON.parse(localStorage.getItem("cige-grid-ai-convos") ?? "{}") as {
    convos?: unknown[]
  }
  expect(stored.convos).toEqual([])
  // 侧边栏跟编辑器都回到空状态
  expect(document.querySelectorAll(".doc-item")).toHaveLength(0)
  expect(document.querySelector("#status-hint")?.textContent ?? "").toContain("已删除")
})
