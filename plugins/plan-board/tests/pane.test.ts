import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { hasKey, keysOf, t } from '../hooks/i18n.ts'
import { changeLine, fit, foldText, historyLines, stamp, textWidth } from '../hooks/lines.ts'
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
const STEP_DETAIL = '說明這一步替使用者做什麼、怎樣算做完'
const OPTION_DETAIL = '選了之後實際會怎麼做'
const ACTION_DETAIL = '說明為什麼要使用者自己來、做完之後會怎樣'
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
const LOCAL_LINE = '這個計畫只存在這台電腦；在 repo 裡打 /planboard init 才會跟著 git 走'
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
const ACTION = '在終端機跑 thoth checks approve'
const addAction = async ($: Engine, extra: Record<string, unknown> = {}) => {
  const added = await $.tool.call({ tool: tool('add_user_action'), action: ACTION, why: '新的檢查要人核准才會跑', command: 'thoth checks approve', detail: ACTION_DETAIL, ...extra })
  return /card (\w{8})/.exec(String(added.result))?.[1] as string
}
/** Repo folder names, as the AI tags steps with them; neither has 8 hex characters in a row, so ID does not take them for ids. */
const ERC = 'post_backend_eruncard'
const AUTH = 'auth-center'
/** The board with S1 done in auth-center, S2 in progress in ERC (shown as ERC後端) and S3 to do in auth-center. */
const tagged = () => [
  ...board(),
  entry('repo.name', { repo: ERC, name: 'ERC後端' }),
  entry('step.repo', { step: S1, repo: AUTH }),
  entry('step.repo', { step: S2, repo: ERC }),
  entry('step.add', { item: B, step: { id: S3, title: '改 token 驗證' }, repo: AUTH }),
]

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

const pane = ($: Engine, surface: Surface, columns = PANE_PROPS.bodyColumns) =>
  $.ui.mount({ plugin: 'plan-board', surface, component: 'Pane', requestId: 'plan-board', props: { ...PANE_PROPS, bodyColumns: columns } })
const band = ($: Engine, surface: Surface, props: Record<string, unknown> = BAND_PROPS) =>
  $.ui.mount({ plugin: 'plan-board', surface, component: 'AbovePrompt', props: props as never })

type Ui = Awaited<ReturnType<typeof pane>>

// The plugin sends without waiting; each find is a round trip that lets that work finish.
async function until(ui: Ui, isDone: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !isDone(); i++) await ui.find({ key: 'nothing-has-this-key' })
}

const localOf = (w: World) => w.store.get(LOCAL) as { staged: Record<string, unknown>; sent: Record<string, { choice?: string }>; expanded: string[]; view: string }

/** The label of the Button keyed `key`: the words it is named by. Its text is what its look draws, which may differ. */
const labelOf = async (ui: Ui, key: string): Promise<unknown> => (await ui.find({ type: 'Button', key }))?.props.label
/** The Buttons whose label is `label` exactly, or matches the pattern. */
async function labelled(ui: Ui, label: string | RegExp) {
  return (await ui.findAll({ type: 'Button' })).filter(found => (typeof label === 'string' ? found.props.label === label : label.test(String(found.props.label))))
}

type Drawn = { type: string; props?: Record<string, unknown>; children?: (Drawn | string)[] }
/** A drawn Text as drawn() hands it over: its props, and its words or parts. */
const word = (children: string | (Drawn | string)[], props?: Record<string, unknown>): Drawn => ({
  type: 'Text',
  ...(props === undefined ? {} : { props }),
  children: typeof children === 'string' ? [children] : children,
})
/** Bold as each surface draws it: the desktop adds a weight. */
const BOLD: Record<Surface, Record<string, unknown>> = { terminal: { bold: true }, desktop: { bold: true, weight: 'semibold' } }
/** A drawn node without the engine's press handle, to compare with what a test writes out. */
const bare = (node: Drawn | string | undefined): unknown => {
  if (node === undefined || typeof node === 'string') return node
  const { type, props, children } = node
  return { type, ...(props === undefined ? {} : { props }), ...(children === undefined ? {} : { children: children.map(bare) }) }
}
/** Every node of a drawn tree, depth first. */
const nodes = (node: Drawn | string, out: Drawn[] = []): Drawn[] => {
  if (typeof node === 'string') return out
  out.push(node)
  for (const child of node.children ?? []) nodes(child, out)
  return out
}
/** The Box keyed `key` in the pane. */
async function boxKeyed(ui: Ui, key: string): Promise<Drawn | undefined> {
  return nodes((await ui.drawn()) as Drawn).find(node => node.props?.key === key)
}

async function texts(ui: Ui): Promise<string[]> {
  return [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(found => found.text)
}

/** Opens what an open item keeps folded: its done steps, its log and the runs of step changes in it. */
async function openFolds(ui: Ui): Promise<void> {
  for (const found of await labelled(ui, /^▸ (做完 \d+ 步|變動紀錄（)/)) await ui.press({ key: found.key as string })
  for (const found of await labelled(ui, /▸ 步驟：/)) await ui.press({ key: found.key as string })
}

/** Presses every detail toggle that is drawn, so the details are on screen. */
async function pressDetails(ui: Ui): Promise<void> {
  for (const found of await ui.findAll({ type: 'Button' })) if (String(found.key).startsWith('detail:')) await ui.press({ key: found.key as string })
}

/** Presses every row of an item's history, so each reason and its detail are on screen. */
async function pressHistoryRows(ui: Ui): Promise<void> {
  for (const found of await ui.findAll({ type: 'Button' })) if (String(found.key).startsWith('log:') && /^log:\w{8}:/.test(String(found.key))) await ui.press({ key: found.key as string })
}

test('overview_shows_states_and_expands_item', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await labelOf(ui, `item:${C}`)).toBe('▸ 設定精靈 · 下一個')
    expect(await labelOf(ui, `item:${B}`)).toBe('▸ 決定看板 v1 · 進行中 ⚑')
    expect(await labelOf(ui, `item:${D}`)).toBe('▸ 英文文件 · 之後')
    expect(await ui.find({ text: '做完的樣子：總表和卡片都看得到' })).toBeUndefined()

    await ui.press({ key: `item:${B}` })
    expect(await labelOf(ui, `item:${B}`)).toBe('▾ 決定看板 v1 · 進行中 ⚑')
    expect(await ui.find({ text: '做完的樣子：總表和卡片都看得到' })).toBeDefined()
    expect(await ui.find({ text: '✓ 定檔案格式' })).toBeUndefined()
    expect(await ui.find({ text: '⚑ 窗格兩個畫面' })).toBeDefined()
    expect(await ui.find({ text: '等你決定：輸入框上方要不要顯示做完的數量？' })).toBeDefined()
    await ui.press({ key: `steps:${B}` })
    await ui.press({ key: `log:${B}` })
    expect(await ui.find({ text: '✓ 定檔案格式' })).toBeDefined()
    expect(await ui.find({ text: 'Thoth pass' })).toBeDefined()
    expect(await labelled(ui, /▸ 步驟：新增 2 個、做完 1 個、開始 1 個$/)).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^原因：/ })).toBeUndefined()
    expect(localOf(w).expanded).toEqual([B, `steps:${B}`, `log:${B}`])

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
    expect(await labelOf(ui, 'view:cards')).toBe('等你（2）')
    await ui.press({ key: 'view:cards' })
    expect(localOf(w).view).toBe('cards')

    expect((await ui.find({ type: 'Text', text: '為什麼現在問：一列只放得下兩三件事' }))?.text).toBe('為什麼現在問：一列只放得下兩三件事')
    expect(await ui.find({ type: 'Text', text: '決定看板 v1 › 窗格兩個畫面' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${Q1}:0` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${Q1}:1` })).toBeDefined()
    expect(bare(await ui.find({ type: 'Text', text: ' 建議 ' }))).toEqual(word(' 建議 ', { inverse: true, color: 'suggestion' }))
    expect(await ui.find({ key: `${Q1}:note` })).toBeDefined()
    expect(await ui.find({ key: `${Q1}:x` })).toBeDefined()

    // The second card: its question and where it sits, nothing else.
    expect(await ui.find({ text: '要不要加英文文件？' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '其他' })).toBeDefined()
    expect(await ui.find({ text: '使用者之前提過' })).toBeUndefined()
    expect(await ui.find({ key: `${Q2}:0` })).toBeUndefined()

    await ui.press({ key: `card:${Q2}` })
    expect(await ui.find({ type: 'Text', text: '使用者之前提過' })).toBeDefined()
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
    expect(await ui.find({ text: '✓ 目前沒有等你的事' })).toBeDefined()
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
      options: [{ label: 'Here', effect: '在這個 repo', detail: OPTION_DETAIL }, { label: 'There', effect: '在另一個 repo', detail: OPTION_DETAIL }],
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
      options: [{ label: '80', effect: '預設', detail: OPTION_DETAIL }, { label: '8080', effect: '免權限', detail: OPTION_DETAIL }],
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
      options: [{ label: a, effect: '一', detail: OPTION_DETAIL }, { label: b, effect: '二', detail: OPTION_DETAIL }],
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
      options: [{ label: 'LRU', effect: '一', detail: OPTION_DETAIL }, { label: 'TTL', effect: '二', detail: OPTION_DETAIL }],
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

/** What the band's line holds when it has room: the word, the pills, the warning; each as drawn. */
const bandLine = async (ui: Ui) => ((await boxKeyed(ui, 'band:line'))?.children ?? []).map(bare)
const DOING_1 = word(' 1 項進行中 ', { inverse: true, color: 'suggestion' })
const bandAt = (columns: number) => ({ ...BAND_PROPS, bodyColumns: columns })

test('band_text_and_edit_warning', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface)
    // With room: "計畫", a blue pill for what is in progress, an amber one for what waits, Open on the right.
    expect(await bandLine(ui)).toEqual([word('計畫'), DOING_1, word(' 2 件事等你 ', { inverse: true, color: 'warning' })])
    expect(bare((await boxKeyed(ui, 'band:line')) as Drawn)).toMatchObject({ props: { key: 'band:line', flexDirection: 'row', gap: 1, flexShrink: 1 } })
    const tree = (await ui.drawn()) as Drawn
    const row = parentsOf(tree).get(nodes(tree).find(node => node.props?.key === 'band:line') as Drawn)
    expect(row?.props).toEqual({ flexDirection: 'row', justifyContent: 'space-between', gap: 1 })
    expect(bare(row?.children?.[1] as Drawn)).toEqual({ type: 'Button', props: { key: 'open', label: '打開' } })
    expect(await ui.find({ text: '⚠' })).toBeUndefined()
    await ui.press({ key: 'open' })
    expect(w.opened).toContain('plan-board')
    await ui.unmount()

    // A survey holds the band: the engine's own drawing stands.
    const survey = await band($, surface, { ...BAND_PROPS, hasSurvey: true })
    expect(await survey.find({ text: /計畫/ })).toBeUndefined()
    expect(await survey.find({ text: 'engine band' })).toBeDefined()
    await survey.unmount()
  }

  // A sent card is no longer waiting for the user.
  w.store.set(LOCAL, { staged: {}, sent: { [Q2]: { choice: '加', at: 1 } }, expanded: [], view: 'overview' })
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    const sent = await band($, surface)
    expect(await bandLine(sent)).toEqual([word('計畫'), DOING_1, word(' 1 件事等你 ', { inverse: true, color: 'warning' })])
    await sent.unmount()
  }

  // A line edited by hand: the band says so, in amber.
  w.files[LOG] += 'oops\n'
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    const ui = await band($, surface)
    expect(await bandLine(ui)).toEqual([
      word('計畫'),
      DOING_1,
      word(' 1 件事等你 ', { inverse: true, color: 'warning' }),
      word('⚠ 計畫被直接改過', { color: 'warning' }),
    ])
    await ui.unmount()
    const overview = await pane($, surface)
    expect(bare(await overview.find({ type: 'Text', text: '計畫被直接改過，等 AI 檢查' }))).toEqual(word('計畫被直接改過，等 AI 檢查', { color: 'warning', wrap: 'wrap' }))
    await overview.unmount()
  }
})

test('band_falls_back_to_the_single_line_when_the_pills_do_not_fit', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  /** The single line of 0.5.x: the text, cut to fit, then Open. */
  const single = async (ui: Ui) => {
    const line = await ui.find({ type: 'Text', text: /計畫：/ })
    const place = line === undefined ? undefined : await parentOf(ui, String(line.text))
    return { text: line?.text, row: place?.box.props, open: bare(place?.box.children?.[1] as Drawn), pills: await boxKeyed(ui, 'band:line') }
  }
  for (const surface of SURFACES) {
    await fresh($, w)
    // 39 cells: the pills need 30 and Open 9 more, so they fit exactly.
    let ui = await band($, surface, bandAt(39))
    expect(await bandLine(ui)).toEqual([word('計畫'), DOING_1, word(' 2 件事等你 ', { inverse: true, color: 'warning' })])
    await ui.unmount()
    // 38 cells: one short; the band draws the line of 0.5.x, cut where it runs out.
    ui = await band($, surface, bandAt(38))
    expect(await single(ui)).toEqual({
      text: '計畫：1 項進行中 · 2 件事等你',
      row: { flexDirection: 'row', gap: 1 },
      open: { type: 'Button', props: { key: 'open', label: '打開' } },
      pills: undefined,
    })
    await ui.unmount()
    ui = await band($, surface, bandAt(29))
    expect((await single(ui)).text).toBe('計畫：1 項進行中 · …')
    await ui.unmount()
  }
  // With the warning the pills need 47 cells: at 55 they do not fit with Open, as the design's example shows.
  w.files[LOG] += 'oops\n'
  await $.prompt.submit({ text: '' })
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface, bandAt(55))
    expect((await single(ui)).text).toBe('計畫：1 項進行中 · 2 件事等你 · ⚠ 計畫被直接…')
    await ui.unmount()
    const wide = await band($, surface, bandAt(56))
    expect(await bandLine(wide)).toEqual([word('計畫'), DOING_1, word(' 2 件事等你 ', { inverse: true, color: 'warning' }), word('⚠ 計畫被直接改過', { color: 'warning' })])
    await wide.unmount()
  }
})

test('band_in_english_has_pills_and_falls_back_the_same_way', async ($, on) => {
  const w = await start($, on, [...board(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface)
    expect(await bandLine(ui)).toEqual([word('Plan'), word(' 1 in progress ', { inverse: true, color: 'suggestion' }), word(' 1 waiting for you ', { inverse: true, color: 'warning' })])
    await ui.unmount()
    // "Plan" 4, the pills 15 and 19, two gaps: 40; Open takes 9 more.
    const fits = await band($, surface, bandAt(49))
    expect(await boxKeyed(fits, 'band:line')).toBeDefined()
    await fits.unmount()
    const narrow = await band($, surface, bandAt(48))
    expect(await boxKeyed(narrow, 'band:line')).toBeUndefined()
    expect((await narrow.find({ type: 'Text', text: /^Plan:/ }))?.text).toBe('Plan: 1 in progress · 1 waiting for you')
    await narrow.unmount()
  }
  // Nothing waiting: the count is dim words, not a pill.
  w.store.set(LOCAL, { staged: {}, sent: { [Q2]: { choice: '加', at: 1 } }, expanded: [], view: 'overview' })
  await $.prompt.submit({ text: '' })
  const quiet = await band($, 'terminal')
  expect(await bandLine(quiet)).toEqual([word('Plan'), word(' 1 in progress ', { inverse: true, color: 'suggestion' }), word('0 waiting for you', { dimColor: true })])
  await quiet.unmount()
})

test('tabs_are_a_pill_when_chosen_and_words_otherwise', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  const tab = async (ui: Ui, key: string) => bare((await ui.find({ type: 'Button', key })) as unknown as Drawn)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    // The chosen tab is a blue pill; "waiting" in amber while something waits; the keys and labels are as before.
    expect(await tab(ui, 'view:overview')).toEqual({ type: 'Button', props: { key: 'view:overview', label: '總表', plain: true }, children: [word(' 總表 ', { inverse: true, color: 'suggestion' })] })
    expect(await tab(ui, 'view:cards')).toEqual({ type: 'Button', props: { key: 'view:cards', label: '等你（2）', plain: true }, children: [word('等你（2）', { color: 'warning' })] })
    await ui.press({ key: 'view:cards' })
    expect(await tab(ui, 'view:overview')).toEqual({ type: 'Button', props: { key: 'view:overview', label: '總表', plain: true }, children: [word('總表')] })
    expect(await tab(ui, 'view:cards')).toEqual({ type: 'Button', props: { key: 'view:cards', label: '等你（2）', plain: true }, children: [word(' 等你（2） ', { inverse: true, color: 'suggestion' })] })
    // The send button is as it was.
    await ui.press({ key: `card:${Q2}` })
    await ui.press({ key: `${Q2}:0` })
    expect(bare((await ui.find({ type: 'Button', key: 'send' })) as unknown as Drawn)).toEqual({ type: 'Button', props: { key: 'send', label: '送出 1 個決定', variant: 'primary', hotkey: 's' }, children: [] })
    await ui.press({ key: 'view:overview' })
    await ui.unmount()
  }
  // Nothing waits: the waiting tab is dim.
  w.store.set(LOCAL, { staged: {}, sent: { [Q1]: { choice: '顯示', at: 1 }, [Q2]: { choice: '加', at: 1 } }, expanded: [], view: 'overview' })
  await $.prompt.submit({ text: '' })
  const ui = await pane($, 'terminal')
  expect(await tab(ui, 'view:cards')).toEqual({ type: 'Button', props: { key: 'view:cards', label: '等你（0）', plain: true }, children: [word('等你（0）', { dimColor: true })] })
  await ui.unmount()
})

test('band_keeps_what_the_mods_after_it_draw', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface)
    expect(await boxKeyed(ui, 'band:line')).toBeDefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    // The plan's line sits above what the others drew.
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Box' }, ENGINE_BAND] })
    await ui.unmount()
  }
})

test('band_is_only_the_plan_line_when_nothing_is_drawn_below', ZH, async ($, on) => {
  const w = world(on, { [LOG]: await logText([...board(), blockedOnS2()]) })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }))
  await $.session.start({ cwd: '/repo' })
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await band($, surface)
    expect(await bandLine(ui)).toEqual([word('計畫'), DOING_1, word(' 1 件事等你 ', { inverse: true, color: 'warning' })])
    expect(await ui.find({ key: 'open' })).toBeDefined()
    expect(await ui.find({ text: 'engine band' })).toBeUndefined()
    await ui.unmount()
  }
})

test('empty_repo_shows_hint_and_engine_band', ZH,async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    expect(await ui.find({ text: '這個 repo 還沒有計畫' })).toBeDefined()
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ text: '✓ 目前沒有等你的事' })).toBeDefined()
    expect(await labelOf(ui, 'view:cards')).toBe('等你（0）')
    await ui.unmount()

    const line = await band($, surface)
    expect(await line.drawn()).toMatchObject(ENGINE_BAND)
    expect(await line.find({ key: 'open' })).toBeUndefined()
    await line.unmount()
  }
})

/** Every kind of line an old log holds, as the board's tests need it. */
const everything = () => [
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
  entry('repo.name', { repo: ERC, name: 'ERC後端' }),
  entry('step.repo', { step: S2, repo: ERC }),
  entry('step.repo', { step: S0, repo: AUTH }),
  entry('step.add', { item: B, step: { id: '55555555', title: '改 token 驗證' }, repo: AUTH }),
  entry('card.open', {
    card: { id: '5a5a5a5a', type: 'action', item: B, step: S2, question: ACTION, why: '新的檢查要人核准', options: [], command: 'thoth checks approve' },
  }),
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
]

/** Entries that carry details, in Chinese and without an id in any text; the ids of S2, B and the new cards sit only in keys. */
const D_ACTION = 'd5d5d5d5'
const D_PROPOSAL = 'd6d6d6d6'
const D_QUESTION = 'd7d7d7d7'
const detailed = () => [
  entry('step.detail', { step: S2, detail: STEP_DETAIL }),
  entry('step.status', { step: S2, status: 'doing' }, { why: '細節跟著這筆', detail: '這一步做完的樣子，寫在紀錄上' }),
  question(D_QUESTION, {
    item: B,
    options: [
      { label: '不顯示', effect: '一列保持短', detail: OPTION_DETAIL },
      { label: '顯示', effect: '一眼看到進度', detail: OPTION_DETAIL },
    ],
  }),
  entry('card.open', {
    card: { id: D_ACTION, type: 'action', item: B, question: ACTION, why: '新的檢查要人核准', options: [], command: 'thoth checks approve', detail: ACTION_DETAIL },
  }),
  entry('card.open', {
    card: { id: D_PROPOSAL, type: 'proposal', item: B, question: '再調整項目？', why: '名稱要改', options: [], detail: '改名之後，總表和卡片都會跟著換', changes: [{ kind: 'item.edit', data: { item: C, title: '設定精靈 v4' } }] },
  }),
]

test('no_ids_in_zh_tw_text', ZH, async ($, on) => {
  const w = await start($, on, [...everything(), ...detailed()])
  const cards = ['5a5a5a5a', Q1, Q2, P1, D_QUESTION, D_ACTION, D_PROPOSAL]
  const items = [A, B, C, D]
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    const seen: string[] = []
    await ui.press({ key: 'group:done' })
    for (const id of items) await ui.press({ key: `item:${id}` })
    await openFolds(ui)
    await pressDetails(ui)
    await pressHistoryRows(ui)
    seen.push(...(await texts(ui)))
    expect(seen).toContain('auth-center 1/1')
    expect(seen).toContain('ERC後端 0/1 · auth-center 0/1')
    expect(seen.some(text => /^變動紀錄（\d+ 筆）$/.test(text) || text.includes('▾ 變動紀錄（'))).toBe(true)
    expect(seen.some(text => text.includes('你在「要不要先做決定看板？」選了同意'))).toBe(true)
    expect(seen.some(text => text.includes('你在對話裡說：「照你的建議」'))).toBe(true)
    await ui.press({ key: 'view:cards' })
    // The first card is open already; the others open on a press.
    for (const id of cards.slice(1)) await ui.press({ key: `card:${id}` })
    await pressDetails(ui)
    const cardTexts = await texts(ui)
    expect(cardTexts).toContain('決定看板 v1 › ERC後端 · 窗格兩個畫面')
    seen.push(...cardTexts)
    // Two of the three detailed cards (the question and the proposal) ask why now as well.
    expect(cardTexts.filter(text => text === '為什麼現在問：')).toHaveLength(5)
    expect(cardTexts.some(text => /^▸ 之前的變動（\d+ 筆）$/.test(text))).toBe(true)
    for (const text of seen) expect(text).not.toMatch(ID)
    await ui.unmount()

    const line = await band($, surface)
    for (const text of await texts(line)) expect(text).not.toMatch(ID)
    await line.unmount()
  }
})

/** The rows 0.4.2 (3fb1e29) drew for `everything()`, copied from a run of that code's behaviour. 0.6.0 draws them differently (ROWS_0_6_0);
 *  they stay to check that no row's words were lost. */
const OLD_ROWS: string[] = [
  '總表',
  '等你（4）',
  '▾ 決定看板 v1 · 進行中 ⚑',
  '· ERC後端 0/1 · auth-center 0/1',
  '做完的樣子：總表和卡片都看得到，不用離開 Claude Code',
  '⚑',
  'ERC後端 ·',
  '窗格兩個畫面',
  '派給 claude-b',
  '等你處理：在終端機跑 thoth checks approve',
  '○ 輸入框上方一列文字',
  '○',
  'auth-center ·',
  '改 token 驗證',
  '▾ 做完 1 步',
  '✓ 定檔案格式',
  '派給 Thoth 任務',
  'Thoth pass',
  '▾ 變動紀錄（19 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 新增「改 token 驗證」到「決定看板 v1」（auth-center）',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」標成 ERC後端',
  '原因：test',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 步驟 改名「輸入框上方一列」→「輸入框上方一列文字」',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」派給 Thoth 任務',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」派給 claude-b',
  '原因：test',
  'MM/DD hh:mm 項目 修改「決定看板 v1」：做完的樣子改成「總表和卡片都看得到，不用離開 Claude Code」 · 你在「要不要先做決定看板？」選了同意',
  '原因：使用者要求',
  'MM/DD hh:mm 卡片 結案「要不要先做決定看板？」：approved · 你在「要不要先做決定看板？」選了同意',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「要不要先做決定看板？」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 3 個、做完 1 個、開始 1 個',
  'MM/DD hh:mm 步驟 新增「輸入框上方一列」到「決定看板 v1」',
  '原因：一列要單獨測',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」→ 進行中',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」→ 做完 · Thoth pass',
  '原因：面板測試全過',
  'MM/DD hh:mm 步驟 新增「窗格兩個畫面」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 步驟 新增「定檔案格式」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「決定看板 v1」',
  '原因：test',
  '▾ 設定精靈 v2 · 下一個',
  '做完的樣子：第一次打開就能用',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：移動 2 個',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 項目 改名「設定精靈」→「設定精靈 v2」 · 你在對話裡說：「照你的建議」',
  '原因：使用者在對話裡同意',
  'MM/DD hh:mm 項目 新增「設定精靈」',
  '原因：test',
  '▾ 英文文件 · 之後',
  '做完的樣子：README 有英文版',
  '▾ 變動紀錄（1 筆）',
  'MM/DD hh:mm 項目 新增「英文文件」',
  '原因：test',
  '▾ 做完（1 項）',
  '▾ 舊卡片搬過來 · 做完',
  '· auth-center 1/1',
  '做完的樣子：舊的決定都在新看板',
  '▾ 做完 1 步',
  '✓',
  'auth-center ·',
  '搬舊資料',
  'AI 回報：搬完了',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、做完 1 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 「搬舊資料」標成 auth-center',
  '原因：test',
  'MM/DD hh:mm 步驟 「搬舊資料」→ 做完',
  '原因：舊資料都在',
  'MM/DD hh:mm 步驟 新增「搬舊資料」到「舊卡片搬過來」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「舊卡片搬過來」',
  '原因：test',
  '總表',
  '等你（4）',
  '在終端機跑 thoth checks approve',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '為什麼：',
  '新的檢查要人核准',
  '指令：thoth checks approve',
  '做好了',
  'input:5a5a5a5a:note',
  '輸入框上方要不要顯示做完的數量？',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '為什麼現在問：',
  '一列只放得下兩三件事',
  '› 不顯示（建議）',
  '一列保持短 · 做完的在總表看',
  '› 顯示',
  '一眼看到進度',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:e1e1e1e1:note',
  '調整項目？',
  '✕',
  '決定看板 v1',
  '為什麼現在問：',
  '順序和名稱都要改',
  '同意',
  '項目 新增「手機版」',
  '項目 修改「設定精靈 v2」：標題改成「設定精靈 v3」；做完的樣子改成「一分鐘設好」',
  '項目 拆開「英文文件」→「英文 README」「英文教學」',
  '項目 合併「決定看板 v1」「設定精靈 v2」→「看板和精靈」',
  '項目 調整順序',
  '項目 刪掉「英文文件」',
  '不要',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:f1f1f1f1:note',
  '要不要加英文文件？',
  '✕',
  '其他',
  '為什麼現在問：',
  '使用者之前提過',
  '› 加',
  '多一份文件',
  '› 不加',
  '先不做',
  'input:e2e2e2e2:note',
  '總表',
  '等你（4）',
  '▾ 決定看板 v1 · 進行中 ⚑',
  '· ERC後端 0/1 · auth-center 0/1',
  '做完的樣子：總表和卡片都看得到，不用離開 Claude Code',
  '⚑',
  'ERC後端 ·',
  '窗格兩個畫面',
  '派給 claude-b',
  '等你處理：在終端機跑 thoth checks approve',
  '○ 輸入框上方一列文字',
  '○',
  'auth-center ·',
  '改 token 驗證',
  '▾ 做完 1 步',
  '✓ 定檔案格式',
  '派給 Thoth 任務',
  'Thoth pass',
  '▾ 變動紀錄（19 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 新增「改 token 驗證」到「決定看板 v1」（auth-center）',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」標成 ERC後端',
  '原因：test',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 步驟 改名「輸入框上方一列」→「輸入框上方一列文字」',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」派給 Thoth 任務',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」派給 claude-b',
  '原因：test',
  'MM/DD hh:mm 項目 修改「決定看板 v1」：做完的樣子改成「總表和卡片都看得到，不用離開 Claude Code」 · 你在「要不要先做決定看板？」選了同意',
  '原因：使用者要求',
  'MM/DD hh:mm 卡片 結案「要不要先做決定看板？」：approved · 你在「要不要先做決定看板？」選了同意',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「要不要先做決定看板？」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 3 個、做完 1 個、開始 1 個',
  'MM/DD hh:mm 步驟 新增「輸入框上方一列」到「決定看板 v1」',
  '原因：一列要單獨測',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」→ 進行中',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」→ 做完 · Thoth pass',
  '原因：面板測試全過',
  'MM/DD hh:mm 步驟 新增「窗格兩個畫面」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 步驟 新增「定檔案格式」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「決定看板 v1」',
  '原因：test',
  '▾ 設定精靈 v2 · 下一個',
  '做完的樣子：第一次打開就能用',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：移動 2 個',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 項目 改名「設定精靈」→「設定精靈 v2」 · 你在對話裡說：「照你的建議」',
  '原因：使用者在對話裡同意',
  'MM/DD hh:mm 項目 新增「設定精靈」',
  '原因：test',
  '▾ 英文文件 · 之後',
  '做完的樣子：README 有英文版',
  '▾ 變動紀錄（1 筆）',
  'MM/DD hh:mm 項目 新增「英文文件」',
  '原因：test',
  '▾ 做完（1 項）',
  '▾ 舊卡片搬過來 · 做完',
  '· auth-center 1/1',
  '做完的樣子：舊的決定都在新看板',
  '▾ 做完 1 步',
  '✓',
  'auth-center ·',
  '搬舊資料',
  'AI 回報：搬完了',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、做完 1 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 「搬舊資料」標成 auth-center',
  '原因：test',
  'MM/DD hh:mm 步驟 「搬舊資料」→ 做完',
  '原因：舊資料都在',
  'MM/DD hh:mm 步驟 新增「搬舊資料」到「舊卡片搬過來」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「舊卡片搬過來」',
  '原因：test',
  '總表',
  '等你（4）',
  '在終端機跑 thoth checks approve',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '為什麼：',
  '新的檢查要人核准',
  '指令：thoth checks approve',
  '做好了',
  'input:5a5a5a5a:note',
  '輸入框上方要不要顯示做完的數量？',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '為什麼現在問：',
  '一列只放得下兩三件事',
  '› 不顯示（建議）',
  '一列保持短 · 做完的在總表看',
  '› 顯示',
  '一眼看到進度',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:e1e1e1e1:note',
  '調整項目？',
  '✕',
  '決定看板 v1',
  '為什麼現在問：',
  '順序和名稱都要改',
  '同意',
  '項目 新增「手機版」',
  '項目 修改「設定精靈 v2」：標題改成「設定精靈 v3」；做完的樣子改成「一分鐘設好」',
  '項目 拆開「英文文件」→「英文 README」「英文教學」',
  '項目 合併「決定看板 v1」「設定精靈 v2」→「看板和精靈」',
  '項目 調整順序',
  '項目 刪掉「英文文件」',
  '不要',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:f1f1f1f1:note',
  '要不要加英文文件？',
  '✕',
  '其他',
  '為什麼現在問：',
  '使用者之前提過',
  '› 加',
  '多一份文件',
  '› 不加',
  '先不做',
  'input:e2e2e2e2:note',
]

/** The rows `everything()` draws with every item, fold, history row and card open, on both surfaces, times as MM/DD hh:mm. */
async function everythingRows($: Engine, on: Parameters<typeof world>[0]): Promise<string[]> {
  expect((await replay(await logText(everything()))).flagged).toEqual([])
  const w = await start($, on, everything())
  const rows: string[] = []
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'group:done' })
    for (const id of [A, B, C, D]) await ui.press({ key: `item:${id}` })
    await openFolds(ui)
    for (const found of await ui.findAll({ type: 'Button' })) {
      if (/^log:[^:]+:/.test(String(found.key))) await ui.press({ key: found.key as string })
    }
    rows.push(...(await order(ui)))
    await ui.press({ key: 'view:cards' })
    for (const id of ['5a5a5a5a', Q1, Q2, P1].slice(1)) await ui.press({ key: `card:${id}` })
    for (const found of await ui.findAll({ type: 'Button' })) {
      if (String(found.key).startsWith('recent:')) await ui.press({ key: found.key as string })
    }
    rows.push(...(await order(ui)))
    await ui.unmount()
  }
  return rows.map(r => r.replace(/\d\d\/\d\d \d\d:\d\d/g, 'MM/DD hh:mm'))
}

/** A row's words with what 0.6.0 draws differently taken out: the ▸▾ arrows, the " · " before a state word,
 *  the "· " that led a repo's progress, the brackets of （建議）. */
const wordsOf = (row: string): string =>
  row
    .replace(/[▸▾] /g, '')
    .replace(/[▸▾]/g, '')
    .replace(/ · (?=(進行中|做完|下一個|之後)( ⚑)?$)/, ' ')
    .replace(/^· /, '')
    .replace('（建議）', '建議')
    .trim()

/** The rows 0.6.0 draws for `everything()` on each surface, copied from a run of this code; buttons as their labels, the new pills, bars and counts as rows of their own. */
const ROWS_0_6_0: string[] = [
  '總表',
  '等你（4）',
  '▾ 決定看板 v1 · 進行中 ⚑',
  ' 進行中 ',
  '[██      ]',
  '1/4',
  'ERC後端 0/1 · auth-center 0/1',
  '做完的樣子：總表和卡片都看得到，不用離開 Claude Code',
  '⚑',
  'ERC後端 ·',
  '窗格兩個畫面',
  '派給 claude-b',
  '等你處理：在終端機跑 thoth checks approve',
  '○ 輸入框上方一列文字',
  '○',
  'auth-center ·',
  '改 token 驗證',
  '▾ 做完 1 步',
  '✓ 定檔案格式',
  '派給 Thoth 任務',
  'Thoth pass',
  '▾ 變動紀錄（19 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 新增「改 token 驗證」到「決定看板 v1」（auth-center）',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」標成 ERC後端',
  '原因：test',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 步驟 改名「輸入框上方一列」→「輸入框上方一列文字」',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」派給 Thoth 任務',
  '原因：test',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」派給 claude-b',
  '原因：test',
  'MM/DD hh:mm 項目 修改「決定看板 v1」：做完的樣子改成「總表和卡片都看得到，不用離開 Claude Code」 · 你在「要不要先做決定看板？」選了同意',
  '原因：使用者要求',
  'MM/DD hh:mm 卡片 結案「要不要先做決定看板？」：approved · 你在「要不要先做決定看板？」選了同意',
  '原因：test',
  'MM/DD hh:mm 卡片 提出「要不要先做決定看板？」',
  '原因：test',
  'MM/DD hh:mm ▾ 步驟：新增 3 個、做完 1 個、開始 1 個',
  'MM/DD hh:mm 步驟 新增「輸入框上方一列」到「決定看板 v1」',
  '原因：一列要單獨測',
  'MM/DD hh:mm 步驟 「窗格兩個畫面」→ 進行中',
  '原因：test',
  'MM/DD hh:mm 步驟 「定檔案格式」→ 做完 · Thoth pass',
  '原因：面板測試全過',
  'MM/DD hh:mm 步驟 新增「窗格兩個畫面」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 步驟 新增「定檔案格式」到「決定看板 v1」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「決定看板 v1」',
  '原因：test',
  '▾ 設定精靈 v2 · 下一個',
  '下一個',
  '做完的樣子：第一次打開就能用',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：移動 2 個',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「決定看板 v1」',
  'MM/DD hh:mm 步驟 「輸入框上方一列文字」移到「設定精靈 v2」',
  'MM/DD hh:mm 項目 改名「設定精靈」→「設定精靈 v2」 · 你在對話裡說：「照你的建議」',
  '原因：使用者在對話裡同意',
  'MM/DD hh:mm 項目 新增「設定精靈」',
  '原因：test',
  '▾ 英文文件 · 之後',
  '之後',
  '做完的樣子：README 有英文版',
  '▾ 變動紀錄（1 筆）',
  'MM/DD hh:mm 項目 新增「英文文件」',
  '原因：test',
  '▾ 做完（1 項）',
  '▾ 舊卡片搬過來 · 做完',
  ' 做完 ',
  '[████████]',
  '1/1',
  'auth-center 1/1',
  '做完的樣子：舊的決定都在新看板',
  '▾ 做完 1 步',
  '✓',
  'auth-center ·',
  '搬舊資料',
  'AI 回報：搬完了',
  '▾ 變動紀錄（4 筆）',
  'MM/DD hh:mm ▾ 步驟：新增 1 個、做完 1 個、改標 repo 1 個',
  'MM/DD hh:mm 步驟 「搬舊資料」標成 auth-center',
  '原因：test',
  'MM/DD hh:mm 步驟 「搬舊資料」→ 做完',
  '原因：舊資料都在',
  'MM/DD hh:mm 步驟 新增「搬舊資料」到「舊卡片搬過來」',
  '原因：test',
  'MM/DD hh:mm 項目 新增「舊卡片搬過來」',
  '原因：test',
  '總表',
  '等你（4）',
  ' ⚑ 要你動手 ',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '在終端機跑 thoth checks approve',
  '為什麼：新的檢查要人核准',
  '指令：thoth checks approve',
  '做好了',
  'input:5a5a5a5a:note',
  '⚑ 要你決定',
  '✕',
  '決定看板 v1 › ERC後端 · 窗格兩個畫面',
  '輸入框上方要不要顯示做完的數量？',
  '為什麼現在問：一列只放得下兩三件事',
  '› 不顯示（建議）',
  '一列保持短 · 做完的在總表看',
  '› 顯示',
  '一眼看到進度',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「調整項目？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:e1e1e1e1:note',
  '提案',
  '✕',
  '決定看板 v1',
  '調整項目？',
  '為什麼現在問：順序和名稱都要改',
  '同意',
  '項目 新增「手機版」',
  '項目 修改「設定精靈 v2」：標題改成「設定精靈 v3」；做完的樣子改成「一分鐘設好」',
  '項目 拆開「英文文件」→「英文 README」「英文教學」',
  '項目 合併「決定看板 v1」「設定精靈 v2」→「看板和精靈」',
  '項目 調整順序',
  '項目 刪掉「英文文件」',
  '不要',
  '▾ 之前的變動（3 筆）',
  'MM/DD hh:mm 卡片 提出「輸入框上方要不要顯示做完的數量？」',
  '原因：test',
  'MM/DD hh:mm 卡片 請你「在終端機跑 thoth checks approve」',
  '原因：test',
  'MM/DD hh:mm 步驟：新增 1 個、改名 1 個、移動 2 個、改派 2 個、改標 repo 1 個',
  'input:f1f1f1f1:note',
  '⚑ 要你決定',
  '✕',
  '其他',
  '要不要加英文文件？',
  '為什麼現在問：使用者之前提過',
  '› 加',
  '多一份文件',
  '› 不加',
  '先不做',
  'input:e2e2e2e2:note',
]

test('old_logs_draw_the_rows_of_0_6_0', ZH, async ($, on) => {
  // Both surfaces draw the same rows.
  expect(await everythingRows($, on)).toEqual([...ROWS_0_6_0, ...ROWS_0_6_0])
})

test('old_logs_lose_no_row_of_0_4_2', ZH, async ($, on) => {
  const rows = (await everythingRows($, on)).map(wordsOf)
  // A card's question now sits under its header and breadcrumb (design 8.4): in 0.4.2 it came before its ✕ and breadcrumb.
  const old = [...OLD_ROWS]
  for (let i = 0; i + 2 < old.length; i++) {
    if (old[i + 1] === '✕') old.splice(i, 3, old[i + 1], old[i + 2], old[i])
  }
  // Every row 0.4.2 drew is still drawn, in the same order: as a row of its own or inside a row that says more.
  let at = 0
  for (const row of old.map(wordsOf)) {
    const found = rows.findIndex((line, n) => n >= at && line.includes(row))
    expect({ row, found: found !== -1 }).toEqual({ row, found: true })
    at = found
  }
})

const add = async ($: Engine, question: string, extra: Record<string, unknown> = {}) => {
  const added = await $.tool.call({
    tool: tool('add_decision'),
    question,
    why: '要先知道',
    options: [{ label: 'LRU', effect: '一', detail: OPTION_DETAIL }, { label: 'TTL', effect: '二', detail: OPTION_DETAIL }],
    ...extra,
  })
  return /card (\w{8})/.exec(String(added.result))?.[1] as string
}

test('a_thought_only_card_dims_and_waits_for_the_ai', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await add($, 'Which cache?')
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    // A thought on a card that does not block is staged like a pick.
    await ui.input({ key: `${id}:note`, text: '先看 CI 用哪個' })
    expect(w.submitted).toEqual([])
    expect(await ui.find({ type: 'Text', text: '想法：先看 CI 用哪個（待送出）' })).toBeDefined()
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted[0]).toContain('thought: 先看 CI 用哪個')
    expect(w.submitted[0]).toContain('When a thought does not answer a card, resolve it and open a new card')
    expect(localOf(w).sent[id]).toEqual({ draft: '先看 CI 用哪個', at: expect.any(Number) })

    // Answered: dimmed like a choice, with what was said under it, until the AI closes it.
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：先看 CI 用哪個' })).toBeDefined()
    expect(await ui.find({ key: `${id}:0` })).toBeUndefined()
    expect(await ui.find({ key: `${id}:note` })).toBeUndefined()
    expect(await ui.find({ key: `${id}:x` })).toBeUndefined()
    expect(await labelOf(ui, 'view:cards')).toBe('等你（0）')
    const line = await band($, surface)
    expect(await bandLine(line)).toEqual([word('計畫'), word(' 0 項進行中 ', { inverse: true, color: 'suggestion' }), word('0 件事等你', { dimColor: true })])
    await line.unmount()

    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '先看 CI' })
    expect(await ui.find({ text: '✓ 目前沒有等你的事' })).toBeDefined()
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('a_blocking_thought_dims_the_card_at_once_and_the_step_keeps_its_flag', ZH, async ($, on) => {
  const w = await start($, on, board())
  for (const surface of SURFACES) {
    await fresh($, w)
    const blocking = await add($, 'Which port?', { blocking: true, item: B, step: S2 })
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.input({ key: `${blocking}:note`, text: '看 CI 用哪個' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain('My thoughts on "Which port?"')
    expect(w.submitted[0]).toContain('(Settle this card now:')
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：看 CI 用哪個' })).toBeDefined()
    expect(await ui.find({ key: `${blocking}:0` })).toBeUndefined()
    expect(await ui.find({ key: `${blocking}:note` })).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect(await labelOf(ui, 'view:cards')).toBe('等你（0）')

    // The step waits on the card until the AI settles it.
    await ui.press({ key: 'view:overview' })
    await ui.press({ key: `item:${B}` })
    expect(await labelOf(ui, `item:${B}`)).toBe('▾ 決定看板 v1 · 進行中 ⚑')
    expect(await ui.find({ text: '⚑ 窗格兩個畫面' })).toBeDefined()
    await $.tool.call({ tool: tool('resolve_decision'), card: blocking, outcome: '先用 8080，另開卡問 CI' })
    expect(await ui.find({ text: '● 窗格兩個畫面' })).toBeDefined()
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('a_choice_sent_with_a_thought_dims_as_before', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await add($, 'Which cache?')
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `${id}:0` })
    await ui.input({ key: `${id}:note`, text: '記憶體要夠' })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted[0]).toContain('Which cache? → LRU')
    expect(w.submitted[0]).toContain('  thought: 記憶體要夠')
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    // The choice answers the card; the thought is not shown under it.
    expect(await ui.find({ type: 'Text', text: '你的想法：記憶體要夠' })).toBeUndefined()
    expect(await labelOf(ui, 'view:cards')).toBe('等你（0）')
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: 'LRU' })
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
    await openFolds(ui)
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
    expect(await ui.find({ type: 'Text', text: 'This plan lives only on this machine; type /planboard init in the repo to keep it with git' })).toBeDefined()
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
    await openFolds(ui)
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
    await openFolds(ui)
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

test('step_detail_line_in_both_languages', async () => {
  const plan = await replay(await logText(board()))
  expect(changeLine({ kind: 'step.detail', data: { step: S1, detail: '隨便' } } as never, plan, 'en')).toBe('Step wrote the detail of "定檔案格式"')
  expect(changeLine({ kind: 'step.detail', data: { step: S1, detail: '隨便' } } as never, plan, 'zh-TW')).toBe('步驟 「定檔案格式」寫了細節')
})

test('detail_labels_in_english', async ($, on) => {
  const w = await start($, on, null)
  await fresh($, w)
  const added = await $.tool.call({
    tool: tool('add_decision'),
    question: 'Install where?',
    why: 'to know where it goes',
    options: [{ label: 'Here', effect: 'in this repo', detail: OPTION_DETAIL }, { label: 'There', effect: 'in another repo', detail: OPTION_DETAIL }],
  })
  const decision = /card (\w{8})/.exec(String(added.result))?.[1] as string
  await addAction($)
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'view:cards' })
  await ui.press({ key: `card:${decision}` })
  expect(await ui.find({ type: 'Button', text: /▸ Option details/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /▸ Details/ })).toBeDefined()
  await ui.unmount()
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
    '總表', '等你（{n}）', '做完', '進行中', '下一個', '之後', '做完的樣子：{goal}', '原因：{why}',
    '✓', '●', '○', '⚑', '等你決定：{question}', 'Thoth pass', 'AI 回報：{result}',
    ' · 你在「{question}」選了同意', ' · 你在對話裡說：「{chat}」',
    '{item} › {step}', '{item}', '其他', '為什麼現在問：', '之前的變動（{n} 筆）', '做完（{n} 項）', '做完 {n} 步', '變動紀錄（{n} 筆）', '（建議）', '同意', '不要',
    '送出 {n} 個決定', '停止操作 1 分鐘後自動送出；Claude 工作中就等這輪結束再送', '已選：{choice}（待送出）', '想法：{draft}（待送出）', '清除', '已送出，等 AI 結案',
    '或寫下你的想法…（立即送出）', '或寫下你的想法…（和選擇一起送出）', '送出', '暫存',
    '這個 repo 還沒有計畫', '✓ 目前沒有等你的事',
    '這個計畫只存在這台電腦；在 repo 裡打 /planboard init 才會跟著 git 走', '文件：{path}', '你的想法：{draft}', '派給 Thoth 任務', '派給 {to}',
    '計畫已搬進 {path}（{n} 筆紀錄）。', '這個 repo 已經把計畫存在 {path}，什麼都沒改。',
    '計畫被直接改過，等 AI 檢查', '· ⚠ 計畫被直接改過', '計畫：{doing} 項進行中 · {waiting} 件事等你', '打開',
    '做好了', '為什麼：', '指令：{command}', '已送出，等 AI 確認', '等你處理：{question}', '請你「{question}」',
    '步驟：{counts}', '新增 {n} 個', '做完 {n} 個', '開始 {n} 個', '改回還沒開始 {n} 個', '改名 {n} 個', '刪掉 {n} 個', '移動 {n} 個', '改派 {n} 個', '連上文件 {n} 個',
    '「{step}」標成 {repo}', '「{step}」不標 repo', 'repo', '{repo} 顯示成「{name}」', '{repo} 改回顯示資料夾名',
    '{item} › {repo} · {step}', '改標 repo {n} 個',
  ]
  const values = new Set(zh.map(key => t('zh-TW', key as never)))
  // t fills slots it has values for; unfilled ones stay as written.
  for (const word of words) expect(values.has(word)).toBe(true)
  expect(t('zh-TW', 'viewCards' as never, { n: 3 })).toBe('等你（3）')
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

test('action_card_shows_the_command_and_done_goes_out_at_once', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await addAction($, { item: B, step: S2 })
    const ui = await pane($, surface)
    expect(await labelOf(ui, 'view:cards')).toBe('等你（2）')
    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ text: `等你處理：${ACTION}` })).toBeDefined()
    expect(await ui.find({ text: '⚑ 窗格兩個畫面' })).toBeDefined()

    await ui.press({ key: 'view:cards' })
    // The action card comes first and opens by itself; the question waits closed.
    expect(await ui.find({ type: 'Text', text: '為什麼：' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '新的檢查要人核准才會跑' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '指令：thoth checks approve' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}:done`, text: '做好了' })).toBeDefined()
    expect(await ui.find({ key: `${id}:note` })).toBeDefined()
    expect(await ui.find({ key: `${id}:x` })).toBeDefined()
    expect(await ui.find({ key: `${Q1}:0` })).toBeUndefined()
    expect(await ui.find({ text: /之前的變動/ })).toBeUndefined()

    // Claude is working: a done still goes out at once.
    await $.turn.start({ text: 'working', turnId: 't1' })
    await ui.press({ key: `${id}:done` })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toContain(`Done by the user: "${ACTION}" [${id}]`)
    expect(await ui.find({ text: '已送出，等 AI 確認' })).toBeDefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

    const line = await band($, surface)
    expect(await bandLine(line)).toEqual([word('計畫'), DOING_1, word(' 1 件事等你 ', { inverse: true, color: 'warning' })])
    await line.unmount()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '檢查已核准' })
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('action_card_skip_and_thought_go_out_at_once', ZH, async ($, on) => {
  const w = await start($, on, null)
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await addAction($)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ type: 'Text', text: '其他' })).toBeDefined()
    await ui.input({ key: `${id}:note`, text: '我沒有權限' })
    await until(ui, () => w.submitted.length > 0)
    expect(w.submitted[0]).toContain(`My thoughts on "${ACTION}"`)
    // A thought answers the card as a done would: dimmed until the AI checks and closes it.
    expect(await ui.find({ text: '已送出，等 AI 確認' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：我沒有權限' })).toBeDefined()
    expect(await ui.find({ key: `${id}:done` })).toBeUndefined()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '使用者沒有權限，另開一張卡' })

    const skipped = await addAction($)
    await ui.press({ key: `${skipped}:x` })
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted[1]).toContain('dismissed')
    expect(await ui.find({ text: '已送出，等 AI 確認' })).toBeDefined()
    await $.tool.call({ tool: tool('resolve_decision'), card: skipped, outcome: '使用者略過' })
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('action_card_history_line', async () => {
  const plan = await replay(
    await logText([entry('card.open', { card: { id: Q0, type: 'action', question: ACTION, why: 'w', options: [], command: 'thoth checks approve' } })]),
  )
  expect(historyLines(plan.applied[0], plan, 'zh-TW')[0]).toContain(`卡片 請你「${ACTION}」`)
  expect(historyLines(plan.applied[0], plan, 'en')[0]).toContain(`Card asked you to "${ACTION}"`)
})

test('step_repo_and_repo_name_lines_in_both_languages', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item(A, '看板', 'g') }),
      entry('step.add', { item: A, step: { id: S1, title: '審查' } }),
      entry('repo.name', { repo: ERC, name: 'ERC後端' }),
      entry('step.repo', { step: S1, repo: ERC }),
      entry('step.repo', { step: S1, repo: AUTH }),
      entry('step.repo', { step: S1, repo: '' }),
      entry('repo.name', { repo: AUTH, name: '' }),
    ]),
  )
  const [named, tagged, other, untagged, unnamed] = plan.applied.slice(2)
  // A tag names the repo by its short name now; one without a short name by its folder.
  expect(changeLine(tagged, plan, 'zh-TW')).toBe('步驟 「審查」標成 ERC後端')
  expect(changeLine(tagged, plan, 'en')).toBe('Step tagged "審查" with ERC後端')
  expect(changeLine(other, plan, 'zh-TW')).toBe('步驟 「審查」標成 auth-center')
  expect(changeLine(untagged, plan, 'zh-TW')).toBe('步驟 「審查」不標 repo')
  expect(changeLine(untagged, plan, 'en')).toBe('Step untagged "審查"')
  // A short name is on no item's history, but every kind has a sentence.
  expect(changeLine(named, plan, 'zh-TW')).toBe(`repo ${ERC} 顯示成「ERC後端」`)
  expect(changeLine(named, plan, 'en')).toBe(`Repo ${ERC} is shown as "ERC後端"`)
  expect(changeLine(unnamed, plan, 'zh-TW')).toBe('repo auth-center 改回顯示資料夾名')
  expect(changeLine(unnamed, plan, 'en')).toBe('Repo auth-center is shown by its folder name')
  for (const e of plan.applied.slice(2)) expect(historyLines(e, plan, 'zh-TW')[0]).not.toMatch(ID)
})

test('repos_show_by_short_name_on_items_steps_and_cards', ZH, async ($, on) => {
  const entries = [...tagged(), blockedOnS2()]
  const w = await start($, on, entries)
  const fold = `fold:${B}:${entries[3].id}`
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    // Each repo's done/total on a dim line under the folded item, in the order the item's steps first name it; an item with no tagged step shows none.
    expect(await labelOf(ui, `item:${B}`)).toBe('▸ 決定看板 v1 · 進行中 ⚑')
    const progress =await ui.find({ type: 'Text', text: 'auth-center 1/2 · ERC後端 0/1' })
    expect(progress?.text).toBe('auth-center 1/2 · ERC後端 0/1')
    expect(progress?.props).toEqual({ dimColor: true, wrap: 'wrap' })
    expect((await parentOf(ui, 'auth-center 1/2 · ERC後端 0/1'))?.box.props).toEqual({ paddingLeft: 2 })
    expect((await texts(ui)).filter(text => text.includes('auth-center') || text.includes('ERC'))).toEqual(['auth-center 1/2 · ERC後端 0/1'])
    const closedRows = await order(ui)
    const itemAt = closedRows.indexOf('▸ 決定看板 v1 · 進行中 ⚑')
    expect(closedRows.slice(itemAt, itemAt + 5)).toEqual(['▸ 決定看板 v1 · 進行中 ⚑', ' 進行中 ', '[███     ]', '1/3', 'auth-center 1/2 · ERC後端 0/1'])

    // A tagged step: its mark, the repo dimmed, then its title.
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    expect(await ui.find({ type: 'Text', text: '⚑' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'ERC後端 ·' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '窗格兩個畫面' })).toBeDefined()
    expect((await texts(ui)).filter(text => text === 'auth-center ·')).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: '改 token 驗證' })).toBeDefined()

    // Retags are step chatter; inside the fold, a tag and an add name the repo by its short name.
    await ui.press({ key: `log:${B}` })
    expect((await ui.find({ type: 'Button', key: fold }))?.text).toMatch(/▸ 步驟：新增 3 個、做完 1 個、開始 1 個、改標 repo 2 個$/)
    await ui.press({ key: fold })
    expect(await labelled(ui, /步驟 「窗格兩個畫面」標成 ERC後端$/)).toHaveLength(1)
    expect(await labelled(ui, /步驟 新增「改 token 驗證」到「決定看板 v1」（auth-center）$/)).toHaveLength(1)

    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ type: 'Text', text: '決定看板 v1 › ERC後端 · 窗格兩個畫面' })).toBeDefined()
    await ui.unmount()
  }
})

test('a_new_or_dropped_short_name_shows_everywhere_at_once', ZH, async ($, on) => {
  const entries = tagged()
  const w = await start($, on, entries)
  const rename = (name: string) => $.tool.call({ tool: tool('update_step'), why: '換個好認的名字', ops: [{ action: 'repo_name', repo: ERC, name }] })
  for (const surface of SURFACES) {
    await fresh($, w)
    // Naming a repo again with the name it has is no clash.
    expect((await rename('ERC後端')).deny).toBeUndefined()
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `log:${B}` })
    await ui.press({ key: `fold:${B}:${entries[3].id}` })
    expect(await ui.find({ type: 'Text', text: 'ERC後端 ·' })).toBeDefined()

    await rename('ERC主程式')
    expect((await ui.find({ type: 'Text', text: 'auth-center 1/2 · ERC主程式 0/1' }))?.text).toBe('auth-center 1/2 · ERC主程式 0/1')
    expect(await ui.find({ type: 'Text', text: 'ERC主程式 ·' })).toBeDefined()
    expect(await labelled(ui, /步驟 「窗格兩個畫面」標成 ERC主程式$/)).toHaveLength(1)
    expect((await texts(ui)).some(text => text.includes('ERC後端'))).toBe(false)

    await rename('')
    expect((await ui.find({ type: 'Text', text: `auth-center 1/2 · ${ERC} 0/1` }))?.text).toBe(`auth-center 1/2 · ${ERC} 0/1`)
    expect(await ui.find({ type: 'Text', text: `${ERC} ·` })).toBeDefined()
    expect(await labelled(ui, new RegExp(`步驟 「窗格兩個畫面」標成 ${ERC}$`))).toHaveLength(1)
    expect((await texts(ui)).some(text => text.includes('ERC主程式'))).toBe(false)
    await ui.unmount()
  }
})

test('history_names_a_repo_by_its_current_short_name', async () => {
  const entries = [
    entry('item.add', { item: item(A, '看板', 'g') }),
    entry('repo.name', { repo: ERC, name: 'ERC後端' }),
    entry('step.add', { item: A, step: { id: S1, title: '審查' }, status: 'doing', to: 'claude-b', repo: ERC }),
    entry('step.add', { item: A, step: { id: S2, title: '定格式' }, repo: '' }),
    entry('step.repo', { step: S2, repo: ERC }),
  ]
  const named = await replay(await logText(entries))
  const [added, plain, retag] = named.applied.slice(2)
  expect(changeLine(added, named, 'zh-TW')).toBe('步驟 新增「審查」到「看板」（進行中、派給 claude-b、ERC後端）')
  expect(changeLine(added, named, 'en')).toBe('Step added "審查" to "看板" (in progress, assigned to claude-b, ERC後端)')
  expect(changeLine(plain, named, 'zh-TW')).toBe('步驟 新增「定格式」到「看板」')
  expect(changeLine(retag, named, 'zh-TW')).toBe('步驟 「定格式」標成 ERC後端')

  // A later name, or none, changes every line that names the repo, the lines written before it too.
  const renamed = await replay(await logText([...entries, entry('repo.name', { repo: ERC, name: 'ERC主程式' })]))
  expect(changeLine(added, renamed, 'zh-TW')).toBe('步驟 新增「審查」到「看板」（進行中、派給 claude-b、ERC主程式）')
  expect(changeLine(retag, renamed, 'zh-TW')).toBe('步驟 「定格式」標成 ERC主程式')
  const dropped = await replay(await logText([...entries, entry('repo.name', { repo: ERC, name: '' })]))
  expect(changeLine(added, dropped, 'zh-TW')).toBe(`步驟 新增「審查」到「看板」（進行中、派給 claude-b、${ERC}）`)
  expect(changeLine(retag, dropped, 'en')).toBe(`Step tagged "定格式" with ${ERC}`)
})

test('fold_text_counts_each_kind_in_both_languages', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item(A, '看板', 'g') }),
      entry('step.add', { item: A, step: { id: S1, title: '一' } }),
      entry('step.add', { item: A, step: { id: S2, title: '二' } }),
      entry('step.status', { step: S1, status: 'doing' }),
      entry('step.status', { step: S1, status: 'done', result: 'ok' }),
      entry('step.status', { step: S2, status: 'todo' }),
      entry('step.edit', { step: S2, title: '二 v2' }),
      entry('step.assign', { step: S2, to: 'claude-b' }),
      entry('step.move', { step: S2, item: A }),
      entry('step.repo', { step: S2, repo: AUTH }),
      entry('item.link', { item: A, doc: PLAN }),
      entry('step.remove', { step: S2 }),
    ]),
  )
  const chatter = plan.applied.slice(1)
  expect(foldText(chatter, 'zh-TW')).toBe('步驟：新增 2 個、做完 1 個、開始 1 個、改回還沒開始 1 個、改名 1 個、刪掉 1 個、移動 1 個、改派 1 個、改標 repo 1 個、連上文件 1 個')
  expect(foldText(chatter, 'en')).toBe('Steps: 2 added, 1 done, 1 started, 1 back to not started, 1 renamed, 1 removed, 1 moved, 1 reassigned, 1 retagged, 1 docs linked')
  expect(foldText(chatter.slice(0, 3), 'en')).toBe('Steps: 2 added, 1 started')
})

test('history_folds_step_chatter_and_shows_a_reason_on_press', ZH, async ($, on) => {
  const entries = [...board(), blockedOnS2()]
  const w = await start($, on, entries)
  const addS1 = entries[3]
  const doneS1 = entries[5]
  const fold = `fold:${B}:${addS1.id}`
  const log = `log:${B}:${doneS1.id}`
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ key: fold })).toBeUndefined()
    await ui.press({ key: `log:${B}` })
    expect((await ui.find({ type: 'Button', key: fold }))?.text).toMatch(/^\d\d\/\d\d \d\d:\d\d ▸ 步驟：新增 2 個、做完 1 個、開始 1 個$/)
    expect(await ui.find({ key: log })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^原因：/ })).toBeUndefined()
    // What the user decided stays on a line of its own.
    expect(await ui.find({ type: 'Button', text: /卡片 提出「輸入框上方要不要顯示做完的數量？」/ })).toBeDefined()

    await ui.press({ key: fold })
    expect((await ui.find({ type: 'Button', key: fold }))?.text).toContain('▾ 步驟：')
    expect(localOf(w).expanded).toContain(`fold:${addS1.id}`)
    expect((await ui.find({ type: 'Button', key: log }))?.text).toContain('「定檔案格式」→ 做完 · Thoth pass')
    expect(await ui.find({ type: 'Text', text: '原因：面板測試全過' })).toBeUndefined()

    await ui.press({ key: log })
    expect(await ui.find({ type: 'Text', text: '原因：面板測試全過' })).toBeDefined()
    expect(localOf(w).expanded).toContain(`why:${doneS1.id}`)
    await ui.press({ key: log })
    expect(await ui.find({ type: 'Text', text: '原因：面板測試全過' })).toBeUndefined()

    // The card's "before" shows the same fold as one line that does not open.
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `recent:${Q1}` })
    expect(await ui.find({ type: 'Text', text: /^\d\d\/\d\d \d\d:\d\d 步驟：新增 2 個、做完 1 個、開始 1 個$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an_open_fold_stays_open_when_more_step_chatter_arrives', ZH, async ($, on) => {
  const entries = board()
  const w = await start($, on, entries)
  const fold = `fold:${B}:${entries[3].id}`
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `log:${B}` })
    await ui.press({ key: fold })
    await $.tool.call({ tool: tool('update_step'), why: '多一步', ops: [{ action: 'add', item: B, title: `補測試 ${surface}`, detail: STEP_DETAIL }] })
    expect((await ui.find({ type: 'Button', key: fold }))?.text).toContain('▾ 步驟：')
    expect(await ui.find({ type: 'Button', text: new RegExp(`新增「補測試 ${surface}」`) })).toBeDefined()
    await ui.unmount()
  }
})

test('a_long_thought_shows_in_full_below_the_field_while_typing', ZH, async ($, on) => {
  const w = await start($, on, null)
  const long = '先看 CI 用哪個，再看記憶體上限，最後問一下維運那邊有沒有偏好，這幾件事都問完再決定'
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await add($, 'Which cache?')
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    expect(await ui.find({ type: 'Text', text: /^正在寫：/ })).toBeUndefined()

    // The field is one row: what was typed is shown whole, wrapped, under it.
    await ui.input({ key: `${id}:note`, text: long, kind: 'change' })
    expect(await ui.find({ type: 'Text', text: `正在寫：${long}` })).toBeDefined()
    await ui.input({ key: `${id}:note`, text: '   ', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: /^正在寫：/ })).toBeUndefined()

    // Once it is staged the field's echo goes; the staged thought says it instead.
    await ui.input({ key: `${id}:note`, text: long, kind: 'change' })
    await ui.input({ key: `${id}:note`, text: long })
    expect(await ui.find({ type: 'Text', text: /^正在寫：/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: `想法：${long}（待送出）` })).toBeDefined()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '先看 CI' })
    await ui.unmount()
  }
})

/** The Box props that add blank rows above or below what a Box holds. */
const VERTICAL = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom'] as const
const shown = (node: Drawn | string): string => (typeof node === 'string' ? node : node.type === 'Button' ? String(node.props?.label) : (node.children ?? []).map(shown).join(''))
/** The rows of a tree top to bottom: each Button, Text and Input, without what is drawn inside one (a Button's look, a Text's coloured parts). */
const rowNodes = (node: Drawn | string, out: Drawn[] = []): Drawn[] => {
  if (typeof node === 'string') return out
  if (node.type === 'Button' || node.type === 'Text' || node.type === 'Input') {
    out.push(node)
    return out
  }
  for (const child of node.children ?? []) rowNodes(child, out)
  return out
}
const rowText = (node: Drawn): string => (node.type === 'Input' ? `input:${String(node.props?.key)}` : shown(node))
/** What the pane shows top to bottom: a Button as its label, a Text as its words, an Input as its key. */
async function order(ui: Ui): Promise<string[]> {
  return rowNodes((await ui.drawn()) as Drawn).map(rowText)
}
/** Each node of the tree mapped to the node it sits in. */
const parentsOf = (tree: Drawn): Map<Drawn, Drawn> => {
  const parents = new Map<Drawn, Drawn>()
  for (const node of nodes(tree)) for (const child of node.children ?? []) if (typeof child !== 'string') parents.set(child, node)
  return parents
}
/** For the detail line `words`: the cell its text starts at, counted from the Box its block sits in, and the bar on its left (a 1-cell Box). */
async function detailPlace(ui: Ui, words: string): Promise<{ start: number; bar: { width: unknown; backgroundColor: unknown; children: number } } | undefined> {
  const tree = (await ui.drawn()) as Drawn
  const parents = parentsOf(tree)
  const text = nodes(tree).find(node => node.type === 'Text' && shown(node) === words)
  const column = text === undefined ? undefined : parents.get(text)
  const row = column === undefined ? undefined : parents.get(column)
  if (column === undefined || row === undefined) return undefined
  const left = row.children?.[(row.children ?? []).indexOf(column) - 1]
  if (left === undefined || typeof left === 'string') return undefined
  const cells = (n: unknown): number => (typeof n === 'number' ? n : 0)
  return {
    start: cells(row.props?.paddingLeft) + cells(left.props?.width) + cells(column.props?.paddingLeft),
    bar: { width: left.props?.width, backgroundColor: left.props?.backgroundColor, children: (left.children ?? []).length },
  }
}
/** The bar a detail draws beside its text. */
const DETAIL_BAR = { width: 1, backgroundColor: 'inactive', children: 0 }
/** The Box a Text sits directly in, and the Text's place in it. */
async function parentOf(ui: Ui, words: string): Promise<{ box: Drawn; at: number } | undefined> {
  for (const node of nodes((await ui.drawn()) as Drawn)) {
    const at = (node.children ?? []).findIndex(child => typeof child !== 'string' && child.type === 'Text' && shown(child) === words)
    if (at !== -1) return { box: node, at }
  }
  return undefined
}

test('card_position_is_a_breadcrumb_with_a_short_item_name', ZH, async ($, on) => {
  const LONG = '10-15 需求：搜尋網址、最後刷新時間、匯出按鈕'
  const E = 'e4e4e4e4'
  const w = await start($, on, [
    ...tagged(),
    entry('item.add', { item: item(E, LONG, '長標題') }),
    question(Q1, { item: B, step: S2 }),
    question(Q2, { item: C, question: '設定精靈要不要英文？' }),
    question(Q0, { item: E, question: '長標題的項目要不要拆？' }),
    question('e5e5e5e5', { question: '沒有項目的問題？' }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const seen = await texts(ui)
    expect(seen).toContain('決定看板 v1 › ERC後端 · 窗格兩個畫面')
    expect(seen).toContain('設定精靈')
    expect(seen).toContain(fit(LONG, 20))
    expect(textWidth(fit(LONG, 20))).toBeLessThanOrEqual(20)
    expect(seen).toContain('其他')
    expect(seen.some(text => text.includes('第 ') || text.includes('卡在'))).toBe(false)
    await ui.unmount()
  }
  expect(t('en', 'posStep' as never, { item: 'Board', step: 'Format' })).toBe('Board › Format')
  expect(t('en', 'posStepRepo' as never, { item: 'Board', step: 'Format', repo: 'ERC backend' })).toBe('Board › ERC backend · Format')
  expect(t('en', 'posItem' as never, { item: 'Board' })).toBe('Board')
  expect(t('zh-TW', 'posStepRepo' as never, { item: '看板', step: '格式', repo: 'ERC後端' })).toBe('看板 › ERC後端 · 格式')
})

test('a_sent_card_keeps_the_breadcrumb', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `${Q1}:1` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '決定看板 v1 › 窗格兩個畫面' })).toBeDefined()
    await ui.unmount()
  }
})

test('why_and_its_reason_are_one_wrapping_text_with_a_dim_label', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const why = await ui.find({ type: 'Text', text: '為什麼現在問：一列只放得下兩三件事' })
    expect(bare(why as unknown as Drawn)).toEqual(word([word('為什麼現在問：', { dimColor: true }), '一列只放得下兩三件事'], { wrap: 'wrap' }))
    // It sits straight in the card, under the question.
    const rows = await cardRows(ui, Q1)
    expect(rows[rows.indexOf('為什麼現在問：一列只放得下兩三件事') - 1]).toBe('輸入框上方要不要顯示做完的數量？')
    expect((await parentOf(ui, '為什麼現在問：一列只放得下兩三件事'))?.box.props?.key).toBe(`card:body:${Q1}`)
    await ui.unmount()
  }
})

test('action_why_and_its_reason_are_one_wrapping_text_with_a_dim_label', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await addAction($, { item: B, step: S2 })
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const why = await ui.find({ type: 'Text', text: '為什麼：新的檢查要人核准才會跑' })
    expect(bare(why as unknown as Drawn)).toEqual(word([word('為什麼：', { dimColor: true }), '新的檢查要人核准才會跑'], { wrap: 'wrap' }))
    expect((await parentOf(ui, '為什麼：新的檢查要人核准才會跑'))?.box.props?.key).toBe(`card:body:${id}`)
    await ui.unmount()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '另一面再開一張' })
  }
})

test('why_in_english_has_a_space_after_its_label', async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'view:cards' })
  const why = await ui.find({ type: 'Text', text: 'Why ask now: 一列只放得下兩三件事' })
  expect(bare(why as unknown as Drawn)).toEqual(word([word('Why ask now:', { dimColor: true }), ' 一列只放得下兩三件事'], { wrap: 'wrap' }))
  await ui.unmount()
  expect(w.submitted).toEqual([])
})

test('options_follow_the_why_and_the_earlier_changes_sit_below_the_picks', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `${Q1}:0` })
    const seen = await order(ui)
    const at = (text: string | RegExp) => seen.findIndex(line => (typeof text === 'string' ? line === text : text.test(line)))
    expect(at('為什麼現在問：一列只放得下兩三件事')).toBeGreaterThan(at('輸入框上方要不要顯示做完的數量？'))
    expect(at(/^● 不顯示/)).toBe(at('為什麼現在問：一列只放得下兩三件事') + 1)
    expect(at(/^已選：/)).toBeGreaterThan(at(/^顯示/))
    expect(at('清除')).toBeGreaterThan(at(/^已選：/))
    expect(at(/^▸ 之前的變動（\d+ 筆）$/)).toBeGreaterThan(at('清除'))
    expect(seen.indexOf(`input:${Q1}:note`)).toBeGreaterThan(at(/^▸ 之前的變動/))
    expect(seen.some(line => line.startsWith('之前：'))).toBe(false)
    await ui.unmount()
  }
})

test('earlier_changes_fold_into_one_pressable_line_per_card', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    // The item's log holds the item.add and a fold of four steps' chatter: two rows, and nothing of them shows yet.
    expect((await ui.find({ type: 'Button', key: `recent:${Q1}` }))?.text).toBe('▸ 之前的變動（2 筆）')
    expect(await ui.find({ type: 'Button', text: /項目 新增「決定看板 v1」/ })).toBeUndefined()
    expect(await ui.find({ text: /^\d\d\/\d\d \d\d:\d\d 步驟：新增 2 個/ })).toBeUndefined()

    await ui.press({ key: `recent:${Q1}` })
    expect(localOf(w).expanded).toEqual([`recent:${Q1}`])
    expect((await ui.find({ type: 'Button', key: `recent:${Q1}` }))?.text).toBe('▾ 之前的變動（2 筆）')
    expect(await ui.find({ type: 'Text', text: /^\d\d\/\d\d \d\d:\d\d 步驟：新增 2 個、做完 1 個、開始 1 個$/ })).toBeDefined()
    const row = await ui.find({ type: 'Button', text: /項目 新增「決定看板 v1」/ })
    expect(row).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^原因：/ })).toBeUndefined()
    await ui.press({ key: row?.key as string })
    expect(await ui.find({ type: 'Text', text: '原因：test' })).toBeDefined()
    await ui.press({ key: `recent:${Q1}` })
    expect(await ui.find({ type: 'Button', text: /項目 新增「決定看板 v1」/ })).toBeUndefined()

    // A card with no item has no earlier changes, so no line.
    await ui.press({ key: `card:${Q2}` })
    expect(await ui.find({ key: `${Q2}:0` })).toBeDefined()
    expect(await ui.find({ key: `recent:${Q2}` })).toBeUndefined()
    await ui.unmount()
  }
})

test('done_items_gather_in_one_closed_line_at_the_bottom', ZH, async ($, on) => {
  const done = [
    entry('item.add', { item: item(A, '審查流程', '審查跑完') }),
    entry('step.add', { item: A, step: { id: S0, title: '跑審查' } }),
    entry('step.status', { step: S0, status: 'done' }),
  ]
  const w = await start($, on, [...done, ...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    const closed = await order(ui)
    expect(closed.filter(line => line.includes('審查流程'))).toEqual([])
    // Each item row is its button and its right side: the state, and the bar and count when it has steps.
    expect(closed.slice(-9)).toEqual([
      '▸ 決定看板 v1 · 進行中 ⚑',
      ' 進行中 ',
      '[████    ]',
      '1/2',
      '▸ 設定精靈 · 下一個',
      '下一個',
      '▸ 英文文件 · 之後',
      '之後',
      '▸ 做完（1 項）',
    ])

    await ui.press({ key: 'group:done' })
    expect(localOf(w).expanded).toEqual(['group:done'])
    const opened = await order(ui)
    expect(opened.slice(-5)).toEqual(['▾ 做完（1 項）', '▸ 審查流程 · 做完', ' 做完 ', '[████████]', '1/1'])

    // A done item opens like any other; all its steps are done, so they sit behind one line.
    await ui.press({ key: `item:${A}` })
    expect(await ui.find({ text: '✓ 跑審查' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: `steps:${A}` }))?.text).toBe('▸ 做完 1 步')
    await ui.press({ key: `steps:${A}` })
    expect(await ui.find({ text: '✓ 跑審查' })).toBeDefined()

    await ui.press({ key: 'group:done' })
    expect(await ui.find({ type: 'Button', text: /審查流程/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('no_done_line_without_a_done_item', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const ui = await pane($, 'terminal')
  expect(await ui.find({ key: 'group:done' })).toBeUndefined()
  await ui.unmount()
})

test('an_open_item_lists_unfinished_steps_first_and_folds_the_done_ones_and_the_log', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const seen = await order(ui)
    const at = (text: string | RegExp) => seen.findIndex(line => (typeof text === 'string' ? line === text : text.test(line)))
    expect(at('⚑ 窗格兩個畫面')).toBeGreaterThan(-1)
    expect(await ui.find({ text: '✓ 定檔案格式' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: `steps:${B}` }))?.text).toBe('▸ 做完 1 步')
    expect(at('▸ 做完 1 步')).toBeGreaterThan(at('⚑ 窗格兩個畫面'))
    // Six entries stand behind three rows: the count is the entries.
    expect((await ui.find({ type: 'Button', key: `log:${B}` }))?.text).toBe('▸ 變動紀錄（6 筆）')
    expect(at('▸ 變動紀錄（6 筆）')).toBeGreaterThan(at('▸ 做完 1 步'))
    expect(await ui.find({ type: 'Button', text: /▸ 步驟：新增/ })).toBeUndefined()

    await ui.press({ key: `steps:${B}` })
    expect(await ui.find({ text: '✓ 定檔案格式' })).toBeDefined()
    expect(await ui.find({ text: 'Thoth pass' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `steps:${B}` }))?.text).toBe('▾ 做完 1 步')

    await ui.press({ key: `log:${B}` })
    expect(localOf(w).expanded).toEqual([B, `steps:${B}`, `log:${B}`])
    const opened = await order(ui)
    const head = opened.indexOf('▾ 變動紀錄（6 筆）')
    expect(opened[head + 1]).toMatch(/卡片 提出/)
    // What opens under a fold line sits two cells in from it.
    const tree = (await ui.drawn()) as Drawn
    const under = (first: string) => nodes(tree).find(node => node.props?.paddingLeft === 2 && shown((node.children ?? [])[0] ?? '').includes(first))
    expect(under('✓ 定檔案格式')).toBeDefined()
    expect(under('卡片 提出')).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /▸ 步驟：新增 2 個、做完 1 個、開始 1 個$/ })).toBeDefined()

    await ui.press({ key: `log:${B}` })
    await ui.unmount()
  }
})

test('an_item_without_done_steps_has_no_done_line_and_without_unfinished_ones_no_list', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const ui = await pane($, 'terminal')
  await ui.press({ key: `item:${C}` })
  expect(await ui.find({ key: `steps:${C}` })).toBeUndefined()
  expect(await ui.find({ key: `log:${C}` })).toBeDefined()
  await ui.unmount()
  expect(localOf(w).expanded).toEqual([C])
})

/** The keys of the buttons that open a detail. */
async function detailButtons(ui: Ui): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(found => String(found.key)).filter(key => key.startsWith('detail:'))
}

test('a_step_detail_opens_under_its_title', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const added = await $.tool.call({
    tool: tool('update_step'),
    why: '多一步',
    ops: [{ action: 'add', item: B, title: '英文說明', detail: '寫給第一次用的人：\n裝好後五分鐘內看得懂總表' }],
  })
  const id = /step (\w{8})/.exec(String(added.result))?.[1] as string
  expect(id).toMatch(ID)
  const done = await $.tool.call({ tool: tool('update_step'), why: '補上細節', ops: [{ action: 'detail', step: S1, detail: '每一行一筆紀錄，帶檢查碼' }] })
  expect(done.deny).toBeUndefined()
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const toggle = await ui.find({ key: `detail:${id}` })
    expect(toggle?.type).toBe('Button')
    expect(toggle?.text).toBe('○ 英文說明 ▸')
    expect(toggle?.props.hotkey).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '寫給第一次用的人：' })).toBeUndefined()
    // The title is the toggle: no Text draws it as well.
    expect(await ui.find({ type: 'Text', text: '○ 英文說明' })).toBeUndefined()

    await ui.press({ key: `detail:${id}` })
    expect((await ui.find({ key: `detail:${id}` }))?.text).toMatch(/▾$/)
    const first = await ui.find({ type: 'Text', text: '寫給第一次用的人：' })
    expect(first).toBeDefined()
    expect(first?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: '裝好後五分鐘內看得懂總表' })).toBeDefined()
    const rows = await order(ui)
    const at = rows.indexOf('○ 英文說明 ▾')
    expect(rows.slice(at, at + 3)).toEqual(['○ 英文說明 ▾', '寫給第一次用的人：', '裝好後五分鐘內看得懂總表'])
    // The text starts where 0.5.0 put it; the inactive bar takes the two cells on its left.
    expect(await detailPlace(ui, '寫給第一次用的人：')).toEqual({ start: 2, bar: DETAIL_BAR })
    expect(await detailPlace(ui, '裝好後五分鐘內看得懂總表')).toEqual({ start: 2, bar: DETAIL_BAR })

    await ui.press({ key: `detail:${id}` })
    expect((await ui.find({ key: `detail:${id}` }))?.text).toMatch(/▸$/)
    expect(await ui.find({ type: 'Text', text: '寫給第一次用的人：' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '裝好後五分鐘內看得懂總表' })).toBeUndefined()

    // A done step behind the fold opens the same way.
    expect(await ui.find({ key: `detail:${S1}` })).toBeUndefined()
    await ui.press({ key: `steps:${B}` })
    expect((await ui.find({ key: `detail:${S1}` }))?.text).toBe('✓ 定檔案格式 ▸')
    await ui.press({ key: `detail:${S1}` })
    expect((await ui.find({ key: `detail:${S1}` }))?.text).toBe('✓ 定檔案格式 ▾')
    expect(await ui.find({ type: 'Text', text: '每一行一筆紀錄，帶檢查碼' })).toBeDefined()
    await ui.unmount()
  }
})

test('a_detail_draws_one_row_per_line', ZH, async ($, on) => {
  const w = await start($, on, [...board(), entry('step.detail', { step: S2, detail: '  第一行\r\n\r\n\r\n第二\t行 \u001b[31m ' })])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `detail:${S2}` })
    const rows = await order(ui)
    const at = rows.indexOf('第一行')
    expect(at).toBe(rows.indexOf('● 窗格兩個畫面 ▾') + 1)
    expect(rows.slice(at, at + 3)).toEqual(['第一行', ' ', '第二 行 [31m'])
    expect(rows[at + 3]).toBe('▸ 做完 1 步')
    await ui.unmount()
  }
})

test('a_step_without_a_real_detail_has_no_toggle', ZH, async ($, on) => {
  const w = await start($, on, [...board(), entry('step.add', { item: B, step: { id: S3, title: '改 token 驗證' }, detail: '\u0007  ' })])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    expect(await detailButtons(ui)).toEqual([])
    expect(await ui.find({ type: 'Text', text: '○ 改 token 驗證' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● 窗格兩個畫面' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ 定檔案格式' })).toBeDefined()
    await ui.unmount()
  }
})

test('a_detail_written_later_shows_a_toggle_and_no_change_row', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  // Each surface gives a different step its detail, so each starts without one.
  const later: Record<Surface, { step: string; title: string }> = { terminal: { step: S2, title: '● 窗格兩個畫面' }, desktop: { step: S1, title: '✓ 定檔案格式' } }
  for (const surface of SURFACES) {
    const { step, title } = later[surface]
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    expect(await ui.find({ key: `detail:${step}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    const before = (await ui.find({ type: 'Button', key: `log:${B}` }))?.text
    expect(before).toBe('▸ 變動紀錄（5 筆）')
    const res = await $.tool.call({ tool: tool('update_step'), ops: [{ action: 'detail', step, detail: `兩個畫面各自記得捲到哪 ${surface}` }] })
    expect(res.deny).toBeUndefined()
    expect((await ui.find({ key: `detail:${step}` }))?.text).toBe(`${title} ▸`)
    expect(await ui.find({ type: 'Text', text: title })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: `log:${B}` }))?.text).toBe(before)
    await ui.unmount()
  }
})

test('closed_step_details_add_no_overview_rows', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const bare: Partial<Record<Surface, string[]>> = {}
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    bare[surface] = await order(ui)
    await ui.unmount()
  }
  const res = await $.tool.call({
    tool: tool('update_step'),
    ops: [
      { action: 'detail', step: S1, detail: '每一行一筆紀錄，帶檢查碼' },
      { action: 'detail', step: S2, detail: '上方兩個按鈕切換總表和等你' },
    ],
  })
  expect(res.deny).toBeUndefined()
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    expect((await detailButtons(ui)).sort()).toEqual([`detail:${S1}`, `detail:${S2}`].sort())
    const rows = await order(ui)
    expect(rows.filter(r => r !== '▸').length).toBe(bare[surface]?.length)
    expect(rows.some(r => r.includes('每一行一筆紀錄') || r.includes('上方兩個按鈕'))).toBe(false)
    // The Box a step with a detail draws in is a column with no vertical space of its own, so it adds no blank row.
    const tree = nodes((await ui.drawn()) as Drawn)
    for (const step of [S1, S2]) {
      const box = tree.find(node => node.props?.key === `box:step:${step}`)
      expect(box?.props?.flexDirection).toBe('column')
      for (const side of VERTICAL) expect(box?.props?.[side]).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('opening_details_never_touches_the_log', ZH, async ($, on) => {
  const DETAIL = '上方兩個按鈕切換總表和等你'
  const entries = [...board(), entry('step.detail', { step: S2, detail: DETAIL })]
  const w = await start($, on, entries)
  for (const surface of SURFACES) {
    await fresh($, w)
    let ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const before = w.files[LOG]
    await ui.press({ key: `detail:${S2}` })
    await ui.press({ key: `detail:${S2}` })
    await ui.press({ key: `detail:${S2}` })
    expect(w.files[LOG]).toBe(before)
    expect(localOf(w).expanded).toContain(`detail:${S2}`)

    await $.prompt.submit({ text: '' })
    await ui.unmount()
    ui = await pane($, surface)
    expect((await ui.find({ key: `detail:${S2}` }))?.text).toMatch(/▾$/)
    expect(await ui.find({ type: 'Text', text: DETAIL })).toBeDefined()
    expect(w.files[LOG]).toBe(before)
    await ui.unmount()
  }
  const removed = await $.tool.call({ tool: tool('update_step'), why: '這步不做了', ops: [{ action: 'remove', step: S2 }] })
  expect(removed.deny).toBeUndefined()
  await $.prompt.submit({ text: '' })
  expect(localOf(w).expanded).not.toContain(`detail:${S2}`)
  expect(localOf(w).expanded).toContain(B)
})

// The local-mode half of opening_details_never_touches_the_log: a test registers one world, so it gets its own.
test('opening_details_never_touches_the_local_log', ZH, async ($, on) => {
  const DETAIL = '上方兩個按鈕切換總表和等你'
  const l = await startLocal($, on, [...board(), entry('step.detail', { step: S2, detail: DETAIL })])
  for (const surface of SURFACES) {
    await fresh($, l)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    const before = l.store.get('log:/repo')
    await ui.press({ key: `detail:${S2}` })
    expect(await ui.find({ type: 'Text', text: DETAIL })).toBeDefined()
    expect(localOf(l).expanded).toContain(`detail:${S2}`)
    await ui.press({ key: `detail:${S2}` })
    expect(await ui.find({ type: 'Text', text: DETAIL })).toBeUndefined()
    expect(l.store.get('log:/repo')).toBe(before)
    await ui.unmount()
  }
})

/** The words a card shows top to bottom, as `order` reads them, inside the Box the card draws in. */
async function cardRows(ui: Ui, card: string): Promise<string[]> {
  const box = nodes((await ui.drawn()) as Drawn).find(node => node.props?.key === `card:box:${card}`)
  expect(box).toBeDefined()
  return rowNodes(box as Drawn).map(rowText)
}

/** The Box a Button keyed `key` sits directly in, and the Button's place in it. */
async function boxOfButton(ui: Ui, key: string): Promise<{ box: Drawn; at: number } | undefined> {
  for (const node of nodes((await ui.drawn()) as Drawn)) {
    const at = (node.children ?? []).findIndex(child => typeof child !== 'string' && child.type === 'Button' && child.props?.key === key)
    if (at !== -1) return { box: node, at }
  }
  return undefined
}

test('option_details_open_together_under_each_option', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const added = await $.tool.call({
      tool: tool('add_decision'),
      item: B,
      question: '輸入框上方要不要顯示做完的數量？',
      why: '一列只放得下兩三件事',
      options: [
        { label: '不顯示', effect: '一列保持短', detail: '那列一眼看完，\n但要開窗格才知道做完幾項' },
        { label: '顯示', effect: '一眼看到進度', detail: '那列多幾個字，窄的終端機會被截' },
      ],
    })
    expect(added.deny).toBeUndefined()
    const card = /card (\w{8})/.exec(String(added.result))?.[1] as string
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const toggle = await ui.find({ key: `detail:${card}` })
    expect(toggle?.type).toBe('Button')
    expect(toggle?.text).toBe('▸ 選項細節')
    expect(toggle?.props.hotkey).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '那列一眼看完，' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '那列多幾個字，窄的終端機會被截' })).toBeUndefined()
    // The toggle is the first thing in the options' Box, which keeps its own margin; the toggle adds none.
    const place = await boxOfButton(ui, `detail:${card}`)
    expect(place?.at).toBe(0)
    expect(place?.box.props?.marginTop).toBe(1)
    expect((place?.box.children?.[0] as Drawn).props?.marginTop).toBeUndefined()

    await ui.press({ key: `detail:${card}` })
    expect((await ui.find({ key: `detail:${card}` }))?.text).toBe('▾ 選項細節')
    expect(localOf(w).expanded).toContain(`detail:${card}`)
    const rows = await order(ui)
    expect(rows.indexOf('那列一眼看完，')).toBe(rows.indexOf('一列保持短') + 1)
    expect(rows.indexOf('但要開窗格才知道做完幾項')).toBe(rows.indexOf('那列一眼看完，') + 1)
    expect(rows.indexOf('那列多幾個字，窄的終端機會被截')).toBe(rows.indexOf('一眼看到進度') + 1)
    expect(rows.indexOf('一眼看到進度')).toBe(rows.indexOf('但要開窗格才知道做完幾項') + 2)
    expect(await detailPlace(ui, '那列一眼看完，')).toEqual({ start: 4, bar: DETAIL_BAR })
    expect(await detailPlace(ui, '那列多幾個字，窄的終端機會被截')).toEqual({ start: 4, bar: DETAIL_BAR })

    // Once the pick is sent the card dims: no toggle and no detail, though the toggle was left open.
    await ui.press({ key: `${card}:0` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    expect(await ui.find({ text: '已送出，等 AI 結案' })).toBeDefined()
    expect(await ui.find({ key: `detail:${card}` })).toBeUndefined()
    expect((await texts(ui)).some(text => text.includes('選項細節'))).toBe(false)
    expect(await ui.find({ type: 'Text', text: '那列一眼看完，' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '那列多幾個字，窄的終端機會被截' })).toBeUndefined()
    await ui.unmount()
    expect((await $.tool.call({ tool: tool('resolve_decision'), card, outcome: '不顯示' })).deny).toBeUndefined()
  }
})

test('an_action_card_detail_opens_between_why_and_command', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const card = await addAction($, { item: B, step: S2, detail: '沒人核准就不會跑；\n核准後下一輪自動跑' })
  expect(card).toMatch(ID)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const closed = await order(ui)
    const at = (rows: string[], text: string) => rows.indexOf(text)
    expect(at(closed, '▸ 細節')).toBe(at(closed, '為什麼：新的檢查要人核准才會跑') + 1)
    expect(at(closed, '指令：thoth checks approve')).toBe(at(closed, '▸ 細節') + 1)
    expect((await ui.find({ key: `detail:${card}` }))?.text).toBe('▸ 細節')
    expect(await ui.find({ type: 'Text', text: '沒人核准就不會跑；' })).toBeUndefined()

    await ui.press({ key: `detail:${card}` })
    const opened = await order(ui)
    const toggle = at(opened, '▾ 細節')
    expect(toggle).toBe(at(opened, '為什麼：新的檢查要人核准才會跑') + 1)
    expect(opened.slice(toggle + 1, toggle + 4)).toEqual(['沒人核准就不會跑；', '核准後下一輪自動跑', '指令：thoth checks approve'])
    expect(await detailPlace(ui, '沒人核准就不會跑；')).toEqual({ start: 2, bar: DETAIL_BAR })

    await ui.press({ key: `detail:${card}` })
    expect(await ui.find({ type: 'Text', text: '沒人核准就不會跑；' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a_proposal_detail_opens_under_approve', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const proposed = await $.tool.call({
    tool: tool('propose_change'),
    item: B,
    question: '要加一個文件項目嗎？',
    why: '使用說明沒地方放',
    changes: [{ kind: 'item.add', data: { item: { title: '文件', goal: '使用說明都在一處' } } }],
    detail: '同意之後多一個項目「文件」',
  })
  expect(proposed.deny).toBeUndefined()
  const card = /card (\w{8})/.exec(String(proposed.result))?.[1] as string
  const bare = await $.tool.call({
    tool: tool('propose_change'),
    item: B,
    question: '要加一個範例項目嗎？',
    why: '新手需要範例',
    changes: [{ kind: 'item.add', data: { item: { title: '範例', goal: '有三個範例' } } }],
  })
  const other = /card (\w{8})/.exec(String(bare.result))?.[1] as string
  expect(other).toMatch(ID)
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const rows = await order(ui)
    const toggle = rows.indexOf('▸ 細節')
    expect(toggle).toBe(rows.indexOf('項目 新增「文件」') + 1)
    expect(rows.indexOf('不要')).toBe(toggle + 1)
    expect(rows.indexOf('同意')).toBeLessThan(toggle)
    // The toggle sits in from the approve line as the changes do.
    expect((await boxOfButton(ui, `detail:${card}`))?.box.props?.paddingLeft).toBe(2)
    expect(await ui.find({ type: 'Text', text: '同意之後多一個項目「文件」' })).toBeUndefined()

    await ui.press({ key: `detail:${card}` })
    const opened = await order(ui)
    const at = opened.indexOf('▾ 細節')
    expect(opened.slice(at + 1, at + 3)).toEqual(['同意之後多一個項目「文件」', '不要'])
    expect(await detailPlace(ui, '同意之後多一個項目「文件」')).toEqual({ start: 4, bar: DETAIL_BAR })

    // A proposal without a detail has no toggle, folded or open.
    expect(await ui.find({ key: `detail:${other}` })).toBeUndefined()
    await ui.press({ key: `card:${other}` })
    expect(await ui.find({ key: `${other}:reject` })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `detail:${other}` })).toBeUndefined()
    expect(await detailButtons(ui)).toEqual([`detail:${card}`])
    await ui.unmount()
  }
})

test('a_change_with_a_detail_shows_it_under_the_reason', ZH, async ($, on) => {
  const w = await start($, on, [...board()])
  const proposed = await $.tool.call({
    tool: tool('propose_change'),
    item: B,
    question: '要改做完的樣子嗎？',
    why: '目標寫得太模糊',
    changes: [{ kind: 'item.edit', data: { item: B, goal: '打開窗格三秒內看到進度' } }],
    detail: '同意之後做完的樣子改成量得出來的說法',
  })
  const card = /card (\w{8})/.exec(String(proposed.result))?.[1] as string
  expect((await $.tool.call({ tool: tool('apply_change'), card, chat: '好' })).deny).toBeUndefined()
  const stepped = await $.tool.call({
    tool: tool('update_step'),
    why: '換做法',
    why_detail: '舊做法太慢',
    ops: [
      { action: 'add', item: B, title: '英文說明', detail: '寫給第一次用的人看' },
      { action: 'add', item: B, title: '補測試', detail: '每個畫面都有一個測試' },
    ],
  })
  expect(stepped.deny).toBeUndefined()
  const decided = await add($, '要不要先做英文說明？', { item: B })
  expect((await $.tool.call({ tool: tool('resolve_decision'), card: decided, outcome: '先不做', detail: '等第一版穩定之後再寫' })).deny).toBeUndefined()
  const waiting = await add($, '範例放哪裡？', { item: B })
  expect(waiting).toMatch(ID)

  /** Presses the history line that `line` matches and reads the row after its reason; presses it again to close it. */
  const under = async (ui: Ui, line: RegExp, reason: string): Promise<string | undefined> => {
    const found = await ui.find({ type: 'Button', text: line })
    expect(found).toBeDefined()
    await ui.press({ key: found?.key as string })
    const rows = await order(ui)
    const at = rows.findIndex(row => line.test(row))
    expect(rows[at + 1]).toBe(reason)
    await ui.press({ key: found?.key as string })
    return rows[at + 2]
  }
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await openFolds(ui)
    expect(await under(ui, /項目 修改「決定看板 v1」：做完的樣子改成「打開窗格三秒內看到進度」/, '原因：目標寫得太模糊')).toBe('同意之後做完的樣子改成量得出來的說法')
    expect(await under(ui, /卡片 結案「要改做完的樣子嗎？」/, '原因：目標寫得太模糊')).toBe('同意之後做完的樣子改成量得出來的說法')
    // The two adds fold into one line; opened, each entry shows the call's why_detail under its reason.
    expect(await under(ui, /步驟 新增「英文說明」/, '原因：換做法')).toBe('舊做法太慢')
    expect(await under(ui, /步驟 新增「補測試」/, '原因：換做法')).toBe('舊做法太慢')
    expect(await under(ui, /卡片 結案「要不要先做英文說明？」/, '原因：先不做')).toBe('等第一版穩定之後再寫')
    // An entry without a detail draws as before: the next history line follows its reason.
    expect(await under(ui, /「定檔案格式」→ 做完 · Thoth pass/, '原因：面板測試全過')).toMatch(/^\d\d\/\d\d \d\d:\d\d /)

    // The detail sits four cells in from the history line, two from its reason.
    const line = await ui.find({ type: 'Button', text: /卡片 結案「要不要先做英文說明？」/ })
    await ui.press({ key: line?.key as string })
    expect(await detailPlace(ui, '等第一版穩定之後再寫')).toEqual({ start: 4, bar: DETAIL_BAR })
    expect((await ui.find({ type: 'Text', text: '等第一版穩定之後再寫' }))?.props.dimColor).toBe(true)
    await ui.press({ key: line?.key as string })

    // A card's earlier changes: a single entry opens to its detail; the folded adds stay one plain line.
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `recent:${waiting}` })
    const fold = await ui.find({ type: 'Text', text: /^\d\d\/\d\d \d\d:\d\d 步驟：新增 2 個$/ })
    expect(fold).toBeDefined()
    expect(await ui.findAll({ type: 'Button', text: fold?.text })).toEqual([])
    expect(await under(ui, /卡片 結案「要不要先做英文說明？」/, '原因：先不做')).toBe('等第一版穩定之後再寫')
    expect(await ui.find({ type: 'Text', text: '舊做法太慢' })).toBeUndefined()
    await ui.unmount()
  }
})

test('closed_details_add_at_most_one_row_per_card', ZH, async ($, on) => {
  const QD = 'a0a0a0a0'
  const QN = 'a5a5a5a5'
  const AD = 'b0b0b0b0'
  const AN = 'b5b5b5b5'
  const PD = 'c0c0c0c0'
  const PN = 'c5c5c5c5'
  const action = (id: string, extra: Record<string, unknown> = {}) =>
    entry('card.open', { card: { id, type: 'action', item: B, question: ACTION, why: '新的檢查要人核准', options: [], command: 'thoth checks approve', ...extra } })
  const proposal = (id: string, extra: Record<string, unknown> = {}) =>
    entry('card.open', {
      card: { id, type: 'proposal', item: B, question: '要加手機版嗎？', why: '有人在手機上看', options: [], changes: [{ kind: 'item.add', data: { item: item('11111111', '手機版', '手機上也能看') } }], ...extra },
    })
  const w = await start($, on, [
    ...board(),
    question(QD, {
      item: B,
      options: [
        { label: '不顯示', effect: '一列保持短', detail: '那列一眼看完' },
        { label: '顯示', effect: '一眼看到進度' },
      ],
    }),
    question(QN, { item: B }),
    action(AD, { detail: '沒人核准就不會跑' }),
    action(AN),
    proposal(PD, { detail: '同意之後多一個項目' }),
    proposal(PN),
  ])
  const pairs = [
    [QD, QN],
    [AD, AN],
    [PD, PN],
  ]
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    // Only the card that opens by itself (an action card comes first) has a toggle: a folded card draws none.
    expect(await detailButtons(ui)).toEqual([`detail:${AD}`])
    for (const id of [QD, QN, AN, PD, PN]) await ui.press({ key: `card:${id}` })
    expect((await detailButtons(ui)).sort()).toEqual([`detail:${QD}`, `detail:${AD}`, `detail:${PD}`].sort())
    for (const [withDetail, without] of pairs) {
      const more = await cardRows(ui, withDetail)
      const less = await cardRows(ui, without)
      expect(more.length - less.length).toBe(1)
      expect(more.filter(row => row === '▸ 選項細節' || row === '▸ 細節')).toHaveLength(1)
    }
    // An action card's toggle sits straight in the card's body; a proposal's sits in a Box that holds only the toggle and adds no vertical space.
    expect((await boxOfButton(ui, `detail:${AD}`))?.box.props?.key).toBe(`card:body:${AD}`)
    // The action card's body has the same vertical spacing with a detail as without.
    const boxOf = async (card: string) => nodes((await ui.drawn()) as Drawn).find(node => node.props?.key === `card:body:${card}`)
    const [withBox, withoutBox] = [await boxOf(AD), await boxOf(AN)]
    expect(withBox).toBeDefined()
    expect(withoutBox).toBeDefined()
    for (const side of VERTICAL) expect(withBox?.props?.[side]).toBe(withoutBox?.props?.[side])
    const wrap = (await boxOfButton(ui, `detail:${PD}`))?.box
    expect(wrap?.children).toHaveLength(1)
    for (const side of VERTICAL) expect(wrap?.props?.[side]).toBeUndefined()
    expect((await texts(ui)).some(text => text.includes('那列一眼看完') || text.includes('沒人核准就不會跑') || text.includes('同意之後多一個項目'))).toBe(false)
    await ui.unmount()

    // The row above the prompt draws no toggle and no detail.
    const line = await band($, surface)
    expect((await texts(line)).some(text => text.includes('細節'))).toBe(false)
    await line.unmount()
  }
})

test('each_card_opens_only_its_own_details', ZH, async ($, on) => {
  const w = await start($, on, [
    ...board(),
    entry('step.detail', { step: S2, detail: '上方兩個按鈕切換總表和等你' }),
    question(Q0, {
      item: B,
      question: '總表要不要分頁？',
      options: [
        { label: '分頁', effect: '一頁一個項目', detail: '項目多的時候比較好找' },
        { label: '不分頁', effect: '全部一頁', detail: '捲動就看得到全部' },
      ],
    }),
    question(Q1, {
      item: B,
      step: S2,
      options: [
        { label: '不顯示', effect: '一列保持短', detail: '那列一眼看完' },
        { label: '顯示', effect: '一眼看到進度', detail: '窄的終端機會被截' },
      ],
    }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    await ui.press({ key: `card:${Q1}` })
    expect((await ui.find({ key: `detail:${Q1}` }))?.text).toBe('▸ 選項細節')

    await ui.press({ key: `detail:${Q0}` })
    expect((await ui.find({ key: `detail:${Q0}` }))?.text).toBe('▾ 選項細節')
    expect(await ui.find({ type: 'Text', text: '項目多的時候比較好找' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '捲動就看得到全部' })).toBeDefined()
    expect((await ui.find({ key: `detail:${Q1}` }))?.text).toBe('▸ 選項細節')
    expect(await ui.find({ type: 'Text', text: '那列一眼看完' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '窄的終端機會被截' })).toBeUndefined()
    expect(localOf(w).expanded).toContain(`detail:${Q0}`)
    expect(localOf(w).expanded).not.toContain(`detail:${Q1}`)
    expect(localOf(w).expanded).not.toContain(`detail:${S2}`)

    // The second card opens on its own press and leaves the first as it is.
    await ui.press({ key: `detail:${Q1}` })
    expect(await ui.find({ type: 'Text', text: '那列一眼看完' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '項目多的時候比較好找' })).toBeDefined()
    await ui.press({ key: `detail:${Q0}` })
    expect(await ui.find({ type: 'Text', text: '項目多的時候比較好找' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '那列一眼看完' })).toBeDefined()
    expect(localOf(w).expanded).not.toContain(`detail:${S2}`)

    // The step the second card points to stays closed in the overview.
    await ui.press({ key: 'view:overview' })
    await ui.press({ key: `item:${B}` })
    expect((await ui.find({ key: `detail:${S2}` }))?.text).toMatch(/▸$/)
    expect(await ui.find({ type: 'Text', text: '上方兩個按鈕切換總表和等你' })).toBeUndefined()
    await ui.unmount()
  }
})

/** The theme keys of the design's section 4, the only colours the pane may name. */
const THEME_KEYS = ['suggestion', 'warning', 'success', 'inactive', 'subtle']

/** Every board the overview and the cards can show, opened all the way: each item, fold, history row, card and detail, one card staged and one sent. */
async function everythingOpen($: Engine, w: World, surface: Surface): Promise<Ui> {
  await fresh($, w)
  const ui = await pane($, surface)
  await ui.press({ key: 'group:done' })
  for (const id of [A, B, C, D]) await ui.press({ key: `item:${id}` })
  await openFolds(ui)
  await pressDetails(ui)
  await pressHistoryRows(ui)
  return ui
}

test('colours_are_theme_keys_only', ZH, async ($, on) => {
  const w = await start($, on, [...everything(), ...detailed()])
  for (const surface of SURFACES) {
    const ui = await everythingOpen($, w, surface)
    const trees = [(await ui.drawn()) as Drawn]
    await ui.press({ key: 'view:cards' })
    for (const id of [Q1, Q2, P1, D_QUESTION, D_ACTION, D_PROPOSAL]) await ui.press({ key: `card:${id}` })
    await pressDetails(ui)
    await ui.press({ key: `${Q2}:0` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    await ui.press({ key: `${P1}:approve` })
    trees.push((await ui.drawn()) as Drawn)
    const line = await band($, surface)
    trees.push((await line.drawn()) as Drawn)
    await line.unmount()
    // The pills are there, in each of their tones.
    const pills = trees.flatMap(tree => nodes(tree)).filter(node => node.props?.inverse === true)
    expect([...new Set(pills.map(node => node.props?.color))].sort()).toEqual(['success', 'suggestion', 'warning'])
    for (const node of trees.flatMap(tree => nodes(tree))) {
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        if (node.props?.[prop] !== undefined) expect(THEME_KEYS).toContain(node.props[prop])
      }
      // A fill only on the 1-cell bars, which hold nothing.
      if (node.props?.backgroundColor !== undefined) {
        expect({ type: node.type, width: node.props.width, children: node.children ?? [] }).toEqual({ type: 'Box', width: 1, children: [] })
      }
      // A pill is inverse words in a theme key, never bold.
      if (node.props?.inverse === true) {
        expect(node.type).toBe('Text')
        expect(node.props.bold).toBeUndefined()
      }
      // None of what the engine refuses: one-sided borders, a border style object, a Box or a fill in a Button.
      for (const side of ['borderLeft', 'borderRight', 'borderTop', 'borderBottom']) expect(node.props?.[side]).toBeUndefined()
      expect(typeof node.props?.borderStyle === 'object').toBe(false)
      if (node.type === 'Button') {
        expect(node.props?.backgroundColor).toBeUndefined()
        expect(nodes(node).filter(inside => inside.type === 'Box')).toEqual([])
      }
    }
    await ui.unmount()
    // fresh() forgets the pick and the send, so the next surface starts from the same board.
    w.submitted.length = 0
  }
})

/** The cells a row of parts takes: their words and the Box's gaps. */
const rowWidth = (box: Drawn): number => {
  const parts = (box.children ?? []).filter(child => typeof child !== 'string') as Drawn[]
  return parts.reduce((n, part) => n + textWidth(shown(part)), 0) + Number(box.props?.gap ?? 0) * (parts.length - 1)
}

/** A done item A, B in progress (1 of 2 done), C next with one step to do, D later without steps. */
const states = () => [
  ...board(),
  entry('item.add', { item: item(A, '舊卡片搬過來', '舊的決定都在新看板') }),
  entry('step.add', { item: A, step: { id: S0, title: '搬舊資料' } }),
  entry('step.status', { step: S0, status: 'done', result: '搬完了' }),
  entry('step.add', { item: C, step: { id: S3, title: '第一次打開' } }),
]

test('an_item_row_shows_its_state_a_bar_and_the_count', ZH, async ($, on) => {
  const w = await start($, on, states())
  const ink = (n: number, tone: string, cells: number) =>
    word([word('[', { dimColor: true }), ...(n > 0 ? [word('█'.repeat(n), { color: tone })] : []), ...(n < cells ? [' '.repeat(cells - n)] : []), word(']', { dimColor: true })])
  const right = async (ui: Ui, id: string) => bare(await boxKeyed(ui, `state:${id}`))
  const row = (id: string, ...parts: Drawn[]) => ({ type: 'Box', props: { key: `state:${id}`, flexShrink: 0, gap: 1 }, children: parts })
  const doing = word(' 進行中 ', { inverse: true, color: 'suggestion' })
  for (const surface of SURFACES) {
    // 49 cells, docked: a bar of 4; the right side of an item in progress takes 19 cells.
    await fresh($, w)
    let ui = await pane($, surface, 49)
    await ui.press({ key: 'group:done' })
    expect(await right(ui, B)).toEqual(row(B, doing, ink(2, 'suggestion', 4), word('1/2')))
    expect(await right(ui, C)).toEqual(row(C, word('下一個'), ink(0, 'suggestion', 4), word('0/1')))
    expect(await right(ui, D)).toEqual(row(D, word('之後', { dimColor: true })))
    expect(await right(ui, A)).toEqual(row(A, word(' 做完 ', { inverse: true, color: 'success' }), ink(4, 'success', 4), word('1/1')))
    expect(rowWidth((await boxKeyed(ui, `state:${B}`)) as Drawn)).toBe(19)
    // The title is the toggle, bold after its arrow; the button keeps its key and label.
    const title = await boxOfButton(ui, `item:${B}`)
    expect(bare(title?.box.children?.[title.at] as Drawn)).toEqual({
      type: 'Button',
      props: { key: `item:${B}`, label: '▸ 決定看板 v1 · 進行中', plain: true },
      children: ['▸ ', word('決定看板 v1', BOLD[surface])],
    })
    // A title shrinks and wraps; the right side keeps its width.
    expect(title?.box.props).toEqual({ flexShrink: 1 })
    expect((await boxKeyed(ui, `box:item:${B}`))?.props?.marginBottom).toBeUndefined()
    await ui.press({ key: `item:${B}` })
    // An open item has a blank row under it; the closed ones sit one under another.
    expect((await boxKeyed(ui, `box:item:${B}`))?.props?.marginBottom).toBe(1)
    expect((await boxKeyed(ui, `box:item:${C}`))?.props?.marginBottom).toBeUndefined()
    await ui.unmount()

    // Wide: a bar of 8. Narrow: the number alone.
    ui = await pane($, surface, 100)
    expect(await right(ui, B)).toEqual(row(B, doing, ink(4, 'suggestion', 8), word('1/2')))
    expect(await right(ui, C)).toEqual(row(C, word('下一個'), ink(0, 'suggestion', 8), word('0/1')))
    await ui.unmount()
    ui = await pane($, surface, 39)
    expect(await right(ui, B)).toEqual(row(B, doing, word('1/2')))
    expect(await right(ui, C)).toEqual(row(C, word('下一個'), word('0/1')))
    await ui.unmount()
  }
})

test('an_item_row_in_english_keeps_its_right_side_within_24_cells', async ($, on) => {
  const w = await start($, on, states())
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface, 49)
    const right = (await boxKeyed(ui, `state:${B}`)) as Drawn
    expect((right.children ?? []).map(child => shown(child))).toEqual([' in progress ', '[██  ]', '1/2'])
    expect(rowWidth(right)).toBe(24)
    expect(shown((await boxKeyed(ui, `state:${C}`)) as Drawn)).toBe('next[    ]0/1')
    expect(shown((await boxKeyed(ui, `state:${D}`)) as Drawn)).toBe('later')
    await ui.unmount()
  }
})

test('a_step_row_colours_its_mark_and_puts_notes_and_waits_on_lines_below', ZH, async ($, on) => {
  const w = await start($, on, [
    ...board(),
    blockedOnS2(),
    entry('step.assign', { step: S2, to: 'claude-b' }),
    entry('step.note', { step: S2, note: '等 Thoth 審查' }),
    entry('step.add', { item: B, step: { id: S3, title: '輸入框上方一列' } }),
  ])
  let blocker = Q1
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    const first = async (step: string) => bare(((await boxKeyed(ui, `step:${step}`))?.children ?? [])[0] as Drawn)
    // The first line: the mark in its colour, then the title, bold while in progress and dim otherwise; who it is given to on the right, dim.
    expect(await first(S2)).toEqual({ type: 'Box', props: { flexShrink: 1 }, children: [word([word('⚑', { color: 'warning' }), ' ', word('窗格兩個畫面', BOLD[surface])], { wrap: 'wrap' })] })
    expect(await first(S3)).toEqual({ type: 'Box', props: { flexShrink: 1 }, children: [word([word('○', { dimColor: true }), ' ', word('輸入框上方一列', { dimColor: true })], { wrap: 'wrap' })] })
    expect(await first(S1)).toEqual({ type: 'Box', props: { flexShrink: 1 }, children: [word([word('✓', { color: 'success' }), ' ', word('定檔案格式', { dimColor: true })], { wrap: 'wrap' })] })
    expect(bare(await boxKeyed(ui, `step:${S2}`))).toMatchObject({ props: { key: `step:${S2}`, flexDirection: 'row', justifyContent: 'space-between', gap: 2 } })
    expect(bare(((await boxKeyed(ui, `step:${S2}`))?.children ?? [])[1] as Drawn)).toEqual({ type: 'Box', props: { flexShrink: 0 }, children: [word('派給 claude-b', { dimColor: true })] })
    // From the second line, four cells in: the note dim, what waits for the user in amber, the AI's or Thoth's report dim.
    const below = async (step: string) => bare(((await boxKeyed(ui, `box:step:${step}`))?.children ?? [])[1] as Drawn)
    expect(await below(S2)).toEqual({
      type: 'Box',
      props: { flexDirection: 'column', paddingLeft: 4 },
      children: [word('等 Thoth 審查', { dimColor: true, wrap: 'wrap' }), word('等你決定：輸入框上方要不要顯示做完的數量？', { color: 'warning', wrap: 'wrap' })],
    })
    expect(await below(S1)).toEqual({ type: 'Box', props: { flexDirection: 'column', paddingLeft: 4 }, children: [word('Thoth pass', { dimColor: true, wrap: 'wrap' })] })
    // A step with nothing more draws one line.
    expect((await boxKeyed(ui, `box:step:${S3}`))?.children).toHaveLength(1)
    // An in-progress step that waits on nothing has a blue ●.
    await $.tool.call({ tool: tool('resolve_decision'), card: blocker, outcome: '不顯示' })
    expect(((await first(S2)) as { children: Drawn[] }).children[0]).toEqual(word([word('●', { color: 'suggestion' }), ' ', word('窗格兩個畫面', BOLD[surface])], { wrap: 'wrap' }))
    await ui.unmount()
    blocker = await add($, '輸入框上方要不要顯示做完的數量？', { item: B, step: S2 })
  }
})

test('a_step_title_with_a_detail_is_the_toggle_and_draws_its_mark_in_colour', ZH, async ($, on) => {
  const w = await start($, on, [
    ...board(),
    entry('step.detail', { step: S2, detail: STEP_DETAIL }),
    entry('step.repo', { step: S1, repo: AUTH }),
    entry('step.detail', { step: S1, detail: '每一行一筆紀錄，帶檢查碼' }),
  ])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    await ui.press({ key: `steps:${B}` })
    // Untagged: the mark sits in the button with the title; the label stays as 0.5.0 wrote it.
    const untagged = await boxOfButton(ui, `detail:${S2}`)
    expect(bare(untagged?.box.children?.[untagged.at] as Drawn)).toEqual({
      type: 'Button',
      props: { key: `detail:${S2}`, label: '● 窗格兩個畫面 ▸', plain: true },
      children: [word('●', { color: 'suggestion' }), ' ', word('窗格兩個畫面', BOLD[surface]), word(' ▸', { dimColor: true })],
    })
    // Tagged: the mark and the repo stay outside; only the title is pressed.
    const tagged = await boxOfButton(ui, `detail:${S1}`)
    expect(bare(tagged?.box as Drawn)).toEqual({
      type: 'Box',
      props: { flexDirection: 'row', gap: 1, flexShrink: 1 },
      children: [
        word('✓', { color: 'success' }),
        word('auth-center ·', { dimColor: true }),
        { type: 'Button', props: { key: `detail:${S1}`, label: '定檔案格式 ▸', plain: true }, children: [word('定檔案格式', { dimColor: true }), word(' ▸', { dimColor: true })] },
      ],
    })
    await ui.press({ key: `detail:${S1}` })
    expect((await ui.find({ key: `detail:${S1}` }))?.text).toBe('定檔案格式 ▾')
    expect(await detailPlace(ui, '每一行一筆紀錄，帶檢查碼')).toEqual({ start: 2, bar: DETAIL_BAR })
    await ui.unmount()
  }
})

test('history_rows_dim_their_time_and_folds_are_dim', ZH, async ($, on) => {
  const entries = [...board(), entry('item.edit', { item: B, goal: '總表和卡片都看得到' }, { why: '' })]
  const w = await start($, on, entries)
  const doneS1 = entries[5]
  const quiet = entries[7]
  const fold = `fold:${B}:${entries[3].id}`
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: `item:${B}` })
    // The lines that open what is folded are dim.
    for (const key of [`steps:${B}`, `log:${B}`]) expect((await ui.find({ type: 'Button', key }))?.props.dimColor).toBe(true)
    await ui.press({ key: `log:${B}` })
    await ui.press({ key: fold })
    const time = stamp(doneS1.at)
    // A row with a reason: the time dim, the change in plain words, a dim arrow at the end; the label is the line as before.
    const row = await ui.find({ type: 'Button', key: `log:${B}:${doneS1.id}` })
    expect(row?.props.label).toBe(`${time} 步驟 「定檔案格式」→ 做完 · Thoth pass`)
    expect(row?.children).toEqual([word(time, { dimColor: true }), ' 步驟 「定檔案格式」→ 做完 · Thoth pass', word(' ▸', { dimColor: true })])
    await ui.press({ key: `log:${B}:${doneS1.id}` })
    expect((await ui.find({ type: 'Button', key: `log:${B}:${doneS1.id}` }))?.children).toEqual([
      word(time, { dimColor: true }),
      ' 步驟 「定檔案格式」→ 做完 · Thoth pass',
      word(' ▾', { dimColor: true }),
    ])
    // A row with nothing to open has no arrow.
    expect((await ui.find({ type: 'Button', key: `log:${B}:${quiet.id}` }))?.children).toEqual([
      word(stamp(quiet.at), { dimColor: true }),
      ' 項目 修改「決定看板 v1」：做完的樣子改成「總表和卡片都看得到」',
    ])
    // A fold of step changes: the time dim, then its arrow and what it holds.
    expect((await ui.find({ type: 'Button', key: fold }))?.children).toEqual([word(stamp(entries[3].at), { dimColor: true }), ' ▾ 步驟：新增 2 個、做完 1 個、開始 1 個'])
    await ui.unmount()
  }
})

/** Five cards in the order they are shown: an action card (first, open by itself), a blocking question, a proposal, two loose questions. */
const QB = 'e6e6e6e6'
const Q3 = 'e7e7e7e7'
const AC = '5a5a5a5a'
const fiveCards = () => [
  ...board(),
  entry('card.open', { card: { id: AC, type: 'action', item: B, question: ACTION, why: '新的檢查要人核准', options: [], command: 'thoth checks approve' } }),
  question(QB, { item: B, step: S2, blocking: true, question: '先做哪一個畫面？' }),
  entry('card.open', {
    card: { id: P1, type: 'proposal', item: B, question: '要加手機版嗎？', why: '有人在手機上看', options: [], changes: [{ kind: 'item.add', data: { item: item('11111111', '手機版', '手機上也能看') } }] },
  }),
  loose(),
  question(Q3, { question: '通知要不要附聲音？', options: [{ label: '要', effect: '聽得到' }, { label: '不要', effect: '安靜' }] }),
]

test('cards_draw_a_line_in_the_colour_of_their_state_and_a_header_naming_their_kind', ZH, async ($, on) => {
  const w = await start($, on, fiveCards())
  /** The card's Box: the 1-cell line, then the body. */
  const frame = async (ui: Ui, id: string) => {
    const box = (await boxKeyed(ui, `card:box:${id}`)) as Drawn
    const [line, body] = (box.children ?? []) as Drawn[]
    return { box: box.props, line: bare(line), body: body.props }
  }
  const framed = (id: string, tone: string) => ({
    box: { key: `card:box:${id}`, flexDirection: 'row', alignItems: 'stretch', marginBottom: 1 },
    line: { type: 'Box', props: { key: `card:line:${id}`, width: 1, flexShrink: 0, backgroundColor: tone } },
    body: { key: `card:body:${id}`, flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingLeft: 1 },
  })
  /** The header row: the kind on the left, the ✕ on the right. */
  const header = async (ui: Ui, id: string) => {
    const place = await boxOfButton(ui, `${id}:x`)
    return { key: place?.box.props?.key, kind: bare(((place?.box.children ?? [])[0] as Drawn).children?.[0] as Drawn), x: place?.at, first: (await cardRows(ui, id))[0] }
  }
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    // The first card: an amber line and an amber pill naming what it asks.
    expect(await frame(ui, AC)).toEqual(framed(AC, 'warning'))
    expect(await header(ui, AC)).toEqual({ key: `card:head:${AC}`, kind: word(' ⚑ 要你動手 ', { inverse: true, color: 'warning' }), x: 1, first: ' ⚑ 要你動手 ' })
    // A folded card: a grey line, its question after ▸ (the label stays the question), then where it sits.
    expect(await frame(ui, Q2)).toEqual(framed(Q2, 'inactive'))
    expect(bare((await ui.find({ type: 'Button', key: `card:${Q2}` })) as unknown as Drawn)).toEqual({
      type: 'Button',
      props: { key: `card:${Q2}`, label: '要不要加英文文件？', plain: true },
      children: ['▸ 要不要加英文文件？'],
    })
    expect(await cardRows(ui, Q2)).toEqual(['要不要加英文文件？', '其他'])

    // Open, the other cards name their kind in their line's colour, without a fill.
    for (const id of [QB, P1, Q2, Q3]) await ui.press({ key: `card:${id}` })
    expect(await header(ui, QB)).toEqual({ key: `card:head:${QB}`, kind: word('⚑ 要你現在決定', { color: 'inactive' }), x: 1, first: '⚑ 要你現在決定' })
    expect(await header(ui, Q2)).toEqual({ key: `card:head:${Q2}`, kind: word('⚑ 要你決定', { color: 'inactive' }), x: 1, first: '⚑ 要你決定' })
    expect((await header(ui, P1)).kind).toEqual(word('提案', { color: 'inactive' }))
    // Under the header: where the card sits, then its question.
    expect((await cardRows(ui, Q2)).slice(0, 4)).toEqual(['⚑ 要你決定', '✕', '其他', '要不要加英文文件？'])
    expect((await cardRows(ui, AC)).slice(0, 4)).toEqual([' ⚑ 要你動手 ', '✕', '決定看板 v1', ACTION])

    // Staged: a green line and header. Sent: a faint line, every word dim, no header.
    await ui.press({ key: `${Q3}:0` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    await ui.press({ key: `${P1}:approve` })
    expect(await frame(ui, P1)).toEqual(framed(P1, 'success'))
    expect((await header(ui, P1)).kind).toEqual(word('提案', { color: 'success' }))
    expect(await frame(ui, Q3)).toEqual(framed(Q3, 'subtle'))
    expect(await cardRows(ui, Q3)).toEqual(['通知要不要附聲音？', '其他', '已送出，等 AI 結案'])
    const sent = rowNodes((await boxKeyed(ui, `card:body:${Q3}`)) as Drawn)
    expect(sent.map(node => node.props?.dimColor)).toEqual([true, true, true])
    expect(await boxKeyed(ui, `card:head:${Q3}`)).toBeUndefined()
    await ui.unmount()
    w.submitted.length = 0
  }
})

test('a_blocking_first_card_says_decide_now_in_its_pill', ZH, async ($, on) => {
  const w = await start($, on, [...board(), question(QB, { item: B, step: S2, blocking: true, question: '先做哪一個畫面？' }), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    expect((await cardRows(ui, QB))[0]).toBe(' ⚑ 要你現在決定 ')
    expect(bare(await ui.find({ type: 'Text', text: ' ⚑ 要你現在決定 ' }))).toEqual(word(' ⚑ 要你現在決定 ', { inverse: true, color: 'warning' }))
    await ui.press({ key: `card:${Q2}` })
    expect(bare(await ui.find({ type: 'Text', text: '⚑ 要你決定' }))).toEqual(word('⚑ 要你決定', { color: 'inactive' }))
    await ui.unmount()
  }
})

test('options_draw_a_recommended_pill_a_picked_mark_and_effects_under_the_name', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2(), loose()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const ui = await pane($, surface)
    await ui.press({ key: 'view:cards' })
    const option = async (key: string) => bare((await ui.find({ type: 'Button', key })) as unknown as Drawn)
    // The first card: the engine draws "1:" before the name; the recommended one ends with a blue pill; the label stays as it was.
    expect(await option(`${Q1}:0`)).toEqual({
      type: 'Button',
      props: { key: `${Q1}:0`, label: '不顯示（建議）', plain: true, hotkey: '1' },
      children: [word('不顯示'), ' ', word(' 建議 ', { inverse: true, color: 'suggestion' })],
    })
    expect(await option(`${Q1}:1`)).toEqual({ type: 'Button', props: { key: `${Q1}:1`, label: '顯示', plain: true, hotkey: '2' }, children: [word('顯示')] })
    // The effect starts under the name's first character: three cells after "1: ".
    expect((await parentOf(ui, '一列保持短 · 做完的在總表看'))?.box.props).toEqual({ paddingLeft: 3 })
    expect((await ui.find({ type: 'Text', text: '一列保持短 · 做完的在總表看' }))?.props).toEqual({ dimColor: true, wrap: 'wrap' })
    // Picked: "● " and green, and the staged line in green.
    await ui.press({ key: `${Q1}:0` })
    expect(await option(`${Q1}:0`)).toEqual({
      type: 'Button',
      props: { key: `${Q1}:0`, label: '● 不顯示（建議）', plain: true, hotkey: '1' },
      children: [word('● 不顯示', { color: 'success' }), ' ', word(' 建議 ', { inverse: true, color: 'suggestion' })],
    })
    expect(bare(await ui.find({ type: 'Text', text: '已選：不顯示（待送出）' }))).toEqual(word('已選：不顯示（待送出）', { color: 'success', wrap: 'wrap' }))
    // Another card: "› " before the name, the effect two cells in.
    await ui.press({ key: `card:${Q2}` })
    expect(await option(`${Q2}:0`)).toEqual({ type: 'Button', props: { key: `${Q2}:0`, label: '› 加', plain: true }, children: [word('› 加')] })
    expect((await parentOf(ui, '多一份文件'))?.box.props).toEqual({ paddingLeft: 2 })
    await ui.unmount()
  }
})

test('status_reads_without_colour', ZH, async ($, on) => {
  const w = await start($, on, [...everything(), ...detailed()])
  const marks = ['✓', '●', '○', '⚑']
  const stateWords = ['進行中', '做完', '下一個', '之後']
  const kinds = ['⚑ 要你決定', '⚑ 要你現在決定', '⚑ 要你動手', '提案']
  for (const surface of SURFACES) {
    const ui = await everythingOpen($, w, surface)
    const tree = nodes((await ui.drawn()) as Drawn)
    // Every step's first line starts with its mark, every item's right side with its state, in words.
    const steps = tree.filter(node => /^step:/.test(String(node.props?.key)))
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect(marks).toContain(shown(((step.children ?? [])[0] as Drawn)).slice(0, 1))
    const items = tree.filter(node => /^state:/.test(String(node.props?.key)))
    expect(items).toHaveLength(4)
    for (const right of items) expect(stateWords).toContain(shown(((right.children ?? [])[0] as Drawn)).trim())

    await ui.press({ key: 'view:cards' })
    for (const id of [Q1, Q2, P1, D_QUESTION, D_ACTION, D_PROPOSAL]) await ui.press({ key: `card:${id}` })
    await ui.press({ key: `${Q2}:0` })
    await ui.press({ key: 'send' })
    await until(ui, () => w.submitted.length > 0)
    await ui.press({ key: `${P1}:approve` })
    // Every open card names its kind; the staged one says it is picked, the sent one that it is sent.
    for (const id of ['5a5a5a5a', Q1, P1, D_QUESTION, D_ACTION, D_PROPOSAL]) expect(kinds).toContain((await cardRows(ui, id))[0].trim())
    expect((await cardRows(ui, P1)).filter(row => row.startsWith('已選：'))).toEqual(['已選：同意（待送出）'])
    expect((await cardRows(ui, Q2)).filter(row => row.startsWith('已送出'))).toEqual(['已送出，等 AI 結案'])
    await ui.unmount()
    w.submitted.length = 0
  }
})
