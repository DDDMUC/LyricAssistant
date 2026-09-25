import { fetch } from "@tauri-apps/plugin-http"

export type EffortLevel = "default" | "none" | "low" | "high" | "max"

export const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
]

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
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
  effort: EffortLevel
  temperature: number
  /** 输出上限：auto = 按词格估额度（保险丝）；none = 不传，交给接口默认 */
  maxOutput: "auto" | "none"
}

export interface AiTarget {
  baseUrl: string
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
}

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model
}

/** 已知模型能不能吃 reasoning_effort（没登记的按 provider 的设置走） */
const MODEL_EFFORT: Record<string, boolean> = {
  "deepseek-flash": true,
  "deepseek-v4-pro": true,
  "mimo-v2.6-flash": false,
  "mimo-v2.6-pro": false,
}

export function supportsEffortFor(model: string, providerSupports: boolean): boolean {
  return MODEL_EFFORT[model] ?? providerSupports
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

export const BUILTIN_PROVIDERS: AiProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
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
    models: ["mimo-v2.6-flash", "mimo-v2.6-pro"],
    apiKey: "",
    auth: "both",
    tokenParam: "max_completion_tokens",
    supportsThinking: true,
    supportsEffort: false,
    builtin: true,
  },
  {
    id: "custom",
    name: "自定义",
    baseUrl: "",
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
    effort: "default",
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
    const providerId =
      typeof data.providerId === "string" && providers.some((p) => p.id === data.providerId)
        ? data.providerId
        : defaults.providerId
    const provider = providers.find((p) => p.id === providerId) ?? providers[0]
    const model =
      typeof data.model === "string" && provider.models.includes(data.model)
        ? data.model
        : provider.models[0] ?? ""
    const effort = EFFORT_LEVELS.some((level) => level.value === data.effort)
      ? (data.effort as EffortLevel)
      : "default"
    const temperature = typeof data.temperature === "number" ? data.temperature : 0.8
    const maxOutput = data.maxOutput === "auto" ? "auto" : "none"
    return { providers, providerId, model, effort, temperature, maxOutput }
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
    apiKey: provider.apiKey,
    model,
    effort: settings.effort,
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
  if (target.supportsEffort && target.effort !== "none" && target.effort !== "default") {
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

export async function requestChat(
  target: AiTarget,
  messages: ChatMessage[],
  options: {
    onDelta?: (text: string) => void
    onReasoning?: (text: string) => void
    onFinish?: (reason: string) => void
    signal?: AbortSignal
    maxTokens?: number | null
  } = {},
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

export async function testAiConnection(target: AiTarget): Promise<string> {
  if (!target.baseUrl.trim()) throw new Error("先填接口地址")
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
