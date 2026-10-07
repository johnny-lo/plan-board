import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { nextText } from '../plugins/plan-board/hooks/logfile.ts'
import { replay } from '../plugins/plan-board/hooks/replay.ts'
import type { Entry } from '../plugins/plan-board/types'

const ATTRIBUTES = 'plan/log.jsonl merge=union\n'
const ITEM_A = 'a1a1a1a1'
const ITEM_B = 'b2b2b2b2'
const ITEM_C = 'c3c3c3c3'

const root = mkdtempSync(join(tmpdir(), 'plan-board-'))
// An empty global config, so the machine's own git settings (autocrlf, a hook path) do not decide the result.
const globalConfig = join(root, 'gitconfig')
writeFileSync(globalConfig, '')
after(() => rmSync(root, { recursive: true, force: true }))

const add = (n: number, itemId: string, title: string): Entry => ({
  id: n.toString(16).padStart(12, '0'),
  at: new Date(Date.parse('2026-10-07T00:00:00.000Z') + n * 1000).toISOString(),
  kind: 'item.add',
  why: 'test',
  basis: { type: 'ai' },
  data: { item: { id: itemId, title, goal: `${title} goal` } },
})

function git(cwd: string, ...args: string[]) {
  const ran = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { code: ran.status, out: `${ran.stdout}${ran.stderr}` }
}

function mustGit(cwd: string, ...args: string[]): string {
  const ran = git(cwd, ...args)
  assert.equal(ran.code, 0, `git ${args.join(' ')} failed:\n${ran.out}`)
  return ran.out
}

/** Appends entries to the repo's log the way the plugin does, then commits. */
async function append(cwd: string, entries: Entry[], message: string): Promise<void> {
  const file = join(cwd, 'plan', 'log.jsonl')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {}
  writeFileSync(file, await nextText(text, entries, []))
  mustGit(cwd, 'add', '-A')
  mustGit(cwd, 'commit', '-q', '-m', message)
}

/** A repo whose main and branch `a` each appended one item to the log, with `a` merged into main. */
async function mergedRepo(name: string): Promise<{ cwd: string; merge: { code: number | null; out: string } }> {
  const cwd = join(root, name)
  mkdirSync(join(cwd, 'plan'), { recursive: true })
  mustGit(cwd, 'init', '-q', '-b', 'main')
  mustGit(cwd, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(cwd, '.gitattributes'), ATTRIBUTES)
  await append(cwd, [add(1, ITEM_A, 'First')], 'start')

  mustGit(cwd, 'checkout', '-q', '-b', 'a')
  await append(cwd, [add(2, ITEM_B, 'Second')], 'a adds B')
  mustGit(cwd, 'checkout', '-q', 'main')
  await append(cwd, [add(3, ITEM_C, 'Third')], 'main adds C')

  return { cwd, merge: git(cwd, 'merge', '--no-edit', 'a') }
}

test('union_merge_keeps_both_branches_lines', async () => {
  const { cwd, merge } = await mergedRepo('merge')
  assert.equal(merge.code, 0, merge.out)
  const text = readFileSync(join(cwd, 'plan', 'log.jsonl'), 'utf8')
  assert.ok(!text.includes('<<<<<<<'), 'no conflict markers')
  assert.equal(text.split('\n').filter(line => line !== '').length, 3)
  const plan = await replay(text)
  assert.deepEqual(plan.flagged, [])
  assert.deepEqual(plan.skipped, [])
  assert.deepEqual(plan.order, [ITEM_A, ITEM_B, ITEM_C])
})

test('crlf_checkout_still_replays_without_flagged_lines', async () => {
  const { cwd, merge } = await mergedRepo('crlf')
  assert.equal(merge.code, 0, merge.out)
  mustGit(cwd, 'config', 'core.autocrlf', 'true')
  mustGit(cwd, 'rm', '-q', '--cached', '-r', '.')
  mustGit(cwd, 'reset', '-q', '--hard')
  const text = readFileSync(join(cwd, 'plan', 'log.jsonl'), 'utf8')
  assert.ok(text.includes('\r\n'), 'the checkout turned the line endings into CRLF')
  const plan = await replay(text)
  assert.deepEqual(plan.flagged, [])
  assert.deepEqual(plan.order, [ITEM_A, ITEM_B, ITEM_C])
})
