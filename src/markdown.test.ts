// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { fillMarkdown, renderMarkdown } from "./markdown"

describe("renderMarkdown（聊天回复的 Markdown）", () => {
  it("基础语法：加粗 / 斜体 / 行内代码 / 引用 / 列表 / 单换行", () => {
    const html = renderMarkdown("**粗**\n*斜* 和 `code`\n\n> 引用\n\n- 甲\n- 乙")
    expect(html).toContain("<strong>粗</strong>")
    expect(html).toContain("<em>斜</em>")
    expect(html).toContain("<code>code</code>")
    expect(html).toContain("<blockquote>")
    expect(html).toContain("<li>甲</li>")
    expect(html).toMatch(/<br\s*\/?>/)
  })

  it("剥掉脚本 / 图片 / 事件属性 / 样式（正文文字保留）", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<p style="color:red" onclick="x()">文</p>',
    )
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert(1)")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("style=")
    expect(html).toContain("文")
  })

  it("链接：只放 http(s)；javascript: 剥成纯文本", () => {
    const html = renderMarkdown("[好](https://example.com) [坏](javascript:alert(1))")
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain("javascript:")
  })

  it("fillMarkdown：渲染进容器并给链接加 target / rel", () => {
    const el = document.createElement("div")
    fillMarkdown(el, "[去](https://example.com)")
    const link = el.querySelector("a")!
    expect(link.getAttribute("href")).toBe("https://example.com")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })
})
