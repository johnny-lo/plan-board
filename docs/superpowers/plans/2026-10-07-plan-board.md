# plan-board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出 plan-board 這個 Claude Code 外掛：每個 repo 的計畫存成 `plan/log.jsonl`，在窗格裡顯示總表和決定卡，計畫只能由 AI 透過外掛的工具修改。

**Architecture:** 不依賴 Claude Code 的小模組（checksum、replay、view、guide、tools、local、lines、i18n、logfile）負責所有規則，各自寫單元測試。`register.tsx` 只負責接線：事件、工具註冊、寫檔、計時；`pane.tsx` 負責畫面。計畫一律從紀錄重算，不另存狀態。

**Tech Stack:** TypeScript／TSX 的 Claude Code 外掛（hooks module），`claude plugin test`（Bun 風格的測試）、`claude plugin validate`，Node 24 `node --test`（只跑真的 git 合併測試），git。

**Spec:** `docs/superpowers/specs/2026-10-07-plan-board-design.md`。實作前先讀完。本計畫的節號（例如「spec 5.4」）都指這份 spec。

**參考寫法：** Thoth 外掛 `C:\Users\j4503\source\repos\Thoth\plugins\thoth`（`register.tsx`、`i18n.ts`、`tests/panel.test.ts`），以及舊的 decisions mod `C:\Users\j4503\.claude\mods\decisions`（暫存與送出的邏輯、`tests/decisions.test.ts`）。mod API 以 `C:\Users\j4503\thoth-setup\mod-reference\types\claude-code.d.ts` 為準。

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

- [x] **Step 1**：在 Claude Code 執行 `/plugin marketplace add C:/Users/j4503/source/repos/decisions`，再 `/plugin install plan-board@plan-board`，並把 `language` 設成 `zh-TW`。
- [x] **Step 2**：讀 `~/.claude/plugins/store/decisions_inline-*.json`，確認 `items` 是 `[]`。不是空的，就到每張卡所屬的 repo，用新的 `add_decision` 重開。
- [x] **Step 3**：刪掉 `~/.claude/mods/decisions`。
- [x] **Step 4**：在這個 repo 開一個新的 session，確認：窗格打得開；`/plan` 可以用；輸入框上方一列在沒有計畫時不出現；AI 收到的說明是 plan-board 的那一份，而且只有一份。

實際做法（2026-10-10）：Step 2 換裝前剩的是 Thoth 一張新卡，使用者先到 Thoth 回答掉，`items` 變 `[]` 才往下做；原本的 LPC3.0 卡 10/8 已答（先不推，留在本機），不用重開。Step 3 照使用者選的改成搬到 `~/.claude/mods-disabled/decisions`（不刪），另外刪掉 `~/.claude/settings.json` 裡載入它的 `CLAUDE_CODE_PLUGIN_DIRS`。Step 4 四項都過（說明只有一份是用新的 `claude -p` session 查的）；接著用新窗格開的第一張卡也走通了（開卡 → 選擇送回 → `resolve_decision` 結卡）。

---

### Task 11: 換裝後的修正（spec 14）

用 Thoth 派工。行為照 spec 14，測試先寫。

- [x] **Step 1**：本機寫入每次嘗試前重新判斷模式，`plan/log.jsonl` 出現了就改寫進 repo（spec 14.1 A）。
- [x] **Step 2**：`/plan init` 刪本機那份前再確認，多出來的行補進 `plan/log.jsonl`，最多 3 次，還在變就留著本機那份（spec 14.1 B）。
- [x] **Step 3**：`/plan init` 失敗的回覆改用對照表、不帶原始錯誤、照實說做到哪一步（spec 14.2）。

實際做法（2026-10-10）：Thoth 任務 `01M4K1Q2Z5YJGFKH4AWN62XR73`，claude-a／sonnet／high，2 輪。第 1 輪八項要求都過，但退回三點：型別錯誤（`commitText` 多了 `'moved'`）、`/plan init` 補行時整份寫回會蓋掉別的 session 剛加的行、「留著本機那份」和「`.gitattributes` 沒改成」同時發生時回覆沒提後者。第 2 輪三點都修好、各有測試；合併後 112 個外掛測試和 2 個 git 合併測試全過。
