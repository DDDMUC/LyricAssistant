/**
 * AI 回复的 Markdown 渲染：marked 转 HTML → DOMPurify 严格白名单清洗。
 * 只在「聊天 / 没解析成句子的回复」上用；解析成句子的填词结果仍走结构化卡片。
 */
import DOMPurify from "dompurify"
import { marked } from "marked"

marked.setOptions({ gfm: true, breaks: true })

/** 只留这些标签：图片 / 脚本 / 样式 / 内嵌页面一律剥掉 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]

/** 只要 http(s) 链接，`javascript:` 之类直接剥成纯文本 */
const ALLOWED_LINK = /^https?:\/\//i

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false })
  // 极端环境（DOMPurify 起不来）会直接放行原文——宁可退成纯文本，也不放没洗过的 HTML
  if (!DOMPurify.isSupported) return `<p>${escapeHtml(text)}</p>`
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: ALLOWED_LINK,
  })
}

/** 渲染进容器：顺带给链接加上「新窗口 + 系统浏览器」的安全属性 */
export function fillMarkdown(el: HTMLElement, text: string): void {
  el.innerHTML = renderMarkdown(text)
  el.querySelectorAll("a").forEach((link) => {
    link.target = "_blank"
    link.rel = "noopener noreferrer"
  })
}
