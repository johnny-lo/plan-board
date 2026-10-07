import { sealEntry, sha16 } from './checksum.ts'
import type { Entry } from '../types'

/**
 * The part of the engine's `$` these functions use. The plugin loader follows `$` only inside the file that
 * declares it, so register.tsx hands over closures such as `exists: path => $.fs.exists(path)` instead of `$`.
 */
export type Files = {
  session: { cwd: () => Promise<string> }
  process: { run: (argv: string[], init: { cwd: string }) => Promise<{ exitCode: number; stdout: string }> }
  fs: {
    exists: (path: string) => Promise<boolean>
    read: (path: string) => Promise<string>
    write: (path: string, text: string) => Promise<void>
    stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
  }
}

const TRIES = 3
const ATTRIBUTES_LINE = 'plan/log.jsonl merge=union'

const slashed = (path: string): string => path.replace(/\\/g, '/')

export async function rootOf($: Files): Promise<string> {
  const cwd = await $.session.cwd()
  try {
    const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    const top = ran.stdout.trim()
    if (ran.exitCode === 0 && top !== '') return slashed(top)
  } catch {}
  return slashed(cwd)
}

export const logPath = (root: string): string => `${root}/plan/log.jsonl`

export async function readLog($: Files, root: string): Promise<string> {
  const path = logPath(root)
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
}

/** The log with the lines hashing into `drop` removed and one sealed line per entry added; the text always ends in a newline. */
export async function nextText(text: string, entries: Entry[], drop: string[]): Promise<string> {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const dropped = new Set(drop)
  let out = ''
  for (const [i, line] of lines.entries()) {
    // Replay hashes the line without a BOM or a trailing CR.
    const bare = (i === 0 && line.startsWith('﻿') ? line.slice(1) : line).replace(/\r$/, '')
    if (dropped.size > 0 && dropped.has(await sha16(bare))) continue
    out += line + '\n'
  }
  for (const entry of entries) out += (await sealEntry(entry)) + '\n'
  return out
}

type Seen = { size: number; mtimeMs: number } | null

async function seen($: Files, path: string): Promise<Seen> {
  if (!(await $.fs.exists(path))) return null
  const { size, mtimeMs } = await $.fs.stat(path)
  return { size, mtimeMs }
}

const same = (a: Seen, b: Seen): boolean => (a === null || b === null ? a === b : a.size === b.size && a.mtimeMs === b.mtimeMs)

/** Writes the entries (and removes the dropped lines) unless another session changed the file meanwhile; at most 3 tries. */
export async function commitEntries($: Files, root: string, entries: Entry[], drop: string[]): Promise<'ok' | 'busy'> {
  const path = logPath(root)
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const before = await seen($, path)
    const text = before === null ? '' : await $.fs.read(path)
    const next = await nextText(text, entries, drop)
    if (!same(before, await seen($, path))) continue
    await $.fs.write(path, next)
    await ensureAttributes($, root)
    return 'ok'
  }
  return 'busy'
}

export async function ensureAttributes($: Files, root: string): Promise<void> {
  const path = `${root}/.gitattributes`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  if (text.split(/\r?\n/).includes(ATTRIBUTES_LINE)) return
  await $.fs.write(path, text + (text === '' || text.endsWith('\n') ? '' : '\n') + ATTRIBUTES_LINE + '\n')
}
