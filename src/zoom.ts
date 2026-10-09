import { getCurrentWebview } from "@tauri-apps/api/webview"
import { isDesktop } from "./platform"

export const ZOOM_KEY = "cige-grid-zoom"
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1

export const zoomState = { value: 1 }

export function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100))
}

/**
 * 应用界面缩放。
 * - 桌面版走 `Webview.setZoom`：真缩放（会重排，窗口里的响应式规则也跟着生效）
 * - 网页版退回 CSS `zoom`（纯视觉缩放）
 * persist=false 用于启动时恢复。
 */
export function applyZoom(value: number, persist = true): number {
  const zoom = clampZoom(value)
  zoomState.value = zoom
  if (isDesktop()) {
    try {
      void Promise.resolve(getCurrentWebview().setZoom(zoom)).catch(() => {})
    } catch {
      // 环境不支持（测试桩 / 权限没给）就忽略
    }
  } else {
    document.documentElement.style.setProperty("zoom", String(zoom))
  }
  if (persist) {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom))
    } catch {
      // 忽略配额错误
    }
  }
  return zoom
}

export function initZoom(): number {
  let value = 1
  try {
    const saved = Number(localStorage.getItem(ZOOM_KEY))
    if (Number.isFinite(saved) && saved > 0) value = saved
  } catch {
    // 忽略
  }
  return applyZoom(value, false)
}

let wheelBound = false
let zoomCallback: ((zoom: number) => void) | undefined

/** Ctrl + 滚轮缩放界面（全局只挂一次；onChange 用来给调用方做提示） */
export function bindZoomShortcuts(onChange?: (zoom: number) => void): void {
  zoomCallback = onChange
  if (wheelBound) return
  wheelBound = true
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const next = applyZoom(zoomState.value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
      zoomCallback?.(next)
    },
    { passive: false },
  )
}
