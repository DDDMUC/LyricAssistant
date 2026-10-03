import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等到条件成立（避免在负载下用固定等待写出 flaky 测试） */
async function waitFor(cond: () => boolean, timeout = 2000): Promise<boolean> {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeout) await tick(20)
  return cond()
}

/** 慢速 SSE：chunk 之间留间隔，好在流式中途观察状态 */
function sseResponse(chunks: string[], gapMs: number): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
        if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs))
      }
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

const sse = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

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

it("流式回复按行预览，delta 合并后 DOM 重建次数远小于 chunk 数", async () => {
  await setupKey()

  const sentence = document.querySelector<HTMLElement>(".sentence[data-id]")!
  const id = sentence.dataset.id!
  const size = sentence.querySelectorAll(".cell, .cell-input").length
  const text = "微风吹过山冈上夜色里星光闪亮".slice(0, size)
  const head = `{"sentences":[{"id":"${id}","text":"`
  const tail = `"}]}`

  // JSON 头尾切细 + 句子完成后继续灌无用 delta（模拟流还在继续）
  const chunks = [
    sse(head.slice(0, 6)),
    sse(head.slice(6, 14)),
    sse(head.slice(14)),
    sse(text.slice(0, 2)),
    sse(text.slice(2, 5)),
    sse(text.slice(5)),
    sse(tail),
    ...Array.from({ length: 8 }, () => sse(" ")),
    "data: [DONE]\n\n",
  ]

  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve(sseResponse(chunks, 20)))

  const spy = vi.spyOn(Element.prototype, "replaceChildren")
  const lineRebuilds = () =>
    spy.mock.instances.filter((el) => (el as Element).classList?.contains("ai-lines")).length

  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  input.value = "写一句"
  document.querySelector<HTMLButtonElement>("#btn-ai-send")!.click()

  // 流式期间就已经是按行预览（不是一坨原始 JSON 文本）
  await waitFor(() => !!document.querySelector(".ai-msg.assistant .ai-line-text"))
  const streamingLines = document.querySelector(".ai-msg.assistant .ai-lines")
  expect(streamingLines).toBeTruthy()
  expect(streamingLines!.querySelector(".ai-line-text")?.textContent).toContain(text)

  await tick(600)
  const finalLines = Array.from(
    document.querySelectorAll<HTMLElement>(".ai-msg.assistant .ai-line-text"),
  ).map((el) => el.textContent ?? "")
  expect(finalLines.some((line) => line.includes(text))).toBe(true)
  expect(chunks.length).toBeGreaterThanOrEqual(12)
  expect(lineRebuilds()).toBeLessThanOrEqual(6)
  spy.mockRestore()
})

it("散文 / 聊天回复按 Markdown 渲染（结构 + 链接安全属性）", async () => {
  await setupKey()
  const prose = [
    "你好，**收到**！",
    "",
    "> 这是引用",
    "",
    "1. 第一",
    "2. 第二",
    "",
    "[去官网](https://example.com)",
  ].join("\n")
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(sseResponse([sse(prose), "data: [DONE]\n\n"], 10)),
  )
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  const send = document.querySelector<HTMLButtonElement>("#btn-ai-send")!
  input.value = "你好"
  send.click()

  // 忙态：按钮变 ■；生成结束回到 ↑（不靠 disabled，那个一直不置）
  await waitFor(() => send.textContent === "■")
  await waitFor(() => send.textContent === "↑")

  await waitFor(() => !!document.querySelector(".ai-msg.assistant .ai-md strong"))

  const assistants = document.querySelectorAll<HTMLElement>(".ai-msg.assistant")
  const last = assistants[assistants.length - 1]
  const md = last.querySelector<HTMLElement>(".ai-md")!
  expect(md.querySelector("strong")?.textContent).toBe("收到")
  expect(md.querySelector("blockquote")?.textContent).toContain("这是引用")
  expect(md.querySelectorAll("ol li")).toHaveLength(2)
  const link = md.querySelector("a")!
  expect(link.getAttribute("href")).toBe("https://example.com")
  expect(link.getAttribute("target")).toBe("_blank")
  expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  // 结构化句子（填词）那条路不该被 Markdown 接管
  expect(last.querySelector(".ai-lines")).toBeNull()
})

it("生成中往上翻就不拽回底部；滚回底部又继续跟随", async () => {
  const box = document.querySelector<HTMLElement>("#ai-messages")!
  Object.defineProperty(box, "scrollHeight", { get: () => 1000, configurable: true })
  Object.defineProperty(box, "clientHeight", { get: () => 300, configurable: true })

  const reply = "你好呀，随便聊聊写词押韵这些事"
  const chunks = [
    ...Array.from({ length: 6 }, (_, i) => sse(reply.slice(i * 2, i * 2 + 2))),
    "data: [DONE]\n\n",
  ]
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve(sseResponse(chunks, 50)))

  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  input.value = "随便聊聊"
  document.querySelector<HTMLButtonElement>("#btn-ai-send")!.click()
  await tick(60)

  // 用户往上翻 → 后续 delta 不再把视图拽回底部
  box.scrollTop = 100
  box.dispatchEvent(new Event("scroll"))
  await tick(90)
  expect(box.scrollTop).toBe(100)

  // 滚回底部附近 → 重新跟随
  box.scrollTop = 650
  box.dispatchEvent(new Event("scroll"))
  await tick(90)
  expect(box.scrollTop).toBe(1000)

  await tick(300)
})

it("滚轮跟着鼠标位置走：悬停 AI 面板非消息区也滚消息区", () => {
  const messages = document.querySelector<HTMLElement>("#ai-messages")!
  const composer = document.querySelector<HTMLElement>(".ai-composer")!
  const head = document.querySelector<HTMLElement>(".ai-head")!

  const wheelTo = (el: Element, deltaY: number) => {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event
  }

  messages.scrollTop = 0
  expect(wheelTo(composer, 120).defaultPrevented).toBe(true)
  expect(messages.scrollTop).toBe(120)
  expect(wheelTo(head, 80).defaultPrevented).toBe(true)
  expect(messages.scrollTop).toBe(200)
  // 消息区自己会滚，不抢
  expect(wheelTo(messages, 120).defaultPrevented).toBe(false)
})

it("流式期间助手行的翻页键就能按（不用等生成完）", async () => {
  await setupKey()

  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  const send = document.querySelector<HTMLButtonElement>("#btn-ai-send")!
  const lastAssistant = () => {
    const rows = document.querySelectorAll<HTMLElement>(".ai-msg.assistant")
    return rows[rows.length - 1]
  }
  const lastPager = () => lastAssistant()?.querySelector<HTMLElement>(".ai-versions") ?? null

  // 第一版：快速完成
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(sseResponse([sse("旧回复"), "data: [DONE]\n\n"], 0)),
  )
  input.value = "来一版"
  send.click()
  await tick(150)
  expect(lastAssistant().textContent).toContain("旧回复")

  // 重跑：慢速流，中途检查翻页键可用
  fetchMock.mockReset()
  fetchMock.mockImplementation(() =>
    Promise.resolve(sseResponse([sse("新"), sse("回复"), sse("内容"), "data: [DONE]\n\n"], 70)),
  )
  lastAssistant().querySelector<HTMLButtonElement>('.ai-icon-btn[aria-label="重跑"]')!.click()
  await waitFor(() => !!lastPager())

  expect(lastPager()!.textContent).toContain("2 / 2")

  // 生成还没完，就能翻回第一版看旧回复
  lastPager()!.querySelectorAll<HTMLButtonElement>("button")[0].click()
  await tick(40)
  expect(lastPager()!.textContent).toContain("1 / 2")
  expect(lastAssistant().textContent).toContain("旧回复")
  expect(lastAssistant().textContent).not.toContain("新回复内容")

  // 等流式在后台跑完，翻到第二版，完整内容在
  await tick(500)
  lastPager()!.querySelectorAll<HTMLButtonElement>("button")[1].click()
  await tick(40)
  expect(lastAssistant().textContent).toContain("新回复内容")
})
