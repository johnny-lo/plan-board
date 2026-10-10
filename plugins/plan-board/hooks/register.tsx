import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { GUIDE, summary } from './guide.ts'
import { langOf, t } from './i18n.ts'
import { commitEntries, commitLocal, initRepo, modeOf, readLog, readStored, rootOf } from './logfile.ts'
import type { Files, Store } from './logfile.ts'
import {
  asLocal,
  batchMessage,
  blockingMessage,
  cleared,
  emptyLocal,
  forget,
  isApproved,
  localKey,
  markSent,
  withChoice,
  withDismiss,
  withDraft,
} from './local.ts'
import { bandView, isBandEmpty, paneView } from './pane.tsx'
import { emptyPlan, replay } from './replay.ts'
import { TOOLS } from './tools.ts'
import type { ToolName } from './tools.ts'
import type { Card, Local, Plan } from '../types'

const PANE = 'plan-board'
const TITLE = 'Plan board'
/** Staged choices go out on their own after this long without a pick. */
const AUTO_SEND_MS = 60_000
const root = atom({ plugin: 'plan-board', key: 'root' } as const, '')
const plan = atom({ plugin: 'plan-board', key: 'plan' } as const, emptyPlan())
const local = atom({ plugin: 'plan-board', key: 'local' } as const, emptyLocal())

const DENY_EDIT =
  'Files under plan/ are written only through the plan-board tools: propose_change, apply_change, update_step, add_decision, resolve_decision, resolve_direct_edit.'
const DENY_BUSY = 'The plan file is being written by another session; try again.'
const DENY_MISSING = 'plan/log.jsonl is gone, so nothing was written. Ask the user to restore it, or to run /plan init for a fresh one.'
const NOTE_ATTRIBUTES =
  ' Note: .gitattributes could not be updated, so plan/log.jsonl may conflict when branches merge; add the line "plan/log.jsonl merge=union" to .gitattributes.'

const INIT_REPLY = {
  created: 'initDone',
  exists: 'initAlready',
  'no-attributes': 'initNoAttributes',
  kept: 'initKept',
  'kept-no-attributes': 'initKeptNoAttributes',
  failed: 'initFailed',
  half: 'initHalf',
} as const

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

const storeOf = ($: EngineInterface): Store => ({
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: key => $.store.delete(key),
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
// The log is plan/log.jsonl when the repo has one, else the text this machine keeps in the store; asked on every read.
async function refresh($: EngineInterface): Promise<Plan> {
  const top = await rootNow($)
  const mode = await modeOf(filesOf($), top)
  const fresh = await replay(mode === 'repo' ? await readLog(filesOf($), top) : await readStored(storeOf($), top), mode)
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

// Per load: a reload cancels pending timers and starts these over.
let timer: { cancel: () => void } | undefined
let isBusy = false
let isSendWhenIdle = false

function cancelTimer(): void {
  timer?.cancel()
  timer = undefined
}

/** Keeps this machine's pane state in the store and on screen. */
async function save($: EngineInterface, next: Local): Promise<void> {
  await $.store.set(localKey(await rootNow($)), next)
  await update($, local, () => next)
}

// Sends every staged card as one message.
async function sendStaged($: EngineInterface): Promise<number> {
  cancelTimer()
  isSendWhenIdle = false
  const current = await read($, local)
  const ids = Object.keys(current.staged)
  if (ids.length === 0) return 0
  const { local: after, sent } = markSent(current, ids, await $.clock.now())
  await save($, after)
  void $.prompt.submit({ text: batchMessage(await read($, plan), sent) }).catch(() => {})
  return sent.length
}

/** Restarts the quiet-time countdown; with nothing staged, stops it. */
function reschedule($: EngineInterface, current: Local): void {
  cancelTimer()
  if (Object.keys(current.staged).length === 0) return
  timer = $.clock.after(AUTO_SEND_MS, () => {
    timer = undefined
    // Claude is working: send when the turn ends instead of queueing behind it now.
    if (isBusy) {
      isSendWhenIdle = true
      return
    }
    void sendStaged($).catch(() => {})
  })
}

async function stage($: EngineInterface, make: (current: Local, at: number) => Local): Promise<void> {
  const at = await $.clock.now()
  const next = make(await read($, local), at)
  await save($, next)
  reschedule($, next)
}

async function sendNow($: EngineInterface, card: Card, make: (current: Local, at: number) => Local): Promise<void> {
  const at = await $.clock.now()
  const { local: after, sent } = markSent(make(await read($, local), at), [card.id], at)
  // An empty thought leaves nothing to send.
  if (sent.length === 0) return
  await save($, after)
  reschedule($, after)
  await $.prompt.submit({ text: blockingMessage(card, sent[0][1]) })
}

// A blocking card is answered at once; any other pick is staged for the batch.
const act = ($: EngineInterface, card: Card, make: (current: Local, at: number) => Local): Promise<void> =>
  card.blocking === true ? sendNow($, card, make) : stage($, make)

async function toggle($: EngineInterface, id: string): Promise<void> {
  const current = await read($, local)
  const expanded = current.expanded.includes(id) ? current.expanded.filter(known => known !== id) : [...current.expanded, id]
  await save($, { ...current, expanded })
}

export const register: Register = (on, options) => {
  const lang = langOf(options.language)

  on('session.start', async ($, e, next) => {
    const top = await rootOf(filesOf($))
    await update($, root, () => top)
    await refresh($).catch(() => emptyPlan())
    names.clear()
    for (const [name, tool] of Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]) {
      const registered = await $.tool.register({ name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown> })
      names.set(registered.tool, name)
    }
    await $.command.register({ name: 'plan', description: t(lang, 'commandDescription') })
    // Choices staged before a reload still go out on their own.
    reschedule($, await read($, local))
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
      let outcome: Awaited<ReturnType<typeof commitEntries>>
      try {
        // The mode the plan was read in: a repo write never makes plan/log.jsonl appear; a local one looks again before each write.
        const top = await rootNow($)
        outcome =
          current.storage === 'repo'
            ? await commitEntries(filesOf($), top, ran.entries, ran.drop)
            : await commitLocal(filesOf($), storeOf($), top, ran.entries, ran.drop)
      } catch (err) {
        return { deny: `Could not write the plan: ${err instanceof Error ? err.message : String(err)}` }
      }
      if (outcome === 'busy') return { deny: DENY_BUSY }
      if (outcome === 'missing') return { deny: DENY_MISSING }
      await refresh($)
      // The entries are in the log either way; only the merge setting is missing.
      return { result: outcome === 'no-attributes' ? ran.message + NOTE_ATTRIBUTES : ran.message }
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

  // The main turn decides when staged choices may go out; a subagent's turn does not.
  on('turn.start', async ($, e, next) => {
    isBusy = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // A subagent's turn ending says nothing about the main loop.
    if (e.agentId === undefined) {
      isBusy = false
      if (isSendWhenIdle) void sendStaged($).catch(() => {})
    }
    return done
  })

  on('command.run', { command: 'plan' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'init') {
      let made: Awaited<ReturnType<typeof initRepo>>
      try {
        made = await initRepo(filesOf($), storeOf($), await rootNow($))
      } catch {
        made = 'failed'
      }
      await refresh($).catch(() => emptyPlan())
      return { text: t(lang, INIT_REPLY[made]) }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: t(lang, 'commandOpened') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    paneView($.ui.resolve(e), await read($, plan), await read($, local), lang, {
      toggle: id => toggle($, id),
      show: async view => save($, { ...(await read($, local)), view }),
      choose: (card, choice) => act($, card, (current, at) => withChoice(current, card.id, choice, at)),
      dismiss: card => act($, card, (current, at) => withDismiss(current, card.id, at)),
      think: (card, text) => act($, card, (current, at) => withDraft(current, card.id, text, at)),
      clear: card => stage($, current => cleared(current, card.id)),
      send: () => sendStaged($),
    }),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const current = await read($, plan)
    if (isBandEmpty(current)) return next(e)
    const open = () => $.ui.open({ id: PANE, title: TITLE })
    return bandView($.ui.resolve(e), current, await read($, local), lang, e.props.bodyColumns, open)
  })
}
