// 场景：布局回归 —— 两字气泡不能被压成逐字换行；进度条避让（AI 面板已拆成独立窗口，主窗口只剩原文面板会挤它）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// AI 面板现在是独立窗口（?win=ai 里 init 时就把 hidden 摘掉）：这里照它的样子露出来量气泡
const panel = document.querySelector("#ai-panel");
panel.removeAttribute("hidden");
await sleep(150);
const messages = document.querySelector("#ai-messages");
const wrap = document.createElement("div");
wrap.className = "ai-msg user";
const bubble = document.createElement("div");
bubble.className = "ai-user-text";
bubble.textContent = "作词";
wrap.appendChild(bubble);
messages.appendChild(wrap);
const bubbleWidth = bubble.getBoundingClientRect().width;
const aiWidth = getComputedStyle(document.documentElement).getPropertyValue("--ai-width").trim();
wrap.remove();
panel.setAttribute("hidden", "");

// AI 面板默认内嵌：点顶栏 AI 就是开合面板（不碰窗口 API）
const aiBtn = document.querySelector("#btn-ai");
aiBtn.click();
await sleep(150);
const inlineOpen = !document.querySelector("#ai-panel").hasAttribute("hidden");
const detachedAfterOpen = document.documentElement.classList.contains("ai-detached");
aiBtn.click();
await sleep(120);
const inlineClosed = document.querySelector("#ai-panel").hasAttribute("hidden");

// 点「拆出」才去建独立窗：冒烟桩里 invoke 会失败，但不能炸出未处理错误，且要自动收回内嵌
document.querySelector("#btn-ai-detach").click();
await sleep(250);
const errorsAfterDetach = (window.__errors ?? []).length;
const detachedNow = document.documentElement.classList.contains("ai-detached");
// 拆出状态下点 AI 按钮不再开关内嵌面板（它去聚焦独立窗）
const panelBeforeToggle = document.querySelector("#ai-panel").hasAttribute("hidden");
aiBtn.click();
await sleep(150);
const panelAfterToggle = document.querySelector("#ai-panel").hasAttribute("hidden");

// 进度条避让：现在只有原文面板会挤它
document.querySelector("#btn-ai").title;
const progress = document.querySelector("#scroll-progress");
const rightPlain = getComputedStyle(progress).right;
const sourceBtn = document.querySelector("#btn-source");
const hasSource = !!sourceBtn && !sourceBtn.hidden;
let rightWithSource = "";
if (hasSource) {
  sourceBtn.click();
  await sleep(150);
  rightWithSource = getComputedStyle(progress).right;
  sourceBtn.click();
  await sleep(150);
}

return {
  ok:
    bubbleWidth > 30 &&
    aiWidth !== "" &&
    rightPlain === "0px" &&
    inlineOpen &&
    !detachedAfterOpen &&
    inlineClosed &&
    errorsAfterDetach === 0 &&
    detachedNow &&
    panelBeforeToggle === panelAfterToggle &&
    (!hasSource || rightWithSource === "280px") &&
    (window.__errors ?? []).length === 0,
  detail: `气泡宽=${Math.round(bubbleWidth)}px、--ai-width=${aiWidth}、默认内嵌开=${inlineOpen}/关=${inlineClosed}、未自动拆=${!detachedAfterOpen}、拆出后不再开关内嵌=${panelBeforeToggle === panelAfterToggle}、进度条默认=${rightPlain}、原文面板开=${rightWithSource || "n/a"}`,
};
