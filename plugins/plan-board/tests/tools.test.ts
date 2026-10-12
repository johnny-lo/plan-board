import { expect, test } from 'claude-code/testing'

import { sha16 } from '../hooks/checksum.ts'
import { nextText } from '../hooks/logfile.ts'
import { replay } from '../hooks/replay.ts'
import { TOOLS } from '../hooks/tools.ts'
import type { ToolContext, ToolResult } from '../hooks/tools.ts'
import { entry, logText } from './fixtures.ts'
import type { Entry, Plan } from '../types'

const NOW = '2026-10-08T00:00:00.000Z'
const HEX8 = /^[0-9a-f]{8}$/
const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })
const step = (it: string, id: string, title = id): Entry => entry('step.add', { item: it, step: { id, title } })
const question = (id: string, extra: Record<string, unknown> = {}): Entry =>
  entry('card.open', {
    card: { id, type: 'question', question: `q-${id}`, why: 'w', options: [{ label: 'a', effect: 'x' }, { label: 'b', effect: 'y' }], ...extra },
  })
const proposal = (id: string, changes: unknown[], extra: Record<string, unknown> = {}): Entry =>
  entry('card.open', { card: { id, type: 'proposal', question: `p-${id}`, why: `why-${id}`, options: [], changes, ...extra } })

async function planOf(entries: Entry[], tail = ''): Promise<Plan> {
  return replay((await logText(entries)) + tail)
}

function ctxOf(plan: Plan, approved: string[] = []): ToolContext {
  let counter = 0
  return {
    plan,
    now: NOW,
    newId: (length) => {
      counter += 1
      return (0xabc00000 + counter).toString(16).padStart(length, '0')
    },
    isApproved: (id) => approved.includes(id),
  }
}

function good(result: ToolResult): Extract<ToolResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result
}

function bad(result: ToolResult): string {
  if (result.ok) throw new Error('expected an error, got ok')
  return result.error
}

test('propose_change_opens_a_proposal_card', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') })])
  const ctx = ctxOf(plan)
  const result = good(
    TOOLS.propose_change.run(ctx, {
      question: 'Add docs?',
      why: 'users need them',
      changes: [{ kind: 'item.add', data: { item: { title: 'Docs', goal: 'README exists' } } }],
      item: 'A',
      blocking: true,
    }),
  )
  expect(result.entries.length).toBe(1)
  expect(result.drop).toEqual([])
  const open = result.entries[0]
  expect(open.kind).toBe('card.open')
  expect(open.id.length).toBe(12)
  expect(open.at).toBe(NOW)
  expect(open.why).toBe('users need them')
  expect(open.basis).toEqual({ type: 'ai' })
  if (open.kind !== 'card.open') throw new Error('unreachable')
  const card = open.data.card
  expect(card.type).toBe('proposal')
  expect(card.options).toEqual([])
  expect(card.id).toMatch(HEX8)
  expect(card.item).toBe('A')
  expect(card.blocking).toBe(true)
  expect(card.question).toBe('Add docs?')
  const change = card.changes?.[0]
  if (change?.kind !== 'item.add') throw new Error('expected item.add')
  expect(change.data.item.id).toMatch(HEX8)
  expect(change.data.item.title).toBe('Docs')
  expect(result.message).toContain(card.id)
  expect(result.message).toContain(change.data.item.id)

  const split = good(
    TOOLS.propose_change.run(ctxOf(plan), {
      question: 'Split?',
      why: 'too big',
      changes: [{ kind: 'item.split', data: { item: 'A', into: [{ title: 'A1', goal: 'g' }, { id: 'keepme01', title: 'A2', goal: 'g' }] } }],
    }),
  )
  const opened = split.entries[0]
  if (opened.kind !== 'card.open') throw new Error('unreachable')
  const splitChange = opened.data.card.changes?.[0]
  if (splitChange?.kind !== 'item.split') throw new Error('expected item.split')
  expect(splitChange.data.into[0].id).toMatch(HEX8)
  expect(splitChange.data.into[1].id).toBe('keepme01')

  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: [{ kind: 'step.add', data: { item: 'A', step: { title: 's' } } }] }))).toContain('item.')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: [{ kind: 'item.remove', data: { item: 'nope' } }] }))).toContain('unknown item')
  const change1 = [{ kind: 'item.remove', data: { item: 'A' } }]
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: '', changes: change1 }))).toContain('why')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', changes: change1 }))).toContain('why')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: 'nope' }))).toContain('changes')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: [] }))).toContain('changes')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: change1, blocking: 'yes' }))).toContain('blocking')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), 'oops'))).toContain('input')
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: change1, item: 'ghost' }))).toContain('unknown item')
})

test('apply_change_needs_approval_or_chat', async () => {
  const changes = [
    { kind: 'item.add', data: { item: item('X1', 'Docs', 'README exists') } },
    { kind: 'item.edit', data: { item: 'A', goal: 'better goal' } },
  ]
  const entries = [entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), proposal('p1', changes, { item: 'A' }), question('q1')]
  const plan = await planOf(entries)

  expect(bad(TOOLS.apply_change.run(ctxOf(plan), { card: 'p1' }))).toContain('not approved')
  expect(bad(TOOLS.apply_change.run(ctxOf(plan), { card: 'p1', chat: '' }))).toContain('not approved')
  expect(bad(TOOLS.apply_change.run(ctxOf(plan, ['p1']), { card: 'ghost' }))).toContain('unknown card')
  expect(bad(TOOLS.apply_change.run(ctxOf(plan, ['q1']), { card: 'q1' }))).toContain('proposal')
  expect(bad(TOOLS.apply_change.run(ctxOf(plan), {}))).toContain('card')

  const approved = good(TOOLS.apply_change.run(ctxOf(plan, ['p1']), { card: 'p1' }))
  expect(approved.entries.map((e) => e.kind)).toEqual(['item.add', 'item.edit', 'card.resolve'])
  expect(approved.entries.map((e) => e.id).every((id) => id.length === 12)).toBe(true)
  expect(new Set(approved.entries.map((e) => e.id)).size).toBe(3)
  approved.entries.forEach((e, i) => {
    expect(e.basis).toEqual({ type: 'card', card: 'p1' })
    expect(e.why).toBe('why-p1')
    expect(e.at).toBe(new Date(Date.parse(NOW) + i).toISOString())
  })
  expect(approved.entries[2].data).toEqual({ card: 'p1', outcome: 'approved', choice: 'approve' })
  expect(approved.entries[0].data).toEqual(changes[0].data)
  expect(approved.message).toContain('p1')

  const chat = good(TOOLS.apply_change.run(ctxOf(plan), { card: 'p1', chat: '照你的建議' }))
  for (const e of chat.entries) expect(e.basis).toEqual({ type: 'card', card: 'p1', chat: '照你的建議' })

  const resolved = await planOf([...entries, entry('card.resolve', { card: 'p1', outcome: 'approved', choice: 'approve' })])
  expect(bad(TOOLS.apply_change.run(ctxOf(resolved, ['p1']), { card: 'p1' }))).toContain('resolved')

  const removed = await planOf([...entries, entry('item.remove', { item: 'A' })])
  const stale = bad(TOOLS.apply_change.run(ctxOf(removed, ['p1']), { card: 'p1' }))
  expect(stale).toContain('changed since')
  expect(stale).toContain('unknown item')
})

test('update_step_needs_evidence_for_done', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), step('A', 's1'), step('A', 's2')])
  const run = (ops: object[], extra: object = {}) => TOOLS.update_step.run(ctxOf(plan), { why: 'finished', ops, ...extra })
  const done = (evidence?: unknown) => ({ action: 'status', step: 's1', status: 'done', ...(evidence === undefined ? {} : { evidence }) })

  expect(bad(run([done()]))).toContain('evidence')
  expect(bad(run([done({})]))).toContain('evidence')
  expect(bad(run([done('done')]))).toContain('evidence')

  const thoth = good(run([done({ thoth: 'T1' })]))
  expect(thoth.entries.length).toBe(1)
  expect(thoth.entries[0].kind).toBe('step.status')
  expect(thoth.entries[0].basis).toEqual({ type: 'thoth', task: 'T1' })
  expect(thoth.entries[0].why).toBe('finished')
  expect(thoth.entries[0].data).toEqual({ step: 's1', status: 'done' })

  const result = good(run([done({ result: 'tests pass' })]))
  expect(result.entries[0].basis).toEqual({ type: 'ai' })
  expect(result.entries[0].data).toEqual({ step: 's1', status: 'done', result: 'tests pass' })

  // Evidence belongs to the op that marks the step done, never to the whole call.
  expect(bad(run([done({ thoth: 'T1' })], { evidence: { thoth: 'T1' } }))).toContain('ops[i].evidence')
  expect(bad(run([{ action: 'remove', step: 's1' }], { evidence: 'done' }))).toContain('evidence')

  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 'zzz', status: 'doing' }] }))).toContain('unknown step')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'add', item: 'zzz', title: 't' }] }))).toContain('unknown item')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: '', ops: [{ action: 'remove', step: 's1' }] }))).toContain('why')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [] }))).toContain('ops')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'dance', step: 's1' }] }))).toContain('action')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 's1', status: 'finished' }] }))).toContain('status')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'edit', step: 's1' }] }))).toContain('title')

  const many = good(
    TOOLS.update_step.run(ctxOf(plan), {
      why: 'reshuffle',
      ops: [
        { action: 'add', item: 'A', title: 'new step', after: 's1' },
        { action: 'edit', step: 's1', title: 'renamed' },
        { action: 'move', step: 's2', item: 'B' },
        { action: 'assign', step: 's1', to: 'claude-b' },
        { action: 'status', step: 's1', status: 'doing' },
        { action: 'remove', step: 's2' },
      ],
    }),
  )
  expect(many.entries.map((e) => e.kind)).toEqual(['step.add', 'step.edit', 'step.move', 'step.assign', 'step.status', 'step.remove'])
  const added = many.entries[0]
  if (added.kind !== 'step.add') throw new Error('unreachable')
  expect(added.data.step.id).toMatch(HEX8)
  expect(added.data).toEqual({ item: 'A', step: { id: added.data.step.id, title: 'new step' }, after: 's1' })
  expect(many.message).toContain(added.data.step.id)
  expect(many.message).toContain('A')
  expect(new Set(many.entries.map((e) => e.id)).size).toBe(6)
  expect(many.entries.every((e) => e.why === 'reshuffle')).toBe(true)
})

test('add_decision_checks_options', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')])
  const opt = (label: string, extra: Record<string, unknown> = {}) => ({ label, effect: `${label} leads on`, ...extra })
  const base = { question: 'Where?', why: 'blocks the install step' }

  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a')] }))).toContain('options')
  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a'), opt('b'), opt('c'), opt('d'), opt('e')] }))).toContain('options')
  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a', { recommended: true }), opt('b', { recommended: true })] }))).toContain('recommended')
  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a'), { label: 'b' }] }))).toContain('effect')
  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, why: '', options: [opt('a'), opt('b')] }))).toContain('why')
  expect(bad(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a'), opt('b')], step: 'ghost' }))).toContain('unknown step')

  const result = good(
    TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a', { recommended: true, reason: 'simplest' }), opt('b')], step: 's1' }),
  )
  expect(result.entries.length).toBe(1)
  const open = result.entries[0]
  if (open.kind !== 'card.open') throw new Error('unreachable')
  expect(open.why).toBe('blocks the install step')
  expect(open.data.card.type).toBe('question')
  expect(open.data.card.item).toBe('A')
  expect(open.data.card.step).toBe('s1')
  expect(open.data.card.id).toMatch(HEX8)
  expect(open.data.card.options[0]).toEqual({ label: 'a', effect: 'a leads on', recommended: true, reason: 'simplest' })
  expect(open.data.card.options[1]).toEqual({ label: 'b', effect: 'b leads on' })
  expect(result.message).toContain(open.data.card.id)

  const four = good(TOOLS.add_decision.run(ctxOf(plan), { ...base, options: [opt('a'), opt('b'), opt('c'), opt('d')], blocking: true }))
  const fourOpen = four.entries[0]
  if (fourOpen.kind !== 'card.open') throw new Error('unreachable')
  expect(fourOpen.data.card.blocking).toBe(true)
  expect(fourOpen.data.card.item).toBeUndefined()
})

test('resolve_decision_requires_outcome', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), question('q1', { item: 'A' }), question('q2')])
  expect(bad(TOOLS.resolve_decision.run(ctxOf(plan), { card: 'q1', outcome: '' }))).toContain('outcome')
  expect(bad(TOOLS.resolve_decision.run(ctxOf(plan), { card: 'q1' }))).toContain('outcome')
  expect(bad(TOOLS.resolve_decision.run(ctxOf(plan), { outcome: 'x' }))).toContain('card')
  expect(bad(TOOLS.resolve_decision.run(ctxOf(plan), { card: 'ghost', outcome: 'x' }))).toContain('unknown card')

  const result = good(TOOLS.resolve_decision.run(ctxOf(plan), { card: 'q1', outcome: 'use the global install' }))
  expect(result.entries.length).toBe(1)
  expect(result.entries[0].kind).toBe('card.resolve')
  expect(result.entries[0].why).toBe('use the global install')
  expect(result.entries[0].data).toEqual({ card: 'q1', outcome: 'use the global install' })
  expect(result.entries[0].basis).toEqual({ type: 'ai' })
  expect(result.drop).toEqual([])
  expect(result.message).toContain('q1')

  const resolved = await planOf([entry('card.open', { card: { id: 'q9', type: 'question', question: 'q', why: 'w', options: [] } }), entry('card.resolve', { card: 'q9', outcome: 'done' })])
  expect(bad(TOOLS.resolve_decision.run(ctxOf(resolved), { card: 'q9', outcome: 'again' }))).toContain('resolved')
})

test('resolve_direct_edit_rules', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1'), question('q1', { item: 'A' }), entry('card.resolve', { card: 'q1', outcome: 'keep it', choice: 'a' }), question('q2')]
  const tamper = async (e: Entry): Promise<{ raw: string; hash: string }> => {
    const raw = (await logText([e])).trim().replace('"why":"test"', '"why":"edited"')
    return { raw, hash: await sha16(raw) }
  }
  const clean = await planOf(base)
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(clean), { action: 'keep', summary: 'x' }))).toContain('flagged')

  const itemLine = await tamper(entry('item.add', { item: item('B') }))
  const stepLine = await tamper(step('A', 's2'))
  const withItem = await planOf(base, itemLine.raw + '\n')
  expect(withItem.flagged.length).toBe(1)
  const noCard = bad(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'keep', summary: 'added B' }))
  expect(noCard).toContain('card')
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'keep', summary: 'added B', card: 'q2' }))).toContain('card')
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'keep', summary: 'added B', card: 'ghost' }))).toContain('card')
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'keep', summary: '', card: 'q1' }))).toContain('summary')
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'toss', summary: 'x', card: 'q1' }))).toContain('action')

  const kept = good(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'keep', summary: 'added B', card: 'q1' }))
  expect(kept.entries.length).toBe(1)
  expect(kept.entries[0].kind).toBe('edit.keep')
  expect(kept.entries[0].data).toEqual({ lines: [itemLine.hash], summary: 'added B' })
  expect(kept.entries[0].basis).toEqual({ type: 'direct-edit' })
  expect(kept.entries[0].why).toBe('added B')
  expect(kept.drop).toEqual([])

  const dropped = good(TOOLS.resolve_direct_edit.run(ctxOf(withItem), { action: 'drop', summary: 'not wanted' }))
  expect(dropped.entries[0].kind).toBe('edit.drop')
  expect(dropped.entries[0].data).toEqual({ lines: [itemLine.hash], summary: 'not wanted' })
  expect(dropped.drop).toEqual([itemLine.hash])

  const withStep = await planOf(base, stepLine.raw + '\n')
  const stepOnly = good(TOOLS.resolve_direct_edit.run(ctxOf(withStep), { action: 'keep', summary: 'added a step' }))
  expect(stepOnly.entries[0].kind).toBe('edit.keep')

  const both = await planOf(base, itemLine.raw + '\n' + stepLine.raw + '\noops\n')
  expect(both.flagged.length).toBe(3)
  const all = good(TOOLS.resolve_direct_edit.run(ctxOf(both), { action: 'drop', summary: 'all of it' }))
  expect(all.drop).toEqual(both.flagged.map((f) => f.hash))
  expect(bad(TOOLS.resolve_direct_edit.run(ctxOf(both), { action: 'keep', summary: 'all of it' }))).toContain('card')
})

test('schemas_list_required_fields', () => {
  const required = (name: keyof typeof TOOLS): string[] => (TOOLS[name].inputSchema as { required: string[] }).required
  expect(required('add_decision')).toEqual(expect.arrayContaining(['question', 'why', 'options']))
  expect(required('propose_change')).toEqual(expect.arrayContaining(['question', 'why', 'changes']))
  expect(required('apply_change')).toEqual(['card'])
  // why may be left out when every op is a note; the tool checks the rest.
  expect(required('update_step')).toEqual(['ops'])
  expect(required('resolve_decision')).toEqual(expect.arrayContaining(['card', 'outcome']))
  expect(required('resolve_direct_edit')).toEqual(expect.arrayContaining(['action', 'summary']))
  expect(required('add_user_action')).toEqual(['action', 'why'])
  for (const tool of Object.values(TOOLS)) {
    expect(tool.description.length).toBeGreaterThan(10)
    expect((tool.inputSchema as { type: string }).type).toBe('object')
  }
  expect(Object.keys(TOOLS).sort()).toEqual(['add_decision', 'add_user_action', 'apply_change', 'propose_change', 'resolve_decision', 'resolve_direct_edit', 'update_step'])
})

test('entries_of_one_call_replay_in_written_order', async () => {
  const base = [entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') })]
  for (let run = 0; run < 20; run++) {
    const plan = await planOf(base)
    const ctx: ToolContext = {
      plan,
      now: NOW,
      newId: (length) => crypto.randomUUID().replace(/-/g, '').slice(0, length),
      isApproved: () => true,
    }
    const changes = [
      { kind: 'item.add', data: { item: item('C') } },
      { kind: 'item.reorder', data: { order: ['C', 'A', 'B'] } },
    ]
    const opened = good(TOOLS.propose_change.run(ctx, { question: 'q', why: 'w', changes }))
    const cardId = (opened.entries[0].data as { card: { id: string } }).card.id
    const withCard = await nextText(await logText(base), opened.entries, [])
    const applied = good(TOOLS.apply_change.run({ ...ctx, plan: await replay(withCard) }, { card: cardId }))
    expect(applied.entries.map((e) => e.at)).toEqual(applied.entries.map((_, i) => new Date(Date.parse(NOW) + i).toISOString()))
    const after = await replay(await nextText(withCard, applied.entries, []))
    expect(after.order).toEqual(['C', 'A', 'B'])
    expect(after.skipped).toEqual([])
  }
})

test('positions_must_exist', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), step('A', 's1'), step('B', 's2')])
  const add = (before: string) => [{ kind: 'item.add', data: { item: item('X'), before } }]
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: add('ghost') }))).toContain('before')
  good(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: add('B') }))

  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [op] })
  expect(bad(run({ action: 'add', item: 'A', title: 't', after: 'ghost' }))).toContain('after')
  expect(bad(run({ action: 'add', item: 'A', title: 't', after: 's2' }))).toContain('after')
  good(run({ action: 'add', item: 'A', title: 't', after: 's1' }))
  expect(bad(run({ action: 'move', step: 's1', item: 'B', after: 'ghost' }))).toContain('after')
  expect(bad(run({ action: 'move', step: 's1', item: 'B', after: 'ghost' }))).toContain('ghost')
  expect(bad(run({ action: 'move', step: 's1', item: 'B', after: 's1' }))).toContain('after')
  good(run({ action: 'move', step: 's1', item: 'B', after: 's2' }))
})

test('apply_change_refuses_empty_or_non_item_cards', async () => {
  const plan = await planOf([
    entry('item.add', { item: item('A') }),
    entry('card.open', { card: { id: 'p0', type: 'proposal', question: 'q', why: 'w', options: [], changes: [] } }),
    entry('card.open', {
      card: { id: 'p1', type: 'proposal', question: 'q', why: 'w', options: [], changes: [{ kind: 'step.add', data: { item: 'A', step: { id: 's1', title: 't' } } }] },
    }),
  ])
  expect(bad(TOOLS.apply_change.run(ctxOf(plan, ['p0']), { card: 'p0' }))).toContain('changes')
  expect(bad(TOOLS.apply_change.run(ctxOf(plan, ['p1']), { card: 'p1' }))).toContain('item.')
})

test('blank_evidence_counts_as_missing', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')])
  const run = (evidence: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 's1', status: 'done', evidence }] })
  expect(bad(run({ thoth: '   ' }))).toContain('evidence')
  expect(bad(run({ result: ' \t' }))).toContain('evidence')
  expect(bad(run({ thoth: ' ', result: '' }))).toContain('evidence')
  const kept = good(run({ thoth: '  ', result: ' fine ' }))
  expect(kept.entries[0].basis).toEqual({ type: 'ai' })
  expect(kept.entries[0].data).toEqual({ step: 's1', status: 'done', result: 'fine' })
})

test('update_step_link_writes_item_link_with_basis_ai', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') })])
  const run = (op: object, extra: object = {}) => TOOLS.update_step.run(ctxOf(plan), { why: 'spec written', ops: [op], ...extra })
  expect(bad(run({ action: 'link', item: 'A', doc: 'docs/superpowers/specs/a.md' }, { evidence: { thoth: 'T1' } }))).toContain('ops[i].evidence')
  expect(bad(run({ action: 'link', item: 'A', doc: 'x.md', evidence: { thoth: 'T1' } }))).toContain('only on an op that sets status done')
  const linked = good(run({ action: 'link', item: 'A', doc: 'docs/superpowers/specs/a.md' }))
  expect(linked.entries.length).toBe(1)
  expect(linked.entries[0].kind).toBe('item.link')
  expect(linked.entries[0].data).toEqual({ item: 'A', doc: 'docs/superpowers/specs/a.md' })
  expect(linked.entries[0].basis).toEqual({ type: 'ai' })
  expect(linked.entries[0].why).toBe('spec written')
  expect(linked.message).toContain('docs/superpowers/specs/a.md')

  expect(bad(run({ action: 'link', item: 'A', doc: '' }))).toContain('doc')
  expect(bad(run({ action: 'link', item: 'A', doc: '   ' }))).toContain('doc')
  expect(bad(run({ action: 'link', item: 'A' }))).toContain('doc')
  expect(bad(run({ action: 'link', doc: 'x.md' }))).toContain('item')
  expect(bad(run({ action: 'link', item: 'ghost', doc: 'x.md' }))).toContain('unknown item')
  const schema = JSON.stringify(TOOLS.update_step.inputSchema)
  expect(schema).toContain('"link"')
  expect(schema).toContain('"doc"')
})

test('a_link_is_not_an_item_level_proposal', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') })])
  const link = [{ kind: 'item.link', data: { item: 'A', doc: 'x.md' } }]
  expect(bad(TOOLS.propose_change.run(ctxOf(plan), { question: 'q', why: 'w', changes: link }))).toContain('update_step')
})

test('keeping_a_flagged_link_needs_no_card', async () => {
  const link = JSON.stringify({ id: 'abcabcabcabc', at: '2026-10-07T00:00:00.500Z', kind: 'item.link', why: 'x', basis: { type: 'ai' }, data: { item: 'A', doc: 'x.md' } })
  const plan = await planOf([entry('item.add', { item: item('A') })], link + '\n')
  expect(plan.flagged.length).toBe(1)
  good(TOOLS.resolve_direct_edit.run(ctxOf(plan), { action: 'keep', summary: 'a link' }))
})

test('update_step_note_needs_no_why_when_alone', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1'), step('A', 's2')])
  const run = (input: object) => TOOLS.update_step.run(ctxOf(plan), input)

  const noted = good(run({ ops: [{ action: 'note', step: 's1', note: ' waiting for review ' }, { action: 'note', step: 's2', note: '   ' }] }))
  expect(noted.entries.map((e) => e.kind)).toEqual(['step.note', 'step.note'])
  expect(noted.entries.map((e) => e.data)).toEqual([{ step: 's1', note: 'waiting for review' }, { step: 's2', note: '' }])
  expect(noted.entries.map((e) => e.why)).toEqual(['waiting for review', 'note cleared'])
  expect(noted.entries.every((e) => e.basis.type === 'ai')).toBe(true)
  expect(noted.message).toContain('s1')

  const explained = good(run({ why: 'review started', ops: [{ action: 'note', step: 's1', note: 'in review' }] }))
  expect(explained.entries[0].why).toBe('review started')
  good(run({ why: '  ', ops: [{ action: 'note', step: 's1', note: 'in review' }] }))

  expect(bad(run({ ops: [{ action: 'note', step: 's1', note: 'x' }, { action: 'status', step: 's2', status: 'doing' }] }))).toContain('why')
  expect(bad(run({ ops: [{ action: 'note', step: 's1' }] }))).toContain('note')
  expect(bad(run({ ops: [{ action: 'note', step: 'ghost', note: 'x' }] }))).toContain('unknown step')
  expect(JSON.stringify(TOOLS.update_step.inputSchema)).toContain('"note"')
})

test('evidence_belongs_to_the_op_that_marks_done', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1'), step('A', 's2')])
  const run = (ops: object[]) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops })
  const mixed = good(
    run([
      { action: 'edit', step: 's2', title: 'renamed' },
      { action: 'status', step: 's1', status: 'done', evidence: { thoth: 'T1' } },
      { action: 'add', item: 'A', title: 'new' },
      { action: 'status', step: 's2', status: 'doing' },
    ]),
  )
  expect(mixed.entries.map((e) => e.basis)).toEqual([{ type: 'ai' }, { type: 'thoth', task: 'T1' }, { type: 'ai' }, { type: 'ai' }])
  expect(mixed.entries[3].data).toEqual({ step: 's2', status: 'doing' })
  expect(bad(run([{ action: 'status', step: 's2', status: 'doing', evidence: { result: 'x' } }]))).toContain('only on an op that sets status done')
  expect(bad(run([{ action: 'edit', step: 's2', title: 't', evidence: { result: 'x' } }]))).toContain('only on an op that sets status done')
  const schema = TOOLS.update_step.inputSchema as { properties: Record<string, unknown> }
  expect(schema.properties.evidence).toBeUndefined()
  expect(JSON.stringify(schema)).toContain('"evidence"')
})

test('add_sets_status_assignee_and_note_in_one_entry', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title: 'review', ...op }] })

  const added = good(run({ status: 'doing', to: 'claude-b', note: ' waiting for review ' }))
  expect(added.entries.length).toBe(1)
  const id = (added.entries[0].data as { step: { id: string } }).step.id
  expect(added.entries[0].data).toEqual({ item: 'A', step: { id, title: 'review' }, status: 'doing', to: 'claude-b', note: 'waiting for review' })
  expect(added.message).toContain('(doing, assigned to claude-b)')
  const after = await replay(await nextText(await logText(base), added.entries, []))
  expect(after.steps[id]).toEqual({ id, item: 'A', title: 'review', status: 'doing', assignee: 'claude-b', note: 'waiting for review' })

  const done = good(run({ status: 'done', evidence: { thoth: 'T9' } }))
  expect(done.entries[0].basis).toEqual({ type: 'thoth', task: 'T9' })
  expect(done.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, status: 'done' })
  const reported = good(run({ status: 'done', evidence: { result: 'already merged' } }))
  expect(reported.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, status: 'done', result: 'already merged' })

  // todo and an empty assignee are what a plain add means; they are not written.
  expect(good(run({ status: 'todo', to: '' })).entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' } })
  expect(bad(run({ status: 'done' }))).toContain('evidence')
  expect(bad(run({ status: 'done', note: 'x', evidence: { result: 'ok' } }))).toContain('no note')
  expect(bad(run({ status: 'doing', evidence: { result: 'ok' } }))).toContain('only on an op that sets status done')
  expect(bad(run({ status: 'finished' }))).toContain('status')
  expect(bad(run({ to: 3 }))).toContain('to')
})

test('add_user_action_opens_an_action_card', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), step('A', 's1')])
  const run = (input: object) => TOOLS.add_user_action.run(ctxOf(plan), input)
  const opened = good(
    run({ action: 'Run thoth checks approve in your terminal', why: 'new checks need a human', command: 'thoth checks approve', item: 'A', step: 's1' }),
  )
  expect(opened.entries.length).toBe(1)
  expect(opened.entries[0].kind).toBe('card.open')
  const card = (opened.entries[0].data as { card: { id: string } }).card
  expect(card).toEqual({
    id: card.id,
    type: 'action',
    question: 'Run thoth checks approve in your terminal',
    why: 'new checks need a human',
    options: [],
    item: 'A',
    step: 's1',
    command: 'thoth checks approve',
  })
  expect(card.id).toMatch(HEX8)
  expect(opened.message).toContain(`card ${card.id}`)

  const bare = good(run({ action: 'Log in to GitHub', why: 'the push needs it' }))
  expect((bare.entries[0].data as { card: object }).card).toEqual({ id: expect.any(String), type: 'action', question: 'Log in to GitHub', why: 'the push needs it', options: [] })
  // The step alone names its item.
  expect((good(run({ action: 'x', why: 'y', step: 's1' })).entries[0].data as { card: { item?: string } }).card.item).toBe('A')

  expect(bad(run({ why: 'y' }))).toContain('action')
  expect(bad(run({ action: 'x' }))).toContain('why')
  expect(bad(run({ action: 'x', why: 'y', command: '  ' }))).toContain('command')
  expect(bad(run({ action: 'x', why: 'y', item: 'ghost' }))).toContain('unknown item')
  expect(bad(run({ action: 'x', why: 'y', item: 'B', step: 's1' }))).toContain('not in item')

  const withCard = await planOf([entry('card.open', { card: { id: 'a1', type: 'action', question: 'Log in', why: 'w', options: [], command: 'gh auth login' } })])
  expect(withCard.cards.a1.type).toBe('action')
  expect(withCard.cards.a1.command).toBe('gh auth login')
  expect(bad(TOOLS.apply_change.run(ctxOf(withCard, ['a1']), { card: 'a1' }))).toContain('not a proposal')
  good(TOOLS.resolve_decision.run(ctxOf(withCard), { card: 'a1', outcome: 'logged in' }))
})

test('repo_op_and_add_repo_tag_steps', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1')]
  const plan = await planOf(base)
  const run = (ops: object[]) => TOOLS.update_step.run(ctxOf(plan), { why: 'work moved to the auth repo', ops })

  const tagged = good(run([{ action: 'repo', step: 's1', repo: ' auth-center ' }]))
  expect(tagged.entries.map((e) => [e.kind, e.data, e.basis])).toEqual([['step.repo', { step: 's1', repo: 'auth-center' }, { type: 'ai' }]])
  expect(tagged.message).toContain('s1')
  expect(good(run([{ action: 'repo', step: 's1', repo: '   ' }])).entries[0].data).toEqual({ step: 's1', repo: '' })

  const added = good(run([{ action: 'add', item: 'A', title: 'check tokens', status: 'doing', repo: ' auth-center ' }]))
  expect(added.entries.length).toBe(1)
  const id = (added.entries[0].data as { step: { id: string } }).step.id
  expect(added.entries[0].data).toEqual({ item: 'A', step: { id, title: 'check tokens' }, status: 'doing', repo: 'auth-center' })
  expect(added.message).toContain('(doing, repo auth-center)')
  const after = await replay(await nextText(await logText(base), added.entries, []))
  expect(after.steps[id].repo).toBe('auth-center')

  // An empty or blank repo on add is the same as none.
  for (const repo of ['', '   ']) {
    expect(good(run([{ action: 'add', item: 'A', title: 'x', repo }])).entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'x' } })
  }
  expect(bad(run([{ action: 'repo', step: 's1' }]))).toContain('repo')
  expect(bad(run([{ action: 'repo', step: 'ghost', repo: 'x' }]))).toContain('unknown step')
  expect(bad(run([{ action: 'add', item: 'A', title: 'x', repo: 3 }]))).toContain('repo')
  // A tag is no note: why is still needed.
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { ops: [{ action: 'repo', step: 's1', repo: 'x' }] }))).toContain('why')
  expect(bad(run([{ action: 'tag' }]))).toContain('add, edit, remove, move, assign, status, note, repo, repo_name, link')
  const schema = JSON.stringify(TOOLS.update_step.inputSchema)
  expect(schema).toContain('"repo"')
  expect(schema).toContain('"repo_name"')
  expect(schema).toContain('"name"')
})

test('repo_name_refuses_a_name_another_repo_has', async () => {
  const plan = await planOf([
    entry('item.add', { item: item('A') }),
    step('A', 's1'),
    entry('repo.name', { repo: 'post_backend_eruncard', name: 'ERC後端' }),
  ])
  const run = (ops: object[]) => TOOLS.update_step.run(ctxOf(plan), { why: 'names the user knows', ops })

  const named = good(run([{ action: 'repo_name', repo: ' auth-center ', name: ' 認證中心 ' }]))
  expect(named.entries.map((e) => [e.kind, e.data, e.basis])).toEqual([['repo.name', { repo: 'auth-center', name: '認證中心' }, { type: 'ai' }]])
  expect(named.message).toContain('auth-center')

  // The name a repo already has, given to it again, is no clash.
  good(run([{ action: 'repo_name', repo: 'post_backend_eruncard', name: 'ERC後端' }]))
  expect(bad(run([{ action: 'repo_name', repo: 'auth-center', name: 'ERC後端' }]))).toBe('short name ERC後端 is already used by post_backend_eruncard')
  // Two repos given one name in a single call clash too.
  expect(
    bad(
      run([
        { action: 'repo_name', repo: 'auth-center', name: '後端' },
        { action: 'repo_name', repo: 'thoth', name: '後端' },
      ]),
    ),
  ).toBe('short name 後端 is already used by auth-center')
  // A name dropped earlier in the call can be given to another repo.
  good(
    run([
      { action: 'repo_name', repo: 'post_backend_eruncard', name: '' },
      { action: 'repo_name', repo: 'auth-center', name: 'ERC後端' },
    ]),
  )
  // A short name needs no step, so it goes before or after the tags of the same call.
  const after = good(
    run([
      { action: 'repo', step: 's1', repo: 'auth-center' },
      { action: 'repo_name', repo: 'auth-center', name: '認證中心' },
    ]),
  )
  expect(after.entries.map((e) => e.kind)).toEqual(['step.repo', 'repo.name'])
  const before = good(
    run([
      { action: 'repo_name', repo: 'thoth', name: 'Thoth' },
      { action: 'add', item: 'A', title: 'dispatch', repo: 'thoth' },
    ]),
  )
  expect(before.entries.map((e) => e.kind)).toEqual(['repo.name', 'step.add'])
  expect(good(run([{ action: 'repo_name', repo: 'post_backend_eruncard', name: '  ' }])).entries[0].data).toEqual({ repo: 'post_backend_eruncard', name: '' })

  expect(bad(run([{ action: 'repo_name', repo: '  ', name: 'x' }]))).toContain('repo')
  expect(bad(run([{ action: 'repo_name', repo: 'auth-center' }]))).toContain('name')
})

test('keeping_flagged_repo_lines_needs_no_card', async () => {
  const line = (id: string, kind: string, data: object) => JSON.stringify({ id, at: '2026-10-07T00:00:00.500Z', kind, why: 'x', basis: { type: 'ai' }, data })
  const tail = [
    line('abcabcabc001', 'step.repo', { step: 's1', repo: 'auth-center' }),
    line('abcabcabc002', 'repo.name', { repo: 'auth-center', name: '認證中心' }),
  ].join('\n')
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')], tail + '\n')
  expect(plan.flagged.length).toBe(2)
  good(TOOLS.resolve_direct_edit.run(ctxOf(plan), { action: 'keep', summary: 'a repo tag and a short name' }))
})
