# plan-board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 plan-board 這個 Claude Code 外掛：每個 repo 的計畫存成 `plan/log.jsonl`，在窗格裡顯示總表和決定卡，計畫只能由 AI 透過外掛的工具修改。

**Architecture:** 不依賴 Claude Code 的小模組（checksum、replay、view、guide、tools、local、lines、i18n、logfile）負責所有規則，各自寫單元測試。`register.tsx` 只負責接線：事件、工具註冊、寫檔、計時；`pane.tsx` 負責畫面。計畫一律從紀錄重算，不另存狀態。

**Tech Stack:** TypeScript／TSX 的 Claude Code 外掛（hooks module），`claude plugin test`（Bun 風格的測試）、`claude plugin validate`，Node 24 `node --test`（只跑真的 git 合併測試），git。

**Spec:** `docs/superpowers/specs/2026-10-07-plan-board-design.md`。實作前先讀完。本計畫的節號（例如「spec 5.4」）都指這份 spec。

**參考寫法：** Thoth 外掛（`johnny-lo/Thoth` 的 `plugins/thoth`）（`register.tsx`、`i18n.ts`、`tests/panel.test.ts`），以及舊的 decisions mod `~/.claude/mods/decisions`（暫存與送出的邏輯、`tests/decisions.test.ts`）。mod API 以 Claude Code 的 mod 型別定義檔 `claude-code.d.ts` 為準。

## Global Constraints

- 外掛名稱 `plan-board`。repo 根目錄是 marketplace（`.claude-plugin/marketplace.json`），外掛在 `plugins/plan-board/`。
- **純模組**（`hooks/` 底下除了 `register.tsx`、`pane.tsx` 以外的檔案）只能 `import type` Claude Code 和 `../types` 的型別，引用其他模組時一律寫明 `.ts` 副檔名（例如 `import { sha16 } from './checksum.ts'`）。不能用 enum、namespace、parameter properties。原因：`tests-git/` 要用 Node 24 直接載入這些模組，Node 的去型別模式只支援這些寫法。已在 2026-10-07 實測過，外掛載入器接受 `.ts` 副檔名的引用。
- 外掛測試檔只能引用自己的相對路徑檔案和 `claude-code`、`claude-code/testing`，不能引用 `node:*`（已實測，會載入失敗）。
- 紀錄檔：`<根目錄>/plan/log.jsonl`。`.gitattributes` 要有一模一樣的這一行：`plan/log.jsonl merge=union`。
- id：紀錄 12 個十六進位字元；項目、步驟、卡片 8 個。產生方式：`crypto.randomUUID().replace(/-/g, '').slice(0, n)`。
- `sum` = `sha16(JSON.stringify({id, at, kind, why, basis, data}))`，欄位就是這個順序；`sha16` = SHA-256 十六進位字串的前 16 個字元，用 `crypto.subtle.digest`（已實測，外掛執行環境和 Node 都可用）。
- 原始行的雜湊 = 去掉結尾 `\r` 之後那一行的 `sha16`。
- 畫面上的文字（窗格、輸入框上方一列、送給使用者看的提示）不能出現任何 id。給 AI 的文字（說明、摘要、工具結果、送給 AI 的訊息）一律英文，可以帶 id。
- `userConfig.language`：`en`（預設）或 `zh-TW`，而且一定要有 `title`（少了它 `claude plugin validate` 會失敗）。
- 常數：`AUTO_SEND_MS = 60_000`；卡片的「之前」顯示 3 筆；寫檔重來最多 3 次。
- `$.fs.read` 最多讀 4 MiB，紀錄檔超過就讀不了，接受這個限制。
- 外掛和工具都不 commit、不 push。本計畫不建立 GitHub repo，也不 push。
- 授權 `MIT OR Apache-2.0`。
- commit 訊息照執行者所在環境的 attribution 規則。

**驗證指令**（在 repo 根目錄執行）：

- `claude plugin test plugins/plan-board`：通過時最後一段是 `N pass`、`0 fail`。
- `claude plugin validate plugins/plan-board --strict` 和 `claude plugin validate .`：沒有錯誤。
- `node --test tests-git/merge.test.ts`：`fail 0`。

## Review Focus

1. **Windows 的 CRLF**：這台電腦 commit 時 git 會提示「LF will be replaced by CRLF」，代表 checkout 後紀錄檔每行結尾會多出 `\r`。這種行必須照常通過檢查碼，不能被標成「被直接改過」。測試放在 Task 2（`crlf_and_bom_are_not_edits`）和 Task 1（`check_ignores_trailing_cr`）。
2. **新 repo 還沒有計畫**：窗格和輸入框上方一列要正常顯示空的狀態；第一次呼叫工具時，要自動建好 `plan/log.jsonl` 和 `.gitattributes`。測試放在 Task 7（`first_proposal_creates_log_and_gitattributes`）和 Task 8（`empty_repo_shows_hint_and_engine_band`）。
3. **檔案開頭有 BOM**：使用者用編輯器存檔時可能加上 BOM，第一行不能因此被標記。測試放在 Task 2（`crlf_and_bom_are_not_edits`）。
4. **同一個 worktree 有兩個 session 同時寫入**：重來 3 次還是不行，就讓工具回傳錯誤，絕對不能覆蓋別人寫的行。測試放在 Task 7（`concurrent_write_retries_then_fails`）。
5. **卡片指到的項目或步驟後來被刪掉了**：卡片照常顯示，位置改成「其他」，不能出錯。測試放在 Task 4（`card_position`）和 Task 8（`card_of_removed_item_shows_other`）。

---

### Task 1: 專案骨架、型別、檢查碼

**Files:**
- Create: `.claude-plugin/marketplace.json`、`plugins/plan-board/.claude-plugin/plugin.json`、`plugins/plan-board/hooks/hooks.json`、`plugins/plan-board/tsconfig.json`、`plugins/plan-board/types/index.d.ts`、`plugins/plan-board/hooks/checksum.ts`、`plugins/plan-board/hooks/register.tsx`、`LICENSE-MIT`、`LICENSE-APACHE`
- Modify: `.gitignore`
- Test: `plugins/plan-board/tests/checksum.test.ts`

**Interfaces:**
- Produces: `types/index.d.ts` 的全部型別（如下，後面每個 task 都用它們）；`sha16(text: string): Promise<string>`；`sealEntry(entry: Entry): Promise<string>`（回傳一行，不含換行）；`checkLine(raw: string): Promise<{ entry: Entry | null; isSealed: boolean; hash: string }>`。

```ts
// plugins/plan-board/types/index.d.ts
export type StepStatus = 'todo' | 'doing' | 'done'
export type Basis =
  | { type: 'ai' }
  | { type: 'thoth'; task: string }
  | { type: 'card'; card: string; chat?: string }
  | { type: 'direct-edit' }
export type ItemSpec = { id: string; title: string; goal: string }
export type StepSpec = { id: string; title: string }
export type ItemChange =
  | { kind: 'item.add'; data: { item: ItemSpec; before?: string } }
  | { kind: 'item.remove'; data: { item: string } }
  | { kind: 'item.split'; data: { item: string; into: ItemSpec[] } }
  | { kind: 'item.merge'; data: { items: string[]; into: ItemSpec } }
  | { kind: 'item.edit'; data: { item: string; title?: string; goal?: string } }
  | { kind: 'item.reorder'; data: { order: string[] } }
export type StepChange =
  | { kind: 'step.add'; data: { item: string; step: StepSpec; after?: string } }
  | { kind: 'step.edit'; data: { step: string; title: string } }
  | { kind: 'step.remove'; data: { step: string } }
  | { kind: 'step.move'; data: { step: string; item: string; after?: string } }
  | { kind: 'step.assign'; data: { step: string; to: string } }
  | { kind: 'step.status'; data: { step: string; status: StepStatus; result?: string } }
export type CardOption = { label: string; effect: string; recommended?: boolean; reason?: string }
export type CardSpec = {
  id: string; type: 'question' | 'proposal'; item?: string; step?: string
  question: string; why: string; options: CardOption[]; blocking?: boolean; changes?: ItemChange[]
}
export type CardChange =
  | { kind: 'card.open'; data: { card: CardSpec } }
  | { kind: 'card.resolve'; data: { card: string; outcome: string; choice?: string } }
export type EditChange = { kind: 'edit.keep' | 'edit.drop'; data: { lines: string[]; summary: string } }
export type Change = ItemChange | StepChange | CardChange | EditChange
export type Entry = Change & { id: string; at: string; why: string; basis: Basis }

export type Item = { id: string; title: string; goal: string; steps: string[] }
export type Step = { id: string; item: string; title: string; status: StepStatus; assignee?: string; evidence?: { thoth?: string; result?: string } }
export type Card = CardSpec & { openedAt: string; resolved?: { outcome: string; choice?: string; at: string } }
export type Flagged = { raw: string; hash: string; entry: Entry | null }
export type Plan = {
  order: string[]
  items: Record<string, Item>
  steps: Record<string, Step>
  cards: Record<string, Card>
  /** Entries that took effect, oldest first. */
  applied: Entry[]
  /** Entries touching each item, oldest first; a step entry counts for the item the step was in when it applied. */
  itemLog: Record<string, Entry[]>
  /** Last known title of every item and step, and question of every card, including removed ones. */
  names: Record<string, string>
  flagged: Flagged[]
  skipped: { entry: Entry; reason: string }[]
}
export type ItemState = 'done' | 'doing' | 'next' | 'later'
export type Pick = { choice?: string; draft?: string; isDismissed?: boolean; at: number }
/** This machine's pane state for one worktree, kept in $.store. */
export type Local = { staged: Record<string, Pick>; sent: Record<string, Pick>; expanded: string[]; view: 'overview' | 'cards' }
```

- [ ] **Step 1: 建骨架**

照 Thoth 的 `plugins/thoth` 建出同樣的結構：
- `plugin.json`：`name: "plan-board"`、`version: "0.1.0"`、`description`、`author`、`types: "./types/index.d.ts"`，`userConfig.language` 照 Thoth 的寫法，但 `title` 寫 `"Language"`。
- `hooks.json`：`{"modules": ["./register.tsx"]}`。
- `tsconfig.json`：跟 Thoth 一樣。
- `marketplace.json`：`name: "plan-board"`、`owner.name: "plan-board contributors"`，`plugins` 裡放一筆 `source: "./plugins/plan-board"`。
- `register.tsx`：先放一個什麼都不做的 `register`。
- 兩份授權檔：從 Thoth 根目錄複製，著作權人改成 `plan-board contributors`。
- `.gitignore`：已經有一行 `.agent/`（Thoth 用的，保留），再加一行 `plugins/plan-board/.claude-plugin/types/`。

- [ ] **Step 2: 寫會失敗的測試** `tests/checksum.test.ts`

```ts
const E: Entry = { id: '000000000001', at: '2026-10-07T07:20:31.000Z', kind: 'item.add', why: 'start',
  basis: { type: 'ai' }, data: { item: { id: 'aaaaaaaa', title: '決定看板 v1', goal: '總表看得到' } } }
test('sha16_matches_sha256_prefix')        // sha16('abc') === 'ba7816bf8f01cfea'
test('seal_then_check_round_trips')        // Object.keys(JSON.parse(line)) === ['id','at','kind','why','basis','data','sum']; checkLine(line) → isSealed true, entry toEqual E
test('seal_ignores_input_key_order')       // sealEntry({ data, basis, why, kind, at, id }) === sealEntry(E)
test('check_flags_edits')                  // line.replace('決定看板','決定面板') → isSealed false, entry not null; line without sum → false; 'oops' → entry null, false; hash === sha16(raw)
test('check_ignores_trailing_cr')          // checkLine(line + '\r') → isSealed true, hash === (await checkLine(line)).hash
```

- [ ] **Step 3: 執行，確認失敗**：`claude plugin test plugins/plan-board`，預期因為 `checksum.ts` 不存在而失敗。

- [ ] **Step 4: 實作 `hooks/checksum.ts`**：`sealEntry` 依固定順序組出新物件再 stringify；`checkLine` 先去掉結尾的 `\r`，解析後取出 `sum`，把其餘欄位依解析出來的順序 stringify，再比對。

- [ ] **Step 5: 執行測試和兩個 validate**，全部通過。

- [ ] **Step 6: Commit**：`git add -A && git commit -m "feat: plan-board skeleton, types and line checksum"`（訊息最後一行照 Global Constraints）。

---

### Task 2: 從紀錄算出項目和步驟

**Files:**
- Create: `plugins/plan-board/hooks/replay.ts`、`plugins/plan-board/tests/fixtures.ts`
- Test: `plugins/plan-board/tests/replay.test.ts`

**Interfaces:**
- Consumes: Task 1 的型別、`sealEntry`、`checkLine`。
- Produces:
  - `emptyPlan(): Plan`
  - `applyEntry(plan: Plan, entry: Entry): string | null`：直接修改 `plan`，回傳 `null` 表示套用了，回傳字串表示略過的原因（英文）。Task 5 的工具會拿它來驗證輸入。
  - `replay(text: string): Promise<Plan>`
  - `tests/fixtures.ts`：`entry(kind, data, extra?: Partial<Entry>): Entry`（id 和 `at` 自動遞增，`at` 從 `2026-10-07T00:00:00.000Z` 開始每筆加 1 秒，`why` 預設 `'test'`，`basis` 預設 `{type:'ai'}`）；`logText(entries: Entry[]): Promise<string>`（每行 seal，用 `\n` 接起來，最後加一個 `\n`）。

規則（spec 5.3、5.4）：

| kind | 套用 | 略過的原因含有 |
|---|---|---|
| `item.add` | id 不能已經存在；有 `before` 且存在就插在它前面，否則放最後 | `item exists` |
| `item.remove` | 刪掉項目和它所有的步驟 | `unknown item` |
| `item.split` | 新項目依序放在原項目的位置；原項目的步驟全部移到第一個新項目 | `unknown item`／`item exists` |
| `item.merge` | 至少 2 個，而且都要存在；新項目放在 `items` 裡最早出現的那個位置；步驟依 `items` 的順序接起來 | `unknown item` |
| `item.edit` | 有給的欄位才改 | `unknown item` |
| `item.reorder` | `order` 必須剛好是目前所有項目的一種排列 | `order` |
| `step.add` | 項目要存在、id 是新的；`after` 是同一個項目裡的步驟就插在它後面，否則放最後 | `unknown item`／`step exists` |
| `step.edit`／`step.remove`／`step.assign` | 步驟要存在；`assign` 的 `to` 是空字串就刪掉 `assignee` | `unknown step` |
| `step.move` | 步驟和目標項目都要存在 | `unknown step`／`unknown item` |
| `step.status` | 設成 `done` 時：`basis.type === 'thoth'` 就把 `evidence` 設成 `{thoth: basis.task}`，否則設成 `{result: data.result}`；設成其他狀態時清掉 `evidence` | `unknown step` |

`replay`：把 `\uFEFF` 開頭去掉，用 `/\r?\n/` 切行，略過空行，每行跑 `checkLine`，再依 `id` 去重（留第一個），依 `(at, id)` 排序，逐筆 `applyEntry`。套用成功的放進 `applied` 和 `itemLog`，也更新 `names`；略過的放進 `skipped`。這個 task 先把沒通過檢查碼的行全部丟掉，Task 3 再改成標記。

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('adds_items_in_order_with_before')    // add A, add B, add C before A → order [C, A, B]
test('steps_add_move_status_and_evidence') // s1,s2 in A; s3 after s1 → A.steps [s1,s3,s2]; move s2 to B → B.steps [s2];
                                           // status s1 done basis {thoth,'T1'} → evidence {thoth:'T1'};
                                           // status s3 done result '面板測試全過' → {result:'面板測試全過'};
                                           // status s1 doing → evidence undefined; assign s3 'claude-b' then '' → assignee undefined
test('split_merge_edit_reorder')           // order [A,B]; split A into A1,A2 → [A1,A2,B], A's steps in A1;
                                           // merge [A2,B] into M → [A1,M], M.steps = A2.steps + B.steps; edit M goal;
                                           // reorder [M,A1] applied; reorder [M] → skipped reason contains 'order'
test('dedups_sorts_and_skips')             // same line twice → applied once; lines written newest-first still apply by at;
                                           // step.add to unknown item → skipped 'unknown item'; remove A then step.add to A → skipped
test('item_log_follows_the_step')          // s1 status in A appears in itemLog[A]; after move to B, later status appears in itemLog[B] only
test('names_keep_removed_titles')          // after item.remove A, names[A] === A's title
test('crlf_and_bom_are_not_edits')         // '\uFEFF' + text.replace(/\n/g,'\r\n') → same order/items/steps as text
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作 `replay.ts`。**
- [ ] **Step 4: 執行，確認通過。**
- [ ] **Step 5: Commit**：`feat: replay items and steps from the log`。

---

### Task 3: 卡片和「被直接改過」的紀錄

**Files:**
- Modify: `plugins/plan-board/hooks/replay.ts`
- Test: `plugins/plan-board/tests/replay-integrity.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `applyEntry`、`replay`、fixtures。
- Produces：`applyEntry` 開始處理 `card.open`、`card.resolve`、`edit.keep`、`edit.drop`；`replay` 開始填 `flagged`。

規則（spec 5.4）：
- `card.open`：id 不能已經存在（否則略過，原因含 `card exists`）。`openedAt = entry.at`。有 `card.item` 就記進那個項目的 `itemLog`，`names[card.id] = question`。
- `card.resolve`：卡片要存在而且還沒結案（否則略過，原因含 `unknown card` 或 `resolved`）。結案資訊 `resolved = {outcome, choice, at}`，也記進那張卡所屬項目的 `itemLog`。
- `edit.keep`／`edit.drop` 套用時不改計畫，只放進 `applied`。
- `replay` 分兩輪處理：
  1. 先從所有通過檢查碼的 `edit.keep`／`edit.drop` 收集 `keep` 和 `drop` 兩組雜湊。
  2. 再分類每一行：通過檢查碼的照常參與；沒通過、雜湊在 `drop` 裡的整行忽略；沒通過、雜湊在 `keep` 裡、而且解析得了的，照常參與；其餘放進 `flagged`。

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('cards_open_and_resolve')               // open question card on A → cards[c].resolved undefined, itemLog[A] has it;
                                             // resolve → resolved.outcome; resolve again → skipped 'resolved'; open same id → skipped 'card exists'
test('unsealed_lines_are_flagged_and_ignored')// tampered 'add B' line → flagged[0].entry.kind 'item.add', items has no B; 'oops' → flagged with entry null
test('edit_keep_lets_a_line_count')          // + sealed edit.keep {lines:[hash of tampered line]} → B in items, flagged []
test('edit_drop_hides_a_line_for_good')      // + sealed edit.drop {lines:[hash]} → flagged [], no B
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作。**
- [ ] **Step 4: 執行，確認通過。**
- [ ] **Step 5: Commit**：`feat: cards and directly edited lines in replay`。

---

### Task 4: 顯示用的推算，以及給 AI 的說明和摘要

**Files:**
- Create: `plugins/plan-board/hooks/view.ts`、`plugins/plan-board/hooks/guide.ts`
- Test: `plugins/plan-board/tests/view.test.ts`

**Interfaces:**
- Consumes: `Plan`、`Local`、`Card` 等型別。
- Produces（`view.ts`）:
  - `itemStates(plan: Plan): Record<string, ItemState>`：spec 3.1。「已開始」= 至少有一個步驟是 `doing` 或 `done`；`next` 只會有一個。
  - `blockedSteps(plan: Plan): Set<string>`：有未結案卡片指到的步驟。
  - `openCards(plan: Plan): Card[]`：未結案的卡片。排序：先 `blocking`，再依所屬項目在 `order` 裡的位置，沒有項目或項目已刪的排最後，最後依 `openedAt`。
  - `cardPosition(plan: Plan, card: Card): { item?: Item; index?: number; step?: Step }`：`index` 從 1 開始；項目已刪就回傳 `{}`，步驟已刪就不回傳 `step`。
  - `historyOf(plan: Plan, itemId: string): Entry[]`：最新的在前。
  - `recentFor(plan: Plan, card: Card, n: number): Entry[]`：`historyOf(card.item)` 去掉這張卡自己的 `card.open` 之後取前 `n` 筆；沒有項目就回傳 `[]`。
  - `bandCounts(plan: Plan, local: Local): { doing: number; waiting: number; isEdited: boolean }`：`waiting` = 未結案、而且不在 `local.sent` 裡的卡片數。
- Produces（`guide.ts`）:`GUIDE: string`、`summary(plan: Plan, local: Local): string`。

`GUIDE` 的內容就是下面這段，一字不改：

```
# Plan board
This repo keeps its plan in plan/log.jsonl: items (the user's level) and steps (yours). The pane shows it to the user. Change it only through these tools, never by editing files under plan/.
- Item changes (add, remove, split, merge, edit title or goal, reorder) need the user's approval: call propose_change, wait for the user's answer, then apply_change with that card. If the user agreed in chat rather than in the pane, pass their words as `chat`. If they changed the proposal in a thought, resolve the card and propose again.
- Steps are yours: add, edit, remove, move, assign and set their status with update_step whenever the work changes, without asking. Always give a one-line why.
- Mark a step done only with evidence: the Thoth task id once your Thoth tools show the task passed, otherwise a one-line result.
- Ask the user with add_decision whenever a choice is theirs: a one-line question, why you ask now, 2-4 options each with what it leads to, at most one recommended with its reason. Attach it to the item and step it is about. Set blocking only when you cannot continue without the answer.
- Choices from the pane reach you as messages. Close every answered card: resolve_decision with a non-empty outcome, or apply_change for an approved proposal.
- When the summary lists directly edited lines, read `git diff -- plan/log.jsonl`. If they touch items, ask the user with a card whether to keep or revert them, then call resolve_direct_edit with that card; otherwise call resolve_direct_edit yourself. To revert a line that was valid before, restore it with git instead of dropping it.
- The ids in the summary are for you; never show them to the user.
```

`summary` 的格式（英文，每段沒有內容就整段省略；整份計畫是空的而且沒有被標記的行時，只回傳 `No plan yet in plan/log.jsonl.`）：

```
Items:
1. [<id>] <title> — <done|in progress|next|later> (goal: <goal>)
   - [<stepId>] <title> — <todo|doing|done>[, assigned to <x>][, thoth <task>|, result: <r>][, blocked by card <cardId>]
Open cards:
- [<cardId>] <question> {question|proposal}[ (blocking)][ (sent, waiting for you to resolve)]
Directly edited lines: <n> (see git diff -- plan/log.jsonl)
Skipped entries:
- <kind> <entry id>: <reason>
```

只有狀態是 `in progress` 和 `next` 的項目才列出步驟。

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('item_states')                  // A(done,done) B(done,todo) C(todo) D(no steps) E(todo) → {A:'done',B:'doing',C:'next',D:'later',E:'later'}
test('blocked_steps_and_open_cards_order') // card on s2 → blockedSteps has s2, gone after resolve;
                                     // order: blocking first, then item order, item-less/removed-item cards last, then openedAt
test('card_position')                // card on B,s3 → {item:B,index:2,step:s3}; after item.remove B → {}
test('history_newest_first_without_self')  // historyOf newest first; recentFor(card,3) excludes the card's own card.open, length ≤ 3
test('band_counts')                  // doing counts 'doing' items; card in local.sent not waiting; flagged → isEdited true
test('summary_lists_items_cards_and_edits') // contains '1. [<A>] 決定看板 v1 — in progress', '  - [<s1>] ' , 'thoth T1',
                                     // '{proposal} (blocking)', '(sent, waiting for you to resolve)', 'Directly edited lines: 1', 'Skipped entries:'
test('summary_of_empty_plan')        // summary(emptyPlan(), emptyLocal) === 'No plan yet in plan/log.jsonl.'
test('guide_names_every_tool')       // GUIDE contains propose_change, apply_change, update_step, add_decision, resolve_decision, resolve_direct_edit, 'plan/'
```

（`emptyLocal` 在 Task 6 才有；這裡先在測試裡直接寫 `{staged:{},sent:{},expanded:[],view:'overview'}`。）

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作兩個檔案。**
- [ ] **Step 4: 執行，確認通過。**
- [ ] **Step 5: Commit**：`feat: derived view, guide and summary for the model`。

---

### Task 5: 工具的檢查和要寫入的紀錄

**Files:**
- Create: `plugins/plan-board/hooks/tools.ts`
- Test: `plugins/plan-board/tests/tools.test.ts`

**Interfaces:**
- Consumes: `applyEntry`（Task 2/3）、`Plan`、`Entry`。
- Produces:

```ts
export type ToolName = 'propose_change' | 'apply_change' | 'update_step' | 'add_decision' | 'resolve_decision' | 'resolve_direct_edit'
export type ToolContext = { plan: Plan; now: string; newId: (length: 8 | 12) => string; isApproved: (cardId: string) => boolean }
export type ToolResult = { ok: true; entries: Entry[]; drop: string[]; message: string } | { ok: false; error: string }
export const TOOLS: Record<ToolName, { description: string; inputSchema: object; run: (ctx: ToolContext, input: unknown) => ToolResult }>
```

共同規則：
- 輸入的型別不對、少了必填欄位、`why`／`outcome`／`summary` 是空字串，都回傳 `{ ok: false }`，`error` 是英文，而且要寫出是哪個欄位。
- 驗證方式：把 `ctx.plan` 用 `structuredClone` 複製一份，依序對每一筆要寫入的紀錄跑 `applyEntry`。任何一筆回傳原因，就回傳 `{ ok: false, error: <原因> }`。規則只寫在 `replay.ts` 一個地方。
- 每筆紀錄的 `id` 用 `ctx.newId(12)`；第 i 筆（從 0 起算）的 `at` 用 `ctx.now` 加 i 毫秒（`new Date(Date.parse(ctx.now) + i).toISOString()`），讓重算時依 `(at, id)` 排序的結果和寫入順序一樣。新項目、新步驟、新卡片的 id 用 `ctx.newId(8)`。
- 位置參照（`item.add` 的 `before`、`step.add`／`step.move` 的 `after`）有給就必須存在，`after` 還必須是同一個項目裡的步驟；否則回傳錯誤。
- `apply_change` 拒絕 `changes` 是空的、或含有任何不是 `item.*` 的卡片。`evidence.thoth`／`evidence.result` 去掉前後空白後是空的，就當成沒給。
- `message` 是英文，寫出新產生的 id，例如 `Proposed card 1a2b3c4d; wait for the user's answer.`、`Added step 9f8e7d6c to item 1a2b3c4d.`。

各工具的輸入（`inputSchema` 照這個寫成 JSON Schema，`description` 用一句英文說明）和寫入：

| 工具 | 輸入 | 寫入 |
|---|---|---|
| `propose_change` | `question`、`why`、`changes`（`{kind, data}` 陣列，只能是 `item.*`；`item.add`、`item.split`、`item.merge` 裡新項目的 `id` 可以省略，由工具補上）、`item?`、`blocking?` | 一筆 `card.open`：`type: 'proposal'`、`options: []`、`changes` 是補好 id 的版本。驗證時要對 `changes` 跑一遍 `applyEntry` |
| `apply_change` | `card`、`chat?` | 先確認卡片存在、是提案卡、還沒結案，而且 `ctx.isApproved(card)` 為真或 `chat` 不是空的；否則回傳的錯誤要含 `not approved`。每一筆 `changes` 寫成一筆紀錄，`basis = {type:'card', card, chat?}`、`why = card.why`；最後加一筆 `card.resolve`，`outcome: 'approved'`、`choice: 'approve'`。驗證失敗時，錯誤要含 `changed since`，並建議結案後重新提案 |
| `update_step` | `why`、`ops`（`{action:'add', item, title, after?}`、`{action:'edit', step, title}`、`{action:'remove', step}`、`{action:'move', step, item, after?}`、`{action:'assign', step, to}`、`{action:'status', step, status}`）、`evidence?: {thoth?, result?}` | 每個 op 寫一筆 `step.*`。`status: 'done'` 時沒有 `evidence.thoth` 也沒有 `evidence.result`，就回傳含 `evidence` 的錯誤。有 `thoth` 時 `basis = {type:'thoth', task}`，否則 `{type:'ai'}`；`result` 有給就放進 `data.result` |
| `add_decision` | `question`、`why`、`options`（2 到 4 個 `{label, effect, recommended?, reason?}`，最多一個 `recommended`）、`item?`、`step?`、`blocking?` | 一筆 `card.open`，`type: 'question'`。只給 `step` 時，`item` 填那個步驟所屬的項目 |
| `resolve_decision` | `card`、`outcome` | 一筆 `card.resolve`，`why = outcome` |
| `resolve_direct_edit` | `action`（`keep`／`drop`）、`summary`、`card?` | 目前沒有被標記的行就回傳錯誤。`keep` 時，只要有被標記的行解析得出 `item.*`，就一定要帶一張存在而且已結案的卡，否則回傳含 `card` 的錯誤。寫一筆 `edit.keep` 或 `edit.drop`，`lines` 是所有被標記行的雜湊，`basis = {type:'direct-edit'}`。`drop` 時把同一組雜湊放進 `drop` |

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('propose_change_opens_a_proposal_card')     // item.add without id → filled 8-hex id; one card.open type 'proposal';
                                                 // kind 'step.add' → error contains 'item.'; unknown item → 'unknown item'; why '' → 'why'
test('apply_change_needs_approval_or_chat')      // not approved, no chat → 'not approved'; approved → [changes…, card.resolve choice 'approve'], basis.card;
                                                 // chat '照你的建議' → basis.chat === '照你的建議'; resolved card → error; item removed meanwhile → 'changed since'
test('update_step_needs_evidence_for_done')      // done without evidence → 'evidence'; thoth 'T1' → basis {type:'thoth',task:'T1'};
                                                 // result only → data.result, basis ai; unknown step → 'unknown step'; message names the new step id
test('add_decision_checks_options')              // 1 option → error; 5 → error; two recommended → error; step only → card.item = step's item
test('resolve_decision_requires_outcome')        // '' → 'outcome'; unknown card → error; ok → card.resolve, why === outcome
test('resolve_direct_edit_rules')                // nothing flagged → error; keep with flagged item.add and no card → 'card';
                                                 // with resolved card → edit.keep lines = hashes; drop → edit.drop and result.drop = hashes;
                                                 // keep with only step.* flagged → ok without card
test('schemas_list_required_fields')             // TOOLS.add_decision.inputSchema.required includes 'question','why','options'
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作。**
- [ ] **Step 4: 執行，確認通過。**
- [ ] **Step 5: Commit**：`feat: tool validation and entries`。

---

### Task 6: 這台電腦的窗格狀態和送給 AI 的訊息

**Files:**
- Create: `plugins/plan-board/hooks/local.ts`
- Test: `plugins/plan-board/tests/local.test.ts`

**Interfaces:**
- Consumes: `Local`、`Pick`、`Plan`、`Card`。
- Produces:
  - `emptyLocal(): Local`、`asLocal(value: unknown): Local`（壞掉或不存在就回傳空的）、`localKey(root: string): string`（`'local:' + root`）
  - `withChoice(local, cardId, choice, at): Local`：再選一次同一個選項就取消。
  - `withDraft(local, cardId, text, at): Local`：去掉前後空白，空字串就刪掉想法。
  - `withDismiss(local, cardId, at): Local`、`cleared(local, cardId): Local`
  - `markSent(local, ids: string[], at): { local: Local; sent: [string, Pick][] }`：把這些卡從 `staged` 移到 `sent`。
  - `forget(local, plan): Local`：卡片已結案或不存在，就從 `staged`、`sent`、`expanded` 裡拿掉。
  - `isApproved(local, cardId): boolean`：`sent[cardId]?.choice === 'approve'`。
  - `batchMessage(plan, sent): string`、`blockingMessage(card: Card, pick: Pick): string`

訊息內容（英文；提案卡的 `choice` 是 `'approve'` 或 `'reject'`）：

```
Decisions from the pane (<n>):
- [<id>] <question> → <choice>
  thought: <draft>
- [<id>] <question> → approve (call apply_change with this card)
- [<id>] <question> → reject (resolve it as rejected)
- [<id>] <question> → dismissed (resolve it: the user skipped this card)
- [<id>] <question> → (no option picked)
(Close each card with resolve_decision, or apply_change for an approved proposal. A card with only a thought stays open until it is settled.)
```

`blockingMessage` 在有 `choice` 時回傳 `Decision made for "<question>" [<id>]: <choice 或上面提案卡／略過的寫法>`；只有想法時回傳 `My thoughts on "<question>" [<id>]: <draft>` 加一行 `(If this settles it, resolve the card; otherwise reply and keep it open.)`。

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('stage_toggle_draft_dismiss_clear')   // choice twice → unstaged; draft '  要看記憶體上限 ' → '要看記憶體上限'; draft '' drops it; clear drops all
test('mark_sent_and_is_approved')          // stage approve on p, markSent([p]) → staged {} , sent[p].choice 'approve', isApproved true
test('forget_drops_resolved_cards')        // card resolved in plan → gone from staged/sent/expanded
test('batch_message_text')                 // contains 'Decisions from the pane (4):', '→ LRU', '  thought: 要看記憶體上限',
                                           // '→ approve (call apply_change with this card)', '→ dismissed (resolve it: the user skipped this card)', '→ (no option picked)'
test('blocking_message_text')              // 'Decision made for "Install where?" [<id>]: There'; thought-only → starts 'My thoughts on "'
test('as_local_survives_garbage')          // asLocal(undefined), asLocal(42) → emptyLocal()
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作。**
- [ ] **Step 4: 執行，確認通過。**
- [ ] **Step 5: Commit**：`feat: local pane state and messages to the model`。

---

### Task 7: 寫檔和外掛接線（工具、說明、擋直接改檔）

**Files:**
- Create: `plugins/plan-board/hooks/logfile.ts`、`plugins/plan-board/tests/world.ts`
- Modify: `plugins/plan-board/hooks/register.tsx`
- Test: `plugins/plan-board/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `replay`、`TOOLS`、`GUIDE`、`summary`、`asLocal`、`localKey`、`isApproved`、`forget`、`sha16`、`sealEntry`。
- Produces（`logfile.ts`，只 `import type` Claude Code 的型別）:
  - `rootOf($: EngineInterface): Promise<string>`：在 `$.session.cwd()` 跑 `git rev-parse --show-toplevel`，`\` 換成 `/`；失敗就回傳 cwd，同樣換掉 `\`。
  - `logPath(root: string): string`：`${root}/plan/log.jsonl`
  - `readLog($, root): Promise<string>`：檔案不存在時回傳 `''`。
  - `nextText(text: string, entries: Entry[], drop: string[]): Promise<string>`：純函式。先拿掉雜湊在 `drop` 裡的行，最後一行沒有換行就補上 `\n`，再接上每筆 seal 好的行，每行以 `\n` 結尾。
  - `commitEntries($, root, entries: Entry[], drop: string[]): Promise<'ok' | 'busy'>`：最多試 3 次。每一次：`stat`（不存在就當成 `null`）→ 讀檔 → `nextText` → 再 `stat` 一次，兩次的 `size`／`mtimeMs` 一樣才寫入，否則重來。3 次都不行就回傳 `'busy'`，什麼都不寫。寫成功之後呼叫 `ensureAttributes`。
  - `ensureAttributes($, root): Promise<void>`：`.gitattributes` 不存在就當成 `''`。沒有一模一樣的那一行，就在最後補上（必要時先補換行）。
- Produces（`register.tsx`）：atom `{plugin:'plan-board', key:'root'}`、`{plugin:'plan-board', key:'plan'}`、`{plugin:'plan-board', key:'local'}`；`refresh($): Promise<Plan>`，負責讀檔、`replay`、讀 local、`forget`、存回 local，並更新三個 atom。
- Produces（`tests/world.ts`）：`world(on: On, files?: Record<string, string>)`，用記憶體模擬 `fs.read`、`fs.write`（寫入時 `mtimeMs` 加 1）、`fs.stat`、`fs.exists`、`store.get`、`store.set`、`process.run`（git 回傳 `/repo\n`）、`clock.now`（每次呼叫加 1000）、`clock.after`（測試可以手動觸發）、`tool.register`（回傳 `mcp__plan-board__${name}`）、`command.register`、`ui.open`、`prompt.submit`、`turn.start`、`turn.complete`、`session.start`、`session.cwd`。另外提供 `w.files`、`w.store`、`w.submitted`、`w.opened`、`w.fireTimer()`、`w.statBump`（為 true 時每次 `stat` 都讓 `size` 加 1，用來模擬別的 session 正在寫）。寫法參考 Thoth 測試裡的 `world()`。

接線（spec 6）：
- `session.start`：算出根目錄、`refresh`、註冊 `TOOLS` 裡的 6 個工具，記住 `$.tool.register` 回傳的完整工具名稱（`Map<string, ToolName>`），註冊 `/plan` 指令。
- `tool.call`：用一個不帶篩選條件的處理函式。
  - 工具名稱在上面的 Map 裡：組出 `ToolContext`。`now` 用 `$.clock.now()` 和「計畫裡最晚一筆紀錄的 `at` 加 1 毫秒」兩者中較晚的那個，轉成 ISO 字串；`isApproved` 讀 local。跑 `run`，`ok: false` 就回傳 `{ deny: error }`。`ok: true` 就 `commitEntries`，結果是 `'busy'` 時回傳 `{ deny: 'The plan file is being written by another session; try again.' }`；否則 `refresh`，回傳 `{ result: message }`。
  - 工具是 `Edit` 或 `Write`（看 `file_path`），或是 `NotebookEdit`（看 `notebook_path`）：路徑把 `\` 換成 `/` 之後，以 `${root}/plan/` 開頭的，回傳 `{ deny: 'Files under plan/ are written only through the plan-board tools: propose_change, apply_change, update_step, add_decision, resolve_decision, resolve_direct_edit.' }`。
  - 其他工具都交給 `next(e)`。
- `prompt.submit`：先 `refresh`，再 `next(e)`。
- `prompt.compose`：在原本的 sections 後面加一段 `{ id: 'plan-board:guide', text: GUIDE + '\n\n' + summary(plan, local), scope: 'session' }`，寫法和舊 decisions mod 一樣。
- `command.run`（`plan`）：`refresh`，打開窗格（id `plan-board`），回傳一句話。

- [ ] **Step 1: 寫會失敗的測試**

```ts
test('first_proposal_creates_log_and_gitattributes') // no files → propose_change → files['/repo/plan/log.jsonl'] one sealed line;
                                                     // files['/repo/.gitattributes'] === 'plan/log.jsonl merge=union\n';
                                                     // starting with 'x' (no newline) → 'x\nplan/log.jsonl merge=union\n'; second call does not add it again
test('invalid_tool_input_is_denied_and_writes_nothing') // add_decision with 1 option → deny contains 'options'; no log file
test('apply_change_uses_the_local_approval')         // store local sent approve for the card → apply_change ok; item in summary
test('edit_and_write_under_plan_are_denied')         // Edit '/repo/plan/log.jsonl' → deny contains 'plan-board tools';
                                                     // Write '\\repo\\plan\\x' → deny; NotebookEdit notebook_path under plan → deny; Write '/repo/src/a.ts' → passes
test('prompt_compose_adds_guide_and_summary')        // section id 'plan-board:guide' contains '# Plan board' and 'Items:'
test('concurrent_write_retries_then_fails')          // w.statBump = true → deny contains 'another session', file unchanged;
                                                     // nextText keeps another session's line written before ours
test('prompt_submit_picks_up_pulled_lines')          // write a sealed line into w.files directly, submit a prompt → summary contains its item
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作 `logfile.ts` 和接線。**
- [ ] **Step 4: 執行測試和兩個 validate，全部通過。**
- [ ] **Step 5: Commit**：`feat: log writing and plugin wiring`。

---

### Task 8: 窗格、輸入框上方一列、暫存與送出

**Files:**
- Create: `plugins/plan-board/hooks/i18n.ts`、`plugins/plan-board/hooks/lines.ts`、`plugins/plan-board/hooks/pane.tsx`
- Modify: `plugins/plan-board/hooks/register.tsx`
- Test: `plugins/plan-board/tests/pane.test.ts`

**Interfaces:**
- Consumes: `view.ts` 的全部函式、`local.ts` 的全部函式、Task 7 的 `refresh`、atom 和 `world()`。
- Produces:
  - `i18n.ts`：`type Lang = 'en' | 'zh-TW'`、`langOf(value: unknown): Lang`、`t(lang, key, vars?)`、`hasKey`，寫法照 Thoth 的 `i18n.ts`。
  - `lines.ts`：`stamp(at: string): string`（本地時間，`MM/DD HH:mm`）、`historyLines(entry: Entry, plan: Plan, lang: Lang): string[]`（第一行是 `時間 種類 內容`，加上來源；第二行是 `原因：…`）。引用到的項目、步驟、卡片都用 `plan.names` 換成名稱，絕不放 id。
  - `pane.tsx`：`renderPane($, e, lang)`、`renderBand($, e, next, lang)`。

zh-TW 的固定文字（spec 4）。英文版自己寫對應的句子，測試會檢查兩張對照表的鍵一樣：

| 用途 | zh-TW |
|---|---|
| 兩個畫面 | `總表`、`等你決定（{n}）` |
| 項目狀態 | `做完`、`進行中`、`下一個`、`之後` |
| 項目展開 | `做完的樣子：{goal}`、`── 變動紀錄 ──`、`原因：{why}` |
| 步驟標記 | `✓` 做完、`●` 進行中、`○` 還沒開始、`⚑` 卡住（後面接 `等你決定：{question}`）；證據 `Thoth pass` 或 `AI 回報：{result}` |
| 紀錄的來源 | ` · 你在「{question}」選了同意`、` · 你在對話裡說：「{chat}」` |
| 卡片 | `{item} · 第 {n} 項 · 卡在「{step}」`、`{item} · 第 {n} 項`、`其他`、`為什麼現在問：{why}`、`之前：`、`（建議）`、`同意`、`不要` |
| 暫存與送出 | `送出 {n} 個決定`、`停止操作 1 分鐘後自動送出；Claude 工作中就等這輪結束再送`、`已選：{choice}（待送出）`、`想法：{draft}（待送出）`、`清除`、`已送出，等 AI 結案` |
| 想法輸入框 | `或寫下你的想法…（立即送出）`／`或寫下你的想法…（和選擇一起送出）`，按鈕 `送出`／`暫存` |
| 空的狀態 | `這個 repo 還沒有計畫`、`✓ 目前沒有待你決定的事` |
| 被直接改過 | 窗格：`計畫被直接改過，等 AI 檢查`；一列：`· ⚠ 計畫被直接改過` |
| 輸入框上方一列 | `計畫：{doing} 項進行中 · {waiting} 個決定等你`，按鈕 `打開` |

畫面（spec 4.2）：
- 最上方兩個按鈕，key 是 `view:overview` 和 `view:cards`，切換結果存在 `local.view`。
- **總表**：每個項目一個按鈕，key 是 `item:<id>`，文字 `▸`／`▾ {title} · {狀態}`，有卡住的步驟就加 `⚑`，按了切換 `local.expanded`。展開後依序顯示：做完的樣子、每個步驟一行、變動紀錄（`historyOf` 全部，各自用 `historyLines` 轉成文字）。
- **等你決定**：依 `openCards` 的順序，每張卡一個有框的 Box。第一張全部攤開；其他張只顯示問題和位置，按 key `card:<id>` 才攤開（記在 `local.expanded`）。攤開的內容依序是：問題、位置、為什麼現在問、之前（`recentFor(…, 3)`）、選項。問題卡的選項按鈕 key 是 `<id>:<i>`，第一張卡的前 9 個選項加上 `hotkey`；提案卡的選項是 `<id>:approve`、`<id>:reject`，「同意」底下列出每一項改動，用 `historyLines` 的寫法。另外有略過按鈕 `<id>:x`、想法輸入框 `<id>:note`。已送出的卡改用 `dimColor`，只顯示問題、位置和 `已送出，等 AI 結案`。
- **送出**（照舊 mod 的行為）：
  - `blocking` 卡：選了或寫了想法，就用 `blockingMessage` 立刻 `$.prompt.submit`，並 `markSent`。
  - 其他卡：先用 `withChoice`、`withDraft`、`withDismiss` 暫存，出現 `send` 按鈕。停止操作 `AUTO_SEND_MS` 之後自動送出；AI 正在工作（`turn.start`／`turn.complete`，`agentId === undefined` 才算主迴圈）就等這輪結束再送。送出時用 `markSent` 加上 `batchMessage`。
  - 每次改 local 都要寫回 `$.store`（`localKey(root)`），並更新 atom。
- **輸入框上方一列**：`hasSurvey` 為真，或計畫是空的而且沒有未結案的卡，就交給 `next(e)`。否則顯示一列文字和 key 為 `open` 的按鈕，有被標記的行時在文字後面加上警告。寬度用 `fit`／`textWidth` 處理，寫法照 Thoth。

- [ ] **Step 1: 寫會失敗的測試**（都用 `{ options: { language: 'zh-TW' } }`，terminal 和 desktop 兩種畫面各跑一次）

```ts
test('overview_shows_states_and_expands_item') // '▸ 設定精靈 · 下一個'; press item:<A> → '做完的樣子：…', '✓ 定檔案格式', 'Thoth pass', a line starting '原因：'
test('cards_view_expands_only_the_first')       // first card shows '為什麼現在問：' and option buttons; second shows question and position only;
                                                // press card:<second> → its '為什麼現在問：' appears
test('proposal_card_lists_changes_and_approve_is_staged') // press <p>:approve → '送出 1 個決定'; press send → submitted[0] contains '→ approve (call apply_change';
                                                // card shows '已送出，等 AI 結案'; then apply_change tool call succeeds
test('blocking_card_sends_at_once')             // press <id>:1 → submitted has 'Decision made for "Install where?"'
test('staged_choice_auto_sends_after_turn_end') // port the old mod's quiet-time test: fireTimer while busy → nothing; turn.complete → sent
test('dismiss_is_sent_as_skip')                 // press <id>:x then send → contains '→ dismissed'
test('card_of_removed_item_shows_other')        // card on item later removed → position text '其他', no crash
test('band_text_and_edit_warning')              // '計畫：1 項進行中 · 2 個決定等你'; with a flagged line → contains '⚠ 計畫被直接改過'; press open → opened 'plan-board'
test('empty_repo_shows_hint_and_engine_band')   // no log → pane '這個 repo 還沒有計畫'; band is the engine's own
test('no_ids_in_zh_tw_text')                    // findAll Text+Button in both views, all expanded, and the band: none matches /[0-9a-f]{8}/
test('i18n_tables_have_the_same_keys')
```

- [ ] **Step 2: 執行，確認失敗。**
- [ ] **Step 3: 實作。**
- [ ] **Step 4: 執行測試和兩個 validate，全部通過。**
- [ ] **Step 5: Commit**：`feat: pane, band and sending decisions`。

---

### Task 9: 真的 git 合併測試和 README

**Files:**
- Create: `tests-git/merge.test.ts`、`README.md`、`README.zh-TW.md`

**Interfaces:**
- Consumes: `nextText`（`logfile.ts`）、`replay`（`replay.ts`）、`Entry`。用 `../plugins/plan-board/hooks/<名稱>.ts` 引用。

- [ ] **Step 1: 寫測試** `tests-git/merge.test.ts`（`node:test`、`node:assert/strict`、`node:child_process`、`node:fs`、`node:os`、`node:path`）：
  1. 在 `mkdtempSync(join(tmpdir(), 'plan-board-'))` 建 repo：`git init -b main`，每個 git 指令都帶 `-c user.name=t -c user.email=t@t`。
  2. 寫入 `.gitattributes`（就是 Global Constraints 裡那一行），用 `nextText('', [add A], [])` 寫出 `plan/log.jsonl`，commit。
  3. 開分支 `a`，用 `nextText` 加上 `add B`，commit。
  4. 切回 `main`，用 `nextText` 加上 `add C`（`at` 比 B 晚），commit。
  5. `git merge --no-edit a`。
  - 檢查：merge 的結束碼是 0；檔案裡沒有 `<<<<<<<`；`replay` 之後 `flagged` 是 `[]`，`order` 等於 `[A, B, C]`。
  - 第二個測試：把 `core.autocrlf` 設成 `true`，重新 checkout 之後（`git rm --cached -r . && git reset --hard`）再 `replay`，`flagged` 仍是 `[]`。

- [ ] **Step 2: 執行** `node --test tests-git/merge.test.ts`，預期 `fail 0`。如果有任何失敗，修的是 `replay.ts` 或 `logfile.ts`，不是測試。

- [ ] **Step 3: 寫 README**：英文和 zh-TW 各一份，內容一樣。寫這幾件事：
  - 它是什麼：一句話。
  - 安裝：`/plugin marketplace add johnny-lo/plan-board`，再 `/plugin install plan-board@plan-board`。
  - 怎麼設定語言。
  - 檔案在 `plan/log.jsonl`，還有 `.gitattributes` 那一行的用途。
  - 項目和步驟的規則：spec 3.3 的表。
  - 和 Thoth 的關係：可以一起用，但外掛不讀 Thoth。
  - 授權。

- [ ] **Step 4: 從頭跑一次全部的驗證指令**（Global Constraints 裡的三個），全部通過。
- [ ] **Step 5: Commit**：`test: real git union merge; docs: README`。

---

### Task 10: 在 Legion 換掉舊 decisions mod（手動；動手前先問使用者）

這個 task 改的是 `~/.claude`，不是 repo 裡的檔案，所以**每一步做之前都要先得到使用者同意**。

- [x] **Step 1**：在 Claude Code 執行 `/plugin marketplace add <這個 repo 的本機路徑>`，再 `/plugin install plan-board@plan-board`，並把 `language` 設成 `zh-TW`。
- [x] **Step 2**：讀 `~/.claude/plugins/store/decisions_inline-*.json`，確認 `items` 是 `[]`。不是空的，就到每張卡所屬的 repo，用新的 `add_decision` 重開。
- [x] **Step 3**：刪掉 `~/.claude/mods/decisions`。
- [x] **Step 4**：在這個 repo 開一個新的 session，確認：窗格打得開；`/plan` 可以用；輸入框上方一列在沒有計畫時不出現；AI 收到的說明是 plan-board 的那一份，而且只有一份。

實際做法（2026-10-10）：Step 2 換裝前剩的是 Thoth 一張新卡，使用者先到 Thoth 回答掉，`items` 變 `[]` 才往下做；原本另一個 repo 的卡 10/8 已經答過，不用重開。Step 3 照使用者選的改成搬到 `~/.claude/mods-disabled/decisions`（不刪），另外刪掉 `~/.claude/settings.json` 裡載入它的 `CLAUDE_CODE_PLUGIN_DIRS`。Step 4 四項都過（說明只有一份是用新的 `claude -p` session 查的）；接著用新窗格開的第一張卡也走通了（開卡 → 選擇送回 → `resolve_decision` 結卡）。

---

### Task 11: 換裝後的修正（spec 14）

用 Thoth 派工。行為照 spec 14，測試先寫。

- [x] **Step 1**：本機寫入每次嘗試前重新判斷模式，`plan/log.jsonl` 出現了就改寫進 repo（spec 14.1 A）。
- [x] **Step 2**：`/plan init` 刪本機那份前再確認，多出來的行補進 `plan/log.jsonl`，最多 3 次，還在變就留著本機那份（spec 14.1 B）。
- [x] **Step 3**：`/plan init` 失敗的回覆改用對照表、不帶原始錯誤、照實說做到哪一步（spec 14.2）。

實際做法（2026-10-10）：Thoth 任務 `01M4K1Q2Z5YJGFKH4AWN62XR73`，claude-a／sonnet／high，2 輪。第 1 輪八項要求都過，但退回三點：型別錯誤（`commitText` 多了 `'moved'`）、`/plan init` 補行時整份寫回會蓋掉別的 session 剛加的行、「留著本機那份」和「`.gitattributes` 沒改成」同時發生時回覆沒提後者。第 2 輪三點都修好、各有測試；合併後 112 個外掛測試和 2 個 git 合併測試全過。

---

## 試用回饋（spec 15，2026-10-11 加）

**Goal:** 照 spec 15 改 plan-board：步驟備註、待你處理卡、新增步驟時一起設定、證據跟著動作走、變動紀錄收合。

**Architecture:** 跟前面一樣：規則放在純模組（replay、tools、view、lines、local、guide、i18n），各自有單元測試；`pane.tsx` 畫面、`register.tsx` 接線。新的紀錄種類只有 `step.note`；`step.add` 多幾個可選欄位；卡片多一種 `type: 'action'`。舊的紀錄一行都不改。

**Spec:** `docs/superpowers/specs/2026-10-07-plan-board-design.md` 第 15 節（決定的來由在 spec 開頭和 `plan/log.jsonl` 的卡片紀錄）。

**順序：** Task 12 → 17 依序做，後面的 Task 會用到前面加的型別和函式。每個 Task 結束時全部測試都要過。

### 追加的 Global Constraints

前面的 Global Constraints 全部照舊，另外：

- 畫面上的新文字照下面各 Task 寫的字一字不差（中英兩份對照表的鍵和 `{slot}` 要一樣，`i18n_tables_have_the_same_keys` 會檢查）。
- 給 AI 的文字（工具結果、錯誤、送給 AI 的訊息、說明）一律英文。
- 外掛版本 `0.2.0`（Task 17）。
- 開始前的基準：`claude plugin test plugins/plan-board` 是 `112 pass`、`0 fail`（2026-10-11 實測）。

### 追加的 Review Focus

1. **舊的 log**（0.2.0 以前寫的，包括舊 bug 留下的「`doing` 帶 `result`」「改名帶 Thoth 依據」）重算出來的計畫跟現在一樣。測試在 Task 13（`old_logs_replay_the_same`）。
2. **只有空白的備註**當成清掉，不會留下一個空白的備註。測試在 Task 12（`update_step_note_needs_no_why_when_alone`）。
3. **已經展開的「▸ 步驟：…」那一行，之後又有新的步驟瑣事接上來**，要維持展開。測試在 Task 16（`an_open_fold_stays_open_when_more_step_chatter_arrives`）。
4. **Claude 正在工作時按「做好了」**，一樣立刻送出，不等這輪結束。測試在 Task 15（`action_card_shows_the_command_and_done_goes_out_at_once`）。
5. **展開狀態指到的紀錄不在了**（被 `drop`、或換了分支），要忘掉，不能一直累積。測試在 Task 16（`forget_keeps_open_history_rows_of_entries_still_in_the_log`）。

---

### Task 12: 步驟備註（spec 15.1）

**Files:**
- Modify: `plugins/plan-board/types/index.d.ts`
- Modify: `plugins/plan-board/hooks/replay.ts`
- Modify: `plugins/plan-board/hooks/tools.ts`（`updateStep`、`TOOLS.update_step.inputSchema`）
- Modify: `plugins/plan-board/hooks/guide.ts`（`summary`）
- Modify: `plugins/plan-board/hooks/lines.ts`（`changeLine`）
- Modify: `plugins/plan-board/hooks/i18n.ts`
- Modify: `plugins/plan-board/hooks/pane.tsx`（總表的步驟那一行）
- Test: `plugins/plan-board/tests/replay.test.ts`、`tests/tools.test.ts`、`tests/view.test.ts`、`tests/pane.test.ts`

**Interfaces:**
- Produces: `Step.note?: string`；紀錄種類 `{ kind: 'step.note'; data: { step: string; note: string } }`；`update_step` 的 op `{ action: 'note', step, note }`；`update_step` 的 `why` 在全部 op 都是 `note` 時可以不給；i18n 鍵 `stepNote`。
- Consumes: 無。

- [x] **Step 1: 寫會失敗的測試**

`tests/replay.test.ts` 最後加：

```ts
test('step_note_is_set_cleared_and_dropped_when_done', async () => {
  const entries = [
    entry('item.add', { item: item('A') }),
    entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
    entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
    entry('step.note', { step: 's1', note: 'waiting for review' }),
    entry('step.note', { step: 's2', note: 'waiting for CI' }),
    entry('step.status', { step: 's2', status: 'doing' }),
    entry('step.note', { step: 'ghost', note: 'x' }),
  ]
  const plan = await replay(await logText(entries))
  expect(plan.steps.s1.note).toBe('waiting for review')
  expect(plan.steps.s2.note).toBe('waiting for CI')
  expect(plan.skipped.map((s) => s.reason)).toEqual(['unknown step: ghost'])
  // A note is where a step stands now, not a change the user reads back.
  expect(plan.itemLog.A.some((e) => e.kind === 'step.note')).toBe(false)

  const later = await replay(
    await logText([
      ...entries.slice(0, 6),
      entry('step.note', { step: 's1', note: '' }),
      entry('step.status', { step: 's2', status: 'done', result: 'ok' }),
    ]),
  )
  expect(later.steps.s1.note).toBeUndefined()
  expect(later.steps.s2.note).toBeUndefined()
  expect(later.steps.s2.status).toBe('done')
})
```

`tests/tools.test.ts` 最後加：

```ts
test('update_step_note_needs_no_why_when_alone', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1'), step('A', 's2')])
  const run = (input: object) => TOOLS.update_step.run(ctxOf(plan), input)

  const noted = good(run({ ops: [{ action: 'note', step: 's1', note: ' waiting for review ' }, { action: 'note', step: 's2', note: '   ' }] }))
  expect(noted.entries.map((e) => e.kind)).toEqual(['step.note', 'step.note'])
  expect(noted.entries.map((e) => e.data)).toEqual([{ step: 's1', note: 'waiting for review' }, { step: 's2', note: '' }])
  expect(noted.entries.map((e) => e.why)).toEqual(['waiting for review', 'note cleared'])
  expect(noted.entries.every((e) => e.basis.type === 'ai')).toBe(true)
  expect(noted.message).toContain('s1')

  const explained = good(run({ why: 'review started', ops: [{ action: 'note', step: 's1', note: 'in review' }] }))
  expect(explained.entries[0].why).toBe('review started')
  good(run({ why: '  ', ops: [{ action: 'note', step: 's1', note: 'in review' }] }))

  expect(bad(run({ ops: [{ action: 'note', step: 's1', note: 'x' }, { action: 'status', step: 's2', status: 'doing' }] }))).toContain('why')
  expect(bad(run({ ops: [{ action: 'note', step: 's1' }] }))).toContain('note')
  expect(bad(run({ ops: [{ action: 'note', step: 'ghost', note: 'x' }] }))).toContain('unknown step')
  expect(JSON.stringify(TOOLS.update_step.inputSchema)).toContain('"note"')
})
```

同一個檔案的 `schemas_list_required_fields`，把

```ts
  expect(required('update_step')).toEqual(expect.arrayContaining(['why', 'ops']))
```

改成

```ts
  // why may be left out when every op is a note; the tool checks the rest.
  expect(required('update_step')).toEqual(['ops'])
```

`tests/view.test.ts` 最後加：

```ts
test('summary_shows_a_step_note', async () => {
  const plan = await replay(
    await logText([entry('item.add', { item: item('A') }), step('A', 's1'), entry('step.note', { step: 's1', note: 'waiting for review' })]),
  )
  expect(summary(plan, emptyLocal)).toContain('- [s1] s1 — todo, note: waiting for review')
})
```

`tests/pane.test.ts` 在 `history_shows_the_old_name_of_a_rename` 前面加：

```ts
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
```

- [x] **Step 2: 跑測試，確認新的測試失敗**

Run: `claude plugin test plugins/plan-board`
Expected: 上面 5 個測試 FAIL（例如 `unsupported kind: step.note`、`ops[0].action must be one of …`、`why is required`），其餘照舊 pass。

- [x] **Step 3: 實作**

`types/index.d.ts`：`StepChange` 加一種，`Step` 加 `note`：

```ts
  | { kind: 'step.status'; data: { step: string; status: StepStatus; result?: string } }
  /** Where a step stands now; an empty note clears it. Never shown in the change history. */
  | { kind: 'step.note'; data: { step: string; note: string } }
```

```ts
export type Step = { id: string; item: string; title: string; status: StepStatus; assignee?: string; note?: string; evidence?: { thoth?: string; result?: string } }
```

`hooks/replay.ts`：

`hasValidData` 的 `case 'step.status'` 後面加：

```ts
    case 'step.note':
      return isString(d.step) && isString(d.note)
```

`applyEntry` 的 `case 'step.status'` 改成（做完時清掉備註）：

```ts
    case 'step.status': {
      const { step, status, result } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      const target: Step = plan.steps[step]
      target.status = status
      if (status !== 'done') delete target.evidence
      else if (entry.basis.type === 'thoth') target.evidence = { thoth: entry.basis.task }
      else target.evidence = { result }
      // A done step waits for nothing.
      if (status === 'done') delete target.note
      return null
    }
    case 'step.note': {
      const { step, note } = entry.data
      if (!has(plan.steps, step)) return `unknown step: ${step}`
      if (note === '') delete plan.steps[step].note
      else plan.steps[step].note = note
      return null
    }
```

`replay()` 迴圈最後，把

```ts
    plan.applied.push(entry)
    for (const id of new Set([...before, ...touchedAfter(entry)])) (plan.itemLog[id] ??= []).push(entry)
```

改成

```ts
    plan.applied.push(entry)
    // A note is where a step stands now, not a change the user reads back.
    if (entry.kind === 'step.note') continue
    for (const id of new Set([...before, ...touchedAfter(entry)])) (plan.itemLog[id] ??= []).push(entry)
```

`hooks/tools.ts` 的 `updateStep` 開頭，把

```ts
  const o = objectOf(input)
  const why = text(o, 'why')
  const ops = list(o, 'ops')
```

改成

```ts
  const o = objectOf(input)
  const ops = list(o, 'ops')
  const isNotesOnly = ops.every((raw) => isObj(raw) && raw.action === 'note')
  const isBlank = o.why === undefined || (typeof o.why === 'string' && o.why.trim() === '')
  // A call that only notes where steps stand may leave out why: each note is its own reason.
  const why = isNotesOnly && isBlank ? '' : text(o, 'why')
```

`switch (raw.action)` 裡 `case 'link'` 前面加：

```ts
      case 'note': {
        if (typeof raw.note !== 'string') return fail(`${at}.note must be a string (empty to clear)`)
        const note = raw.note.trim()
        const stepId = field('step')
        entries.push(make(ctx, 'step.note', { step: stepId, note }, why || (note === '' ? 'note cleared' : note), ai))
        said.push(note === '' ? `Cleared the note of step ${stepId}.` : `Noted step ${stepId}.`)
        break
      }
```

`default` 的錯誤訊息改成 `` `${at}.action must be one of add, edit, remove, move, assign, status, note, link` ``。

`TOOLS.update_step` 改四個地方（最外層的 `evidence` 這個 Task 不動，Task 13 才拿掉）：

1. `description` 換成：

   ```ts
       description:
         'Add, edit, remove, move, assign, note or set the status of steps, or link a document (a path from the repo root, such as a superpowers spec or plan) to an item, recording why.',
   ```

2. `why` 換成：

   ```ts
           why: { ...str, description: 'One-line reason for the change; may be left out when every op is a note.' },
   ```

3. `ops.items.properties` 的 `action` 換成下面第一行，並在 `status` 後面加 `note`：

   ```ts
                 action: { type: 'string', enum: ['add', 'edit', 'remove', 'move', 'assign', 'status', 'note', 'link'] },
   ```

   ```ts
                 note: { ...str, description: 'For note: where the step stands or who it waits on; empty string clears it.' },
   ```

4. 最外層的 `required: ['why', 'ops']` 換成 `required: ['ops']`。

`hooks/guide.ts` 的 `summary`，派給誰那一行後面加：

```ts
      if (step.assignee !== undefined) line += `, assigned to ${step.assignee}`
      if (step.note !== undefined) line += `, note: ${step.note}`
```

`hooks/i18n.ts`：`EN` 在 `stepStatus` 後面加 `stepNote: '"{step}" note: {note}',`；`ZH_TW` 加 `stepNote: '「{step}」備註：{note}',`。

`hooks/lines.ts` 的 `changeLine`，`case 'step.status'` 後面加（變動紀錄不會用到它，但每一種紀錄都要有一句話）：

```ts
    case 'step.note':
      return `${t(lang, 'kindStep')} ${t(lang, 'stepNote', { step: name(change.data.step), note: change.data.note })}`
```

`hooks/pane.tsx` 總表的步驟那一行，派給誰後面加備註：

```tsx
                          {step.assignee !== undefined && <Text dimColor>{assignedText(step.assignee, lang)}</Text>}
                          {step.note !== undefined && <Text dimColor>{step.note}</Text>}
                          {note !== '' && <Text dimColor>{note}</Text>}
```

- [x] **Step 4: 跑測試，確認全過**

Run: `claude plugin test plugins/plan-board` → `116 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board
git commit -m "feat(plan-board): step notes that stay out of the change history"
```

---

### Task 13: 新增步驟時一起設定；證據跟著動作走（spec 15.3、15.4）

**Files:**
- Modify: `plugins/plan-board/types/index.d.ts`
- Modify: `plugins/plan-board/hooks/replay.ts`
- Modify: `plugins/plan-board/hooks/tools.ts`（`updateStep`、`TOOLS.update_step`）
- Modify: `plugins/plan-board/hooks/lines.ts`（`changeLine` 的 `step.add`）
- Test: `tests/replay.test.ts`、`tests/tools.test.ts`、`tests/pane.test.ts`

**Interfaces:**
- Consumes: Task 12 的 `Step.note`、`note` op。
- Produces: `step.add` 的 `data` 多 `status?: StepStatus`、`to?: string`、`note?: string`、`result?: string`；`update_step` 的 op 多 `evidence?: { thoth?: string; result?: string }`，整次呼叫的 `evidence` 拒絕。

- [x] **Step 1: 寫會失敗的測試**

`tests/replay.test.ts` 最後加：

```ts
test('step_add_can_start_doing_done_assigned_and_noted', async () => {
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' }, status: 'doing', to: 'claude-b', note: 'in review' }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' }, status: 'done' }, { basis: { type: 'thoth', task: 'T2' } }),
      entry('step.add', { item: 'A', step: { id: 's3', title: 'three' }, status: 'done', result: 'ok' }),
      entry('step.add', { item: 'A', step: { id: 's4', title: 'four' }, status: 'finished' }),
    ]),
  )
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'doing', assignee: 'claude-b', note: 'in review' })
  expect(plan.steps.s2.evidence).toEqual({ thoth: 'T2' })
  expect(plan.steps.s3.evidence).toEqual({ result: 'ok' })
  expect(plan.skipped.map((s) => s.reason)).toEqual(['malformed entry: bad data for step.add'])
})

test('old_logs_replay_the_same', async () => {
  // Lines written before 0.2.0, with what the old call-wide evidence left behind.
  const plan = await replay(
    await logText([
      entry('item.add', { item: item('A') }),
      entry('step.add', { item: 'A', step: { id: 's1', title: 'one' } }),
      entry('step.add', { item: 'A', step: { id: 's2', title: 'two' } }),
      entry('step.edit', { step: 's2', title: 'two v2' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.status', { step: 's1', status: 'done' }, { basis: { type: 'thoth', task: 'T1' } }),
      entry('step.status', { step: 's2', status: 'doing', result: 'ok' }, { basis: { type: 'thoth', task: 'T1' } }),
    ]),
  )
  expect(plan.skipped).toEqual([])
  expect(plan.steps.s1).toEqual({ id: 's1', item: 'A', title: 'one', status: 'done', evidence: { thoth: 'T1' } })
  expect(plan.steps.s2).toEqual({ id: 's2', item: 'A', title: 'two v2', status: 'doing' })
})
```

`tests/tools.test.ts`：整個 `update_step_needs_evidence_for_done` 換成：

```ts
test('update_step_needs_evidence_for_done', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), step('A', 's1'), step('A', 's2')])
  const run = (ops: object[], extra: object = {}) => TOOLS.update_step.run(ctxOf(plan), { why: 'finished', ops, ...extra })
  const done = (evidence?: unknown) => ({ action: 'status', step: 's1', status: 'done', ...(evidence === undefined ? {} : { evidence }) })

  expect(bad(run([done()]))).toContain('evidence')
  expect(bad(run([done({})]))).toContain('evidence')
  expect(bad(run([done('done')]))).toContain('evidence')

  const thoth = good(run([done({ thoth: 'T1' })]))
  expect(thoth.entries.length).toBe(1)
  expect(thoth.entries[0].kind).toBe('step.status')
  expect(thoth.entries[0].basis).toEqual({ type: 'thoth', task: 'T1' })
  expect(thoth.entries[0].why).toBe('finished')
  expect(thoth.entries[0].data).toEqual({ step: 's1', status: 'done' })

  const result = good(run([done({ result: 'tests pass' })]))
  expect(result.entries[0].basis).toEqual({ type: 'ai' })
  expect(result.entries[0].data).toEqual({ step: 's1', status: 'done', result: 'tests pass' })

  // Evidence belongs to the op that marks the step done, never to the whole call.
  expect(bad(run([done({ thoth: 'T1' })], { evidence: { thoth: 'T1' } }))).toContain('ops[i].evidence')
  expect(bad(run([{ action: 'remove', step: 's1' }], { evidence: 'done' }))).toContain('evidence')

  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 'zzz', status: 'doing' }] }))).toContain('unknown step')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'add', item: 'zzz', title: 't' }] }))).toContain('unknown item')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: '', ops: [{ action: 'remove', step: 's1' }] }))).toContain('why')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [] }))).toContain('ops')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'dance', step: 's1' }] }))).toContain('action')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 's1', status: 'finished' }] }))).toContain('status')
  expect(bad(TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'edit', step: 's1' }] }))).toContain('title')

  const many = good(
    TOOLS.update_step.run(ctxOf(plan), {
      why: 'reshuffle',
      ops: [
        { action: 'add', item: 'A', title: 'new step', after: 's1' },
        { action: 'edit', step: 's1', title: 'renamed' },
        { action: 'move', step: 's2', item: 'B' },
        { action: 'assign', step: 's1', to: 'claude-b' },
        { action: 'status', step: 's1', status: 'doing' },
        { action: 'remove', step: 's2' },
      ],
    }),
  )
  expect(many.entries.map((e) => e.kind)).toEqual(['step.add', 'step.edit', 'step.move', 'step.assign', 'step.status', 'step.remove'])
  const added = many.entries[0]
  if (added.kind !== 'step.add') throw new Error('unreachable')
  expect(added.data.step.id).toMatch(HEX8)
  expect(added.data).toEqual({ item: 'A', step: { id: added.data.step.id, title: 'new step' }, after: 's1' })
  expect(many.message).toContain(added.data.step.id)
  expect(many.message).toContain('A')
  expect(new Set(many.entries.map((e) => e.id)).size).toBe(6)
  expect(many.entries.every((e) => e.why === 'reshuffle')).toBe(true)
})
```

整個 `blank_evidence_counts_as_missing` 換成：

```ts
test('blank_evidence_counts_as_missing', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1')])
  const run = (evidence: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'x', ops: [{ action: 'status', step: 's1', status: 'done', evidence }] })
  expect(bad(run({ thoth: '   ' }))).toContain('evidence')
  expect(bad(run({ result: ' \t' }))).toContain('evidence')
  expect(bad(run({ thoth: ' ', result: '' }))).toContain('evidence')
  const kept = good(run({ thoth: '  ', result: ' fine ' }))
  expect(kept.entries[0].basis).toEqual({ type: 'ai' })
  expect(kept.entries[0].data).toEqual({ step: 's1', status: 'done', result: 'fine' })
})
```

`update_step_link_writes_item_link_with_basis_ai` 的前兩行，把

```ts
  const linked = good(run({ action: 'link', item: 'A', doc: 'docs/superpowers/specs/a.md' }, { evidence: { thoth: 'T1' } }))
```

改成

```ts
  expect(bad(run({ action: 'link', item: 'A', doc: 'docs/superpowers/specs/a.md' }, { evidence: { thoth: 'T1' } }))).toContain('ops[i].evidence')
  expect(bad(run({ action: 'link', item: 'A', doc: 'x.md', evidence: { thoth: 'T1' } }))).toContain('only on an op that sets status done')
  const linked = good(run({ action: 'link', item: 'A', doc: 'docs/superpowers/specs/a.md' }))
```

最後加兩個測試：

```ts
test('evidence_belongs_to_the_op_that_marks_done', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), step('A', 's1'), step('A', 's2')])
  const run = (ops: object[]) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops })
  const mixed = good(
    run([
      { action: 'edit', step: 's2', title: 'renamed' },
      { action: 'status', step: 's1', status: 'done', evidence: { thoth: 'T1' } },
      { action: 'add', item: 'A', title: 'new' },
      { action: 'status', step: 's2', status: 'doing' },
    ]),
  )
  expect(mixed.entries.map((e) => e.basis)).toEqual([{ type: 'ai' }, { type: 'thoth', task: 'T1' }, { type: 'ai' }, { type: 'ai' }])
  expect(mixed.entries[3].data).toEqual({ step: 's2', status: 'doing' })
  expect(bad(run([{ action: 'status', step: 's2', status: 'doing', evidence: { result: 'x' } }]))).toContain('only on an op that sets status done')
  expect(bad(run([{ action: 'edit', step: 's2', title: 't', evidence: { result: 'x' } }]))).toContain('only on an op that sets status done')
  const schema = TOOLS.update_step.inputSchema as { properties: Record<string, unknown> }
  expect(schema.properties.evidence).toBeUndefined()
  expect(JSON.stringify(schema)).toContain('"evidence"')
})

test('add_sets_status_assignee_and_note_in_one_entry', async () => {
  const base = [entry('item.add', { item: item('A') })]
  const plan = await planOf(base)
  const run = (op: object) => TOOLS.update_step.run(ctxOf(plan), { why: 'w', ops: [{ action: 'add', item: 'A', title: 'review', ...op }] })

  const added = good(run({ status: 'doing', to: 'claude-b', note: ' waiting for review ' }))
  expect(added.entries.length).toBe(1)
  const id = (added.entries[0].data as { step: { id: string } }).step.id
  expect(added.entries[0].data).toEqual({ item: 'A', step: { id, title: 'review' }, status: 'doing', to: 'claude-b', note: 'waiting for review' })
  expect(added.message).toContain('(doing, assigned to claude-b)')
  const after = await replay(await nextText(await logText(base), added.entries, []))
  expect(after.steps[id]).toEqual({ id, item: 'A', title: 'review', status: 'doing', assignee: 'claude-b', note: 'waiting for review' })

  const done = good(run({ status: 'done', evidence: { thoth: 'T9' } }))
  expect(done.entries[0].basis).toEqual({ type: 'thoth', task: 'T9' })
  expect(done.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, status: 'done' })
  const reported = good(run({ status: 'done', evidence: { result: 'already merged' } }))
  expect(reported.entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' }, status: 'done', result: 'already merged' })

  // todo and an empty assignee are what a plain add means; they are not written.
  expect(good(run({ status: 'todo', to: '' })).entries[0].data).toEqual({ item: 'A', step: { id: expect.any(String), title: 'review' } })
  expect(bad(run({ status: 'done' }))).toContain('evidence')
  expect(bad(run({ status: 'done', note: 'x', evidence: { result: 'ok' } }))).toContain('no note')
  expect(bad(run({ status: 'doing', evidence: { result: 'ok' } }))).toContain('only on an op that sets status done')
  expect(bad(run({ status: 'finished' }))).toContain('status')
  expect(bad(run({ to: 3 }))).toContain('to')
})
```

`tests/pane.test.ts` 在 `item_link_history_names_the_item_and_the_path` 後面加：

```ts
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
```

- [x] **Step 2: 跑測試，確認新的測試失敗**

Run: `claude plugin test plugins/plan-board`
Expected: `step_add_can_start_doing_done_assigned_and_noted`、`update_step_needs_evidence_for_done`、`blank_evidence_counts_as_missing`、`update_step_link_writes_item_link_with_basis_ai`、`evidence_belongs_to_the_op_that_marks_done`、`add_sets_status_assignee_and_note_in_one_entry`、`step_add_history_says_how_the_step_started` FAIL。`old_logs_replay_the_same` 現在就會過（它守的是之後不能壞）。

- [x] **Step 3: 實作**

`types/index.d.ts` 的 `step.add`：

```ts
  | { kind: 'step.add'; data: { item: string; step: StepSpec; after?: string; status?: StepStatus; to?: string; note?: string; result?: string } }
```

`hooks/replay.ts`：

`isItemSpec` 下面加：

```ts
const isStatus = (v: unknown): boolean => v === 'todo' || v === 'doing' || v === 'done'
```

`hasValidData` 的 `step.add`、`step.status` 改成：

```ts
    case 'step.add':
      return (
        isString(d.item) &&
        isObject(d.step) &&
        isString(d.step.id) &&
        isString(d.step.title) &&
        isOptString(d.after) &&
        (d.status === undefined || isStatus(d.status)) &&
        isOptString(d.to) &&
        isOptString(d.note) &&
        isOptString(d.result)
      )
```

```ts
    case 'step.status':
      return isString(d.step) && isStatus(d.status) && isOptString(d.result)
```

`detach` 下面加：

```ts
/** What a done step is known by: the Thoth task its entry names, else the result it reports. */
const proofOf = (entry: Entry, result: string | undefined): Step['evidence'] =>
  entry.basis.type === 'thoth' ? { thoth: entry.basis.task } : { result }
```

`applyEntry` 的 `step.add`：

```ts
    case 'step.add': {
      const { item, step, after, status, to, note, result } = entry.data
      if (!has(plan.items, item)) return `unknown item: ${item}`
      if (has(plan.steps, step.id)) return `step exists: ${step.id}`
      const added: Step = { id: step.id, item, title: step.title, status: status ?? 'todo' }
      if (to !== undefined && to !== '') added.assignee = to
      if (added.status === 'done') added.evidence = proofOf(entry, result)
      else if (note !== undefined && note !== '') added.note = note
      plan.steps[step.id] = added
      insertStep(plan, item, step.id, after)
      plan.names[step.id] = step.title
      return null
    }
```

`step.status` 裡的兩行 `else if (entry.basis.type === 'thoth') … else target.evidence = { result }` 換成 `else target.evidence = proofOf(entry, result)`。

`hooks/tools.ts`：

`STATUSES` 下面加：

```ts
/** The basis and result an op that sets status done carries: its own evidence, which it must have. */
function proofOf(raw: Obj, at: string): { basis: Basis; result?: string } {
  const evidence = raw.evidence === undefined ? {} : raw.evidence
  if (!isObj(evidence)) return fail(`${at}.evidence must be an object with thoth or result`)
  const thoth = optText(evidence, 'thoth')?.trim() || undefined
  const result = optText(evidence, 'result')?.trim() || undefined
  if (thoth === undefined && result === undefined) {
    return fail(`${at}: marking a step done needs evidence.thoth (a passed Thoth task id) or evidence.result (a one-line result) on that op`)
  }
  const proof: { basis: Basis; result?: string } = { basis: thoth !== undefined ? { type: 'thoth', task: thoth } : ai }
  if (result !== undefined) proof.result = result
  return proof
}

function statusOf(raw: Obj, at: string): StepStatus | undefined {
  const status = raw.status
  if (status === undefined) return undefined
  if (typeof status !== 'string' || !STATUSES.includes(status)) return fail(`${at}.status must be one of ${STATUSES.join(', ')}`)
  return status as StepStatus
}
```

（檔案開頭的 type import 加上 `StepStatus`：`import type { Basis, Change, Entry, Plan, StepStatus } from '../types'`。）

`updateStep` 整個換成：

```ts
const updateStep = guard((ctx, input) => {
  const o = objectOf(input)
  if (o.evidence !== undefined) return fail('evidence now goes on the op that marks the step done: ops[i].evidence')
  const ops = list(o, 'ops')
  const isNotesOnly = ops.every((raw) => isObj(raw) && raw.action === 'note')
  const isBlank = o.why === undefined || (typeof o.why === 'string' && o.why.trim() === '')
  // A call that only notes where steps stand may leave out why: each note is its own reason.
  const why = isNotesOnly && isBlank ? '' : text(o, 'why')
  const entries: Entry[] = []
  const said: string[] = []
  ops.forEach((raw, i) => {
    if (!isObj(raw)) return fail(`ops[${i}] must be an object`)
    const at = `ops[${i}]`
    const field = (name: string): string => text(raw, name)
    const after = optText(raw, 'after')
    const isDone = (raw.action === 'status' || raw.action === 'add') && raw.status === 'done'
    if (raw.evidence !== undefined && !isDone) return fail(`${at}: evidence goes only on an op that sets status done`)
    switch (raw.action) {
      case 'add': {
        const id = ctx.newId(8)
        const item = field('item')
        const data: Obj = { item, step: { id, title: field('title') } }
        if (after !== undefined) data.after = after
        const status = statusOf(raw, at)
        const to = optText(raw, 'to')
        const note = optText(raw, 'note')?.trim()
        if (status === 'done' && note) return fail(`${at}: a step added as done has no note`)
        const proof: { basis: Basis; result?: string } = status === 'done' ? proofOf(raw, at) : { basis: ai }
        if (status !== undefined && status !== 'todo') data.status = status
        if (to) data.to = to
        if (note) data.note = note
        if (proof.result !== undefined) data.result = proof.result
        entries.push(make(ctx, 'step.add', data, why, proof.basis))
        const how = [status !== undefined && status !== 'todo' ? status : '', to ? `assigned to ${to}` : ''].filter((part) => part !== '')
        said.push(`Added step ${id} to item ${item}${how.length > 0 ? ` (${how.join(', ')})` : ''}.`)
        break
      }
      case 'edit':
        entries.push(make(ctx, 'step.edit', { step: field('step'), title: field('title') }, why, ai))
        said.push(`Renamed step ${field('step')}.`)
        break
      case 'remove':
        entries.push(make(ctx, 'step.remove', { step: field('step') }, why, ai))
        said.push(`Removed step ${field('step')}.`)
        break
      case 'move': {
        const data: Obj = { step: field('step'), item: field('item') }
        if (after !== undefined) data.after = after
        entries.push(make(ctx, 'step.move', data, why, ai))
        said.push(`Moved step ${field('step')} to item ${field('item')}.`)
        break
      }
      case 'assign': {
        const to = raw.to
        if (typeof to !== 'string') return fail(`${at}.to must be a string (empty to clear)`)
        entries.push(make(ctx, 'step.assign', { step: field('step'), to }, why, ai))
        said.push(to === '' ? `Cleared the assignee of step ${field('step')}.` : `Assigned step ${field('step')} to ${to}.`)
        break
      }
      case 'note': {
        if (typeof raw.note !== 'string') return fail(`${at}.note must be a string (empty to clear)`)
        const note = raw.note.trim()
        const stepId = field('step')
        entries.push(make(ctx, 'step.note', { step: stepId, note }, why || (note === '' ? 'note cleared' : note), ai))
        said.push(note === '' ? `Cleared the note of step ${stepId}.` : `Noted step ${stepId}.`)
        break
      }
      case 'link': {
        const item = field('item')
        const doc = field('doc')
        entries.push(make(ctx, 'item.link', { item, doc }, why, ai))
        said.push(`Linked ${doc} to item ${item}.`)
        break
      }
      case 'status': {
        const status = raw.status
        if (typeof status !== 'string' || !STATUSES.includes(status)) return fail(`${at}.status must be one of ${STATUSES.join(', ')}`)
        const stepId = field('step')
        const proof: { basis: Basis; result?: string } = status === 'done' ? proofOf(raw, at) : { basis: ai }
        const data: Obj = { step: stepId, status }
        if (proof.result !== undefined) data.result = proof.result
        entries.push(make(ctx, 'step.status', data, why, proof.basis))
        said.push(`Set step ${stepId} to ${status}.`)
        break
      }
      default:
        return fail(`${at}.action must be one of add, edit, remove, move, assign, status, note, link`)
    }
  })
  return accept(ctx, entries, said.join(' '))
})
```

`to: 3` 會在 `optText(raw, 'to')` 擋下：`to must be a string`。

`TOOLS.update_step.inputSchema`：拿掉最外層的 `evidence`；`ops.items.properties` 加：

```ts
              status: { type: 'string', enum: ['todo', 'doing', 'done'], description: 'For status; on add, the status the new step starts with.' },
              to: { ...str, description: 'Assignee; on assign an empty string clears it, on add it may be left out.' },
              evidence: {
                type: 'object',
                description: 'Only on an op that sets status done (status or add), and required there.',
                properties: { thoth: { ...str, description: 'Passed Thoth task id.' }, result: { ...str, description: 'One-line result.' } },
              },
```

`hooks/lines.ts` 的 `changeLine`，`case 'step.add'` 換成：

```ts
    case 'step.add': {
      const { step, item, status, to } = change.data
      const how: string[] = []
      if (status === 'doing' || status === 'done') how.push(t(lang, status === 'done' ? 'stepDone' : 'stepDoing'))
      if (to !== undefined && to !== '') how.push(assignedText(to, lang))
      const tail = how.length === 0 ? '' : lang === 'zh-TW' ? `（${how.join('、')}）` : ` (${how.join(', ')})`
      return `${t(lang, 'kindStep')} ${t(lang, 'stepAdd', { step: step.title, item: name(item) })}${tail}`
    }
```

- [x] **Step 4: 跑測試，確認全過**

Run: `claude plugin test plugins/plan-board` → `121 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board
git commit -m "feat(plan-board): add steps with status, assignee and note; evidence goes on its op"
```

---

### Task 14: 待你處理卡的資料、工具、送給 AI 的訊息（spec 15.2）

**Files:**
- Modify: `plugins/plan-board/types/index.d.ts`
- Modify: `plugins/plan-board/hooks/replay.ts`（`isCardSpec`）
- Modify: `plugins/plan-board/hooks/tools.ts`（新工具 `add_user_action`、`apply_change` 的訊息、`resolve_decision` 的說明）
- Modify: `plugins/plan-board/hooks/view.ts`（`openCards` 排序）
- Modify: `plugins/plan-board/hooks/local.ts`（`verdict`、`blockingMessage`）
- Test: `tests/tools.test.ts`、`tests/view.test.ts`、`tests/local.test.ts`

**Interfaces:**
- Produces: `CardSpec.type` 多 `'action'`、`CardSpec.command?: string`；`TOOLS.add_user_action`（輸入 `action`、`why`、`command?`、`item?`、`step?`；結果文字含 `card <8 碼>`）；`ToolName` 多 `'add_user_action'`；待你處理卡的回覆用 `choice: 'done'`；`openCards` 把待你處理卡排在最前面。
- Consumes: 無。

- [x] **Step 1: 寫會失敗的測試**

`tests/tools.test.ts`：`schemas_list_required_fields` 加一行、改最後一行：

```ts
  expect(required('add_user_action')).toEqual(['action', 'why'])
```

```ts
  expect(Object.keys(TOOLS).sort()).toEqual(['add_decision', 'add_user_action', 'apply_change', 'propose_change', 'resolve_decision', 'resolve_direct_edit', 'update_step'])
```

最後加：

```ts
test('add_user_action_opens_an_action_card', async () => {
  const plan = await planOf([entry('item.add', { item: item('A') }), entry('item.add', { item: item('B') }), step('A', 's1')])
  const run = (input: object) => TOOLS.add_user_action.run(ctxOf(plan), input)
  const opened = good(
    run({ action: 'Run thoth checks approve in your terminal', why: 'new checks need a human', command: 'thoth checks approve', item: 'A', step: 's1' }),
  )
  expect(opened.entries.length).toBe(1)
  expect(opened.entries[0].kind).toBe('card.open')
  const card = (opened.entries[0].data as { card: { id: string } }).card
  expect(card).toEqual({
    id: card.id,
    type: 'action',
    question: 'Run thoth checks approve in your terminal',
    why: 'new checks need a human',
    options: [],
    item: 'A',
    step: 's1',
    command: 'thoth checks approve',
  })
  expect(card.id).toMatch(HEX8)
  expect(opened.message).toContain(`card ${card.id}`)

  const bare = good(run({ action: 'Log in to GitHub', why: 'the push needs it' }))
  expect((bare.entries[0].data as { card: object }).card).toEqual({ id: expect.any(String), type: 'action', question: 'Log in to GitHub', why: 'the push needs it', options: [] })
  // The step alone names its item.
  expect((good(run({ action: 'x', why: 'y', step: 's1' })).entries[0].data as { card: { item?: string } }).card.item).toBe('A')

  expect(bad(run({ why: 'y' }))).toContain('action')
  expect(bad(run({ action: 'x' }))).toContain('why')
  expect(bad(run({ action: 'x', why: 'y', command: '  ' }))).toContain('command')
  expect(bad(run({ action: 'x', why: 'y', item: 'ghost' }))).toContain('unknown item')
  expect(bad(run({ action: 'x', why: 'y', item: 'B', step: 's1' }))).toContain('not in item')

  const withCard = await planOf([entry('card.open', { card: { id: 'a1', type: 'action', question: 'Log in', why: 'w', options: [], command: 'gh auth login' } })])
  expect(withCard.cards.a1.type).toBe('action')
  expect(withCard.cards.a1.command).toBe('gh auth login')
  expect(bad(TOOLS.apply_change.run(ctxOf(withCard, ['a1']), { card: 'a1' }))).toContain('not a proposal')
  good(TOOLS.resolve_decision.run(ctxOf(withCard), { card: 'a1', outcome: 'logged in' }))
})
```

`tests/view.test.ts` 最後加：

```ts
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
```

`tests/local.test.ts` 最後加：

```ts
test('action_card_messages', async () => {
  const plan = await planOf(
    entry('card.open', { card: { id: 'a1', type: 'action', question: 'Run thoth checks approve', why: 'w', options: [], command: 'thoth checks approve' } }),
  )
  const card = plan.cards.a1
  expect(blockingMessage(card, { choice: 'done', at: 1 })).toBe(
    'Done by the user: "Run thoth checks approve" [a1]. Check it if you can, then resolve the card with resolve_decision.',
  )
  expect(blockingMessage(card, { choice: 'done', draft: 'it asked twice', at: 1 })).toContain('\nthought: it asked twice')
  expect(blockingMessage(card, { isDismissed: true, at: 1 })).toContain('dismissed (resolve it: the user skipped this card)')
  expect(blockingMessage(card, { draft: 'no access', at: 1 }).startsWith('My thoughts on "Run thoth checks approve" [a1]: no access')).toBe(true)
  expect(batchMessage(plan, [['a1', { choice: 'done', at: 1 }]])).toContain(
    '- [a1] Run thoth checks approve → done (check it if you can, then resolve the card with resolve_decision)',
  )
})
```

- [x] **Step 2: 跑測試，確認新的測試失敗**

Run: `claude plugin test plugins/plan-board`
Expected: `schemas_list_required_fields`、`add_user_action_opens_an_action_card`、`action_cards_come_first_and_count_as_waiting`、`action_card_messages` FAIL。

- [x] **Step 3: 實作**

`types/index.d.ts` 的 `CardSpec`：

```ts
export type CardSpec = {
  id: string; type: 'question' | 'proposal' | 'action'; item?: string; step?: string
  question: string; why: string; options: CardOption[]; blocking?: boolean; changes?: ItemChange[]
  /** For an action card: the command the user runs, word for word. */
  command?: string
}
```

`hooks/replay.ts` 的 `isCardSpec`：

```ts
    (v.type === 'question' || v.type === 'proposal' || v.type === 'action') &&
    isOptString(v.item) &&
    isOptString(v.step) &&
    isOptString(v.command) &&
```

`hooks/tools.ts`：

`ToolName` 加 `'add_user_action'`：

```ts
export type ToolName = 'propose_change' | 'apply_change' | 'update_step' | 'add_decision' | 'add_user_action' | 'resolve_decision' | 'resolve_direct_edit'
```

`applyChange` 裡

```ts
  if (card.type !== 'proposal') return fail(`card ${cardId} is a question, not a proposal; close it with resolve_decision`)
```

改成

```ts
  if (card.type !== 'proposal') return fail(`card ${cardId} is not a proposal; close it with resolve_decision`)
```

`addDecision` 後面加：

```ts
// ---- add_user_action ----

const addUserAction = guard((ctx, input) => {
  const o = objectOf(input)
  const action = text(o, 'action')
  const why = text(o, 'why')
  const command = optText(o, 'command')
  if (command !== undefined && command.trim() === '') return fail('command must be a non-empty string when given')
  const step = optText(o, 'step')
  const itemId = checkRefs(ctx.plan, optText(o, 'item'), step)
  const card: Obj = { id: ctx.newId(8), type: 'action', question: action, why, options: [] }
  if (itemId !== undefined) card.item = itemId
  if (step !== undefined) card.step = step
  if (command !== undefined) card.command = command
  return accept(ctx, [make(ctx, 'card.open', { card }, why, ai)], `Opened action card ${card.id}; the user will mark it done in the pane.`)
})
```

`TOOLS` 在 `add_decision` 後面加：

```ts
  add_user_action: {
    description:
      'Ask the user to do something themselves (run a command in their terminal, approve something, log in), shown as a card they mark done in the pane.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { ...str, description: 'One line: what the user has to do.' },
        why: { ...str, description: 'Why it is needed now.' },
        command: { ...str, description: 'The command to run, word for word, when there is one.' },
        item: str,
        step: str,
      },
      required: ['action', 'why'],
    },
    run: addUserAction,
  },
```

`resolve_decision` 的 `description` 改成 `'Close a decision card or an action card the user has answered, recording the outcome.'`。

`hooks/view.ts` 的 `openCards` 排序，最前面加一行：

```ts
    .sort((a, b) => {
      // What the user has to do comes before what they have to decide.
      if ((a.type === 'action') !== (b.type === 'action')) return a.type === 'action' ? -1 : 1
      if (Boolean(a.blocking) !== Boolean(b.blocking)) return a.blocking ? -1 : 1
```

`hooks/local.ts`：

`verdict` 在 `if (pick.choice === undefined) …` 後面加：

```ts
  if (card?.type === 'action' && pick.choice === 'done') return 'done (check it if you can, then resolve the card with resolve_decision)'
```

`blockingMessage` 在想法那個 `if` 後面加：

```ts
  if (card.type === 'action' && pick.choice === 'done') {
    const done = `Done by the user: "${card.question}" [${card.id}]. Check it if you can, then resolve the card with resolve_decision.`
    return hasDraft ? `${done}\nthought: ${pick.draft}` : done
  }
```

- [x] **Step 4: 跑測試，確認全過**

Run: `claude plugin test plugins/plan-board` → `124 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board
git commit -m "feat(plan-board): action cards for what the user has to do"
```

---

### Task 15: 待你處理卡的畫面、輸入框上方那列（spec 15.2）

**Files:**
- Modify: `plugins/plan-board/hooks/i18n.ts`
- Modify: `plugins/plan-board/hooks/pane.tsx`（`cardBox`、總表的步驟那一行）
- Modify: `plugins/plan-board/hooks/lines.ts`（`card.open` 的那句話）
- Modify: `plugins/plan-board/hooks/register.tsx`（`act`、`DENY_EDIT`）
- Test: `tests/pane.test.ts`

**Interfaces:**
- Consumes: Task 14 的 `type: 'action'`、`command`、`add_user_action`、`choice: 'done'`、`openCards` 排序。
- Produces: 按鈕鍵 `${card.id}:done`；i18n 鍵 `actionDone`、`actionWhy`、`command`、`sentChecking`、`waitingAction`、`actionOpen`。

- [x] **Step 1: 寫會失敗的測試，並改既有測試的字**

`tests/pane.test.ts`，在 `const loose = …` 那行後面加（`no_ids_in_zh_tw_text` 也會用到 `ACTION`）：

```ts
const ACTION = '在終端機跑 thoth checks approve'
const addAction = async ($: Engine, extra: Record<string, unknown> = {}) => {
  const added = await $.tool.call({ tool: tool('add_user_action'), action: ACTION, why: '新的檢查要人核准才會跑', command: 'thoth checks approve', ...extra })
  return /card (\w{8})/.exec(String(added.result))?.[1] as string
}
```

最後加：

```ts
test('action_card_shows_the_command_and_done_goes_out_at_once', ZH, async ($, on) => {
  const w = await start($, on, [...board(), blockedOnS2()])
  for (const surface of SURFACES) {
    await fresh($, w)
    const id = await addAction($, { item: B, step: S2 })
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Button', key: 'view:cards', text: '等你（2）' })).toBeDefined()
    await ui.press({ key: `item:${B}` })
    expect(await ui.find({ text: `等你處理：${ACTION}` })).toBeDefined()
    expect(await ui.find({ text: '⚑ 窗格兩個畫面' })).toBeDefined()

    await ui.press({ key: 'view:cards' })
    // The action card comes first and opens by itself; the question waits closed.
    expect(await ui.find({ type: 'Text', text: '為什麼：新的檢查要人核准才會跑' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '指令：thoth checks approve' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}:done`, text: '做好了' })).toBeDefined()
    expect(await ui.find({ key: `${id}:note` })).toBeDefined()
    expect(await ui.find({ key: `${id}:x` })).toBeDefined()
    expect(await ui.find({ key: `${Q1}:0` })).toBeUndefined()
    expect(await ui.find({ text: '之前：' })).toBeUndefined()

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
    expect((await line.find({ type: 'Text', text: /計畫：/ }))?.text).toBe('計畫：1 項進行中 · 1 件事等你')
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
    expect(await ui.find({ key: `${id}:done` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '你的想法：我沒有權限' })).toBeDefined()

    await ui.press({ key: `${id}:x` })
    await until(ui, () => w.submitted.length > 1)
    expect(w.submitted[1]).toContain('dismissed')
    expect(await ui.find({ text: '已送出，等 AI 確認' })).toBeDefined()
    await $.tool.call({ tool: tool('resolve_decision'), card: id, outcome: '使用者略過' })
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
```

既有測試改字（意思不變，只是 spec 15.2 改了用語）：

- `cards_view_expands_only_the_first`：`'等你決定（2）'` → `'等你（2）'`。
- `proposal_card_lists_changes_and_approve_is_staged`：`'✓ 目前沒有待你決定的事'` → `'✓ 目前沒有等你的事'`。
- `band_text_and_edit_warning`：三個 `個決定等你` 都改成 `件事等你`。
- `empty_repo_shows_hint_and_engine_band`：`'✓ 目前沒有待你決定的事'` → `'✓ 目前沒有等你的事'`；`'等你決定（0）'` → `'等你（0）'`。
- `thought_only_card_stays_interactive_after_sending`：`'等你決定（1）'` → `'等你（1）'`、`'等你決定（0）'` → `'等你（0）'`；兩個 `個決定等你` 改成 `件事等你`。
- `a_blocking_thought_leaves_the_card_open_but_a_dismissal_dims_it`：`'等你決定（1）'` → `'等你（1）'`。
- `i18n_tables_have_the_same_keys`：`words` 裡 `'等你決定（{n}）'` → `'等你（{n}）'`、`'✓ 目前沒有待你決定的事'` → `'✓ 目前沒有等你的事'`、`'計畫：{doing} 項進行中 · {waiting} 個決定等你'` → `'計畫：{doing} 項進行中 · {waiting} 件事等你'`，再加上 `'做好了'`、`'為什麼：{why}'`、`'指令：{command}'`、`'已送出，等 AI 確認'`、`'等你處理：{question}'`、`'請你「{question}」'`；最後那行 `toBe('等你決定（3）')` → `toBe('等你（3）')`。
- `no_ids_in_zh_tw_text`：`blockedOnS2(),` 前面加一張待你處理卡，`cards` 改成以它開頭：

```ts
    entry('card.open', {
      card: { id: '5a5a5a5a', type: 'action', item: B, step: S2, question: ACTION, why: '新的檢查要人核准', options: [], command: 'thoth checks approve' },
    }),
```

```ts
  const cards = ['5a5a5a5a', Q1, Q2, P1]
```


- [x] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected: 新的三個和改了字的既有測試 FAIL（找不到 `等你（2）`、`件事等你`、`做好了` 等）。

- [x] **Step 3: 實作**

`hooks/i18n.ts`：

`EN`：

```ts
  viewCards: 'Waiting for you ({n})',
  band: 'Plan: {doing} in progress · {waiting} waiting for you',
  nothingWaiting: '✓ Nothing is waiting for you',
  actionDone: 'Done',
  actionWhy: 'Why: {why}',
  command: 'Command: {command}',
  sentChecking: 'Sent, waiting for the AI to check',
  waitingAction: 'waiting for you to: {question}',
  actionOpen: 'asked you to "{question}"',
```

`ZH_TW`：

```ts
  viewCards: '等你（{n}）',
  band: '計畫：{doing} 項進行中 · {waiting} 件事等你',
  nothingWaiting: '✓ 目前沒有等你的事',
  actionDone: '做好了',
  actionWhy: '為什麼：{why}',
  command: '指令：{command}',
  sentChecking: '已送出，等 AI 確認',
  waitingAction: '等你處理：{question}',
  actionOpen: '請你「{question}」',
```

（`viewCards`、`band`、`nothingWaiting` 是改既有的值；其餘是新的鍵。英文的 `viewCards`、`nothingWaiting` 字不變。）

`hooks/lines.ts` 的 `changeLine`：

```ts
    case 'card.open':
      return `${t(lang, 'kindCard')} ${t(lang, change.data.card.type === 'action' ? 'actionOpen' : 'cardOpen', { question: change.data.card.question })}`
```

`hooks/pane.tsx`：

總表的步驟那一行，`note` 的算法換成：

```tsx
                      const waiting = open.find(card => card.step === stepId)
                      const note =
                        waiting === undefined
                          ? evidenceOf(step, lang)
                          : t(lang, waiting.type === 'action' ? 'waitingAction' : 'blockedBy', { question: waiting.question })
```

`cardBox` 整個換成：

```tsx
  const cardBox = (card: Card) => {
    const where = whereText(current, card, lang)
    const staged = Object.hasOwn(mine.staged, card.id) ? mine.staged[card.id] : undefined
    const thought = Object.hasOwn(mine.sent, card.id) ? mine.sent[card.id].draft : undefined
    const isFirst = card.id === firstId
    const isAction = card.type === 'action'
    // An action card is answered at once, as a blocking one is.
    const isNow = card.blocking === true || isAction
    const hotkey = (i: number) => (isFirst && i < 9 ? { hotkey: String(i + 1) } : {})
    const border = (color: string) => ({ borderStyle: 'round', borderColor: color, paddingX: 1 }) as const

    if (isSent(card)) {
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border('gray')}>
          <Text dimColor wrap="wrap">
            {card.question}
          </Text>
          <Text dimColor wrap="wrap">
            {where}
          </Text>
          <Text dimColor>{t(lang, isAction ? 'sentChecking' : 'sentWaiting')}</Text>
        </Box>
      )
    }
    if (!isFirst && !mine.expanded.includes(card.id)) {
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border('gray')}>
          <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)} />
          <Text dimColor wrap="wrap">
            {where}
          </Text>
        </Box>
      )
    }

    const head = (
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {isFirst ? (
            <Text bold wrap="wrap">
              {card.question}
            </Text>
          ) : (
            <Button key={`card:${card.id}`} plain label={card.question} onPress={() => actions.toggle(card.id)} />
          )}
        </Box>
        <Button key={`${card.id}:x`} plain dimColor role="dismiss" label="✕" onPress={() => actions.dismiss(card)} />
      </Box>
    )
    const yours = thought !== undefined && (
      <Box marginTop={1}>
        <Text wrap="wrap">{t(lang, 'yourThought', { draft: thought })}</Text>
      </Box>
    )
    const noteBox = Input && (
      <Box marginTop={1}>
        <Input
          key={`${card.id}:note`}
          placeholder={t(lang, isNow ? 'notePlaceholderNow' : 'notePlaceholderStaged')}
          submitLabel={t(lang, isNow ? 'noteNow' : 'noteStaged')}
          onSubmit={(value: string) => actions.think(card, value)}
        />
      </Box>
    )

    if (isAction) {
      return (
        <Box key={`card:box:${card.id}`} flexDirection="column" {...border(isFirst ? 'yellow' : 'gray')}>
          {head}
          <Text dimColor italic wrap="wrap">
            {where}
          </Text>
          <Text wrap="wrap">{t(lang, 'actionWhy', { why: card.why })}</Text>
          {card.command !== undefined && <Text wrap="wrap">{t(lang, 'command', { command: card.command })}</Text>}
          <Box marginTop={1}>
            <Button key={`${card.id}:done`} plain {...hotkey(0)} label={t(lang, 'actionDone')} onPress={() => actions.choose(card, 'done')} />
          </Box>
          {yours}
          {noteBox}
        </Box>
      )
    }

    const recent = recentFor(current, card, RECENT)
    const hasStaged = staged !== undefined
    return (
      <Box key={`card:box:${card.id}`} flexDirection="column" {...border(hasStaged ? 'green' : isFirst ? 'yellow' : 'gray')}>
        {head}
        <Text dimColor italic wrap="wrap">
          {where}
        </Text>
        <Text wrap="wrap">{t(lang, 'why', { why: card.why })}</Text>
        {recent.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>{t(lang, 'recent')}</Text>
            {recent.map(entry => (
              <Box key={`recent:${card.id}:${entry.id}`} paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {historyLines(entry, current, lang)[0]}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {card.type === 'proposal' ? (
            <Box flexDirection="column">
              <Button
                key={`${card.id}:approve`}
                plain
                {...hotkey(0)}
                label={`${staged?.choice === 'approve' ? '● ' : ''}${t(lang, 'approve')}`}
                onPress={() => actions.choose(card, 'approve')}
              />
              {(card.changes ?? []).map((change, i) => (
                <Box key={`change:${card.id}:${i}`} paddingLeft={2}>
                  <Text dimColor wrap="wrap">
                    {changeLine(change, current, lang)}
                  </Text>
                </Box>
              ))}
              <Button
                key={`${card.id}:reject`}
                plain
                {...hotkey(1)}
                label={`${staged?.choice === 'reject' ? '● ' : ''}${t(lang, 'reject')}`}
                onPress={() => actions.choose(card, 'reject')}
              />
            </Box>
          ) : (
            card.options.map((option, i) => {
              const mark = staged?.choice === option.label ? '● ' : ''
              const label = `${mark || (isFirst && i < 9 ? '' : '› ')}${option.label}${option.recommended === true ? t(lang, 'recommended') : ''}`
              const effect = option.reason !== undefined && option.reason !== '' ? `${option.effect} · ${option.reason}` : option.effect
              return (
                <Box key={`option:${card.id}:${i}`} flexDirection="column">
                  <Button key={`${card.id}:${i}`} plain {...hotkey(i)} label={label} onPress={() => actions.choose(card, option.label)} />
                  <Box paddingLeft={2}>
                    <Text dimColor wrap="wrap">
                      {effect}
                    </Text>
                  </Box>
                </Box>
              )
            })
          )}
        </Box>
        {yours}
        {hasStaged && (
          <Box justifyContent="space-between" marginTop={1}>
            <Box flexDirection="column" flexShrink={1}>
              {staged.isDismissed === true && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'picked', { choice: t(lang, 'skip') })}
                </Text>
              )}
              {staged.isDismissed !== true && staged.choice !== undefined && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'picked', { choice: pickText(card, staged.choice, lang) })}
                </Text>
              )}
              {staged.draft !== undefined && (
                <Text color="green" wrap="wrap">
                  {t(lang, 'drafted', { draft: staged.draft })}
                </Text>
              )}
            </Box>
            <Button key={`${card.id}:clear`} plain dimColor label={t(lang, 'clear')} onPress={() => actions.clear(card)} />
          </Box>
        )}
        {noteBox}
      </Box>
    )
  }
```

`hooks/register.tsx`：

```ts
const DENY_EDIT =
  'Files under plan/ are written only through the plan-board tools: propose_change, apply_change, update_step, add_decision, add_user_action, resolve_decision, resolve_direct_edit.'
```

```ts
// A blocking card is answered at once, and so is a card asking the user to do something; any other pick is staged for the batch.
const act = ($: EngineInterface, card: Card, make: (current: Local, at: number) => Local): Promise<void> =>
  card.blocking === true || card.type === 'action' ? sendNow($, card, make) : stage($, make)
```

- [x] **Step 4: 跑測試，確認全過**

Run: `claude plugin test plugins/plan-board` → `127 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board
git commit -m "feat(plan-board): action cards in the pane; one count of what waits for you"
```

---

### Task 16: 變動紀錄收合（spec 15.5）

**Files:**
- Modify: `plugins/plan-board/hooks/view.ts`（`isChatter`、`Row`、`foldHistory`；`recentFor` 改回傳 `Row[]`）
- Modify: `plugins/plan-board/hooks/lines.ts`（`foldText`）
- Modify: `plugins/plan-board/hooks/i18n.ts`
- Modify: `plugins/plan-board/hooks/pane.tsx`（項目的變動紀錄、卡片的「之前：」）
- Modify: `plugins/plan-board/hooks/local.ts`（`forget`）
- Test: `tests/view.test.ts`、`tests/pane.test.ts`、`tests/local.test.ts`

**Interfaces:**
- Consumes: Task 12（`step.note` 不在 `itemLog`）、Task 15 的 `cardBox`。
- Produces: `isChatter(entry: Entry): boolean`；`type Row = { kind: 'entry'; entry: Entry } | { kind: 'fold'; key: string; entries: Entry[] }`（`entries` 新的在前，`key` 是最舊那筆的 id）；`foldHistory(history: Entry[]): Row[]`；`recentFor(plan, card, n): Row[]`；`foldText(entries: Entry[], lang: Lang): string`；窗格的按鈕鍵 `fold:${itemId}:${row.key}`、`log:${itemId}:${entry.id}`；`Local.expanded` 裡的 `fold:<entry id>`、`why:<entry id>`。

- [x] **Step 1: 寫會失敗的測試，並改既有測試**

`tests/view.test.ts`：import 加 `foldHistory`、`isChatter`：

```ts
import { bandCounts, blockedSteps, cardPosition, foldHistory, historyOf, isChatter, itemStates, openCards, recentFor } from '../hooks/view.ts'
```

`history_newest_first_without_self` 裡 `const recent = …` 到 `expect(recent[0]).toEqual(history[0])` 換成：

```ts
  const recent = recentFor(plan, plan.cards.c1, 3)
  // The card's own opening is left out, so the steps on both sides of it fold into one row.
  expect(recent.map(row => row.kind)).toEqual(['fold', 'entry'])
  const [fold, first] = recent
  if (fold.kind !== 'fold' || first.kind !== 'entry') throw new Error('unreachable')
  expect(fold.entries.map(e => e.kind)).toEqual(['step.add', 'step.add', 'step.add', 'step.add'])
  expect(fold.entries[0]).toEqual(history[0])
  expect(first.entry.kind).toBe('item.add')
```

最後加：

```ts
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
```

`tests/local.test.ts` 最後加：

```ts
test('forget_keeps_open_history_rows_of_entries_still_in_the_log', async () => {
  const kept = entry('item.add', { item: { id: 'A', title: 'A', goal: 'g' } })
  const plan = await planOf(kept, question('open'))
  const local = { ...emptyLocal(), expanded: ['A', `fold:${kept.id}`, `why:${kept.id}`, 'fold:000000000fff', 'why:gone', 'open'] }
  expect(forget(local, plan).expanded).toEqual(['A', `fold:${kept.id}`, `why:${kept.id}`, 'open'])
})
```

`tests/pane.test.ts`：import 加 `foldText`：

```ts
import { foldText, historyLines, stamp } from '../hooks/lines.ts'
```

最後加：

```ts
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
      entry('item.link', { item: A, doc: PLAN }),
      entry('step.remove', { step: S2 }),
    ]),
  )
  const chatter = plan.applied.slice(1)
  expect(foldText(chatter, 'zh-TW')).toBe('步驟：新增 2 個、做完 1 個、開始 1 個、改回還沒開始 1 個、改名 1 個、刪掉 1 個、移動 1 個、改派 1 個、連上文件 1 個')
  expect(foldText(chatter, 'en')).toBe('Steps: 2 added, 1 done, 1 started, 1 back to not started, 1 renamed, 1 removed, 1 moved, 1 reassigned, 1 docs linked')
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
    await ui.press({ key: fold })
    await $.tool.call({ tool: tool('update_step'), why: '多一步', ops: [{ action: 'add', item: B, title: `補測試 ${surface}` }] })
    expect((await ui.find({ type: 'Button', key: fold }))?.text).toContain('▾ 步驟：')
    expect(await ui.find({ type: 'Button', text: new RegExp(`新增「補測試 ${surface}」`) })).toBeDefined()
    await ui.unmount()
  }
})
```

既有測試：

- `overview_shows_states_and_expands_item`：把

  ```ts
      expect(await ui.find({ type: 'Text', text: /^原因：面板測試全過/ })).toBeDefined()
  ```

  換成

  ```ts
      expect(await ui.find({ type: 'Button', text: /▸ 步驟：新增 2 個、做完 1 個、開始 1 個$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^原因：/ })).toBeUndefined()
  ```

- `overview_lists_linked_docs_and_marks_local_mode`、`an_assignee_that_looks_like_an_id_is_shown_as_a_thoth_task`：在 `const seen = await texts(ui)` 前面打開收合的那一行：

  ```ts
      for (const found of await ui.findAll({ type: 'Button', text: /▸ 步驟：/ })) await ui.press({ key: found.key as string })
  ```

- `no_ids_in_zh_tw_text`：在 `for (const id of items) await ui.press({ key: `item:${id}` })` 後面加同一行，再收集 `seen`。

- `i18n_tables_have_the_same_keys` 的 `words` 加 `'步驟：{counts}'`、`'新增 {n} 個'`、`'做完 {n} 個'`、`'開始 {n} 個'`、`'改回還沒開始 {n} 個'`、`'改名 {n} 個'`、`'刪掉 {n} 個'`、`'移動 {n} 個'`、`'改派 {n} 個'`、`'連上文件 {n} 個'`。

- [x] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected: 新加的測試和改過的既有測試 FAIL（`foldHistory is not a function`、找不到 `▸ 步驟：` 等）。

- [x] **Step 3: 實作**

`hooks/i18n.ts`：

`EN`：

```ts
  foldSteps: 'Steps: {counts}',
  foldAdded: '{n} added',
  foldDone: '{n} done',
  foldStarted: '{n} started',
  foldBack: '{n} back to not started',
  foldRenamed: '{n} renamed',
  foldRemoved: '{n} removed',
  foldMoved: '{n} moved',
  foldReassigned: '{n} reassigned',
  foldLinked: '{n} docs linked',
```

`ZH_TW`：

```ts
  foldSteps: '步驟：{counts}',
  foldAdded: '新增 {n} 個',
  foldDone: '做完 {n} 個',
  foldStarted: '開始 {n} 個',
  foldBack: '改回還沒開始 {n} 個',
  foldRenamed: '改名 {n} 個',
  foldRemoved: '刪掉 {n} 個',
  foldMoved: '移動 {n} 個',
  foldReassigned: '改派 {n} 個',
  foldLinked: '連上文件 {n} 個',
```

`hooks/view.ts`，`historyOf` 後面加，並把 `recentFor` 換掉：

```ts
/** Step-level chatter, folded in the history; step.note never reaches the history at all. */
const CHATTER: ReadonlySet<string> = new Set(['step.add', 'step.edit', 'step.remove', 'step.move', 'step.assign', 'step.status', 'item.link'])

export const isChatter = (entry: Entry): boolean => CHATTER.has(entry.kind)

/** A history row: one entry, or a run of two or more chatter entries (newest first) named by its oldest, so it keeps its name as the run grows. */
export type Row = { kind: 'entry'; entry: Entry } | { kind: 'fold'; key: string; entries: Entry[] }

export function foldHistory(history: Entry[]): Row[] {
  const rows: Row[] = []
  let run: Entry[] = []
  const flush = (): void => {
    if (run.length === 1) rows.push({ kind: 'entry', entry: run[0] })
    else if (run.length > 1) rows.push({ kind: 'fold', key: run[run.length - 1].id, entries: run })
    run = []
  }
  for (const entry of history) {
    if (isChatter(entry)) {
      run.push(entry)
      continue
    }
    flush()
    rows.push({ kind: 'entry', entry })
  }
  flush()
  return rows
}

export function recentFor(plan: Plan, card: Card, n: number): Row[] {
  if (card.item === undefined) return []
  const history = historyOf(plan, card.item).filter(entry => !(entry.kind === 'card.open' && entry.data.card.id === card.id))
  return foldHistory(history).slice(0, n)
}
```

`hooks/lines.ts`：import 改成 `import type { Key, Lang } from './i18n.ts'`，檔案最後加：

```ts
/** The label each kind of step chatter is counted under, in the order a folded row lists them. */
const FOLD: Key[] = ['foldAdded', 'foldDone', 'foldStarted', 'foldBack', 'foldRenamed', 'foldRemoved', 'foldMoved', 'foldReassigned', 'foldLinked']

function foldKeyOf(entry: Entry): Key {
  switch (entry.kind) {
    case 'step.add':
      return 'foldAdded'
    case 'step.status':
      return entry.data.status === 'done' ? 'foldDone' : entry.data.status === 'doing' ? 'foldStarted' : 'foldBack'
    case 'step.edit':
      return 'foldRenamed'
    case 'step.remove':
      return 'foldRemoved'
    case 'step.move':
      return 'foldMoved'
    case 'step.assign':
      return 'foldReassigned'
    default:
      return 'foldLinked'
  }
}

/** A run of step chatter as one phrase: how many steps had what done to them, without the time. */
export function foldText(entries: Entry[], lang: Lang): string {
  const counts = new Map<Key, number>()
  for (const entry of entries) {
    const key = foldKeyOf(entry)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = FOLD.filter(key => counts.has(key)).map(key => t(lang, key, { n: counts.get(key) ?? 0 }))
  return t(lang, 'foldSteps', { counts: parts.join(lang === 'zh-TW' ? '、' : ', ') })
}
```

`hooks/pane.tsx`：

import 改成：

```ts
import { assignedText, changeLine, fit, foldText, historyLines, stamp, textWidth } from './lines.ts'
import { bandCounts, blockedSteps, cardPosition, foldHistory, historyOf, isAnswered, itemStates, openCards, recentFor } from './view.ts'
import type { Row } from './view.ts'
import type { Card, Entry, ItemState, Local, Plan, Step } from '../types'
```

`paneView` 裡、`overview` 前面加兩個畫一行紀錄的函式：

```tsx
  /** One entry of an item's history: a line to press for its reason. */
  const logRow = (itemId: string, entry: Entry, isNested: boolean) => {
    const [line, reason] = historyLines(entry, current, lang)
    const whyKey = `why:${entry.id}`
    return (
      <Box key={`box:log:${itemId}:${entry.id}`} flexDirection="column" paddingLeft={isNested ? 2 : 0}>
        <Button key={`log:${itemId}:${entry.id}`} plain label={line} onPress={() => actions.toggle(whyKey)} />
        {reason !== undefined && mine.expanded.includes(whyKey) && (
          <Box paddingLeft={2}>
            <Text dimColor wrap="wrap">
              {reason}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  /** A row of an item's history: an entry, or a fold that opens into its entries. */
  const historyRow = (itemId: string, row: Row) => {
    if (row.kind === 'entry') return logRow(itemId, row.entry, false)
    const foldKey = `fold:${row.key}`
    const isOpen = mine.expanded.includes(foldKey)
    const label = `${stamp(row.entries[0].at)} ${isOpen ? '▾' : '▸'} ${foldText(row.entries, lang)}`
    return (
      <Box key={`box:fold:${itemId}:${row.key}`} flexDirection="column">
        <Button key={`fold:${itemId}:${row.key}`} plain label={label} onPress={() => actions.toggle(foldKey)} />
        {isOpen && row.entries.map(entry => logRow(itemId, entry, true))}
      </Box>
    )
  }
```

`overview` 裡整段

```tsx
                  {historyOf(current, id).map(entry => {
                    const lines = historyLines(entry, current, lang)
                    return ( … )
                  })}
```

換成

```tsx
                  {foldHistory(historyOf(current, id)).map(row => historyRow(id, row))}
```

`cardBox` 的「之前：」那段換成：

```tsx
            {recent.map(row => (
              <Box key={`recent:${card.id}:${row.kind === 'entry' ? row.entry.id : row.key}`} paddingLeft={2}>
                <Text dimColor wrap="wrap">
                  {row.kind === 'entry' ? historyLines(row.entry, current, lang)[0] : `${stamp(row.entries[0].at)} ${foldText(row.entries, lang)}`}
                </Text>
              </Box>
            ))}
```

`hooks/local.ts` 的 `forget` 換成：

```ts
/** An open history row in `expanded`: fold:<entry id> or why:<entry id>. */
const ROW = /^(?:fold|why):(.*)$/

/** Drops what belongs to cards that are resolved or gone, and open history rows whose entry is gone; item ids stay while the item does. */
export function forget(local: Local, plan: Plan): Local {
  const isOpen = (id: string): boolean => Object.hasOwn(plan.cards, id) && plan.cards[id].resolved === undefined
  const keepOpen = (table: Record<string, Pick>): Record<string, Pick> => Object.fromEntries(Object.entries(table).filter(([id]) => isOpen(id)))
  const entries = new Set(plan.applied.map(entry => entry.id))
  const isKept = (id: string): boolean => {
    const row = ROW.exec(id)
    if (row !== null) return entries.has(row[1])
    return Object.hasOwn(plan.cards, id) ? plan.cards[id].resolved === undefined : Object.hasOwn(plan.items, id)
  }
  return { ...local, staged: keepOpen(local.staged), sent: keepOpen(local.sent), expanded: local.expanded.filter(isKept) }
}
```

- [x] **Step 4: 跑測試，確認全過**

Run: `claude plugin test plugins/plan-board` → `132 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board
git commit -m "feat(plan-board): fold step chatter in the history; reasons open on a press"
```

---

### Task 17: 給 AI 的說明、README、版本（spec 15.6、15.7）

**Files:**
- Modify: `plugins/plan-board/hooks/guide.ts`（`GUIDE`）
- Modify: `plugins/plan-board/.claude-plugin/plugin.json`（`version`）
- Modify: `README.md`、`README.zh-TW.md`（「Items and steps」／「項目和步驟」）
- Test: `tests/view.test.ts`

**Interfaces:**
- Consumes: Task 12–16 的工具和 op 名稱：`note`、`add` 的 `status`／`to`／`note`、op 上的 `evidence`、`add_user_action`。
- Produces: 無。

- [x] **Step 1: 寫會失敗的測試**

`tests/view.test.ts`：`guide_names_every_tool` 的名單加 `'add_user_action'`；最後加：

```ts
test('guide_covers_notes_actions_evidence_and_plain_words', () => {
  expect(GUIDE).toContain('action note')
  expect(GUIDE).toContain('never in its title')
  expect(GUIDE).toContain('on the add op itself')
  expect(GUIDE).toContain('on the op that sets status done')
  expect(GUIDE).toContain('add_user_action')
  expect(GUIDE).toContain('plain words')
})
```

- [x] **Step 2: 跑測試，確認失敗**

Run: `claude plugin test plugins/plan-board`
Expected: `guide_names_every_tool`、`guide_covers_notes_actions_evidence_and_plain_words` FAIL。

- [x] **Step 3: 實作**

`hooks/guide.ts` 的 `GUIDE`：

把

```ts
  '- Steps are yours: add, edit, remove, move, assign and set their status with update_step whenever the work changes, without asking. Always give a one-line why.',
  '- Mark a step done only with evidence: the Thoth task id once your Thoth tools show the task passed, otherwise a one-line result.',
```

換成

```ts
  '- Steps are yours: add, edit, remove, move, assign and set their status with update_step whenever the work changes, without asking. Always give a one-line why.',
  "- When adding a step, set its status, assignee (to) and note on the add op itself instead of in a second call.",
  '- Where a step stands or who it waits on goes in its note (update_step, action note), never in its title. The note clears itself when the step is done; a call with only notes needs no why.',
  '- Mark a step done only with evidence, put on the op that sets status done: the Thoth task id once your Thoth tools show the task passed, otherwise a one-line result.',
```

在 `add_decision` 那一行後面加：

```ts
  '- When the user has to do something themselves (run a command in their terminal, approve something, log in), open a card with add_user_action (one line, and the command word for word) instead of only saying it in chat. When they mark it done, check it if you can, then close it with resolve_decision.',
```

在 `'- The ids in the summary are for you; never show them to the user.'` 前面加：

```ts
  "- Every why, card question, item or step title and outcome is read by the user: write it in plain words in the user's language, with no ids and no file or function names they have not used.",
```

`.claude-plugin/plugin.json`：`"version": "0.1.0"` → `"version": "0.2.0"`。

`README.md` 的「Items and steps」：

表格最後一列換成：

```markdown
| Steps: add, reword, remove, move to another item, assign, change status, note where they stand | The AI uses `update_step` | No, but every change is logged with a reason |
```

`- A **step** is the AI's level: …` 那一點換成：

```markdown
- A **step** is the AI's level: one sentence, a status (not started, in progress, done), optionally who it is assigned to, and a note on where it stands or who it waits on. A note is not shown in the change history and clears itself when the step is done. A step is **stuck** while an open card points at it. The AI can add a step already started, assigned and noted in one go.
- A step is marked done only with evidence, given on that one change: a Thoth task id once the AI's Thoth tools show the task passed, or a one-line result the AI reports.
```

（原本的 `- A step is marked done only with evidence: …` 那一點刪掉，由上面第二點取代。）

在 `- A card you answered only with a thought stays open: …` 前面加：

```markdown
- **Action cards** ask you to do something yourself, such as running a command in your terminal: one line, why, and the command. Press **Done** when you have done it; it is sent at once, and the AI checks it if it can and closes the card. Action cards sit with the decision cards, come first, and count in the same number above the prompt ("3 waiting for you"). A step an action card points at shows "waiting for you to: …".
- The change history of an item keeps item changes, cards and direct edits on their own lines. Two or more step changes in a row fold into one line, such as "Steps: 3 done, 2 added", which opens on a press. Reasons are hidden until you press a line.
```

`README.zh-TW.md` 的「項目和步驟」：

表格最後一列換成：

```markdown
| 步驟：新增、改字、刪掉、移到別的項目、改派、改狀態、寫備註 | AI 用 `update_step` | 不用，但每次都記錄原因 |
```

`- **步驟**是 AI 的層級：…` 那一點和下一點換成：

```markdown
- **步驟**是 AI 的層級：一句話、一個狀態（還沒開始、進行中、做完），可以註明派給誰，也可以寫一句備註說現在卡在哪、在等誰。備註不會出現在變動紀錄，步驟做完時自動清掉。有未決的卡片指到某個步驟時，那個步驟就是**卡住**。AI 新增步驟時可以一次設好狀態、派給誰和備註。
- 步驟標做完一定要附證據，而且證據只算在標做完的那一個改動上：AI 的 Thoth 工具看到任務通過之後附上 Thoth 任務 id，或是 AI 回報的一句結果。
```

在 `- 只用想法回答的卡片會繼續開著：…` 前面加：

```markdown
- **待你處理卡**是要你自己動手的事，例如在終端機跑一個指令：一句話、為什麼、要跑的指令。做完按「做好了」，會立刻送給 AI，AI 能查就先查，再結案。待你處理卡和決定卡放在一起、排在最前面，輸入框上方那列合計成「3 件事等你」。待你處理卡指到的步驟會顯示「等你處理：…」。
- 項目的變動紀錄裡，項目的改動、卡片、直接改檔的處理各自一行；連續兩筆以上的步驟變動合成一行，例如「步驟：做完 3 個、新增 2 個」，按了才展開。原因預設收起來，按那一行才顯示。
```

- [x] **Step 4: 跑全部檢查**

Run: `claude plugin test plugins/plan-board` → `133 pass`、`0 fail`。
Run: `claude plugin validate plugins/plan-board --strict` → 沒有錯誤。
Run: `claude plugin validate .` → 沒有錯誤。
Run: `node --test tests-git/merge.test.ts` → `fail 0`。

- [x] **Step 5: Commit**

```bash
git add plugins/plan-board README.md README.zh-TW.md
git commit -m "docs(plan-board): guide, README and 0.2.0 for notes, action cards and folded history"
```

實際做法（2026-10-11）：Task 12–17 合成一個 Thoth 任務 `01M4NTC7MCV0GT8T4RC9QTTFXV`，claude-a／sonnet／high，1 輪約 7 分鐘、6 個 commit（每個 Task 一個，訊息照計畫）。審查（opus，比實作高一階）9 條 AC 全部 met、沒有其他缺陷；Thoth 重跑四條核准檢查全過。合併後 133 個外掛測試、2 個 git 合併測試（Node 24）全過。這台 Linux 是第一次 `thoth init`：四條檢查重新加過、由使用者核准；git 合併測試用 `~/.local/node24/bin/node`，因為 Ubuntu 的 Node 22 不支援直接跑 TypeScript。
