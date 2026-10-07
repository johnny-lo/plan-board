import type { Entry, Plan, Step } from '../types'
import { checkLine } from './checksum.ts'

export function emptyPlan(): Plan {
  return { order: [], items: {}, steps: {}, cards: {}, applied: [], itemLog: {}, names: {}, flagged: [], skipped: [] }
}

type Spec = { id: string; title: string; goal: string }

const has = (table: Record<string, unknown>, id: unknown): boolean =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id)

function addItem(plan: Plan, spec: Spec, at: number): void {
  plan.items[spec.id] = { id: spec.id, title: spec.title, goal: spec.goal, steps: [] }
  plan.order.splice(at, 0, spec.id)
  plan.names[spec.id] = spec.title
}

function insertStep(plan: Plan, itemId: string, stepId: string, after: string | undefined): void {
  const steps = plan.items[itemId].steps
  const at = after !== undefined && plan.steps[after]?.item === itemId ? steps.indexOf(after) + 1 : steps.length
  steps.splice(at, 0, stepId)
}

function detach(plan: Plan, stepId: string): void {
  const steps = plan.items[plan.steps[stepId].item].steps
  steps.splice(steps.indexOf(stepId), 1)
}

/** Applies one entry to the plan. Returns null when applied, otherwise why it was skipped. */
export function applyEntry(plan: Plan, entry: Entry): string | null {
  switch (entry.kind) {
    case 'item.add': {
      const { item, before } = entry.data
      if (has(plan.items, item.id)) return `item exists: ${item.id}`
      const at = before !== undefined && has(plan.items, before) ? plan.order.indexOf(before) : plan.order.length
      addItem(plan, item, at)
      return null
    }
    case 'item.remove': {
      const { item } = entry.data
      if (!has(plan.items, item)) return `unknown item: ${item}`
      for (const s of plan.items[item].steps) delete plan.steps[s]
      delete plan.items[item]
      plan.order.splice(plan.order.indexOf(item), 1)
      return null
    }
    case 'item.split': {
      const { item, into } = entry.data
      if (!has(plan.items, item)) return `unknown item: ${item}`
      if (!Array.isArray(into) || into.length === 0) return 'item.split needs at least one new item'
      const ids = into.map((i) => i.id)
      for (const id of ids) if (has(plan.items, id)) return `item exists: ${id}`
      if (new Set(ids).size !== ids.length) return `item exists: ${ids.join(',')} repeats an id`
      const at = plan.order.indexOf(item)
      const moved = plan.items[item].steps
      delete plan.items[item]
      plan.order.splice(at, 1)
      into.forEach((spec, n) => addItem(plan, spec, at + n))
      plan.items[ids[0]].steps = moved
      for (const s of moved) plan.steps[s].item = ids[0]
      return null
    }
    case 'item.merge': {
      const { items, into } = entry.data
      if (!Array.isArray(items) || items.length < 2) return 'unknown item: merge needs at least 2 items'
      for (const id of items) if (!has(plan.items, id)) return `unknown item: ${id}`
      if (new Set(items).size !== items.length) return 'unknown item: merge lists an item twice'
      if (has(plan.items, into.id) && !items.includes(into.id)) return `item exists: ${into.id}`
      const at = Math.min(...items.map((id) => plan.order.indexOf(id)))
      const moved: string[] = []
      for (const id of items) moved.push(...plan.items[id].steps)
      for (const id of items) {
        delete plan.items[id]
        plan.order.splice(plan.order.indexOf(id), 1)
      }
      const insertAt = Math.min(at, plan.order.length)
      addItem(plan, into, insertAt)
      plan.items[into.id].steps = moved
      for (const s of moved) plan.steps[s].item = into.id
      return null
    }
    case 'item.edit': {
      const { item, title, goal } = entry.data
      if (!has(plan.items, item)) return `unknown item: ${item}`
      if (title !== undefined) {
        plan.items[item].title = title
        plan.names[item] = title
      }
      if (goal !== undefined) plan.items[item].goal = goal
      return null
    }
    case 'item.reorder': {
      const { order } = entry.data
      const sameSet =
        Array.isArray(order) &&
        order.length === plan.order.length &&
        new Set(order).size === order.length &&
        order.every((id) => has(plan.items, id))
      if (!sameSet) return 'order must be a permutation of all current items'
      plan.order = [...order]
      return null
    }
    case 'step.add': {
      const { item, step, after } = entry.data
      if (!has(plan.items, item)) return `unknown item: ${item}`
      if (has(plan.steps, step.id)) return `step exists: ${step.id}`
      plan.steps[step.id] = { id: step.id, item, title: step.title, status: 'todo' }
      insertStep(plan, item, step.id, after)
      plan.names[step.id] = step.title
      return null
    }
    case 'step.edit': {
      const { step, title } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      plan.steps[step].title = title
      plan.names[step] = title
      return null
    }
    case 'step.remove': {
      const { step } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      detach(plan, step)
      delete plan.steps[step]
      return null
    }
    case 'step.move': {
      const { step, item, after } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      if (!has(plan.items, item)) return `unknown item: ${item}`
      detach(plan, step)
      plan.steps[step].item = item
      insertStep(plan, item, step, after)
      return null
    }
    case 'step.assign': {
      const { step, to } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      if (to === '') delete plan.steps[step].assignee
      else plan.steps[step].assignee = to
      return null
    }
    case 'step.status': {
      const { step, status, result } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      const target: Step = plan.steps[step]
      target.status = status
      if (status !== 'done') delete target.evidence
      else if (entry.basis.type === 'thoth') target.evidence = { thoth: entry.basis.task }
      else target.evidence = { result }
      return null
    }
    case 'card.open': {
      const { card } = entry.data
      if (has(plan.cards, card.id)) return `card exists: ${card.id}`
      plan.cards[card.id] = { ...card, openedAt: entry.at }
      plan.names[card.id] = card.question
      return null
    }
    case 'card.resolve': {
      const { card, outcome, choice } = entry.data
      if (!has(plan.cards, card)) return `unknown card: ${card}`
      if (plan.cards[card].resolved) return `card already resolved: ${card}`
      const resolved: { outcome: string; choice?: string; at: string } = { outcome, at: entry.at }
      if (choice !== undefined) resolved.choice = choice
      plan.cards[card].resolved = resolved
      return null
    }
    case 'edit.keep':
    case 'edit.drop':
      return null
    default:
      return `unsupported kind: ${entry.kind}`
  }
}

/** Items an entry touches, judged against the plan as it was before the entry applied. */
function touchedBefore(plan: Plan, entry: Entry): string[] {
  const d = entry.data as Record<string, unknown>
  if (typeof d.step === 'string' && has(plan.steps, d.step)) return [plan.steps[d.step].item]
  if (typeof d.card === 'string' && has(plan.cards, d.card)) {
    const item = plan.cards[d.card].item
    if (item !== undefined) return [item]
  }
  return []
}

/** Items an entry touches, judged against the plan after it applied. */
function touchedAfter(entry: Entry): string[] {
  switch (entry.kind) {
    case 'item.add':
      return [entry.data.item.id]
    case 'item.remove':
    case 'item.edit':
      return [entry.data.item]
    case 'item.split':
      return [entry.data.item, ...entry.data.into.map((i) => i.id)]
    case 'item.merge':
      return [...entry.data.items, entry.data.into.id]
    case 'step.add':
      return [entry.data.item]
    case 'step.move':
      return [entry.data.item]
    case 'card.open':
      return entry.data.card.item !== undefined ? [entry.data.card.item] : []
    default:
      return []
  }
}

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

function wellFormed(entry: Entry): boolean {
  const e = entry as unknown as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.at === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.why === 'string' &&
    isObject(e.basis) &&
    isObject(e.data)
  )
}

export async function replay(text: string): Promise<Plan> {
  const plan = emptyPlan()
  const body = text.startsWith('﻿') ? text.slice(1) : text
  const checked: { raw: string; entry: Entry | null; isSealed: boolean; hash: string }[] = []
  const keep = new Set<string>()
  const drop = new Set<string>()
  for (const raw of body.split(/\r?\n/)) {
    if (raw === '') continue
    const result = await checkLine(raw)
    checked.push({ raw: raw.endsWith('\r') ? raw.slice(0, -1) : raw, ...result })
    const { entry } = result
    if (entry !== null && result.isSealed && (entry.kind === 'edit.keep' || entry.kind === 'edit.drop')) {
      const lines = (entry.data as { lines?: unknown }).lines
      if (Array.isArray(lines)) for (const h of lines) (entry.kind === 'edit.keep' ? keep : drop).add(String(h))
    }
  }
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const { raw, entry, isSealed, hash } of checked) {
    if (!isSealed) {
      if (drop.has(hash)) continue
      if (entry === null || !keep.has(hash)) {
        plan.flagged.push({ raw, hash, entry })
        continue
      }
    }
    if (entry === null) continue
    if (!wellFormed(entry)) {
      plan.skipped.push({ entry, reason: 'malformed entry' })
      continue
    }
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const entry of entries) {
    const snapshot = structuredClone(plan)
    let before: string[] = []
    let reason: string | null
    try {
      before = touchedBefore(plan, entry)
      reason = applyEntry(plan, entry)
    } catch {
      Object.assign(plan, snapshot)
      reason = 'malformed entry: could not apply'
    }
    if (reason !== null) {
      plan.skipped.push({ entry, reason })
      continue
    }
    plan.applied.push(entry)
    for (const id of new Set([...before, ...touchedAfter(entry)])) (plan.itemLog[id] ??= []).push(entry)
  }
  return plan
}
