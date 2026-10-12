import type { Card, Entry, Item, ItemState, Local, Plan, Step } from '../types'

export function itemStates(plan: Plan): Record<string, ItemState> {
  const states = Object.create(null) as Record<string, ItemState>
  let hasNext = false
  for (const id of plan.order) {
    const item = plan.items[id]
    const steps = item.steps.map(stepId => plan.steps[stepId])
    const isStarted = steps.some(s => s.status === 'doing' || s.status === 'done')
    if (steps.length > 0 && steps.every(s => s.status === 'done')) states[id] = 'done'
    else if (isStarted) states[id] = 'doing'
    else if (!hasNext) {
      states[id] = 'next'
      hasNext = true
    } else states[id] = 'later'
  }
  return states
}

export function openCards(plan: Plan): Card[] {
  const position = (card: Card): number => {
    const at = card.item === undefined ? -1 : plan.order.indexOf(card.item)
    return at === -1 ? Number.MAX_SAFE_INTEGER : at
  }
  return Object.values(plan.cards)
    .filter(card => card.resolved === undefined)
    .sort((a, b) => {
      // What the user has to do comes before what they have to decide.
      if ((a.type === 'action') !== (b.type === 'action')) return a.type === 'action' ? -1 : 1
      if (Boolean(a.blocking) !== Boolean(b.blocking)) return a.blocking ? -1 : 1
      const byItem = position(a) - position(b)
      if (byItem !== 0) return byItem
      return a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0
    })
}

/** Whether the user answered the card: a sent choice or a dismissal. A thought alone leaves it open. */
export const isAnswered = (local: Local, cardId: string): boolean => {
  if (!Object.hasOwn(local.sent, cardId)) return false
  const pick = local.sent[cardId]
  return pick.choice !== undefined || pick.isDismissed === true
}

export function blockedSteps(plan: Plan): Set<string> {
  const blocked = new Set<string>()
  for (const card of openCards(plan)) if (card.step !== undefined) blocked.add(card.step)
  return blocked
}

export function cardPosition(plan: Plan, card: Card): { item?: Item; index?: number; step?: Step } {
  const item = card.item === undefined ? undefined : plan.items[card.item]
  if (item === undefined) return {}
  const found = card.step === undefined ? undefined : plan.steps[card.step]
  const position: { item?: Item; index?: number; step?: Step } = { item, index: plan.order.indexOf(item.id) + 1 }
  if (found !== undefined) position.step = found
  return position
}

/** What a repo is shown as: its short name, else its folder name. */
export function repoLabel(plan: Plan, repo: string): string {
  return Object.hasOwn(plan.repoNames, repo) ? plan.repoNames[repo] : repo
}

/** Each repo the item's steps are tagged with, in the order a step first names it: how many of its steps are done, of how many. Untagged steps count for none. */
export function repoProgress(plan: Plan, itemId: string): { repo: string; done: number; total: number }[] {
  if (!Object.hasOwn(plan.items, itemId)) return []
  const tally = new Map<string, { repo: string; done: number; total: number }>()
  for (const stepId of plan.items[itemId].steps) {
    const repo = plan.steps[stepId]?.repo
    if (repo === undefined) continue
    const row = tally.get(repo) ?? { repo, done: 0, total: 0 }
    row.total += 1
    if (plan.steps[stepId].status === 'done') row.done += 1
    tally.set(repo, row)
  }
  return [...tally.values()]
}

export function historyOf(plan: Plan, itemId: string): Entry[] {
  return [...(plan.itemLog[itemId] ?? [])].reverse()
}

/** Step-level chatter, folded in the history; step.note and repo.name never reach the history at all. */
const CHATTER: ReadonlySet<string> = new Set(['step.add', 'step.edit', 'step.remove', 'step.move', 'step.assign', 'step.status', 'step.repo', 'item.link'])

export const isChatter = (entry: Entry): boolean => CHATTER.has(entry.kind)

/** A history row: one entry, or a run of two or more chatter entries (newest first) named by its oldest, so it keeps its name as the run grows. */
export type Row = { kind: 'entry'; entry: Entry } | { kind: 'fold'; key: string; entries: Entry[] }

export function foldHistory(history: Entry[]): Row[] {
  const rows: Row[] = []
  let run: Entry[] = []
  const flush = (): void => {
    if (run.length === 1) rows.push({ kind: 'entry', entry: run[0] })
    else if (run.length > 1) rows.push({ kind: 'fold', key: run[run.length - 1].id, entries: run })
    run = []
  }
  for (const entry of history) {
    if (isChatter(entry)) {
      run.push(entry)
      continue
    }
    flush()
    rows.push({ kind: 'entry', entry })
  }
  flush()
  return rows
}

export function recentFor(plan: Plan, card: Card, n: number): Row[] {
  if (card.item === undefined) return []
  const history = historyOf(plan, card.item).filter(entry => !(entry.kind === 'card.open' && entry.data.card.id === card.id))
  return foldHistory(history).slice(0, n)
}

export function bandCounts(plan: Plan, local: Local): { doing: number; waiting: number; isEdited: boolean } {
  const states = itemStates(plan)
  return {
    doing: Object.values(states).filter(state => state === 'doing').length,
    waiting: openCards(plan).filter(card => !isAnswered(local, card.id)).length,
    isEdited: plan.flagged.length > 0,
  }
}
