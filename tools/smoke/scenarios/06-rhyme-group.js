// 场景：G 挑两格 → 建韵组（不合的字被清空）→ G 收起（条真消失）→ 拦字 → 解散（真引擎）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sentence0 = () => document.querySelectorAll(".sentence")[0];
const cellAt = (index) => sentence0().querySelector(`.cell[data-index="${index}"], .cell-input[data-index="${index}"]`);
const cellText = (el) => (el instanceof HTMLInputElement ? el.value : el.textContent ?? "").trim();
const pick = (el) => {
  const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
};
const keyG = () => {
  // 模拟真实焦点路由：keydown 落在当前焦点元素上（格子输入框等）
  const target =
    document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true, cancelable: true }));
};
const keyEsc = () =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

// 第 1 格打「东」（种子，中东辙）
let input = document.querySelector("input.cell-input");
input.value = "东";
input.dispatchEvent(new Event("input", { bubbles: true }));
await sleep(60);
// 第 3 格打「江」（江阳辙，不合 → 建组时应被清空）
cellAt(2).click();
await sleep(60);
const inputB = sentence0().querySelector('input.cell-input[data-index="2"]');
if (!inputB) return { ok: false, detail: "第 3 格没变成输入框" };
inputB.value = "江";
inputB.dispatchEvent(new Event("input", { bubbles: true }));
await sleep(60);

// G 挑第 1、3 格（模式里直接点浮动条；退出模式会清空选择）
keyG();
pick(cellAt(0));
pick(cellAt(2));
await sleep(60);
const bar = document.querySelector(".pick-bar");
if (!bar || bar.hidden) return { ok: false, detail: "浮动条没出现" };
Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "成组").click();
await sleep(80);
const dialog = document.querySelector(".rhyme-group-dialog");
if (!dialog) return { ok: false, detail: "建组对话框没打开" };
Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "建立韵组").click();
await sleep(80);
const badgeBuilt = (document.querySelector("#status-hint")?.textContent ?? "").includes("已建立韵组");
const clearedMismatch = cellText(cellAt(2)) === "";
const chipText = document.querySelector("#status-groups")?.textContent ?? "";
document.querySelector("#status-groups").click();
await sleep(80);
const overview = document.querySelector(".rhyme-groups-dialog");
const overviewRows = overview ? overview.querySelectorAll(".rhyme-group-row").length : 0;
const cellButtons = overview ? overview.querySelectorAll(".rhyme-group-cell-button").length : 0;
const overviewOk = chipText.includes("韵组 1") && overviewRows === 1 && overview.textContent.includes("中东辙") && cellButtons === 2;
// 点约束「中东辙」→ 编辑韵组（断言打开 + 预填，然后取消）
let editPrefill = false;
const constraintBtn = overview ? overview.querySelector(".rhyme-group-constraint") : null;
if (constraintBtn) {
  constraintBtn.click();
  await sleep(80);
  const edit = document.querySelector(".rhyme-group-dialog");
  const sel = edit ? edit.querySelector("select") : null;
  editPrefill = !!edit && edit.textContent.includes("编辑韵组") && !!sel && sel.value === "zhongdong";
  if (edit) {
    Array.from(edit.querySelectorAll("button")).find((b) => b.textContent === "取消").click();
    await sleep(60);
  }
}
if (overview && overview.isConnected) {
  const closeBtn = Array.from(overview.querySelectorAll("button")).find((b) => b.textContent === "关闭");
  if (closeBtn) closeBtn.click();
  await sleep(60);
}
// 点成员按钮「3格·空」→ 关弹窗 + 光标跳那一格（真引擎点击验证）
let jumpOk = false;
document.querySelector("#status-groups").click();
await sleep(80);
const overviewJump = document.querySelector(".rhyme-groups-dialog");
if (overviewJump) {
  const buttons = overviewJump.querySelectorAll(".rhyme-group-cell-button");
  const target = buttons.length >= 2 ? buttons[1] : null; // 「3格·空」→ 第 3 格
  if (target) {
    target.click();
    await sleep(100);
    jumpOk = !document.querySelector(".rhyme-groups-dialog") && !!document.querySelector('.cell-input[data-index="2"]');
  }
}


// G 收起：退出模式（选择清空）——浮动条必须真的从屏幕上消失（真实渲染）
keyG();
await sleep(60);
const barGone = getComputedStyle(bar).display === "none";

// 光标点进组里 → 两格都亮
cellAt(0).click();
await sleep(60);
const litCount = document.querySelectorAll(".cell.group-lit, .cell-input.group-lit").length;

// 打不押的「江」→ 拦下
input = document.querySelector("input.cell-input");
input.value = "江";
input.dispatchEvent(new Event("input", { bubbles: true }));
await sleep(60);
const hint = document.querySelector("#status-hint")?.textContent ?? "";
const blocked = hint.includes("韵组") && cellText(cellAt(0)) === "东";

// 成员在挑格模式里点不动：整组闪一下、不进选择（一次性，不常亮）
keyG();
pick(cellAt(0));
await sleep(40);
let flashNow = cellAt(0).classList.contains("group-flash");
let selNow = !!document.querySelector('.cell.selected[data-index="0"], .cell-input.selected[data-index="0"]');
let modeNow = document.body.classList.contains("pick-mode");
let flashLate = false;
if (!flashNow) {
  await sleep(250);
  flashLate = cellAt(0).classList.contains("group-flash");
  flashNow = flashLate;
  selNow = !!document.querySelector('.cell.selected[data-index="0"], .cell-input.selected[data-index="0"]');
  modeNow = document.body.classList.contains("pick-mode");
}
const memberBlocked = flashNow && !selNow;
await sleep(700);
const flashGone = !cellAt(0).classList.contains("group-flash");

// 快速双击已选的格子 = 取消（误点保护；成员那一下会被拦，不影响）
pick(cellAt(1));
pick(cellAt(0));
pick(cellAt(1));
pick(cellAt(1));
await sleep(60);
const undoPick = !document.querySelector('.cell.selected[data-index="1"], .cell-input.selected[data-index="1"]');

// 点成员：整组闪 + 出「解散这个韵组」小条 → 一键解散
pick(cellAt(0));
await sleep(60);
const dissolveBtn = Array.from(document.querySelector(".pick-bar").querySelectorAll("button")).find(
  (b) => b.textContent === "解散这个韵组",
);
if (!dissolveBtn) return { ok: false, detail: "解散小条没出现" };
window.__seq = { down: 0, up: 0, click: 0 };
dissolveBtn.addEventListener("pointerdown", () => { window.__seq.down += 1; }, true);
dissolveBtn.addEventListener("pointerup", () => { window.__seq.up += 1; }, true);
dissolveBtn.addEventListener("click", () => { window.__seq.click += 1; }, true);
pick(dissolveBtn);
await sleep(120);
keyG();
keyEsc();
await sleep(60);
const dissolved =
  document.querySelectorAll(".cell.group-member, .cell-input.group-member, .cell.group-lit, .cell-input.group-lit")
    .length === 0;
return {
  ok:
    badgeBuilt && clearedMismatch && barGone && litCount >= 2 && blocked && memberBlocked && flashGone &&
    overviewOk && editPrefill && jumpOk && dissolved && undoPick && (window.__errors ?? []).length === 0,
  detail: `建成=${badgeBuilt}、清不合=${clearedMismatch}、总览=${overviewOk}（成员按钮=${cellButtons}）、编辑预填=${editPrefill}、点击跳转=${jumpOk}、G收起后条不可见=${barGone}、亮起=${litCount} 格、拦字=${blocked}、成员点不动闪一下=${memberBlocked}[flash=${flashNow} late=${flashLate} sel=${selNow} mode=${modeNow}]、闪完不常亮=${flashGone}、解散=${dissolved}[seq=${JSON.stringify(window.__seq)}]、双击取消=${undoPick}`,
};
