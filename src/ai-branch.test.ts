import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

// 分支模型：对话是一棵版本树——在第 n 轮翻页 = 前缀保留、后缀整条跟着选中版本走；
// 编辑 / 重跑开新分支，旧后缀原地保留（翻页可回）；生成上下文只带当前路径。
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(cond: () => boolean, timeout = 4000): Promise<boolean> {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeout) await tick(20)
  return cond()
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

const sse = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

/** 每次请求返回文本里的编号都不同：方便断言"当前路径"里带了哪几条 */
let replySeq = 0
const fetchBodies: string[] = []
function mockReplies(): void {
  fetchMock.mockReset()
  fetchMock.mockImplementation((_url: unknown, init?: { body?: unknown }) => {
    fetchBodies.push(String(init?.body ?? ""))
    replySeq += 1
    return Promise.resolve(
      sseResponse([sse(`模型回复${replySeq}`), "data: [DONE]\n\n"]),
    )
  })
}

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

async function openPanelAndKey(): Promise<void> {
  const panel = document.querySelector<HTMLElement>("#ai-panel")!
  if (panel.hasAttribute("hidden")) document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  Array.from(document.querySelectorAll<HTMLButtonElement>(".ai-pop button"))
    .find((button) => button.textContent === "管理模型")!
    .click()
  await tick(30)
  const settings = document.querySelector<HTMLDialogElement>(".settings-dialog")!
  settings
    .querySelectorAll<HTMLElement>(".settings-card")[0]!
    .querySelector<HTMLButtonElement>(".settings-card-actions button")!
    .click()
  await tick(20)
  settings.querySelector<HTMLInputElement>('.settings-editor input[type="password"]')!.value = "sk-test"
  Array.from(settings.querySelectorAll<HTMLButtonElement>(".settings-editor-actions button"))
    .find((button) => button.textContent === "保存")!
    .click()
  await tick(20)
  Array.from(settings.querySelectorAll<HTMLButtonElement>(".settings-head button"))
    .find((button) => button.textContent === "完成")!
    .click()
  await tick(20)
}

const userTexts = (): string[] =>
  Array.from(document.querySelectorAll(".ai-user-text")).map((el) => el.textContent ?? "")

const sendButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>("#btn-ai-send")!

/** 发一条并等这一轮回复落定（等助手行出现 + 发送键从 ■ 回到 ↑） */
async function send(text: string): Promise<void> {
  const before = document.querySelectorAll(".ai-msg.assistant").length
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  input.value = text
  sendButton().click()
  await waitFor(
    () =>
      document.querySelectorAll(".ai-msg.assistant").length > before &&
      sendButton().textContent === "↑",
  )
  await tick(20)
}

async function freshConvo(): Promise<void> {
  document.querySelector<HTMLButtonElement>("#btn-new-convo")!.click()
  await tick(30)
}

beforeAll(async () => {
  // 面板 + Key 只需要一次
  await openPanelAndKey()
  mockReplies()
})

it("编辑第 1 轮：前缀保留、后缀整条换新；翻回旧版旧后缀还在", async () => {
  await freshConvo()
  await send("第一问")
  await send("第二问")
  expect(userTexts()).toEqual(["第一问", "第二问"])

  // 编辑第 1 轮 → 新分支：新后缀从这一轮重新长（第二问不在新分支上）
  document.querySelector<HTMLButtonElement>('.ai-msg.user .ai-icon-btn[aria-label="编辑"]')!.click()
  const area = document.querySelector<HTMLTextAreaElement>(".ai-user-edit")!
  expect(area.value).toBe("第一问")
  area.value = "第一问改"
  document.querySelector<HTMLButtonElement>(".ai-edit-send")!.click()
  await waitFor(() => userTexts()[0] === "第一问改")
  await waitFor(() => sendButton().textContent === "↑")
  expect(userTexts()).toEqual(["第一问改"])

  // 用户 pager 2/2 → 翻回旧输入版本：旧后缀（第二问）整条回来
  const pager = document.querySelector<HTMLElement>(".ai-msg.user .ai-versions")!
  expect(pager.textContent).toContain("2 / 2")
  pager.querySelectorAll("button")[0]!.click()
  await tick(30)
  expect(userTexts()).toEqual(["第一问", "第二问"])
})

const assistantAt = (turnIndex: number): string =>
  document.querySelector(`.ai-turn[data-turn="${turnIndex}"] .ai-msg.assistant`)?.textContent ?? ""
const replyMark = (turnIndex: number): string =>
  assistantAt(turnIndex).match(/模型回复\d+/)?.[0] ?? ""

it("重跑开新分支：新后缀跟新回复走；翻回旧回复老后缀还在；上下文只带当前路径", async () => {
  await freshConvo()
  fetchBodies.length = 0
  await send("甲问")
  const r1 = replyMark(0)
  await send("乙问")
  const rb = replyMark(1)
  expect(userTexts()).toEqual(["甲问", "乙问"])

  // 重跑第 1 轮 → 回复 2/2（pager 在回复顶部右侧），新分支后缀为空
  document.querySelector<HTMLButtonElement>('.ai-msg.assistant .ai-icon-btn[aria-label="重跑"]')!.click()
  await waitFor(() => (document.querySelector(".ai-actions-top .ai-versions")?.textContent ?? "").includes("2 / 2"))
  await waitFor(() => sendButton().textContent === "↑")
  const r2 = replyMark(0)
  expect(r2).not.toBe(r1)
  expect(userTexts()).toEqual(["甲问"])

  // 新分支继续：丙问 挂在"重跑出来的那条回复"下
  await send("丙问")
  const rc = replyMark(1)
  expect(userTexts()).toEqual(["甲问", "丙问"])

  // 翻回回复 1/2：老后缀（乙问）回来，丙问 不见；第一条回复也切回旧版
  document.querySelectorAll<HTMLButtonElement>(".ai-actions-top .ai-versions button")[0]!.click()
  await tick(30)
  expect(userTexts()).toEqual(["甲问", "乙问"])
  expect(replyMark(0)).toBe(r1)
  expect(replyMark(1)).toBe(rb)

  // 上下文：再发 丁问，请求体里只应有当前路径（甲问 + 乙问 的回复），不带另一分支
  fetchBodies.length = 0
  await send("丁问")
  const body = fetchBodies[0] ?? ""
  expect(body).toContain("甲问")
  expect(body).toContain(r1)
  expect(body).toContain("乙问")
  expect(body).toContain(rb)
  expect(body).not.toContain(r2)
  expect(body).not.toContain(rc)
  expect(body).not.toContain("丙问")
})
