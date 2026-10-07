import type { On } from 'claude-code'

/** The first moment the mocked clock reads; later than every timestamp the fixtures make. */
export const CLOCK_START = Date.parse('2026-10-08T00:00:00.000Z')

export type World = {
  /** The files by absolute path, as last written. */
  files: Record<string, string>
  /** Every value the plugin stored, by key, as last written. */
  store: Map<string, unknown>
  submitted: string[]
  opened: string[]
  toasts: string[]
  /** Releases the waits `$.clock.after` is holding. */
  fireTimer: () => void
  /** While true every `stat` reports a bigger file than the one before, as if another session were writing. */
  statBump: boolean
  /** How far each `clock.now` call moves the clock; 0 freezes it. */
  clockStep: number
}

// A session on /repo, in memory: files, the plugin store, git, a clock that moves by itself and timers the test fires.
export function world(on: On, files: Record<string, string> = {}): World {
  const mtimes: Record<string, number> = {}
  const waits: (() => void)[] = []
  let bumps = 0
  let time = CLOCK_START
  const w: World = {
    files: { ...files },
    store: new Map(),
    submitted: [],
    opened: [],
    toasts: [],
    fireTimer: () => {
      for (const release of waits.splice(0)) release()
    },
    statBump: false,
    clockStep: 1000,
  }
  // The engine hands paths over in the host's spelling (drive letter and backslashes on Windows); files are keyed /repo/plan.
  const key = (path: string): string => path.replace(/^[a-z]:/i, '').replace(/\\/g, '/')
  const has = (path: string): boolean => Object.hasOwn(w.files, key(path))

  on('fs.exists', (_, e) => ({ value: has(e.path) }))
  on('fs.read', (_, e) => {
    if (!has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    return { value: w.files[key(e.path)] }
  })
  on('fs.write', (_, e) => {
    w.files[key(e.path)] = e.text
    mtimes[key(e.path)] = (mtimes[key(e.path)] ?? 0) + 1
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    if (!has(e.path)) throw new Error(`ENOENT: ${e.path}`)
    if (w.statBump) bumps += 1
    return { value: { kind: 'file' as const, size: w.files[key(e.path)].length + bumps, mtimeMs: mtimes[key(e.path)] ?? 0, isLink: false } }
  })
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/repo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('clock.now', () => {
    const now = time
    time += w.clockStep
    return { value: now }
  })
  on('clock.after', () => new Promise(resolve => waits.push(() => resolve({ value: undefined }))))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__plan-board__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: undefined as never }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // What the engine does beneath the plugins: a call that gets this far was not stopped.
  on('tool.call', () => ({ result: 'passed through' }))
  on('prompt.compose', () => ({ sections: [] }))
  on('session.start', (_, e) => e)
  on('session.cwd', () => ({ value: '/repo' }))
  return w
}
