import { expect, test } from 'claude-code/testing'

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
} from '../hooks/local.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'
import type { Card, Plan } from '../types'

const question = (id: string, text = `q-${id}`, extra: Record<string, unknown> = {}) =>
  entry('card.open', {
    card: { id, type: 'question', question: text, why: 'w', options: [{ label: 'a', effect: 'x' }, { label: 'b', effect: 'y' }], ...extra },
  })
const proposal = (id: string, text = `p-${id}`) =>
  entry('card.open', { card: { id, type: 'proposal', question: text, why: 'w', options: [], changes: [] } })

async function planOf(...entries: ReturnType<typeof entry>[]): Promise<Plan> {
  return replay(await logText(entries))
}

test('stage_toggle_draft_dismiss_clear', () => {
  let local = withChoice(emptyLocal(), 'c1', 'LRU', 5)
  expect(local.staged.c1).toEqual({ choice: 'LRU', at: 5 })
  expect(withChoice(local, 'c1', 'LRU', 6).staged).toEqual({})

  local = withDraft(local, 'c1', '  要看記憶體上限 ', 7)
  expect(local.staged.c1.draft).toBe('要看記憶體上限')
  expect(local.staged.c1.choice).toBe('LRU')
  local = withDraft(local, 'c1', '   ', 8)
  expect(local.staged.c1.draft).toBeUndefined()
  expect(local.staged.c1.choice).toBe('LRU')

  local = withDismiss(local, 'c2', 9)
  expect(local.staged.c2.isDismissed).toBe(true)
  expect(localKey('/repo')).toBe('local:/repo')

  local = cleared(cleared(local, 'c1'), 'c2')
  expect(local.staged).toEqual({})
  expect(emptyLocal().staged).toEqual({})
})

test('mark_sent_and_is_approved', () => {
  const staged = withChoice(withChoice(emptyLocal(), 'p', 'approve', 1), 'q', 'LRU', 2)
  expect(isApproved(staged, 'p')).toBe(false)
  const { local, sent } = markSent(staged, ['p'], 10)
  expect(local.staged).toEqual({ q: { choice: 'LRU', at: 2 } })
  expect(local.sent.p.choice).toBe('approve')
  expect(sent.map(([id]) => id)).toEqual(['p'])
  expect(isApproved(local, 'p')).toBe(true)
  expect(isApproved(local, 'q')).toBe(false)
  expect(isApproved(local, 'missing')).toBe(false)
  expect(isApproved(local, '__proto__')).toBe(false)
  expect(isApproved(local, 'toString')).toBe(false)
})

test('forget_drops_resolved_cards', async () => {
  const plan = await planOf(
    question('open'),
    question('done'),
    entry('card.resolve', { card: 'done', outcome: 'ok' }),
  )
  let local = emptyLocal()
  for (const id of ['open', 'done', 'gone']) local = withChoice(local, id, 'a', 1)
  local = markSent(local, ['done', 'gone'], 2).local
  local = { ...local, expanded: ['open', 'done', 'gone'] }
  const next = forget(local, plan)
  expect(Object.keys(next.staged)).toEqual(['open'])
  expect(next.sent).toEqual({})
  expect(next.expanded).toEqual(['open'])
  expect(next.view).toBe(local.view)
})

test('batch_message_text', async () => {
  const plan = await planOf(question('c1', 'Which cache?'), question('c2', 'Which queue?'), proposal('p1', 'Add docs?'), question('c3', 'Old idea?'), question('c4', 'Skip me?'))
  let local = withChoice(emptyLocal(), 'c1', 'LRU', 1)
  local = withDraft(local, 'c2', '要看記憶體上限', 2)
  local = withChoice(local, 'p1', 'approve', 3)
  local = withDismiss(local, 'c4', 4)
  const { sent } = markSent(local, ['c1', 'c2', 'p1', 'c4'], 5)
  const text = batchMessage(plan, sent)
  expect(text).toContain('Decisions from the pane (4):')
  expect(text).toContain('- [c1] Which cache? → LRU')
  expect(text).toContain('- [c2] Which queue? → (no option picked)')
  expect(text).toContain('  thought: 要看記憶體上限')
  expect(text).toContain('- [p1] Add docs? → approve (call apply_change with this card)')
  expect(text).toContain('→ dismissed (resolve it: the user skipped this card)')
  expect(text).toContain('→ (no option picked)')
  expect(text).toContain('(Close each card with resolve_decision, or apply_change for an approved proposal. A card with only a thought stays open until it is settled.)')

  const reject = batchMessage(plan, [['p1', { choice: 'reject', at: 1 }]])
  expect(reject).toContain('- [p1] Add docs? → reject (resolve it as rejected)')
})

test('blocking_message_text', async () => {
  const plan = await planOf(question('c1', 'Install where?', { blocking: true }), proposal('p1', 'Add docs?'))
  const card = (id: string): Card => plan.cards[id]
  expect(blockingMessage(card('c1'), { choice: 'There', at: 1 })).toBe('Decision made for "Install where?" [c1]: There')
  expect(blockingMessage(card('p1'), { choice: 'approve', at: 1 })).toContain('[p1]: approve (call apply_change with this card)')
  expect(blockingMessage(card('c1'), { isDismissed: true, at: 1 })).toContain('dismissed (resolve it: the user skipped this card)')
  const thought = blockingMessage(card('c1'), { draft: '先看看', at: 1 })
  expect(thought.startsWith('My thoughts on "Install where?" [c1]: 先看看')).toBe(true)
  expect(thought).toContain('(If this settles it, resolve the card; otherwise reply and keep it open.)')
})

test('as_local_survives_garbage', () => {
  expect(asLocal(undefined)).toEqual(emptyLocal())
  expect(asLocal(42)).toEqual(emptyLocal())
  expect(asLocal({ staged: 3, sent: [], expanded: 'x', view: 'nope' })).toEqual(emptyLocal())
  const good = { staged: { a: { choice: 'x', at: 1 } }, sent: {}, expanded: ['a'], view: 'cards' as const }
  expect(asLocal(JSON.parse(JSON.stringify(good)))).toEqual(good)
})

test('action_card_messages', async () => {
  const plan = await planOf(
    entry('card.open', { card: { id: 'a1', type: 'action', question: 'Run thoth checks approve', why: 'w', options: [], command: 'thoth checks approve' } }),
  )
  const card = plan.cards.a1
  expect(blockingMessage(card, { choice: 'done', at: 1 })).toBe(
    'Done by the user: "Run thoth checks approve" [a1]. Check it if you can, then resolve the card with resolve_decision.',
  )
  expect(blockingMessage(card, { choice: 'done', draft: 'it asked twice', at: 1 })).toContain('\nthought: it asked twice')
  expect(blockingMessage(card, { isDismissed: true, at: 1 })).toContain('dismissed (resolve it: the user skipped this card)')
  expect(blockingMessage(card, { draft: 'no access', at: 1 }).startsWith('My thoughts on "Run thoth checks approve" [a1]: no access')).toBe(true)
  expect(batchMessage(plan, [['a1', { choice: 'done', at: 1 }]])).toContain(
    '- [a1] Run thoth checks approve → done (check it if you can, then resolve the card with resolve_decision)',
  )
})
