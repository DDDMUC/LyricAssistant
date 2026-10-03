import { beforeEach, describe, expect, it, vi } from "vitest"

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }))

import {
  defaultAiSettings,
  effortLevelsFor,
  effortOf,
  loadAiSettings,
  maxTokensFor,
  modelLabel,
  requestChat,
  resolveTarget,
  saveAiSettings,
  supportsEffortFor,
  testAiConnection,
  withEffort,
  type EffortLevel,
} from "./ai-client"

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
})

describe("AI 设置", () => {
  it("默认内置 DeepSeek 和 MiMo + 照 DSH 目录的 48 家（跳过目录里的 deepseek / xiaomi），自定义在最后", () => {
    const settings = defaultAiSettings()
    const ids = settings.providers.map((provider) => provider.id)
    expect(ids.slice(0, 2)).toEqual(["deepseek", "mimo"])
    expect(ids[ids.length - 1]).toBe("custom")
    expect(ids).toHaveLength(51)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain("xiaomi")
    expect(ids.filter((id) => id === "deepseek")).toHaveLength(1)
    expect(ids).toContain("openai")
    expect(ids).toContain("anthropic")
    expect(ids).toContain("opencode-zen")

    const openai = settings.providers.find((provider) => provider.id === "openai")!
    expect(openai.api).toBe("openai-completions")
    expect(openai.keyUrl).toContain("platform.openai.com")
    expect(openai.models.length).toBeGreaterThan(0)
    const anthropic = settings.providers.find((provider) => provider.id === "anthropic")!
    expect(anthropic.api).toBe("anthropic-messages")
    expect(anthropic.baseUrl).toBe("https://api.anthropic.com")

    expect(settings.providerId).toBe("deepseek")
    expect(settings.model).toBe("deepseek-flash")
    expect(settings.efforts).toEqual({})
    expect(effortOf(settings)).toBe("default")
    expect(settings.maxOutput).toBe("none")

    const deepseek = settings.providers[0]
    expect(deepseek.baseUrl).toBe("https://api.deepseek.com")
    expect(deepseek.models).toEqual(["deepseek-flash", "deepseek-v4-pro"])
    expect(deepseek.auth).toBe("bearer")
    expect(deepseek.tokenParam).toBe("max_tokens")
    expect(deepseek.supportsEffort).toBe(true)

    const mimo = settings.providers[1]
    expect(mimo.baseUrl).toBe("https://api.xiaomimimo.com/v1")
    expect(mimo.models).toEqual([
      "mimo-v2.6-flash",
      "mimo-v2.6-pro",
      "mimo-v2.6-pro-ultraspeed",
    ])
    expect(mimo.auth).toBe("both")
    expect(mimo.tokenParam).toBe("max_completion_tokens")
    expect(mimo.supportsEffort).toBe(false)
  })

  it("保存后能读回；未知模型 / 等级 / provider 都回退", () => {
    const settings = defaultAiSettings()
    settings.providers[0].apiKey = "sk-test"
    settings.providers[0].models = ["deepseek-flash", "my-model"]
    settings.model = "my-model"
    settings.efforts["my-model"] = "max"
    settings.maxOutput = "auto"
    saveAiSettings(settings)

    const loaded = loadAiSettings()
    expect(loaded.providers[0].apiKey).toBe("sk-test")
    expect(loaded.providers[0].models).toEqual(["deepseek-flash", "my-model"])
    expect(loaded.model).toBe("my-model")
    expect(effortOf(loaded)).toBe("max")
    expect(loaded.maxOutput).toBe("auto")

    const raw = JSON.parse(localStorage.getItem("cige-grid-ai") ?? "{}") as Record<
      string,
      unknown
    >
    raw.model = "不存在的模型"
    localStorage.setItem("cige-grid-ai", JSON.stringify(raw))
    expect(loadAiSettings().model).toBe("deepseek-flash")

    raw.efforts = { "deepseek-flash": "ultra" }
    localStorage.setItem("cige-grid-ai", JSON.stringify(raw))
    expect(effortOf(loadAiSettings())).toBe("default")

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

  it("推理等级按模型各记各的；老格式（单个 effort）自动迁移", () => {
    let settings = defaultAiSettings()
    settings = withEffort(settings, "max")
    expect(effortOf(settings)).toBe("max")

    settings = { ...settings, model: "mimo-v2.6-pro" }
    expect(effortOf(settings)).toBe("default")
    settings = withEffort(settings, "none")
    expect(effortOf(settings)).toBe("none")

    settings = { ...settings, model: "deepseek-flash" }
    expect(effortOf(settings)).toBe("max")

    localStorage.setItem(
      "cige-grid-ai",
      JSON.stringify({ model: "deepseek-flash", effort: "high", providers: [] }),
    )
    expect(effortOf(loadAiSettings())).toBe("high")
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
    settings.efforts["mimo-v2.6-pro"] = "high"
    const mimo = resolveTarget(settings)
    expect(mimo?.auth).toBe("both")
    expect(mimo?.tokenParam).toBe("max_completion_tokens")
    expect(mimo?.supportsEffort).toBe(true)
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

function targetOf(providerId: string, model: string, effort: EffortLevel) {
  const settings = defaultAiSettings()
  settings.providerId = providerId
  settings.model = model
  settings.efforts[model] = effort
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

  it("MiMo：双鉴权头 + max_completion_tokens；实测支持的档位照发，非法档位不发", async () => {
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
    expect(body.reasoning_effort).toBe("high")
    expect(init.headers.Authorization).toBe("Bearer sk-mimo")
    expect(init.headers["api-key"]).toBe("sk-mimo")

    // 老数据里的 xhigh（官方别名）读回时迁移成 high
    localStorage.setItem(
      "cige-grid-ai",
      JSON.stringify({
        providerId: "mimo",
        model: "mimo-v2.6-pro",
        efforts: { "mimo-v2.6-pro": "xhigh" },
        providers: [],
      }),
    )
    expect(effortOf(loadAiSettings())).toBe("high")

    // max 不是 MiMo 合法值（会被接口 400）——夹回 default，什么都不发
    fetchMock.mockResolvedValue(sseResponse(["data: [DONE]\n\n"]))
    await requestChat(targetOf("mimo", "mimo-v2.6-pro", "max"), [{ role: "user", content: "hi" }], {
      onDelta: () => {},
    })
    const maxBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(maxBody.reasoning_effort).toBeUndefined()
    expect(maxBody.thinking).toBeUndefined()
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

describe("协议适配层（Anthropic Messages / OpenAI Responses）", () => {
  it("Anthropic 非流式：端点 /v1/messages、双鉴权头、system 拆出、温度夹到 0..1", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "想一下" },
            { type: "text", text: "北望去" },
          ],
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    const reasoning: string[] = []
    const finishes: string[] = []
    const target = targetOf("anthropic", "claude-sonnet-5", "default")
    target.temperature = 2
    const text = await requestChat(
      target,
      [
        { role: "system", content: "你是作词助手" },
        { role: "user", content: "hi" },
      ],
      { onReasoning: (t) => reasoning.push(t), onFinish: (r) => finishes.push(r), maxTokens: 512 },
    )
    expect(text).toBe("北望去")
    expect(reasoning.join("")).toBe("想一下")
    expect(finishes).toEqual(["end_turn"])

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
    expect(init.headers["x-api-key"]).toBe("sk-anthropic")
    expect(init.headers.Authorization).toBe("Bearer sk-anthropic")
    expect(init.headers["anthropic-version"]).toBe("2023-06-01")
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.model).toBe("claude-sonnet-5")
    expect(body.system).toBe("你是作词助手")
    expect(body.max_tokens).toBe(512)
    expect(body.messages).toEqual([{ role: "user", content: "hi" }])
    expect(body.stream).toBe(false)
    expect(body.temperature).toBe(1)
    expect(body.thinking).toBeUndefined()
  })

  it("Anthropic 流式：content_block_delta 的 text / thinking 分开收", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"先想"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"北望"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"去"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      ]),
    )
    const deltas: string[] = []
    const reasoning: string[] = []
    const finishes: string[] = []
    const text = await requestChat(
      targetOf("anthropic", "claude-sonnet-5", "default"),
      [{ role: "user", content: "hi" }],
      {
        onDelta: (t) => deltas.push(t),
        onReasoning: (t) => reasoning.push(t),
        onFinish: (r) => finishes.push(r),
      },
    )
    expect(text).toBe("北望去")
    expect(deltas.join("")).toBe("北望去")
    expect(reasoning.join("")).toBe("先想")
    expect(finishes).toEqual(["end_turn"])
  })

  it("Responses 非流式：/v1/responses、instructions、max_output_tokens、reasoning.effort 用目录真实值", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { type: "reasoning", content: [] },
            { type: "message", content: [{ type: "output_text", text: "北望去" }] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    const finishes: string[] = []
    const text = await requestChat(
      targetOf("opencode-zen", "gpt-5.5", "high"),
      [
        { role: "system", content: "你是作词助手" },
        { role: "user", content: "hi" },
      ],
      { onFinish: (r) => finishes.push(r), maxTokens: 321 },
    )
    expect(text).toBe("北望去")
    expect(finishes).toEqual(["completed"])

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
    expect(url).toBe("https://opencode.ai/zen/v1/responses")
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body.instructions).toBe("你是作词助手")
    expect(body.input).toEqual([{ role: "user", content: "hi" }])
    expect(body.max_output_tokens).toBe(321)
    expect(body.reasoning).toEqual({ effort: "high" })
    expect(body.stream).toBe(false)
  })

  it("Responses 流式：output_text / reasoning_summary 分开收；default 档位不带 reasoning", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"response.reasoning_summary_text.delta","delta":"先想"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"北望"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"去"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ]),
    )
    const reasoning: string[] = []
    const text = await requestChat(
      targetOf("opencode-zen", "gpt-5.5", "default"),
      [{ role: "user", content: "hi" }],
      { onDelta: () => {}, onReasoning: (t) => reasoning.push(t) },
    )
    expect(text).toBe("北望去")
    expect(reasoning.join("")).toBe("先想")
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>
    expect(body.reasoning).toBeUndefined()
    expect(body.stream).toBe(true)
  })

  it("这两个协议没有 /models：testAiConnection 直接 ping 一句", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "pong" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    await expect(testAiConnection(targetOf("anthropic", "claude-sonnet-5", "default"))).resolves.toContain(
      "连接成功",
    )
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe("https://api.anthropic.com/v1/messages")
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
    expect(modelLabel("mimo-v2.6-pro-ultraspeed")).toBe("MiMo V2.6 Pro UltraSpeed")
    expect(modelLabel("my-own-model")).toBe("my-own-model")
  })

  it("已知模型覆盖 provider 的强度开关，未知模型按 provider 走", () => {
    expect(supportsEffortFor("deepseek-flash", false)).toBe(true)
    expect(supportsEffortFor("mimo-v2.6-pro", true)).toBe(true)
    expect(supportsEffortFor("mimo-v2.6-pro-ultraspeed", true)).toBe(true)
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
    settings.efforts["whatever"] = "max"
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

  it("每个模型的合法档位按接口实测给（MiMo 最高 high、没有 max，多了 medium）", () => {
    expect(effortLevelsFor("mimo-v2.6-pro", true).map((level) => level.value)).toEqual([
      "default",
      "none",
      "low",
      "medium",
      "high",
    ])
    expect(effortLevelsFor("deepseek-flash", true).map((level) => level.value)).toEqual([
      "default",
      "none",
      "low",
      "high",
      "max",
    ])
    expect(effortLevelsFor("brand-new-model", false)).toEqual([])
    expect(effortLevelsFor("brand-new-model", true).map((level) => level.value)).toContain("medium")
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
    settings.efforts["whatever"] = "low"
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
