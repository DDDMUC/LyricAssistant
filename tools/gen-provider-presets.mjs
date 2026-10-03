#!/usr/bin/env node
// 从 DSH 的 provider 目录生成 src/model/provider-presets.ts（数据照搬，只做归一化）。
// 用法：node tools/gen-provider-presets.mjs [providers.js 的路径]
//   默认路径：~/Documents/Default Project/dsh-provider-hub/core/providers.js
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { homedir } from "node:os"
import { join } from "node:path"

const source =
  process.argv[2] ?? join(homedir(), "Documents/Default Project/dsh-provider-hub/core/providers.js")

/** 我们系统支持的档位；off 归一成 none，其余（xhigh / minimal / ultra…）丢弃 */
const KEEP = ["none", "low", "medium", "high", "max"]

const mod = await import(pathToFileURL(source).href)
if (!Array.isArray(mod.PRESETS)) {
  console.error(`${source} 里没有 PRESETS`)
  process.exit(1)
}

const providers = mod.PRESETS.map((p) => ({
  id: p.id,
  name: p.name,
  baseUrl: p.baseURL,
  api: p.api,
  docs: p.docs ?? "",
  keyUrl: p.keyUrl ?? "",
  models: (p.models ?? []).map((m) => {
    const raw = m.reasoningEfforts ?? null
    let efforts = null
    if (raw && typeof raw === "object") {
      const mapped = {}
      for (const [key, wire] of Object.entries(raw)) {
        const level = key === "off" ? "none" : key
        if (KEEP.includes(level) && !(level in mapped)) mapped[level] = wire
      }
      if (Object.keys(mapped).length > 0) efforts = mapped
    }
    return { id: m.id, name: m.name ?? m.id, efforts }
  }),
}))

const q = (s) => JSON.stringify(s)
const modelLine = (m) => {
  const parts = [`id: ${q(m.id)}`, `name: ${q(m.name)}`]
  if (m.efforts) parts.push(`efforts: ${JSON.stringify(m.efforts)}`)
  return `    { ${parts.join(", ")} },`
}

const out = []
out.push("// 自动生成，别手改：改上游目录后跑 node tools/gen-provider-presets.mjs 重新生成")
out.push(`// 来源：DSH 的 provider 目录（dsh-provider-hub/core/providers.js），生成于 ${new Date().toISOString().slice(0, 10)}`)
out.push("// 归一化：reasoningEfforts 的 off 键改成 none；xhigh / minimal / ultra 等我们系统没有的档位丢掉")
out.push("")
out.push('export type PresetApi = "openai-completions" | "anthropic-messages" | "openai-responses"')
out.push("")
out.push("export interface PresetModel {")
out.push("  id: string")
out.push("  name: string")
out.push("  /** 可用推理档位 → 请求里实际发出去的值 */")
out.push("  efforts?: Record<string, string>")
out.push("}")
out.push("")
out.push("export interface PresetProvider {")
out.push("  id: string")
out.push("  name: string")
out.push("  baseUrl: string")
out.push("  api: PresetApi")
out.push("  docs?: string")
out.push("  keyUrl?: string")
out.push("  models: PresetModel[]")
out.push("}")
out.push("")
out.push("export const PROVIDER_PRESETS: PresetProvider[] = [")
for (const p of providers) {
  out.push("  {")
  out.push(`    id: ${q(p.id)},`)
  out.push(`    name: ${q(p.name)},`)
  out.push(`    baseUrl: ${q(p.baseUrl)},`)
  out.push(`    api: ${q(p.api)},`)
  if (p.docs) out.push(`    docs: ${q(p.docs)},`)
  if (p.keyUrl) out.push(`    keyUrl: ${q(p.keyUrl)},`)
  out.push("    models: [")
  for (const m of p.models) out.push(modelLine(m))
  out.push("    ],")
  out.push("  },")
}
out.push("]")
out.push("")

const target = "src/model/provider-presets.ts"
writeFileSync(target, out.join("\n"))
console.log(`wrote ${target}: ${providers.length} providers, ${providers.reduce((n, p) => n + p.models.length, 0)} models`)
