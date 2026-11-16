# 點開就看得到解釋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 步驟、決定卡的選項、待你處理卡、提案卡和變動紀錄多一段 AI 寫入的「細節」，平常收著，在窗格裡點開才展開。

**Architecture:** 純模組 `hooks/detail.ts` 做細節的正規化與檢查，工具（`tools.ts`）和重算（`replay.ts`）共用。細節放在既有紀錄的欄位（`step.add` 的 `data`、`card.open` 的卡片和選項、紀錄最外層）和新種類 `step.detail`；檢查碼算進最外層 `detail`，舊紀錄的檢查碼不變。窗格多兩個元件 `detailToggle`、`detailBlock`，展開狀態沿用本機 `expanded`。

**Tech Stack:** TypeScript／TSX 的 Claude Code 外掛；`claude plugin test`（`claude-code/testing`）、`claude plugin validate`；Node 24（`tests-git/`、一次性的相容檢查）；git。

**Spec:** `docs/superpowers/specs/2026-11-13-detail-on-expand-design.md`（下稱「設計」），實作前先讀完。「設計 x.y」指這份的節號；`檔案:行號` 以 `3fb1e29`（0.4.2）為準，路徑在 `plugins/plan-board/` 底下。

## Global Constraints

- 細節是純文字，可換行，不解析 markdown、不翻譯。上限 **400 格、8 行**：格數用 `hooks/lines.ts` 的 `textWidth`（中文一字 2 格），算正規化後的文字、換行不算格；行數是正規化後的 `split('\n').length`。超過就**拒絕**，不截斷。
- 正規化（設計 11.2，依序）：① `\r\n`、`\r` 換成 `\n`，tab 換成空白；② 拿掉 `\n` 以外的 U+0000–U+001F、U+007F–U+009F，U+202A–U+202E、U+2066–U+2069，以及零寬字元 U+200B、U+200C、U+200D、U+2060、U+FEFF（拿完變空的，照空字串處理）；③ 每行去掉行尾空白，第二行起的行首保留；④ 連續空行縮成一行，整段頭尾的空白和空行拿掉。工具和重算都呼叫 `normalizeDetail`，不各寫一份。
- 新種類叫 `step.detail`，`data: { step, detail }`。不准改用既有種類帶細節（設計 3.1：舊版會照套）。
- 檢查碼：`sum = sha16(JSON.stringify({ id, at, kind, why, basis, data, detail }))`，`detail` 放 `data` 後面；沒有時是 `undefined`，`JSON.stringify` 略過它。寫出的行是 `{ id, at, kind, why, basis, data, detail, sum }`。
- 給 AI 的訊息一律英文。錯誤訊息（`{}` 是代入的值）；被拒時整次呼叫什麼都不寫：
  - `ops[{i}].detail is required on add: what this step does and how you will know it is done`
  - `ops[{i}].detail must be a non-empty string; a detail can be replaced, not cleared`
  - `step {id} already has this detail`
  - `ops[{i}]: detail goes only on an add or a detail op`
  - `why_detail needs a why`
  - `options[{i}].detail is required: what choosing it means in practice`
  - `detail is required: why the user has to do this and what happens once it is done`
  - ① `{field} must be a string`
  - ② `{field} is {n} cells wide; keep it within 400 (about 200 Chinese characters). Put the rest in the spec and link it`；行數：`{field} is {n} lines long; keep it within 8 lines. Put the rest in the spec and link it`
  - ③ `{field} only repeats the {title}; say what it leaves out`（`{title}` 是被比對的欄位名：`title`、`label`、`effect`、`action`、`question`、`why`、`outcome`、`summary`）
  - ④ `{field} names plan ids ({ids}); use the names the user sees`（`{ids}` 以 `, ` 連接）
- 重複（③）：兩邊都拿掉空白、標點、符號（`/[\s\p{P}\p{S}]/gu`）再轉小寫，**相等**才算重複；以標題開頭再往下講的不算。
- id（④，設計 5 第 9 條）：只比目前計畫裡存在的項目、步驟、卡片 id（`plan.items`、`plan.steps`、`plan.cards` 的鍵）；短於 6 個字元的不比；整個詞才算（前後不是 `[A-Za-z0-9_]`，中文字算邊界）；照字面比，id 裡的 `.`、`+` 不當 regex。
- 畫面：不改配色和版型。細節用 `dimColor`、縮排、`wrap="wrap"`；照換行拆成多列，每列一個 `Text`，空行畫成只有一個空白的 `Text`，不靠 `Text` 處理 `\n`。細節區塊和開關各是 `pane.tsx` 裡的**單一元件** `detailBlock`、`detailToggle`。收起時總表一列不多、每張攤開的卡最多多一列。不加熱鍵（數字鍵、`s` 已有用途）。
- 展開狀態只存在本機 `$.store` 的 `expanded`：步驟和卡片的鍵是 `detail:<id>`，紀錄沿用 `why:<紀錄 id>`。點開、收起不寫 `plan/log.jsonl`、不寫本機模式的 `log:<根目錄>`。
- 窗格不顯示 id；細節本身不進摘要。
- 純模組（`hooks/` 底下除了 `register.tsx`、`pane.tsx`）只能 `import type` Claude Code 和 `../types` 的型別，引用其他模組寫明 `.ts`；不用 enum、namespace、parameter properties。測試檔不能 import `node:*`。
- 不動 `plan/` 底下任何檔（那是使用者的計畫，只能經外掛工具改）。不替舊紀錄補細節。
- 版本 `0.5.0`。commit 訊息照這個 repo 的格式（`feat(plan-board): …`、`docs(plan-board): …`），最後一行照執行者所在環境的 attribution 規則。

**驗證指令**（repo 根目錄，Git Bash）。出處：`docs/superpowers/plans/2026-10-07-plan-board.md:32-36`、`:3959-3964`，2026-11-13 在 `0159079` 上實跑過：

- `claude plugin test plugins/plan-board`：最後三行是 `N pass`、`0 fail`、`Ran N tests across M files.`。`0159079` 上是 `175 pass`、`0 fail`、9 個檔。這個指令沒有挑單一測試的參數，一律跑整包。
- `claude plugin validate plugins/plan-board`：最後一行 `✔ Validation passed with warnings`。`--strict` 在 `0159079` 上已經失敗（既有的 TS 警告和「`/plan` is a name Claude Code ships」），不當這份計畫的關卡，也不為它改無關的檔。
- `claude plugin validate .`：`✔ Validation passed with warnings`。
- `node --test tests-git/merge.test.ts`：`fail 0`。

## Review Focus

1. **Windows checkout 的 CRLF 碰上多行細節**：細節的換行在 JSON 裡是跳脫的 `\n`，行尾多了 `\r` 的行要照常通過檢查碼、細節一字不變。Task 3 `crlf_lines_with_multiline_details_stay_sealed`。
2. **細節以標題開頭、再往下講**：「窗格兩個畫面：上方兩個按鈕…」不是重複，要收；用 startsWith、includes 比對會擋掉正常的細節。Task 4 `a_detail_that_starts_with_the_title_and_says_more_is_kept`。
3. **AI 自己取、含 regex 符號的 id**（`api.v2`、`c++dev`）：照字面比，`apiXv2` 不擋、`api.v2` 擋，不丟例外。Task 2 `ids_with_regex_characters_match_literally`。
4. **上限算正規化後的文字**：9 行裡有連續空行、縮完是 8 行的要收；400 格加行尾空白的要收；兩行各 200 格的要收（換行不算格）。Task 2 `limits_count_the_normalized_text`。
5. **一個開關只開自己**：兩張攤開的卡、卡和它指到的步驟，按一個不會展開另一個。Task 8 `each_card_opens_only_its_own_details`。

---

### Task 1: 實測按鈕的長標題會換行還是被截（需要 Johnny 看畫面）

設計 13：型別檔沒寫 Button 的長 label 怎麼畫（d.ts:1111-1216）；`claude plugin test` 只驗元件樹（d.ts `MountedMembers`：「never a surface's paint」）。所以這個 Task 沒有自動測試，要 Johnny 用眼睛看。0.4.2 的項目列（`▸ 標題 · 狀態`）和變動紀錄的每一列已經是帶長 label 的 plain Button，用它們看，不用先改程式。

**Files:**
- 不改程式。暫存資料夾 `/c/Users/j4503/AppData/Local/Temp/plan-board-wrap`（不在 repo 裡）；產生 log 的腳本放 session 的 scratchpad。
- Modify：這份計畫 Task 7 的「路線」那一行。

**Interfaces:**
- Produces：路線 A（步驟標題本身當開關）或路線 B（標題照舊用 `Text`，後面另放只有 `▸` 的 plain 按鈕），寫進 Task 7。

- [ ] **Step 1: 做一份帶長標題、檢查碼正確的 log**

建暫存資料夾和它的 `plan/`，`git init`。Node 腳本用 `pathToFileURL(join(REPO, 'plugins/plan-board/hooks/checksum.ts'))` 動態 import `sealEntry`，寫 4 行到 `plan/log.jsonl`：兩筆 `item.add`（中文標題約 100 字、英文標題約 240 個字母），各自底下一筆標題一樣長的 `step.add`（第一個 `status: 'doing'`）。已實測：Node 24.22.1 能直接 import 這個 `.ts`。

Run：同樣方式 import `replay.ts` 重算這份 log。
Expected：`flagged` 0、`skipped` 0、2 個項目、2 個步驟。

- [ ] **Step 2: Johnny 在 terminal 看**：fullscreen 版面、terminal 110 欄以上（窗格停靠在旁邊），在暫存資料夾開 `claude`、`/plan`，按兩個項目列、「變動紀錄」、一筆紀錄。長 label 是**接到下一列**（每個字都看得到）還是**停在窗格邊緣**（有沒有 `…` 都算截）？再用一般版面（窗格在輸入框上方）看一次。

- [ ] **Step 3: Johnny 在 desktop 看**：Claude desktop 開同一個資料夾，`/plan`，同樣看。desktop 開不了就停下來問 Johnny，不要只憑 terminal 定路線。

- [ ] **Step 4: 定路線、記下來**：每個畫面都接到下一列 → 路線 A；任何一個被截 → 路線 B（兩個畫面結果不同時怎麼辦，設計 13 沒寫，這是本計畫的決定）。Button 放 `Text` 子元素的第三條路線不納入。寫進 Task 7 的「路線」：A 或 B、日期、每個畫面看到的樣子各一句。刪掉暫存資料夾。

```bash
git add docs/superpowers/plans/2026-11-13-detail-on-expand.md
git commit -m "docs: how a long button label is drawn decides the step toggle"
```

---

### Task 2: 細節的正規化與檢查（`hooks/detail.ts`）

**Files:**
- Create: `plugins/plan-board/hooks/detail.ts`
- Test: `plugins/plan-board/tests/detail.test.ts`

**Interfaces:**
- Consumes: `textWidth(text: string): number`（`hooks/lines.ts:20`）；`Plan`（`types/index.d.ts`）。
- Produces（Task 3、4、5 用）：

```ts
export const DETAIL_CELLS = 400
export const DETAIL_LINES = 8
/** What a detail is compared with: the field's name as an error says it, and that field's text. */
export type Title = { name: string; text: string }
/** Design 11.2, in order; '' when nothing is left. */
export function normalizeDetail(text: string): string
/** For a normalized, non-empty detail: the first problem of ② cells, ② lines, ③ repeats, ④ plan ids, as the error message; null when it may be written. */
export function detailProblem(field: string, detail: string, titles: Title[], plan: Plan): string | null
```

- [ ] **Step 1: 寫會失敗的測試** `tests/detail.test.ts`（計畫用 `replay(await logText([...]))` 從紀錄建）

```ts
test('normalize_follows_the_four_rules', () => {
  expect(normalizeDetail('  第一行\r\n\r\n\r\n第二\t行 \u001b[31m ')).toBe('第一行\n\n第二 行 [31m')
  expect(normalizeDetail('a\rb')).toBe('a\nb')
  expect(normalizeDetail('清單：\n  - 一\n  - 二  ')).toBe('清單：\n  - 一\n  - 二')
  expect(normalizeDetail('x\u0085y\u202ez\u2066w\u007f')).toBe('xyzw')
  expect(normalizeDetail('a\u200bb\u200cc\u200dd\u2060e\ufeff')).toBe('abcde')
  expect(normalizeDetail('**粗體** `code`')).toBe('**粗體** `code`')
})
test('blank_control_or_zero_width_only_is_empty', () => {
  expect(normalizeDetail('\u200b\u200c\u200d\u2060\ufeff')).toBe('')
  expect(normalizeDetail(' \u200b \n\u2060 ')).toBe('')
  expect(normalizeDetail('  \t\u0007\r\n\u202e  \n ')).toBe('')
})
test('limits_are_400_cells_and_8_lines')
  // detailProblem('detail', '中'.repeat(200), [], plan) → null
  // '中'.repeat(201) → 'detail is 402 cells wide; keep it within 400 (about 200 Chinese characters). Put the rest in the spec and link it'
  // 'a'.repeat(400) → null；'a'.repeat(401) → toContain('detail is 401 cells wide')
  // Array(8).fill('行').join('\n') → null；9 行 → 'detail is 9 lines long; keep it within 8 lines. Put the rest in the spec and link it'
test('limits_count_the_normalized_text')            // Review Focus 4
  // normalizeDetail(['1','2','3','','','4','5','6','7'].join('\n')) 是 8 行 → null
  // normalizeDetail('a'.repeat(400) + '   ') → null
  // normalizeDetail('a'.repeat(200) + '\n' + 'b'.repeat(200)) → null
test('repeats_ignore_case_spaces_and_punctuation')
  // ('ops[0].detail', 'pane  views.', [{ name: 'title', text: 'Pane views' }]) → 'ops[0].detail only repeats the title; say what it leaves out'
  // ('d', '窗格兩個畫面。', [{ name: 'title', text: '窗格 兩個畫面' }]) → toContain('only repeats the title')
  // ('d', '一列保持短', [{ name: 'label', text: '不顯示' }, { name: 'effect', text: '一列保持短！' }]) → toContain('only repeats the effect')
  // ('d', 'Pane views: two buttons switch between them', [{ name: 'title', text: 'Pane views' }]) → null
test('ids_match_whole_words_of_current_ids_of_six_or_more')
  // 計畫：item.add design01、item.add docs
  // ('d', '先看 design01 再說') → 'd names plan ids (design01); use the names the user sees'
  // ('d', '看design01的') → toContain('(design01)')        // 中文字是邊界
  // ('d', 'design012 和 design01_x') → null；('d', '舊的 ghost123') → null；('d', '寫 docs 的時候') → null
test('ids_with_regex_characters_match_literally')    // Review Focus 3
  // 計畫：item.add api.v2、item.add c++dev
  // ('d', 'apiXv2 照舊') → null；('d', '改 api.v2 的路由') → toContain('(api.v2)')；('d', '用 c++dev 編') → toContain('(c++dev)')
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected：`detail.test.ts` 載入失敗（找不到 `../hooks/detail.ts`），原有 175 個 pass。

- [ ] **Step 3: 實作 `hooks/detail.ts`**

照 Global Constraints 的正規化、上限、重複、id 規則。`detailProblem` 的檢查順序：格數、行數、重複（`titles` 依序，第一個相等的就回）、id（依 `items`、`steps`、`cards` 的順序收集、去重）。`import type { Plan } from '../types'`、`import { textWidth } from './lines.ts'`。

- [ ] **Step 4: 跑全部檢查**

Run: `claude plugin test plugins/plan-board` → `0 fail`。
Run: `claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/detail.ts plugins/plan-board/tests/detail.test.ts
git commit -m "feat(plan-board): normalize and check details"
```

---

### Task 3: 細節進資料：型別、檢查碼、重算、新舊版本相容

**Files:**
- Modify: `plugins/plan-board/types/index.d.ts:17-27`、`:32-38`、`:44`、`:47`
- Modify: `plugins/plan-board/hooks/checksum.ts:10-17`
- Modify: `plugins/plan-board/hooks/replay.ts:57-70`（`isCardSpec`）、`:91-103`（`step.add` 形狀）、`:114-117` 後面（新 case）、`:218-231`、`:294-299`、`:353-363`（`wellFormed`）、`:389-396`、`:414-415`
- Test: `tests/checksum.test.ts`、`tests/replay.test.ts`、`tests/pane.test.ts`（只加 0.4.2 畫面的基準）

**Interfaces:**
- Consumes: `normalizeDetail`（Task 2）。
- Produces（型別，之後每個 Task 都用）：

```ts
// StepChange
  | { kind: 'step.add'; data: { item: string; step: StepSpec; after?: string; status?: StepStatus; to?: string; note?: string; result?: string; repo?: string; detail?: string } }
  /** Gives a step its detail or replaces it; never clears one. On no item's history. */
  | { kind: 'step.detail'; data: { step: string; detail: string } }
export type CardOption = { label: string; effect: string; recommended?: boolean; reason?: string; detail?: string }
// CardSpec 加：
  /** Action and proposal cards only: why the user has to do it, or what the plan looks like once approved. */
  detail?: string
export type Entry = Change & { id: string; at: string; why: string; basis: Basis; detail?: string }
export type Step = { …現有欄位; detail?: string }
```

- Produces（行為）：`replay` 之後，`plan.steps[id].detail`、`plan.cards[id].detail`、`plan.cards[id].options[i].detail`，以及 `plan.applied`／`plan.itemLog` 裡每筆紀錄的 `detail`，都是正規化過的字串，空的就不存在這個鍵；`step.detail` 紀錄套用了但不進 `plan.itemLog`；`sealEntry` 寫出的行 `detail` 在 `data` 和 `sum` 之間。

重算的規則（設計 6、11.3「重算時」那欄）：

- 上面任一處的細節有給但不是字串 → 整筆略過：`data` 裡的經 `hasValidData`（理由 `malformed entry: bad data for <kind>`），最外層的經 `wellFormed`（理由 `malformed entry`）。
- 每段細節過一次 `normalizeDetail`，`''` 當沒有；不查長度、重複、id。
- `step.detail`：步驟不存在 → `unknown step: <id>`；正規化後是 `''` → 套用、步驟不變；否則換掉。
- `card.open` 存進 `plan.cards` 的是正規化過的副本，不改紀錄本身的 `data`。

- [ ] **Step 1: 先釘住 0.4.2 的畫面（在改任何程式之前）**

`tests/pane.test.ts`：把 `no_ids_in_zh_tw_text` 裡那串紀錄搬成檔案層的 `const everything = () => [...]`，原測試改用它（行為不變）。新增：

```ts
test('old_logs_draw_the_same_rows_as_0_4_2', ZH, async ($, on) => {
  expect((await replay(await logText(everything()))).flagged).toEqual([])
  // 每個 surface：fresh → pane → 按 group:done、item:A/B/C/D → openFolds → 按每個 key 符合 /^log:[^:]+:/ 的 Button（打開原因）
  // → rows = await order(ui)；按 view:cards → 按其他卡的 card:<id> → 按每個 key 開頭 recent: 的 Button → rows.push(...await order(ui))
  expect(rows.map(r => r.replace(/\d\d\/\d\d \d\d:\d\d/g, 'MM/DD hh:mm'))).toEqual(OLD_ROWS)
})
```

先寫 `const OLD_ROWS: string[] = []` 跑一次，從失敗訊息的 received 複製整個陣列貼成 `OLD_ROWS`，再跑一次確認 pass。這個測試從現在到 Task 10 都不准改。

- [ ] **Step 2: 寫會失敗的測試**

`tests/checksum.test.ts`：

```ts
test('seal_puts_detail_after_data_and_covers_it')
  // line = await sealEntry({ ...E, detail: '第一行\n第二行' })
  // Object.keys(JSON.parse(line)) toEqual ['id','at','kind','why','basis','data','detail','sum']；checkLine(line).isSealed true
  // checkLine(line.replace('第二行', '第三行')).isSealed false
  // Object.keys(JSON.parse(await sealEntry(E))) toEqual ['id','at','kind','why','basis','data','sum']
test('a_line_sealed_by_0_4_2_stays_sealed')
  // OLD = `git show 3fb1e29:plan/log.jsonl` 的第一行，原樣貼成字串常數
  // const checked = await checkLine(OLD); checked.isSealed true；await sealEntry(checked.entry as Entry) toBe OLD
```

`tests/replay.test.ts`：

```ts
test('details_replay_normalized_on_steps_options_cards_and_entries')
  // item design01；step.add s1 detail '  第一行\r\n\r\n\r\n第二\t行 '；s2 detail '\u0007  '；s3 detail 'x'.repeat(500)
  // s4 detail '**粗體** `code`'；s5 title 'five' detail 'five.'；s6 detail '看 design01'；s7 detail '\u200b\u2060'
  // card.open question q1 options [{ label:'a', effect:'x', detail:' 選 a 會怎樣 ' }, { label:'b', effect:'y' }]
  // card.open action a1 detail '為什麼要你做'；step.status s1 doing，最外層 detail '  原因的細節  '
  // steps.s1.detail '第一行\n\n第二 行'；s2、s7 沒有 detail 鍵；s3、s4、s5、s6 的 detail 和寫入的一樣（重算不查長度、重複、id）
  // cards.q1.options[0].detail '選 a 會怎樣'，options[1] 沒有 detail 鍵；cards.a1.detail '為什麼要你做'
  // applied 裡 step.status 那筆的 detail '原因的細節'；skipped []、flagged []
test('a_detail_that_is_not_a_string_skips_the_entry')
  // step.add detail 5、card.open 選項 detail 5、card.open action detail 5、step.detail detail 5：
  // 各自 applyEntry(plan, e) toBe(`malformed entry: bad data for ${e.kind}`)，JSON.stringify(plan) 不變
  // 最外層 detail: 5 的 step.add 封好後 replay：skipped[0].reason 'malformed entry'，那個步驟不存在
test('step_detail_replaces_and_stays_off_the_history')
  // item A、B；step s1 'one'；step.detail s1 '第一版'；step.detail s1 '第二版'；step.detail s1 '  '；
  // step.edit s1 'uno'；step.move s1 → B；step.detail ghost 'x'
  expect(plan.steps.s1.detail).toBe('第二版')
  expect(plan.skipped.map(s => s.reason)).toEqual(['unknown step: ghost'])
  expect(plan.applied.filter(e => e.kind === 'step.detail')).toHaveLength(3)
  expect([...(plan.itemLog.A ?? []), ...(plan.itemLog.B ?? [])].some(e => e.kind === 'step.detail')).toBe(false)
test('old_and_new_lines_are_never_flagged')          // 設計 3.1
  // 舊：logs_without_repos_replay_the_same 那串 → flagged []，沒有任何步驟有 detail 鍵
  // 新：step.add 帶 detail、step.detail、card.open 帶選項細節和卡片細節、一筆最外層帶 detail → flagged []、skipped []
test('crlf_lines_with_multiline_details_stay_sealed') // Review Focus 1
  // text = (await logText([item A, step.add s1 detail '一\n二\r\n三'])).replace(/\n/g, '\r\n')
  // replay(text)：flagged []；steps.s1.detail '一\n二\n三'
```

- [ ] **Step 3: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected：Step 2 的其他 6 個 fail；`a_line_sealed_by_0_4_2_stays_sealed` 和 `old_logs_draw_the_same_rows_as_0_4_2` pass（守的是不能退步的事）。

- [ ] **Step 4: 實作**

型別照 Interfaces；`sumOf`、`sealEntry` 在 `data` 後加 `detail`；`replay.ts` 照上面的重算規則。最外層 `detail` 在 `wellFormed` 通過後、放進 `entries` 前正規化（空的就刪掉鍵）；`step.detail` 和 `step.note` 一樣跳過 `itemLog`。

- [ ] **Step 5: 跑全部檢查**

Run: `claude plugin test plugins/plan-board` → `0 fail`（含 `old_logs_draw_the_same_rows_as_0_4_2`）。
Run: `claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。
Run: `node --test tests-git/merge.test.ts` → `fail 0`。

- [ ] **Step 6: Commit**

```bash
git add plugins/plan-board/types plugins/plan-board/hooks/checksum.ts plugins/plan-board/hooks/replay.ts plugins/plan-board/tests
git commit -m "feat(plan-board): details on steps, options, cards and entries in the log"
```

---

### Task 4: `update_step` 收細節

**Files:**
- Modify: `plugins/plan-board/hooks/tools.ts:103-105`（`make`）、`:229-346`（`updateStep`）、`:473-512`（schema）
- Test: `tests/tools.test.ts`、`tests/plugin.test.ts`
- Modify（原本 `add` 沒帶細節的測試，補上 `detail`；預期的 `data` 物件跟著多 `detail`）：`tests/tools.test.ts:174`、`185`（`198`）、`352-354`、`448`、`464`（`469`、`472`、`476`、`478`、`481`）、`539`（`542`）、`549`、`553`、`605`；`tests/plugin.test.ts:149`；`tests/pane.test.ts:1179`；`tests/storage.test.ts:73`。每個檔用一個常數細節，例如 `const D = '說明這一步替使用者做什麼、怎樣算做完'`，不重複任何標題、不含 8 個連續十六進位字元。

**Interfaces:**
- Consumes: `normalizeDetail`、`detailProblem`、`Title`（Task 2）；Task 3 的型別。
- Produces（`tools.ts` 內部，Task 5 用）：

```ts
function make(ctx: ToolContext, kind: Change['kind'], data: unknown, why: string, basis: Basis, detail?: string): Entry
/** The detail at o[key]: not a string → `${field} must be a string`; normalized; '' → undefined; otherwise the call fails with detailProblem(field, …). */
function detailOf(o: Obj, key: string, field: string, titles: Title[], plan: Plan): string | undefined
```

- Produces（工具輸入）：`ops[i].detail`（`add` 必填）；新 op `{ action: 'detail', step, detail }`；整次呼叫的 `why_detail`。

行為（設計 7.1）：

- `add`：`detailOf(raw, 'detail', `${at}.detail`, [{ name: 'title', text: title }], plan) ?? fail(必填訊息)`，寫進 `data.detail`；標題、項目的檢查照舊在前。
- `detail` op：步驟不存在 → `unknown step: {id}`；`detailOf` 拿到 `undefined` → 「不能清空」那句；和現在的一樣 → `already has this detail`；寫一筆 `step.detail`，沒給 `why` 時 `why` 是 `detail written`；結果訊息 `Wrote the detail of step {id}.`。
- 其他 op 帶 `detail` → `detail goes only on…`，和 `evidence` 的檢查放一起（`tools.ts:247`）。
- 全部 op 都是 `note` 或 `detail` 時可以不給 `why`。
- `why_detail`：正規化後非空而 `why` 是空的 → 先回 `why_detail needs a why`；否則 `detailOf(o, 'why_detail', 'why_detail', [{ name: 'why', text: why }], plan)`，經 `make` 寫在這次每一筆的最外層。
- `tools.ts:342` 列出的 action 變成 `… note, repo, repo_name, link, detail`（放最後，`tools.test.ts:556` 不用改）。
- schema：`action` 的 enum 加 `detail`；op 加 `detail`、頂層加 `why_detail`，各附一句 `description`（規則照 Global Constraints）；`why` 的說明改成「may be left out when every op is a note or a detail」。

- [ ] **Step 1: 寫會失敗的測試**

`tests/tools.test.ts`（`run` 是對 `TOOLS.update_step.run` 的小包裝，op 預設 `{ action: 'add', item: 'A', title: 'review' }`）：

```ts
test('add_needs_a_detail_and_writes_it_normalized')
  expect(bad(run({}))).toBe('ops[0].detail is required on add: what this step does and how you will know it is done')
  expect(bad(run({ detail: '  \u0007 ' }))).toContain('ops[0].detail is required')
  expect(bad(run({ detail: '\u200b\u200d' }))).toContain('ops[0].detail is required')
  expect(bad(run({ detail: 5 }))).toBe('ops[0].detail must be a string')
  // detail '  第一行\r\n\r\n\r\n第二\t行 ' → data.detail '第一行\n\n第二 行'；'**先**做 `x`' 原樣
test('add_detail_limits_are_200_chinese_400_letters_8_lines')   // 驗收 3
  // '中'.repeat(200) good；'中'.repeat(201) → toContain('ops[0].detail is 402 cells wide')
  // 'a'.repeat(400) good；401 → toContain('401 cells wide')
  // 8 行 good；9 行 → toContain('ops[0].detail is 9 lines long')
test('a_detail_that_repeats_the_title_or_names_ids_is_refused') // 驗收 4
  // 計畫：item design01、item docs
  // title '窗格兩個畫面'、detail '窗格 兩個畫面。' → 'ops[0].detail only repeats the title; say what it leaves out'
  // title 'Pane views'、detail 'pane views.' → toContain('only repeats the title')
  // detail '先做 design01 的部分' → 'ops[0].detail names plan ids (design01); use the names the user sees'
  // 'design012 和 design01_x 都不是'、'舊的 ghost123 不在計畫裡'、'寫 docs 的時候順便更新' → 都 good
test('detail_goes_only_on_add_or_detail_ops')                   // 驗收 4
  // edit、note、status、remove 帶 detail → 各自 'ops[0]: detail goes only on an add or a detail op'
test('detail_op_replaces_but_never_clears')                     // 驗收 5
  // 計畫：step s1 '定檔案格式'，step.detail '舊的細節'
  // { ops: [{ action:'detail', step:'s1', detail:' 新的細節 ' }] }（沒給 why）
  //   → entries[0] toMatchObject { kind:'step.detail', why:'detail written', data:{ step:'s1', detail:'新的細節' } }
  // detail '  ' → 'ops[0].detail must be a non-empty string; a detail can be replaced, not cleared'
  // detail '舊的細節' → 'step s1 already has this detail'；step 'ghost' → toContain('unknown step: ghost')
  // 沒給 why，ops [note s1 '等審查', detail s1 '新的細節'] → entries.map(e => e.why) toEqual ['等審查', 'detail written']
  // 沒給 why，ops [remove s1, detail …] → toContain('why')
test('why_detail_goes_on_every_entry_of_the_call')
  // why '換做法'、why_detail ' 舊做法太慢，\n改成先建索引 '、ops [add（帶 detail）, status doing]
  //   → entries.map(e => e.detail) toEqual ['舊做法太慢，\n改成先建索引', '舊做法太慢，\n改成先建索引']
  // 只有 note、沒給 why、why_detail '補充' → 'why_detail needs a why'
  // why '換做法'、why_detail '換做法。' → 'why_detail only repeats the why; say what it leaves out'
  // why_detail 5 → 'why_detail must be a string'；why_detail '  ' 和沒給 → Object.hasOwn(entries[0], 'detail') false
  // JSON.stringify(TOOLS.update_step.inputSchema) toContain '"why_detail"' 和 '"detail"'
test('a_detail_that_starts_with_the_title_and_says_more_is_kept') // Review Focus 2
  // title '窗格兩個畫面'、detail '窗格兩個畫面：上方兩個按鈕切換總表和等你' → good，data.detail 原樣
  // title 'Pane views'、detail 'Pane views. Two buttons switch between them.' → good
```

`tests/plugin.test.ts`：

```ts
test('a_refused_detail_writes_nothing')                         // 驗收 1 的 log 部分
  // seeded item A；before = w.files[LOG]
  // $.tool.call update_step { why:'plan', ops:[{ action:'add', item:'A', title:'first' }] } → deny toContain 'ops[0].detail is required'；w.files[LOG] toBe before
  // 同一呼叫加 detail → deny undefined；replay(w.files[LOG]) 裡那個新步驟的 detail 就是給的那段
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected：Step 1 的 8 個測試 fail；改過的舊測試（補了 `detail`）因為預期的 `data` 多了 `detail` 而 fail，其他 pass。

- [ ] **Step 3: 實作**：照上面的行為改 `tools.ts`。`make` 只在 `detail !== undefined` 時放 `detail` 鍵。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/tools.ts plugins/plan-board/tests
git commit -m "feat(plan-board): update_step takes a detail on add, a detail op and why_detail"
```

---

### Task 5: 卡片和結案的工具收細節

**Files:**
- Modify: `plugins/plan-board/hooks/tools.ts:150-169`（`propose_change`）、`:173-202`（`apply_change`）、`:350-374`（`add_decision`）、`:378-391`（`add_user_action`）、`:395-400`（`resolve_decision`）、`:404-427`（`resolve_direct_edit`）、`:434-581`（schema）
- Test: `tests/tools.test.ts`
- Modify（原本沒帶細節的卡片呼叫，補上細節、預期跟著改）：`tests/tools.test.ts:207`（`opt` 加 `detail`）、`228-229`、`491-526`（輸入加 `detail`，`498-512` 預期的卡片多 `detail`）；`tests/plugin.test.ts:37-42`；`tests/pane.test.ts:74`（`addAction`）、`243`、`263`、`288`、`343`、`545-553`（`add`）；`tests/storage.test.ts:47-52`、`78-83`、`113`、`201`。

**Interfaces:**
- Consumes: `detailOf`、`make(…, detail?)`（Task 4）；`Title`（Task 2）。
- Produces：`card.options[i].detail`（`add_decision` 必填）；`card.detail`（`add_user_action` 必填、`propose_change` 選填）；`apply_change` 把提案卡的 `detail` 抄到它寫的每一筆（各個改動和 `card.resolve`）；`resolve_decision`、`resolve_direct_edit` 選填的 `detail` 寫在那一筆的最外層。開卡那筆 `card.open` 不帶最外層 `detail`。

比對重複的欄位（設計 11.3）：選項 → `label`、`effect`；`add_user_action` → `action`、`why`；`propose_change` → `question`、`why`；`resolve_decision` → `outcome`；`resolve_direct_edit` → `summary`。`add_decision` 每個選項先查 `label`、`effect`，再查 `detail`（`tools.test.ts:213` 預期先報 `effect`）。schema：選項的 `required` 加 `detail`、`add_user_action` 的 `required` 加 `detail`，新參數都附 `description`。

- [ ] **Step 1: 寫會失敗的測試** `tests/tools.test.ts`

```ts
test('add_decision_needs_a_detail_on_every_option')            // 驗收 6
  // options [opt('a'), { label:'b', effect:'y' }] → 'options[1].detail is required: what choosing it means in practice'
  // options[0].detail 3 → 'options[0].detail must be a string'
  // options[0] effect 'a leads on'、detail 'A leads on.' → toContain('options[0].detail only repeats the effect')
  // options[0].detail ' 選了就\r\n先做 a ' → card.options[0].detail '選了就\n先做 a'
test('add_user_action_needs_a_detail')
  // { action:'x', why:'y' } → 'detail is required: why the user has to do this and what happens once it is done'
  // detail 'Y.' → toContain('detail only repeats the why')；有 detail → card.detail 是正規化過的那段
test('propose_change_takes_an_optional_detail')                 // 驗收 7 的工具部分
  // detail ' 同意之後多一個項目「文件」 ' → card.detail '同意之後多一個項目「文件」'，card.open 那筆沒有最外層 detail 鍵；'**先**看' 原樣
  // 沒給、'  '、'\u200b\ufeff' → Object.hasOwn(card, 'detail') false
  // '中'.repeat(201) → 'detail is 402 cells wide; …'；計畫有 item design01 時 '影響 design01' → toContain('detail names plan ids (design01)')
  // 7 → 'detail must be a string'
test('apply_change_copies_the_card_detail_to_every_entry')      // 驗收 8 的工具部分
  // 提案卡 p1（紀錄裡的 card 帶 detail '同意之後多兩個項目'、兩個 item.add）核准後 apply_change
  //   → 寫出 3 筆，entries.every(e => e.detail === '同意之後多兩個項目') true，最後一筆是 card.resolve
  // 沒細節的提案卡 → entries.some(e => Object.hasOwn(e, 'detail')) false
test('resolve_tools_take_an_optional_detail')
  // resolve_decision { card, outcome:'選了 LRU', detail:'記憶體夠用，\n之後再看命中率' } → entries[0].detail 是那段
  // detail '選了LRU。' → 'detail only repeats the outcome; say what it leaves out'
  // resolve_direct_edit（有被標記的行）帶 detail → entries[0].detail；沒帶 → 沒有 detail 鍵
```

- [ ] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected：Step 1 的 5 個測試和補了細節的舊測試 fail，其他 pass。

- [ ] **Step 3: 實作**：照 Interfaces 改 `tools.ts`。`apply_change` 用 `ctx.plan.cards[cardId].detail`（重算時已正規化）。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/tools.ts plugins/plan-board/tests
git commit -m "feat(plan-board): details on decision options, action cards, proposals and resolutions"
```

---

### Task 6: 給 AI 的說明和摘要

**Files:**
- Modify: `plugins/plan-board/hooks/guide.ts:4-23`（`GUIDE`）、`:46-56`（`summary` 的步驟列）
- Test: `tests/view.test.ts`；`summary_shows_repos_and_their_short_names`（`view.test.ts:353-355`）三個斷言的結尾 `\n` 前加 `, no detail`

**Interfaces:**
- Consumes: `plan.steps[id].detail`（Task 3）；工具的參數名 `detail`、`why_detail`、op `detail`（Task 4、5）。
- Produces：摘要裡還沒做完、沒細節的步驟那一列，**最後**接 `, no detail`；做完的步驟不標（設計 7.4）；細節本身不進摘要。

`GUIDE` 的改法（設計 10；英文，措辭可微調、意思不變）：

- `guide.ts:10`（note 那條）後面加，原文照設計：

```ts
  "- A step's title says what it is in one line; its note, where it stands or who it waits on; its detail explains it: what it does for the user, how you will know it is done. Put explanations in details, not only in a spec or HTML page: the user reads them in the pane. Every new step needs one; give an older step one when you next work on it, once and in full.",
  '- Keep every why to one line; when the reason needs more, put the rest in why_detail (update_step) or detail (resolve_decision, resolve_direct_edit).',
```

- `guide.ts:7` 結尾加：`Give propose_change a detail only when the one-line why cannot say it: what the plan will look like once the user approves.`
- `guide.ts:14`：「2-4 options each with what it leads to」改成「2-4 options each with what it leads to and a detail on what choosing it means in practice」。
- `guide.ts:15`：「(one line, and the command word for word)」改成「(one line, a detail on why the user has to do this and what happens once it is done, and the command word for word)」。
- `guide.ts:20`：「(title copied as written)」改成「(title copied as written, and a detail in the user's words on what the task does for them and how you will know it is done)」。
- `guide.ts:21` 換成：`"- Every why, card question, item or step title, detail and outcome is read by the user: write it in plain words in the user's language, with no ids and no file or function names they have not used. A detail is plain text: line breaks are fine, no markdown; keep it within 400 cells (about 200 Chinese characters); one that only repeats its title is refused."`

- [ ] **Step 1: 寫會失敗的測試** `tests/view.test.ts`

```ts
test('summary_marks_steps_without_a_detail')                    // 驗收 13
  // item A；step.add s1 status doing detail '先把格式定下來'；s2 status doing（沒細節）；s3 status done result 'ok'（沒細節）
  expect(out).toContain('- [s1] s1 — doing\n')
  expect(out).toContain('- [s2] s2 — doing, no detail\n')
  expect(out).toContain('- [s3] s3 — done, result: ok\n')
  expect(out).not.toContain('先把格式定下來')
test('guide_explains_details')   // 介面就是給 AI 的這段文字（johnny-test-review 的例外）
  expect(GUIDE).toContain('its detail explains it: what it does for the user, how you will know it is done')
  expect(GUIDE).toContain('Put explanations in details, not only in a spec or HTML page')
  expect(GUIDE).toContain('why_detail (update_step)')
  expect(GUIDE).toContain('what choosing it means in practice')
  expect(GUIDE).toContain('why the user has to do this and what happens once it is done')
  expect(GUIDE).toContain('what the plan will look like once the user approves')
  expect(GUIDE).toContain('within 400 cells')
  expect(GUIDE).toContain('no markdown')
```

- [ ] **Step 2: 跑測試，確認失敗**：Run `claude plugin test plugins/plan-board`；Expected：上面 2 個和改過斷言的 `summary_shows_repos_and_their_short_names` fail，其他 pass。

- [ ] **Step 3: 實作**：照上面改 `GUIDE` 和 `summary`。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/guide.ts plugins/plan-board/tests/view.test.ts
git commit -m "feat(plan-board): tell the AI what goes in a detail and flag steps without one"
```

---

### Task 7: 總表的步驟細節（`detailToggle`、`detailBlock`）

**路線：A**（2026-11-16）。terminal 兩種版面 Johnny 看過：長 label 接到下一列，中文和英文的結尾都看得到。Claude desktop 還沒看，Johnny 決定之後再看；到時若被截，只改 `detailToggle` 換成路線 B。

**Files:**
- Modify: `plugins/plan-board/hooks/pane.tsx:125-128`（`foldButton` 旁邊加兩個元件）、`:142-164`（`stepRow`）
- Modify: `plugins/plan-board/hooks/local.ts:93-113`（`forget`）
- Test: `tests/pane.test.ts`、`tests/local.test.ts`

**Interfaces:**
- Consumes: `plan.steps[id].detail`（Task 3）；`update_step` 的 `add`（帶 `detail`）、`detail` op、`remove`（Task 4）。
- Produces（`paneView` 裡的閉包，Task 8 用）：

```tsx
/** The one control that opens and closes a detail: a plain Button keyed `key` (also its key in mine.expanded), ▸ closed and ▾ open,
 *  before the label or after it; after an empty label it is the arrow alone. No hotkey. */
const detailToggle = (key: string, label: string, place: 'before' | 'after') => JSX.Element
/** The one place a detail is drawn: a column Box indented `indent`, one dim wrapping Text per line (keys `${key}:${n}`), a blank line as ' '. */
const detailBlock = (key: string, detail: string, indent: number) => JSX.Element
```

- Produces：步驟的展開鍵和開關的 key 都是 `detail:<步驟 id>`；`forget` 在步驟還在（`plan.steps` 有這個 id）或卡片沒結案時保留 `detail:<id>`，其他丟掉。

畫法（設計 8.1）：沒細節的步驟一列都不變。有細節的步驟：

- 路線 A：畫標題的那個元素（沒標 repo 時是 `${mark} ${step.title}` 那個 `Text`；標了 repo 時是標題那個 `Text`）換成 `detailToggle(`detail:${stepId}`, 同一段文字, 'after')`。
- 路線 B：那個 `Text` 不動，同一列緊接 `detailToggle(`detail:${stepId}`, '', 'after')`（兩者包在 `flexDirection="row" gap={1}` 的 `Box`）。
- 兩條路線都是：原本那一列外面包一層 `flexDirection="column"` 的 `Box`，展開時列的下面接 `detailBlock(`detail:${stepId}`, step.detail, 2)`。「做完 n 步」裡的步驟用同一個 `stepRow`，一樣能點開。

- [ ] **Step 1: 寫會失敗的測試**

`tests/pane.test.ts`（兩個 surface 都跑，照現有測試的 `start`／`fresh`／`pane` 寫法）：

```ts
test('a_step_detail_opens_under_its_title', ZH)                 // 驗收 1 的畫面部分
  // board()；update_step add { item:B, title:'英文說明', detail:'寫給第一次用的人：\n裝好後五分鐘內看得懂總表' }；按 item:B
  expect((await ui.find({ key: `detail:${id}` }))?.text).toMatch(/▸$/)
  expect((await ui.find({ key: `detail:${id}` }))?.props.hotkey).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '寫給第一次用的人：' })).toBeUndefined()
  // 按 detail:<id> → 開關 /▾$/，'寫給第一次用的人：'、'裝好後五分鐘內看得懂總表' 兩個 Text 都在；再按 → 都不在
  // S1（做完）用 detail op 補上細節：按 steps:B 之後 detail:S1 一樣開得了
test('a_detail_draws_one_row_per_line', ZH)                     // 驗收 2
  // 紀錄：board() + step.detail S2 '  第一行\r\n\r\n\r\n第二\t行 \u001b[31m '；按 item:B、detail:S2
  const rows = await order(ui); const at = rows.indexOf('第一行')
  expect(rows.slice(at, at + 3)).toEqual(['第一行', ' ', '第二 行 [31m'])
test('a_step_without_a_real_detail_has_no_toggle', ZH)          // 11.3「空白」的重算欄
  // 紀錄：board() + step.add S3 detail '\u0007  '；按 item:B → findAll Button 沒有 key 開頭 'detail:' 的
test('a_detail_written_later_shows_a_toggle_and_no_change_row', ZH) // 驗收 5 的畫面部分
  // board()；按 item:B，記下 key log:B 的 Button 文字；update_step { ops:[{ action:'detail', step:S2, detail:'兩個畫面各自記得捲到哪' }] }
  // → detail:S2 /▸$/；log:B 的文字和之前一樣
test('closed_step_details_add_no_overview_rows', ZH)           // 驗收 10 的總表部分
  // 同一份 board()，一份每個步驟都有細節、一份都沒有；各自按 item:B、steps:B
  // (await order(ui)).filter(r => r !== '▸').length 兩份相等（路線 B 的 ▸ 和標題在同一列）
test('opening_details_never_touches_the_log', ZH)              // 驗收 12
  // repo 模式：before = w.files[LOG]；按 detail:S2 開、關、再開 → w.files[LOG] toBe before；localOf(w).expanded toContain `detail:${S2}`
  // await $.prompt.submit({ text: '' })、重開窗格 → detail:S2 仍是 /▾$/、細節的 Text 在
  // update_step remove S2 → localOf(w).expanded 不含 `detail:${S2}`
  // 本機模式（startLocal）：before = w.store.get('log:/repo')；開、關 → 不變
```

`tests/local.test.ts`：

```ts
test('forget_keeps_detail_keys_of_live_steps_and_open_cards')
  // 計畫：item A、step s1、開著的卡 open、結案的卡 closed
  // expanded ['detail:s1','detail:gone','detail:open','detail:closed'] → forget 後 ['detail:s1','detail:open']
```

- [ ] **Step 2: 跑測試，確認失敗**：Run `claude plugin test plugins/plan-board`；Expected：上面 5 個 fail；`a_step_without_a_real_detail_has_no_toggle`、`closed_step_details_add_no_overview_rows` 現在就 pass（守的是不能多出來的東西），其他 pass。

- [ ] **Step 3: 實作**：照 Interfaces 和畫法改 `pane.tsx`、`local.ts`（`forget` 加一條 `/^detail:(.*)$/` 的規則）。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`（`old_logs_draw_the_same_rows_as_0_4_2` 不改仍 pass）；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/pane.tsx plugins/plan-board/hooks/local.ts plugins/plan-board/tests
git commit -m "feat(plan-board): a step's detail opens under its title"
```

---

### Task 8: 卡片和變動紀錄的細節

**Files:**
- Modify: `plugins/plan-board/hooks/pane.tsx:94-109`（`logRow`）、`:317-331`（待你處理卡）、`:344-386`（選項、提案卡）
- Modify: `plugins/plan-board/hooks/i18n.ts`（兩張表各加兩個鍵）
- Test: `tests/pane.test.ts`

**Interfaces:**
- Consumes: `detailToggle`、`detailBlock`（Task 7）；`card.options[i].detail`、`card.detail`、`entry.detail`（Task 3）；`add_decision`、`add_user_action`、`propose_change`、`apply_change`、`resolve_decision` 的 `detail`、`update_step` 的 `why_detail`（Task 4、5）。
- Produces：i18n 鍵 `optionDetails`（en `Option details`、zh-TW `選項細節`）、`details`（en `Details`、zh-TW `細節`）；卡片的展開鍵 `detail:<卡片 id>`。

畫法（設計 8.2–8.4）：

- 問題卡，至少一個選項有細節：`detailToggle(`detail:${card.id}`, t(lang, 'optionDetails'), 'before')` 放在選項那個 `Box`（`pane.tsx:344`，已有 `marginTop={1}`）的第一個，自己不加 margin；展開時，有細節的選項在「選了會怎樣」那個 `Box` 後面接 `detailBlock(`detail:${card.id}:${i}`, option.detail, 4)`。
- 提案卡有 `detail`：改動清單之後、「不要」之前，`<Box paddingLeft={2}>` 包 `detailToggle(`detail:${card.id}`, t(lang, 'details'), 'before')`；展開時接 `detailBlock(…, card.detail, 4)`。
- 待你處理卡有 `detail`：「為什麼」（`whyBox('actionWhy')`）之後、「指令」之前，`detailToggle(…, t(lang, 'details'), 'before')`；展開時接 `detailBlock(…, card.detail, 2)`。
- `logRow`：`why:<紀錄 id>` 展開而且紀錄有 `detail` 時，原因那個 `Box` 後面接 `detailBlock(whyKey, entry.detail, 4)`。展開後的收合列、卡片「之前的變動」的單筆都經 `logRow`，一樣有；「之前的變動」裡收合的列維持純文字。
- 已送出的卡、沒攤開的卡、輸入框上方那一列：不畫細節。

- [ ] **Step 1: 寫會失敗的測試** `tests/pane.test.ts`（兩個 surface 都跑）

```ts
test('option_details_open_together_under_each_option', ZH)       // 驗收 6
  // add_decision { item:B, question:'輸入框上方要不要顯示做完的數量？', why:'一列只放得下兩三件事', options:[
  //   { label:'不顯示', effect:'一列保持短', detail:'那列一眼看完，\n但要開窗格才知道做完幾項' },
  //   { label:'顯示', effect:'一眼看到進度', detail:'那列多幾個字，窄的終端機會被截' }] }；按 view:cards
  // key detail:<card> 的文字 '▸ 選項細節'；'那列一眼看完，' 不在
  // 按 detail:<card> → '▾ 選項細節'；rows = await order(ui)
  expect(rows.indexOf('那列一眼看完，')).toBe(rows.indexOf('一列保持短') + 1)
  expect(rows.indexOf('但要開窗格才知道做完幾項')).toBe(rows.indexOf('那列一眼看完，') + 1)
  expect(rows.indexOf('那列多幾個字，窄的終端機會被截')).toBe(rows.indexOf('一眼看到進度') + 1)
  // 選「不顯示」、按 send 之後（卡片變淡）：沒有 '選項細節' 也沒有細節的 Text
test('an_action_card_detail_opens_between_why_and_command', ZH)  // 驗收 6
  // addAction(…, { item:B, step:S2, detail:'沒人核准就不會跑；\n核准後下一輪自動跑' })；按 view:cards
  // at('▸ 細節') 在 at('新的檢查要人核准才會跑') 之後、at('指令：thoth checks approve') 之前
  // 按開 → '沒人核准就不會跑；'、'核准後下一輪自動跑' 依序緊接開關之後
test('a_proposal_detail_opens_under_approve', ZH)                // 驗收 7 的畫面部分
  // propose_change 帶 detail '同意之後多一個項目「文件」' → at('▸ 細節') 在改動那一列之後、at('不要') 之前；按開 → 細節在
  // 另一張沒帶 detail 的提案卡：攤開後沒有 key 是 detail:<那張卡> 的 Button
test('a_change_with_a_detail_shows_it_under_the_reason', ZH)     // 驗收 8
  // propose_change 帶 detail、apply_change { card, chat:'好' }；update_step why '換做法' why_detail '舊做法太慢'；
  // resolve_decision 帶 detail；打開 item 的變動紀錄、展開收合的列
  // 每筆有細節的紀錄：按下後 rows 裡 '原因：…' 的下一列就是細節的第一列
  // 沒細節的紀錄（例如 board() 的 step.status）：按下後 '原因：…' 的下一列不是細節
  // 卡片「之前的變動」：收合的列是 Text，findAll Button 沒有同樣文字的
test('closed_details_add_at_most_one_row_per_card', ZH)          // 驗收 10 的卡片部分
  // 同一張問題卡、待你處理卡、提案卡，各一份有細節、一份沒有：攤開後 (await order(ui)).length 相差正好 1
test('each_card_opens_only_its_own_details', ZH)                 // Review Focus 5
  // 兩張都在 item B、都有選項細節的問題卡（第二張指到 S2，S2 也有細節）；按 card:<第二張> 攤開
  // 按 detail:<第一張> → 第一張的細節在、第二張的不在；localOf(w).expanded 不含 `detail:${S2}`
```

- [ ] **Step 2: 跑測試，確認失敗**：Run `claude plugin test plugins/plan-board`；Expected：上面 6 個 fail，其他 pass。

- [ ] **Step 3: 實作**：照畫法改 `pane.tsx`，`i18n.ts` 的 `EN`、`ZH_TW` 各加 `optionDetails`、`details`。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`（`old_logs_draw_the_same_rows_as_0_4_2` 不改仍 pass）；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/pane.tsx plugins/plan-board/hooks/i18n.ts plugins/plan-board/tests/pane.test.ts
git commit -m "feat(plan-board): details open on cards and under a change's reason"
```

---

### Task 9: 兩種語言的字串

**Files:**
- Modify: `plugins/plan-board/hooks/lines.ts:119-120` 後面（`changeLine` 的 `step.detail` case）
- Modify: `plugins/plan-board/hooks/i18n.ts`（`stepDetail`）
- Test: `tests/pane.test.ts`

**Interfaces:**
- Consumes: `step.detail` 型別（Task 3）；`optionDetails`、`details`（Task 8）。
- Produces：i18n 鍵 `stepDetail`：en `wrote the detail of "{step}"`、zh-TW `「{step}」寫了細節`。`changeLine` 的 `step.detail` 回 `${t(lang, 'kindStep')} ${t(lang, 'stepDetail', { step: name(change.data.step) })}`（它不進變動紀錄，同 `repo.name`，但每種都有一句）。

- [ ] **Step 1: 寫會失敗的測試** `tests/pane.test.ts`

```ts
test('step_detail_line_in_both_languages')
  // plan = replay(board())
  expect(changeLine({ kind: 'step.detail', data: { step: S1, detail: '隨便' } }, plan, 'en')).toBe('Step wrote the detail of "定檔案格式"')
  expect(changeLine({ kind: 'step.detail', data: { step: S1, detail: '隨便' } }, plan, 'zh-TW')).toBe('步驟 「定檔案格式」寫了細節')
test('detail_labels_in_english')        // 不帶 ZH
  // add_decision 帶選項細節、addAction 帶細節 → view:cards 有 '▸ Option details'、'▸ Details'
```

`no_ids_in_zh_tw_text`（驗收 13）：資料改成 `[...everything(), ...detailed()]`，`detailed()` 是新的一串：S2 的 `step.detail`、一筆帶最外層 `detail` 的 `step.status`、一張帶選項細節的問題卡、一張帶細節的待你處理卡、一張帶細節的提案卡，文字都不含 id；收集文字之前，也按開每個 key 開頭 `detail:` 的 Button 和每筆紀錄。`old_logs_draw_the_same_rows_as_0_4_2` 繼續只用 `everything()`。`i18n_tables_have_the_same_keys` 不改，要繼續 pass。

- [ ] **Step 2: 跑測試，確認失敗**：Run `claude plugin test plugins/plan-board`；Expected：`step_detail_line_in_both_languages` fail，其他 pass。

- [ ] **Step 3: 實作**：照 Interfaces 改 `lines.ts`、`i18n.ts`。

- [ ] **Step 4: 跑全部檢查**：`claude plugin test plugins/plan-board` → `0 fail`；`claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/hooks/lines.ts plugins/plan-board/hooks/i18n.ts plugins/plan-board/tests/pane.test.ts
git commit -m "feat(plan-board): detail strings in both languages"
```

---

### Task 10: 版本、README、整體驗收

**Files:**
- Modify: `plugins/plan-board/.claude-plugin/plugin.json:3`
- Modify: `README.md:49-52`、`README.zh-TW.md:49-52`
- 一次性的相容檢查腳本放 session 的 scratchpad，不進 repo、不留成測試（設計 12 第 11 條）。

**Interfaces:**
- Consumes: Task 2–9 的全部行為。
- Produces: 無。

- [ ] **Step 1: 版本**：`"version": "0.4.2"` → `"version": "0.5.0"`。

- [ ] **Step 2: README**

`README.md` 表格最後一列換成：

```markdown
| Steps: add, reword, remove, move to another item, assign, change status, note where they stand, explain them in a detail, tag with the repo they are done in; short names for repos | The AI uses `update_step` | No, but every change is logged with a reason |
```

在 `- A **step** is the AI's level: …` 那一點後面加：

```markdown
- Every step, every option of a decision card and every action card has a **detail**: a few plain lines on what the step does for you and how you will know it is done, what choosing the option means in practice, or why you have to do it and what happens once it is done. It stays folded until you press the ▸ by a step, "▸ Option details" or "▸ Details"; press again to fold it. A proposal and a change in the history carry one only when one line of why is not enough; a change shows it under its reason when you press it. Details are plain text in your words, at most about 200 Chinese characters or 400 letters and 8 lines. A step without one shows as before.
```

`README.zh-TW.md` 表格最後一列換成：

```markdown
| 步驟：新增、改字、刪掉、移到別的項目、改派、改狀態、寫備註、寫細節、標在哪個 repo 做；repo 的短名 | AI 用 `update_step` | 不用，但每次都記錄原因 |
```

在 `- **步驟**是 AI 的層級：…` 那一點後面加：

```markdown
- 每個步驟、決定卡的每個選項、每張待你處理卡都有一段**細節**：幾行白話，說步驟替你做什麼、怎樣算做完，選了某個選項實際會怎樣，或為什麼要你做、做完會怎樣。平常收著，按步驟旁的 ▸、「▸ 選項細節」或「▸ 細節」才展開，再按一下收起。提案卡和變動紀錄只在一行原因講不完時帶細節，按那筆紀錄時接在原因底下。細節是純文字、用你的語言，最多約 200 個中文字或 400 個英文字母、8 行。沒有細節的步驟照舊顯示。
```

- [ ] **Step 3: 一次性的相容檢查（驗收 9 的本 repo log、驗收 11）**

在 scratchpad 建 `old/hooks/`，放 `git show 3fb1e29:plugins/plan-board/hooks/{replay,checksum,logfile}.ts` 的內容（它們對 `../types` 只有 `import type`，Node 會拿掉）。Node 24 腳本用 `pathToFileURL` 動態 import 新、舊兩份：

1. 新的 `sealEntry` 封一份新格式的 log：`item.add`、帶 `detail` 的 `step.add`、`step.detail`、帶選項細節的問題卡、帶細節的待你處理卡、一筆最外層帶 `detail` 的 `step.status`。
2. 舊的 `replay` 重算它：`flagged` 0；那些步驟和卡片都在；`skipped` 正好是 `step.detail` 那幾筆，理由 `unsupported kind: step.detail`。舊的 `nextText(新 log, [一筆舊格式紀錄], [])` 開頭等於新 log。
3. `git show 3fb1e29:plan/log.jsonl`：新、舊 `replay` 的 `flagged` 都是 0，兩份計畫 `JSON.stringify` 一字不差。
4. 工作目錄的 `plan/log.jsonl`（只讀）：新 `replay` 的 `flagged` 是 0。

Expected：四項都成立；腳本輸出原樣貼進這個 Task 的回報。

- [ ] **Step 4: 跑全部檢查**

Run: `claude plugin test plugins/plan-board` → `0 fail`。
Run: `claude plugin validate plugins/plan-board` → `✔ Validation passed with warnings`。
Run: `claude plugin validate .` → `✔ Validation passed with warnings`。
Run: `node --test tests-git/merge.test.ts` → `fail 0`。
用 Grep 工具：`README.md` 有 `detail`、`README.zh-TW.md` 有 `細節`，各自在「Items and steps」／「項目和步驟」那一節；`plugin.json` 有 `"version": "0.5.0"`。

- [ ] **Step 5: Commit**

```bash
git add plugins/plan-board/.claude-plugin/plugin.json README.md README.zh-TW.md
git commit -m "docs(plan-board): README and 0.5.0 for details that open in place"
```

---

## 設計 11.3 異常輸入 → 測試

簡稱：`add_needs` = `add_needs_a_detail_and_writes_it_normalized`，`options_need` = `add_decision_needs_a_detail_on_every_option`，`propose` = `propose_change_takes_an_optional_detail`，`why_detail` = `why_detail_goes_on_every_entry_of_the_call`，`replayed` = `details_replay_normalized_on_steps_options_cards_and_entries`。

| 輸入 | 必填（工具） | 選填（工具） | 重算 |
|---|---|---|---|
| 沒給 | T4 `add_needs`；T5 `options_need`、`add_user_action_needs_a_detail` | T5 `propose`；T4 `why_detail` | T3 `old_and_new_lines_are_never_flagged` |
| 不是字串 | T4 `add_needs`；T5 `options_need` | T5 `propose`；T4 `why_detail` | T3 `a_detail_that_is_not_a_string_skips_the_entry` |
| 空字串、只有空白或控制字元 | T4 `add_needs`、`detail_op_replaces_but_never_clears` | T5 `propose`；T4 `why_detail` | T3 `replayed`（`s2`）；T7 `a_step_without_a_real_detail_has_no_toggle` |
| 只有零寬字元 | T2 `blank_control_or_zero_width_only_is_empty`；T4 `add_needs` | T5 `propose` | T3 `replayed`（`s7`） |
| 超過 400 格或 8 行 | T4 `add_detail_limits_are_200_chinese_400_letters_8_lines`；T2 `limits_count_the_normalized_text` | T5 `propose` | T3 `replayed`（`s3` 照顯示） |
| 控制字元、多行 | T2 `normalize_follows_the_four_rules`；T4 `add_needs` | T4 `why_detail` | T3 `replayed`、`crlf_lines_with_multiline_details_stay_sealed`；T7 `a_detail_draws_one_row_per_line` |
| 和標題重複 | T4 `a_detail_that_repeats_the_title_or_names_ids_is_refused`；T5 `options_need` | T4 `why_detail`；T5 `resolve_tools_take_an_optional_detail` | T3 `replayed`（`s5` 照顯示） |
| 含現有的計畫 id | T4 `a_detail_that_repeats_the_title_or_names_ids_is_refused` | T5 `propose` | T3 `replayed`（`s6` 照顯示） |
| markdown 符號 | T4 `add_needs` | T5 `propose` | T3 `replayed`（`s4`） |

## 設計 12 驗收條件 → Task 與測試

| # | Task | 測試 |
|---|---|---|
| 1 | T4、T7 | `a_refused_detail_writes_nothing`、`add_needs_a_detail_and_writes_it_normalized`；`a_step_detail_opens_under_its_title` |
| 2 | T2、T7 | `normalize_follows_the_four_rules`；`a_detail_draws_one_row_per_line` |
| 3 | T4（T2） | `add_detail_limits_are_200_chinese_400_letters_8_lines`（`limits_are_400_cells_and_8_lines`） |
| 4 | T4 | `a_detail_that_repeats_the_title_or_names_ids_is_refused`、`detail_goes_only_on_add_or_detail_ops` |
| 5 | T4、T7 | `detail_op_replaces_but_never_clears`；`a_detail_written_later_shows_a_toggle_and_no_change_row` |
| 6 | T5、T8 | `add_decision_needs_a_detail_on_every_option`、`add_user_action_needs_a_detail`；`option_details_open_together_under_each_option`、`an_action_card_detail_opens_between_why_and_command` |
| 7 | T5、T8 | `propose_change_takes_an_optional_detail`；`a_proposal_detail_opens_under_approve` |
| 8 | T5、T8 | `apply_change_copies_the_card_detail_to_every_entry`、`resolve_tools_take_an_optional_detail`；`a_change_with_a_detail_shows_it_under_the_reason` |
| 9 | T3、T10 | `old_logs_draw_the_same_rows_as_0_4_2`、`old_and_new_lines_are_never_flagged`、`a_line_sealed_by_0_4_2_stays_sealed`；T10 Step 3 第 3、4 項（一次性） |
| 10 | T7、T8 | `closed_step_details_add_no_overview_rows`；`closed_details_add_at_most_one_row_per_card` |
| 11 | T10 | Step 3 第 1、2 項（一次性，附輸出，不留成測試） |
| 12 | T7 | `opening_details_never_touches_the_log`、`forget_keeps_detail_keys_of_live_steps_and_open_cards` |
| 13 | T6、T9 | `summary_marks_steps_without_a_detail`；`no_ids_in_zh_tw_text`（加上 `detailed()`）、`i18n_tables_have_the_same_keys` |
| 14 | T10 | Step 4：`claude plugin validate`、`plugin.json` 的 `0.5.0`、兩份 README 的 Grep |
