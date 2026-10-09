import { beforeEach, describe, expect, it } from "vitest"
import { applyZoom, bindZoomShortcuts, clampZoom, initZoom, zoomState, ZOOM_KEY } from "./zoom"

describe("zoom（界面缩放）", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.removeProperty("zoom")
    zoomState.value = 1
  })

  it("clamp 到 0.5–3，保留两位小数", () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(9)).toBe(3)
    expect(clampZoom(1.234)).toBe(1.23)
  })

  it("applyZoom（网页版走 CSS zoom）写样式并记忆", () => {
    applyZoom(1.5)
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.5")
    expect(localStorage.getItem(ZOOM_KEY)).toBe("1.5")
    // 启动恢复（persist=false）不该改写存储
    localStorage.setItem(ZOOM_KEY, "2")
    applyZoom(1.5, false)
    expect(localStorage.getItem(ZOOM_KEY)).toBe("2")
  })

  it("initZoom 恢复保存值", () => {
    localStorage.setItem(ZOOM_KEY, "1.8")
    expect(initZoom()).toBe(1.8)
    expect(zoomState.value).toBe(1.8)
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("1.8")
  })

  it("Ctrl+滚轮：上滚放大、下滚缩小；不按 Ctrl 不动", () => {
    const seen: number[] = []
    bindZoomShortcuts((zoom) => seen.push(zoom))
    // happy-dom 的 WheelEvent 构造参数不生效，手动把 deltaY / ctrlKey 定上去
    const wheel = (deltaY: number, ctrlKey: boolean): WheelEvent => {
      const event = new WheelEvent("wheel", { cancelable: true })
      Object.defineProperty(event, "deltaY", { value: deltaY })
      Object.defineProperty(event, "ctrlKey", { value: ctrlKey })
      return event
    }
    window.dispatchEvent(wheel(-100, true))
    expect(zoomState.value).toBeCloseTo(1.1)
    window.dispatchEvent(wheel(100, true))
    expect(zoomState.value).toBeCloseTo(1)
    window.dispatchEvent(wheel(-100, false))
    expect(zoomState.value).toBeCloseTo(1)
    expect(seen).toEqual([1.1, 1])
  })
})
