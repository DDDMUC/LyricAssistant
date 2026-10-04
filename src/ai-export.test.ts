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

it("对话导出：勾选整轮 → 导出 Markdown（带思考）；全选 / 取消都能用", async () => {
  await setupKey()
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      sseResponse([sseReasoning("先想一下"), sse("回复数字1"), "data: [DONE]\n\n"]),
    ),
  )
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  const send = document.querySelector<HTMLButtonElement>("#btn-ai-send")!
  input.value = "回复数字1"
  send.click()
  await waitFor(() => send.textContent === "■")
  await waitFor(() => send.textContent === "↑")
  await waitFor(() => !!document.querySelector(".ai-turn"))

  // 进入导出选择模式
  document.querySelector<HTMLButtonElement>("#btn-ai-export")!.click()
  const bar = document.querySelector<HTMLElement>("#ai-export-bar")!
  expect(bar.hidden).toBe(false)
  expect(document.documentElement.classList.contains("ai-exporting")).toBe(true)
  expect(document.querySelectorAll(".ai-pick").length).toBe(1)
  expect(document.querySelector("#ai-export-count")!.textContent).toBe("已选择 0 组对话")
  expect(document.querySelector<HTMLButtonElement>("#btn-ai-export-go")!.disabled).toBe(true)

  // 点整轮 = 勾选
  document.querySelector<HTMLElement>(".ai-turn")!.click()
  expect(document.querySelector<HTMLElement>(".ai-turn")!.classList.contains("picked")).toBe(true)
  expect(document.querySelector("#ai-export-count")!.textContent).toBe("已选择 1 组对话")
  expect(document.querySelector<HTMLButtonElement>("#btn-ai-export-go")!.disabled).toBe(false)

  // 全选：已全选时再点是取消全选
  document.querySelector<HTMLButtonElement>("#btn-ai-export-all")!.click()
  expect(document.querySelector("#ai-export-count")!.textContent).toBe("已选择 0 组对话")
  document.querySelector<HTMLButtonElement>("#btn-ai-export-all")!.click()
  expect(document.querySelector("#ai-export-count")!.textContent).toBe("已选择 1 组对话")

  // 取消：退出模式、操作条收起
  document.querySelector<HTMLButtonElement>("#btn-ai-export-cancel")!.click()
  expect(bar.hidden).toBe(true)
  expect(document.documentElement.classList.contains("ai-exporting")).toBe(false)

  // 再来一次：勾选并导出
  document.querySelector<HTMLButtonElement>("#btn-ai-export")!.click()
  document.querySelector<HTMLElement>(".ai-turn")!.click()
  saveTextMock.mockClear()
  document.querySelector<HTMLButtonElement>("#btn-ai-export-go")!.click()
  await waitFor(() => saveTextMock.mock.calls.length > 0)
  const options = saveTextMock.mock.calls[0]![0] as { suggestedName: string; contents: string }
  expect(options.suggestedName).toMatch(/^对话-.*\.md$/)
  expect(options.contents).toContain("**你：**")
  expect(options.contents).toContain("回复数字1")
  expect(options.contents).toContain("**思考**")
  expect(options.contents).toContain("先想一下")
  expect(options.contents).toContain("共 1 组对话（当前版本）")
  // 导出完自动退出选择模式
  await waitFor(() => Boolean(document.querySelector<HTMLElement>("#ai-export-bar")!.hidden))
  expect(document.documentElement.classList.contains("ai-exporting")).toBe(false)
})
