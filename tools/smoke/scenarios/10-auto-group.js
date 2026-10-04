// 场景：工具条「成组」＝一键按辙把全曲的字归组锁起来
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pointerClick = (el) => {
  if (!el) return;
  const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
};
const cellOf = (si, index) =>
  document.querySelectorAll(".sentence")[si].querySelector(`.cell[data-index="${index}"], .cell-input[data-index="${index}"]`);
const typeCell = async (si, index, char) => {
  pointerClick(cellOf(si, index));
  await sleep(60);
  const input = document.querySelector("input.cell-input");
  if (!input) return false;
  input.value = char;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(60);
  return true;
};
const typed =
  (await typeCell(0, 0, "东")) &&
  (await typeCell(0, 2, "风")) &&
  (await typeCell(1, 0, "花")) &&
  (await typeCell(1, 2, "家"));
document.querySelector("#btn-auto-group").click();
await sleep(150);
const dialog = document.querySelector("dialog[open].auto-group-dialog");
const dims = dialog ? dialog.querySelectorAll('input[type="checkbox"]').length : 0;
if (dialog) {
  Array.from(dialog.querySelectorAll("button"))
    .find((b) => b.textContent === "自动成组")
    .click();
}
await sleep(250);
const members = document.querySelectorAll(".cell.group-member, .cell-input.group-member").length;
const status = document.querySelector("#status-hint")?.textContent ?? "";
return {
  ok: typed && !!dialog && dims === 4 && members === 4 && status.includes("2 组 / 4 格") && (window.__errors ?? []).length === 0,
  detail: `打字=${typed}、维度=${dims}、组员=${members}、状态=${status.slice(0, 30)}`,
};
