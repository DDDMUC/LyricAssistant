// 场景：Markdown 渲染在真引擎（WKWebView）里的清洗与结构
const { renderMarkdown } = await import("/src/markdown.ts");
const dirty =
  '<script>alert(1)</script><img src=x onerror=alert(1)><p style="color:red" onclick="x()">文</p>';
const clean = renderMarkdown(dirty);
const strong = renderMarkdown("**粗** 和 `code`\n\n> 引用");
const jsLink = renderMarkdown("[坏](javascript:alert(1))");
const okLink = renderMarkdown("[好](https://example.com)");
const safe =
  !clean.includes("<script") &&
  !clean.includes("alert(1)") &&
  !clean.includes("<img") &&
  !clean.includes("onerror") &&
  !clean.includes("onclick") &&
  !clean.includes("style=") &&
  clean.includes("文");
const struct =
  strong.includes("<strong>粗</strong>") &&
  strong.includes("<code>code</code>") &&
  strong.includes("<blockquote>");
const link = !jsLink.includes("javascript:") && okLink.includes('href="https://example.com"');
return {
  ok: safe && struct && link && (window.__errors ?? []).length === 0,
  detail: `清洗=${safe}、结构=${struct}、链接=${link}`,
};
