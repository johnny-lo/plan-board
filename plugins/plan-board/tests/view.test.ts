import { expect, test } from 'claude-code/testing'

import { sha16 } from '../hooks/checksum.ts'
import { GUIDE, summary } from '../hooks/guide.ts'
import { emptyPlan, replay } from '../hooks/replay.ts'
import { bandCounts, blockedSteps, cardPosition, foldHistory, historyOf, isChatter, itemStates, openCards, recentFor, repoLabel } from '../hooks/view.ts'
import { entry, logText } from './fixtures.ts'
import type { Entry, Local } from '../types'

const emptyLocal: Local = { staged: {}, sent: {}, expanded: [], view: 'overview' }
const item = (id: string, title = id, goal = `${id} goal`) => ({ id, title, goal })
const step = (it: string, id: string, title = id): Entry => entry('step.add', { item: it, step: { id, title } })
const status = (id: string, s: 'todo' | 'doing' | 'done', extra: Partial<Entry> = {}): Entry =>
  entry('step.status', { step: id, status: s, result: 'ok' }, extra)
const card = (id: string, extra: Record<string, unknown> = {}): Entry =>
  entry('card.open', { card: { id, type: 'question', question: `q-${id}`, why: 'w', options: [], ...extra } })

test('item_states', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      entry('item.add', { item: item('C') }),
      entry('item.add', { item: item('D') }),
      entry('item.add', { item: item('E') }),
      step('A', 'a1'),
      step('A', 'a2'),
      step('B', 'b1'),
      step('B', 'b2'),
      step('C', 'c1'),
      step('E', 'e1'),
      status('a1', 'done'),
      status('a2', 'done'),
      status('b1', 'done'),
    ]),
  )
  expect(itemStates(plan)).toEqual({ A: 'done', B: 'doing', C: 'next', D: 'later', E: 'later' })
})

test('blocked_steps_and_open_cards_order', async () => {
  const base = [
    entry('item.add', { item: item('A') }),
    entry('item.add', { item: item('B') }),
    step('A', 's1'),
    step('B', 's2'),
    card('c-none'),
    card('c-b', { item: 'B', step: 's2' }),
    card('c-a', { item: 'A' }),
    card('c-block', { item: 'B', blocking: true }),
  ]
  const plan = await replay(await logText(base))
  expect(blockedSteps(plan).has('s2')).toBe(true)
  expect(blockedSteps(plan).has('s1')).toBe(false)
  expect(openCards(plan).map(c => c.id)).toEqual(['c-block', 'c-a', 'c-b', 'c-none'])

  const more = await replay(
    await logText([
      ...base,
      entry('item.remove', { item: 'A' }),
      entry('card.resolve', { card: 'c-b', outcome: 'done' }),
    ]),
  )
  expect(blockedSteps(more).has('s2')).toBe(false)
  expect(openCards(more).map(c => c.id)).toEqual(['c-block', 'c-none', 'c-a'])
})

test('card_position', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('item.add', { item: item('B') }),
    step('B', 's3'),
    card('c1', { item: 'B', step: 's3' }),
  ]
  const plan = await replay(await logText(entries))
  const pos = cardPosition(plan, plan.cards.c1)
  expect(pos.item?.id).toBe('B')
  expect(pos.index).toBe(2)
  expect(pos.step?.id).toBe('s3')

  const stepGone = await replay(await logText([...entries, entry('step.remove', { step: 's3' })]))
  const p2 = cardPosition(stepGone, stepGone.cards.c1)
  expect(p2.item?.id).toBe('B')
  expect(p2.step).toBeUndefined()

  const gone = await replay(await logText([...entries, entry('item.remove', { item: 'B' })]))
  expect(cardPosition(gone, gone.cards.c1)).toEqual({})
})

test('history_newest_first_without_self', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      step('A', 's1'),
      step('A', 's2'),
      card('c1', { item: 'A' }),
      step('A', 's3'),
      step('A', 's4'),
    ]),
  )
  const history = historyOf(plan, 'A')
  expect(history.length).toBe(6)
  expect(history[0].at > history[1].at).toBe(true)
  expect(history[history.length - 1].kind).toBe('item.add')
  const recent = recentFor(plan, plan.cards.c1, 3)
  // The card's own opening is left out, so the steps on both sides of it fold into one row.
  expect(recent.map(row => row.kind)).toEqual(['fold', 'entry'])
  const [fold, first] = recent
  if (fold.kind !== 'fold' || first.kind !== 'entry') throw new Error('unreachable')
  expect(fold.entries.map(e => e.kind)).toEqual(['step.add', 'step.add', 'step.add', 'step.add'])
  expect(fold.entries[0]).toEqual(history[0])
  expect(first.entry.kind).toBe('item.add')
  expect(recentFor(plan, { ...plan.cards.c1, item: undefined }, 3)).toEqual([])
})

test('band_counts', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('item.add', { item: item('B') }),
      step('A', 'a1'),
      status('a1', 'doing'),
      card('c1'),
      card('c2'),
    ]),
  )
  expect(bandCounts(plan, emptyLocal)).toEqual({ doing: 1, waiting: 2, isEdited: false })
  const local: Local = { ...emptyLocal, sent: { c1: { choice: '1', at: 1 } } }
  expect(bandCounts(plan, local).waiting).toBe(1)
  const flagged = await replay('oops\n')
  expect(bandCounts(flagged, emptyLocal).isEdited).toBe(true)
})

test('summary_lists_items_cards_and_edits', async () => {
  const text =
    (await logText([
      entry('item.add', { item: item('A', '決定看板 v1', '總表看得到') }),
      entry('item.add', { item: item('B', 'next one') }),
      step('A', 's1', 'first'),
      step('A', 's2', 'second'),
      entry('step.status', { step: 's1', status: 'done' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.assign', { step: 's2', to: 'bob' }),
      entry('card.open', {
        card: { id: 'c1', type: 'proposal', question: 'add docs?', why: 'w', options: [], blocking: true, step: 's2', item: 'A', changes: [] },
      }),
      card('c2'),
      entry('item.remove', { item: 'nope' }),
    ])) + 'oops\n'
  const plan = await replay(text)
  const out = summary(plan, { ...emptyLocal, sent: { c2: { choice: '1', at: 1 } } })
  expect(out).toContain('1. [A] 決定看板 v1 — in progress')
  expect(out).toContain('  - [s1] ')
  expect(out).toContain('thoth T1')
  expect(out).toContain('assigned to bob')
  expect(out).toContain('blocked by card c1')
  expect(out).toContain('{proposal} (blocking)')
  expect(out).toContain('(sent, waiting for you to resolve)')
  expect(out).toContain('Directly edited lines: 1')
  expect(out).toContain('Skipped entries:')
  expect(out).toContain('2. [B] next one — next')
})

test('summary_of_empty_plan', async () => {
  expect(summary(emptyPlan(), emptyLocal)).toBe('Plan storage: repo (plan/log.jsonl)\nNo plan yet in plan/log.jsonl.')
  expect(summary(await replay('', 'local'), emptyLocal)).toBe(
    'Plan storage: this machine only (run /plan init to keep it in the repo)\nNo plan yet.',
  )
})

test('summary_starts_with_the_storage_line', async () => {
  const text = await logText([entry('item.add', { item: item('A', 'Setup') }), card('c1')])
  const repo = summary(await replay(text), emptyLocal)
  expect(repo.split('\n')[0]).toBe('Plan storage: repo (plan/log.jsonl)')
  expect(repo).toContain('1. [A] Setup')
  const local = summary(await replay(text, 'local'), emptyLocal)
  expect(local.split('\n')[0]).toBe('Plan storage: this machine only (run /plan init to keep it in the repo)')
  expect(local).toContain('1. [A] Setup')
  expect(local).toContain('Open cards:')
})

test('summary_lists_docs_after_the_goal', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A', 'Setup', 'it works') }),
      entry('item.add', { item: item('B', 'Later') }),
      entry('item.link', { item: 'A', doc: 'docs/superpowers/specs/setup.md' }),
      entry('item.link', { item: 'A', doc: 'docs/superpowers/plans/setup.md' }),
    ]),
  )
  const out = summary(plan, emptyLocal)
  const line = out.split('\n').find(l => l.includes('[A]')) as string
  expect(line.indexOf('goal: it works')).toBeGreaterThan(-1)
  expect(line.indexOf('docs: docs/superpowers/specs/setup.md, docs/superpowers/plans/setup.md')).toBeGreaterThan(line.indexOf('goal: it works'))
  expect(out.split('\n').find(l => l.includes('[B]'))).not.toContain('docs')
})

test('summary_keeps_the_raw_assignee', async () => {
  const ulid = '01jf0e1d2c3b4a59687f0e1d2c'
  const plan = await replay(
    await logText([entry('item.add', { item: item('A') }), step('A', 's1'), entry('step.assign', { step: 's1', to: ulid })]),
  )
  expect(summary(plan, emptyLocal)).toContain(`assigned to ${ulid}`)
})

test('a_thought_only_card_still_counts_as_waiting', async () => {
  const plan = await replay(await logText([entry('item.add', { item: item('A') }), card('c1'), card('c2'), card('c3')]))
  const local: Local = {
    ...emptyLocal,
    sent: {
      c1: { draft: 'let me think', at: 1 },
      c2: { choice: 'a', at: 1 },
      c3: { isDismissed: true, at: 1 },
    },
  }
  expect(bandCounts(plan, local).waiting).toBe(1)
  expect(bandCounts(plan, { ...emptyLocal, sent: { c1: { draft: 'x', at: 1 } } }).waiting).toBe(3)
  const told = summary(plan, local)
  expect(told).toContain('[c1] q-c1 {question} (the user sent a thought only')
  expect(told).toContain('[c2] q-c2 {question} (sent, waiting for you to resolve)')
})

test('guide_asks_before_plan_init_and_links_superpowers_documents', () => {
  expect(GUIDE).toContain('/plan init')
  expect(GUIDE).toContain('add_decision')
  expect(GUIDE).toContain('superpowers')
})

test('guide_names_every_tool', () => {
  for (const name of ['propose_change', 'apply_change', 'update_step', 'add_decision', 'add_user_action', 'resolve_decision', 'resolve_direct_edit', 'plan/']) {
    expect(GUIDE).toContain(name)
  }
})

test('prototype_names_are_plain_ids', async () => {
  const base = await logText([entry('item.add', { item: item('A') })])
  const bad = JSON.stringify({
    id: 'eeeeeeeeeeee',
    at: '2026-10-07T00:00:00.500Z',
    kind: 'item.add',
    why: 'x',
    basis: { type: 'ai' },
    data: { item: item('__proto__') },
  })
  const rest = await logText([
    entry('edit.keep', { lines: [await sha16(bad)], summary: 'ok' }),
    card('toString'),
  ])
  const plan = await replay(base + bad + '\n' + rest)
  expect(plan.flagged).toEqual([])
  expect(plan.order).toEqual(['__proto__', 'A'])
  const states = itemStates(plan)
  expect(states['__proto__']).toBe('next')
  expect(states.A).toBe('later')
  expect(Object.keys(states).length).toBe(2)
  expect(summary(plan, emptyLocal)).toContain('1. [__proto__] __proto__ — next')

  expect(bandCounts(plan, emptyLocal).waiting).toBe(1)
  expect(summary(plan, emptyLocal)).not.toContain('(sent, waiting for you to resolve)')
  const sent: Local = { ...emptyLocal, sent: { toString: { choice: '1', at: 1 } } }
  expect(bandCounts(plan, sent).waiting).toBe(0)
  expect(summary(plan, sent)).toContain('(sent, waiting for you to resolve)')
})

test('summary_shows_a_step_note', async () => {
  const plan = await replay(
    await logText([entry('item.add', { item: item('A') }), step('A', 's1'), entry('step.note', { step: 's1', note: 'waiting for review' })]),
  )
  expect(summary(plan, emptyLocal)).toContain('- [s1] s1 — todo, note: waiting for review')
})

test('action_cards_come_first_and_count_as_waiting', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      card('c-block', { item: 'A', blocking: true }),
      card('c-a', { item: 'A' }),
      card('act', { type: 'action' }),
    ]),
  )
  expect(openCards(plan).map(c => c.id)).toEqual(['act', 'c-block', 'c-a'])
  expect(bandCounts(plan, emptyLocal).waiting).toBe(3)
  expect(summary(plan, emptyLocal)).toContain('- [act] q-act {action}')
})

test('fold_history_groups_runs_of_step_chatter', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    step('A', 's1'),
    step('A', 's2'),
    entry('step.status', { step: 's1', status: 'doing' }),
    card('c1', { item: 'A' }),
    entry('item.link', { item: 'A', doc: 'docs/a.md' }),
    entry('step.note', { step: 's1', note: 'waiting' }),
    entry('item.edit', { item: 'A', goal: 'new goal' }),
    entry('step.assign', { step: 's2', to: 'claude-b' }),
  ]
  const plan = await replay(await logText(entries))
  const id = (n: number) => entries[n].id
  const shape = foldHistory(historyOf(plan, 'A')).map(row =>
    row.kind === 'entry' ? row.entry.id : `fold:${row.key}:${row.entries.map(e => e.id).join(',')}`,
  )
  expect(shape).toEqual([id(8), id(7), id(5), id(4), `fold:${id(1)}:${id(3)},${id(2)},${id(1)}`, id(0)])
  expect(isChatter(entries[5])).toBe(true)
  expect(isChatter(entries[7])).toBe(false)
  expect(isChatter(entries[4])).toBe(false)
  expect(foldHistory([])).toEqual([])
})

test('guide_covers_notes_actions_evidence_and_plain_words', () => {
  expect(GUIDE).toContain('action note')
  expect(GUIDE).toContain('never in its title')
  expect(GUIDE).toContain('on the add op itself')
  expect(GUIDE).toContain('on the op that sets status done')
  expect(GUIDE).toContain('add_user_action')
  expect(GUIDE).toContain('plain words')
})

test('summary_shows_repos_and_their_short_names', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 's1' }, repo: 'post_backend_eruncard' }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 's2' }, repo: 'auth-center' }),
      step('A', 's3'),
      entry('repo.name', { repo: 'post_backend_eruncard', name: 'ERC後端' }),
      entry('repo.name', { repo: 'thoth', name: 'Thoth' }),
    ]),
  )
  const out = summary(plan, emptyLocal)
  expect(out).toContain('- [s1] s1 — todo, repo: post_backend_eruncard (ERC後端)\n')
  expect(out).toContain('- [s2] s2 — todo, repo: auth-center\n')
  expect(out).toContain('- [s3] s3 — todo\n')
  expect(out).toContain('Repo names: post_backend_eruncard = ERC後端, thoth = Thoth')
  const bare = await replay(await logText([entry('item.add', { item: item('A') }), step('A', 's1')]))
  expect(summary(bare, emptyLocal)).not.toContain('Repo names')
})

test('repo_label_is_the_short_name_else_the_folder', async () => {
  const plan = await replay(await logText([entry('repo.name', { repo: 'post_backend_eruncard', name: 'ERC後端' })]))
  expect(repoLabel(plan, 'post_backend_eruncard')).toBe('ERC後端')
  expect(repoLabel(plan, 'auth-center')).toBe('auth-center')
  expect(repoLabel(plan, 'toString')).toBe('toString')
})
