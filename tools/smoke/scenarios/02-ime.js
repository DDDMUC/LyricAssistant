// 场景：输入法组字 → 徽章实时显示辙 → 选字落格（光标已在第 1 格）
const input = document.querySelector("input.cell-input");
if (!input) return { ok: false, detail: "没有聚焦的格子输入框" };
input.focus();
input.value = "san";
input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
input.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "san" }));
input.dispatchEvent(new Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
const badge = document.querySelector(".sentence .rhyme-badge");
const during = { text: badge?.textContent ?? "", title: badge?.title ?? "" };
input.value = "散";
input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "散" }));
await new Promise((r) => setTimeout(r, 50));
const cellText = (() => {
  const el = document.querySelector('.sentence .cell[data-index="0"], .sentence .cell-input[data-index="0"]');
  return (el?.textContent || el?.value || "").trim();
})();
const afterBadge = document.querySelector(".sentence .rhyme-badge")?.title ?? "";
const cursor = document.querySelector("input.cell-input")?.dataset.index ?? "";
return {
  ok:
    during.text.includes("言前") &&
    during.title.includes("正在拼") &&
    cellText === "散" &&
    !afterBadge.includes("正在拼") &&
    cursor === "1" &&
    (window.__errors ?? []).length === 0,
  detail: `组字中徽章=${during.text}、落格=${cellText}、光标=${cursor}`,
};
