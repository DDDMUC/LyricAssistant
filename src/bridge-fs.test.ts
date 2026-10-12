import { afterAll, describe, expect, it } from "vitest"
import { bridgeFs, setWebBridgeDir, webBridgeStatus, type WebDirHandle } from "./bridge-fs"
import { callBridge, parseBridgeLines, readBridgeState } from "./sv-bridge"

// 网页版（happy-dom 里没有 Tauri 注入）→ 走 File System Access 那条路

function fakeBridgeDir(): {
  dir: WebDirHandle
  files: Map<string, string>
  requests: string[]
} {
  const files = new Map<string, string>()
  const requests: string[] = []
  const dir: WebDirHandle = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let text = files.get(name)
      if (text === undefined) {
        if (!options?.create) {
          const err = new Error(`not found: ${name}`)
          err.name = "NotFoundError"
          throw err
        }
        text = ""
        files.set(name, text)
      }
      return {
        getFile: async () => ({ text: async () => files.get(name) ?? "" }),
        createWritable: async () => ({
          write: async (data: string) => {
            files.set(name, data)
          },
          close: async () => {},
        }),
      }
    },
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
  }
  // 记录写进去的 request.txt（模拟脚本侧看到的内容）
  const originalSet = files.set.bind(files)
  files.set = (key: string, value: string) => {
    if (key === "request.txt") requests.push(value)
    return originalSet(key, value)
  }
  return { dir, files, requests }
}

/** 假的 SV2 脚本：收到 request.txt 就按同一 seq 回一条（和 bridge.lua 的协议一致） */
function installFakeSvScript(files: Map<string, string>): void {
  const originalSet = files.set.bind(files)
  files.set = (key: string, value: string) => {
    const result = originalSet(key, value)
    if (key !== "request.txt") return result
    const req = parseBridgeLines(value)
    if (req.cmd === "ping") {
      const parsed = parseBridgeLines("state.txt")
      void parsed
      originalSet("response.txt", `seq=${req.seq}\nok=1\nnote=bridge alive\nsvNotes=7\n`)
    }
    return result
  }
}

describe("bridge-fs：网页版桥目录授权 + 信箱读写", () => {
  it("没授权时：状态 need-pick，bridgeFs 返回 null（不给用）", async () => {
    setWebBridgeDir(null)
    // happy-dom 没有 showDirectoryPicker / indexedDB → 走 unsupported/need-pick 分支
    const status = await webBridgeStatus()
    expect(["unsupported", "need-pick"]).toContain(status)
    expect(await bridgeFs()).toBeNull()
    expect(await readBridgeState()).toBeNull()
  })

  it("授权后：state.txt 能读出来（SV2 脚本上报的那一套）", async () => {
    const { dir, files } = fakeBridgeDir()
    files.set(
      "state.txt",
      "updated=9999999999\nproject=网页版.svp\nsvNotes=3\nchars=尝也是\nids=t1g1@1,t1g1@2,t1g1@3\neditSeq=0\nedited=\n",
    )
    setWebBridgeDir(dir)
    expect(await webBridgeStatus()).toBe("ready")
    const state = await readBridgeState()
    expect(state?.project).toBe("网页版.svp")
    expect(state?.chars).toBe("尝也是")
    expect(state?.ids).toEqual(["t1g1@1", "t1g1@2", "t1g1@3"])
    expect(state?.running).toBe(true)
  })

  it("授权后：ping 协议能跑通（写 request.txt → 假脚本回同 seq 的 response）", async () => {
    const { dir, files } = fakeBridgeDir()
    installFakeSvScript(files)
    setWebBridgeDir(dir)
    const resp = await callBridge("ping", {}, 3000)
    expect(resp?.ok).toBe(true)
    expect(resp?.note).toContain("bridge alive")
    expect(resp?.svNotes).toBe(7)
  })

  it("授权后：bridgeFs 能写文件（网页版按序填词要写 request.txt）", async () => {
    const { dir, files } = fakeBridgeDir()
    setWebBridgeDir(dir)
    const io = await bridgeFs()
    expect(io).not.toBeNull()
    await io!.write("request.txt", "seq=1\ncmd=ping\n")
    expect(files.get("request.txt")).toBe("seq=1\ncmd=ping\n")
  })

  afterAll(() => {
    setWebBridgeDir(null)
  })
})
