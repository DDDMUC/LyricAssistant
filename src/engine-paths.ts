import { isDesktop } from "./platform"

/**
 * 合成引擎主程序路径（可自定义，存在本机）：
 * 路径装别处 / 换盘了就不再写死，「引擎」弹窗和设置里都能改/测。
 */

const SV2_KEY = "cige-grid-sv2-path"
const OU_KEY = "cige-grid-ou-path"

/** 默认路径（按这台机器现状给的兜底） */
export const DEFAULT_SV2_PATH = ""
export const DEFAULT_OU_PATH = ""

function read(key: string): string {
  try {
    return (localStorage.getItem(key) ?? "").trim()
  } catch {
    return ""
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value.trim())
    else localStorage.removeItem(key)
  } catch {
    // 隐私模式下存不住就算了
  }
}

export function sv2Path(): string {
  return read(SV2_KEY) || DEFAULT_SV2_PATH
}

export function setSv2Path(value: string): void {
  write(SV2_KEY, value)
}

export function ouPath(): string {
  return read(OU_KEY) || DEFAULT_OU_PATH
}

export function setOuPath(value: string): void {
  write(OU_KEY, value)
}

export interface EnginePathSetting {
  key: "sv2" | "openutau"
  label: string
  hint: string
  /** 当前生效路径（自定义优先，否则默认） */
  get: () => string
  set: (path: string) => void
  /** 用户是否自己设过 */
  isCustom: () => boolean
  fallback: string
}

export const ENGINE_PATH_SETTINGS: EnginePathSetting[] = [
  {
    key: "sv2",
    label: "Synthesizer V Studio 2",
    hint: "「引擎」弹窗的「启动 SV2」用它。bridge 脚本仍要在 SV2 里手动跑一次：脚本 → 作词助手 → LyricAssistant bridge",
    get: sv2Path,
    set: setSv2Path,
    isCustom: () => read(SV2_KEY) !== "",
    fallback: DEFAULT_SV2_PATH,
  },
  {
    key: "openutau",
    label: "OpenUtau",
    hint: "「引擎」弹窗 OpenUtau 页的「启动 OpenUtau」用它",
    get: ouPath,
    set: setOuPath,
    isCustom: () => read(OU_KEY) !== "",
    fallback: DEFAULT_OU_PATH,
  },
]

/** 用系统方式启动引擎主程序（桌面版）；失败把原因一起返回（别再偷偷吞掉） */
export async function launchEngineExe(exe: string): Promise<{ ok: boolean; error: string }> {
  const path = exe.trim()
  if (!path) return { ok: false, error: "路径是空的" }
  if (!isDesktop()) return { ok: false, error: "网页版不能启动本机程序" }
  try {
    const { openPath } = await import("@tauri-apps/plugin-opener")
    await openPath(path)
    return { ok: true, error: "" }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
