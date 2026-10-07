import { expect, test } from 'claude-code/testing'

import { GUIDE, summary } from '../hooks/guide.ts'
import { emptyPlan, replay } from '../hooks/replay.ts'
import { bandCounts, blockedSteps, cardPosition, historyOf, itemStates, openCards, recentFor } from '../hooks/view.ts'
import { entry, logText } from './fixtures.ts'
import type { Entry, Local } from '../types'

const emptyLocal: Local = { staged: {}, sent: {}, expanded: [], view: 'overview' }
const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })
const step = (it: string, id: string, title = id): Entry => entry('step.add', { item: it, step: { id, title } })
const status = (id: string, s: 'todo' | 'doing' | 'done', extra: Partial<Entry> = {}): Entry =>
  entry('step.status', { step: id, status: s, result: 'ok' }, extra)
const card = (id: string, extra: Record<string, unknown> = {}): Entry =>
  entry('card.open', { card: { id, type: 'question', question: `q-${id}`, why: 'w', options: [], ...extra } })

test('item_states', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('item.add', { item: item('C') }),
      entry('item.add', { item: item('D') }),
      entry('item.add', { item: item('E') }),
      step('A', 'a1'),
      step('A', 'a2'),
      step('B', 'b1'),
      step('B', 'b2'),
      step('C', 'c1'),
      step('E', 'e1'),
      status('a1', 'done'),
      status('a2', 'done'),
      status('b1', 'done'),
    ]),
  )
  expect(itemStates(plan)).toEqual({ A: 'done', B: 'doing', C: 'next', D: 'later', E: 'later' })
})

test('blocked_steps_and_open_cards_order', async () => {
  const base = [
    entry('item.add', { item: item('A') }),
    entry('item.add', { item: item('B') }),
    step('A', 's1'),
    step('B', 's2'),
    card('c-none'),
    card('c-b', { item: 'B', step: 's2' }),
    card('c-a', { item: 'A' }),
    card('c-block', { item: 'B', blocking: true }),
  ]
  const plan = await replay(await logText(base))
  expect(blockedSteps(plan).has('s2')).toBe(true)
  expect(blockedSteps(plan).has('s1')).toBe(false)
  expect(openCards(plan).map(c => c.id)).toEqual(['c-block', 'c-a', 'c-b', 'c-none'])

  const more = await replay(
    await logText([
      ...base,
      entry('item.remove', { item: 'A' }),
      entry('card.resolve', { card: 'c-b', outcome: 'done' }),
    ]),
  )
  expect(blockedSteps(more).has('s2')).toBe(false)
  expect(openCards(more).map(c => c.id)).toEqual(['c-block', 'c-none', 'c-a'])
})

test('card_position', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('item.add', { item: item('B') }),
    step('B', 's3'),
    card('c1', { item: 'B', step: 's3' }),
  ]
  const plan = await replay(await logText(entries))
  const pos = cardPosition(plan, plan.cards.c1)
  expect(pos.item?.id).toBe('B')
  expect(pos.index).toBe(2)
  expect(pos.step?.id).toBe('s3')

  const stepGone = await replay(await logText([...entries, entry('step.remove', { step: 's3' })]))
  const p2 = cardPosition(stepGone, stepGone.cards.c1)
  expect(p2.item?.id).toBe('B')
  expect(p2.step).toBeUndefined()

  const gone = await replay(await logText([...entries, entry('item.remove', { item: 'B' })]))
  expect(cardPosition(gone, gone.cards.c1)).toEqual({})
})

test('history_newest_first_without_self', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      step('A', 's1'),
      step('A', 's2'),
      card('c1', { item: 'A' }),
      step('A', 's3'),
      step('A', 's4'),
    ]),
  )
  const history = historyOf(plan, 'A')
  expect(history.length).toBe(6)
  expect(history[0].at > history[1].at).toBe(true)
  expect(history[history.length - 1].kind).toBe('item.add')
  const recent = recentFor(plan, plan.cards.c1, 3)
  expect(recent.length).toBe(3)
  expect(recent.some(e => e.kind === 'card.open')).toBe(false)
  expect(recent[0]).toEqual(history[0])
  expect(recentFor(plan, { ...plan.cards.c1, item: undefined }, 3)).toEqual([])
})

test('band_counts', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      step('A', 'a1'),
      status('a1', 'doing'),
      card('c1'),
      card('c2'),
    ]),
  )
  expect(bandCounts(plan, emptyLocal)).toEqual({ doing: 1, waiting: 2, isEdited: false })
  const local: Local = { ...emptyLocal, sent: { c1: { choice: '1', at: 1 } } }
  expect(bandCounts(plan, local).waiting).toBe(1)
  const flagged = await replay('oops\n')
  expect(bandCounts(flagged, emptyLocal).isEdited).toBe(true)
})

test('summary_lists_items_cards_and_edits', async () => {
  const text =
    (await logText([
      entry('item.add', { item: item('A', '決定看板 v1', '總表看得到') }),
      entry('item.add', { item: item('B', 'next one') }),
      step('A', 's1', 'first'),
      step('A', 's2', 'second'),
      entry('step.status', { step: 's1', status: 'done' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.assign', { step: 's2', to: 'bob' }),
      entry('card.open', {
        card: { id: 'c1', type: 'proposal', question: 'add docs?', why: 'w', options: [], blocking: true, step: 's2', item: 'A', changes: [] },
      }),
      card('c2'),
      entry('item.remove', { item: 'nope' }),
    ])) + 'oops\n'
  const plan = await replay(text)
  const out = summary(plan, { ...emptyLocal, sent: { c2: { choice: '1', at: 1 } } })
  expect(out).toContain('1. [A] 決定看板 v1 — in progress')
  expect(out).toContain('  - [s1] ')
  expect(out).toContain('thoth T1')
  expect(out).toContain('assigned to bob')
  expect(out).toContain('blocked by card c1')
  expect(out).toContain('{proposal} (blocking)')
  expect(out).toContain('(sent, waiting for you to resolve)')
  expect(out).toContain('Directly edited lines: 1')
  expect(out).toContain('Skipped entries:')
  expect(out).toContain('2. [B] next one — next')
})

test('summary_of_empty_plan', () => {
  expect(summary(emptyPlan(), emptyLocal)).toBe('No plan yet in plan/log.jsonl.')
})

test('guide_names_every_tool', () => {
  for (const name of ['propose_change', 'apply_change', 'update_step', 'add_decision', 'resolve_decision', 'resolve_direct_edit', 'plan/']) {
    expect(GUIDE).toContain(name)
  }
})
