import { fetch } from "@tauri-apps/plugin-http"
import { PROVIDER_PRESETS, type PresetApi } from "./model/provider-presets"

export type EffortLevel = "default" | "none" | "low" | "medium" | "high" | "max"

/** 走哪种线上协议（照搬 DSH 的分类） */
export type AiApi = PresetApi

export const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
]

/** 自定义接口的档位（保守：不给需要官方映射的值，避免对方不认） */
const CUSTOM_EFFORT_VALUES: EffortLevel[] = ["none", "low", "medium", "high", "max"]

/** 只有思考开关、没有强度档的模型（如 MiMo）：官方 thinking.type = enabled / disabled，默认开启 */
export const THINKING_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: "high", label: "思考开" },
  { value: "none", label: "思考关" },
]

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  /** 线上协议：OpenAI 兼容 / Anthropic Messages / OpenAI Responses */
  api: AiApi
  /** 文档 / 获取 Key 的链接（照搬 DSH 目录带的） */
  docs?: string
  keyUrl?: string
  models: string[]
  apiKey: string
  auth: "bearer" | "both"
  tokenParam: "max_tokens" | "max_completion_tokens"
  /** 能不能发 thinking 开关 */
  supportsThinking: boolean
  /** 能不能发 reasoning_effort（low/high/max） */
  supportsEffort: boolean
  builtin: boolean
}

export interface AiSettings {
  providers: AiProvider[]
  providerId: string
  model: string
  /** 推理等级按模型各记各的（每个模型能力不一样，别互相串） */
  efforts: Record<string, EffortLevel>
  temperature: number
  /** 输出上限：auto = 按词格估额度（保险丝）；none = 不传，交给接口默认 */
  maxOutput: "auto" | "none"
}

export function effortOf(settings: AiSettings): EffortLevel {
  const stored = settings.efforts[settings.model] ?? "default"
  const provider = settings.providers.find((item) => item.id === settings.providerId)
  const levels = effortLevelsFor(settings.model, provider?.supportsEffort ?? false)
  // 有档位表：夹到合法值（比如 MiMo 不支持 max，就回退成不传）
  // 没有档位表（思考开关型 / 什么都不发）：原样保留，请求那边会自己映射
  if (levels.length === 0) return stored
  return levels.some((level) => level.value === stored) ? stored : "default"
}

export function withEffort(settings: AiSettings, effort: EffortLevel): AiSettings {
  return { ...settings, efforts: { ...settings.efforts, [settings.model]: effort } }
}

export interface AiTarget {
  baseUrl: string
  api: AiApi
  apiKey: string
  model: string
  effort: EffortLevel
  auth: "bearer" | "both"
  tokenParam: "max_tokens" | "max_completion_tokens"
  supportsThinking: boolean
  supportsEffort: boolean
  temperature: number
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

const AI_SETTINGS_KEY = "cige-grid-ai"

/** 模型显示名（API 里传的还是左边这个 ID） */
export const MODEL_LABELS: Record<string, string> = {
  "deepseek-flash": "DeepSeek V4.1 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "mimo-v2.6-flash": "MiMo V2.6 Flash",
  "mimo-v2.6-pro": "MiMo V2.6 Pro",
  "mimo-v2.6-pro-ultraspeed": "MiMo V2.6 Pro UltraSpeed",
}

/** 目录里每个模型的显示名（同一 id 取第一次出现的） */
const PRESET_MODEL_LABELS: Record<string, string> = {}
/** 目录里每个模型的推理档位 → 线上真实值（off 已归一成 none） */
const PRESET_EFFORTS: Record<string, Record<string, string>> = {}
for (const preset of PROVIDER_PRESETS) {
  for (const model of preset.models) {
    if (!(model.id in PRESET_MODEL_LABELS)) PRESET_MODEL_LABELS[model.id] = model.name
    if (model.efforts && !(model.id in PRESET_EFFORTS)) PRESET_EFFORTS[model.id] = model.efforts
  }
}

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? PRESET_MODEL_LABELS[model] ?? model
}

/**
 * 每个模型实际支持的强度档（不含 default）。全部对着官方文档 + 直连接口实测（2026-09）：
 *
 * DeepSeek（官方 Chat Completions 文档）：
 *   reasoning_effort = none / low / high / max；默认 high；none 关思考、其余开。
 *   minimal 被映射为 low，medium / xhigh 被映射为 high（官方兼容别名，不额外暴露）。
 *
 * MiMo（官方 Chat Completions 端点，实测）：
 *   thinking.type = enabled / disabled，默认开启；reasoning_effort 只认 none / low / medium / high
 *   （minimal / max / xhigh / ultra 会 400）。
 *   官方 Responses API 词汇里的 xhigh / max / ultra 都只是映射成 high、minimal 映射成 low，
 *   且官方明确"现阶段暂未对推理强度做区分"——所以最高只给到 High，别名一律不暴露。
 *
 * MiMo Pro UltraSpeed 的两个实测怪癖：
 *   ① reasoning_effort=none 关不掉思考（仍出思维链）——关思考必须走 thinking.type（我们正是这么发的）；
 *   ② minimal 返回的是 500 而不是 400。我们不给用户暴露这两个值，所以踩不到。
 */
const MODEL_EFFORT_VALUES: Record<string, EffortLevel[]> = {
  "deepseek-flash": ["none", "low", "high", "max"],
  "deepseek-v4-pro": ["none", "low", "high", "max"],
  "mimo-v2.6-flash": ["none", "low", "medium", "high"],
  "mimo-v2.6-pro": ["none", "low", "medium", "high"],
  "mimo-v2.6-pro-ultraspeed": ["none", "low", "medium", "high"],
}


const EFFORT_ORDER: EffortLevel[] = ["none", "low", "medium", "high", "max"]

export function supportsEffortFor(model: string, providerSupports: boolean): boolean {
  if (MODEL_EFFORT_VALUES[model] || PRESET_EFFORTS[model]) return true
  return providerSupports
}

/** 这个模型能选的等级列表（含 default）；空数组 = 不支持强度档 */
export function effortLevelsFor(
  model: string,
  providerSupports: boolean,
): { value: EffortLevel; label: string }[] {
  let values: EffortLevel[] | null = MODEL_EFFORT_VALUES[model] ?? null
  if (!values) {
    const preset = PRESET_EFFORTS[model]
    // 目录模型：按目录里真实有的档位（保持从低到高的顺序）
    values = preset ? EFFORT_ORDER.filter((level) => level in preset) : null
  }
  if (!values) values = providerSupports ? CUSTOM_EFFORT_VALUES : null
  if (!values) return []
  return (["default", ...values] as EffortLevel[]).map(
    (value) => EFFORT_LEVELS.find((level) => level.value === value) ?? { value, label: value },
  )
}


/**
 * 估算这次请求该给多少输出额度。
 * 注意：思考模式下，思维链也吃 output token，必须单独留一大块，
 * 否则思考一长，答案就没额度了（会被 finish_reason=length 截断）。
 */
export function maxTokensFor(
  cells: number,
  thinking: boolean,
  effort: EffortLevel,
  mode: "auto" | "none" = "auto",
): number | null {
  if (mode === "none") return null
  const base = cells * 6 + 512
  if (!thinking) return Math.max(1024, Math.min(16384, base))
  const budget = effort === "max" ? 16384 : 8192
  return Math.max(4096, Math.min(65536, base + budget))
}

/** 我们自己维护的两个：思考 / 档位行为是实测调过的（目录里也有它们，这里不用目录那份） */
const OUR_PROVIDERS: AiProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    apiKey: "",
    auth: "bearer",
    tokenParam: "max_tokens",
    supportsThinking: true,
    supportsEffort: true,
    builtin: true,
  },
  {
    id: "mimo",
    name: "MiMo（小米）",
    baseUrl: "https://api.xiaomimimo.com/v1",
    api: "openai-completions",
    models: ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed"],
    apiKey: "",
    auth: "both",
    tokenParam: "max_completion_tokens",
    supportsThinking: true,
    supportsEffort: false,
    builtin: true,
  },
]

/** 照搬 DSH 的 provider 目录（生成文件 src/model/provider-presets.ts）。
 *  跳过 deepseek / xiaomi：用我们自己的那两份（行为实测过）。 */
const CATALOG_PROVIDERS: AiProvider[] = PROVIDER_PRESETS.filter(
  (preset) => preset.id !== "deepseek" && preset.id !== "xiaomi",
).map((preset) => ({
  id: preset.id,
  name: preset.name,
  baseUrl: preset.baseUrl,
  api: preset.api,
  docs: preset.docs || undefined,
  keyUrl: preset.keyUrl || undefined,
  models: preset.models.map((model) => model.id),
  apiKey: "",
  auth: "bearer",
  tokenParam: "max_tokens",
  supportsThinking: false,
  supportsEffort: false,
  builtin: true,
}))

export const BUILTIN_PROVIDERS: AiProvider[] = [
  ...OUR_PROVIDERS,
  ...CATALOG_PROVIDERS,
  {
    id: "custom",
    name: "自定义",
    baseUrl: "",
    api: "openai-completions",
    models: [],
    apiKey: "",
    auth: "bearer",
    tokenParam: "max_tokens",
    supportsThinking: false,
    supportsEffort: false,
    builtin: false,
  },
]

function cloneProviders(): AiProvider[] {
  return BUILTIN_PROVIDERS.map((provider) => ({ ...provider, models: [...provider.models] }))
}

export function defaultAiSettings(): AiSettings {
  return {
    providers: cloneProviders(),
    providerId: "deepseek",
    model: "deepseek-flash",
    efforts: {},
    temperature: 0.8,
    maxOutput: "none",
  }
}

function cleanModels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function loadAiSettings(): AiSettings {
  const defaults = defaultAiSettings()
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY)
    if (!raw) return defaults
    const data = JSON.parse(raw) as Partial<AiSettings>
    const stored = Array.isArray(data.providers) ? data.providers : []
    const providers = defaults.providers.map((base) => {
      const item = stored.find((entry) => entry && entry.id === base.id)
      if (!item) return base
      const models = cleanModels(item.models)
      return {
        ...base,
        baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : base.baseUrl,
        models: models.length > 0 ? models : base.models,
        apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
        supportsThinking:
          typeof item.supportsThinking === "boolean"
            ? item.supportsThinking
            : base.supportsThinking,
        supportsEffort:
          typeof item.supportsEffort === "boolean" ? item.supportsEffort : base.supportsEffort,
      }
    })
    // 用户自己加的服务商（defaults 里没有的 id）也留着：追加到末尾
    const known = new Set(defaults.providers.map((item) => item.id))
    for (const item of stored) {
      if (!item || typeof item.id !== "string" || known.has(item.id)) continue
      known.add(item.id)
      const models = cleanModels(item.models)
      providers.push({
        id: item.id,
        name: typeof item.name === "string" ? item.name : item.id,
        baseUrl: typeof item.baseUrl === "string" ? item.baseUrl : "",
        api: item.api ?? "openai-completions",
        models: models.length > 0 ? models : [],
        apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
        auth: "bearer",
        tokenParam: "max_tokens",
        supportsThinking: typeof item.supportsThinking === "boolean" ? item.supportsThinking : false,
        supportsEffort: typeof item.supportsEffort === "boolean" ? item.supportsEffort : false,
        builtin: false,
      })
    }
    const providerId =
      typeof data.providerId === "string" && providers.some((p) => p.id === data.providerId)
        ? data.providerId
        : defaults.providerId
    const provider = providers.find((p) => p.id === providerId) ?? providers[0]
    const model =
      typeof data.model === "string" && provider.models.includes(data.model)
        ? data.model
        : provider.models[0] ?? ""
    // 推理等级按模型存；老版本是单个 effort 字段，迁移到当前模型名下
    const efforts: Record<string, EffortLevel> = {}
    if (data.efforts && typeof data.efforts === "object") {
      for (const [key, value] of Object.entries(data.efforts as Record<string, string>)) {
        const normalized = value === "xhigh" ? "high" : value
        if (EFFORT_LEVELS.some((level) => level.value === normalized)) {
          efforts[key] = normalized as EffortLevel
        }
      }
    }
    if (
      Object.keys(efforts).length === 0 &&
      model &&
      EFFORT_LEVELS.some((level) => level.value === (data as { effort?: unknown }).effort)
    ) {
      efforts[model] = (data as { effort?: EffortLevel }).effort ?? "default"
    }
    const temperature = typeof data.temperature === "number" ? data.temperature : 0.8
    const maxOutput = data.maxOutput === "auto" ? "auto" : "none"
    return { providers, providerId, model, efforts, temperature, maxOutput }
  } catch {
    return defaults
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
}

export function resolveTarget(settings: AiSettings): AiTarget | null {
  const provider = settings.providers.find((item) => item.id === settings.providerId)
  if (!provider || !provider.baseUrl.trim() || !settings.model.trim()) return null
  const model = settings.model.trim()
  return {
    baseUrl: provider.baseUrl,
    api: provider.api,
    apiKey: provider.apiKey,
    model,
    effort: effortOf(settings),
    auth: provider.auth,
    tokenParam: provider.tokenParam,
    supportsThinking: provider.supportsThinking,
    supportsEffort: supportsEffortFor(model, provider.supportsEffort),
    temperature: settings.temperature,
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "")
}

function chatEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl)
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`
}

function modelsEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl)
  return base.endsWith("/chat/completions")
    ? base.replace(/\/chat\/completions$/, "/models")
    : `${base}/models`
}

function headers(target: AiTarget): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" }
  const key = target.apiKey.trim()
  if (key) {
    result.Authorization = `Bearer ${key}`
    if (target.auth === "both") result["api-key"] = key
  }
  return result
}

function requestBody(
  target: AiTarget,
  messages: ChatMessage[],
  maxTokens: number | null,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: target.model.trim(),
    messages,
    temperature: target.temperature,
    stream,
  }
  if (maxTokens !== null) body[target.tokenParam] = maxTokens
  if (target.supportsThinking && target.effort !== "default") {
    body.thinking = { type: target.effort === "none" ? "disabled" : "enabled" }
  }
  const presetEfforts = PRESET_EFFORTS[target.model]
  if (presetEfforts && target.effort !== "default") {
    const wire = presetEfforts[target.effort]
    if (wire) body.reasoning_effort = wire
  } else if (target.supportsEffort && target.effort !== "none" && target.effort !== "default") {
    body.reasoning_effort = target.effort
  }
  return body
}

function friendlyError(status: number, body: string): string {
  const detail = body.slice(0, 300)
  if (status === 400) return `400：请求被拒（模型名/参数可能不对）。${detail}`
  if (status === 401) return `401：API Key 不对或没权限。${detail}`
  if (status === 403) return `403：被拒绝（Key 权限 / 地区限制 / 余额）。${detail}`
  if (status === 404) return `404：地址不对（看看接口地址要不要带 /v1）。${detail}`
  if (status === 429) return `429：限流或额度不足，稍后再试。${detail}`
  if (status >= 500) return `${status}：服务端出错，稍后再试。${detail}`
  return `${status}：${detail}`
}

export interface ChatRequestOptions {
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
  onFinish?: (reason: string) => void
  signal?: AbortSignal
  maxTokens?: number | null
}

/** 读错误响应体（读不出来就当空） */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

async function requestOpenAiCompletions(
  target: AiTarget,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<string> {
  if (!target.baseUrl.trim()) throw new Error("先填接口地址")
  if (!target.model.trim()) throw new Error("先选模型")
  const stream = Boolean(options.onDelta)
  const response = await fetch(chatEndpoint(target.baseUrl), {
    method: "POST",
    headers: headers(target),
    signal: options.signal,
    body: JSON.stringify(
      requestBody(target, messages, options.maxTokens ?? null, stream),
    ),
  })
  if (!response.ok) {
    let body = ""
    try {
      body = await response.text()
    } catch {
      body = ""
    }
    throw new Error(friendlyError(response.status, body))
  }
  if (!stream || !response.body) {
    const data = (await response.json()) as {
      choices?: {
        finish_reason?: string
        message?: { content?: string; reasoning_content?: string }
      }[]
    }
    const choice = data.choices?.[0]
    if (choice?.finish_reason) options.onFinish?.(choice.finish_reason)
    if (choice?.message?.reasoning_content) options.onReasoning?.(choice.message.reasoning_content)
    const text = choice?.message?.content ?? ""
    options.onDelta?.(text)
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === "[DONE]") continue
      try {
        const data = JSON.parse(payload) as {
          choices?: {
            finish_reason?: string | null
            delta?: { content?: string; reasoning_content?: string }
          }[]
        }
        const choice = data.choices?.[0]
        if (choice?.delta?.reasoning_content) options.onReasoning?.(choice.delta.reasoning_content)
        if (choice?.delta?.content) {
          full += choice.delta.content
          options.onDelta?.(choice.delta.content)
        }
        if (choice?.finish_reason) options.onFinish?.(choice.finish_reason)
      } catch {
        continue
      }
    }
  }
  return full
}

// ---------- 协议适配层（openai-completions 在上一段）----------
// 端点约定：Base URL 到 /v1 为止；没带 /v1 的按官方路径补。
//   anthropic：{base}/v1/messages（base 已带 /v1 就只接 /messages）
//   responses：{base}/v1/responses（同上）

function anthropicEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl)
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`
}

function responsesEndpoint(baseUrl: string): string {
  const base = trimBase(baseUrl)
  return base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`
}

function anthropicHeaders(target: AiTarget): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Anthropic 要求的协议版本头
    "anthropic-version": "2023-06-01",
  }
  const key = target.apiKey.trim()
  if (key) {
    // 官方认 x-api-key；不少兼容网关认 Bearer——两个都带，谁认哪个都行
    headers["x-api-key"] = key
    headers.Authorization = `Bearer ${key}`
  }
  return headers
}

function anthropicBody(
  target: AiTarget,
  messages: ChatMessage[],
  maxTokens: number | null,
  stream: boolean,
): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const body: Record<string, unknown> = {
    model: target.model.trim(),
    // Anthropic 必填；没给就按一个保守值
    max_tokens: maxTokens ?? 8192,
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    stream,
  }
  if (system) body.system = system
  // Anthropic 温度范围 0..1
  body.temperature = Math.max(0, Math.min(1, target.temperature))
  return body
}

function responsesBody(
  target: AiTarget,
  messages: ChatMessage[],
  maxTokens: number | null,
  stream: boolean,
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
  const body: Record<string, unknown> = {
    model: target.model.trim(),
    input: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    stream,
  }
  if (instructions) body.instructions = instructions
  if (maxTokens !== null) body.max_output_tokens = maxTokens
  const preset = PRESET_EFFORTS[target.model]
  if (preset && target.effort !== "default") {
    const wire = preset[target.effort]
    if (wire) body.reasoning = { effort: wire }
  } else if (target.supportsEffort && target.effort !== "none" && target.effort !== "default") {
    body.reasoning = { effort: target.effort }
  }
  return body
}

async function requestAnthropicMessages(
  target: AiTarget,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<string> {
  const stream = Boolean(options.onDelta)
  const response = await fetch(anthropicEndpoint(target.baseUrl), {
    method: "POST",
    headers: anthropicHeaders(target),
    signal: options.signal,
    body: JSON.stringify(anthropicBody(target, messages, options.maxTokens ?? null, stream)),
  })
  if (!response.ok) throw new Error(friendlyError(response.status, await safeText(response)))
  if (!stream || !response.body) {
    const data = (await response.json()) as {
      content?: { type?: string; text?: string; thinking?: string }[]
      stop_reason?: string
    }
    const blocks = data.content ?? []
    const thinking = blocks
      .filter((block) => block.type === "thinking" && block.thinking)
      .map((block) => block.thinking ?? "")
      .join("")
    if (thinking) options.onReasoning?.(thinking)
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
    if (data.stop_reason) options.onFinish?.(data.stop_reason)
    options.onDelta?.(text)
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      let data: {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
        error?: { message?: string }
      }
      try {
        data = JSON.parse(payload) as typeof data
      } catch {
        continue
      }
      if (data.type === "content_block_delta") {
        if (data.delta?.type === "text_delta" && data.delta.text) {
          full += data.delta.text
          options.onDelta?.(data.delta.text)
        } else if (data.delta?.type === "thinking_delta" && data.delta.thinking) {
          options.onReasoning?.(data.delta.thinking)
        }
      } else if (data.type === "message_delta" && data.delta?.stop_reason) {
        options.onFinish?.(data.delta.stop_reason)
      } else if (data.type === "error") {
        throw new Error(data.error?.message ?? "Anthropic 流错误")
      }
    }
  }
  return full
}

async function requestOpenAiResponses(
  target: AiTarget,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<string> {
  const stream = Boolean(options.onDelta)
  const response = await fetch(responsesEndpoint(target.baseUrl), {
    method: "POST",
    headers: headers(target),
    signal: options.signal,
    body: JSON.stringify(responsesBody(target, messages, options.maxTokens ?? null, stream)),
  })
  if (!response.ok) throw new Error(friendlyError(response.status, await safeText(response)))
  if (!stream || !response.body) {
    const data = (await response.json()) as {
      output?: { type?: string; content?: { type?: string; text?: string }[] }[]
      status?: string
      error?: { message?: string }
    }
    if (data.error?.message) throw new Error(data.error.message)
    const text = (data.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("")
    if (data.status) options.onFinish?.(data.status)
    options.onDelta?.(text)
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      let data: {
        type?: string
        delta?: string
        error?: { message?: string }
        response?: { status?: string; error?: { message?: string } }
      }
      try {
        data = JSON.parse(payload) as typeof data
      } catch {
        continue
      }
      if (data.type === "response.output_text.delta" && data.delta) {
        full += data.delta
        options.onDelta?.(data.delta)
      } else if (
        (data.type === "response.reasoning_text.delta" ||
          data.type === "response.reasoning_summary_text.delta") &&
        data.delta
      ) {
        options.onReasoning?.(data.delta)
      } else if (data.type === "response.completed" && data.response?.status) {
        options.onFinish?.(data.response.status)
      } else if (data.type === "response.failed" || data.type === "error") {
        throw new Error(data.response?.error?.message ?? data.error?.message ?? "Responses 流错误")
      }
    }
  }
  return full
}

/** 按 provider 的协议分发 */
export async function requestChat(
  target: AiTarget,
  messages: ChatMessage[],
  options: ChatRequestOptions = {},
): Promise<string> {
  if (!target.baseUrl.trim()) throw new Error("先填接口地址")
  if (!target.model.trim()) throw new Error("先选模型")
  if (target.api === "anthropic-messages") return requestAnthropicMessages(target, messages, options)
  if (target.api === "openai-responses") return requestOpenAiResponses(target, messages, options)
  return requestOpenAiCompletions(target, messages, options)
}

export async function testAiConnection(target: AiTarget): Promise<string> {
  if (!target.baseUrl.trim()) throw new Error("先填接口地址")
  if (target.api !== "openai-completions") {
    // Anthropic / Responses 没有统一的 /models：直接发最小请求验
    await requestChat(target, [{ role: "user", content: "ping" }], { maxTokens: 16 })
    return `连接成功（${target.model}）`
  }
  let response: Response
  try {
    response = await fetch(modelsEndpoint(target.baseUrl), {
      method: "GET",
      headers: headers(target),
    })
  } catch (err) {
    throw new Error(`连不上：${err instanceof Error ? err.message : String(err)}`)
  }
  if (response.ok) return `连接成功（${target.model}）`
  if (response.status === 404 || response.status === 405) {
    await requestChat(target, [{ role: "user", content: "ping" }], { maxTokens: 4 })
    return `连接成功（${target.model}）`
  }
  let body = ""
  try {
    body = await response.text()
  } catch {
    body = ""
  }
  throw new Error(friendlyError(response.status, body))
}
