/**
 * 桌面版（Tauri）/ 网页版共用的「文件与拖拽」适配层。
 * 桌面：系统对话框 + 真实路径读写；
 * 网页：<input type=file> 读；写用 File System Access（Chrome/Edge 可覆盖保存）或退回下载。
 * 上层调用不用关心自己在哪个环境里跑。
 */

export interface FileSource {
  name: string
  path?: string
  readText(): Promise<string>
  readBytes(): Promise<Uint8Array>
}

export interface SavedFile {
  kind: "path" | "webfile" | "download"
  name: string
  path?: string
  handle?: WebFileHandle
}

export interface PickOptions {
  description: string
  extensions: string[]
  allFiles?: boolean
}

export interface SaveOptions {
  suggestedName: string
  description: string
  extensions: string[]
  target?: SavedFile | null
  forcePicker?: boolean
  pickerId?: string
}

interface WebFileHandle {
  name: string
  createWritable(): Promise<{ write(data: unknown): Promise<void>; close(): Promise<void> }>
}

type SavePicker = (options?: {
  suggestedName?: string
  id?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<WebFileHandle>

const MIME: Record<string, string> = {
  json: "application/json",
  txt: "text/plain",
  text: "text/plain",
  lrc: "text/plain",
  md: "text/markdown",
  mid: "audio/midi",
  midi: "audio/midi",
}

export function isDesktop(): boolean {
  if (typeof window === "undefined") return false
  const scope = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
  return Boolean(scope.__TAURI__ || scope.__TAURI_INTERNALS__)
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function acceptAttr(extensions: string[]): string {
  if (extensions.includes("*")) return ""
  return extensions.map((ext) => `.${ext}`).join(",")
}

export function mimeFor(extensions: string[]): string {
  for (const ext of extensions) {
    const mime = MIME[ext.toLowerCase()]
    if (mime) return mime
  }
  return "application/octet-stream"
}

/** 纯函数：保存时该走哪条路（可单测） */
export function saveStrategy(
  target: SavedFile | null | undefined,
  forcePicker: boolean,
  pickerAvailable: boolean,
): "overwrite" | "picker" | "download" {
  if (forcePicker) return pickerAvailable ? "picker" : "download"
  if (target?.kind === "webfile" && target.handle) return "overwrite"
  if (target?.kind === "download") return "download"
  return pickerAvailable ? "picker" : "download"
}

function pickerFor(): SavePicker | null {
  if (typeof window === "undefined") return null
  if (!window.isSecureContext) return null
  const fn = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return typeof fn === "function" ? fn : null
}

/** 网页版当前浏览器是否支持「就地覆盖保存」（Chrome/Edge 支持，Safari 不支持） */
export function canOverwriteInPlace(): boolean {
  return !isDesktop() && pickerFor() !== null
}

export function sourceFromFile(file: File): FileSource {
  return {
    name: file.name,
    readText: () => file.text(),
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  }
}

function sourceFromPath(path: string): FileSource {
  return {
    name: baseName(path),
    path,
    readText: async () => {
      const { readTextFile } = await import("@tauri-apps/plugin-fs")
      return readTextFile(path)
    },
    readBytes: async () => {
      const { readFile } = await import("@tauri-apps/plugin-fs")
      return readFile(path)
    },
  }
}

export async function pickFile(options: PickOptions): Promise<FileSource | null> {
  if (isDesktop()) {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const filters = [{ name: options.description, extensions: options.extensions }]
    if (options.allFiles !== false) filters.push({ name: "所有文件", extensions: ["*"] })
    const picked = await open({ multiple: false, filters })
    if (!picked || Array.isArray(picked)) return null
    return sourceFromPath(picked)
  }
  return new Promise<FileSource | null>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    const accept = acceptAttr(options.extensions)
    if (accept) input.accept = accept
    input.style.display = "none"
    document.body.appendChild(input)
    const finish = (source: FileSource | null) => {
      input.remove()
      resolve(source)
    }
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      finish(file ? sourceFromFile(file) : null)
    })
    input.addEventListener("cancel", () => finish(null))
    input.click()
  })
}

function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function writeWebHandle(handle: WebFileHandle, data: string | Uint8Array): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

async function savePayload(
  options: SaveOptions,
  payload: { text: string } | { bytes: Uint8Array },
): Promise<SavedFile | null> {
  if (isDesktop()) {
    const fs = await import("@tauri-apps/plugin-fs")
    let path =
      !options.forcePicker && options.target?.kind === "path" ? options.target.path : undefined
    if (!path) {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const chosen = await save({
        filters: [{ name: options.description, extensions: options.extensions }],
        defaultPath: options.suggestedName,
      })
      if (!chosen) return null
      path = chosen
    }
    if ("text" in payload) await fs.writeTextFile(path, payload.text)
    else await fs.writeFile(path, payload.bytes)
    return { kind: "path", name: baseName(path), path }
  }

  const picker = pickerFor()
  const strategy = saveStrategy(options.target, options.forcePicker === true, picker !== null)
  if (strategy === "overwrite" && options.target?.handle) {
    await writeWebHandle(options.target.handle, "text" in payload ? payload.text : payload.bytes)
    return options.target
  }
  if (strategy === "picker" && picker) {
    let handle: WebFileHandle | null = null
    try {
      handle = await picker({
        suggestedName: options.suggestedName,
        id: options.pickerId,
        types: [
          {
            description: options.description,
            accept: { [mimeFor(options.extensions)]: options.extensions.map((ext) => `.${ext}`) },
          },
        ],
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null
      handle = null
    }
    if (handle) {
      await writeWebHandle(handle, "text" in payload ? payload.text : payload.bytes)
      return { kind: "webfile", name: handle.name, handle }
    }
  }
  const data = "text" in payload ? payload.text : payload.bytes
  download(options.suggestedName, data, mimeFor(options.extensions))
  return { kind: "download", name: options.suggestedName }
}

export function saveText(options: SaveOptions & { contents: string }): Promise<SavedFile | null> {
  return savePayload(options, { text: options.contents })
}

export function saveBytes(options: SaveOptions & { bytes: Uint8Array }): Promise<SavedFile | null> {
  return savePayload(options, { bytes: options.bytes })
}

export interface DropHandlers {
  onEnter(): void
  onLeave(): void
  onDrop(sources: FileSource[]): void
}

export function onFileDrop(handlers: DropHandlers): void {
  if (isDesktop()) {
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload
          if (payload.type === "enter" || payload.type === "over") {
            handlers.onEnter()
            return
          }
          if (payload.type === "leave") {
            handlers.onLeave()
            return
          }
          if (payload.type === "drop") {
            handlers.onDrop(payload.paths.map((path) => sourceFromPath(path)))
          }
        }),
      )
      .catch(() => {})
    return
  }

  let depth = 0
  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    depth += 1
    handlers.onEnter()
  })
  window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
  })
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1)
    if (depth === 0) handlers.onLeave()
  })
  window.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    depth = 0
    handlers.onLeave()
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) handlers.onDrop(files.map((file) => sourceFromFile(file)))
  })
}
