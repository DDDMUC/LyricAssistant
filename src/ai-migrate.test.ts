import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

// 老存档迁移：线性 turns（没有 next）→ 单分支树；翻到没有后缀的旧版本时，后续整条消失
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  // 老格式：schema 缺失、turns 是平铺列表；第一轮有 2 个输入版本（甲 / 乙）
  localStorage.setItem(
    "cige-grid-ai-convos",
    JSON.stringify({
      activeId: "c1",
      convos: [
        {
          id: "c1",
          docId: null,
          title: "老会话",
          createdAt: 1,
          updatedAt: 1,
          turns: [
            {
              inputs: [
                { text: "甲", replies: [{ text: "答甲" }], replyIndex: 0 },
                { text: "乙", replies: [{ text: "答乙" }], replyIndex: 0 },
              ],
              inputIndex: 0,
            },
            { inputs: [{ text: "丙", replies: [{ text: "答丙" }], replyIndex: 0 }], inputIndex: 0 },
          ],
        },
      ],
    }),
  )
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

const userTexts = (): string[] =>
  Array.from(document.querySelectorAll(".ai-user-text")).map((el) => el.textContent ?? "")

it("老存档迁移：线性变单分支树，翻旧输入版本时后缀跟着消失 / 回来；落盘升级为 schema 2", async () => {
  // 打开面板看迁移后的渲染
  const panel = document.querySelector<HTMLElement>("#ai-panel")!
  if (panel.hasAttribute("hidden")) document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  await tick(30)
  expect(userTexts()).toEqual(["甲", "丙"])

  // 第一轮的输入 pager 是 1/2；翻到「乙」——它没有后缀（老数据只挂在选中版本下）
  const pager = document.querySelector<HTMLElement>(".ai-msg.user .ai-versions")!
  expect(pager.textContent).toContain("1 / 2")
  pager.querySelectorAll("button")[1]!.click()
  await tick(30)
  expect(userTexts()).toEqual(["乙"])

  // 翻回来：丙 回来
  document.querySelectorAll<HTMLButtonElement>(".ai-msg.user .ai-versions button")[0]!.click()
  await tick(30)
  expect(userTexts()).toEqual(["甲", "丙"])

  // 落盘升级：schema 2 + 嵌套 next
  await tick(400)
  const saved = JSON.parse(localStorage.getItem("cige-grid-ai-convos") ?? "{}") as {
    schema?: number
    convos?: { turns?: { inputs?: { replies?: { next?: unknown }[] }[] }[] }[]
  }
  expect(saved.schema).toBe(2)
  const next = saved.convos?.[0]?.turns?.[0]?.inputs?.[0]?.replies?.[0]?.next
  expect(next).toBeTruthy()
})
