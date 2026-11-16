import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { checkLine } from '../hooks/checksum.ts'
import { nextText } from '../hooks/logfile.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'
import { world } from './world.ts'

const LOG = '/repo/plan/log.jsonl'
const D = '說明這一步替使用者做什麼、怎樣算做完'
const OD = '選了之後實際會怎麼做'
const ATTRIBUTES = '/repo/.gitattributes'
const tool = (name: string) => `mcp__plan-board__${name}`
const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })
const seeded = async (...entries: ReturnType<typeof entry>[]) => ({ [LOG]: await logText(entries) })

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const addItem = { kind: 'item.add', data: { item: { title: 'Docs', goal: 'README exists' } } }
const propose = ($: Engine) => $.tool.call({ tool: tool('propose_change'), question: 'Add docs?', why: 'users need them', changes: [addItem] })

async function summaryOf($: Engine): Promise<string> {
  const sections = (await $.prompt.compose(COMPOSE)).sections
  return sections.find(s => s.id === 'plan-board:guide')?.text ?? ''
}

test('first_proposal_creates_log_and_gitattributes', async ($, on) => {
  // An empty plan/log.jsonl is how a repo opts in (/plan init); the tools never create it themselves.
  const w = world(on, { [LOG]: '' })
  await $.session.start({ cwd: '/repo' })
  const res = await propose($)
  expect(res.deny).toBeUndefined()
  const lines = w.files[LOG].split('\n')
  expect(lines.length).toBe(2)
  expect(lines[1]).toBe('')
  expect((await checkLine(lines[0])).isSealed).toBe(true)
  expect(JSON.parse(lines[0]).kind).toBe('card.open')
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')

  await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small', detail: OD }, { label: 'TTL', effect: 'simple', detail: OD }],
  })
  expect(w.files[LOG].split('\n').length).toBe(3)
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')

  w.files[ATTRIBUTES] = 'x'
  await propose($)
  expect(w.files[ATTRIBUTES]).toBe('x\nplan/log.jsonl merge=union\n')
  await propose($)
  expect(w.files[ATTRIBUTES]).toBe('x\nplan/log.jsonl merge=union\n')
})

test('invalid_tool_input_is_denied_and_writes_nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const res = await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small' }],
  })
  expect(res.deny).toContain('options')
  expect(Object.keys(w.files)).toEqual([])
})

test('apply_change_uses_the_local_approval', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const proposed = await propose($)
  const card = /card (\w{8})/.exec(String(proposed.result))?.[1]
  expect(card).toBeDefined()

  const refused = await $.tool.call({ tool: tool('apply_change'), card })
  expect(refused.deny).toContain('not approved')

  w.store.set('local:/repo', { staged: {}, sent: { [card!]: { choice: 'approve', at: 1 } }, expanded: [], view: 'overview' })
  const applied = await $.tool.call({ tool: tool('apply_change'), card })
  expect(applied.deny).toBeUndefined()
  const text = await summaryOf($)
  expect(text).toContain('Docs')
  expect(text).not.toContain('Open cards:')
})

test('edit_and_write_under_plan_are_denied', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const edit = await $.tool.call({ tool: 'Edit', file_path: LOG, old_string: 'a', new_string: 'b' })
  expect(edit.deny).toContain('plan-board tools')
  const write = await $.tool.call({ tool: 'Write', file_path: '\\repo\\plan\\x', content: 'x' })
  expect(write.deny).toContain('plan-board tools')
  const notebook = await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/plan/n.ipynb', new_source: 'x' })
  expect(notebook.deny).toContain('plan-board tools')
  const sneaky = await $.tool.call({ tool: 'Write', file_path: '/repo/src/../plan/x', content: 'x' })
  expect(sneaky.deny).toContain('plan-board tools')

  const other = await $.tool.call({ tool: 'Write', file_path: '/repo/src/a.ts', content: 'x' })
  expect(other.deny).toBeUndefined()
  const sibling = await $.tool.call({ tool: 'Write', file_path: '/repo/planning/a.ts', content: 'x' })
  expect(sibling.deny).toBeUndefined()
  expect(Object.keys(w.files)).toEqual([])
})

test('prompt_compose_adds_guide_and_summary', async ($, on) => {
  world(on, await seeded(entry('item.add', { item: item('A', 'Setup wizard') })))
  await $.session.start({ cwd: '/repo' })
  const sections = (await $.prompt.compose(COMPOSE)).sections
  const section = sections.find(s => s.id === 'plan-board:guide')
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('# Plan board')
  expect(section?.text).toContain('Items:')
  expect(section?.text).toContain('Setup wizard')
  expect(sections.filter(s => s.id === 'plan-board:guide').length).toBe(1)
})

test('concurrent_write_retries_then_fails', async ($, on) => {
  const other = await logText([entry('item.add', { item: item('A', 'Other session') })])
  const w = world(on, { [LOG]: other })
  await $.session.start({ cwd: '/repo' })
  w.statBump = true
  const res = await propose($)
  expect(res.deny).toContain('another session')
  expect(w.files[LOG]).toBe(other)
  expect(ATTRIBUTES in w.files).toBe(false)

  w.statBump = false
  const ours = entry('item.add', { item: item('B', 'Ours') })
  const merged = await nextText(other, [ours], [])
  expect(merged.startsWith(other)).toBe(true)
  expect(merged.split('\n').length).toBe(3)
  const retry = await propose($)
  expect(retry.deny).toBeUndefined()
  expect(w.files[LOG].startsWith(other)).toBe(true)
})

test('prompt_submit_picks_up_pulled_lines', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  expect(await summaryOf($)).toContain('No plan yet')
  w.files[LOG] = await logText([entry('item.add', { item: item('A', 'Pulled item') })])
  await $.prompt.submit({ text: 'hello' })
  expect(w.submitted).toEqual(['hello'])
  expect(await summaryOf($)).toContain('Pulled item')
})

test('calls_in_the_same_millisecond_replay_in_call_order', async ($, on) => {
  const w = world(on, await seeded(entry('item.add', { item: item('A', 'Setup') })))
  w.clockStep = 0
  await $.session.start({ cwd: '/repo' })
  const added = await $.tool.call({ tool: tool('update_step'), why: 'plan', ops: [{ action: 'add', item: 'A', title: 'first', detail: D }] })
  const stepId = /step (\w{8})/.exec(String(added.result))?.[1]
  expect(stepId).toBeDefined()
  for (let i = 1; i <= 8; i++) {
    const edit = await $.tool.call({ tool: tool('update_step'), why: 'rename', ops: [{ action: 'edit', step: stepId, title: `title ${i}` }] })
    expect(edit.deny).toBeUndefined()
  }
  const text = await summaryOf($)
  expect(text).toContain('title 8')
  expect(text).not.toContain('Skipped entries:')
  const ats = w.files[LOG].split('\n').filter(Boolean).map(l => JSON.parse(l).at as string)
  expect(new Set(ats).size).toBe(ats.length)
  expect(ats).toEqual([...ats].sort())
})

test('a_failed_gitattributes_write_does_not_undo_the_entries', async ($, on) => {
  const w = world(on, { [LOG]: '' })
  w.failWrites = '.gitattributes'
  await $.session.start({ cwd: '/repo' })
  const res = await propose($)
  expect(res.deny).toBeUndefined()
  expect(String(res.result)).toContain('Proposed card')
  expect(String(res.result)).toContain('.gitattributes')
  expect(w.files[LOG].split('\n').filter(Boolean).length).toBe(1)
  expect(ATTRIBUTES in w.files).toBe(false)
  // The entries were committed: the plugin already knows the card.
  expect(await summaryOf($)).toContain('Add docs?')
})

test('a_refused_detail_writes_nothing', async ($, on) => {
  const w = world(on, await seeded(entry('item.add', { item: item('A', 'Setup') })))
  await $.session.start({ cwd: '/repo' })
  const before = w.files[LOG]
  const refused = await $.tool.call({ tool: tool('update_step'), why: 'plan', ops: [{ action: 'add', item: 'A', title: 'first' }] })
  expect(String(refused.deny)).toContain('ops[0].detail is required')
  expect(w.files[LOG]).toBe(before)
  const allowed = await $.tool.call({ tool: tool('update_step'), why: 'plan', ops: [{ action: 'add', item: 'A', title: 'first', detail: D }] })
  expect(allowed.deny).toBeUndefined()
  const plan = await replay(w.files[LOG])
  expect(Object.values(plan.steps).find((s) => s.title === 'first')?.detail).toBe(D)
})

test('a_refused_card_or_resolution_detail_writes_nothing', async ($, on) => {
  const w = world(
    on,
    await seeded(
      entry('item.add', { item: item('A', 'Setup') }),
      entry('card.open', {
        card: { id: 'q1', type: 'question', question: 'Which cache?', why: 'w', options: [{ label: 'LRU', effect: 'small' }, { label: 'TTL', effect: 'simple' }] },
      }),
    ),
  )
  await $.session.start({ cwd: '/repo' })
  const before = w.files[LOG]
  const refusals: [Record<string, unknown>, string][] = [
    [
      { tool: tool('add_decision'), question: 'Which port?', why: 'it matters', options: [{ label: '80', effect: 'default', detail: OD }, { label: '8080', effect: 'no root' }] },
      'options[1].detail is required: what choosing it means in practice',
    ],
    [{ tool: tool('add_user_action'), action: 'Log in to GitHub', why: 'the push needs it' }, 'detail is required: why the user has to do this'],
    [{ tool: tool('propose_change'), question: 'Add docs?', why: 'users need them', changes: [addItem], detail: 'Users need them.' }, 'detail only repeats the why'],
    [{ tool: tool('resolve_decision'), card: 'q1', outcome: 'LRU', detail: 'lru' }, 'detail only repeats the outcome'],
  ]
  for (const [input, message] of refusals) {
    const refused = await $.tool.call(input as Parameters<Engine['tool']['call']>[0])
    expect(String(refused.deny)).toContain(message)
    expect(w.files[LOG]).toBe(before)
  }
  const allowed = await $.tool.call({ tool: tool('resolve_decision'), card: 'q1', outcome: 'LRU', detail: '記憶體夠用，之後再看命中率' })
  expect(allowed.deny).toBeUndefined()
  const plan = await replay(w.files[LOG])
  expect(plan.cards.q1.resolved?.outcome).toBe('LRU')
  expect(plan.applied[plan.applied.length - 1].detail).toBe('記憶體夠用，之後再看命中率')
})

const withStep = () =>
  seeded(
    entry('item.add', { item: item('A', 'Setup') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'Old title' } }),
    entry('step.detail', { step: 's1', detail: 'The first explanation' }),
  )

test('a_second_detail_op_with_the_same_text_in_one_call_is_refused', async ($, on) => {
  const w = world(on, await withStep())
  await $.session.start({ cwd: '/repo' })
  const before = w.files[LOG]
  const detail = { action: 'detail', step: 's1', detail: 'Another explanation' }
  const refused = await $.tool.call({ tool: tool('update_step'), why: 'clarify', ops: [detail, detail] })
  expect(String(refused.deny)).toContain('step s1 already has this detail')
  expect(w.files[LOG]).toBe(before)
  // One detail op alone is written, so the refusal above came from the op before it in the same call.
  const once = await $.tool.call({ tool: tool('update_step'), why: 'clarify', ops: [detail] })
  expect(once.deny).toBeUndefined()
  expect((await replay(w.files[LOG])).steps.s1.detail).toBe('Another explanation')
})

test('a_detail_that_repeats_a_title_renamed_earlier_in_the_call_is_refused', async ($, on) => {
  const w = world(on, await withStep())
  await $.session.start({ cwd: '/repo' })
  const before = w.files[LOG]
  const refused = await $.tool.call({
    tool: tool('update_step'),
    why: 'rename',
    ops: [
      { action: 'edit', step: 's1', title: 'New title' },
      { action: 'detail', step: 's1', detail: 'New title.' },
    ],
  })
  expect(String(refused.deny)).toContain('ops[1].detail only repeats the title; say what it leaves out')
  expect(w.files[LOG]).toBe(before)
  // Against the old title the same text says more, so it is the rename that makes it a repeat.
  const alone = await $.tool.call({ tool: tool('update_step'), why: 'rename', ops: [{ action: 'detail', step: 's1', detail: 'New title.' }] })
  expect(alone.deny).toBeUndefined()
  const plan = await replay(w.files[LOG])
  expect(plan.steps.s1).toMatchObject({ title: 'Old title', detail: 'New title.' })
})
