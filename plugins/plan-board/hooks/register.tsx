import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { GUIDE, summary } from './guide.ts'
import { commitEntries, readLog, rootOf } from './logfile.ts'
import type { Files } from './logfile.ts'
import { asLocal, emptyLocal, forget, isApproved, localKey } from './local.ts'
import { emptyPlan, replay } from './replay.ts'
import { TOOLS } from './tools.ts'
import type { ToolName } from './tools.ts'
import type { Plan } from '../types'

const PANE = 'plan-board'
const root = atom({ plugin: 'plan-board', key: 'root' } as const, '')
const plan = atom({ plugin: 'plan-board', key: 'plan' } as const, emptyPlan())
const local = atom({ plugin: 'plan-board', key: 'local' } as const, emptyLocal())

const DENY_EDIT =
  'Files under plan/ are written only through the plan-board tools: propose_change, apply_change, update_step, add_decision, resolve_decision, resolve_direct_edit.'
const DENY_BUSY = 'The plan file is being written by another session; try again.'

/** The full tool names $.tool.register gave this load's tools. */
const names = new Map<string, ToolName>()

const slashed = (path: string): string => path.replace(/\\/g, '/')
// The loader follows `$` only inside this file, so logfile.ts gets closures over it.
const filesOf = ($: EngineInterface): Files => ({
  session: { cwd: () => $.session.cwd() },
  process: { run: (argv, init) => $.process.run(argv, init) },
  fs: {
    exists: path => $.fs.exists(path),
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    stat: path => $.fs.stat(path),
  },
})

const newId = (length: 8 | 12): string => crypto.randomUUID().replace(/-/g, '').slice(0, length)

async function rootNow($: EngineInterface): Promise<string> {
  const known = await read($, root)
  if (known !== '') return known
  const found = await rootOf(filesOf($))
  await update($, root, () => found)
  return found
}

// Reads the log and this machine's pane state afresh: other sessions and git pulls change both between calls.
async function refresh($: EngineInterface): Promise<Plan> {
  const top = await rootNow($)
  const fresh = await replay(await readLog(filesOf($), top))
  const before = await $.store.get(localKey(top))
  const mine = forget(asLocal(before), fresh)
  if (JSON.stringify(mine) !== JSON.stringify(before)) await $.store.set(localKey(top), mine)
  await update($, plan, () => fresh)
  await update($, local, () => mine)
  return fresh
}

/** The time the next entries are stamped with: the clock, but after everything already in the log. */
async function stampOf($: EngineInterface, current: Plan): Promise<string> {
  let latest = Number.NEGATIVE_INFINITY
  for (const at of [...current.applied.map(e => e.at), ...current.skipped.map(s => s.entry.at)]) {
    const ms = Date.parse(at)
    if (ms > latest) latest = ms
  }
  return new Date(Math.max(await $.clock.now(), latest + 1)).toISOString()
}

/** A path made absolute against the cwd with . and .. folded, so a spelling cannot slip past the plan/ check. */
function resolved(path: string, cwd: string): string {
  const full = /^([a-z]:)?\//i.test(path) ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return (full.startsWith('/') ? '/' : '') + parts.join('/')
}

async function isUnderPlan($: EngineInterface, path: unknown): Promise<boolean> {
  if (typeof path !== 'string' || path === '') return false
  const top = await rootNow($)
  const target = resolved(slashed(path), slashed(await $.session.cwd()))
  const dir = resolved(`${top}/plan`, top) + '/'
  // Windows paths differ by case only.
  return /^[a-z]:/i.test(dir) ? target.toLowerCase().startsWith(dir.toLowerCase()) : target.startsWith(dir)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const top = await rootOf(filesOf($))
    await update($, root, () => top)
    await refresh($).catch(() => emptyPlan())
    names.clear()
    for (const [name, tool] of Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]) {
      const registered = await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown> })
      names.set(registered.tool, name)
    }
    await $.command.register({ name: 'plan', description: 'Open the plan board pane' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { tool, tool_use_id: _id, agentId: _agent, consent: _consent, ...input } = e as unknown as Record<string, unknown>
    const mine = typeof tool === 'string' ? names.get(tool) : undefined
    if (mine !== undefined) {
      const current = await refresh($)
      const sent = await read($, local)
      const ran = TOOLS[mine].run(
        { plan: current, now: await stampOf($, current), newId, isApproved: cardId => isApproved(sent, cardId) },
        input,
      )
      if (!ran.ok) return { deny: ran.error }
      let outcome: 'ok' | 'busy'
      try {
        outcome = await commitEntries(filesOf($), await rootNow($), ran.entries, ran.drop)
      } catch (err) {
        return { deny: `Could not write plan/log.jsonl: ${err instanceof Error ? err.message : String(err)}` }
      }
      if (outcome === 'busy') return { deny: DENY_BUSY }
      await refresh($)
      return { result: ran.message }
    }
    if (tool === 'Edit' || tool === 'Write') {
      if (await isUnderPlan($, input.file_path)) return { deny: DENY_EDIT }
    } else if (tool === 'NotebookEdit') {
      if (await isUnderPlan($, input.notebook_path)) return { deny: DENY_EDIT }
    }
    return next(e)
  })

  // Other sessions or a pull may have changed the log since.
  on('prompt.submit', async ($, e, next) => {
    await refresh($).catch(() => emptyPlan())
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = `${GUIDE}\n\n${summary(await read($, plan), await read($, local))}`
    return { sections: [...composed.sections, { id: 'plan-board:guide', text, scope: 'session' as const }] }
  })

  on('command.run', { command: 'plan' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Plan board' })
    return { text: 'Plan board opened.' }
  })
}
