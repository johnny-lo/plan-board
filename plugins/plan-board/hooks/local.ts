import type { Card, Local, Pick, Plan } from '../types'

export const emptyLocal = (): Local => ({ staged: {}, sent: {}, expanded: [], view: 'overview' })

export const localKey = (root: string): string => 'local:' + root

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function asPick(value: unknown): Pick | undefined {
  if (!isObj(value) || typeof value.at !== 'number') return undefined
  const pick: Pick = { at: value.at }
  if (typeof value.choice === 'string') pick.choice = value.choice
  if (typeof value.draft === 'string') pick.draft = value.draft
  if (value.isDismissed === true) pick.isDismissed = true
  return pick
}

function asPicks(value: unknown): Record<string, Pick> {
  if (!isObj(value)) return {}
  const picks: [string, Pick][] = []
  for (const [id, raw] of Object.entries(value)) {
    const pick = asPick(raw)
    if (pick !== undefined) picks.push([id, pick])
  }
  return Object.fromEntries(picks)
}

export function asLocal(value: unknown): Local {
  if (!isObj(value)) return emptyLocal()
  return {
    staged: asPicks(value.staged),
    sent: asPicks(value.sent),
    expanded: Array.isArray(value.expanded) ? value.expanded.filter((id): id is string => typeof id === 'string') : [],
    view: value.view === 'cards' ? 'cards' : 'overview',
  }
}

const pickOf = (table: Record<string, Pick>, cardId: string): Pick | undefined => (Object.hasOwn(table, cardId) ? table[cardId] : undefined)

/** The picks with one card's pick replaced, or removed when it holds nothing. */
function staging(local: Local, cardId: string, pick: Pick): Local {
  const isEmpty = pick.choice === undefined && pick.draft === undefined && pick.isDismissed !== true
  const rest = Object.entries(local.staged).filter(([id]) => id !== cardId)
  return { ...local, staged: Object.fromEntries(isEmpty ? rest : [...rest, [cardId, pick]]) }
}

export function withChoice(local: Local, cardId: string, choice: string, at: number): Local {
  const before = pickOf(local.staged, cardId)
  const pick: Pick = { at }
  if (before?.draft !== undefined) pick.draft = before.draft
  if (before?.choice !== choice) pick.choice = choice
  return staging(local, cardId, pick)
}

export function withDraft(local: Local, cardId: string, text: string, at: number): Local {
  const before = pickOf(local.staged, cardId)
  const pick: Pick = { at }
  if (before?.choice !== undefined) pick.choice = before.choice
  if (before?.isDismissed === true) pick.isDismissed = true
  const draft = text.trim()
  if (draft !== '') pick.draft = draft
  return staging(local, cardId, pick)
}

export function withDismiss(local: Local, cardId: string, at: number): Local {
  const before = pickOf(local.staged, cardId)
  const pick: Pick = { at, isDismissed: true }
  if (before?.draft !== undefined) pick.draft = before.draft
  return staging(local, cardId, pick)
}

export function cleared(local: Local, cardId: string): Local {
  return { ...local, staged: Object.fromEntries(Object.entries(local.staged).filter(([id]) => id !== cardId)) }
}

export function markSent(local: Local, ids: string[], at: number): { local: Local; sent: [string, Pick][] } {
  const sent: [string, Pick][] = []
  for (const id of ids) {
    const pick = pickOf(local.staged, id)
    if (pick !== undefined) sent.push([id, { ...pick, at }])
  }
  const moved = new Set(sent.map(([id]) => id))
  return {
    local: {
      ...local,
      staged: Object.fromEntries(Object.entries(local.staged).filter(([id]) => !moved.has(id))),
      sent: Object.fromEntries([...Object.entries(local.sent).filter(([id]) => !moved.has(id)), ...sent]),
    },
    sent,
  }
}

/** An open history row in `expanded`: fold:<entry id> or why:<entry id>. */
const ROW = /^(?:fold|why):(.*)$/

/** Drops what belongs to cards that are resolved or gone, and open history rows whose entry is gone; item ids stay while the item does. */
export function forget(local: Local, plan: Plan): Local {
  const isOpen = (id: string): boolean => Object.hasOwn(plan.cards, id) && plan.cards[id].resolved === undefined
  const keepOpen = (table: Record<string, Pick>): Record<string, Pick> => Object.fromEntries(Object.entries(table).filter(([id]) => isOpen(id)))
  const entries = new Set(plan.applied.map(entry => entry.id))
  const isKept = (id: string): boolean => {
    const row = ROW.exec(id)
    if (row !== null) return entries.has(row[1])
    return Object.hasOwn(plan.cards, id) ? plan.cards[id].resolved === undefined : Object.hasOwn(plan.items, id)
  }
  return { ...local, staged: keepOpen(local.staged), sent: keepOpen(local.sent), expanded: local.expanded.filter(isKept) }
}

export function isApproved(local: Local, cardId: string): boolean {
  return pickOf(local.sent, cardId)?.choice === 'approve'
}

/** What the model is told the user did with one card. */
function verdict(card: Card | undefined, pick: Pick): string {
  if (pick.isDismissed === true) return 'dismissed (resolve it: the user skipped this card)'
  if (pick.choice === undefined) return '(no option picked)'
  if (card?.type === 'action' && pick.choice === 'done') return 'done (check it if you can, then resolve the card with resolve_decision)'
  if (card?.type === 'proposal') {
    if (pick.choice === 'approve') return 'approve (call apply_change with this card)'
    if (pick.choice === 'reject') return 'reject (resolve it as rejected)'
  }
  return pick.choice
}

export function batchMessage(plan: Plan, sent: [string, Pick][]): string {
  const lines = [`Decisions from the pane (${sent.length}):`]
  for (const [id, pick] of sent) {
    const card = Object.hasOwn(plan.cards, id) ? plan.cards[id] : undefined
    lines.push(`- [${id}] ${card?.question ?? id} → ${verdict(card, pick)}`)
    if (pick.draft !== undefined && pick.draft !== '') lines.push(`  thought: ${pick.draft}`)
  }
  lines.push(
    '(Close every card here now: resolve_decision, or apply_change for an approved proposal. When a thought does not answer a card, resolve it and open a new card that takes the thought into account.)',
  )
  return lines.join('\n')
}

export function blockingMessage(card: Card, pick: Pick): string {
  const hasDraft = pick.draft !== undefined && pick.draft !== ''
  if (pick.choice === undefined && pick.isDismissed !== true && hasDraft) {
    return `My thoughts on "${card.question}" [${card.id}]: ${pick.draft}\n(Settle this card now: if this answers it, resolve the card with that outcome; if it does not, resolve it and open a new card that takes the thought into account.)`
  }
  if (card.type === 'action' && pick.choice === 'done') {
    const done = `Done by the user: "${card.question}" [${card.id}]. Check it if you can, then resolve the card with resolve_decision.`
    return hasDraft ? `${done}\nthought: ${pick.draft}` : done
  }
  const text = `Decision made for "${card.question}" [${card.id}]: ${verdict(card, pick)}`
  return hasDraft ? `${text}\nthought: ${pick.draft}` : text
}
