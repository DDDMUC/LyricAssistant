// 场景：逐格锁 —— 锁住第 1 格后，打不押该辙的字会被拦（全新页面）
document.querySelector(".sentence .rhyme-badge").click();
await new Promise((r) => setTimeout(r, 80));
const dialog = document.querySelector("dialog[open]");
if (!dialog) return { ok: false, detail: "锁定对话框没打开" };
const btn = Array.from(dialog.querySelectorAll(".rhyme-grid button")).find((b) => b.textContent === "中东");
if (!btn) return { ok: false, detail: "对话框里没有「中东」" };
btn.click();
await new Promise((r) => setTimeout(r, 80));
const lockedBadge = document.querySelector(".sentence .rhyme-badge")?.textContent ?? "";
const input = document.querySelector("input.cell-input");
input.value = "江"; // 江阳辙，不押中东
input.dispatchEvent(new Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
const hint = document.querySelector("#status-hint")?.textContent ?? "";
return {
  ok:
    lockedBadge.includes("🔒") &&
    hint.includes("已拦下") &&
    (document.querySelector("input.cell-input")?.value ?? "") === "" &&
    (window.__errors ?? []).length === 0,
  detail: `徽章=${lockedBadge}、状态栏=${hint.slice(0, 40)}`,
};
