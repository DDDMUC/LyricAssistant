import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const openAiSettingsDialog = () => {
  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  Array.from(document.querySelectorAll<HTMLButtonElement>(".ai-pop button"))
    .find((button) => button.textContent === "管理模型")!
    .click()
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

/** 桌面环境（假装有 Tauri 标记）：AI 设置里每个 Key 行都要有「复制」按钮，点了有反馈 */
beforeAll(async () => {
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? ""
  document.body.innerHTML = body
  await import("./main")
})

it("每个 Key 行都有复制按钮，点击有反馈", async () => {
  document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  openAiSettingsDialog()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")
  expect(dialog).toBeTruthy()

  const keyRows = Array.from(dialog!.querySelectorAll<HTMLElement>(".dialog-field")).filter(
    (row) => row.textContent?.startsWith("Key"),
  )
  expect(keyRows.length).toBeGreaterThanOrEqual(3)
  for (const row of keyRows) {
    expect(row.querySelector(".dialog-inline-btn")?.textContent).toBe("复制")
  }

  const keyInput = keyRows[0].querySelector("input")!
  keyInput.value = "sk-test-123"
  const copyBtn = keyRows[0].querySelector<HTMLButtonElement>(".dialog-inline-btn")!
  copyBtn.click()
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(["已复制 ✓", "复制失败"]).toContain(copyBtn.textContent)

  dialog!.close()
})

it("等级芯片跟随模型能力：MiMo 是 low/medium/high（最高 high），DeepSeek 是 low/high/max，各记各的", async () => {
  const panel = document.querySelector<HTMLElement>("#ai-panel")!
  if (panel.hasAttribute("hidden")) document.querySelector<HTMLButtonElement>("#btn-ai")!.click()
  const effortChip = document.querySelector<HTMLButtonElement>("#ai-effort-chip")!
  expect(effortChip.textContent).toContain("Default")

  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  const pick = (text: string) => {
    const item = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".ai-pop button"),
    ).find((button) => button.textContent?.includes(text))
    expect(item).toBeTruthy()
    item!.click()
  }
  pick("MiMo V2.6 Flash")
  expect(effortChip.textContent).toContain("Default")

  effortChip.click()
  const levels = Array.from(document.querySelectorAll<HTMLButtonElement>(".ai-pop button")).map(
    (button) => button.textContent?.replace("✓", ""),
  )
  expect(levels).toEqual(["Default", "None", "Low", "Medium", "High"])
  pick("High")
  expect(effortChip.textContent).toContain("High")

  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  pick("DeepSeek V4.1 Flash")
  expect(effortChip.textContent).toContain("Default")

  document.querySelector<HTMLButtonElement>("#ai-model-chip")!.click()
  pick("MiMo V2.6 Flash")
  expect(effortChip.textContent).toContain("High")
})

it("输入版本 / 回复版本两条链：编辑追加输入版本，重跑追加回复版本", async () => {
  expect(document.querySelector("#btn-ai-expand")).toBeTruthy()
  // 先把 Key 填上并保存，否则发送会被拦下
  openAiSettingsDialog()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  dialog.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    input.value = "sk-test"
  })
  Array.from(dialog.querySelectorAll("button"))
    .find((button) => button.textContent === "保存")!
    .click()
  await tick(30)

  const setReplyMock = () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"{\\"sentences\\":[]}"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    )
  }
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  input.value = "写一段古风"
  setReplyMock()
  document.querySelector<HTMLButtonElement>("#btn-ai-send")!.click()
  await tick(80)

  // 用户消息直接是气泡全文（照参考，没有编号圈）
  expect(document.querySelector(".ai-user-text")?.textContent).toBe("写一段古风")
  expect(document.querySelector(".ai-user-num")).toBeNull()
  // 都只有 1 版时，两处翻页都不显示
  expect(document.querySelector(".ai-msg.user .ai-versions")).toBeNull()
  expect(document.querySelector(".ai-msg.assistant .ai-versions")).toBeNull()

  // 重跑一次 → 助手行出现回复版本 2 / 2，输入行没有
  document
    .querySelector<HTMLButtonElement>('.ai-msg.assistant .ai-icon-btn[aria-label="重跑"]')!
    .click()
  await tick(100)
  expect(document.querySelector(".ai-msg.assistant .ai-versions")?.textContent).toContain("2 / 2")
  expect(document.querySelector(".ai-msg.user .ai-versions")).toBeNull()

  // 编辑重发 → 输入行出现 2 / 2（旧版留档），新输入版本的回复是独立的一条链
  document.querySelector<HTMLButtonElement>('.ai-msg.user .ai-icon-btn[aria-label="编辑"]')!.click()
  const area = document.querySelector<HTMLTextAreaElement>(".ai-user-edit")!
  expect(area.value).toBe("写一段古风")
  area.value = "写一段现代"
  document.querySelector<HTMLButtonElement>(".ai-edit-send")!.click()
  await tick(100)
  expect(document.querySelectorAll(".ai-user-text").length).toBe(1)
  // 编辑发出去后，气泡直接显示新文字
  expect(document.querySelector(".ai-user-text")?.textContent).toBe("写一段现代")
  const userPager = document.querySelector<HTMLElement>(".ai-msg.user .ai-versions")!
  expect(userPager.textContent).toContain("2 / 2")
  expect(document.querySelector(".ai-msg.assistant .ai-versions")).toBeNull()

  // 翻回旧输入版本：文字和它当时的回复一起切回来（那条有 2 个回复版本）
  userPager.querySelector<HTMLButtonElement>("button")!.click()
  await tick(30)
  expect(document.querySelector(".ai-user-text")?.textContent).toBe("写一段古风")
  expect(document.querySelector(".ai-msg.assistant .ai-versions")?.textContent).toContain("2 / 2")
})

it("对话记录：标题自动、分组、新建/切换/删除、持久化", async () => {
  // Key（前面测试已存过；保险起见再存一次）
  openAiSettingsDialog()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  dialog.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    input.value = "sk-test"
  })
  Array.from(dialog.querySelectorAll("button"))
    .find((button) => button.textContent === "保存")!
    .click()
  await tick(30)

  const setReplyMock = () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"{\\"sentences\\":[]}"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    )
  }

  // 新建一条干净对话（侧边栏的 ＋），发一句 → 标题自动取第一句话
  document.querySelector<HTMLButtonElement>("#btn-new-convo")!.click()
  await tick(30)
  const input = document.querySelector<HTMLTextAreaElement>("#ai-input")!
  input.value = "测试对话标题专用句"
  setReplyMock()
  document.querySelector<HTMLButtonElement>("#btn-ai-send")!.click()
  await tick(80)

  const rows = () => Array.from(document.querySelectorAll<HTMLElement>(".ai-convo-row"))
  const findRow = (text: string) =>
    rows().find((row) => row.querySelector(".ai-convo-title")?.textContent === text)

  expect(findRow("测试对话标题专用句")).toBeTruthy()
  expect(document.querySelectorAll(".doc-card").length).toBeGreaterThanOrEqual(1)

  // 持久化：localStorage 里有这条、标题对、有 1 轮对话
  const stored = JSON.parse(localStorage.getItem("cige-grid-ai-convos") ?? "{}") as {
    convos?: { title?: string; turns?: unknown[] }[]
  }
  const saved = stored.convos?.find((convo) => convo.title === "测试对话标题专用句")
  expect(saved).toBeTruthy()
  expect(saved?.turns?.length).toBe(1)

  // 新建第二条（标题还是「新会话」）→ 列表里两条都有
  document.querySelector<HTMLButtonElement>("#btn-new-convo")!.click()
  await tick(30)
  expect(findRow("新会话")).toBeTruthy()

  // 切回第一条 → 面板里能看到那条输入气泡
  findRow("测试对话标题专用句")!.click()
  await tick(30)
  expect(document.querySelector(".ai-user-text")).toBeTruthy()

  // 删除空对话（弹确认）
  findRow("新会话")!.querySelector<HTMLButtonElement>(".ai-convo-del")!.click()
  await tick(30)
  Array.from(document.querySelectorAll<HTMLButtonElement>('dialog[open] button'))
    .find((button) => button.textContent === "删除")!
    .click()
  await tick(30)
  expect(findRow("新会话")).toBeFalsy()
})
