import { expect, test } from 'claude-code/testing'

import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'

const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })

test('adds_items_in_order_with_before', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('item.add', { item: item('C'), before: 'A' }),
    ]),
  )
  expect(plan.order).toEqual(['C', 'A', 'B'])
  expect(plan.items.A.steps).toEqual([])
})

test('steps_add_move_status_and_evidence', async () => {
  const before = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
      entry('step.add', { item: 'A', step: { id: 's3', title: 'three' }, after: 's1' }),
    ]),
  )
  expect(before.items.A.steps).toEqual(['s1', 's3', 's2'])

  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
      entry('step.add', { item: 'A', step: { id: 's3', title: 'three' }, after: 's1' }),
      entry('step.move', { step: 's2', item: 'B' }),
      entry('step.status', { step: 's1', status: 'done' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.status', { step: 's3', status: 'done', result: '面板測試全過' }),
      entry('step.assign', { step: 's3', to: 'claude-b' }),
    ]),
  )
  expect(plan.items.A.steps).toEqual(['s1', 's3'])
  expect(plan.items.B.steps).toEqual(['s2'])
  expect(plan.steps.s2.item).toBe('B')
  expect(plan.steps.s1.evidence).toEqual({ thoth: 'T1' })
  expect(plan.steps.s3.evidence).toEqual({ result: '面板測試全過' })
  expect(plan.steps.s3.assignee).toBe('claude-b')

  const later = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.status', { step: 's1', status: 'done', result: 'ok' }),
      entry('step.status', { step: 's1', status: 'doing' }),
      entry('step.assign', { step: 's1', to: 'x' }),
      entry('step.assign', { step: 's1', to: '' }),
    ]),
  )
  expect(later.steps.s1.evidence).toBeUndefined()
  expect(later.steps.s1.assignee).toBeUndefined()
  expect(later.steps.s1.status).toBe('doing')
})

test('split_merge_edit_reorder', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'B', step: { id: 's2', title: 'two' } }),
      entry('item.split', { item: 'A', into: [item('A1'), item('A2')] }),
    ]),
  )
  expect(plan.order).toEqual(['A1', 'A2', 'B'])
  expect(plan.items.A1.steps).toEqual(['s1'])
  expect(plan.steps.s1.item).toBe('A1')
  expect(plan.items.A).toBeUndefined()

  const merged = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'B', step: { id: 's2', title: 'two' } }),
      entry('item.split', { item: 'A', into: [item('A1'), item('A2')] }),
      entry('step.move', { step: 's1', item: 'A2' }),
      entry('item.merge', { items: ['A2', 'B'], into: item('M') }),
      entry('item.edit', { item: 'M', goal: 'new goal' }),
      entry('item.reorder', { order: ['M', 'A1'] }),
      entry('item.reorder', { order: ['M'] }),
    ]),
  )
  expect(merged.order).toEqual(['M', 'A1'])
  expect(merged.items.M.steps).toEqual(['s1', 's2'])
  expect(merged.steps.s2.item).toBe('M')
  expect(merged.items.M.goal).toBe('new goal')
  expect(merged.items.M.title).toBe('M')
  expect(merged.skipped.length).toBe(1)
  expect(merged.skipped[0].reason).toContain('order')
})

test('dedups_sorts_and_skips', async () => {
  const once = await logText([entry('item.add', { item: item('A') })])
  const plan = await replay(once + once)
  expect(plan.applied.length).toBe(1)
  expect(plan.skipped.length).toBe(0)

  const entries = [
    entry('item.add', { item: item('A') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
    entry('step.add', { item: 'Z', step: { id: 's2', title: 'two' } }),
    entry('item.remove', { item: 'A' }),
    entry('step.add', { item: 'A', step: { id: 's3', title: 'three' } }),
  ]
  const reversed = (await logText(entries)).trim().split('\n').reverse().join('\n') + '\n'
  const sorted = await replay(reversed)
  expect(sorted.order).toEqual([])
  expect(sorted.applied.length).toBe(3)
  expect(sorted.skipped.length).toBe(2)
  expect(sorted.skipped[0].reason).toContain('unknown item')
  expect(sorted.skipped[1].reason).toContain('unknown item')
})

test('item_log_follows_the_step', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('item.add', { item: item('B') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
    entry('step.status', { step: 's1', status: 'doing' }),
    entry('step.move', { step: 's1', item: 'B' }),
    entry('step.status', { step: 's1', status: 'done', result: 'ok' }),
  ]
  const [status1, status2] = [entries[3].id, entries[5].id]
  const plan = await replay(await logText(entries))
  expect(plan.itemLog.A.map((e) => e.id)).toContain(status1)
  expect(plan.itemLog.A.map((e) => e.id)).not.toContain(status2)
  expect(plan.itemLog.B.map((e) => e.id)).toContain(status2)
  expect(plan.itemLog.B.map((e) => e.id)).not.toContain(status1)
})

test('names_keep_removed_titles', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A', 'Alpha') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.edit', { step: 's1', title: 'uno' }),
      entry('item.remove', { item: 'A' }),
    ]),
  )
  expect(plan.items.A).toBeUndefined()
  expect(plan.names.A).toBe('Alpha')
  expect(plan.names.s1).toBe('uno')
})

test('crlf_and_bom_are_not_edits', async () => {
  const text = await logText([
    entry('item.add', { item: item('A') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
  ])
  const plan = await replay('﻿' + text.replace(/\n/g, '\r\n'))
  const plain = await replay(text)
  expect(plan.order).toEqual(plain.order)
  expect(plan.items).toEqual(plain.items)
  expect(plan.steps).toEqual(plain.steps)
  expect(plan.applied.length).toBe(2)
})
