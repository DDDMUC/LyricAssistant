import html from "../index.html?raw"
import { beforeAll, expect, it, vi } from "vitest"

const { fetchMock, saveTextMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  saveTextMock: vi.fn(async (_options: unknown) => ({
    kind: "path" as const,
    name: "对话-未命名歌曲.md",
    path: "/tmp/对话-未命名歌曲.md",
  })),
}))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))
vi.mock("./platform", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./platform")>()
  return { ...mod, saveText: saveTextMock }
})

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等到条件成立（避免在负载下用固定等待写出 flaky 测试） */
async function waitFor(cond: () => boolean, timeout = 3000): Promise<boolean> {
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

const sse = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const sseReasoning = (thinking: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thinking } }] })}\n\n`

beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

async function setupKey(): Promise<void> {
  const panel = document.querySelector<HTMLElement>("#ai-panel")!
  if (panel.hasAttribute("hidden")) document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  Array.from(document.querySelectorAll<HTMLButtonElement>(".ai-pop button"))
    .find((button) => button.textContent === "管理模型")!
    .click()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  dialog.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    input.value = "sk-test"
  })
  Array.from(dialog.querySelectorAll("button"))
    .find((button) => button.textContent === "保存")!
    .click()
  await tick(30)
}

/** 发一句话，等这一轮回复完 */
async function sendAndWait(text: string, reply: string, thinking = ""): Promise<void> {
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      sseResponse([sseReasoning(thinking), sse(reply), "data: [DONE]\n\n"].filter(Boolean)),
    ),
  )
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  const send = document.querySelector<HTMLButtonElement>("#btn-ai-send")!
  input.value = text
  send.click()
  await waitFor(() => send.textContent === "■")
  await waitFor(() => send.textContent === "↑")
}

const exportBar = () => document.querySelector<HTMLElement>("#ai-export-bar")!
const exportCount = () => document.querySelector("#ai-export-count")!.textContent
const exportGo = () => document.querySelector<HTMLButtonElement>("#btn-ai-export-go")!
const userMsg = () => document.querySelectorAll<HTMLElement>(".ai-msg.user")
const assistantMsg = () => document.querySelectorAll<HTMLElement>(".ai-msg.assistant")

it("导出的最小单位是每条消息：勾助手那条，就只导助手（带思考）", async () => {
  await setupKey()
  await sendAndWait("回复数字1", "回复数字1", "先想一下")

  document.querySelector<HTMLButtonElement>("#btn-ai-export")!.click()
  await tick(40)
  expect(exportBar().hidden).toBe(false)
  expect(document.documentElement.classList.contains("ai-exporting")).toBe(true)
  // 一轮两条消息 = 两个勾选圈（不是整轮一个）
  expect(document.querySelectorAll(".ai-pick")).toHaveLength(2)
  expect(exportCount()).toBe("已选择 0 组对话")
  expect(exportGo().disabled).toBe(true)

  // 只勾助手那条
  assistantMsg()[0]!.click()
  expect(assistantMsg()[0]!.classList.contains("picked")).toBe(true)
  expect(userMsg()[0]!.classList.contains("picked")).toBe(false)
  expect(exportCount()).toBe("已选择 1 组对话")
  expect(exportGo().disabled).toBe(false)

  saveTextMock.mockClear()
  exportGo().click()
  await waitFor(() => saveTextMock.mock.calls.length > 0)
  const options = saveTextMock.mock.calls[0]![0] as { suggestedName: string; contents: string }
  expect(options.suggestedName).toMatch(/^对话-.*\.md$/)
  expect(options.contents).toContain("**助手：**")
  expect(options.contents).toContain("**思考**")
  expect(options.contents).toContain("先想一下")
  expect(options.contents).toContain("共 1 条消息")
  // 只勾了助手：不该有「你：」那段
  expect(options.contents).not.toContain("**你：**")
  // 导出完自动退出
  await waitFor(() => Boolean(exportBar().hidden))
})

it("全选 / 计数按「组」：两轮各挑几条，组数按轮次算；取消退出", async () => {
  await sendAndWait("回复数字2", "回复数字2")

  document.querySelector<HTMLButtonElement>("#btn-ai-export")!.click()
  await tick(40)
  // 两轮 = 4 条消息 = 4 个圈
  expect(document.querySelectorAll(".ai-pick")).toHaveLength(4)
  expect(exportCount()).toBe("已选择 0 组对话")

  // 第 1 轮的助手 + 第 2 轮的用户 → 碰了两个轮次 = 2 组
  assistantMsg()[0]!.click()
  userMsg()[1]!.click()
  expect(exportCount()).toBe("已选择 2 组对话")

  // 全选 → 取消全选
  document.querySelector<HTMLButtonElement>("#btn-ai-export-all")!.click()
  expect(exportCount()).toBe("已选择 2 组对话")
  expect(document.querySelectorAll<HTMLElement>(".ai-msg.picked")).toHaveLength(4)
  expect(document.querySelector<HTMLButtonElement>("#btn-ai-export-all")!.classList.contains("all")).toBe(true)
  document.querySelector<HTMLButtonElement>("#btn-ai-export-all")!.click()
  expect(exportCount()).toBe("已选择 0 组对话")
  expect(exportGo().disabled).toBe(true)

  // 取消：退出模式、操作条收起
  document.querySelector<HTMLButtonElement>("#btn-ai-export-cancel")!.click()
  await tick(40)
  expect(exportBar().hidden).toBe(true)
  expect(document.documentElement.classList.contains("ai-exporting")).toBe(false)
})
