import { isDesktop } from "./platform"

/**
 * SV2 信箱文件读写的抽象层：
 * - 桌面（Tauri）：直接用 fs 插件读写 %LOCALAPPDATA%\LyricAssistantBridge
 * - 网页：没有本地文件权限，让用户授一次「桥目录」（File System Access），
 *   之后走目录句柄读写；授权记忆在 IndexedDB，下次打开还能续用
 */

export interface BridgeFs {
  read(name: string): Promise<string>
  write(name: string, text: string): Promise<void>
}

const BRIDGE_DIR_NAME = "LyricAssistantBridge"

// ---------- 桌面 ----------

async function tauriFs(): Promise<BridgeFs> {
  const fs = await import("@tauri-apps/plugin-fs")
  const { localDataDir, join } = await import("@tauri-apps/api/path")
  const dir = await join(await localDataDir(), BRIDGE_DIR_NAME)
  return {
    read: async (name) => fs.readTextFile(await join(dir, name)),
    write: async (name, text) => {
      await fs.mkdir(dir, { recursive: true }).catch(() => {})
      await fs.writeTextFile(await join(dir, name), text)
    },
  }
}

// ---------- 网页：File System Access ----------

// 有意不用 lib.dom 的新类型（各 TS 版本不一致），自己声明用到的最小接口
interface WebWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

interface WebFileHandle {
  getFile(): Promise<{ text(): Promise<string> }>
  createWritable(): Promise<WebWritable>
}

export interface WebDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WebFileHandle>
  queryPermission?: (descriptor: { mode: string }) => Promise<PermissionState>
  requestPermission?: (descriptor: { mode: string }) => Promise<PermissionState>
}

type DirPicker = (options?: { mode?: string; id?: string }) => Promise<WebDirHandle>

const DB_NAME = "cige-grid-bridge"
const STORE_NAME = "handles"
const DIR_KEY = "bridge-dir"

let webDir: WebDirHandle | null = null

function dirPicker(): DirPicker | null {
  if (typeof window === "undefined") return null
  const fn = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker
  return typeof fn === "function" ? fn : null
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => resolve(undefined)
  })
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export type WebBridgeStatus = "unsupported" | "need-pick" | "ready"

/** 网页版桥目录授权状态（ready = 可以直接读写） */
export async function webBridgeStatus(): Promise<WebBridgeStatus> {
  if (isDesktop()) return "unsupported"
  if (webDir) return "ready"
  if (!dirPicker()) return "unsupported"
  try {
    const stored = await idbGet<WebDirHandle>(DIR_KEY)
    if (!stored) return "need-pick"
    const granted = await stored.queryPermission?.({ mode: "readwrite" })
    if (granted === "granted") {
      webDir = stored
      return "ready"
    }
    const asked = await stored.requestPermission?.({ mode: "readwrite" })
    if (asked === "granted") {
      webDir = stored
      return "ready"
    }
  } catch {
    // 句柄失效（目录被删/被移动）：当没授权，重新选
  }
  return "need-pick"
}

/** 让用户选一次桥目录（记住授权，下次直接续用） */
export async function pickWebBridgeDir(): Promise<boolean> {
  const picker = dirPicker()
  if (!picker) return false
  try {
    const dir = await picker({ mode: "readwrite", id: "cige-grid-bridge" })
    webDir = dir
    await idbSet(DIR_KEY, dir)
    return true
  } catch {
    return false
  }
}

/** 测试用：直接塞一个目录句柄，不用真弹窗 */
export function setWebBridgeDir(dir: WebDirHandle | null): void {
  webDir = dir
}

async function webFs(): Promise<BridgeFs | null> {
  const status = await webBridgeStatus()
  if (status !== "ready" || !webDir) return null
  const dir = webDir
  return {
    read: async (name) => {
      const handle = await dir.getFileHandle(name)
      return (await handle.getFile()).text()
    },
    write: async (name, text) => {
      const handle = await dir.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
  }
}

/** 信箱读写入口：桌面/网页各走各的；网页没授权时返回 null */
export async function bridgeFs(): Promise<BridgeFs | null> {
  if (isDesktop()) return tauriFs()
  return webFs()
}