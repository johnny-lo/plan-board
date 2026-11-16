import { expect, test } from 'claude-code/testing'

import { sealEntry, sha16 } from '../hooks/checksum.ts'
import { nextText } from '../hooks/logfile.ts'
import { replay } from '../hooks/replay.ts'
import { TOOLS } from '../hooks/tools.ts'
import type { ToolContext, ToolResult } from '../hooks/tools.ts'
import { entry, logText } from './fixtures.ts'
import { world } from './world.ts'
import type { Entry, Plan } from '../types'

const NOW = '2026-10-08T00:00:00.000Z'
const D = '說明這一步替使用者做什麼、怎樣算做完'
/** An option's detail and an action card's detail that repeat no label, effect, action or why of the tests that use them. */
const OD = '選了之後實際會怎麼做'
const AD = '說明為什麼要使用者自己來、做完之後會怎樣'
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
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'add', item: 'zzz', title: 't', detail: D }] }))).toContain('unknown item')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: '', ops: [{ action: 'remove', step: 's1' }] }))).toContain('why')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [] }))).toContain('ops')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'dance', step: 's1' }] }))).toContain('action')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 's1', status: 'finished' }] }))).toContain('status')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'edit', step: 's1' }] }))).toContain('title')

  const many = good(
    TOOLS.update_step.run(ctxOf(plan), {
      why: 'reshuffle',
      ops: [
        { action: 'add', item: 'A', title: 'new step', after: 's1', detail: D },
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
  expect(added.data).toEqual({ item: 'A', step: { id: added.data.step.id, title: 'new step' }, after: 's1', detail: D })
  expect(many.message).toContain(added.data.step.id)
  expect(many.message).toContain('A')
  expect(new Set(many.entries.map((e) => e.id)).size).toBe(6)
  expect(many.entries.every((e) => e.why === 'reshuffle')).toBe(true)
})

test('add_decision_checks_options', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')])
  const opt = (label: string, extra: Record<string, unknown> = {}) => ({ label, effect: `${label} leads on`, detail: OD, ...extra })
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
  expect(open.data.card.options[0]).toEqual({ label: 'a', effect: 'a leads on', recommended: true, reason: 'simplest', detail: OD })
  expect(open.data.card.options[1]).toEqual({ label: 'b', effect: 'b leads on', detail: OD })
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
  expect(required('add_user_action')).toEqual(['action', 'why', 'detail'])
  type Schema = { properties: Record<string, { description?: string; items?: Schema; required?: string[] }> }
  const props = (name: keyof typeof TOOLS) => (TOOLS[name].inputSchema as Schema).properties
  const option = props('add_decision').options.items as Schema & { required: string[] }
  expect(option.required).toEqual(['label', 'effect', 'detail'])
  const details = [option.properties.detail, ...(['propose_change', 'add_user_action', 'resolve_decision'] as const).map((n) => props(n).detail)]
  for (const detail of details) expect(detail?.description?.length ?? 0).toBeGreaterThan(40)
  expect(required('propose_change')).not.toContain('detail')
  expect(required('resolve_decision')).not.toContain('detail')
  expect(required('resolve_direct_edit')).not.toContain('detail')
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
  expect(bad(run({ action: 'add', item: 'A', title: 't', after: 'ghost', detail: D }))).toContain('after')
  expect(bad(run({ action: 'add', item: 'A', title: 't', after: 's2', detail: D }))).toContain('after')
  good(run({ action: 'add', item: 'A', title: 't', after: 's1', detail: D }))
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
      { action: 'add', item: 'A', title: 'new', detail: D },
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
  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title: 'review', detail: D, ...op }] })

  const added = good(run({ status: 'doing', to: 'claude-b', note: ' waiting for review ' }))
  expect(added.entries.length).toBe(1)
  const id = (added.entries[0].data as { step: { id: string } }).step.id
  expect(added.entries[0].data).toEqual({ item: 'A', step: { id, title: 'review' }, detail: D, status: 'doing', to: 'claude-b', note: 'waiting for review' })
  expect(added.message).toContain('(doing, assigned to claude-b)')
  const after = await replay(await nextText(await logText(base), added.entries, []))
  expect(after.steps[id]).toEqual({ id, item: 'A', title: 'review', status: 'doing', assignee: 'claude-b', note: 'waiting for review', detail: D })

  const done = good(run({ status: 'done', evidence: { thoth: 'T9' } }))
  expect(done.entries[0].basis).toEqual({ type: 'thoth', task: 'T9' })
  expect(done.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, detail: D, status: 'done' })
  const reported = good(run({ status: 'done', evidence: { result: 'already merged' } }))
  expect(reported.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, detail: D, status: 'done', result: 'already merged' })

  // todo and an empty assignee are what a plain add means; they are not written.
  expect(good(run({ status: 'todo', to: '' })).entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, detail: D })
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
    run({ action: 'Run thoth checks approve in your terminal', why: 'new checks need a human', command: 'thoth checks approve', item: 'A', step: 's1', detail: AD }),
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
    detail: AD,
  })
  expect(card.id).toMatch(HEX8)
  expect(opened.message).toContain(`card ${card.id}`)

  const bare = good(run({ action: 'Log in to GitHub', why: 'the push needs it', detail: AD }))
  expect((bare.entries[0].data as { card: object }).card).toEqual({ id: expect.any(String), type: 'action', question: 'Log in to GitHub', why: 'the push needs it', options: [], detail: AD })
  // The step alone names its item.
  expect((good(run({ action: 'x', why: 'y', step: 's1', detail: AD })).entries[0].data as { card: { item?: string } }).card.item).toBe('A')

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

  const added = good(run([{ action: 'add', item: 'A', title: 'check tokens', detail: D, status: 'doing', repo: ' auth-center ' }]))
  expect(added.entries.length).toBe(1)
  const id = (added.entries[0].data as { step: { id: string } }).step.id
  expect(added.entries[0].data).toEqual({ item: 'A', step: { id, title: 'check tokens' }, detail: D, status: 'doing', repo: 'auth-center' })
  expect(added.message).toContain('(doing, repo auth-center)')
  const after = await replay(await nextText(await logText(base), added.entries, []))
  expect(after.steps[id].repo).toBe('auth-center')

  // An empty or blank repo on add is the same as none.
  for (const repo of ['', '   ']) {
    expect(good(run([{ action: 'add', item: 'A', title: 'x', detail: D, repo }])).entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'x' }, detail: D })
  }
  expect(bad(run([{ action: 'repo', step: 's1' }]))).toContain('repo')
  expect(bad(run([{ action: 'repo', step: 'ghost', repo: 'x' }]))).toContain('unknown step')
  expect(bad(run([{ action: 'add', item: 'A', title: 'x', detail: D, repo: 3 }]))).toContain('repo')
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
      { action: 'add', item: 'A', title: 'dispatch', detail: D, repo: 'thoth' },
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

const REQUIRED = 'ops[0].detail is required on add: what this step does and how you will know it is done'

/** The plan as replayed from the log text after the returned entries are written to it. */
async function replayed(base: Entry[], result: Extract<ToolResult, { ok: true }>): Promise<Plan> {
  return replay(await nextText(await logText(base), result.entries, []))
}
/** The detail the replayed plan holds for the step the first returned entry adds. */
async function addedDetail(base: Entry[], result: Extract<ToolResult, { ok: true }>): Promise<string | undefined> {
  const id = (result.entries[0].data as { step: { id: string } }).step.id
  return (await replayed(base, result)).steps[id].detail
}

test('add_needs_a_detail_and_writes_it_normalized', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title: 'review', ...op }] })
  expect(bad(run({}))).toBe(REQUIRED)
  expect(bad(run({ detail: '  \u0007 ' }))).toContain('ops[0].detail is required')
  expect(bad(run({ detail: '​‍' }))).toContain('ops[0].detail is required')
  expect(bad(run({ detail: 5 }))).toBe('ops[0].detail must be a string')

  const written = good(run({ detail: '  第一行\r\n\r\n\r\n第二\t行 ' }))
  expect(written.entries[0].data).toMatchObject({ detail: '第一行\n\n第二 行' })
  const id = (written.entries[0].data as { step: { id: string } }).step.id
  const after = await replay(await nextText(await logText(base), written.entries, []))
  expect(after.steps[id].detail).toBe('第一行\n\n第二 行')
  expect(good(run({ detail: '**先**做 `x`' })).entries[0].data).toMatchObject({ detail: '**先**做 `x`' })
})

test('add_detail_limits_are_200_chinese_400_letters_8_lines', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (detail: string) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title: 'review', detail }] })
  const kept = async (detail: string) => expect(await addedDetail(base, good(run(detail)))).toBe(detail)
  await kept('中'.repeat(200))
  expect(bad(run('中'.repeat(201)))).toContain('ops[0].detail is 402 cells wide')
  await kept('a'.repeat(400))
  expect(bad(run('a'.repeat(401)))).toContain('401 cells wide')
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
  await kept(lines(8))
  expect(bad(run(lines(9)))).toContain('ops[0].detail is 9 lines long')
})

test('a_detail_that_repeats_the_title_or_names_ids_is_refused', async () => {
  const base = [entry('item.add', { item: item('design01') }), entry('item.add', { item: item('docs') })]
  const plan = await planOf(base)
  const run = (title: string, detail: string) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'docs', title, detail }] })
  expect(bad(run('窗格兩個畫面', '窗格 兩個畫面。'))).toBe('ops[0].detail only repeats the title; say what it leaves out')
  expect(bad(run('Pane views', 'pane views.'))).toContain('only repeats the title')
  expect(bad(run('t', '先做 design01 的部分'))).toBe('ops[0].detail names plan ids (design01); use the names the user sees')
  for (const detail of ['design012 和 design01_x 都不是', '舊的 ghost123 不在計畫裡', '寫 docs 的時候順便更新']) {
    expect(await addedDetail(base, good(run('t', detail)))).toBe(detail)
  }
})

test('detail_goes_only_on_add_or_detail_ops', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')])
  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [op] })
  const ops = [
    { action: 'edit', step: 's1', title: 'renamed' },
    { action: 'note', step: 's1', note: 'waiting' },
    { action: 'status', step: 's1', status: 'doing' },
    { action: 'remove', step: 's1' },
  ]
  for (const op of ops) expect(bad(run({ ...op, detail: D }))).toBe('ops[0]: detail goes only on an add or a detail op')
})

test('detail_op_replaces_but_never_clears', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1', '定檔案格式'), entry('step.detail', { step: 's1', detail: '舊的細節' })]
  const plan = await planOf(base)
  const call = (ops: object[]) => TOOLS.update_step.run(ctxOf(plan), { ops })
  const detail = (text: string) => ({ action: 'detail', step: 's1', detail: text })

  const done = good(call([detail(' 新的細節 ')]))
  expect(done.entries[0]).toMatchObject({ kind: 'step.detail', why: 'detail written', data: { step: 's1', detail: '新的細節' } })
  expect(done.message).toBe('Wrote the detail of step s1.')
  const after = await replay(await nextText(await logText(base), done.entries, []))
  expect(after.steps.s1.detail).toBe('新的細節')

  expect(bad(call([detail('  ')]))).toBe('ops[0].detail must be a non-empty string; a detail can be replaced, not cleared')
  expect(bad(call([detail('舊的細節')]))).toBe('step s1 already has this detail')
  expect(bad(call([{ action: 'detail', step: 'ghost', detail: '新的細節' }]))).toContain('unknown step: ghost')
  const mixed = good(call([{ action: 'note', step: 's1', note: '等審查' }, detail('新的細節')]))
  expect(mixed.entries.map((e) => e.why)).toEqual(['等審查', 'detail written'])
  expect(bad(call([{ action: 'remove', step: 's1' }, detail('新的細節')]))).toContain('why')
})

test('why_detail_goes_on_every_entry_of_the_call', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1')]
  const plan = await planOf(base)
  const call = (input: object) => TOOLS.update_step.run(ctxOf(plan), input)
  const added = { action: 'add', item: 'A', title: 'new', detail: D }

  const sealed = good(call({ why: '換做法', why_detail: ' 舊做法太慢，\n改成先建索引 ', ops: [added, { action: 'status', step: 's1', status: 'doing' }] }))
  expect(sealed.entries.map((e) => e.detail)).toEqual(['舊做法太慢，\n改成先建索引', '舊做法太慢，\n改成先建索引'])
  const written = (await replayed(base, sealed)).applied
  expect(written.slice(-2).map((e) => e.detail)).toEqual(['舊做法太慢，\n改成先建索引', '舊做法太慢，\n改成先建索引'])

  expect(bad(call({ why_detail: '補充', ops: [{ action: 'note', step: 's1', note: 'x' }] }))).toBe('why_detail needs a why')
  expect(bad(call({ why_detail: '補充', ops: [added] }))).toBe('why_detail needs a why')
  expect(bad(call({ why: '  ', why_detail: '補充', ops: [added] }))).toBe('why_detail needs a why')
  expect(bad(call({ why: '換做法', why_detail: '換做法。', ops: [added] }))).toBe('why_detail only repeats the why; say what it leaves out')
  expect(bad(call({ why: '換做法', why_detail: 5, ops: [added] }))).toBe('why_detail must be a string')
  for (const blank of [{ why_detail: '  ' }, {}]) {
    const plain = good(call({ why: '換做法', ops: [added], ...blank }))
    expect(Object.hasOwn(plain.entries[0], 'detail')).toBe(false)
  }
  const schema = JSON.stringify(TOOLS.update_step.inputSchema)
  expect(schema).toContain('"why_detail"')
  expect(schema).toContain('"detail"')
})

test('a_detail_that_starts_with_the_title_and_says_more_is_kept', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (title: string, detail: string) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title, detail }] })
  const zh = good(run('窗格兩個畫面', '窗格兩個畫面：上方兩個按鈕切換總表和等你'))
  expect(zh.entries[0].data).toMatchObject({ detail: '窗格兩個畫面：上方兩個按鈕切換總表和等你' })
  expect(await addedDetail(base, zh)).toBe('窗格兩個畫面：上方兩個按鈕切換總表和等你')
  const en = good(run('Pane views', 'Pane views. Two buttons switch between them.'))
  expect(en.entries[0].data).toMatchObject({ detail: 'Pane views. Two buttons switch between them.' })
  expect(await addedDetail(base, en)).toBe('Pane views. Two buttons switch between them.')
})

/** The card the first returned entry opens, as the replayed plan holds it. */
async function openedCard(base: Entry[], result: Extract<ToolResult, { ok: true }>): Promise<Plan['cards'][string]> {
  const id = (result.entries[0].data as { card: { id: string } }).card.id
  return (await replayed(base, result)).cards[id]
}
/** The entries the replayed plan applied from the returned ones, in written order. */
async function writtenEntries(base: Entry[], result: Extract<ToolResult, { ok: true }>): Promise<Entry[]> {
  return (await replayed(base, result)).applied.slice(-result.entries.length)
}

test('add_decision_needs_a_detail_on_every_option', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const opt = (label: string, extra: Record<string, unknown> = {}) => ({ label, effect: `${label} leads on`, detail: OD, ...extra })
  const run = (options: unknown[]) => TOOLS.add_decision.run(ctxOf(plan), { question: 'Where?', why: 'blocks the install step', options })

  expect(bad(run([opt('a'), { label: 'b', effect: 'y' }]))).toBe('options[1].detail is required: what choosing it means in practice')
  expect(bad(run([opt('a', { detail: 3 }), opt('b')]))).toBe('options[0].detail must be a string')
  expect(bad(run([opt('a', { detail: '  ​ ' }), opt('b')]))).toBe('options[0].detail is required: what choosing it means in practice')
  expect(bad(run([opt('a', { detail: 'A leads on.' }), opt('b')]))).toContain('options[0].detail only repeats the effect')
  expect(bad(run([opt('a', { detail: 'A.' }), opt('b')]))).toBe('options[0].detail only repeats the label; say what it leaves out')
  // One option at a time, label then effect then detail: option 0's bad detail comes before option 1's missing effect.
  expect(bad(run([opt('a', { detail: 5 }), { label: 'b' }]))).toBe('options[0].detail must be a string')
  expect(bad(run([{ label: 'a', detail: 5 }, opt('b')]))).toContain('effect')
  expect(bad(run([{ effect: 'x', detail: 5 }, opt('b')]))).toContain('label')

  const written = good(run([opt('a', { detail: ' 選了就\r\n先做 a ' }), opt('b')]))
  const open = written.entries[0]
  if (open.kind !== 'card.open') throw new Error('unreachable')
  expect(open.data.card.options[0].detail).toBe('選了就\n先做 a')
  expect(Object.hasOwn(open, 'detail')).toBe(false)
  const card = await openedCard(base, written)
  expect(card.options.map((o) => o.detail)).toEqual(['選了就\n先做 a', OD])
})

test('add_user_action_needs_a_detail', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (input: object) => TOOLS.add_user_action.run(ctxOf(plan), { action: 'x', why: 'y', ...input })

  expect(bad(run({}))).toBe('detail is required: why the user has to do this and what happens once it is done')
  expect(bad(run({ detail: ' \t ' }))).toBe('detail is required: why the user has to do this and what happens once it is done')
  expect(bad(run({ detail: 'Y.' }))).toBe('detail only repeats the why; say what it leaves out')
  expect(bad(run({ detail: ' x! ' }))).toBe('detail only repeats the action; say what it leaves out')
  expect(bad(run({ detail: 9 }))).toBe('detail must be a string')

  const written = good(run({ detail: '  新的檢查要人核准，\r\n核准後 CI 會重跑 ' }))
  const open = written.entries[0]
  if (open.kind !== 'card.open') throw new Error('unreachable')
  expect(open.data.card.detail).toBe('新的檢查要人核准，\n核准後 CI 會重跑')
  expect(Object.hasOwn(open, 'detail')).toBe(false)
  expect((await openedCard(base, written)).detail).toBe('新的檢查要人核准，\n核准後 CI 會重跑')
})

test('propose_change_takes_an_optional_detail', async () => {
  const base = [entry('item.add', { item: item('design01') })]
  const plan = await planOf(base)
  const changes = [{ kind: 'item.add', data: { item: { title: 'Docs', goal: 'README exists' } } }]
  const run = (extra: object) => TOOLS.propose_change.run(ctxOf(plan), { question: 'Add docs?', why: 'users need them', changes, ...extra })

  const written = good(run({ detail: ' 同意之後多一個項目「文件」 ' }))
  const open = written.entries[0]
  if (open.kind !== 'card.open') throw new Error('unreachable')
  expect(open.data.card.detail).toBe('同意之後多一個項目「文件」')
  expect(Object.hasOwn(open, 'detail')).toBe(false)
  expect((await openedCard(base, written)).detail).toBe('同意之後多一個項目「文件」')
  const plain = good(run({ detail: '**先**看' }))
  expect((plain.entries[0].data as { card: { detail?: string } }).card.detail).toBe('**先**看')
  expect((await openedCard(base, plain)).detail).toBe('**先**看')

  for (const blank of [{}, { detail: '  ' }, { detail: '​﻿' }]) {
    const none = good(run(blank))
    expect(Object.hasOwn((none.entries[0].data as { card: object }).card, 'detail')).toBe(false)
    expect(Object.hasOwn(none.entries[0], 'detail')).toBe(false)
    expect(Object.hasOwn(await openedCard(base, none), 'detail')).toBe(false)
  }

  expect(bad(run({ detail: '中'.repeat(201) }))).toBe(
    'detail is 402 cells wide; keep it within 400 (about 200 Chinese characters). Put the rest in the spec and link it',
  )
  expect(bad(run({ detail: Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n') }))).toBe(
    'detail is 9 lines long; keep it within 8 lines. Put the rest in the spec and link it',
  )
  expect(bad(run({ detail: '影響 design01' }))).toContain('detail names plan ids (design01)')
  expect(bad(run({ detail: 'Add docs' }))).toBe('detail only repeats the question; say what it leaves out')
  expect(bad(run({ detail: 'Users need them!' }))).toBe('detail only repeats the why; say what it leaves out')
  expect(bad(run({ detail: 7 }))).toBe('detail must be a string')
})

test('apply_change_copies_the_card_detail_to_every_entry', async () => {
  const changes = [
    { kind: 'item.add', data: { item: item('X1', 'Docs', 'README exists') } },
    { kind: 'item.add', data: { item: item('X2', 'Guide', 'guide exists') } },
  ]
  const withDetail = [entry('item.add', { item: item('A') }), proposal('p1', changes, { detail: '同意之後多兩個項目' })]
  const applied = good(TOOLS.apply_change.run(ctxOf(await planOf(withDetail), ['p1']), { card: 'p1' }))
  expect(applied.entries.length).toBe(3)
  expect(applied.entries.every((e) => e.detail === '同意之後多兩個項目')).toBe(true)
  expect(applied.entries[2].kind).toBe('card.resolve')
  const written = await writtenEntries(withDetail, applied)
  expect(written.map((e) => [e.kind, e.detail])).toEqual([
    ['item.add', '同意之後多兩個項目'],
    ['item.add', '同意之後多兩個項目'],
    ['card.resolve', '同意之後多兩個項目'],
  ])

  const bare = [entry('item.add', { item: item('A') }), proposal('p1', changes)]
  const plain = good(TOOLS.apply_change.run(ctxOf(await planOf(bare), ['p1']), { card: 'p1' }))
  expect(plain.entries.length).toBe(3)
  expect(plain.entries.some((e) => Object.hasOwn(e, 'detail'))).toBe(false)
  expect((await writtenEntries(bare, plain)).some((e) => Object.hasOwn(e, 'detail'))).toBe(false)
})

test('resolve_tools_take_an_optional_detail', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1'), question('q1')]
  const plan = await planOf(base)
  const resolve = (extra: object) => TOOLS.resolve_decision.run(ctxOf(plan), { card: 'q1', outcome: '選了 LRU', ...extra })

  const decided = good(resolve({ detail: '記憶體夠用，\n之後再看命中率' }))
  expect(decided.entries[0].detail).toBe('記憶體夠用，\n之後再看命中率')
  expect((await writtenEntries(base, decided))[0].detail).toBe('記憶體夠用，\n之後再看命中率')
  expect(bad(resolve({ detail: '選了LRU。' }))).toBe('detail only repeats the outcome; say what it leaves out')
  expect(bad(resolve({ detail: 4 }))).toBe('detail must be a string')
  for (const blank of [{}, { detail: ' \n ' }]) {
    const none = good(resolve(blank))
    expect(Object.hasOwn(none.entries[0], 'detail')).toBe(false)
    expect(Object.hasOwn((await writtenEntries(base, none))[0], 'detail')).toBe(false)
  }

  const tail = (await logText([step('A', 's2')])).replace('"why":"test"', '"why":"edited"')
  const flagged = await planOf(base, tail)
  expect(flagged.flagged.length).toBe(1)
  const edit = (extra: object) => TOOLS.resolve_direct_edit.run(ctxOf(flagged), { action: 'keep', summary: 'added a step', ...extra })
  // resolve_direct_edit takes no detail: its entry is on no item's history, so the pane could never show one.
  // A detail passed anyway is ignored like any other property the tool does not know.
  expect(JSON.stringify(TOOLS.resolve_direct_edit.inputSchema)).not.toContain('"detail"')
  for (const extra of [{}, { detail: ' 手動加的步驟保留，\r\n之後照常更新 ' }, { detail: 'Added a step.' }, { detail: 4 }]) {
    const kept = good(edit(extra))
    expect(kept.entries).toEqual(good(edit({ unknown_field: 'x' })).entries)
    expect(Object.hasOwn(kept.entries[0], 'detail')).toBe(false)
    const after = await replay(await nextText((await logText(base)) + tail, kept.entries, []))
    expect(after.flagged).toEqual([])
    const written = after.applied[after.applied.length - 1]
    expect(written.kind).toBe('edit.keep')
    expect(Object.hasOwn(written, 'detail')).toBe(false)
  }
})

test('an_old_sealed_edit_keep_line_with_a_detail_still_replays', async () => {
  const base = [entry('item.add', { item: item('A') }), step('A', 's1'), question('q1')]
  const tail = (await logText([step('A', 's2')])).replace('"why":"test"', '"why":"edited"')
  const flagged = await planOf(base, tail)
  expect(flagged.flagged.length).toBe(1)
  const kept = good(TOOLS.resolve_direct_edit.run(ctxOf(flagged), { action: 'keep', summary: 'added a step' }))
  // The line an older resolve_direct_edit wrote: the same entry, with a top-level detail.
  const old = { ...kept.entries[0], detail: '手動加的步驟保留，\n之後照常更新' }
  const text = (await logText(base)) + tail + (await sealEntry(old)) + '\n'
  const after = await replay(text)
  expect(after.flagged).toEqual([])
  expect(after.skipped).toEqual([])
  const written = after.applied.find((e) => e.id === old.id)
  expect(written?.kind).toBe('edit.keep')
  expect(written?.detail).toBe('手動加的步驟保留，\n之後照常更新')
})

// The id check (Global Constraints ④) on the ids of steps and cards, not only items, through the tool as the engine calls it.
const LOG = '/repo/plan/log.jsonl'
const ITEM = 'alpha01'
const STEP = 'design02'
const CARD = 'cafe0123'
const idPlan = () => [entry('item.add', { item: item(ITEM, '介面') }), step(ITEM, STEP, '畫草圖'), question(CARD)]

test('a_step_detail_naming_a_step_or_card_id_is_refused_and_writes_nothing', async ($, on) => {
  const w = world(on, { [LOG]: await logText(idPlan()) })
  await $.session.start({ cwd: '/repo' })
  const add = (detail: string) => $.tool.call({ tool: 'mcp__plan-board__update_step', why: '補一步', ops: [{ action: 'add', item: ITEM, title: '定配色', detail }] })

  for (const id of [STEP, CARD]) {
    const before = w.files[LOG]
    const refused = await add(`接著 ${id} 之後再做`)
    expect(refused.deny).toContain(`ops[0].detail names plan ids (${id}); use the names the user sees`)
    expect(w.files[LOG]).toBe(before)
  }
  // Part of a longer word is no id: the same call goes through once the id is not a whole word.
  const before = w.files[LOG]
  expect((await add(`接著 ${STEP}x 之後再做`)).deny).toBeUndefined()
  expect(w.files[LOG].length).toBeGreaterThan(before.length)
})

test('the_id_check_uses_the_plan_as_the_earlier_ops_leave_it', async ($, on) => {
  const w = world(on, { [LOG]: await logText(idPlan()) })
  await $.session.start({ cwd: '/repo' })
  const before = w.files[LOG]
  const res = await $.tool.call({
    tool: 'mcp__plan-board__update_step',
    why: '換做法',
    ops: [
      { action: 'remove', step: STEP },
      { action: 'add', item: ITEM, title: '定配色', detail: `取代原本的 ${STEP}，先定好顏色` },
    ],
  })
  expect(res.deny).toBeUndefined()
  const plan = await replay(w.files[LOG])
  expect(w.files[LOG].startsWith(before)).toBe(true)
  expect(Object.hasOwn(plan.steps, STEP)).toBe(false)
  expect(Object.values(plan.steps).map((s) => s.detail)).toContain(`取代原本的 ${STEP}，先定好顏色`)
})
