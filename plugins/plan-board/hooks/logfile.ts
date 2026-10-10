import { sealEntry, sha16 } from './checksum.ts'
import type { Entry, Storage } from '../types'

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

/** The part of `$.store` the local log uses; handed over as closures for the same reason as Files. */
export type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
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

/** Where a worktree's log lives in $.store while the repo has no plan/log.jsonl. */
export const storeKey = (root: string): string => 'log:' + root

/**
 * Where the log's text is kept. `read` answers the text with a version that changes whenever the text does
 * (null: nothing there); `version` asks for the current one again.
 */
export type Medium = {
  read: () => Promise<{ text: string; version: string } | null>
  version: () => Promise<string | null>
  write: (text: string) => Promise<void>
  /** Whether a write may make the log appear where there was none. */
  mayCreate: boolean
}

async function stamped($: Files, path: string): Promise<string | null> {
  if (!(await $.fs.exists(path))) return null
  const { size, mtimeMs } = await $.fs.stat(path)
  return `${size}:${mtimeMs}`
}

/** plan/log.jsonl; it is never created by a write, only by /plan init. */
export function repoMedium($: Files, root: string): Medium {
  const path = logPath(root)
  return {
    read: async () => {
      const version = await stamped($, path)
      return version === null ? null : { version, text: await $.fs.read(path) }
    },
    version: () => stamped($, path),
    write: (text) => $.fs.write(path, text),
    mayCreate: false,
  }
}

/** The same text format kept in $.store, for a repo that has no plan/log.jsonl. */
export function storeMedium(store: Store, root: string): Medium {
  const key = storeKey(root)
  const textOf = async (): Promise<string | null> => {
    const value = await store.get(key)
    return typeof value === 'string' ? value : null
  }
  return {
    read: async () => {
      const text = await textOf()
      return text === null ? null : { text, version: text }
    },
    version: textOf,
    write: (text) => store.set(key, text),
    mayCreate: true,
  }
}

/** Repo mode when `<root>/plan/log.jsonl` exists, local mode otherwise; asked again on every read. */
export async function modeOf($: Files, root: string): Promise<Storage> {
  return (await $.fs.exists(logPath(root))) ? 'repo' : 'local'
}

export async function readLog($: Files, root: string): Promise<string> {
  return (await repoMedium($, root).read())?.text ?? ''
}

export async function readStored(store: Store, root: string): Promise<string> {
  return (await storeMedium(store, root).read())?.text ?? ''
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

/**
 * Writes the entries (and removes the dropped lines) unless another session changed the text meanwhile; at most 3 tries.
 * `'missing'`: the medium holds no log and may not make one.
 * `'moved'`: only when `elsewhere` is given; it said, right before a write, that the log now lives somewhere else, and nothing was written.
 */
export function commitText(medium: Medium, entries: Entry[], drop: string[]): Promise<'ok' | 'busy' | 'missing'>
export function commitText(
  medium: Medium,
  entries: Entry[],
  drop: string[],
  elsewhere: () => Promise<boolean>,
): Promise<'ok' | 'busy' | 'missing' | 'moved'>
export async function commitText(
  medium: Medium,
  entries: Entry[],
  drop: string[],
  elsewhere: () => Promise<boolean> = async () => false,
): Promise<'ok' | 'busy' | 'missing' | 'moved'> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const before = await medium.read()
    if (before === null && !medium.mayCreate) return 'missing'
    const next = await nextText(before?.text ?? '', entries, drop)
    if ((await medium.version()) !== (before?.version ?? null)) continue
    if (await elsewhere()) return 'moved'
    await medium.write(next)
    return 'ok'
  }
  return 'busy'
}

/**
 * Appends to plan/log.jsonl (repo mode).
 * `'no-attributes'`: the entries are written, but .gitattributes could not be brought up to date.
 */
export async function commitEntries($: Files, root: string, entries: Entry[], drop: string[]): Promise<'ok' | 'busy' | 'missing' | 'no-attributes'> {
  const outcome = await commitText(repoMedium($, root), entries, drop)
  if (outcome !== 'ok') return outcome
  // The log is written: from here the entries count as committed, whatever happens to .gitattributes.
  try {
    await ensureAttributes($, root)
  } catch {
    return 'no-attributes'
  }
  return 'ok'
}

/**
 * Appends to the log kept in $.store (local mode). Before every write it looks for plan/log.jsonl again: when another
 * session's /plan init has made it, the entries go there instead (repo mode), and $.store is left alone.
 */
export async function commitLocal($: Files, store: Store, root: string, entries: Entry[], drop: string[]): Promise<'ok' | 'busy' | 'missing' | 'no-attributes'> {
  const outcome = await commitText(storeMedium(store, root), entries, drop, () => $.fs.exists(logPath(root)))
  return outcome === 'moved' ? commitEntries($, root, entries, drop) : outcome
}

/** The lines of `text` that `base` does not have, each once, in order; `text` is where they come from. */
function gainedLines(base: string, text: string): string[] {
  const known = new Set(base.split('\n'))
  const gained: string[] = []
  for (const line of text.split('\n')) {
    if (line === '' || known.has(line)) continue
    known.add(line)
    gained.push(line)
  }
  return gained
}

/** Adds the lines of `now` that plan/log.jsonl lacks, unless another session changed it meanwhile; at most 3 tries, then it throws. */
async function appendGained(medium: Medium, now: string): Promise<void> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const before = await medium.read()
    if (before === null) throw new Error('plan/log.jsonl is gone')
    const gained = gainedLines(before.text, now)
    if (gained.length === 0) return
    if ((await medium.version()) !== before.version) continue
    await medium.write(before.text + (before.text === '' || before.text.endsWith('\n') ? '' : '\n') + gained.join('\n') + '\n')
    return
  }
  throw new Error('plan/log.jsonl keeps changing')
}

/**
 * What /plan init does: plan/log.jsonl gets the local text, the local copy goes away and .gitattributes gets its line.
 * The local copy is read again before it goes: lines it gained meanwhile are added to plan/log.jsonl (the ones already
 * there stay, as with merge=union, and a line another session adds meanwhile is not overwritten), up to 3 times.
 * `'exists'`: the repo already has the file, so nothing was touched.
 * `'kept'`: the local copy kept changing, so it was not deleted.
 * `'kept-no-attributes'`: the same, and .gitattributes could not be brought up to date either.
 * `'failed'`: plan/log.jsonl could not be made; nothing changed.
 * `'half'`: plan/log.jsonl was made, but a later step failed.
 */
export async function initRepo($: Files, store: Store, root: string): Promise<'created' | 'exists' | 'no-attributes' | 'kept' | 'kept-no-attributes' | 'failed' | 'half'> {
  let isWritten = false
  try {
    if (await $.fs.exists(logPath(root))) return 'exists'
    let seen = await readStored(store, root)
    await $.fs.write(logPath(root), seen)
    isWritten = true
    let isDeleted = false
    for (let check = 0; check < TRIES && !isDeleted; check++) {
      const now = await readStored(store, root)
      if (now === seen) {
        await store.delete(storeKey(root))
        isDeleted = true
        continue
      }
      await appendGained(repoMedium($, root), now)
      seen = now
    }
    try {
      await ensureAttributes($, root)
    } catch {
      return isDeleted ? 'no-attributes' : 'kept-no-attributes'
    }
    return isDeleted ? 'created' : 'kept'
  } catch {
    return isWritten ? 'half' : 'failed'
  }
}

export async function ensureAttributes($: Files, root: string): Promise<void> {
  const path = `${root}/.gitattributes`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  if (text.split(/\r?\n/).includes(ATTRIBUTES_LINE)) return
  await $.fs.write(path, text + (text === '' || text.endsWith('\n') ? '' : '\n') + ATTRIBUTES_LINE + '\n')
}
