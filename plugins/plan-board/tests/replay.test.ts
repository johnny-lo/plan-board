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

test('item_link_adds_a_path_once_and_items_start_without_docs', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('item.link', { item: 'A', doc: 'docs/superpowers/specs/a.md' }),
      entry('item.link', { item: 'A', doc: 'docs/superpowers/plans/a.md' }),
      entry('item.link', { item: 'A', doc: 'docs/superpowers/specs/a.md' }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  expect(plan.items.A.docs).toEqual(['docs/superpowers/specs/a.md', 'docs/superpowers/plans/a.md'])
  expect(plan.items.B.docs).toEqual([])
  // The item's history shows the link, the repeat included.
  expect(plan.itemLog.A.filter((e) => e.kind === 'item.link').length).toBe(3)
})

test('item_link_to_an_unknown_item_is_skipped_with_a_reason', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.link', { item: 'ghost', doc: 'docs/x.md' }),
      entry('item.link', { item: 'A' }),
      entry('item.link', { item: 'A', doc: 7 }),
    ]),
  )
  expect(plan.skipped.length).toBe(3)
  expect(plan.skipped[0].reason).toContain('unknown item')
  expect(plan.skipped[1].reason).toContain('malformed')
  expect(plan.skipped[2].reason).toContain('malformed')
  expect(plan.items.A.docs).toEqual([])
})

test('docs_follow_a_split_and_a_merge', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('item.link', { item: 'A', doc: 'a.md' }),
      entry('item.link', { item: 'B', doc: 'b.md' }),
      entry('item.link', { item: 'B', doc: 'a.md' }),
      entry('item.split', { item: 'A', into: [item('A1'), item('A2')] }),
      entry('item.merge', { items: ['A1', 'B'], into: item('M') }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  expect(plan.items.A2.docs).toEqual([])
  expect(plan.items.M.docs).toEqual(['a.md', 'b.md'])
})

test('renames_remember_the_previous_title_by_entry_id', async () => {
  const added = [entry('item.add', { item: item('A', 'Alpha') }), entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } })]
  const rename = entry('item.edit', { item: 'A', title: 'Beta' })
  const reword = entry('step.edit', { step: 's1', title: 'uno' })
  const goalOnly = entry('item.edit', { item: 'A', goal: 'new goal' })
  const same = entry('item.edit', { item: 'A', title: 'Beta' })
  const again = entry('item.edit', { item: 'A', title: 'Gamma' })
  const plan = await replay(await logText([...added, rename, reword, goalOnly, same, again]))
  expect(Object.getPrototypeOf(plan.previousNames)).toBeNull()
  expect(plan.previousNames[rename.id]).toBe('Alpha')
  expect(plan.previousNames[reword.id]).toBe('one')
  expect(plan.previousNames[again.id]).toBe('Beta')
  expect(Object.hasOwn(plan.previousNames, goalOnly.id)).toBe(false)
  expect(Object.hasOwn(plan.previousNames, same.id)).toBe(false)
  expect(Object.keys(plan.previousNames).length).toBe(3)
  expect(plan.items.A.title).toBe('Gamma')
})

test('step_note_is_set_cleared_and_dropped_when_done', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
    entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
    entry('step.note', { step: 's1', note: 'waiting for review' }),
    entry('step.note', { step: 's2', note: 'waiting for CI' }),
    entry('step.status', { step: 's2', status: 'doing' }),
    entry('step.note', { step: 'ghost', note: 'x' }),
  ]
  const plan = await replay(await logText(entries))
  expect(plan.steps.s1.note).toBe('waiting for review')
  expect(plan.steps.s2.note).toBe('waiting for CI')
  expect(plan.skipped.map((s) => s.reason)).toEqual(['unknown step: ghost'])
  // A note is where a step stands now, not a change the user reads back.
  expect(plan.itemLog.A.some((e) => e.kind === 'step.note')).toBe(false)

  const later = await replay(
    await logText([
      ...entries.slice(0, 6),
      entry('step.note', { step: 's1', note: '' }),
      entry('step.status', { step: 's2', status: 'done', result: 'ok' }),
    ]),
  )
  expect(later.steps.s1.note).toBeUndefined()
  expect(later.steps.s2.note).toBeUndefined()
  expect(later.steps.s2.status).toBe('done')
})

test('step_add_can_start_doing_done_assigned_and_noted', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' }, status: 'doing', to: 'claude-b', note: 'in review' }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' }, status: 'done' }, { basis: { type: 'thoth', task: 'T2' } }),
      entry('step.add', { item: 'A', step: { id: 's3', title: 'three' }, status: 'done', result: 'ok' }),
      entry('step.add', { item: 'A', step: { id: 's4', title: 'four' }, status: 'finished' }),
    ]),
  )
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'doing', assignee: 'claude-b', note: 'in review' })
  expect(plan.steps.s2.evidence).toEqual({ thoth: 'T2' })
  expect(plan.steps.s3.evidence).toEqual({ result: 'ok' })
  expect(plan.skipped.map((s) => s.reason)).toEqual(['malformed entry: bad data for step.add'])
})

test('old_logs_replay_the_same', async () => {
  // Lines written before 0.2.0, with what the old call-wide evidence left behind.
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
      entry('step.edit', { step: 's2', title: 'two v2' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.status', { step: 's1', status: 'done' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.status', { step: 's2', status: 'doing', result: 'ok' }, { basis: { type: 'thoth', task: 'T1' } }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'done', evidence: { thoth: 'T1' } })
  expect(plan.steps.s2).toEqual({ id: 's2', item: 'A', title: 'two v2', status: 'doing' })
})

test('step_repo_tags_untags_and_skips_an_unknown_step', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' }, repo: 'auth-center' }),
    entry('step.add', { item: 'A', step: { id: 's2', title: 'two' }, repo: '' }),
    entry('step.add', { item: 'A', step: { id: 's3', title: 'three' } }),
    entry('step.repo', { step: 's3', repo: 'post_backend_eruncard' }),
    entry('step.repo', { step: 'ghost', repo: 'auth-center' }),
  ]
  const plan = await replay(await logText(entries))
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'todo', repo: 'auth-center' })
  expect(Object.hasOwn(plan.steps.s2, 'repo')).toBe(false)
  expect(plan.steps.s3.repo).toBe('post_backend_eruncard')
  expect(plan.skipped.map((s) => s.reason)).toEqual(['unknown step: ghost'])
  // A tag is a step change: it is on the item's history.
  expect(plan.itemLog.A.filter((e) => e.kind === 'step.repo')).toHaveLength(1)

  const later = await replay(
    await logText([...entries, entry('step.repo', { step: 's1', repo: '' }), entry('step.repo', { step: 's3', repo: 7 })]),
  )
  expect(Object.hasOwn(later.steps.s1, 'repo')).toBe(false)
  expect(later.steps.s3.repo).toBe('post_backend_eruncard')
  expect(later.skipped.map((s) => s.reason)).toEqual(['unknown step: ghost', 'malformed entry: bad data for step.repo'])
})

test('repo_names_are_set_and_dropped_and_stay_off_item_histories', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('repo.name', { repo: 'post_backend_eruncard', name: 'ERC後端' }),
      entry('repo.name', { repo: 'auth-center', name: '認證中心' }),
      entry('repo.name', { repo: 'auth-center', name: '' }),
      entry('repo.name', { repo: '  ', name: 'blank' }),
    ]),
  )
  expect(plan.repoNames).toEqual({ post_backend_eruncard: 'ERC後端' })
  expect(Object.getPrototypeOf(plan.repoNames)).toBeNull()
  expect(plan.skipped.map((s) => s.reason)).toEqual(['malformed entry: bad data for repo.name'])
  expect(plan.applied.filter((e) => e.kind === 'repo.name')).toHaveLength(3)
  // A short name points at no item or step, so no item's history shows it.
  expect(plan.itemLog.A.some((e) => e.kind === 'repo.name')).toBe(false)
})

test('logs_without_repos_replay_the_same', async () => {
  // Lines written before 0.3.0: no step.repo, no repo.name, no repo on step.add.
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' }, status: 'doing', to: 'claude-b' }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
      entry('step.status', { step: 's2', status: 'done', result: 'ok' }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  expect(plan.repoNames).toEqual({})
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'doing', assignee: 'claude-b' })
  expect(plan.steps.s2).toEqual({ id: 's2', item: 'A', title: 'two', status: 'done', evidence: { result: 'ok' } })
  expect(Object.values(plan.steps).some((s) => Object.hasOwn(s, 'repo'))).toBe(false)
})
