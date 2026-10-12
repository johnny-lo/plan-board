# plan-board 設計

- 日期：2026-10-07
- 狀態：等使用者審閱
- 來源：`docs/brainstorm-2026-10-07.md`（每一段的決定與使用者原話）

## 1. 要解決的問題

使用者的原話：

- 「這種計畫總表，可以是草創一個新的 APP 時使用，也可以是規劃一個大 feature 時使用」
- 「我不用每次一直質問你到底做到哪裡，為什麼每個 scope 隨時在變動」
- 「我之前很常叫你做一個 HTML，只為了讓我知道前因後果好可以讓我做決定，然後我又要 CC 跟 HTML 來回切換跟你說我的決定」
- 「一直額外開一個 APP 好像也很怪」

做到了的樣子：

1. 打開窗格就知道哪些項目做完、哪個在做、下一個是什麼，不用問。
2. 範圍不會悄悄改變：項目層的改動都經過使用者，步驟層的改動都留紀錄，而且紀錄是工具寫的，不靠 AI 記得。
3. 做決定不用離開 Claude Code：卡片自己帶前因後果。

## 2. 不做的事

- 不和 Thoth 合併，也不讀 Thoth 或任何外部狀態。Thoth 的結果由 AI 用它自己的 Thoth 工具看，再用本外掛的工具寫進來。
- 外掛不自己改計畫。計畫只有一個寫入者：AI 透過本外掛的工具。外掛本身只負責顯示、把使用者在窗格上的選擇送給 AI、檢查工具收到的資料。
- 不自己 commit 或 push。計畫檔跟著平常的 commit 走。
- 不用 Linear、不用 Orca 看板、不特別照顧手機（手機上沒有輸入框時，卡片只給選項，跟現在的 decisions mod 一樣）。
- 不寫舊 decisions mod 的搬家程式（見第 10 節）。

## 3. 概念

### 3.1 項目（使用者的層級）

- 一句話（用使用者的話）＋一行「做完的樣子」。
- 有順序。要分階段就拆成幾個項目。
- 狀態不存，顯示時從步驟算：
  - **做完**：至少有一個步驟，而且全部做完。
  - **進行中**：有步驟已經開始（進行中或做完），但還沒全部做完。
  - **下一個**：照順序，第一個還沒開始的項目。
  - **之後**：其餘的。
- 有任何步驟卡住時，項目旁邊顯示 ⚑。

### 3.2 步驟（指揮官的層級）

- 一句話。狀態只有三種會存：還沒開始、進行中、做完。
- 可選：派給誰（自由文字，例如 Thoth 任務 id 或帳號）。
- **卡住**不存：有未決的卡片指到這個步驟，就顯示卡住。
- 標做完一定要附證據來源，二選一：
  - `thoth`：Thoth 任務 id。AI 用自己的 Thoth 工具看到任務 `pass` 之後才這樣標。
  - `result`：AI 寫一句結果。沒有 Thoth 證據的步驟一樣算做完（使用者：「先相信好了」），紀錄寫明來源是 AI 回報。
- 總表上平常收起來，點開項目才看到。

### 3.3 規則

| 改什麼 | 怎麼改 | 要使用者點頭嗎 |
|---|---|---|
| 項目：新增、刪掉、拆開、合併、改一句話或目標、改順序 | AI 用 `propose_change` 開提案卡 → 使用者選「同意」→ AI 用 `apply_change` 套用 | 要 |
| 項目狀態 | 沒人改，從步驟算 | 不適用 |
| 步驟：新增、改字、刪掉、移到別的項目、改派、改狀態 | AI 用 `update_step` | 不用，但每次都記錄 |

### 3.4 決定卡

- **問題卡**：AI 想問使用者的事，用 `add_decision` 開。
- **提案卡**：`propose_change` 開的。選項固定是「同意」「不要」。
- 兩種都可以掛在某個項目、某個步驟上，也可以都不掛（歸在「其他」）。

### 3.5 變動紀錄

每次工具寫入就加一筆，只能往後加。每筆有時間、改了什麼、原因（必填）、來源。總表和卡片都是從紀錄算出來的，沒有另外存一份「目前狀態」。

## 4. 畫面

### 4.1 輸入框上方的一列

```
計畫：2 項進行中 · 1 個決定等你
```

- 有計畫或有未決卡片時才出現。按了打開窗格。
- 計畫被直接改過時，後面加上「· ⚠ 計畫被直接改過」。

### 4.2 窗格

上方兩個按鈕切換兩個畫面：**總表**、**等你決定（數字）**。

總表（點開一個項目）：

```
✓ 舊卡片搬過來
▾ 決定看板 v1 · 進行中
  做完的樣子：總表和卡片都看得到
  ✓ 定檔案格式            Thoth pass
  ● 窗格兩個畫面
  ⚑ 輸入框上方一列        等你決定：要不要顯示做完的數量
  ── 變動紀錄 ──
  10/07 15:20 步驟 拆開「窗格」→「總表」「等你決定」
              原因：兩個畫面可以分開測
  10/07 14:02 項目 新增本項 · 你在「要不要先做決定看板？」選了同意
▸ 設定精靈 · 下一個
▸ 英文文件 · 之後
```

等你決定（最上面那張攤開，其他只顯示問題和位置，點了才展開）：

```
╭ 輸入框上方要不要顯示做完的數量？                    ✕ ╮
│ 決定看板 v1 · 第 2 項 · 卡在「輸入框上方一列」         │
│ 為什麼現在問：一列只放得下兩三件事，做完的數量         │
│ 和「進行中」「等你」搶位置                              │
│ 之前：10/07 拆開「窗格」→「總表」「等你決定」          │
│ 1 不顯示（建議）  一列保持短；做完的在總表看            │
│ 2 顯示            一眼看到進度，但一列會變長            │
│ [或寫下你的想法…]                                        │
╰────────────────────────────────────────────────────────╯
╭ 新增項目「英文文件」？                                 ╮
│ 其他                                                    │
╰────────────────────────────────────────────────────────╯
```

卡片內容：

- 問題（一行）。
- 位置：項目、項目排第幾、卡在哪個步驟。都沒掛就顯示「其他」。
- 為什麼現在問（AI 寫的一到兩句）。
- 之前：這個項目的紀錄裡最近 3 筆（不含這張卡自己）。沒掛項目就不顯示。
- 選項：每個附一句「選了會怎樣」；最多一個標「建議」並附理由。提案卡的「同意」「不要」由外掛產生，「同意」底下列出提案的每一項改動。
- 想法輸入框。

**畫面上不顯示任何編號**（項目、步驟、卡片、紀錄都一樣）。紀錄提到卡片時，引用卡片的問題。

### 4.3 選擇怎麼送給 AI（沿用現在的 decisions mod）

- 會擋住進度的卡（`blocking`）：選了或寫了想法就立刻送出。
- 其他卡：先暫存在窗格上，「送出 N 個決定」按鈕一次送；停止操作 1 分鐘後自動送；AI 正在工作的話，等這輪結束再送。
- 想法和選擇一起暫存、一起送。
- ✕：當成「略過」送給 AI，由 AI 結案。
- 送出之後，卡片變淡，顯示「已送出，等 AI 結案」，直到紀錄裡出現這張卡的結案。外掛自己不結案。
- 暫存的選擇、已送出待結案的卡、展開狀態只屬於這台電腦，存在 `$.store`，以 worktree 根目錄分開。

## 5. 資料

### 5.1 位置

- 計畫跟著程式碼放，每個分支各一份（使用者選的）。後果：每個 worktree 的窗格顯示那個分支知道的計畫；feature 分支的進度合併後主分支才看得到。
- worktree 根目錄 = 在 session 的目錄跑 `git rev-parse --show-toplevel`；不是 git repo 就用 session 的目錄。
- 檔案：`<根目錄>/plan/log.jsonl`。UTF-8、不加 BOM、換行用 LF、一行一筆 JSON。
- 第一次寫入時，工具確認 `<根目錄>/.gitattributes` 有這一行，沒有就加上：

  ```
  plan/log.jsonl merge=union
  ```

  這樣兩個分支或兩台電腦各自加的紀錄，merge 和 rebase 時 git 會直接合在一起，不會衝突。

### 5.1a 沒有 `plan/` 的 repo：存在本機（2026-10-08 加）

使用者選的：只有已經有 `plan/log.jsonl` 的 repo 才把紀錄寫進 repo；其他 repo 存在這台電腦。原因：照原本的設計，AI 在任何 repo 開一張卡，那個 repo 就會多出 `plan/` 並被改 `.gitattributes`，包括別人的 repo。

- **兩種模式**：`<根目錄>/plan/log.jsonl` 存在 = **repo 模式**（照 5.1）；不存在 = **本機模式**。每次讀計畫時判斷，不另存設定。
- **本機模式**：紀錄的文字（格式和 `log.jsonl` 一模一樣，一行一筆、有檢查碼）存在 `$.store` 的 `log:<根目錄>` 底下。讀、寫、重試、檢查碼、重算都沿用同一套程式，只是讀寫的地方不同。本機模式不碰 `.gitattributes`，也不會被別的工具直接改到，所以不會有「被直接改過」的行。
- **工具在兩種模式下都能用**（卡片、項目、步驟都可以）。本機模式的紀錄不跟 git 走，只在這台電腦。
- **只有使用者能把 repo 改成 repo 模式**：在那個 repo 打 `/plan init`。它會建立 `plan/log.jsonl`、把本機已有的紀錄原封不動搬進去（之後清掉本機那份）、確認 `.gitattributes` 有 5.1 那一行。工具和 AI 都不會自己建立 `plan/`；AI 覺得這個 repo 適合放計畫時，用 `add_decision` 問使用者要不要打 `/plan init`。
- `/plan init` 遇到 `plan/log.jsonl` 已經存在時，什麼都不改，只說已經是 repo 模式。
- 給 AI 的摘要第一行寫明目前是哪個模式（`Plan storage: repo (plan/log.jsonl)` 或 `Plan storage: this machine only (run /plan init to keep it in the repo)`）。窗格的總表最上方用一行小字標出本機模式。

### 5.2 一筆紀錄

```json
{"id":"3f9a1c2e7b04","at":"2026-10-07T07:20:31.000Z","kind":"step.status","why":"面板測試全過","basis":{"type":"thoth","task":"01JABC..."},"data":{"step":"a1b2c3d4","status":"done"},"sum":"9c1e0d7a2b4f6e81"}
```

- `id`：12 個十六進位字元，亂數。
- `at`：UTC ISO 時間，取自 `$.clock.now()`，但不早於計畫裡最晚一筆紀錄的 `at` 加 1 毫秒。一次工具呼叫寫入多筆時，依寫入順序每筆再加 1 毫秒，讓重算時的順序和工具檢查時一樣（同一個 `at` 加亂數 id 會把順序打亂）。
- `why`：原因，不能是空字串。
- `basis`：這次改動的依據，四種之一：
  - `{"type":"ai"}`：AI 自己判斷（步驟層的改動）。
  - `{"type":"thoth","task":"<任務 id>"}`：步驟做完，證據是 Thoth 任務。
  - `{"type":"card","card":"<卡片 id>"}`：使用者在這張卡上的選擇。
  - `{"type":"direct-edit"}`：處理被直接改過的紀錄。
- `sum`：檢查碼。把這筆紀錄去掉 `sum` 之後照原本的欄位順序 `JSON.stringify`，取 SHA-256 的前 16 個十六進位字元。它只用來發現「沒經過工具的改動」，不是安全機制。
- 項目、步驟、卡片的 id 都是 8 個十六進位字元的亂數，只給 AI 看。
- 「原始行的雜湊」（第 5.3、5.4 節）：檔案裡那一行原封不動的文字（不含換行）的 SHA-256 前 16 個十六進位字元。

### 5.3 紀錄的種類

| `kind` | `data` |
|---|---|
| `item.add` | `item: {id, title, goal}`，`before?`（放在哪個項目前面；沒有就放最後） |
| `item.remove` | `item` |
| `item.split` | `item`，`into: [{id, title, goal}]`（原項目的步驟全部移到第一個新項目） |
| `item.merge` | `items: [id]`，`into: {id, title, goal}`（步驟依原順序全部移過去） |
| `item.edit` | `item`，`title?`，`goal?` |
| `item.reorder` | `order: [id]`（全部項目的新順序） |
| `step.add` | `item`，`step: {id, title}`，`after?` |
| `step.edit` | `step`，`title` |
| `step.remove` | `step` |
| `step.move` | `step`，`item`，`after?` |
| `step.assign` | `step`，`to`（空字串 = 取消） |
| `step.status` | `step`，`status`（`todo`／`doing`／`done`），`result?`（`done` 且依據不是 Thoth 時必填） |
| `card.open` | `card: {id, type, item?, step?, question, why, options, blocking?, changes?}` |
| `card.resolve` | `card`，`outcome`，`choice?` |
| `edit.keep` | `lines: [原始行的雜湊]`，`summary` |
| `edit.drop` | `lines: [原始行的雜湊]`，`summary` |

- 問題卡的 `options`：`[{label, effect, recommended?, reason?}]`，2 到 4 個，最多一個 `recommended`。
- 提案卡的 `type` 是 `proposal`，`changes` 是一串 `item.*` 改動（上表前六種的 `kind` 和 `data`）；選項由外掛產生，不存。
- 拆開步驟 = 一次 `update_step` 裡寫一筆 `step.remove` 加幾筆 `step.add`，原因相同。

### 5.4 從紀錄算出計畫

1. 讀出每一行，略過空行。
2. 檢查每一行：解析不了、沒有 `sum`、`sum` 對不上的，標成**被直接改過**。被標記的行不參與計算；但如果它的原始行雜湊出現在某筆 `edit.keep` 裡，而且解析得了，就照常參與。出現在 `edit.drop` 裡的行一律不參與，也不再標記。
3. 依 `id` 去重（同一個 id 留第一個）。
4. 依 `(at, id)` 排序，依序套用。
5. 套用不了的紀錄（例如對已經刪掉的項目加步驟，通常是兩個分支合併造成的）就略過，列在給 AI 的摘要裡，不顯示給使用者。

被刪掉的行查不出來；需要時看 git 歷史。

### 5.5 寫入

`$.fs` 沒有 append，所以工具這樣寫：讀檔、記下 `stat`、在後面接上新的行、寫回之前再 `stat` 一次；中間被別的 session 改過就重來，最多 3 次。一次工具呼叫的所有紀錄在同一次寫入裡完成。唯一不是「往後加」的寫入是 `resolve_direct_edit` 的 `drop`：它把被標記的那幾行拿掉，再加上 `edit.drop`，用同樣的重來機制。

## 6. AI 的工具

### 6.1 讀

沒有讀取工具。每一輪外掛用 `prompt.compose` 附上兩段英文文字：

- **說明**：計畫只能用這些工具改，不要直接改 `plan/`；項目層要先提案、等使用者同意再套用；步驟層照常改但要寫原因；步驟的 Thoth 任務 `pass` 了才用 `thoth` 依據標做完，否則寫一句結果；要使用者決定的事用 `add_decision`；被直接改過時的處理方式（6.3、第 7 節）。
- **摘要**：照順序列出項目和狀態；進行中和下一個項目的步驟；未決卡片（id、問題、是否已送出待結案）；被直接改過的行；第 5.4 節第 5 步略過的紀錄。

### 6.2 寫

每個工具成功後都會重新算計畫、更新窗格，並回傳一句結果。

| 工具 | 輸入 | 檢查 | 寫入 |
|---|---|---|---|
| `propose_change` | `question`、`why`、`changes`、`item?`、`blocking?` | `changes` 只能是 `item.*`，引用的 id 要存在 | 一筆 `card.open`（`proposal`） |
| `apply_change` | `card`、`chat?` | 這張卡是未結案的提案卡，而且這台電腦的窗格記錄到使用者對它送出了「同意」，或帶了 `chat`；兩者都沒有就拒絕 | `changes` 裡每一筆（依據 = 這張卡），加一筆 `card.resolve` |
| `update_step` | `ops`、`why`、`evidence?` | 引用的項目和步驟要存在；標 `done` 要有 `evidence.thoth` 或 `evidence.result` | 每個 op 一筆 `step.*` |
| `add_decision` | `question`、`why`、`options`、`item?`、`step?`、`blocking?` | 2 到 4 個選項、最多一個建議、`why` 不能空 | 一筆 `card.open`（`question`） |
| `resolve_decision` | `card`、`outcome` | 卡片存在且未結案；`outcome` 不能空 | 一筆 `card.resolve` |
| `resolve_direct_edit` | `action`（`keep`／`drop`）、`summary`、`card?` | 目前有被標記的行；如果要 `keep` 的行裡有解析得了的 `item.*`，必須帶一張使用者已回覆、並已結案的卡 | 一筆 `edit.keep` 或 `edit.drop`；`drop` 時同時把那些行從檔案裡拿掉 |

- 使用者在對話裡回答、沒在窗格上選（例如直接打「照你的建議」）：AI 把使用者的原話放進 `apply_change` 的 `chat`。依據寫成 `{"type":"card","card":"<卡片 id>","chat":"<原話>"}`，總表的紀錄會顯示這句原話，使用者看得到 AI 憑什麼套用。
- 使用者拒絕提案：AI 用 `resolve_decision` 結案，`outcome` 寫「提案被退」和原因。
- 使用者同意時在想法裡改了內容：AI 用 `resolve_decision` 結掉舊卡，再用 `propose_change` 依使用者的意思重新提案。

### 6.3 擋住直接改檔

外掛用 `tool.call` 攔下內建的寫檔工具（實作時照 `BuiltinToolName` 列出所有會寫檔的工具，至少有 Edit 和 Write），路徑在 `<根目錄>/plan/` 底下就拒絕，並提示改用上面的工具。Bash 擋不到，靠第 5.4 節的檢查碼抓。

## 7. 被直接改過的時候

會發生在：沒裝本外掛的電腦或工具（例如 Codex）、Thoth 派出去的人在 worktree 裡改了再合併回來、使用者手動改檔。

1. 外掛發現被標記的行：輸入框上方一列加 ⚠；窗格上方顯示「計畫被直接改過，等 AI 檢查」；摘要裡告訴 AI。
2. AI 用 git diff 看改了什麼。
3. 只動到步驟或其他紀錄：AI 直接 `resolve_direct_edit`，`keep` 或 `drop`，`summary` 寫改了什麼。
4. 動到項目層：AI 先開問題卡問使用者「留下」還是「還原」（使用者選的），收到回覆後結案，再帶著這張卡 `resolve_direct_edit`。
5. 原本合法的行被改壞了：「還原」時 AI 用 git 把那幾行恢復原樣（檢查碼就會再對上），不用 `drop`。

## 8. 語言

- 外掛設定 `language`：`en`（預設）或 `zh-TW`，跟 Thoth 外掛的寫法一樣（`plugin.json` 的 `userConfig`，加上 `hooks/i18n.ts` 對照表）。
- 對照表只管畫面上的固定文字。項目名稱、原因、問題是 AI 用使用者的話寫的，不翻譯。
- 給 AI 的說明和摘要一律英文。

## 9. 測試

- **單元測試**（不依賴 Claude Code 的小模組）：
  - 每一種 `kind` 的套用。
  - 項目狀態的計算（做完、進行中、下一個、之後、⚑）。
  - 去重、排序、套用不了的紀錄被略過並列出。
  - 檢查碼：工具寫的行通過；改過一個字、手寫的行、解析不了的行被標記；`edit.keep`／`edit.drop` 的效果。
  - 每個工具的檢查（特別是 `apply_change` 沒有「同意」紀錄時拒絕、`update_step` 標做完沒證據時拒絕、`resolve_direct_edit` 動到項目層沒帶卡時拒絕）。
  - 兩張對照表的鍵一樣。
- **外掛測試**（`claude plugin test`）：工具寫出的行；窗格最上面那張卡攤開、其他收起；非 blocking 卡暫存後一起送、1 分鐘自動送、AI 工作中時等這輪結束；送出後的卡顯示「等 AI 結案」；Edit／Write 改 `plan/` 被擋；輸入框上方一列的文字；zh-TW 畫面上沒有任何編號。
- **git 測試**：在暫存資料夾開一個真的 repo，兩個分支各自用工具的寫入函式加紀錄，merge 之後沒有衝突、沒有被標記的行、算出的計畫包含兩邊的改動。
- `claude plugin validate` 通過。

## 10. 換掉舊 decisions mod

查過：`$.store` 是每個外掛各自一份，新外掛讀不到舊的 `~/.claude/plugins/store/decisions_inline-*.json`。但舊 mod 只裝在 Legion，而且 2026-10-07 時裡面沒有卡片。所以不寫搬家程式，換裝步驟是：

1. 在 Legion 裝上 plan-board。
2. 看舊存放區還有沒有卡片；有的話，AI 在對應的 repo 用新的 `add_decision` 重開。
3. 刪掉 `~/.claude/mods/decisions`。兩個外掛都有 `add_decision`，不刪的話 AI 會同時收到兩份說明。

## 11. 名字、repo、授權

- 名字：**plan-board**。
- repo：GitHub `johnny-lo/plan-board`，公開。開之前再跟使用者確認一次。
- 授權：`MIT OR Apache-2.0`，跟 Thoth 一樣。
- README 有英文和 zh-TW 兩份，跟 Thoth 一樣。
- 外掛結構參考 Thoth 的 `plugins/thoth`：`.claude-plugin/plugin.json`、`hooks/`（`hooks.json`、`register.tsx`、`i18n.ts`、邏輯模組）、`tests/`、`types/`。
- 要在 Windows 和 Linux 都能用：路徑一律從 git 的輸出和 `$.session` 拿，不寫死。

## 12. 實作前要先確認的事

這些不改變設計，只影響寫法。實作計畫的第一步就是逐一確認：

- mod 執行環境有沒有 Web Crypto 的 `crypto.subtle.digest`。沒有的話，用一份純 JS 的 SHA-256。
- 窗格切換畫面用按鈕加 `$.state` 做，不依賴分頁元件。
- 輸入框上方一列用 Thoth 外掛已經在用的同一個 API。
- `BuiltinToolName` 裡所有會寫檔的工具名稱。

已知、接受的限制：

- 不同電腦的時鐘有誤差時，幾乎同時寫的紀錄可能排錯順序。
- 被刪掉的紀錄行查不出來。
- 檢查碼擋不住刻意照格式偽造的人；它的用途是發現不小心的直接改檔。

## 13. 換裝前的修正（2026-10-08 加）

使用者在換裝前選的三件事：本機模式（5.1a）、修掉審查留下的 4 個小問題、和 superpowers 的 spec／plan 連起來。

### 13.1 和 superpowers 的 spec／plan 連起來

- 項目多一個欄位 `docs: string[]`（repo 根目錄起算的相對路徑，例如 `docs/superpowers/plans/2026-10-07-plan-board.md`）。
- 新的紀錄種類 `item.link`，`data: { item, doc }`：把一個路徑加進那個項目的 `docs`（已經有就不重複加）。它**不算**項目層的改動（不改一句話、目標或順序），所以不用使用者點頭，由 `update_step` 的新 op `{action: 'link', item, doc}` 寫入，照常記錄原因。
- 總表展開項目時，在「做完的樣子」下面每個路徑一行：`文件：{path}`。
- 給 AI 的說明加上：替某個項目寫 superpowers 的 spec 或 plan 時，用 `link` 把檔案連到項目；plan 寫好後，把每個 task 加成這個項目的一個步驟（標題照抄）；勾掉一個 task 時，把對應的步驟標成做完。superpowers 管「怎麼做」，plan-board 管「做到哪、為什麼變」。

### 13.2 審查留下的 4 個小問題

1. **只寫想法送出的卡要能繼續回答**：沒有選項、只有想法的卡，送出後不變灰；卡片照常顯示選項和輸入框，並多一行 `你的想法：{draft}`；它在輸入框上方一列和 `bandCounts` 裡仍算「等你決定」。有選項或略過的卡才變灰、顯示「已送出，等 AI 結案」。
2. **派給 Thoth 任務時不顯示 id**：步驟的派給對象看起來像 id（26 個字元的 ULID，或 8 個以上的十六進位字元）時，畫面上改成 `派給 Thoth 任務`（英文 `assigned to a Thoth task`），不顯示原字串；給 AI 的摘要照舊顯示原字串。
3. **每個窗格測試都跑 terminal 和 desktop 兩種畫面**（目前 `staged_choice_auto_sends_after_turn_end` 只跑 terminal）。
4. **改名的紀錄顯示舊名字**：`replay` 套用 `item.edit`（有改 `title` 時）和 `step.edit` 時，把改之前的名字記在 `plan.previousNames[紀錄 id]`；紀錄的文字寫成 `改名「{舊}」→「{新}」`。

## 14. 換裝後的修正（2026-10-10 加）

換裝前審查留下、記在 brainstorm「之後再修」的兩個問題。

### 14.1 本機寫入和另一個 session 的 `/plan init` 同時發生

現在會掉紀錄的兩種情況：

- **A：本機寫入沒重新判斷模式。**工具呼叫用讀進來時的模式決定寫哪裡。讀完之後，另一個 session 跑了 `/plan init`：紀錄搬進 `plan/log.jsonl`，本機那份刪掉。這邊的寫入照樣寫 `$.store`，在那裡長出一份只有新紀錄的本機 log。因為 `plan/log.jsonl` 已經在，之後永遠是 repo 模式，那份本機 log 不會再被讀到。
- **B：`/plan init` 刪本機那份前沒確認它沒變。**把本機的文字抄進 `plan/log.jsonl` 之後就直接刪掉本機那份。抄完到刪掉之間，別的 session 寫進本機的紀錄會跟著被刪。

要的行為：

- 本機模式的寫入，**每一次嘗試**在寫之前都重新看 `plan/log.jsonl` 在不在。在的話，這筆寫入改照 repo 模式寫進 `plan/log.jsonl`（包括補 `.gitattributes`），不寫 `$.store`。`plan/log.jsonl` 已經在的時候，絕不在 `$.store` 建立或改寫這個 repo 的本機 log。
- `/plan init` 刪本機那份之前再讀一次。跟抄進去的不一樣，就把多出來的行補進 `plan/log.jsonl`：`plan/log.jsonl` 裡已經有的行不重複加，原本的行都留著（跟 git 的 `merge=union` 同一個意思）。補完再確認一次，最多 3 次。
- 3 次都還在變：不刪本機那份，回覆「計畫已搬進 `plan/log.jsonl`，但這段時間別的 session 一直在寫本機那份，所以本機那份先留著沒刪」（英文版同義）。`.gitattributes` 照常補。
- 不加跨 session 的鎖：「重新看」和「寫」之間仍有極短的空檔，接受。

### 14.2 `/plan init` 失敗的回覆

現在是寫死的英文 `Could not create plan/log.jsonl: {原始錯誤}`。改成：

- 文字從對照表拿，照 `language` 回英文或中文，不帶原始的系統錯誤文字。
- 照實說做到哪一步：
  - `plan/log.jsonl` 沒建成：說沒建成、什麼都沒改、計畫還在這台電腦。
  - `plan/log.jsonl` 建成了，之後的步驟出錯（例如刪本機那份失敗）：說計畫已搬進 `plan/log.jsonl`，本機那份還留著。
- 給 AI 的錯誤（工具呼叫的 `deny`）不在這次範圍，照舊英文。

## 15. 試用回饋（2026-10-11 加）

試用時 AI 回報了五個不順的地方。使用者選的：

- 步驟備註寫進 log、跟著 git 走，但變動紀錄不顯示。
- 「待你處理」卡和決定卡放在同一個分頁，輸入框上方那列合計一個數。
- 變動紀錄只在項目裡收，總表最上面不加「最近」那段。

其餘照回饋的建議。本節改動第 3.2、3.4、4.1、4.2、5.3、6.1、6.2、6.3 節。

### 15.1 步驟備註

回饋：步驟沒有「現在卡在哪」的欄位，AI 只好拿標題當狀態，改一次就多一筆紀錄，標題也一直變。

- 步驟多一個欄位 `note?: string`。
- 新的紀錄種類 `step.note`，`data: { step, note }`。`note` 是空字串 = 清掉備註。步驟不存在 → 略過，跟其他 `step.*` 一樣。
- 步驟標成做完（`step.status` 的 `status` 是 `done`，或 15.3 新增時就是 `done`）時，備註自動清掉。改成 `todo`、`doing` 不動備註。
- `update_step` 新的 op：`{action: 'note', step, note}`。
- 一次呼叫的 op 全部是 `note` 時，`why` 可以不給：每筆紀錄的 `why` 就用備註的內容，清掉備註時寫 `note cleared`。只要有一個 op 不是 `note`，`why` 照舊必填。
- 顯示：
  - 總表的步驟那一行，在派給誰後面用淡色字顯示備註。
  - 給 AI 的摘要，步驟那一行加上 `, note: {note}`。
  - **不出現在變動紀錄**：重算時 `step.note` 不收進 `itemLog`，所以項目的變動紀錄和卡片的「之前：」都看不到它。
- 備註不算項目層的改動：被直接改過的 `step.note` 行由 AI 自己 `keep` 或 `drop`，不用開卡。

### 15.2 待你處理卡

回饋：要使用者動手、但不用選的事（例如「在終端機跑 `thoth checks approve`」）沒有對應的卡片。`add_decision` 一定要 2 到 4 個選項，AI 只好寫在對話裡。

- 卡片多一種 `type`：`action`。`card.open` 的 `card` 是 `{id, type: 'action', item?, step?, question, why, options: [], command?}`。
  - `question` 放要使用者做的那一句話。沿用這個欄位，名稱表、位置、紀錄的程式就不用分兩套。
  - `command`：可選，要執行的指令原文。
  - 不存 `blocking`：這種卡的回覆一律立刻送出（見下）。
- 新工具 `add_user_action`：

  | 輸入 | 檢查 | 寫入 |
  |---|---|---|
  | `action`（一句話）、`why`、`command?`、`item?`、`step?` | `action`、`why` 不能空；給了 `command` 就不能空；項目和步驟要存在，步驟要在那個項目裡 | 一筆 `card.open`（`action`） |

- 結案用 `resolve_decision`，說明改成「結掉決定卡或待你處理卡」。`apply_change` 遇到不是提案的卡，錯誤訊息改成「這張卡不是提案，用 resolve_decision 結案」（英文）。
- 窗格，和決定卡在同一個分頁：

  ```
  ╭ 在終端機跑 thoth checks approve                       ✕ ╮
  │ 照試用回饋改 plan-board · 第 2 項 · 卡在「實作」        │
  │ 為什麼：新的檢查要人核准才會跑                          │
  │ 指令：thoth checks approve                              │
  │ 1 做好了                                                │
  │ [或寫下你的想法…（立即送出）]                            │
  ╰────────────────────────────────────────────────────────╯
  ```

  - 「為什麼：」不是「為什麼現在問：」。沒有「之前：」。
  - 「做好了」、✕、送出想法都**立刻**送給 AI，不暫存，跟 `blocking` 的決定卡一樣。最上面那張的「做好了」熱鍵是 `1`。
  - 按了「做好了」或 ✕ 之後，卡片變淡，顯示「已送出，等 AI 確認」。只送了想法的卡照 13.2 第 1 點，維持可以回答。
  - 卡片沒有執行指令的按鈕，只顯示指令文字。原因：像 `thoth checks approve` 這種指令，Thoth 規定只能由人在終端機執行。
  - 手機上沒有輸入框，只有「做好了」和 ✕。
- 送給 AI 的文字（英文）：
  - 做好了：`Done by the user: "{question}" [{id}]. Check it if you can, then resolve the card with resolve_decision.`
  - 略過、只有想法：沿用現在決定卡的說法。
- 排序：未結案的卡裡，待你處理卡排在最前面；其他照現在的規則（`blocking`、項目順序、開卡時間）。
- 分頁按鈕改成「等你（N）」（英文 `Waiting for you (N)` 不變）。輸入框上方那列改成「計畫：{doing} 項進行中 · {waiting} 件事等你」（英文 `Plan: {doing} in progress · {waiting} waiting for you`）。`waiting` 照舊是還沒回覆的未結案卡片，兩種卡合計。沒有卡時的「目前沒有待你決定的事」改成「目前沒有等你的事」。
- 步驟：有未結案的待你處理卡指到它時，一樣顯示 ⚑，右邊寫「等你處理：{question}」（英文 `waiting for you to: {question}`）。決定卡照舊寫「等你決定：…」。
- 變動紀錄：開卡寫「卡片 請你「{question}」」（英文 `Card asked you to "{question}"`）；結案照舊。
- 給 AI 的摘要：未結案卡片那一行的類型寫 `{action}`，其餘照舊。

### 15.3 新增步驟時一起設定

回饋：新增步驟時不能同時設狀態和派給誰，要再呼叫一次，又多兩筆紀錄。查過：新步驟的 id 是工具產生的，同一次呼叫的其他 op 指不到它，所以現在一定要分兩次呼叫。

- `update_step` 的 `add` op 多四個可選欄位：`status`、`to`、`note`，以及 15.4 的 `evidence`。
- 仍然只寫**一筆** `step.add`，`data` 多四個可選欄位：`status?`、`to?`、`note?`、`result?`。
  - `status` 是 `done` 時要有 `evidence`（15.4），`result` 和依據的規則跟 `step.status` 一樣。
  - `status` 是 `done` 又帶 `note` → 拒絕：做完的步驟沒有備註。
  - `to` 是空字串，等於沒給。
- 重算：一次設好標題、狀態、派給誰、備註、證據。
- 變動紀錄：`新增「{step}」到「{item}」（{狀態}、{派給誰}）`，括號裡只列有給的；狀態是 `todo` 不列。英文同義。
- 回給 AI 的結果，例如：`Added step {id} to item {item} (doing, assigned to {to}).`
- 舊版外掛：讀到這種 `step.add` 會忽略多出來的欄位，步驟顯示成還沒開始、沒派給誰；`step.note` 和 `action` 卡會被略過，列在給 AI 的「略過的紀錄」。外掛更新後就對了。`plugin.json` 的版本改成 `0.2.0`。

### 15.4 證據跟著動作走

回饋：一次呼叫裡有好幾個動作時，看不出 evidence 掛在哪一個。查過，這是 bug：

- 帶 `evidence.thoth` 的那次呼叫，裡面**每一筆**紀錄的依據都是 Thoth，改名、新增也顯示「Thoth pass」。
- 帶 `evidence.result` 時，同一次呼叫裡標成 `doing`、`todo` 的紀錄也存了 `result`。

改成：

- `evidence` 從整次呼叫移到 op 上：`{action: 'status', step, status: 'done', evidence: {thoth} 或 {result}}`；15.3 的 `add` 一樣。
- 標 `done` 的 op 自己沒有 `evidence.thoth` 或 `evidence.result` → 拒絕（空白字串算沒有，跟現在一樣）。
- `evidence` 寫在不是標 `done` 的 op 上 → 拒絕：`evidence goes only on an op that sets status done`。
- 整次呼叫還帶 `evidence` → 拒絕：`evidence now goes on the op that marks the step done: ops[i].evidence`。
- 依據：只有帶 `evidence.thoth` 的那一筆是 `{type: 'thoth', task}`，同一次呼叫的其他紀錄都是 `{type: 'ai'}`。`result` 只存在標 `done` 的那一筆。
- 已經寫進 log 的舊紀錄不改（只能往後加）。

### 15.5 變動紀錄收合

回饋：步驟的瑣事（改名、指派、doing→done）把使用者層級的變動淹掉；原因太長。

- 紀錄分兩類：
  - **步驟瑣事**：`step.add`、`step.edit`、`step.remove`、`step.move`、`step.assign`、`step.status`、`item.link`。
  - **其他**，照舊每筆一行：`item.*`（`item.link` 除外）、`card.open`、`card.resolve`、`edit.keep`、`edit.drop`。
  - `step.note` 不顯示（15.1）。
- 項目展開後的變動紀錄（新的在上），連續 2 筆以上的步驟瑣事合成一行：

  ```
  10/11 14:40 ▸ 步驟：新增 4 個、開始 1 個
  ```

  - 時間是這一段裡最新那筆的時間。
  - 數量依序是：新增、做完、開始（`doing`）、改回還沒開始（`todo`）、改名、刪掉、移動、改派（含收回）、連上文件；是 0 的不列。英文 `Steps: 4 added, 1 started`，其餘是 `done`、`back to not started`、`renamed`、`removed`、`moved`、`reassigned`、`docs linked`。`step.add` 帶了狀態也只算「新增」。
  - 按了展開成一筆一行（往右縮排），再按收起來。展開狀態用這一段**最舊**那筆的 id 記，所以之後有新的步驟瑣事接上來，已經展開的不會被收起來。
  - 只有 1 筆的步驟瑣事照常一筆一行。
- 原因預設收起來：每一行（包括展開後的每一筆）按一下，底下才多出「原因：…」，再按收起來。合成的那一行本身沒有原因。
- 卡片的「之前：」：取收合之後的最近 3 行，合成的一行算一行、不能展開，一樣不顯示原因。
- 展開狀態跟現在一樣存在 `$.store` 的本機窗格狀態；對應的紀錄不在了（例如被 `drop`），就忘掉。

### 15.6 給 AI 的說明

加上這幾條：

- `why`、卡片的問題、項目和步驟的標題、結案的 `outcome` 都是寫給使用者看的：用使用者的語言和白話，不放 id，也不放使用者沒用過的檔名或函式名稱。
- 步驟「現在卡在哪、在等誰」寫在 `note`，不要改標題；做完時備註會自己清掉。
- 新增步驟時，狀態、派給誰、備註直接寫在 `add` 上。
- 證據寫在標做完的那個 op 上。
- 要使用者自己動手的事（在終端機跑指令、核准、登入），用 `add_user_action` 開卡，不要只寫在對話裡。使用者回「做好了」之後，能查就先查，再結案。

擋住直接改檔時的提示（6.3）也列進 `add_user_action`。

### 15.7 測試與文件

- 單元測試：
  - `step.note`：寫入、清掉、標做完自動清掉；不進 `itemLog`；摘要有 `note`。
  - `update_step`：只有 `note` 時 `why` 可以省；混了其他 op 就必填。
  - `add` 帶 `status`、`to`、`note`、`evidence` 只寫一筆；`done` 沒證據拒絕；`done` 帶 `note` 拒絕。
  - 證據：Thoth 依據只落在標做完的那一筆；整次呼叫帶 `evidence` 拒絕；不是標 `done` 的 op 帶 `evidence` 拒絕；`doing` 的紀錄沒有 `result`。
  - `add_user_action` 的檢查與寫入；`resolve_decision` 結得掉它；`apply_change` 拒絕它。
  - 卡片排序：待你處理卡在最前面。
  - 收合：連續瑣事合成一行、數量的文字（兩種語言）、只有 1 筆不合、`item.link` 算瑣事、`step.note` 不出現、卡片的「之前：」用收合後的行。
  - 兩張對照表的鍵一樣（既有測試）。
  - 舊格式（沒有新欄位）的 log 重算出的計畫跟現在一樣。
- 外掛測試，terminal 和 desktop 都跑（13.2 第 3 點）：
  - 待你處理卡：顯示指令；「做好了」和 ✕ 立刻送出；送出後顯示「已送出，等 AI 確認」；步驟顯示「等你處理：…」；輸入框上方那列合計兩種卡。
  - 備註顯示在步驟後面，不出現在變動紀錄。
  - 合成的一行按了展開；每一行按了顯示原因，再按收起來。
  - zh-TW 畫面上沒有任何編號：既有測試加上待你處理卡和合成的一行。
- 文件：README 英文和 zh-TW 兩份的「Items and steps」照本節更新（備註、待你處理卡、新增時一起設定、證據跟著動作、紀錄收合）。

## 16. 跨 repo 的步驟、想法也要結案（2026-10-12 加）

兩件事：

- 使用者在 Orca 用 `C:\Users\j4503\repos` 本身開 session，一個 session 管所有相關的 repo。那個資料夾不是 git repo，外掛已經用本機模式（5.1a）給它一份計畫，所以「計畫放哪裡」不用改，也不需要工作區檔。缺的是：看不出每一步在哪個 repo 做，總表也看不出一件事在各 repo 做到哪。
- 只送想法的卡一直掛著（13.2 第 1 點的設計）：AI 在對話裡回了，卡片還算「等你決定」。使用者要的是卡片一律被消化，沒回答到就開新卡。

使用者選的：

- repo 標在步驟，不標在項目；項目列從步驟算出各 repo 的進度。
- 畫面顯示短名；短名由 AI 取、記在計畫裡，使用者要改就跟 AI 說。
- 送出想法的卡一律由 AI 結案；想法沒回答到問題，就依想法開一張新卡。

本節改動第 3.2、3.3、3.4、4.2、5.3、6.2、13.2、15.2 節。

不做：從 session 自動推出它管哪些 repo（mods API 的 `$.session` 沒有列出 `/add-dir` 目錄的方法）、檢查 repo 資料夾存不存在、工作區檔、項目層的 repo 欄位。

### 16.1 步驟標 repo

- 步驟多一個欄位 `repo?: string`：步驟在哪個 repo 做，寫那個 repo 的資料夾名（例如 `auth-center`、`post_backend_eruncard`）。Orca 的 worktree 路徑（`orca/workspaces/auth-center/…`）裡也是同一個名字。外掛只當它是一段文字，不檢查資料夾。
- 新的紀錄種類 `step.repo`，`data: { step, repo }`。`repo` 是空字串 = 不標 repo。步驟不存在 → 略過，跟其他 `step.*` 一樣。
- `step.add` 的 `data` 多一個可選欄位 `repo?`；空字串等於沒給（同 15.3 的 `to`）。
- `update_step`：
  - 新的 op `{action: 'repo', step, repo}`。`repo` 先去頭尾空白；空字串 = 不標。
  - `add` op 多一個可選欄位 `repo`。
- 兩種模式都能用。給 AI 的說明寫明：session 同時動到好幾個 repo 時才標；只管一個 repo 的計畫不標。
- 被直接改過的 `step.repo` 行由 AI 自己 `keep` 或 `drop`，不用開卡（跟 `step.note` 一樣）。

### 16.2 短名

- 計畫多一張對照表 `repoNames: Record<資料夾名, 短名>`，從紀錄算出來。
- 新的紀錄種類 `repo.name`，`data: { repo, name }`。`name` 是空字串 = 拿掉短名，回到顯示資料夾名。
- `update_step` 新的 op `{action: 'repo_name', repo, name}`，兩個都先去頭尾空白：
  - `repo` 不能空。
  - `name` 已經是另一個資料夾的短名 → 拒絕：`short name {name} is already used by {other}`。兩個 repo 同名會分不出來。
  - 同一次呼叫可以先 `repo_name` 再 `add`／`repo`，順序不限：短名不依賴步驟。
- 不是項目層的改動：不用使用者點頭，照常記錄原因。它不指到任何項目或步驟，所以不進任何項目的變動紀錄；被直接改過時由 AI 自己 `keep` 或 `drop`。
- 顯示一律用短名，沒有短名才顯示資料夾名（下面寫成 `{repo}`）。給 AI 的摘要兩個都有。
- 給 AI 的說明：第一次替某個 repo 標步驟時，同一次呼叫用 `repo_name` 取一個使用者認得的短名（幾個字，例如 `ERC後端`）；之後照摘要裡的名字用，不要另取。

### 16.3 畫面

- **總表的項目列**：項目裡只要有一個步驟標了 repo，就在狀態後面接每個 repo 的「做完/總數」，順序照步驟在項目裡第一次出現的先後；沒標 repo 的步驟不算進去。淡色字。

  ```
  ▸ ERC 改接 auth-center · 進行中 · auth-center 2/3 · ERC後端 1/4
  ```

  英文同樣是 `· {repo} {done}/{total}`。太長就換行，不截斷。
- **展開後的步驟那一行**：有 repo 時，淡色的 `{repo} · ` 放在標題前面，其餘照舊（派給誰、備註、證據在後面）。

  ```
  ◐ auth-center · 改 token 驗證　派給 Thoth 任務
  ```

- **卡片的位置那一行**（決定卡、提案卡、待你處理卡）：卡片指到的步驟有 repo 時，在「卡在「{step}」」後面加 `（{repo}）`；英文 `stuck at "{step}" ({repo})`。
- **變動紀錄**：
  - `step.add` 的括號尾巴多列 repo：`新增「{step}」到「{item}」（進行中、{repo}）`。
  - `step.repo`：`「{step}」標成 {repo}`，清掉時 `「{step}」不標 repo`；英文 `Tagged "{step}" with {repo}`、`Untagged "{step}"`。
  - 紀錄裡的 repo 一律用**現在的**短名。
  - `step.repo` 算步驟瑣事（15.5）。合成那一行的數量，接在「改派」後面、「連上文件」前面：`改標 repo {n} 個`；英文 `{n} retagged`。
- **給 AI 的摘要**：步驟那一行加上 `, repo: {資料夾名} ({短名})`，沒有短名就只寫資料夾名。有任何短名時，摘要多一行 `Repo names: {資料夾名} = {短名}, …`。
- 輸入框上方那一列不變。

### 16.4 想法也要結案

改掉 13.2 第 1 點和 15.2 裡「只送了想法的卡維持可以回答」：

- 只送了想法的卡，跟選了選項一樣變淡：決定卡和提案卡顯示「已送出，等 AI 結案」，待你處理卡顯示「已送出，等 AI 確認」。底下照舊多一行 `你的想法：{draft}`。
- 它不再算「等你決定」：輸入框上方那一列、分頁的數字、`bandCounts` 都不算它。步驟的 ⚑ 照舊，直到 AI 結案。
- 送出的時機不變：`blocking` 的決定卡和待你處理卡立刻送；其他照 4.3 暫存、一起送。
- 送給 AI 的文字（英文）：
  - 只有想法：`My thoughts on "{question}" [{id}]: {draft}` 後面改成 `(Settle this card now: if this answers it, resolve the card with that outcome; if it does not, resolve it and open a new card that takes the thought into account.)`
  - 一次送好幾張時，結尾那句改成：`(Close every card here now: resolve_decision, or apply_change for an approved proposal. When a thought does not answer a card, resolve it and open a new card that takes the thought into account.)`
  - 給 AI 的摘要裡，送了想法還沒結案的卡寫成 `(the user answered with a thought; settle this card now)`。
- 提案卡只送想法：想法是同意 → `apply_change`，`chat` 帶使用者的話；改了內容或不同意 → 結案，需要的話依想法重新提案（6.2 原本的規則）。
- 給 AI 的說明加一條：使用者用想法回答的卡，當下就要結案；沒回答到問題，結案後依想法開一張新卡，問題和選項要反映使用者寫的，不要只在對話裡回。

### 16.5 測試與文件

- 單元測試：
  - `step.repo`：標上、清掉、步驟不存在略過；`add` 帶 `repo` 只寫一筆；空字串等於沒給。
  - `repo.name`：取名、拿掉、同名拒絕；重算出 `repoNames`。
  - 項目列的 repo 進度：順序照第一次出現、只算有標的步驟、做完數。
  - 摘要有 `repo` 和 `Repo names`；顯示用短名、沒短名用資料夾名。
  - 收合：`step.repo` 算瑣事，「改標 repo」的文字（兩種語言）。
  - 舊格式（沒有新欄位）的 log 重算出的計畫跟現在一樣。
  - 只有想法的訊息文字、一次送好幾張的結尾句。
- 外掛測試，terminal 和 desktop 都跑：
  - 步驟那一行有短名；項目列有各 repo 進度；卡片位置那一行有 repo。
  - 只送想法的卡變淡、顯示「已送出，等 AI 結案」和「你的想法：…」，輸入框上方那一列不算它。
  - zh-TW 畫面上沒有任何編號：既有測試加上 repo 和短名。
- 舊版外掛：讀到 `step.repo`、`repo.name` 會略過，列在給 AI 的「略過的紀錄」；`step.add` 多出來的 `repo` 會被忽略。外掛更新後就對了。`plugin.json` 的版本改成 `0.3.0`。
- 文件：README 英文和 zh-TW 兩份的「Items and steps」照本節更新（步驟標 repo 和短名、想法一律結案）；「計畫放在哪裡」加一句：一個 session 管好幾個 repo 時，從這些 repo 的上層資料夾開 session，就是那個資料夾的一份本機計畫。
