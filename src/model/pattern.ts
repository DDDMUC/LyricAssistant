export function parsePattern(input: string): number[] {
  const tokens = input
    .split(/[/,，、\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) {
    throw new Error("词格为空")
  }
  const groups: number[] = []
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      throw new Error(`无效的词格片段: ${token}`)
    }
    const n = Number(token)
    if (n < 1) {
      throw new Error(`词格必须每段至少 1 格: ${token}`)
    }
    groups.push(n)
  }
  return groups
}

export function patternToString(pattern: number[]): string {
  return pattern.join("/")
}

export function totalCells(pattern: number[]): number {
  return pattern.reduce((a, b) => a + b, 0)
}

const PUNCT_SYMBOL = /[\p{P}\p{S}]/u

export function contentChars(text: string): string[] {
  const result: string[] = []
  for (const ch of text) {
    if (/\s/u.test(ch)) continue
    if (PUNCT_SYMBOL.test(ch)) continue
    result.push(ch)
  }
  return result
}

export function countChars(text: string): number {
  return contentChars(text).length
}

export function countGroup(token: string): number {
  return countChars(token)
}

export function patternFromLyrics(text: string): number[][] {
  const normalized = text.replace(/^﻿/, "")
  const lines = normalized.split(/\r?\n/)
  const result: number[][] = []
  for (const raw of lines) {
    let line = raw.trim().replace(/^\[[^\]]*\]\s*/, "").trim()
    if (line.length === 0) continue
    if (/^(#|\/\/)/.test(line)) continue
    const tokens = line.split(/\s+/).filter((t) => t.length > 0)
    const groups = tokens.map((t) => countGroup(t)).filter((n) => n > 0)
    if (groups.length === 0) continue
    result.push(groups)
  }
  return result
}

