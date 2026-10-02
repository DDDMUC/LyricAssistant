// 场景：文档栏可拆成独立窗口（默认不拆）——拆出后主窗口侧边栏让位；意向只发不本地执行
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 默认：侧边栏在主窗口里，没有 docs-detached
const detachedBefore = document.documentElement.classList.contains("docs-detached");
const sidebarVisible = getComputedStyle(document.querySelector(".sidebar")).display !== "none";

// 点「拆出」：冒烟桩里 invoke 会失败，但不能炸出未处理错误；状态栏要给出人话
document.querySelector("#btn-docs-win").click();
await sleep(200);
const status = document.querySelector("#status-hint")?.textContent ?? "";
const errors = (window.__errors ?? []).length;

// 意向分支：文档栏窗口里的点击不本地执行（这里是主窗口，点文档应正常切歌）
document.querySelector("#btn-new-doc").click();
await sleep(150);
const items = document.querySelectorAll(".doc-item");
const beforeTitle = document.querySelector(".doc-item.active .doc-title")?.textContent ?? "";
if (items[0]) items[0].click();
await sleep(150);
const afterTitle = document.querySelector(".doc-item.active .doc-title")?.textContent ?? "";
const switched = beforeTitle !== afterTitle;

return {
  ok:
    detachedBefore === false &&
    sidebarVisible &&
    errors === 0 &&
    items.length >= 2 &&
    switched &&
    (window.__errors ?? []).length === 0,
  detail: `默认内嵌=${!detachedBefore}、侧边栏可见=${sidebarVisible}、文档数=${items.length}、拆出点击无未处理错误=${errors === 0}（状态栏：${status.slice(0, 40) || "无"}）、点文档正常切歌=${switched}`,
};
