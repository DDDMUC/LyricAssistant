export type MetaLayout = "compact" | "reserve"

const META_LAYOUT_KEY = "cige-grid-meta-layout"

export const metaLayoutState = { value: "compact" as MetaLayout }

/**
 * 句子工具条（备选 / 备注 / 按钮那一条）的两种排版：
 * - compact：只有「当前句」长出来，其余句子不占位（更紧凑；切句时会跳一下）
 * - reserve：一直占位，悬停或当前句才显形（不跳版；平时多一条空档）
 */
export function applyMetaLayout(value: MetaLayout): void {
  metaLayoutState.value = value
  document.documentElement.classList.toggle("meta-reserve", value === "reserve")
  try {
    localStorage.setItem(META_LAYOUT_KEY, value)
  } catch {
    // 忽略配额错误
  }
}

export function initMetaLayout(): MetaLayout {
  let value: MetaLayout = "compact"
  try {
    const saved = localStorage.getItem(META_LAYOUT_KEY)
    if (saved === "compact" || saved === "reserve") value = saved
  } catch {
    // 忽略
  }
  applyMetaLayout(value)
  return value
}

export function metaLayoutLabel(value: MetaLayout): string {
  return value === "reserve" ? "占位（悬停或当前句显形）" : "不占位（只在当前句显示）"
}
