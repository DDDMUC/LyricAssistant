import { beforeEach, describe, expect, it, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

import {
  defaultAiSettings,
  loadAiSettings,
  maxTokensFor,
  modelLabel,
  requestChat,
  resolveTarget,
  saveAiSettings,
  supportsEffortFor,
  testAiConnection,
} from "./ai-client"

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
})

describe("AI 设置", () => {
  it("默认内置 DeepSeek 和 MiMo", () => {
    const settings = defaultAiSettings()
    expect(settings.providers.map((provider) => provider.id)).toEqual([
      "deepseek",
      "mimo",
      "custom",
    ])
    expect(settings.providerId).toBe("deepseek")
    expect(settings.model).toBe("deepseek-flash")
    expect(settings.effort).toBe("default")
    expect(settings.maxOutput).toBe("none")

    const deepseek = settings.providers[0]
    expect(deepseek.baseUrl).toBe("https://api.deepseek.com")
    expect(deepseek.models).toEqual(["deepseek-flash", "deepseek-v4-pro"])
    expect(deepseek.auth).toBe("bearer")
    expect(deepseek.tokenParam).toBe("max_tokens")
    expect(deepseek.supportsEffort).toBe(true)

    const mimo = settings.providers[1]
    expect(mimo.baseUrl).toBe("https://api.xiaomimimo.com/v1")
    expect(mimo.models).toEqual(["mimo-v2.6-flash", "mimo-v2.6-pro"])
    expect(mimo.auth).toBe("both")
    expect(mimo.tokenParam).toBe("max_completion_tokens")
    expect(mimo.supportsEffort).toBe(false)
  })

  it("保存后能读回；未知模型 / 等级 / provider 都回退", () => {
    const settings = defaultAiSettings()
    settings.providers[0].apiKey = "sk-test"
    settings.providers[0].models = ["deepseek-flash", "my-model"]
    settings.model = "my-model"
    settings.effort = "max"
    settings.maxOutput = "auto"
    saveAiSettings(settings)

    const loaded = loadAiSettings()
    expect(loaded.providers[0].apiKey).toBe("sk-test")
    expect(loaded.providers[0].models).toEqual(["deepseek-flash", "my-model"])
    expect(loaded.model).toBe("my-model")
    expect(loaded.effort).toBe("max")
    expect(loaded.maxOutput).toBe("auto")

    const raw = JSON.parse(localStorage.getItem("cige-grid-ai") ?? "{}") as Record<
      string,
      unknown
    >
    raw.model = "不存在的模型"
    localStorage.setItem("cige-grid-ai", JSON.stringify(raw))
    expect(loadAiSettings().model).toBe("deepseek-flash")

    raw.effort = "ultra"
    localStorage.setItem("cige-grid-ai", JSON.stringify(raw))
    expect(loadAiSettings().effort).toBe("default")

    raw.providerId = "nope"
    localStorage.setItem("cige-grid-ai", JSON.stringify(raw))
    expect(loadAiSettings().providerId).toBe("deepseek")
  })

  it("坏数据回退默认", () => {
    localStorage.setItem("cige-grid-ai", "{oops")
    const settings = loadAiSettings()
    expect(settings.providerId).toBe("deepseek")
    expect(settings.providers[0].apiKey).toBe("")
    expect(settings.model).toBe("deepseek-flash")
  })
})

describe("resolveTarget", () => {
  it("地址或模型为空时返回 null", () => {
    const settings = defaultAiSettings()
    expect(resolveTarget(settings)).not.toBeNull()
    settings.providers[0].baseUrl = ""
    expect(resolveTarget(settings)).toBeNull()
    settings.providers[0].baseUrl = "https://api.deepseek.com"
    settings.model = ""
    expect(resolveTarget(settings)).toBeNull()
  })

  it("带上 provider 的鉴权、token 参数与推理等级", () => {
    const settings = defaultAiSettings()
    settings.providerId = "mimo"
    settings.model = "mimo-v2.6-pro"
    settings.effort = "high"
    const mimo = resolveTarget(settings)
    expect(mimo?.auth).toBe("both")
    expect(mimo?.tokenParam).toBe("max_completion_tokens")
    expect(mimo?.supportsEffort).toBe(false)
    expect(mimo?.effort).toBe("high")
    expect(mimo?.model).toBe("mimo-v2.6-pro")
  })
})

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

function targetOf(providerId: string, model: string, effort: "default" | "none" | "low" | "high" | "max") {
  const settings = defaultAiSettings()
  settings.providerId = providerId
  settings.model = model
  settings.effort = effort
  settings.providers.forEach((provider) => {
    provider.apiKey = `sk-${provider.id}`
  })
  return resolveTarget(settings)!
}

describe("requestChat", () => {
  it("流式：拆出 reasoning_content 与 content，带上思考参数", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"一下"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"北望"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"去"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    )
    const text = await requestChat(
      targetOf("deepseek", "deepseek-flash", "max"),
      [{ role: "user", content: "hi" }],
      {
        onDelta: () => {},
        onReasoning: () => {},
        maxTokens: 777,
      },
    )
    expect(text).toBe("北望去")

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe("https://api.deepseek.com/chat/completions")
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body.thinking).toEqual({ type: "enabled" })
    expect(body.reasoning_effort).toBe("max")
    expect(body.max_tokens).toBe(777)
    expect(body.max_completion_tokens).toBeUndefined()
    expect(init.headers.Authorization).toBe("Bearer sk-deepseek")
    expect(init.headers["api-key"]).toBeUndefined()
  })

  it("MiMo：双鉴权头 + max_completion_tokens，不发 reasoning_effort", async () => {
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(
      targetOf("mimo", "mimo-v2.6-pro", "high"),
      [{ role: "user", content: "hi" }],
      { onDelta: () => {}, maxTokens: 777 },
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe("https://api.xiaomimimo.com/v1/chat/completions")
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.max_completion_tokens).toBe(777)
    expect(body.max_tokens).toBeUndefined()
    expect(body.thinking).toEqual({ type: "enabled" })
    expect(body.reasoning_effort).toBeUndefined()
    expect(init.headers.Authorization).toBe("Bearer sk-mimo")
    expect(init.headers["api-key"]).toBe("sk-mimo")
  })

  it("Default 等级：不塞 thinking / reasoning_effort；None 只关思考", async () => {
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(targetOf("deepseek", "deepseek-flash", "default"), [{ role: "user", content: "hi" }], {
      onDelta: () => {},
    })
    const defaultBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(defaultBody.thinking).toBeUndefined()
    expect(defaultBody.reasoning_effort).toBeUndefined()

    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(targetOf("deepseek", "deepseek-flash", "none"), [{ role: "user", content: "hi" }], {
      onDelta: () => {},
    })
    const noneBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(noneBody.thinking).toEqual({ type: "disabled" })
    expect(noneBody.reasoning_effort).toBeUndefined()
  })

  it("额度传 null 时请求体里不带 token 上限", async () => {
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(
      targetOf("deepseek", "deepseek-flash", "default"),
      [{ role: "user", content: "hi" }],
      { onDelta: () => {}, maxTokens: null },
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(body.max_tokens).toBeUndefined()
    expect(body.max_completion_tokens).toBeUndefined()
  })

  it("HTTP 错误翻成人话", async () => {
    fetchMock.mockResolvedValue(new Response("quota exceeded", { status: 429 }))
    await expect(
      requestChat(targetOf("deepseek", "deepseek-flash", "default"), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/429/)
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }))
    await expect(
      requestChat(targetOf("deepseek", "deepseek-flash", "default"), [{ role: "user", content: "hi" }]),
    ).rejects.toThrow(/401/)
  })
})

describe("testAiConnection", () => {
  it("/models 通就算成功", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }))
    await expect(testAiConnection(targetOf("deepseek", "deepseek-flash", "default"))).resolves.toContain(
      "连接成功",
    )
  })

  it("地址不对时报错", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }))
    await expect(testAiConnection(targetOf("deepseek", "deepseek-flash", "default"))).rejects.toThrow(
      /500/,
    )
  })
})

describe("maxTokensFor（思考会给思维链留额度）", () => {
  it("思考比不思考给得多，max 又比 high 多", () => {
    const cells = 8
    const noThink = maxTokensFor(cells, false, "high") ?? 0
    const think = maxTokensFor(cells, true, "high") ?? 0
    const thinkMax = maxTokensFor(cells, true, "max") ?? 0
    expect(noThink).toBe(1024)
    expect(think).toBeGreaterThan(noThink)
    expect(thinkMax).toBeGreaterThan(think)
  })

  it("长词格按格数加，且有上限", () => {
    expect(maxTokensFor(4000, false, "high")).toBe(16384)
    expect(maxTokensFor(4000, true, "high")).toBe(32704)
    expect(maxTokensFor(4000, true, "max")).toBe(40896)
  })

  it("「不限制」不传额度", () => {
    expect(maxTokensFor(4000, true, "max", "none")).toBeNull()
    expect(maxTokensFor(8, false, "high", "none")).toBeNull()
  })
})

describe("模型能力（不是写死在 UI 上）", () => {
  it("模型显示名映射", () => {
    expect(modelLabel("deepseek-flash")).toBe("DeepSeek V4.1 Flash")
    expect(modelLabel("deepseek-v4-pro")).toBe("DeepSeek V4 Pro")
    expect(modelLabel("mimo-v2.6-pro")).toBe("MiMo V2.6 Pro")
    expect(modelLabel("my-own-model")).toBe("my-own-model")
  })

  it("已知模型覆盖 provider 的强度开关，未知模型按 provider 走", () => {
    expect(supportsEffortFor("deepseek-flash", false)).toBe(true)
    expect(supportsEffortFor("mimo-v2.6-pro", true)).toBe(false)
    expect(supportsEffortFor("brand-new-model", true)).toBe(true)
    expect(supportsEffortFor("brand-new-model", false)).toBe(false)

    const settings = defaultAiSettings()
    settings.providers[0].models = ["deepseek-flash", "brand-new"]
    settings.model = "brand-new"
    expect(resolveTarget(settings)?.supportsEffort).toBe(true)
  })

  it("自定义接口：没勾思考参数就什么都不发", async () => {
    const settings = defaultAiSettings()
    const custom = settings.providers.find((provider) => provider.id === "custom")!
    custom.baseUrl = "https://example.com/v1"
    custom.models = ["whatever"]
    custom.apiKey = "sk-x"
    custom.supportsThinking = false
    custom.supportsEffort = false
    settings.providerId = "custom"
    settings.model = "whatever"
    settings.effort = "max"
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(resolveTarget(settings)!, [{ role: "user", content: "hi" }], {
      onDelta: () => {},
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(body.thinking).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })

  it("自定义接口：勾了 thinking 就只发开关", async () => {
    const settings = defaultAiSettings()
    const custom = settings.providers.find((provider) => provider.id === "custom")!
    custom.baseUrl = "https://example.com/v1"
    custom.models = ["whatever"]
    custom.supportsThinking = true
    custom.supportsEffort = false
    settings.providerId = "custom"
    settings.model = "whatever"
    settings.effort = "low"
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(resolveTarget(settings)!, [{ role: "user", content: "hi" }], {
      onDelta: () => {},
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: "enabled" })
    expect(body.reasoning_effort).toBeUndefined()
  })
})
