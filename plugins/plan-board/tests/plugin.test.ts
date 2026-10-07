import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { checkLine } from '../hooks/checksum.ts'
import { nextText } from '../hooks/logfile.ts'
import { entry, logText } from './fixtures.ts'
import { world } from './world.ts'

const LOG = '/repo/plan/log.jsonl'
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
    options: [{ label: 'LRU', effect: 'small' }, { label: 'TTL', effect: 'simple' }],
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
  const added = await $.tool.call({ tool: tool('update_step'), why: 'plan', ops: [{ action: 'add', item: 'A', title: 'first' }] })
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
