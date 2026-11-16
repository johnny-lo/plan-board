import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { world } from './world.ts'
import type { World } from './world.ts'

const LOG = '/repo/plan/log.jsonl'
const ATTRIBUTES = '/repo/.gitattributes'
const ZH = { options: { language: 'zh-TW' } }
const REFUSAL = '"/plan" refused: it is the built-in /plan'
const OD = '選了之後實際會怎麼做'
const tool = (name: string) => `mcp__plan-board__${name}`

/** Lets the hooks' pending promises settle: the staged batch goes out on a timer the test has fired. */
async function until($: Engine, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !isDone(); i++) await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
}

/** A decision card with a choice staged on this machine but not sent, as a reload finds it. */
async function stagedDecision($: Engine, w: World): Promise<string> {
  await $.session.start({ cwd: '/repo' })
  const added = await $.tool.call({
    tool: tool('add_decision'),
    question: 'Which cache?',
    why: 'it matters',
    options: [{ label: 'LRU', effect: 'small', detail: OD }, { label: 'TTL', effect: 'simple', detail: OD }],
  })
  const card = /card (\w{8})/.exec(String(added.result))?.[1] as string
  w.store.set('local:/repo', { staged: { [card]: { choice: 'LRU', at: 1 } }, sent: {}, expanded: [], view: 'overview' })
  return card
}

/** Starts a session whose command registration Claude Code refuses, with a staged choice waiting. */
async function startRefused($: Engine, w: World): Promise<void> {
  await stagedDecision($, w)
  w.toasts.length = 0
  w.failCommands = REFUSAL
  const started = await $.session.start({ cwd: '/repo' })
  // next(e) was called: the engine beneath answered the start.
  expect(started.cwd).toBe('/repo')
}

test('start_registers_planboard_and_not_plan', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  expect(w.commands).toContain('planboard')
  expect(w.commands).not.toContain('plan')
  expect(w.toasts).toEqual([])
})

test('planboard_opens_the_pane', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const ran = await $.command.run({ command: 'planboard' })
  expect(w.opened).toEqual(['plan-board'])
  expect(ran.text).toBe('Plan board opened.')
  await $.command.run({ command: 'planboard', args: '' })
  expect(w.opened).toEqual(['plan-board', 'plan-board'])
  expect(Object.keys(w.files)).toEqual([])
})

test('planboard_init_moves_the_plan_into_the_repo', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/repo' })
  const ran = await $.command.run({ command: 'planboard', args: 'init' })
  expect(w.files[LOG]).toBe('')
  expect(w.files[ATTRIBUTES]).toBe('plan/log.jsonl merge=union\n')
  expect(w.opened).toEqual([])
  expect(ran.text).toContain(`Created an empty plan at ${LOG}; no entries were moved`)
})

test('a_refused_command_still_registers_the_tools_and_resends_staged_choices', async ($, on) => {
  const w = world(on)
  await startRefused($, w)
  expect(w.commands).toEqual(['planboard'])

  // The tools answer: a call reaches the plugin instead of passing through to the engine.
  const res = await $.tool.call({ tool: tool('add_decision'), question: 'q', why: 'w', options: [{ label: 'x', effect: 'y' }] })
  expect(res.deny).toContain('options')

  // The choice staged before the reload still goes out on its own.
  expect(w.submitted).toEqual([])
  w.fireTimer()
  await until($, () => w.submitted.length > 0)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toContain('Which cache? → LRU')
})

test('a_refused_command_is_told_once_in_english_without_the_raw_error', async ($, on) => {
  const w = world(on)
  await startRefused($, w)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('/planboard')
  expect(w.toasts[0]).toContain('could not be registered')
  expect(w.toasts[0]).toContain('pane')
  expect(w.toasts[0]).not.toContain('refused')
  expect(w.toasts[0]).not.toContain('built-in')
})

test('a_refused_command_is_told_once_in_zh_tw_without_the_raw_error', ZH, async ($, on) => {
  const w = world(on)
  await startRefused($, w)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('/planboard')
  expect(w.toasts[0]).toContain('沒能註冊')
  expect(w.toasts[0]).toContain('窗格')
  expect(w.toasts[0]).not.toContain('refused')
  expect(w.toasts[0]).not.toContain('built-in')
})
