import { expect, test } from 'claude-code/testing'

import { checkLine, sealEntry, sha16 } from '../hooks/checksum.ts'
import type { Entry } from '../types'

const E: Entry = {
  id: '000000000001',
  at: '2026-10-07T07:20:31.000Z',
  kind: 'item.add',
  why: 'start',
  basis: { type: 'ai' },
  data: { item: { id: 'aaaaaaaa', title: '決定看板 v1', goal: '總表看得到' } },
}

test('sha16_matches_sha256_prefix', async () => {
  expect(await sha16('abc')).toBe('ba7816bf8f01cfea')
})

test('seal_then_check_round_trips', async () => {
  const line = await sealEntry(E)
  expect(Object.keys(JSON.parse(line))).toEqual(['id', 'at', 'kind', 'why', 'basis', 'data', 'sum'])
  const checked = await checkLine(line)
  expect(checked.isSealed).toBe(true)
  expect(checked.entry).toEqual(E)
})

test('seal_ignores_input_key_order', async () => {
  const shuffled = { data: E.data, basis: E.basis, why: E.why, kind: E.kind, at: E.at, id: E.id } as Entry
  expect(await sealEntry(shuffled)).toBe(await sealEntry(E))
})

test('check_flags_edits', async () => {
  const line = await sealEntry(E)
  const edited = await checkLine(line.replace('決定看板', '決定面板'))
  expect(edited.isSealed).toBe(false)
  expect(edited.entry).not.toBeNull()
  const { sum, ...rest } = JSON.parse(line)
  const noSum = JSON.stringify(rest)
  const missing = await checkLine(noSum)
  expect(missing.isSealed).toBe(false)
  expect(missing.entry).not.toBeNull()
  const added = await checkLine(JSON.stringify({ ...JSON.parse(line), extra: 'x' }))
  expect(added.isSealed).toBe(false)
  const { id, at, ...others } = JSON.parse(line)
  const reordered = await checkLine(JSON.stringify({ at, id, ...others }))
  expect(reordered.isSealed).toBe(false)
  const junk = await checkLine('oops')
  expect(junk.entry).toBeNull()
  expect(junk.isSealed).toBe(false)
  expect(junk.hash).toBe(await sha16('oops'))
})

test('check_ignores_trailing_cr', async () => {
  const line = await sealEntry(E)
  const crlf = await checkLine(line + '\r')
  expect(crlf.isSealed).toBe(true)
  expect(crlf.hash).toBe((await checkLine(line)).hash)
})

test('seal_puts_detail_after_data_and_covers_it', async () => {
  const line = await sealEntry({ ...E, detail: '第一行\n第二行' })
  expect(Object.keys(JSON.parse(line))).toEqual(['id', 'at', 'kind', 'why', 'basis', 'data', 'detail', 'sum'])
  expect((await checkLine(line)).isSealed).toBe(true)
  expect((await checkLine(line.replace('第二行', '第三行'))).isSealed).toBe(false)
  expect(Object.keys(JSON.parse(await sealEntry(E)))).toEqual(['id', 'at', 'kind', 'why', 'basis', 'data', 'sum'])
})

/** The first line of plan/log.jsonl at 3fb1e29 (0.4.2), as that version wrote it. */
const OLD =
  '{"id":"8979e30baf4f","at":"2026-10-10T13:52:47.636Z","kind":"card.open","why":"換裝做完，四項檢查都過了；repo 裡多了兩個還沒進 git 的新檔（/plan init 建的）","basis":{"type":"ai"},"data":{"card":{"id":"49b0d4c2","type":"question","question":"plan/、.gitattributes 和 Task 10 的文件更新，要一起 commit 到 main 嗎？","why":"換裝做完，四項檢查都過了；repo 裡多了兩個還沒進 git 的新檔（/plan init 建的）","options":[{"label":"一起 commit 到 main","effect":"plan/log.jsonl、.gitattributes，加上計畫文件 Task 10 打勾、brainstorm 進度改成「已完成」，合成一個 commit；不 push","recommended":true},{"label":"只 commit 文件，plan/ 先不進 git","effect":"Task 10 的文件更新進 commit；plan/ 和 .gitattributes 留在工作目錄不追蹤"},{"label":"先不 commit","effect":"全部留在工作目錄，什麼都不動"}],"blocking":true}},"sum":"d2cd97530bfaa2f3"}'

test('a_line_sealed_by_0_4_2_stays_sealed', async () => {
  const checked = await checkLine(OLD)
  expect(checked.isSealed).toBe(true)
  expect(await sealEntry(checked.entry as Entry)).toBe(OLD)
})
