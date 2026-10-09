import { getCells } from "./state"
import type { Project } from "./model/types"
import { isDesktop } from "./platform"

/** SV2 主程序路径（SV 没开时可以一键启动它） */
export const SV2_EXE_PATH = "C:\\Program Files\\Synthesizer V Studio 2 Pro\\synthv-studio.exe"

/** 启动 SV2（走系统打开；失败返回 false） */
export async function launchSv2(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener")
    await openPath(SV2_EXE_PATH)
    return true
  } catch {
    return false
  }
}

/** 和 SV2 脚本约定好的信箱目录：%LOCALAPPDATA%\LyricAssistantBridge */
const BRIDGE_DIR_NAME = "LyricAssistantBridge"

/** 作词助手里「填了字的格子」按顺序拼出的汉字串（忽略词格、忽略空） */
export function orderedChars(project: Project): string {
  const chars: string[] = []
  for (const section of project.sections) {
    for (const sentence of section.sentences) {
      for (const cell of getCells(sentence)) {
        if (cell.trim() !== "") chars.push(cell.trim())
      }
    }
  }
  return chars.join("")
}

/** 行协议（key=value）解析：两边的桥都用这个 */
export function parseBridgeLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=")
    if (at <= 0) continue
    out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

export function formatBridgeRequest(
  seq: string,
  cmd: string,
  extra: Record<string, string> = {},
): string {
  const lines = [`seq=${seq}`, `cmd=${cmd}`]
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}=${value}`)
  return `${lines.join("\n")}\n`
}

export interface BridgeResponse {
  ok: boolean
  note: string
  dry: boolean
  overlap: boolean
  matched: number
  svNotes: number
  ourChars: number
}

export interface BridgeState {
  running: boolean
  updated: number
  project: string
  svNotes: number
  chars: string
}

async function fsApi(): Promise<typeof import("@tauri-apps/plugin-fs")> {
  return import("@tauri-apps/plugin-fs")
}

async function bridgePaths(): Promise<{ dir: string; request: string; response: string; state: string }> {
  const { localDataDir, join } = await import("@tauri-apps/api/path")
  const dir = await join(await localDataDir(), BRIDGE_DIR_NAME)
  return {
    dir,
    request: await join(dir, "request.txt"),
    response: await join(dir, "response.txt"),
    state: await join(dir, "state.txt"),
  }
}

/** 给 SV2 那边的后台脚本发一条命令，等它回信；超时（脚本没在跑）返回 null */
export async function callBridge(
  cmd: string,
  extra: Record<string, string> = {},
  timeoutMs = 4000,
): Promise<BridgeResponse | null> {
  if (!isDesktop()) return null
  const fs = await fsApi()
  const paths = await bridgePaths()
  await fs.mkdir(paths.dir, { recursive: true }).catch(() => {})
  const seq = String(Date.now())
  await fs.writeTextFile(paths.request, formatBridgeRequest(seq, cmd, extra))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const text = await fs.readTextFile(paths.response).catch(() => "")
    const parsed = parseBridgeLines(text)
    if (parsed.seq === seq) {
      return {
        ok: parsed.ok === "1",
        note: parsed.note ?? "",
        dry: parsed.dry === "1",
        overlap: parsed.overlap === "1",
        matched: Number(parsed.matched ?? 0),
        svNotes: Number(parsed.svNotes ?? 0),
        ourChars: Number(parsed.ourChars ?? 0),
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  return null
}

/** 读 SV2 脚本上报的状态（state.txt），判断它还在不在跑 */
export async function readBridgeState(): Promise<BridgeState | null> {
  if (!isDesktop()) return null
  const fs = await fsApi()
  const paths = await bridgePaths()
  const text = await fs.readTextFile(paths.state).catch(() => "")
  if (!text) return null
  const parsed = parseBridgeLines(text)
  const updated = Number(parsed.updated ?? 0)
  return {
    running: updated > 0 && Math.floor(Date.now() / 1000) - updated <= 3,
    updated,
    project: parsed.project ?? "",
    svNotes: Number(parsed.svNotes ?? 0),
    chars: parsed.chars ?? "",
  }
}
