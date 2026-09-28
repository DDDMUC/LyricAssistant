import { beforeAll, expect, it } from "vitest"
import { diag, diagClear, diagCount, diagText, initDiag } from "./diag"

beforeAll(() => {
  localStorage.clear()
  diagClear()
  initDiag()
})

it("环形缓冲上限 300 条", () => {
  for (let i = 0; i < 350; i++) diag("cap.test", { i })
  expect(diagCount()).toBe(300)
})

it("导出的文本带版本、环境和条目", () => {
  diag("test.marker", { a: 1 })
  const text = diagText()
  expect(text).toContain("作词助手 · 诊断日志")
  expect(text).toContain("版本:")
  expect(text).toContain("test.marker")
  expect(text).toContain('"a":1')
})

it("未捕获报错会被记录并落盘（崩溃后还能导出）", () => {
  window.dispatchEvent(new ErrorEvent("error", { error: new Error("BOOM"), message: "BOOM" }))
  expect(diagText()).toContain("BOOM")
  expect(diagText()).toContain("window.error")
  expect(localStorage.getItem("cige-grid-diag") ?? "").toContain("BOOM")
})

it("未处理的 Promise 拒绝也会记录", () => {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown }
  Object.defineProperty(event, "reason", { value: new Error("REJECTED") })
  window.dispatchEvent(event)
  expect(diagText()).toContain("REJECTED")
  expect(diagText()).toContain("unhandledrejection")
})
