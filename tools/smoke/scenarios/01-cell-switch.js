// 场景：点击 / 真实指针序列换格（页面是全新的，光标在第 1 格）
const pointerClick = (el) => {
  if (!el) return;
  const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
};
const cellAt = (index) =>
  document.querySelector(`.sentence .cell[data-index="${index}"], .sentence .cell-input[data-index="${index}"]`);
const inputIndex = () => document.querySelector("input.cell-input")?.dataset.index ?? null;
pointerClick(cellAt(2));
await new Promise((r) => setTimeout(r, 60));
const after2 = inputIndex();
pointerClick(cellAt(5));
await new Promise((r) => setTimeout(r, 60));
const after5 = inputIndex();
pointerClick(cellAt(1));
await new Promise((r) => setTimeout(r, 60));
const after1 = inputIndex();
return {
  ok: after2 === "2" && after5 === "5" && after1 === "1" && (window.__errors ?? []).length === 0,
  detail: `点第2格→${after2}、第5格→${after5}、第1格→${after1}`,
};
