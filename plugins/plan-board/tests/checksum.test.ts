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
