import { sealEntry } from '../hooks/checksum.ts'
import type { Entry } from '../types'

const START = Date.parse('2026-10-07T00:00:00.000Z')
let counter = 0

export function entry(kind: Entry['kind'], data: unknown, extra: Partial<Entry> = {}): Entry {
  counter += 1
  return {
    id: counter.toString(16).padStart(12, '0'),
    at: new Date(START + counter * 1000).toISOString(),
    kind,
    why: 'test',
    basis: { type: 'ai' },
    data,
    ...extra,
  } as Entry
}

export async function logText(entries: Entry[]): Promise<string> {
  const lines: string[] = []
  for (const e of entries) lines.push(await sealEntry(e))
  return lines.join('\n') + '\n'
}
