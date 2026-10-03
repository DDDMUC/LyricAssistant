// 场景：设置面板（标题栏 ⚙）分类、数据入口、主题切换、关闭
const btn = document.querySelector("#btn-settings");
if (!btn) return { ok: false, detail: "没有 ⚙ 按钮" };
btn.click();
await new Promise((r) => setTimeout(r, 60));
const dialog = document.querySelector("dialog[open].settings-dialog");
if (!dialog) return { ok: false, detail: "设置弹窗没开" };
const nav = (label) =>
  Array.from(dialog.querySelectorAll(".settings-nav button")).find((b) => b.textContent === label);
const navs = Array.from(dialog.querySelectorAll(".settings-nav button")).map((b) => b.textContent);
nav("数据").click();
const hasData =
  dialog.textContent.includes("恢复草稿备份") &&
  dialog.textContent.includes("导出诊断日志") &&
  dialog.textContent.includes("重置界面状态");
nav("外观").click();
const choices = Array.from(dialog.querySelectorAll(".settings-choice"));
choices.find((c) => c.textContent.includes("深色")).click();
await new Promise((r) => setTimeout(r, 40));
const darkApplied = document.documentElement.dataset.theme === "dark";
choices.find((c) => c.textContent.includes("跟随系统")).click();
nav("关于").click();
const hasAbout = dialog.textContent.includes("版本") && dialog.textContent.includes("使用说明与快捷键");
dialog.close();
await new Promise((r) => setTimeout(r, 40));
const closed = !document.querySelector("dialog[open].settings-dialog");
return {
  ok:
    navs.join("/") === "外观/AI/数据/关于" &&
    hasData &&
    darkApplied &&
    hasAbout &&
    closed &&
    (window.__errors ?? []).length === 0,
  detail: `分类=${navs.join("/")}、数据=${hasData}、深色生效=${darkApplied}、关于=${hasAbout}、关闭=${closed}`,
};
