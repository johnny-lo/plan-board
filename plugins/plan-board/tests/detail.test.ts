import { expect, test } from 'claude-code/testing'

import { detailProblem, normalizeDetail } from '../hooks/detail.ts'
import { replay } from '../hooks/replay.ts'
import { entry, logText } from './fixtures.ts'

const item = (id: string) => ({ id, title: id, goal: `${id} goal` })
const planWith = async (...ids: string[]) =>
  replay(await logText(ids.map((id) => entry('item.add', { item: item(id) }))))

test('normalize_follows_the_four_rules', () => {
  expect(normalizeDetail('  第一行\r\n\r\n\r\n第二\t行 \u001b[31m ')).toBe('第一行\n\n第二 行 [31m')
  expect(normalizeDetail('a\rb')).toBe('a\nb')
  expect(normalizeDetail('清單：\n  - 一\n  - 二  ')).toBe('清單：\n  - 一\n  - 二')
  expect(normalizeDetail('x\u0085y‮z⁦w\u007f')).toBe('xyzw')
  expect(normalizeDetail('a​b‌c‍d⁠e﻿')).toBe('abcde')
  expect(normalizeDetail('**粗體** `code`')).toBe('**粗體** `code`')
})

test('blank_control_or_zero_width_only_is_empty', () => {
  expect(normalizeDetail('​‌‍⁠﻿')).toBe('')
  expect(normalizeDetail(' ​ \n⁠ ')).toBe('')
  expect(normalizeDetail('  \t\u0007\r\n‮  \n ')).toBe('')
})

test('limits_are_400_cells_and_8_lines', async () => {
  const plan = await planWith('A')
  expect(detailProblem('detail', '中'.repeat(200), [], plan)).toBe(null)
  expect(detailProblem('detail', '中'.repeat(201), [], plan)).toBe(
    'detail is 402 cells wide; keep it within 400 (about 200 Chinese characters). Put the rest in the spec and link it',
  )
  expect(detailProblem('detail', 'a'.repeat(400), [], plan)).toBe(null)
  expect(detailProblem('detail', 'a'.repeat(401), [], plan)).toContain('detail is 401 cells wide')
  expect(detailProblem('detail', Array(8).fill('行').join('\n'), [], plan)).toBe(null)
  expect(detailProblem('detail', Array(9).fill('行').join('\n'), [], plan)).toBe(
    'detail is 9 lines long; keep it within 8 lines. Put the rest in the spec and link it',
  )
})

test('limits_count_the_normalized_text', async () => {
  const plan = await planWith('A')
  const nine = normalizeDetail(['1', '2', '3', '', '', '4', '5', '6', '7'].join('\n'))
  expect(nine.split('\n').length).toBe(8)
  expect(detailProblem('detail', nine, [], plan)).toBe(null)
  expect(detailProblem('detail', normalizeDetail('a'.repeat(400) + '   '), [], plan)).toBe(null)
  expect(detailProblem('detail', normalizeDetail('a'.repeat(200) + '\n' + 'b'.repeat(200)), [], plan)).toBe(null)
})

test('repeats_ignore_case_spaces_and_punctuation', async () => {
  const plan = await planWith('A')
  expect(
    detailProblem('ops[0].detail', 'pane  views.', [{ name: 'title', text: 'Pane views' }], plan),
  ).toBe('ops[0].detail only repeats the title; say what it leaves out')
  expect(detailProblem('d', '窗格兩個畫面。', [{ name: 'title', text: '窗格 兩個畫面' }], plan)).toContain(
    'only repeats the title',
  )
  expect(
    detailProblem(
      'd',
      '一列保持短',
      [
        { name: 'label', text: '不顯示' },
        { name: 'effect', text: '一列保持短！' },
      ],
      plan,
    ),
  ).toContain('only repeats the effect')
  expect(
    detailProblem('d', 'Pane views: two buttons switch between them', [{ name: 'title', text: 'Pane views' }], plan),
  ).toBe(null)
})

test('ids_match_whole_words_of_current_ids_of_six_or_more', async () => {
  const plan = await planWith('design01', 'docs')
  expect(detailProblem('d', '先看 design01 再說', [], plan)).toBe(
    'd names plan ids (design01); use the names the user sees',
  )
  expect(detailProblem('d', '看design01的', [], plan)).toContain('(design01)')
  expect(detailProblem('d', 'design012 和 design01_x', [], plan)).toBe(null)
  expect(detailProblem('d', '舊的 ghost123', [], plan)).toBe(null)
  expect(detailProblem('d', '寫 docs 的時候', [], plan)).toBe(null)
})

test('ids_with_regex_characters_match_literally', async () => {
  const plan = await planWith('api.v2', 'c++dev')
  expect(detailProblem('d', 'apiXv2 照舊', [], plan)).toBe(null)
  expect(detailProblem('d', '改 api.v2 的路由', [], plan)).toContain('(api.v2)')
  expect(detailProblem('d', '用 c++dev 編', [], plan)).toContain('(c++dev)')
})
