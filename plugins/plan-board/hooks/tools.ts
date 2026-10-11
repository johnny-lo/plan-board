import type { Basis, Change, Entry, Plan, StepStatus } from '../types'
import { applyEntry } from './replay.ts'

export type ToolName = 'propose_change' | 'apply_change' | 'update_step' | 'add_decision' | 'add_user_action' | 'resolve_decision' | 'resolve_direct_edit'
export type ToolContext = { plan: Plan; now: string; newId: (length: 8 | 12) => string; isApproved: (cardId: string) => boolean }
export type ToolResult = { ok: true; entries: Entry[]; drop: string[]; message: string } | { ok: false; error: string }

/** Thrown by the input checks and turned into { ok: false } by guard(). */
class Failure extends Error {}

const fail = (message: string): never => {
  throw new Failure(message)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function objectOf(input: unknown): Obj {
  if (!isObj(input)) return fail('input must be an object')
  return input
}

function text(o: Obj, field: string): string {
  const v = o[field]
  if (v === undefined) return fail(`${field} is required`)
  if (typeof v !== 'string' || v.trim() === '') return fail(`${field} must be a non-empty string`)
  return v
}

function optText(o: Obj, field: string): string | undefined {
  const v = o[field]
  if (v === undefined) return undefined
  if (typeof v !== 'string') return fail(`${field} must be a string`)
  return v
}

function optBool(o: Obj, field: string): boolean | undefined {
  const v = o[field]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') return fail(`${field} must be a boolean`)
  return v
}

function list(o: Obj, field: string): unknown[] {
  const v = o[field]
  if (v === undefined) return fail(`${field} is required`)
  if (!Array.isArray(v) || v.length === 0) return fail(`${field} must be a non-empty array`)
  return v
}

function guard(fn: (ctx: ToolContext, input: unknown) => ToolResult): (ctx: ToolContext, input: unknown) => ToolResult {
  return (ctx, input) => {
    try {
      return fn(ctx, input)
    } catch (e) {
      if (e instanceof Failure) return { ok: false, error: e.message }
      throw e
    }
  }
}

const has = (table: Record<string, unknown>, id: string): boolean => Object.prototype.hasOwnProperty.call(table, id)

/** A copy of the plan that applyEntry can change freely; the tables stay prototype-free so ids such as '__proto__' are plain keys. */
function clonePlan(plan: Plan): Plan {
  const copy = structuredClone(plan)
  copy.items = Object.assign(Object.create(null), copy.items)
  copy.steps = Object.assign(Object.create(null), copy.steps)
  copy.cards = Object.assign(Object.create(null), copy.cards)
  copy.itemLog = Object.assign(Object.create(null), copy.itemLog)
  copy.names = Object.assign(Object.create(null), copy.names)
  copy.previousNames = Object.assign(Object.create(null), copy.previousNames)
  return copy
}

/** A position the entry names (item.add before, step.add / step.move after) must exist, and an after must sit in the target item. */
function positionProblem(plan: Plan, e: Entry): string | null {
  const d: unknown = e.data
  if (!isObj(d)) return null
  if (e.kind === 'item.add' && d.before !== undefined && (typeof d.before !== 'string' || !has(plan.items, d.before))) {
    return `unknown item: ${String(d.before)} (before)`
  }
  if ((e.kind === 'step.add' || e.kind === 'step.move') && d.after !== undefined) {
    const after = d.after
    if (typeof after !== 'string' || !has(plan.steps, after)) return `unknown step: ${String(after)} (after)`
    if (plan.steps[after].item !== d.item) return `step ${after} (after) is not in item ${String(d.item)}`
    if (e.kind === 'step.move' && after === d.step) return `step ${after} cannot be placed after itself (after)`
  }
  return null
}

/** Runs the entries in order on a copy of the plan; returns the first skip reason, or null when all apply. */
function firstProblem(plan: Plan, entries: Entry[]): string | null {
  const copy = clonePlan(plan)
  for (const e of entries) {
    const reason = positionProblem(copy, e) ?? applyEntry(copy, e)
    if (reason !== null) return reason
  }
  return null
}

function make(ctx: ToolContext, kind: Change['kind'], data: unknown, why: string, basis: Basis): Entry {
  return { id: ctx.newId(12), at: ctx.now, kind, why, basis, data } as Entry
}

/** Validates the entries against the plan; they are what gets written, the i-th one i ms after ctx.now so replay keeps their order. */
function accept(ctx: ToolContext, entries: Entry[], message: string, drop: string[] = []): ToolResult {
  const stamped = entries.map((e, i) => ({ ...e, at: new Date(Date.parse(ctx.now) + i).toISOString() }) as Entry)
  const reason = firstProblem(ctx.plan, stamped)
  if (reason !== null) return { ok: false, error: reason }
  return { ok: true, entries: stamped, drop, message }
}

function checkRefs(plan: Plan, itemId: string | undefined, stepId: string | undefined): string | undefined {
  if (itemId !== undefined && !has(plan.items, itemId)) return fail(`unknown item: ${itemId}`)
  if (stepId === undefined) return itemId
  if (!has(plan.steps, stepId)) return fail(`unknown step: ${stepId}`)
  const owner = plan.steps[stepId].item
  if (itemId !== undefined && itemId !== owner) return fail(`step ${stepId} is not in item ${itemId}`)
  return owner
}

const ai: Basis = { type: 'ai' }

// ---- propose_change ----

/** Copies the changes, checks they are item.* and gives new items without an id one. */
function withIds(ctx: ToolContext, changes: unknown[], created: string[]): { kind: string; data: Obj }[] {
  const fill = (spec: unknown): void => {
    if (!isObj(spec)) return
    if (spec.id === undefined || spec.id === '') {
      spec.id = ctx.newId(8)
      created.push(spec.id as string)
    }
  }
  return changes.map((raw, i) => {
    if (!isObj(raw) || typeof raw.kind !== 'string') return fail(`changes[${i}] must be an object with a kind`)
    if (raw.kind === 'item.link') return fail(`changes[${i}]: linking a document needs no approval; use update_step with action link`)
    if (!raw.kind.startsWith('item.')) return fail(`changes[${i}].kind must be an item.* change, got ${raw.kind}`)
    if (!isObj(raw.data)) return fail(`changes[${i}].data must be an object`)
    const change = structuredClone(raw) as { kind: string; data: Obj }
    if (change.kind === 'item.add') fill(change.data.item)
    else if (change.kind === 'item.split' && Array.isArray(change.data.into)) change.data.into.forEach(fill)
    else if (change.kind === 'item.merge') fill(change.data.into)
    return change
  })
}

const proposeChange = guard((ctx, input) => {
  const o = objectOf(input)
  const question = text(o, 'question')
  const why = text(o, 'why')
  const raw = list(o, 'changes')
  const item = optText(o, 'item')
  const blocking = optBool(o, 'blocking')
  checkRefs(ctx.plan, item, undefined)
  const created: string[] = []
  const changes = withIds(ctx, raw, created)
  const checks = changes.map((c) => ({ id: '', at: ctx.now, kind: c.kind, why, basis: ai, data: c.data }) as Entry)
  const card: Obj = { id: ctx.newId(8), type: 'proposal', question, why, options: [], changes }
  if (item !== undefined) card.item = item
  if (blocking !== undefined) card.blocking = blocking
  const open = make(ctx, 'card.open', { card }, why, ai)
  const reason = firstProblem(ctx.plan, [...checks, open])
  if (reason !== null) return { ok: false, error: reason }
  const news = created.length > 0 ? ` New item ids: ${created.join(', ')}.` : ''
  return accept(ctx, [open], `Proposed card ${card.id}; wait for the user's answer.${news}`)
})

// ---- apply_change ----

const applyChange = guard((ctx, input) => {
  const o = objectOf(input)
  const cardId = text(o, 'card')
  const chat = optText(o, 'chat')
  if (!has(ctx.plan.cards, cardId)) return fail(`unknown card: ${cardId}`)
  const card = ctx.plan.cards[cardId]
  if (card.type !== 'proposal') return fail(`card ${cardId} is not a proposal; close it with resolve_decision`)
  if (card.resolved !== undefined) return fail(`card ${cardId} is already resolved`)
  const changes = Array.isArray(card.changes) ? card.changes : []
  if (changes.length === 0) return fail(`card ${cardId} holds no changes to apply; close it with resolve_decision`)
  if (changes.some((c) => !isObj(c) || typeof c.kind !== 'string' || !c.kind.startsWith('item.'))) {
    return fail(`card ${cardId} holds changes other than item.*; close it with resolve_decision`)
  }
  const hasChat = chat !== undefined && chat.trim() !== ''
  if (!hasChat && !ctx.isApproved(cardId)) {
    return fail(`card ${cardId} is not approved: the user has not sent "approve" for it in the pane; ask them, or pass their words as chat`)
  }
  const basis: Basis = hasChat ? { type: 'card', card: cardId, chat } : { type: 'card', card: cardId }
  const entries: Entry[] = []
  for (const change of changes) {
    if (!isObj(change) || typeof change.kind !== 'string') return fail(`card ${cardId} changed since it was proposed: it holds a malformed change`)
    entries.push(make(ctx, change.kind as Change['kind'], change.data, card.why, basis))
  }
  const problem = firstProblem(ctx.plan, entries)
  if (problem !== null) {
    return fail(`The plan changed since this proposal was made (${problem}). Resolve card ${cardId} with resolve_decision and propose again.`)
  }
  entries.push(make(ctx, 'card.resolve', { card: cardId, outcome: 'approved', choice: 'approve' }, card.why, basis))
  return accept(ctx, entries, `Applied ${changes.length} change(s) from card ${cardId} and resolved it.`)
})

// ---- update_step ----

const STATUSES = ['todo', 'doing', 'done']

/** The basis and result an op that sets status done carries: its own evidence, which it must have. */
function proofOf(raw: Obj, at: string): { basis: Basis; result?: string } {
  const evidence = raw.evidence === undefined ? {} : raw.evidence
  if (!isObj(evidence)) return fail(`${at}.evidence must be an object with thoth or result`)
  const thoth = optText(evidence, 'thoth')?.trim() || undefined
  const result = optText(evidence, 'result')?.trim() || undefined
  if (thoth === undefined && result === undefined) {
    return fail(`${at}: marking a step done needs evidence.thoth (a passed Thoth task id) or evidence.result (a one-line result) on that op`)
  }
  const proof: { basis: Basis; result?: string } = { basis: thoth !== undefined ? { type: 'thoth', task: thoth } : ai }
  if (result !== undefined) proof.result = result
  return proof
}

function statusOf(raw: Obj, at: string): StepStatus | undefined {
  const status = raw.status
  if (status === undefined) return undefined
  if (typeof status !== 'string' || !STATUSES.includes(status)) return fail(`${at}.status must be one of ${STATUSES.join(', ')}`)
  return status as StepStatus
}

const updateStep = guard((ctx, input) => {
  const o = objectOf(input)
  if (o.evidence !== undefined) return fail('evidence now goes on the op that marks the step done: ops[i].evidence')
  const ops = list(o, 'ops')
  const isNotesOnly = ops.every((raw) => isObj(raw) && raw.action === 'note')
  const isBlank = o.why === undefined || (typeof o.why === 'string' && o.why.trim() === '')
  // A call that only notes where steps stand may leave out why: each note is its own reason.
  const why = isNotesOnly && isBlank ? '' : text(o, 'why')
  const entries: Entry[] = []
  const said: string[] = []
  ops.forEach((raw, i) => {
    if (!isObj(raw)) return fail(`ops[${i}] must be an object`)
    const at = `ops[${i}]`
    const field = (name: string): string => text(raw, name)
    const after = optText(raw, 'after')
    const isDone = (raw.action === 'status' || raw.action === 'add') && raw.status === 'done'
    if (raw.evidence !== undefined && !isDone) return fail(`${at}: evidence goes only on an op that sets status done`)
    switch (raw.action) {
      case 'add': {
        const id = ctx.newId(8)
        const item = field('item')
        const data: Obj = { item, step: { id, title: field('title') } }
        if (after !== undefined) data.after = after
        const status = statusOf(raw, at)
        const to = optText(raw, 'to')
        const note = optText(raw, 'note')?.trim()
        if (status === 'done' && note) return fail(`${at}: a step added as done has no note`)
        const proof: { basis: Basis; result?: string } = status === 'done' ? proofOf(raw, at) : { basis: ai }
        if (status !== undefined && status !== 'todo') data.status = status
        if (to) data.to = to
        if (note) data.note = note
        if (proof.result !== undefined) data.result = proof.result
        entries.push(make(ctx, 'step.add', data, why, proof.basis))
        const how = [status !== undefined && status !== 'todo' ? status : '', to ? `assigned to ${to}` : ''].filter((part) => part !== '')
        said.push(`Added step ${id} to item ${item}${how.length > 0 ? ` (${how.join(', ')})` : ''}.`)
        break
      }
      case 'edit':
        entries.push(make(ctx, 'step.edit', { step: field('step'), title: field('title') }, why, ai))
        said.push(`Renamed step ${field('step')}.`)
        break
      case 'remove':
        entries.push(make(ctx, 'step.remove', { step: field('step') }, why, ai))
        said.push(`Removed step ${field('step')}.`)
        break
      case 'move': {
        const data: Obj = { step: field('step'), item: field('item') }
        if (after !== undefined) data.after = after
        entries.push(make(ctx, 'step.move', data, why, ai))
        said.push(`Moved step ${field('step')} to item ${field('item')}.`)
        break
      }
      case 'assign': {
        const to = raw.to
        if (typeof to !== 'string') return fail(`${at}.to must be a string (empty to clear)`)
        entries.push(make(ctx, 'step.assign', { step: field('step'), to }, why, ai))
        said.push(to === '' ? `Cleared the assignee of step ${field('step')}.` : `Assigned step ${field('step')} to ${to}.`)
        break
      }
      case 'note': {
        if (typeof raw.note !== 'string') return fail(`${at}.note must be a string (empty to clear)`)
        const note = raw.note.trim()
        const stepId = field('step')
        entries.push(make(ctx, 'step.note', { step: stepId, note }, why || (note === '' ? 'note cleared' : note), ai))
        said.push(note === '' ? `Cleared the note of step ${stepId}.` : `Noted step ${stepId}.`)
        break
      }
      case 'link': {
        const item = field('item')
        const doc = field('doc')
        entries.push(make(ctx, 'item.link', { item, doc }, why, ai))
        said.push(`Linked ${doc} to item ${item}.`)
        break
      }
      case 'status': {
        const status = raw.status
        if (typeof status !== 'string' || !STATUSES.includes(status)) return fail(`${at}.status must be one of ${STATUSES.join(', ')}`)
        const stepId = field('step')
        const proof: { basis: Basis; result?: string } = status === 'done' ? proofOf(raw, at) : { basis: ai }
        const data: Obj = { step: stepId, status }
        if (proof.result !== undefined) data.result = proof.result
        entries.push(make(ctx, 'step.status', data, why, proof.basis))
        said.push(`Set step ${stepId} to ${status}.`)
        break
      }
      default:
        return fail(`${at}.action must be one of add, edit, remove, move, assign, status, note, link`)
    }
  })
  return accept(ctx, entries, said.join(' '))
})

// ---- add_decision ----

const addDecision = guard((ctx, input) => {
  const o = objectOf(input)
  const question = text(o, 'question')
  const why = text(o, 'why')
  const rawOptions = o.options
  if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 4) return fail('options must be an array of 2 to 4 options')
  const options = rawOptions.map((raw, i) => {
    if (!isObj(raw)) return fail(`options[${i}] must be an object`)
    const option: Obj = { label: text(raw, 'label'), effect: text(raw, 'effect') }
    const recommended = optBool(raw, 'recommended')
    const reason = optText(raw, 'reason')
    if (recommended !== undefined) option.recommended = recommended
    if (reason !== undefined) option.reason = reason
    return option
  })
  if (options.filter((o2) => o2.recommended === true).length > 1) return fail('at most one option may be recommended')
  const itemId = checkRefs(ctx.plan, optText(o, 'item'), optText(o, 'step'))
  const step = optText(o, 'step')
  const blocking = optBool(o, 'blocking')
  const card: Obj = { id: ctx.newId(8), type: 'question', question, why, options }
  if (itemId !== undefined) card.item = itemId
  if (step !== undefined) card.step = step
  if (blocking !== undefined) card.blocking = blocking
  return accept(ctx, [make(ctx, 'card.open', { card }, why, ai)], `Opened card ${card.id}; the user will answer in the pane.`)
})

// ---- add_user_action ----

const addUserAction = guard((ctx, input) => {
  const o = objectOf(input)
  const action = text(o, 'action')
  const why = text(o, 'why')
  const command = optText(o, 'command')
  if (command !== undefined && command.trim() === '') return fail('command must be a non-empty string when given')
  const step = optText(o, 'step')
  const itemId = checkRefs(ctx.plan, optText(o, 'item'), step)
  const card: Obj = { id: ctx.newId(8), type: 'action', question: action, why, options: [] }
  if (itemId !== undefined) card.item = itemId
  if (step !== undefined) card.step = step
  if (command !== undefined) card.command = command
  return accept(ctx, [make(ctx, 'card.open', { card }, why, ai)], `Opened action card ${card.id}; the user will mark it done in the pane.`)
})

// ---- resolve_decision ----

const resolveDecision = guard((ctx, input) => {
  const o = objectOf(input)
  const card = text(o, 'card')
  const outcome = text(o, 'outcome')
  return accept(ctx, [make(ctx, 'card.resolve', { card, outcome }, outcome, ai)], `Resolved card ${card}.`)
})

// ---- resolve_direct_edit ----

const resolveDirectEdit = guard((ctx, input) => {
  const o = objectOf(input)
  const action = o.action
  if (action !== 'keep' && action !== 'drop') return fail('action must be "keep" or "drop"')
  const summary = text(o, 'summary')
  const cardId = optText(o, 'card')
  const flagged = ctx.plan.flagged
  if (flagged.length === 0) return fail('no directly edited lines are flagged; there is nothing to resolve')
  if (action === 'keep') {
    // A link is no item-level change, so keeping it needs no card.
    const touchesItems = flagged.some(
      (f) => f.entry !== null && typeof f.entry.kind === 'string' && f.entry.kind.startsWith('item.') && f.entry.kind !== 'item.link',
    )
    if (touchesItems || cardId !== undefined) {
      if (cardId === undefined) return fail('card is required to keep flagged item changes: ask the user with a card, then pass the resolved card')
      if (!has(ctx.plan.cards, cardId)) return fail(`unknown card: ${cardId}`)
      if (ctx.plan.cards[cardId].resolved === undefined) return fail(`card ${cardId} is not resolved yet; wait for the user's answer and resolve it first`)
    }
  }
  const lines = flagged.map((f) => f.hash)
  const entry = make(ctx, action === 'keep' ? 'edit.keep' : 'edit.drop', { lines, summary }, summary, { type: 'direct-edit' })
  const verb = action === 'keep' ? 'Kept' : 'Dropped'
  return accept(ctx, [entry], `${verb} ${lines.length} directly edited line(s).`, action === 'drop' ? lines : [])
})

// ---- table ----

const str = { type: 'string' }
const bool = { type: 'boolean' }

export const TOOLS: Record<ToolName, { description: string; inputSchema: object; run: (ctx: ToolContext, input: unknown) => ToolResult }> = {
  propose_change: {
    description: "Open a proposal card asking the user to approve changes to the plan's items (add, remove, split, merge, edit, reorder).",
    inputSchema: {
      type: 'object',
      properties: {
        question: { ...str, description: 'One-line question shown to the user.' },
        why: { ...str, description: 'Why you propose this now.' },
        changes: {
          type: 'array',
          description: 'item.* changes as {kind, data}; ids of new items may be omitted.',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['item.add', 'item.remove', 'item.split', 'item.merge', 'item.edit', 'item.reorder'] },
              data: { type: 'object' },
            },
            required: ['kind', 'data'],
          },
        },
        item: { ...str, description: 'Item the card is about.' },
        blocking: { ...bool, description: 'Set only when you cannot continue without the answer.' },
      },
      required: ['question', 'why', 'changes'],
    },
    run: proposeChange,
  },
  apply_change: {
    description: 'Apply the changes of an approved proposal card and resolve the card.',
    inputSchema: {
      type: 'object',
      properties: {
        card: { ...str, description: 'Id of the proposal card.' },
        chat: { ...str, description: "The user's own words when they approved in chat instead of the pane." },
      },
      required: ['card'],
    },
    run: applyChange,
  },
  update_step: {
    description:
      'Add, edit, remove, move, assign, note or set the status of steps, or link a document (a path from the repo root, such as a superpowers spec or plan) to an item, recording why.',
    inputSchema: {
      type: 'object',
      properties: {
        why: { ...str, description: 'One-line reason for the change; may be left out when every op is a note.' },
        ops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'edit', 'remove', 'move', 'assign', 'status', 'note', 'link'] },
              item: str,
              doc: { ...str, description: 'For link: path of the document from the repo root.' },
              step: str,
              title: str,
              after: str,
              status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'For status; on add, the status the new step starts with.' },
              to: { ...str, description: 'Assignee; on assign an empty string clears it, on add it may be left out.' },
              evidence: {
                type: 'object',
                description: 'Only on an op that sets status done (status or add), and required there.',
                properties: { thoth: { ...str, description: 'Passed Thoth task id.' }, result: { ...str, description: 'One-line result.' } },
              },
              note: { ...str, description: 'For note: where the step stands or who it waits on; empty string clears it.' },
            },
            required: ['action'],
          },
        },
      },
      required: ['ops'],
    },
    run: updateStep,
  },
  add_decision: {
    description: 'Ask the user a question with 2-4 options, shown as a decision card in the pane.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { ...str, description: 'One-line question.' },
        why: { ...str, description: 'Why you ask now.' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: str,
              effect: { ...str, description: 'What choosing it leads to.' },
              recommended: { ...bool, description: 'At most one option.' },
              reason: str,
            },
            required: ['label', 'effect'],
          },
        },
        item: str,
        step: str,
        blocking: bool,
      },
      required: ['question', 'why', 'options'],
    },
    run: addDecision,
  },
  add_user_action: {
    description:
      'Ask the user to do something themselves (run a command in their terminal, approve something, log in), shown as a card they mark done in the pane.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { ...str, description: 'One line: what the user has to do.' },
        why: { ...str, description: 'Why it is needed now.' },
        command: { ...str, description: 'The command to run, word for word, when there is one.' },
        item: str,
        step: str,
      },
      required: ['action', 'why'],
    },
    run: addUserAction,
  },
  resolve_decision: {
    description: 'Close a decision card or an action card the user has answered, recording the outcome.',
    inputSchema: {
      type: 'object',
      properties: { card: str, outcome: { ...str, description: 'What was decided.' } },
      required: ['card', 'outcome'],
    },
    run: resolveDecision,
  },
  resolve_direct_edit: {
    description: 'Keep or drop the lines of plan/log.jsonl that were edited directly.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['keep', 'drop'] },
        summary: { ...str, description: 'What the direct edit changed.' },
        card: { ...str, description: 'Resolved card that asked the user; required when keeping item changes.' },
      },
      required: ['action', 'summary'],
    },
    run: resolveDirectEdit,
  },
}
