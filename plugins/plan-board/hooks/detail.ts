import type { Plan } from '../types'
import { textWidth } from './lines.ts'

export const DETAIL_CELLS = 400
export const DETAIL_LINES = 8

/** What a detail is compared with: the field's name as an error says it, and that field's text. */
export type Title = { name: string; text: string }

const STRIP = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩​‌‍⁠﻿]/g
const SKIP = /[\s\p{P}\p{S}]/gu

/** Design 11.2, in order; '' when nothing is left. */
export function normalizeDetail(text: string): string {
  const unified = text.replace(/\r\n|\r/g, '\n').replace(/\t/g, ' ')
  const clean = unified.replace(STRIP, '')
  const lines = clean.split('\n').map((line) => line.replace(/\s+$/, ''))
  const out: string[] = []
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue
    out.push(line)
  }
  return out.join('\n').replace(/^\s+/, '').replace(/\s+$/, '')
}

function squash(text: string): string {
  return text.replace(SKIP, '').toLowerCase()
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch)
}

function mentions(text: string, id: string): boolean {
  let from = 0
  for (;;) {
    const at = text.indexOf(id, from)
    if (at < 0) return false
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + id.length])) return true
    from = at + 1
  }
}

/** For a normalized, non-empty detail: the first problem of cells, lines, repeats, plan ids, as the error message; null when it may be written. */
export function detailProblem(field: string, detail: string, titles: Title[], plan: Plan): string | null {
  const cells = textWidth(detail.replace(/\n/g, ''))
  if (cells > DETAIL_CELLS) {
    return `${field} is ${cells} cells wide; keep it within ${DETAIL_CELLS} (about 200 Chinese characters). Put the rest in the spec and link it`
  }
  const lines = detail.split('\n').length
  if (lines > DETAIL_LINES) {
    return `${field} is ${lines} lines long; keep it within ${DETAIL_LINES} lines. Put the rest in the spec and link it`
  }
  const mine = squash(detail)
  for (const title of titles) {
    if (squash(title.text) === mine) return `${field} only repeats the ${title.name}; say what it leaves out`
  }
  const ids: string[] = []
  for (const id of [...Object.keys(plan.items), ...Object.keys(plan.steps), ...Object.keys(plan.cards)]) {
    if (id.length >= 6 && !ids.includes(id) && mentions(detail, id)) ids.push(id)
  }
  if (ids.length > 0) return `${field} names plan ids (${ids.join(', ')}); use the names the user sees`
  return null
}
