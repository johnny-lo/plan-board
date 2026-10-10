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

test('local_write_follows_a_plan_init_that_ran_after_the_read', async ($, on) => {
  const w = world(on)
  const moved = await logText([entry('item.add', { item: item('B', 'Moved') })])
  w.store.set(STORED, await logText([entry('item.add', { item: item('A', 'Stored') })]))
  await $.session.start({ cwd: '/repo' })

  // Another session's /plan init lands after this call has read the plan, just before the write.
  let gets = 0
  w.onStoreGet = key => {
    if (key !== STORED || ++gets !== 2) return
    w.files[LOG] = moved
    w.store.delete(STORED)
  }
  const res = await propose($)
  expect(res.deny).toBeUndefined()
  const lines = w.files[LOG].split('\n').filter(Boolean)
  expect(w.files[LOG].startsWith(moved)).toBe(true)
  expect(lines.length).toBe(2)
  expect(JSON.parse(lines[1]).kind).toBe('card.open')
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(w.store.has(STORED)).toBe(false)
})

test('local_write_checks_the_mode_again_on_every_attempt', async ($, on) => {
  const w = world(on)
  const seen = await logText([entry('item.add', { item: item('A', 'Stored') })])
  const other = await logText([entry('item.add', { item: item('C', 'Other') })])
  w.store.set(STORED, seen)
  await $.session.start({ cwd: '/repo' })

  // The first attempt sees the stored log change; plan/log.jsonl only appears before the second one.
  let gets = 0
  w.onStoreGet = key => {
    if (key !== STORED) return
    gets += 1
    if (gets === 3) w.store.set(STORED, seen + other)
    if (gets === 4) {
      w.files[LOG] = seen + other
      w.store.delete(STORED)
    }
  }
  const res = await propose($)
  expect(res.deny).toBeUndefined()
  const lines = w.files[LOG].split('\n').filter(Boolean)
  expect(w.files[LOG].startsWith(seen + other)).toBe(true)
  expect(lines.length).toBe(3)
  expect(JSON.parse(lines[2]).kind).toBe('card.open')
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(w.store.has(STORED)).toBe(false)
})

test('plan_init_adds_the_lines_the_local_log_gained_before_deleting_it', async ($, on) => {
  const w = world(on)
  const [one, two, three, four] = await Promise.all(
    ['One', 'Two', 'Three', 'Four'].map(title => logText([entry('item.add', { item: item(title, title) })])),
  )
  w.store.set(STORED, one + two)
  await $.session.start({ cwd: '/repo' })

  // Between the copy and the delete the local log gains two lines, and plan/log.jsonl gains one of them.
  let gets = 0
  w.onStoreGet = key => {
    if (key !== STORED || ++gets !== 2) return
    w.store.set(STORED, one + two + three + four)
    w.files[LOG] += four
  }
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe(one + two + four + three)
  expect(w.store.has(STORED)).toBe(false)
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(ran.text).toContain('moved into the repo')
  expect(ran.text).not.toMatch(ID)
  expect(ran.text).not.toContain('\n')
})

// Another session keeps writing to the local log, so each of the 3 checks after the copy finds it different.
async function initWhileStoredLogKeepsChanging($: Engine, w: World, before: () => void = () => {}): Promise<{ lines: string[]; text: string }> {
  const lines = await Promise.all(
    ['One', 'Two', 'Three', 'Four', 'Five'].map(title => logText([entry('item.add', { item: item(title, title) })])),
  )
  w.store.set(STORED, lines[0])
  await $.session.start({ cwd: '/repo' })
  let gets = 0
  w.onStoreGet = key => {
    if (key !== STORED) return
    gets += 1
    if (gets >= 2 && gets <= 4) w.store.set(STORED, lines.slice(0, gets).join(''))
  }
  before()
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  return { lines, text: ran.text as string }
}

test('plan_init_keeps_the_local_log_while_another_session_keeps_writing', async ($, on) => {
  const w = world(on)
  const { lines, text } = await initWhileStoredLogKeepsChanging($, w)
  expect(w.store.get(STORED)).toBe(lines.slice(0, 4).join(''))
  expect(w.files[LOG]).toBe(lines.slice(0, 4).join(''))
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(text).toContain('moved into plan/log.jsonl')
  expect(text).toContain('another session kept writing')
  expect(text).toContain('kept')
  expect(text).not.toMatch(ID)
  expect(text).not.toContain('\n')
})

test('plan_init_keeps_the_local_log_while_another_session_keeps_writing_in_zh_tw', ZH, async ($, on) => {
  const w = world(on)
  const { lines, text } = await initWhileStoredLogKeepsChanging($, w)
  expect(w.store.get(STORED)).toBe(lines.slice(0, 4).join(''))
  expect(w.files[LOG]).toBe(lines.slice(0, 4).join(''))
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(text).toContain('計畫已搬進 plan/log.jsonl')
  expect(text).toContain('別的 session 一直在寫本機那份')
  expect(text).toContain('先留著沒刪')
  expect(text).not.toMatch(ID)
  expect(text).not.toContain('\n')
})

test('plan_init_keeps_a_line_that_lands_in_plan_log_between_its_merge_read_and_write', async ($, on) => {
  const w = world(on)
  const [one, two, three] = await Promise.all(
    ['One', 'Two', 'Three'].map(title => logText([entry('item.add', { item: item(title, title) })])),
  )
  w.store.set(STORED, one)
  await $.session.start({ cwd: '/repo' })

  // The local log gains a line after the copy; another session appends to plan/log.jsonl right after init reads it to merge.
  let gets = 0
  w.onStoreGet = key => {
    if (key !== STORED || ++gets !== 2) return
    w.store.set(STORED, one + two)
    w.onRead = path => {
      if (path !== LOG) return
      w.onRead = null
      w.files[LOG] += three
    }
  }
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe(one + three + two)
  expect(w.store.has(STORED)).toBe(false)
  expect(ran.text).toContain('moved into the repo')
})

test('plan_init_tells_about_gitattributes_when_it_keeps_the_local_log_and_that_fails_too', async ($, on) => {
  const w = world(on)
  const { lines, text } = await initWhileStoredLogKeepsChanging($, w, () => { w.failWrites = '.gitattributes' })
  expect(w.store.get(STORED)).toBe(lines.slice(0, 4).join(''))
  expect(w.files[LOG]).toBe(lines.slice(0, 4).join(''))
  expect(ATTRIBUTES in w.files).toBe(false)
  expect(text).toContain('another session kept writing')
  expect(text).toContain('plan/log.jsonl merge=union')
  expect(text).not.toMatch(ID)
  expect(text).not.toContain('\n')
})

test('plan_init_tells_about_gitattributes_when_it_keeps_the_local_log_and_that_fails_too_in_zh_tw', ZH, async ($, on) => {
  const w = world(on)
  const { text } = await initWhileStoredLogKeepsChanging($, w, () => { w.failWrites = '.gitattributes' })
  expect(text).toContain('別的 session 一直在寫本機那份')
  expect(text).toContain('plan/log.jsonl merge=union')
  expect(text).not.toMatch(ID)
  expect(text).not.toContain('\n')
})

async function initThatCannotWrite($: Engine, w: World): Promise<string> {
  w.store.set(STORED, await logText([entry('item.add', { item: item('A', 'Stored') })]))
  const before = storedText(w)
  await $.session.start({ cwd: '/repo' })
  w.failWrites = 'log.jsonl'
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(storedText(w)).toBe(before)
  expect(LOG in w.files).toBe(false)
  expect(ran.text).not.toContain('read-only')
  expect(ran.text).not.toContain('Could not create')
  expect(ran.text).not.toMatch(ID)
  expect(ran.text).not.toContain('\n')
  return ran.text as string
}

test('plan_init_says_nothing_changed_when_plan_log_cannot_be_written', async ($, on) => {
  const text = await initThatCannotWrite($, world(on))
  expect(text).toContain('Could not move the plan')
  expect(text).toContain('nothing was changed')
  expect(text).toContain('still on this machine')
})

test('plan_init_says_nothing_changed_when_plan_log_cannot_be_written_in_zh_tw', ZH, async ($, on) => {
  const text = await initThatCannotWrite($, world(on))
  expect(text).toContain('什麼都沒改')
  expect(text).toContain('計畫還在這台電腦')
})

async function initWhoseDeleteFails($: Engine, w: World): Promise<string> {
  const stored = await logText([entry('item.add', { item: item('A', 'Stored') })])
  w.store.set(STORED, stored)
  await $.session.start({ cwd: '/repo' })
  w.failDeletes = true
  const ran = await $.command.run({ command: 'plan', args: 'init' })
  expect(w.files[LOG]).toBe(stored)
  expect(storedText(w)).toBe(stored)
  expect(ran.text).not.toContain('locked')
  expect(ran.text).not.toContain('Could not create')
  expect(ran.text).not.toMatch(ID)
  expect(ran.text).not.toContain('\n')
  return ran.text as string
}

test('plan_init_says_the_local_copy_is_still_there_when_a_later_step_fails', async ($, on) => {
  const text = await initWhoseDeleteFails($, world(on))
  expect(text).toContain('moved into plan/log.jsonl')
  expect(text).toContain('copy on this machine is still there')
})

test('plan_init_says_the_local_copy_is_still_there_when_a_later_step_fails_in_zh_tw', ZH, async ($, on) => {
  const text = await initWhoseDeleteFails($, world(on))
  expect(text).toContain('計畫已搬進 plan/log.jsonl')
  expect(text).toContain('本機那份還留著')
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
