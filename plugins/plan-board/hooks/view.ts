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
      if (Boolean(a.blocking) !== Boolean(b.blocking)) return a.blocking ? -1 : 1
      const byItem = position(a) - position(b)
      if (byItem !== 0) return byItem
      return a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0
    })
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

export function historyOf(plan: Plan, itemId: string): Entry[] {
  return [...(plan.itemLog[itemId] ?? [])].reverse()
}

export function recentFor(plan: Plan, card: Card, n: number): Entry[] {
  if (card.item === undefined) return []
  return historyOf(plan, card.item)
    .filter(entry => !(entry.kind === 'card.open' && entry.data.card.id === card.id))
    .slice(0, n)
}

export function bandCounts(plan: Plan, local: Local): { doing: number; waiting: number; isEdited: boolean } {
  const states = itemStates(plan)
  return {
    doing: Object.values(states).filter(state => state === 'doing').length,
    waiting: openCards(plan).filter(card => !Object.hasOwn(local.sent, card.id)).length,
    isEdited: plan.flagged.length > 0,
  }
}
