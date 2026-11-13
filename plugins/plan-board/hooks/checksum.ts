import type { Entry } from '../types'

export async function sha16(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let hex = ''
  for (const b of new Uint8Array(bytes)) hex += b.toString(16).padStart(2, '0')
  return hex.slice(0, 16)
}

/** `detail` comes after `data` and is left out when undefined, so a line sealed before details existed keeps its sum. */
const sumOf = (e: { id: unknown; at: unknown; kind: unknown; why: unknown; basis: unknown; data: unknown; detail?: unknown }) =>
  sha16(JSON.stringify({ id: e.id, at: e.at, kind: e.kind, why: e.why, basis: e.basis, data: e.data, detail: e.detail }))

export async function sealEntry(entry: Entry): Promise<string> {
  const sum = await sumOf(entry)
  const { id, at, kind, why, basis, data, detail } = entry
  return JSON.stringify({ id, at, kind, why, basis, data, detail, sum })
}

export async function checkLine(raw: string): Promise<{ entry: Entry | null; isSealed: boolean; hash: string }> {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
  const hash = await sha16(line)
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return { entry: null, isSealed: false, hash }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { entry: null, isSealed: false, hash }
  const { sum, ...rest } = parsed as Record<string, unknown>
  const entry = rest as unknown as Entry
  return { entry, isSealed: typeof sum === 'string' && sum === (await sha16(JSON.stringify(rest))), hash }
}
