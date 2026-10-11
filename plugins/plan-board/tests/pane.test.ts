import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { hasKey, keysOf, t } from '../hooks/i18n.ts'
import { historyLines, stamp } from '../hooks/lines.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'
import { world } from './world.ts'
import type { World } from './world.ts'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
const SCROLL = { offset: 0, bodyRows: 10 }
const PANE_PROPS = { title: 'Plan board', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: SCROLL, view: {} } as const
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: SCROLL, view: {} }
const ZH = { options: { language: 'zh-TW' } }

const LOG = '/repo/plan/log.jsonl'
const LOCAL = 'local:/repo'
const tool = (name: string) => `mcp__plan-board__${name}`
const ID = /[0-9a-f]{8}/
/** What the engine itself draws in the band when the plugin passes. */
const ENGINE_BAND = { type: 'Text', children: ['engine band'] } as const

// Ids only ever sit in keys and in what the model reads; every title and sentence is Chinese.
const A = 'a1a1a1a1'
const B = 'b2b2b2b2'
const C = 'c3c3c3c3'
const D = 'd4d4d4d4'
const S0 = '50505050'
const S1 = '51515151'
const S2 = '52525252'
const S3 = '53535353'
/** An assignee that is a Thoth task id: 26 characters of Crockford base32. */
const ULID = '01jf0e1d2c3b4a59687f0e1d2c'
const SPEC = 'docs/superpowers/specs/2026-10-07-plan-board-design.md'
const PLAN = 'docs/superpowers/plans/2026-10-07-plan-board.md'
const LOCAL_LINE = '這個計畫只存在這台電腦；在 repo 裡打 /plan init 才會跟著 git 走'
const Q0 = 'e0e0e0e0'
const Q1 = 'e1e1e1e1'
const Q2 = 'e2e2e2e2'
const P1 = 'f1f1f1f1'

const item = (id: string, title: string, goal: string) => ({ id, title, goal })
const question = (id: string, extra: Record<string, unknown> = {}) =>
  entry('card.open', {
    card: {
      id,
      type: 'question',
      question: '輸入框上方要不要顯示做完的數量？',
      why: '一列只放得下兩三件事',
      options: [
        { label: '不顯示', effect: '一列保持短', recommended: true, reason: '做完的在總表看' },
        { label: '顯示', effect: '一眼看到進度' },
      ],
      ...extra,
    },
  })

/** B is in progress (S1 done by Thoth, S2 doing), C is next, D later. */
const board = () => [
  entry('item.add', { item: item(B, '決定看板 v1', '總表和卡片都看得到') }),
  entry('item.add', { item: item(C, '設定精靈', '第一次打開就能用') }),
  entry('item.add', { item: item(D, '英文文件', 'README 有英文版') }),
  entry('step.add', { item: B, step: { id: S1, title: '定檔案格式' } }),
  entry('step.add', { item: B, step: { id: S2, title: '窗格兩個畫面' } }),
  entry('step.status', { step: S1, status: 'done' }, { basis: { type: 'thoth', task: 'T1' }, why: '面板測試全過' }),
  entry('step.status', { step: S2, status: 'doing' }),
]
const blockedOnS2 = () => question(Q1, { item: B, step: S2 })
const loose = () => question(Q2, { question: '要不要加英文文件？', why: '使用者之前提過', options: [{ label: '加', effect: '多一份文件' }, { label: '不加', effect: '先不做' }] })

async function start($: Engine, on: Parameters<typeof world>[0], entries: ReturnType<typeof entry>[] | null, extra = ''): Promise<World> {
  const w = world(on, entries === null ? {} : { [LOG]: (await logText(entries)) + extra })
  on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_BAND)
  await $.session.start({ cwd: '/repo' })
  return w
}

/** A repo without plan/: the log is the text this machine keeps in the store. */
async function startLocal($: Engine, on: Parameters<typeof world>[0], entries: ReturnType<typeof entry>[]): Promise<World> {
  const w = world(on)
  w.store.set('log:/repo', await logText(entries))
  on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_BAND)
  await $.session.start({ cwd: '/repo' })
  return w
}

/** This machine's pane state back to nothing: a second surface starts from the same place as the first. */
async function fresh($: Engine, w: World): Promise<void> {
  w.store.delete(LOCAL)
  await $.prompt.submit({ text: '' })
  w.submitted.length = 0
}

const pane = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'plan-board', surface, component: 'Pane', requestId: 'plan-board', props: PANE_PROPS })
const band = ($: Engine, surface: Surface, props: Record<string, unknown> = BAND_PROPS) =>
  $.ui.mount({ plugin: 'plan-board', surface, component: 'AbovePrompt', props: props as never })

type Ui = Awaited<ReturnType<typeof pane>>

// The plugin sends without waiting; each find is a round trip that lets that work finish.
async function until(ui: Ui, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !isDone(); i++) await ui.find({ key: 'nothing-has-this-key' })
}

const localOf = (w: World) => w.store.get(LOCAL) as { staged: Record<string, unknown>; sent: Record<string, { choice?: string }>; expanded: string[]; view: string }

async function texts(ui: Ui): Promise<string[]> {
  return [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(found => found.text)
}

test('overview_shows_states_and_expands_item', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Button', text: '▸ 設定精靈 · 下一個' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '▸ 決定看板 v1 · 進行中 ⚑' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '▸ 英文文件 · 之後' })).toBeDefined()
    expect(await ui.find({ text: '做完的樣子：總表和卡片都看得到' })).toBeUndefined()

    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ type: 'Button', text: '▾ 決定看板 v1 · 進行中 ⚑' })).toBeDefined()
    expect(await ui.find({ text: '做完的樣子：總表和卡片都看得到' })).toBeDefined()
    expect(await ui.find({ text: '✓ 定檔案格式' })).toBeDefined()
    expect(await ui.find({ text: 'Thoth pass' })).toBeDefined()
    expect(await ui.find({ text: '⚑ 窗格兩個畫面' })).toBeDefined()
    expect(await ui.find({ text: '等你決定：輸入框上方要不要顯示做完的數量？' })).toBeDefined()
    expect(await ui.find({ text: '── 變動紀錄 ──' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^原因：面板測試全過/ })).toBeDefined()
    expect(localOf(w).expanded).toEqual([B])

    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ text: '做完的樣子：總表和卡片都看得到' })).toBeUndefined()
    await ui.unmount()
  }
})

test('cards_view_expands_only_the_first', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你決定（2）' })).toBeDefined()
    await ui.press({ key: 'view:cards' })
    expect(localOf(w).view).toBe('cards')

    expect(await ui.find({ text: '為什麼現在問：一列只放得下兩三件事' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '決定看板 v1 · 第 1 項 · 卡在「窗格兩個畫面」' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${Q1}:0` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${Q1}:1` })).toBeDefined()
    expect(await ui.find({ text: '（建議）' })).toBeDefined()
    expect(await ui.find({ key: `${Q1}:note` })).toBeDefined()
    expect(await ui.find({ key: `${Q1}:x` })).toBeDefined()

    // The second card: its question and where it sits, nothing else.
    expect(await ui.find({ text: '要不要加英文文件？' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '其他' })).toBeDefined()
    expect(await ui.find({ text: '為什麼現在問：使用者之前提過' })).toBeUndefined()
    expect(await ui.find({ key: `${Q2}:0` })).toBeUndefined()

    await ui.press({ key: `card:${Q2}` })
    expect(await ui.find({ text: '為什麼現在問：使用者之前提過' })).toBeDefined()
    expect(await ui.find({ key: `${Q2}:0` })).toBeDefined()
    expect(await ui.find({ key: `${Q2}:note` })).toBeDefined()
    await ui.unmount()
  }
})

test('proposal_card_lists_changes_and_approve_is_staged', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    w.submitted.length = 0
    const proposed = await $.tool.call({
      tool: tool('propose_change'),
      question: '要加英文文件嗎？',
      why: '使用者需要英文版',
      changes: [{ kind: 'item.add', data: { item: { title: '英文文件', goal: 'README 有英文版' } } }],
    })
    const card = /card (\w{8})/.exec(String(proposed.result))?.[1] as string
    expect(card).toBeDefined()

    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ key: `${card}:approve`, text: '同意' })).toBeDefined()
    expect(await ui.find({ key: `${card}:reject`, text: '不要' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /項目 新增「英文文件」/ })).toBeDefined()

    await ui.press({ key: `${card}:approve` })
    expect(w.submitted).toEqual([])
    expect(await ui.find({ key: 'send', text: '送出 1 個決定' })).toBeDefined()
    expect(await ui.find({ text: '已選：同意（待送出）' })).toBeDefined()

    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain('→ approve (call apply_change')
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect(await ui.find({ key: `${card}:approve` })).toBeUndefined()

    const applied = await $.tool.call({ tool: tool('apply_change'), card })
    expect(applied.deny).toBeUndefined()
    expect(await ui.find({ text: '✓ 目前沒有待你決定的事' })).toBeDefined()
    await ui.unmount()
  }
})

test('blocking_card_sends_at_once', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const added = await $.tool.call({
      tool: tool('add_decision'),
      question: 'Install where?',
      why: '要先知道裝在哪',
      options: [{ label: 'Here', effect: '在這個 repo' }, { label: 'There', effect: '在另一個 repo' }],
      blocking: true,
    })
    const id = /card (\w{8})/.exec(String(added.result))?.[1] as string
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `${id}:1` })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain('Decision made for "Install where?"')
    expect(w.submitted[0]).toContain(']: There')
    expect(localOf(w).sent[id].choice).toBe('There')
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()

    // A thought on another blocking card goes out alone, and an empty one does not.
    const other = await $.tool.call({
      tool: tool('add_decision'),
      question: 'Which port?',
      why: '要先知道連接埠',
      options: [{ label: '80', effect: '預設' }, { label: '8080', effect: '免權限' }],
      blocking: true,
    })
    const second = /card (\w{8})/.exec(String(other.result))?.[1] as string
    await ui.input({ key: `${second}:note`, text: '   ' })
    expect(w.submitted).toHaveLength(1)
    await ui.input({ key: `${second}:note`, text: '看 CI 用哪個' })
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted[1]).toContain('My thoughts on "Which port?"')
    expect(w.submitted[1]).toContain('看 CI 用哪個')

    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'There' })
    await $.tool.call({ tool: tool('resolve_decision'), card: second, outcome: 'noted' })
    await ui.unmount()
  }
  expect(localOf(w).sent).toEqual({})
})

test('staged_choice_auto_sends_after_turn_end', ZH, async ($, on) => {
  const w = await start($, on, null)
  const add = async (text: string, a: string, b: string) => {
    const added = await $.tool.call({
      tool: tool('add_decision'),
      question: text,
      why: '要先知道',
      options: [{ label: a, effect: '一' }, { label: b, effect: '二' }],
    })
    return /card (\w{8})/.exec(String(added.result))?.[1] as string
  }
  const close = (id: string) => $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'done' })

  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })

    // Idle: the quiet time sends.
    const cache = await add('Which cache?', 'LRU', 'TTL')
    await ui.press({ key: `${cache}:0` })
    expect(await ui.find({ text: '已選：LRU（待送出）' })).toBeDefined()
    expect(w.submitted).toEqual([])
    w.fireTimer()
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain('Which cache? → LRU')
    await close(cache)

    // Picking again un-stages, and nothing is left to send.
    const queue = await add('Which queue?', 'FIFO', 'LIFO')
    await ui.press({ key: `${queue}:1` })
    await ui.press({ key: `${queue}:1` })
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect(localOf(w).staged).toEqual({})

    // Busy: the quiet time waits for the main turn to end; a subagent's end changes nothing.
    await ui.press({ key: `${queue}:1` })
    await $.turn.start({ text: 'working', turnId: 't1' })
    w.fireTimer()
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted).toHaveLength(1)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'sub' } as never)
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted).toHaveLength(1)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted).toHaveLength(2)
    expect(w.submitted[1]).toContain('Which queue? → LIFO')
    await close(queue)
    await ui.unmount()
  }
})

test('dismiss_is_sent_as_skip', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const added = await $.tool.call({
      tool: tool('add_decision'),
      question: 'Which cache?',
      why: '要先知道',
      options: [{ label: 'LRU', effect: '一' }, { label: 'TTL', effect: '二' }],
    })
    const id = /card (\w{8})/.exec(String(added.result))?.[1] as string
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `${id}:x` })
    expect(w.submitted).toEqual([])
    expect(await ui.find({ key: 'send', text: '送出 1 個決定' })).toBeDefined()
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain('→ dismissed')
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'skipped' })
    await ui.unmount()
  }
})

test('card_of_removed_item_shows_other', ZH, async ($, on) => {
  const gone = 'a9a9a9a9'
  const w = await start($, on, [
    entry('item.add', { item: item(gone, '舊項目', '之後會刪掉') }),
    question(Q1, { item: gone, question: '要不要保留舊項目？' }),
    entry('item.remove', { item: gone }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ text: '要不要保留舊項目？' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '其他' })).toBeDefined()
    expect(await ui.find({ text: '舊項目 ·' })).toBeUndefined()
    expect(await ui.find({ key: `${Q1}:0` })).toBeDefined()
    await ui.unmount()
  }
})

test('band_text_and_edit_warning', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface)
    const line = await ui.find({ type: 'Text', text: /計畫：/ })
    expect(line?.text).toBe('計畫：1 項進行中 · 2 個決定等你')
    expect(await ui.find({ text: '⚠' })).toBeUndefined()
    await ui.press({ key: 'open' })
    expect(w.opened).toContain('plan-board')
    await ui.unmount()

    // A survey holds the band: the engine's own drawing stands.
    const survey = await band($, surface, { ...BAND_PROPS, hasSurvey: true })
    expect(await survey.find({ text: /計畫：/ })).toBeUndefined()
    expect(await survey.find({ text: 'engine band' })).toBeDefined()
    await survey.unmount()
  }

  // A sent card is no longer waiting for the user.
  w.store.set(LOCAL, { staged: {}, sent: { [Q2]: { choice: '加', at: 1 } }, expanded: [], view: 'overview' })
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    const sent = await band($, surface)
    expect((await sent.find({ type: 'Text', text: /計畫：/ }))?.text).toBe('計畫：1 項進行中 · 1 個決定等你')
    await sent.unmount()
  }

  // A line edited by hand: the band says so.
  w.files[LOG] += 'oops\n'
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    const warned = await ui.find({ type: 'Text', text: /計畫：/ })
    expect(warned?.text).toBe('計畫：1 項進行中 · 1 個決定等你 · ⚠ 計畫被直接改過')
    await ui.unmount()
    const overview = await pane($, surface)
    expect(await overview.find({ text: '計畫被直接改過，等 AI 檢查' })).toBeDefined()
    await overview.unmount()
  }
})

test('empty_repo_shows_hint_and_engine_band', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ text: '這個 repo 還沒有計畫' })).toBeDefined()
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ text: '✓ 目前沒有待你決定的事' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你決定（0）' })).toBeDefined()
    await ui.unmount()

    const line = await band($, surface)
    expect(await line.drawn()).toEqual(ENGINE_BAND)
    expect(await line.find({ key: 'open' })).toBeUndefined()
    await line.unmount()
  }
})

test('no_ids_in_zh_tw_text', ZH, async ($, on) => {
  const w = await start($, on, [
    entry('item.add', { item: item(A, '舊卡片搬過來', '舊的決定都在新看板') }),
    ...board(),
    entry('step.add', { item: A, step: { id: S0, title: '搬舊資料' } }),
    entry('step.add', { item: B, step: { id: S3, title: '輸入框上方一列' } }, { why: '一列要單獨測' }),
    entry('step.status', { step: S0, status: 'done', result: '搬完了' }, { why: '舊資料都在' }),
    question(Q0, { item: B, question: '要不要先做決定看板？' }),
    entry('card.resolve', { card: Q0, outcome: 'approved', choice: '先做' }, { basis: { type: 'card', card: Q0 } }),
    entry('item.edit', { item: B, goal: '總表和卡片都看得到，不用離開 Claude Code' }, { basis: { type: 'card', card: Q0 }, why: '使用者要求' }),
    entry('item.edit', { item: C, title: '設定精靈 v2' }, { basis: { type: 'card', card: Q0, chat: '照你的建議' }, why: '使用者在對話裡同意' }),
    entry('step.assign', { step: S2, to: 'claude-b' }),
    entry('step.assign', { step: S1, to: ULID }),
    entry('step.edit', { step: S3, title: '輸入框上方一列文字' }),
    entry('step.move', { step: S3, item: C }),
    entry('step.move', { step: S3, item: B }),
    blockedOnS2(),
    loose(),
    entry('card.open', {
      card: {
        id: P1,
        type: 'proposal',
        item: B,
        question: '調整項目？',
        why: '順序和名稱都要改',
        options: [],
        changes: [
          { kind: 'item.add', data: { item: item('11111111', '手機版', '手機上也能看') , before: D } },
          { kind: 'item.edit', data: { item: C, title: '設定精靈 v3', goal: '一分鐘設好' } },
          { kind: 'item.split', data: { item: D, into: [item('22222222', '英文 README', '英文版 README'), item('33333333', '英文教學', '英文版教學')] } },
          { kind: 'item.merge', data: { items: [B, C], into: item('44444444', '看板和精靈', '一起做') } },
          { kind: 'item.reorder', data: { order: [A, C, B, D] } },
          { kind: 'item.remove', data: { item: D } },
        ],
      },
    }),
  ])
  const cards = [Q1, Q2, P1]
  const items = [A, B, C, D]
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    const seen: string[] = []
    for (const id of items) await ui.press({ key: `item:${id}` })
    seen.push(...(await texts(ui)))
    expect(seen.some(text => text.includes('── 變動紀錄 ──'))).toBe(true)
    expect(seen.some(text => text.includes('你在「要不要先做決定看板？」選了同意'))).toBe(true)
    expect(seen.some(text => text.includes('你在對話裡說：「照你的建議」'))).toBe(true)
    await ui.press({ key: 'view:cards' })
    // The first card is open already; the others open on a press.
    for (const id of cards.slice(1)) await ui.press({ key: `card:${id}` })
    const cardTexts = await texts(ui)
    seen.push(...cardTexts)
    expect(cardTexts.filter(text => text.startsWith('為什麼現在問：'))).toHaveLength(3)
    expect(cardTexts.some(text => text.includes('之前：'))).toBe(true)
    for (const text of seen) expect(text).not.toMatch(ID)
    await ui.unmount()

    const line = await band($, surface)
    for (const text of await texts(line)) expect(text).not.toMatch(ID)
    await line.unmount()
  }
})

const add = async ($: Engine, question: string, extra: Record<string, unknown> = {}) => {
  const added = await $.tool.call({
    tool: tool('add_decision'),
    question,
    why: '要先知道',
    options: [{ label: 'LRU', effect: '一' }, { label: 'TTL', effect: '二' }],
    ...extra,
  })
  return /card (\w{8})/.exec(String(added.result))?.[1] as string
}

test('thought_only_card_stays_interactive_after_sending', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await add($, 'Which cache?')
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.input({ key: `${id}:note`, text: '先看 CI 用哪個' })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted[0]).toContain('thought: 先看 CI 用哪個')
    expect(localOf(w).sent[id]).toEqual({ draft: '先看 CI 用哪個', at: expect.any(Number) })

    // Still a card to answer: the options, the input, and what was said.
    expect(await ui.find({ type: 'Button', key: `${id}:0` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}:1` })).toBeDefined()
    expect(await ui.find({ key: `${id}:note` })).toBeDefined()
    expect(await ui.find({ key: `${id}:x` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：先看 CI 用哪個' })).toBeDefined()
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你決定（1）' })).toBeDefined()
    const line = await band($, surface)
    expect((await line.find({ type: 'Text', text: /計畫：/ }))?.text).toBe('計畫：0 項進行中 · 1 個決定等你')
    await line.unmount()

    // A choice sent afterwards settles the waiting: the card is dimmed as before.
    await ui.press({ key: `${id}:0` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 1)
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ key: `${id}:0` })).toBeUndefined()
    expect(await ui.find({ key: `${id}:note` })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你決定（0）' })).toBeDefined()
    const after = await band($, surface)
    expect((await after.find({ type: 'Text', text: /計畫：/ }))?.text).toBe('計畫：0 項進行中 · 0 個決定等你')
    await after.unmount()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'LRU' })
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('a_blocking_thought_leaves_the_card_open_but_a_dismissal_dims_it', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const blocking = await add($, 'Which port?', { blocking: true })
    const other = await add($, 'Which queue?')
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.input({ key: `${blocking}:note`, text: '看 CI 用哪個' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted[0]).toContain('My thoughts on "Which port?"')
    expect(await ui.find({ key: `${blocking}:0` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：看 CI 用哪個' })).toBeDefined()
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeUndefined()

    await ui.press({ key: `card:${other}` })
    await ui.press({ key: `${other}:x` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 1)
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ key: `${other}:x` })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你決定（1）' })).toBeDefined()
    for (const id of [blocking, other]) await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'noted' })
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('overview_lists_linked_docs_and_marks_local_mode', ZH, async ($, on) => {
  const w = await startLocal($, on, [
    ...board(),
    entry('item.link', { item: B, doc: SPEC }, { why: '設計寫好了' }),
    entry('item.link', { item: B, doc: PLAN }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: LOCAL_LINE })).toBeDefined()
    expect(await ui.find({ text: `文件：${SPEC}` })).toBeUndefined()

    await ui.press({ key: `item:${B}` })
    const seen = await texts(ui)
    const at = (text: string) => seen.findIndex(found => found === text)
    expect(at(`文件：${SPEC}`)).toBeGreaterThan(at('做完的樣子：總表和卡片都看得到'))
    expect(at(`文件：${PLAN}`)).toBe(at(`文件：${SPEC}`) + 1)
    expect(at('✓ 定檔案格式')).toBeGreaterThan(at(`文件：${PLAN}`))
    // The history names the item and the path; the other items show no docs.
    expect(seen.some(text => text.includes('「決定看板 v1」') && text.includes(SPEC))).toBe(true)
    expect(seen.filter(text => text.startsWith('文件：'))).toHaveLength(2)
    await ui.unmount()
  }
})

test('local_mode_line_is_shown_for_an_empty_local_plan_and_not_in_a_repo', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: LOCAL_LINE })).toBeDefined()
    expect(await ui.find({ text: '這個 repo 還沒有計畫' })).toBeDefined()
    await ui.unmount()
  }
  w.files[LOG] = await logText([...board(), entry('item.link', { item: B, doc: PLAN })])
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ text: /只存在這台電腦/ })).toBeUndefined()
    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ type: 'Text', text: `文件：${PLAN}` })).toBeDefined()
    await ui.unmount()
  }
})

test('local_mode_line_in_english', async ($, on) => {
  const w = await startLocal($, on, [...board()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: 'This plan lives only on this machine; type /plan init in the repo to keep it with git' })).toBeDefined()
    await ui.unmount()
  }
})

test('an_assignee_that_looks_like_an_id_is_shown_as_a_thoth_task', ZH, async ($, on) => {
  const w = await start($, on, [
    ...board(),
    entry('step.assign', { step: S1, to: ULID }),
    entry('step.assign', { step: S2, to: 'DEADBEEF12' }),
    entry('step.add', { item: B, step: { id: S3, title: '寫 README' } }),
    entry('step.assign', { step: S3, to: 'claude-b' }),
    entry('step.add', { item: B, step: { id: '54545454', title: '補測試' } }),
    entry('step.assign', { step: '54545454', to: 'deadbee' }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const seen = await texts(ui)
    expect(seen.filter(text => text === '派給 Thoth 任務')).toHaveLength(2)
    expect(seen).toContain('派給 claude-b')
    // Seven hex characters is a name, not an id.
    expect(seen).toContain('派給 deadbee')
    expect(seen.some(text => text.includes('「定檔案格式」派給 Thoth 任務'))).toBe(true)
    expect(seen.some(text => text.includes('「窗格兩個畫面」派給 Thoth 任務'))).toBe(true)
    expect(seen.some(text => text.includes('「寫 README」派給 claude-b'))).toBe(true)
    for (const text of seen) {
      expect(text).not.toContain(ULID)
      expect(text.toLowerCase()).not.toContain('deadbeef')
      expect(text).not.toMatch(ID)
    }
    await ui.unmount()
  }
})

test('assignee_ids_are_hidden_in_english_history_but_kept_for_the_model', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item(B, 'Board', 'g') }),
      entry('step.add', { item: B, step: { id: S1, title: 'Format' } }),
      entry('step.assign', { step: S1, to: ULID }),
      entry('step.assign', { step: S1, to: 'a1b2c3d4e5' }),
      entry('step.assign', { step: S1, to: 'claude-b' }),
    ]),
  )
  const lines = plan.applied.filter(e => e.kind === 'step.assign').map(e => historyLines(e, plan, 'en')[0])
  expect(lines[0]).toContain('assigned to a Thoth task')
  expect(lines[1]).toContain('assigned to a Thoth task')
  expect(lines[2]).toContain('assigned to claude-b')
  for (const line of lines) expect(line).not.toContain(ULID)
  expect(plan.steps[S1].assignee).toBe('claude-b')
  expect(t('en', 'assignedToTask' as never)).toBe('assigned to a Thoth task')
  expect(t('zh-TW', 'assignedToTask' as never)).toBe('派給 Thoth 任務')
})

test('a_step_note_shows_beside_the_step_but_not_in_the_history', ZH, async ($, on) => {
  const w = await start($, on, [...board(), entry('step.note', { step: S2, note: '等 Thoth 審查' })])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ type: 'Text', text: '等 Thoth 審查' })).toBeDefined()
    const seen = await texts(ui)
    expect(seen.filter(text => text.includes('等 Thoth 審查'))).toHaveLength(1)
    await ui.unmount()
  }
})

test('history_shows_the_old_name_of_a_rename', ZH, async ($, on) => {
  const w = await start($, on, [
    ...board(),
    entry('item.edit', { item: B, title: '決定看板 v2' }, { why: '改個名' }),
    entry('step.edit', { step: S1, title: '定檔案格式 v2' }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const seen = await texts(ui)
    expect(seen.some(text => text.includes('項目 改名「決定看板 v1」→「決定看板 v2」'))).toBe(true)
    expect(seen.some(text => text.includes('步驟 改名「定檔案格式」→「定檔案格式 v2」'))).toBe(true)
    await ui.unmount()
  }
  const plan = await replay(await logText([entry('item.add', { item: item(A, 'Alpha', 'g') }), entry('item.edit', { item: A, title: 'Beta', goal: 'new goal' })]))
  const english = historyLines(plan.applied[1], plan, 'en')[0]
  expect(english).toContain('renamed "Alpha" to "Beta"')
  expect(english).toContain('new goal')
})

test('item_link_history_names_the_item_and_the_path', async () => {
  const plan = await replay(await logText([entry('item.add', { item: item(A, 'Alpha', 'g') }), entry('item.link', { item: A, doc: PLAN })]))
  const zh = historyLines(plan.applied[1], plan, 'zh-TW')[0]
  expect(zh).toContain('「Alpha」')
  expect(zh).toContain(PLAN)
  const en = historyLines(plan.applied[1], plan, 'en')[0]
  expect(en).toContain('"Alpha"')
  expect(en).toContain(PLAN)
})

test('step_add_history_says_how_the_step_started', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item(A, '看板', 'g') }),
      entry('step.add', { item: A, step: { id: S1, title: '審查' }, status: 'doing', to: 'claude-b' }),
      entry('step.add', { item: A, step: { id: S2, title: '定格式' }, status: 'done', to: ULID }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.add', { item: A, step: { id: S3, title: '寫 README' } }),
    ]),
  )
  const zh = plan.applied.slice(1).map(e => historyLines(e, plan, 'zh-TW')[0])
  expect(zh[0]).toContain('新增「審查」到「看板」（進行中、派給 claude-b）')
  expect(zh[1]).toContain('新增「定格式」到「看板」（做完、派給 Thoth 任務） · Thoth pass')
  expect(zh[2]).toMatch(/新增「寫 README」到「看板」$/)
  expect(historyLines(plan.applied[1], plan, 'en')[0]).toContain('added "審查" to "看板" (in progress, assigned to claude-b)')
})

test('i18n_tables_have_the_same_keys', () => {
  const en = keysOf('en')
  const zh = keysOf('zh-TW')
  expect([...en].sort()).toEqual([...zh].sort())
  expect(new Set(en).size).toBe(en.length)
  for (const key of en) {
    expect(hasKey(key)).toBe(true)
    // The same {slots} in both languages.
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    expect(slots(t('en', key as never))).toEqual(slots(t('zh-TW', key as never)))
  }
  expect(hasKey('nope')).toBe(false)
  expect(hasKey('toString')).toBe(false)

  // Every fixed zh-TW text of the design is in the table, word for word.
  const words = [
    '總表', '等你決定（{n}）', '做完', '進行中', '下一個', '之後', '做完的樣子：{goal}', '── 變動紀錄 ──', '原因：{why}',
    '✓', '●', '○', '⚑', '等你決定：{question}', 'Thoth pass', 'AI 回報：{result}',
    ' · 你在「{question}」選了同意', ' · 你在對話裡說：「{chat}」',
    '{item} · 第 {n} 項 · 卡在「{step}」', '{item} · 第 {n} 項', '其他', '為什麼現在問：{why}', '之前：', '（建議）', '同意', '不要',
    '送出 {n} 個決定', '停止操作 1 分鐘後自動送出；Claude 工作中就等這輪結束再送', '已選：{choice}（待送出）', '想法：{draft}（待送出）', '清除', '已送出，等 AI 結案',
    '或寫下你的想法…（立即送出）', '或寫下你的想法…（和選擇一起送出）', '送出', '暫存',
    '這個 repo 還沒有計畫', '✓ 目前沒有待你決定的事',
    '這個計畫只存在這台電腦；在 repo 裡打 /plan init 才會跟著 git 走', '文件：{path}', '你的想法：{draft}', '派給 Thoth 任務', '派給 {to}',
    '計畫已搬進 repo，現在存在 plan/log.jsonl。', '這個 repo 已經把計畫存在 plan/log.jsonl，什麼都沒改。',
    '計畫被直接改過，等 AI 檢查', '· ⚠ 計畫被直接改過', '計畫：{doing} 項進行中 · {waiting} 個決定等你', '打開',
  ]
  const values = new Set(zh.map(key => t('zh-TW', key as never)))
  // t fills slots it has values for; unfilled ones stay as written.
  for (const word of words) expect(values.has(word)).toBe(true)
  expect(t('zh-TW', 'viewCards' as never, { n: 3 })).toBe('等你決定（3）')
  expect(t('en', 'viewCards' as never, { n: 3 })).not.toContain('{n}')
})

test('history_lines_render_every_kind_with_names', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item(A, '舊卡片搬過來', '搬完') }),
      entry('item.add', { item: item(B, '決定看板 v1', '看得到') }),
      entry('item.add', { item: item(C, '設定精靈', '好用') }),
      entry('step.add', { item: B, step: { id: S1, title: '定檔案格式' } }),
      entry('step.status', { step: S1, status: 'doing' }),
      entry('step.assign', { step: S1, to: 'claude-b' }),
      entry('step.assign', { step: S1, to: '' }),
      entry('step.edit', { step: S1, title: '定檔案格式 v2' }),
      entry('step.move', { step: S1, item: C }),
      entry('step.status', { step: S1, status: 'done', result: '好了' }),
      entry('step.remove', { step: S1 }),
      entry('item.edit', { item: B, title: '決定看板 v2' }, { basis: { type: 'card', card: Q0 } }),
      entry('item.reorder', { order: [C, B, A] }),
      entry('item.split', { item: A, into: [item(D, '搬卡片', 'x'), item('11111111', '搬設定', 'y')] }),
      entry('item.merge', { items: [D, '11111111'], into: item('22222222', '搬完', 'z') }),
      entry('item.remove', { item: '22222222' }),
      question(Q0, { item: B, question: '要不要先做？' }),
      entry('card.resolve', { card: Q0, outcome: '先做', choice: '先做' }, { basis: { type: 'card', card: Q0, chat: '好' } }),
      entry('edit.keep', { lines: [], summary: '只改了步驟' }, { basis: { type: 'direct-edit' } }),
      entry('edit.drop', { lines: [], summary: '手誤多的一行' }, { basis: { type: 'direct-edit' } }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  const lang = 'zh-TW'
  const rendered = plan.applied.map(e => historyLines(e, plan, lang))
  expect(rendered).toHaveLength(plan.applied.length)
  for (const lines of rendered) {
    expect(lines[0]).toMatch(/^\d\d\/\d\d \d\d:\d\d \S/)
    expect(lines[1]).toBe('原因：test')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).not.toMatch(ID)
  }
  const first = (kind: string) => rendered[plan.applied.findIndex(e => e.kind === kind)][0]
  expect(first('item.add')).toContain('項目 新增「舊卡片搬過來」')
  expect(first('step.add')).toContain('「定檔案格式」')
  expect(first('step.add')).toContain('「決定看板 v2」')
  expect(first('item.reorder')).toContain('項目')
  expect(first('item.split')).toContain('「舊卡片搬過來」')
  expect(first('item.split')).toContain('「搬卡片」')
  expect(first('item.merge')).toContain('「搬完」')
  expect(first('card.open')).toContain('「要不要先做？」')
  const edited = rendered[plan.applied.findIndex(e => e.kind === 'item.edit')][0]
  expect(edited).toContain('你在「要不要先做？」選了同意')
  const resolved = rendered[plan.applied.findIndex(e => e.kind === 'card.resolve')][0]
  expect(resolved).toContain('你在對話裡說：「好」')
  expect(resolved).toContain('先做')
  expect(first('edit.keep')).toContain('只改了步驟')
  expect(first('edit.drop')).toContain('手誤多的一行')

  const en = plan.applied.map(e => historyLines(e, plan, 'en'))
  for (const lines of en) for (const line of lines) expect(line).not.toMatch(ID)
  expect(en[0][1]).toBe('why: test')

  // The time is the local one.
  const at = '2026-10-07T07:20:31.000Z'
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  expect(stamp(at)).toBe(`${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`)
})
