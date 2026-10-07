import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { checkLine } from '../hooks/checksum.ts'
import { GUIDE } from '../hooks/guide.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'
import { world } from './world.ts'
import type { World } from './world.ts'

const LOG = '/repo/plan/log.jsonl'
const ATTRIBUTES = '/repo/.gitattributes'
const STORED = 'log:/repo'
const REPO_LINE = 'Plan storage: repo (plan/log.jsonl)'
const LOCAL_LINE = 'Plan storage: this machine only (run /plan init to keep it in the repo)'
const ZH = { options: { language: 'zh-TW' } }
const ID = /[0-9a-f]{8}/
const tool = (name: string) => `mcp__plan-board__${name}`
const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const
const addItem = { kind: 'item.add', data: { item: { title: 'Docs', goal: 'README exists' } } }
const propose = ($: Engine) => $.tool.call({ tool: tool('propose_change'), question: 'Add docs?', why: 'users need them', changes: [addItem] })

async function summaryOf($: Engine): Promise<string> {
  const sections = (await $.prompt.compose(COMPOSE)).sections
  return sections.find(s => s.id === 'plan-board:guide')?.text ?? ''
}

const storedText = (w: World): string => String(w.store.get(STORED) ?? '')
const storedLines = (w: World): string[] => storedText(w).split('\n').filter(Boolean)

test('local_mode_keeps_the_log_in_the_store_and_never_creates_plan', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  expect(await summaryOf($)).toContain(`\n\n${LOCAL_LINE}\n`)

  const res = await propose($)
  expect(res.deny).toBeUndefined()
  const lines = storedLines(w)
  expect(lines.length).toBe(1)
  expect(storedText(w).endsWith('\n')).toBe(true)
  expect((await checkLine(lines[0])).isSealed).toBe(true)
  expect(JSON.parse(lines[0]).kind).toBe('card.open')
  expect(await summaryOf($)).toContain('Add docs?')

  await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small' }, { label: 'TTL', effect: 'simple' }],
  })
  expect(storedLines(w).length).toBe(2)
  await $.prompt.submit({ text: 'hello' })
  await $.session.start({ cwd: '/repo' })
  // Neither plan/ nor .gitattributes appeared anywhere.
  expect(Object.keys(w.files)).toEqual([])
})

test('every_tool_works_in_local_mode', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const proposed = await propose($)
  const card = /card (\w{8})/.exec(String(proposed.result))?.[1] as string
  const applied = await $.tool.call({ tool: tool('apply_change'), card, chat: 'yes please' })
  expect(applied.deny).toBeUndefined()
  const itemId = Object.keys((await replay(storedText(w))).items)[0]

  const steps = await $.tool.call({
    tool: tool('update_step'),
    why: 'plan the work',
    ops: [
      { action: 'add', item: itemId, title: 'write README' },
      { action: 'link', item: itemId, doc: 'docs/superpowers/plans/docs.md' },
    ],
  })
  expect(steps.deny).toBeUndefined()
  const asked = await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which language?',
    why: 'it matters',
    options: [{ label: 'en', effect: 'English' }, { label: 'zh', effect: 'Chinese' }],
  })
  const question = /card (\w{8})/.exec(String(asked.result))?.[1] as string
  const closed = await $.tool.call({ tool: tool('resolve_decision'), card: question, outcome: 'en' })
  expect(closed.deny).toBeUndefined()

  const plan = await replay(storedText(w))
  expect(plan.flagged).toEqual([])
  expect(plan.skipped).toEqual([])
  expect(plan.items[itemId].docs).toEqual(['docs/superpowers/plans/docs.md'])
  expect(plan.items[itemId].steps.length).toBe(1)
  expect(plan.cards[question].resolved?.outcome).toBe('en')
  expect(Object.keys(w.files)).toEqual([])
})

test('mode_is_decided_on_every_read', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  await propose($)
  expect(await summaryOf($)).toContain(LOCAL_LINE)
  expect(await summaryOf($)).toContain('Add docs?')

  // Someone makes plan/log.jsonl: the next read is the repo's, and the stored text is left alone.
  const stored = storedText(w)
  w.files[LOG] = await logText([entry('item.add', { item: item('A', 'From the repo') })])
  await $.prompt.submit({ text: 'hello' })
  const inRepo = await summaryOf($)
  expect(inRepo).toContain(`\n\n${REPO_LINE}\n`)
  expect(inRepo).toContain('From the repo')
  expect(inRepo).not.toContain('Add docs?')
  const written = await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small' }, { label: 'TTL', effect: 'simple' }],
  })
  expect(written.deny).toBeUndefined()
  expect(w.files[LOG].split('\n').filter(Boolean).length).toBe(2)
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(storedText(w)).toBe(stored)

  // And when it is gone again, so is the repo's plan.
  delete w.files[LOG]
  await $.prompt.submit({ text: 'hello' })
  const back = await summaryOf($)
  expect(back).toContain(LOCAL_LINE)
  expect(back).toContain('Add docs?')
  expect(back).not.toContain('From the repo')
})

test('repo_mode_does_not_recreate_a_log_that_vanished_mid_call', async ($, on) => {
  const w = world(on, { [LOG]: await logText([entry('item.add', { item: item('A', 'Setup') })]) })
  await $.session.start({ cwd: '/repo' })
  // The file is there when the call starts and gone when the write would happen.
  w.onStoreGet = () => {
    delete w.files[LOG]
    w.onStoreGet = null
  }
  const res = await propose($)
  expect(res.deny).toBeDefined()
  expect(LOG in w.files).toBe(false)
  expect(ATTRIBUTES in w.files).toBe(false)
})

test('local_mode_concurrent_write_retries_then_fails', async ($, on) => {
  const w = world(on)
  const others: string[] = []
  for (let i = 0; i < 12; i++) others.push(await logText([entry('item.add', { item: item(`0${i.toString(16)}0${i.toString(16)}0000`, `Other ${i}`) })]))
  const first = others.shift() as string
  w.store.set(STORED, first)
  await $.session.start({ cwd: '/repo' })

  // Another session appends at every read; our write must never replace what it wrote.
  w.onStoreGet = key => {
    if (key === STORED && others.length > 0) w.store.set(key, storedText(w) + others.shift())
  }
  const res = await propose($)
  expect(res.deny).toContain('another session')
  w.onStoreGet = null
  expect(storedText(w)).not.toContain('card.open')
  expect(storedText(w).startsWith(first)).toBe(true)
  expect(storedLines(w).length).toBeGreaterThan(1)

  const retry = await propose($)
  expect(retry.deny).toBeUndefined()
  expect(storedText(w).startsWith(first)).toBe(true)
  expect(storedLines(w).at(-1)).toContain('card.open')
})

test('plan_init_moves_the_local_log_into_the_repo_unchanged', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  await propose($)
  await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small' }, { label: 'TTL', effect: 'simple' }],
  })
  const text = storedText(w)
  expect(text).not.toBe('')
  w.files[ATTRIBUTES] = '* text=auto'

  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe(text)
  expect(w.store.has(STORED)).toBe(false)
  expect(w.files[ATTRIBUTES]).toBe('* text=auto\nplan/log.jsonl merge=union\n')
  expect(w.opened).toEqual([])
  expect(ran.text).toBeDefined()
  expect(ran.text).toContain('plan/log.jsonl')
  expect(ran.text).not.toMatch(ID)
  expect(ran.text).not.toContain('\n')

  const after = await summaryOf($)
  expect(after).toContain(`\n\n${REPO_LINE}\n`)
  expect(after).toContain('Add docs?')
  expect(after).toContain('Which cache?')

  // From now on writes go to the repo.
  await propose($)
  expect(w.files[LOG].startsWith(text)).toBe(true)
  expect(w.files[LOG].split('\n').filter(Boolean).length).toBe(3)
  expect(w.store.has(STORED)).toBe(false)
})

test('plan_init_without_a_local_plan_creates_an_empty_repo_log', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe('')
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(ran.text).toContain('plan/log.jsonl')
  expect(await summaryOf($)).toContain(REPO_LINE)
})

test('plan_init_in_a_repo_with_a_log_changes_nothing_and_says_so', async ($, on) => {
  const text = await logText([entry('item.add', { item: item('A', 'Setup') })])
  const w = world(on, { [LOG]: text })
  w.store.set(STORED, 'left over\n')
  await $.session.start({ cwd: '/repo' })
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe(text)
  expect(ATTRIBUTES in w.files).toBe(false)
  expect(w.store.get(STORED)).toBe('left over\n')
  expect(w.opened).toEqual([])
  expect(ran.text).toContain('already')
  expect(ran.text).toContain('nothing changed')
  expect(ran.text).not.toMatch(ID)
})

test('plan_init_answers_in_zh_tw', ZH, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  await propose($)
  const made = await $.command.run({ command: 'plan', args: 'init' })
  expect(made.text).toContain('plan/log.jsonl')
  expect(made.text).not.toMatch(/[a-z]{4,} [a-z]{4,}/)
  expect(made.text).not.toMatch(ID)
  expect(w.files[LOG]).not.toBe('')
  const again = await $.command.run({ command: 'plan', args: 'init' })
  expect(again.text).toContain('什麼都沒改')
})

test('plain_plan_still_opens_the_pane', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  await $.command.run({ command: 'plan' })
  expect(w.opened).toEqual(['plan-board'])
  await $.command.run({ command: 'plan', args: '' })
  expect(w.opened).toEqual(['plan-board', 'plan-board'])
  expect(Object.keys(w.files)).toEqual([])
})

test('guide_tells_the_model_to_ask_before_plan_init_and_to_link_superpowers_docs', () => {
  expect(GUIDE).toContain('ask the user with add_decision before suggesting /plan init')
  expect(GUIDE).toContain('never create plan/ yourself')
  expect(GUIDE).toContain('superpowers')
  expect(GUIDE).toContain('action link')
  expect(GUIDE).toContain('as a step')
  expect(GUIDE).toContain('done')
})
