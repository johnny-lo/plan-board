[English](README.md) · **繁體中文**

# plan-board

**Claude Code 的計畫看板：哪些做完、哪個在做、下一個是什麼，一眼看到；要你決定的事，不用離開 Claude Code 就能決定。**

plan-board 是 Claude Code 外掛。有 `plan/log.jsonl` 的 repo 把計畫存在那裡；其他 repo 先存在你的電腦，直到你打 `/plan init`。窗格用總表和決定卡片顯示計畫，輸入框上方一列告訴你幾項進行中、幾個決定等你。計畫只有 AI 能改，而且要透過外掛的工具；每次改動都會記下原因。

## 安裝

在 Claude Code 裡：

```
/plugin marketplace add johnny-lo/plan-board
/plugin install plan-board@plan-board
```

用 `/plan` 打開窗格，或按輸入框上方一列的 **打開**。

## 語言

外掛只有一個設定 `language`：`en`（預設）或 `zh-TW`。安裝外掛時 Claude Code 會問你，之後也可以在外掛的設定裡改。它決定窗格和輸入框上方一列的固定文字。項目名稱、原因、問題是 AI 用你的話寫的，不會翻譯。送給 AI 的說明和訊息一律是英文。

## 計畫放在哪裡

有兩種模式，每次讀計畫時判斷：`plan/log.jsonl` 存在是 **repo 模式**，不存在是**本機模式**。工具、窗格和輸入框上方一列在兩種模式下用法一樣。

- repo 模式的計畫是 repo 根目錄的 `plan/log.jsonl`（根目錄就是 worktree 的 `git rev-parse --show-toplevel`；不是 git repo 就用 session 的目錄）。它是一份紀錄：每次改動一行 JSON，只往後加。總表、卡片和所有狀態都是從紀錄算出來的，沒有另外存「目前狀態」。
- repo 模式第一次寫入時，也會在 `.gitattributes` 加上這一行：

  ```
  plan/log.jsonl merge=union
  ```

  它讓 git 把兩個分支或兩台電腦各自加的紀錄直接合在一起，計畫的 merge 和 rebase 不會衝突。這兩個檔案請跟著其他改動一起 commit。外掛自己不 commit，也不 push。
- 計畫跟著程式碼走：每個分支各一份，feature 分支的進度要合併之後主分支才看得到。
- 本機模式的計畫是同一份紀錄文字，存在外掛在這台電腦上的存放區，以 repo 根目錄分開。它不跟著 git 走，不碰 `.gitattributes`，repo 裡的檔案也不會被建立或修改。總表上會有一行小字說明。
- 只有你能把 repo 改成 repo 模式：在那個 repo 打 `/plan init`。它會建立 `plan/log.jsonl`、把本機的紀錄原封不動搬進去、清掉本機那份，並確認 `.gitattributes` 有上面那一行。外掛的工具和 AI 都不會自己建立 `plan/`；AI 覺得某個 repo 適合放計畫時，會用決定卡片問你要不要打 `/plan init`。`plan/log.jsonl` 已經存在時，`/plan init` 什麼都不改，只會說明。
- 計畫只能透過外掛的工具改。對 `plan/` 底下的檔案用 `Edit` 和 `Write` 會被拒絕。每一行都有檢查碼，所以用別的方式改過的行（終端機、別的工具、你的編輯器）會被標成被直接改過：窗格和輸入框上方一列會提醒你，AI 會被要求看 `git diff -- plan/log.jsonl`，決定保留或丟掉；動到項目時會先問你。
- 窗格上的暫存與送出狀態（還沒送出的選擇、已送出等結案的卡片、展開的項目）只屬於這台電腦，不在 repo 裡。

## 項目和步驟

| 改什麼 | 怎麼改 | 要你點頭嗎 |
|---|---|---|
| 項目：新增、刪掉、拆開、合併、改一句話或目標、改順序 | AI 用 `propose_change` 開提案卡，你選「同意」，AI 再用 `apply_change` 套用 | 要 |
| 項目的狀態 | 沒人改，從步驟算（做完、進行中、下一個、之後） | 不適用 |
| 步驟：新增、改字、刪掉、移到別的項目、改派、改狀態 | AI 用 `update_step` | 不用，但每次都記錄原因 |

- **項目**是你的層級：一句話，加一行「做完的樣子」。項目有順序。
- **步驟**是 AI 的層級：一句話、一個狀態（還沒開始、進行中、做完），可以註明派給誰。有未決的卡片指到某個步驟時，那個步驟就是**卡住**。
- 步驟標做完一定要附證據：AI 的 Thoth 工具看到任務通過之後附上 Thoth 任務 id，或是 AI 回報的一句結果。
- **決定卡片**是 AI 用 `add_decision` 問的問題（2 到 4 個選項，每個附一句選了會怎樣，最多一個標建議），加上上面說的提案卡。卡片會寫出它屬於哪個項目、哪個步驟，為什麼現在問，以及這個項目最近 3 筆變動。會擋住 AI 進度的卡，選了就立刻送出；其他卡先暫存，按一個按鈕一次送出，停止操作 1 分鐘後自動送出，AI 工作中就等這輪結束再送。送出之後卡片變淡，直到 AI 結案。
- 只用想法回答的卡片會繼續開著：選項和想法輸入框都還在，並顯示你的想法，仍然算「等你決定」。用選項回答或略過的卡片才會變淡。
- 窗格上不顯示任何 id。派給 Thoth 任務的步驟顯示成「派給 Thoth 任務」，不顯示任務 id。

## Superpowers

plan-board 和 [superpowers](https://github.com/obra/superpowers) 分工：superpowers 管一件事怎麼做，plan-board 管做到哪、為什麼變。項目可以連上替它寫的 spec 和 plan（從 repo 根目錄起算的路徑）；AI 用 `update_step` 的 `link` 動作連上去，不用你點頭，並且記下原因。展開總表的項目時，每個連上的路徑在「做完的樣子」下面各占一行。plan 寫好後，AI 會把每個 task 加成這個項目的一個步驟，task 做完就把對應的步驟標成做完。plan-board 只存路徑，不讀 superpowers 的檔案。

## Thoth

plan-board 和 [Thoth](https://github.com/johnny-lo/Thoth) 可以一起用，但彼此獨立。plan-board 不讀 Thoth，也不讀任何外部狀態。Thoth 任務通過時，AI 用它自己的 Thoth 工具看到結果，再用 plan-board 的工具寫進計畫。

## 授權

採用 [Apache License, Version 2.0](LICENSE-APACHE) 或 [MIT license](LICENSE-MIT) 二選一授權。
