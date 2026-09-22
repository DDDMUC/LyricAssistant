export type ThemePref = "auto" | "light" | "dark"

const THEME_KEY = "cige-grid-theme"
const order: ThemePref[] = ["auto", "light", "dark"]

export const themeState = { pref: "auto" as ThemePref }

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolvedTheme(pref: ThemePref): "light" | "dark" {
  return pref === "auto" ? systemTheme() : pref
}

export function applyTheme(pref: ThemePref): void {
  themeState.pref = pref
  document.documentElement.dataset.theme = resolvedTheme(pref)
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // 忽略配额错误
  }
}

export function initTheme(): ThemePref {
  let pref: ThemePref = "auto"
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === "auto" || saved === "light" || saved === "dark") pref = saved
  } catch {
    // 忽略
  }
  applyTheme(pref)
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themeState.pref === "auto") applyTheme("auto")
  })
  return pref
}

export function cycleTheme(): ThemePref {
  const idx = order.indexOf(themeState.pref)
  const next = order[(idx + 1) % order.length]
  applyTheme(next)
  return next
}

export function themeLabel(pref: ThemePref): string {
  if (pref === "light") return "亮色"
  if (pref === "dark") return "深色"
  return "跟随系统"
}

export function themeIcon(pref: ThemePref): string {
  if (pref === "light") return "☀️"
  if (pref === "dark") return "🌙"
  return "☁️"
}
