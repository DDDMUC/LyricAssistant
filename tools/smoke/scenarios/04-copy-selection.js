// 场景：打字 → 框选 → 系统选区（右键复制会拿到的）→ ⌘C（全新页面，光标在第 1 格）
const cellText = (el) => {
  if (!el) return "";
  if (el instanceof HTMLInputElement) return el.value.trim();
  return (el.textContent ?? "").trim();
};
const typeChar = async (char) => {
  const input = document.querySelector("input.cell-input");
  input.value = char;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
};
await typeChar("东");
await typeChar("江");
const sentence = document.querySelectorAll(".sentence")[0];
const cellsOf = (index) => sentence.querySelector(`.cell[data-index="${index}"], .cell-input[data-index="${index}"]`);
const typed = `东=${cellText(cellsOf(0))} 江=${cellText(cellsOf(1))}`;
const a = cellsOf(0);
const b = cellsOf(1);
const ra = a.getBoundingClientRect();
const rb = b.getBoundingClientRect();
const opts = (r) => ({ bubbles: true, cancelable: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, pointerType: "mouse", isPrimary: true });
a.dispatchEvent(new PointerEvent("pointerdown", opts(ra)));
document.dispatchEvent(new PointerEvent("pointermove", opts(rb)));
await new Promise((r) => setTimeout(r, 60));
const mirrored = window.getSelection()?.toString() ?? "";
const selectedCount = document.querySelectorAll(".cell.selected, .cell-input.selected").length;
document.dispatchEvent(new PointerEvent("pointerup", opts(rb)));
document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true, bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 80));
const selectedAfter = document.querySelectorAll(".cell.selected, .cell-input.selected").length;
return {
  ok:
    cellText(cellsOf(0)) === "东" &&
    cellText(cellsOf(1)) === "江" &&
    selectedCount >= 2 &&
    mirrored === "东江" &&
    selectedAfter === 0 &&
    (window.__errors ?? []).length === 0,
  detail: `落格 ${typed}、框选 ${selectedCount} 格、系统选区=「${mirrored}」、复制后选中=${selectedAfter}`,
};
