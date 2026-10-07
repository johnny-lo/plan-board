import { expect, test } from 'claude-code/testing'

import { sha16 } from '../hooks/checksum.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'

const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })
const spec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'question',
  item: 'A',
  question: `question ${id}`,
  why: 'because',
  options: [
    { label: 'yes', effect: 'go' },
    { label: 'no', effect: 'stop' },
  ],
  ...extra,
})

async function tampered() {
  const base = await logText([entry('item.add', { item: item('A') })])
  const line = (await logText([entry('item.add', { item: item('B') })])).trim()
  const bad = line.replace('"B goal"', '"B goal!"')
  return { base, bad, hash: await sha16(bad) }
}

test('cards_open_and_resolve', async () => {
  const open = entry('card.open', { card: spec('c1') })
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      open,
      entry('card.open', { card: spec('c1') }),
    ]),
  )
  expect(plan.cards.c1.resolved).toBeUndefined()
  expect(plan.cards.c1.openedAt).toBe(open.at)
  expect(plan.itemLog.A.some((e) => e.id === open.id)).toBe(true)
  expect(plan.names.c1).toBe('question c1')
  expect(plan.skipped[0].reason).toContain('card exists')

  const resolve = entry('card.resolve', { card: 'c1', outcome: 'go ahead', choice: 'yes' })
  const done = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      open,
      resolve,
      entry('card.resolve', { card: 'c1', outcome: 'again' }),
      entry('card.resolve', { card: 'nope', outcome: 'x' }),
    ]),
  )
  expect(done.cards.c1.resolved).toEqual({ outcome: 'go ahead', choice: 'yes', at: resolve.at })
  expect(done.itemLog.A.some((e) => e.id === resolve.id)).toBe(true)
  expect(done.skipped[0].reason).toContain('resolved')
  expect(done.skipped[1].reason).toContain('unknown card')
})

test('unsealed_lines_are_flagged_and_ignored', async () => {
  const { base, bad, hash } = await tampered()
  const plan = await replay(base + bad + '\noops\n')
  expect(plan.flagged[0].entry?.kind).toBe('item.add')
  expect(plan.flagged[0].hash).toBe(hash)
  expect(plan.flagged[0].raw).toBe(bad)
  expect(plan.items.B).toBeUndefined()
  expect(plan.flagged[1].raw).toBe('oops')
  expect(plan.flagged[1].entry).toBeNull()
  expect(plan.flagged.length).toBe(2)
})

test('edit_keep_lets_a_line_count', async () => {
  const { base, bad, hash } = await tampered()
  const keep = await logText([entry('edit.keep', { lines: [hash], summary: 'ok' })])
  const plan = await replay(base + bad + '\n' + keep)
  expect(plan.items.B.goal).toBe('B goal!')
  expect(plan.flagged).toEqual([])
  expect(plan.applied.some((e) => e.kind === 'edit.keep')).toBe(true)
})

test('edit_drop_hides_a_line_for_good', async () => {
  const { base, bad, hash } = await tampered()
  const drop = await logText([entry('edit.drop', { lines: [hash], summary: 'no' })])
  const plan = await replay(base + bad + '\n' + drop)
  expect(plan.items.B).toBeUndefined()
  expect(plan.flagged).toEqual([])
  expect(plan.applied.some((e) => e.kind === 'edit.drop')).toBe(true)
})

test('kept_malformed_line_is_skipped', async () => {
  const base = await logText([entry('item.add', { item: item('A') })])
  const bad = JSON.stringify({ id: 'ffffffffffff', at: '2026-10-07T01:00:00.000Z', kind: 'step.status', why: 'x', basis: { type: 'ai' } })
  const keep = await logText([entry('edit.keep', { lines: [await sha16(bad)], summary: 'ok' })])
  const plan = await replay(base + bad + '\n' + keep)
  expect(plan.skipped.length).toBe(1)
  expect(plan.skipped[0].reason).toContain('malformed')
  expect(plan.items.A).toBeDefined()
  expect(plan.applied.some((e) => e.kind === 'edit.keep')).toBe(true)
})
