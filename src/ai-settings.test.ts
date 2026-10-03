import html from "../index.html?raw"
import { expect, it, beforeAll, vi } from "vitest"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { getAllWindows } from "@tauri-apps/api/window"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

// AI 面板已拆成独立窗口：给 Tauri 的窗口 / 事件 API 打桩（happy-dom 里没有真 IPC）
const aiListeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>())
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn((channel: string, handler: (event: { payload: unknown }) => void) => {
    aiListeners.set(channel, handler)
    return Promise.resolve(() => {})
  }),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(() => Promise.resolve([])),
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(() => Promise.resolve()),
    hide: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    outerSize: vi.fn(() => Promise.resolve({ width: 520, height: 720 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    once: vi.fn(() => Promise.resolve()),
  })),
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  // 必须是可 new 的：构造时返回带 once 的假窗口（返回值对象会被 new 采用）
  WebviewWindow: vi.fn(function WebviewWindow() {
    return { once: vi.fn(() => Promise.resolve()) }
  }),
}))

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

it("导入原文面板开合会挂 source-open（进度条也避开）", () => {
  const btn = document.querySelector<HTMLButtonElement>("#btn-source")!
  btn.click()
  expect(document.documentElement.classList.contains("source-open")).toBe(true)
  btn.click()
  expect(document.documentElement.classList.contains("source-open")).toBe(false)
})

it("AI 面板默认内嵌：AI 按钮开合面板，不建窗；点「拆出」才拆", async () => {
  const btn = document.querySelector<HTMLButtonElement>("#btn-ai")!
  const panel = document.querySelector<HTMLElement>("#ai-panel")!
  const detach = document.querySelector<HTMLButtonElement>("#btn-ai-detach")!
  vi.mocked(getAllWindows).mockResolvedValue([])
  vi.mocked(WebviewWindow).mockClear()

  // 默认内嵌：点 AI 就是开合面板（不碰窗口 API）
  btn.click()
  await tick(0)
  expect(panel.hasAttribute("hidden")).toBe(false)
  expect(document.documentElement.classList.contains("ai-detached")).toBe(false)
  expect(WebviewWindow).not.toHaveBeenCalled()
  btn.click()
  await tick(0)
  expect(panel.hasAttribute("hidden")).toBe(true)

  // 点「拆出」才建独立窗（label = ai-<docId>，URL 带 ?win=ai&doc=）
  btn.click()
  await tick(0)
  detach.click()
  await tick(0)
  expect(getAllWindows).toHaveBeenCalled()
  expect(WebviewWindow).toHaveBeenCalledTimes(1)
  const [label, options] = vi.mocked(WebviewWindow).mock.calls[0] as [
    string,
    { url: string; title: string },
  ]
  expect(label.startsWith("ai-")).toBe(true)
  expect(options.url).toContain("?win=ai&doc=")
  // 默认尺寸：宽 = 内嵌面板宽（默认 400）；高 = 拆出时应用窗口的高度（钳到屏幕内）
  const aiOptions = options as unknown as { width: number; height: number }
  expect(aiOptions.width).toBe(400)
  const expectedHeight = Math.min(
    Math.round(window.outerHeight || window.innerHeight || 780),
    Math.max(300, (window.screen.availHeight || 780) - 40),
  )
  expect(aiOptions.height).toBe(expectedHeight)
  // 拆出后：主窗口的内嵌面板让位
  expect(document.documentElement.classList.contains("ai-detached")).toBe(true)
  expect(panel.hasAttribute("hidden")).toBe(true)

  // 已经有这个窗了就 show + focus，不再新建
  vi.mocked(getAllWindows).mockResolvedValue([
    Object.assign(Object.create(Object.getPrototypeOf(btn)), {
      label,
      show: vi.fn(() => Promise.resolve()),
      setFocus: vi.fn(() => Promise.resolve()),
    }),
  ])
  btn.click()
  await tick(0)
  expect(WebviewWindow).toHaveBeenCalledTimes(1)

  // AI 窗点「放回」→ 主窗口收回内嵌（detached 清掉、面板恢复）
  const redock = aiListeners.get("ai-redock")
  expect(redock).toBeTruthy()
  redock!({ payload: { docId: "doc-1" } })
  await tick(0)
  expect(document.documentElement.classList.contains("ai-detached")).toBe(false)
  expect(panel.hasAttribute("hidden")).toBe(false)
})

it("工具栏「帮助」：弹窗里有使用说明、快捷键和导出诊断日志", () => {
  document.querySelector<HTMLButtonElement>("#btn-help")!.click()
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]")!
  expect(dialog.textContent).toContain("使用说明")
  expect(dialog.textContent).toContain("快捷键")
  expect(dialog.textContent).toContain("只收汉字")
  expect(dialog.textContent).toContain("韵脚")
  const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent)
  expect(buttons).toContain("导出诊断日志")
  expect(buttons).toContain("知道了")
  dialog.close()
  expect(document.querySelector("dialog[open]")).toBeNull()

  // 诊断按钮已经从 AI 设置里挪到帮助里
  openAiSettingsDialog()
  const settings = document.querySelector<HTMLDialogElement>("dialog[open]")!
  expect(
    Array.from(settings.querySelectorAll("button")).some((b) => b.textContent === "导出诊断日志"),
  ).toBe(false)
  settings.close()
})
