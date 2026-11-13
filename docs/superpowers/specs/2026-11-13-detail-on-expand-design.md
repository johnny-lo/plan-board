# 點開就看得到解釋：設計

- 日期：2026-11-13
- 狀態：Johnny 已同意，可開工
- 來源：Johnny 的原話與決定（第 1、5 節）；`docs/superpowers/specs/2026-10-07-plan-board-design.md`（下稱「原設計」）
- `檔案:行號` 以 0.4.2（`3fb1e29`）為準，在 `plugins/plan-board/` 底下；d.ts 見 3.2。

## 1. 要解決的問題

Johnny 的原話：

- 「有時候模型不會乖乖開卡，或是還是會把細節寫在html裡面，我有點想要如果滑鼠點進去，或是點開來的細節可以有更多解釋」

他挑的做法：每個步驟、每個選項多一段「細節」，AI 寫入時填，平常收著，點開才展開。範圍是步驟、卡片的選項、變動紀錄三種。

做到了的樣子：在窗格裡點開就讀得到夠多的解釋，不用另外去開規格的 HTML。

## 2. 要做、不做、反目標

要做：第 6 到 10 節。

不做：

- **不改配色和版型。**細節用現有樣式（縮排、淡色字）。整套新外觀是接在這件之後的另一個項目「介面翻新」，到時才把細節換成有底色的面板。留給它的接點：細節區塊和開關各是 `pane.tsx` 裡的**單一元件**（`detailBlock`、`detailToggle`），翻新時只換這兩個。
- 不在窗格顯示規格（第 4 節的 b）；不解析 markdown、不翻譯；使用者不在窗格改細節；不替舊紀錄補細節。

反目標（技術上能動，但算失敗）：

- AI 把細節寫成空話（「完成這個步驟」）或照抄標題；原因都跑進細節、`why` 變空話。
- 細節蓋過標題：總表收起時列數變多；卡片多出不只一列。
- 舊 log 讀不出來、算出的計畫變了，或舊版把新版的行標成被直接改過。
- 點開、收起改到 `plan/log.jsonl`；舊資料出現空的「▸ 細節」；細節裡有 id、使用者沒用過的檔名函式名。

## 3. 限制

### 3.1 log 只能往後加、有檢查碼；新舊版本會同時讀寫

紀錄寫了就不改（原設計 5.5）。別的 worktree、Thoth worker、別台電腦的舊版會讀寫同一份 log。0.4.2 讀到新版的行：

| 新版寫的 | 舊版的行為 | 依據 |
|---|---|---|
| 已有種類的 `data` 多 `detail` | 檢查碼照過：雜湊的是解析出來、去掉 `sum` 的整個物件。形狀檢查只看要的欄位，套用時忽略多的 | `checksum.ts:29-31`、`replay.ts:57-70`、`91-103`、`218-231`、`294-299` |
| 最外層多 `detail` | 照過：`wellFormed` 只看六個必要欄位 | `replay.ts:353-363` |
| 新種類 `step.detail` | `unsupported kind`，進 `skipped`，摘要每筆各一行；**不**標成被直接改過 | `replay.ts:127-128`、`313-314`、`409-411`、`guide.ts:75-78` |
| 舊版寫入 | 接新行、整份寫回，只拿掉它認定被直接改過的行 | `logfile.ts:119-131`、`tools.ts:423-426` |

結論：**相容**，舊版窗格看不到細節。代價：舊版 session 的摘要每輪把每筆 `step.detail` 各列一行，log 只增不減，會累積到每台開這個 repo 的電腦都更新外掛為止。

不能改用既有種類帶細節：每種步驟紀錄都有舊版一定會套用的值。`step.edit` 必須有 `title`（`replay.ts:104-105`），舊版照套（`232-239`）並收進變動紀錄（`416`），使用者會看到「改字成…」、收合算「改名」（`lines.ts:103-106`、`174-175`）；它帶著當時的標題，merge 後依時間排序（`replay.ts:398`）會蓋掉別的分支的改名。`note`、`assign`、`status`、`repo` 同理。所以保留 `step.detail`。

可以接受：雜訊只給 AI 看；新步驟的細節在 `step.add` 裡，`step.detail` 只用來補舊步驟和換細節；說明要 AI 接著要做那一步才補、一次寫完整；原設計 15.3、16.5 接受過同樣情況。

新版寫入的檢查碼照固定欄位算（`checksum.ts:10-17`）：`sumOf`、`sealEntry` 都要加最外層的 `detail`，放 `data` 後面。沒有時是 `undefined`，`JSON.stringify` 略過，舊紀錄的檢查碼不變。

### 3.2 畫在 terminal、兩種語言

- 寬度：窗格只在 fullscreen、terminal 110 欄以上時停靠在旁邊，最寬 terminal 的 45%、最窄 24 欄，否則畫在輸入框上方（引擎型別檔 `claude-code.d.ts:8069-8080`、`1822-1823`，下稱 d.ts）。plan-board 沒要寬度（`register.tsx:312`）、沒讀 `bodyColumns`（`pane.tsx:80`）。停靠時常見 49-59 格。中文一字 2 格（`lines.ts:7-24`）。想法輸入框只有一行（`pane.tsx:79`）：細節只讀。
- 按鈕用滑鼠點。鍵盤：窗格拿到鍵盤（`ctrl+x tab` 或點一下）後，Tab 走過各元素、Enter 按下、`hotkey` 按對應的按鈕（d.ts:1109、1134-1143、11477-11478）。
- 「細節」「選項細節」加進 `i18n.ts` 兩張表；細節不翻譯（原設計第 8 節）；給 AI 的文字用英文。

## 4. 做法比較

- **a（選）每個步驟、選項、紀錄加細節欄位**：三種範圍都蓋到，沒規格的項目、本機模式也有；代價是 AI 多寫、log 變大、可能寫空話。
- **b 點項目時顯示它連結的規格段落**：AI 不用多寫；但卡片和紀錄沒有對應段落、很多項目沒規格、規格寫給實作的人、要在 terminal 畫 markdown，而痛點正是「細節寫在 HTML」。
- **c 兩者都做**：兩份成本，b 的問題還在。

選 a：Johnny 挑的，也只有它蓋得到卡片和紀錄。a 不夠時 b 可以之後獨立加。

## 5. 決定（Johnny 已確認）

主對話草擬、Johnny 整份確認；條首的標記說明那一條的來源。

1. 〔補充〕**步驟的細節**：新增步驟時必填；既有步驟可以之後補（新的 op `detail`）。理由：新增當下最懂前因後果，舊步驟一次補齊太貴。補充：只能換、不能清空；補細節不進變動紀錄（同備註，原設計 15.1）。
2. **卡片**：每個選項的細節必填；卡片已有「為什麼現在問」，不另加整張卡的細節。待你處理卡加一段細節（為什麼要你做、做完會怎樣），必填。理由：選項是做決定的地方。
   - 〔Johnny 已定（2026-11-13）〕**提案卡**：`propose_change` 收一段**選填**的 `detail`，當「同意」的細節（同意之後計畫會變怎樣），只在一行「為什麼」講不完時寫；帶了照其他細節的規則檢查、`apply_change` 抄到它寫的每一筆，沒帶就不顯示、不抄。
3. 〔補充〕**變動紀錄**：每筆已有一行「為什麼」，再加一段選填的細節，只在一行講不完時寫。理由：必填只會逼出空話。參數見 7.3。
4. 〔改：主對話定的數字〕**細節是純文字**，可換行，不解析 markdown。上限 **400 格、8 行**（約 200 個中文字或 400 個英文字母），用 `lines.ts:20-24` 算格數。理由：停靠的窗格常見只有 49-59 格（3.2），扣掉框線和縮排，600 格會排到 14-17 列，超過一屏；用格數算，兩種語言佔的畫面差不多。超過就**拒絕**不截斷：截斷會默默丟字。
5. **沒有細節的舊資料**：不顯示「細節」那一列，不顯示空的展開鈕。理由：不該有點了沒東西的按鈕。
6. **展開狀態只存在看的人這邊**（本機的 `$.store`），不寫進 `plan/log.jsonl`。理由：看不是計畫的變動。
7. **給 AI 的規則文字要改**：講清楚標題、「現在卡在哪」的 note、細節三者各放什麼；明講解釋要寫進細節，不要只寫在規格或 HTML；細節用使用者的語言、白話、不放 id 和使用者沒用過的檔名函式名。見第 10 節。理由：工具只擋得住格式。
8. **這件不改配色和版型**，細節用現有樣式；給「介面翻新」的接點見第 2 節。理由：兩件分開，這件可以先試用。
9. 〔新增，主對話定〕**細節不准含計畫 id 的比對**：只比目前計畫裡真的存在的 id；整個詞比對（前後不是英數字或底線才算）；短於 6 個字元的 id 不比。理由：AI 可以自己取項目 id，像 `docs` 這種普通字不該擋掉正常句子。
10. 〔新增，主對話定〕**多行顯示**：照換行拆成多列，每列一個 `Text`（`wrap="wrap"`），空行畫成只有一個空白的 `Text`；不靠 `Text` 自己處理 `\n`。理由：型別檔沒寫 `Text` 怎麼處理 `\n`，只列了 `wrap` 的值（d.ts:14132）。

## 6. 資料

| 哪裡 | 新欄位 | 說明 |
|---|---|---|
| `step.add` 的 `data` | `detail?` | 新增時的細節 |
| 新種類 `step.detail` | `data: { step, detail }` | 補上或換掉；步驟不存在 → 略過；不進 `itemLog`（同 `step.note`，`replay.ts:415`） |
| `card.open` 的 `card.options[i]` | `detail?` | 選項的細節 |
| `card.open` 的 `card` | `detail?` | 只有 `action`、`proposal` 卡 |
| 紀錄最外層 | `detail?` | 變動紀錄的細節，和 `why` 並排，算進 `sum`（3.1） |

- 型別（`types/index.d.ts`）：`Step`、`CardOption`、`CardSpec`、`Entry` 多 `detail?`；`step.add` 的 `data` 多 `detail?`；`StepChange`（`types/index.d.ts:17-27`）加 `step.detail`。
- `changeLine` 的 switch（`lines.ts:67-139`）每種都有一句，加 `step.detail` 的（它不進變動紀錄，同 `repo.name`，`lines.ts:125-129`），兩張對照表加字。列出 action 的錯誤訊息（`tools.ts:342`）加 `detail`。
- 重算（新版）：上面的欄位有給就必須是字串，不然整筆形狀不對、略過。
- 讀入邊界：重算時每段細節過一次 11.2（和工具同一個函式），空字串當沒有；不查長度和重複（那只來自被保留的直接修改）。

## 7. 工具介面

錯誤訊息是給 AI 的英文，`{}` 是代入的值。被拒時整次呼叫什麼都不寫。

### 7.1 `update_step`

- `add` op 多 `detail`，**必填**，寫進 `step.add` 的 `data.detail`。缺了：`ops[{i}].detail is required on add: what this step does and how you will know it is done`。
- 新 op `{action: 'detail', step, detail}`，寫一筆 `step.detail`。空白：`ops[{i}].detail must be a non-empty string; a detail can be replaced, not cleared`；和現在的一樣：`step {id} already has this detail`。
- 放在別的 op：`ops[{i}]: detail goes only on an add or a detail op`（同 `evidence`，`tools.ts:247`）。
- 全部 op 都是 `note` 或 `detail` 時可以不給 `why`（現在只有 `note`，`tools.ts:233-236`）；`step.detail` 的 `why` 預設 `detail written`。
- 整次呼叫多選填的 `why_detail`，寫在這次每一筆的最外層（同 `why`）；不叫 `detail`，免得和 op 上的混淆。有它沒 `why`：`why_detail needs a why`。

### 7.2 卡片

- `add_decision` 的 `options[i].detail`，必填：`options[{i}].detail is required: what choosing it means in practice`。
- `add_user_action` 的 `detail`，必填：`detail is required: why the user has to do this and what happens once it is done`。
- `propose_change` 的 `detail`，**選填**：帶了照 11.3 選填那一欄檢查；空白當沒給。

### 7.3 變動紀錄的細節從哪來

`why_detail`；`resolve_decision`、`resolve_direct_edit` 選填的 `detail`；`apply_change` 不加參數，提案卡有 `detail` 時照抄到每一筆，同照抄 `why`（`tools.ts:194`、`200`），沒有就不抄。開卡那筆不帶：細節在卡片上。

### 7.4 摘要與 schema

- 摘要：進行中和下一個項目裡沒細節的步驟加 `, no detail`；細節本身不進摘要。
- `inputSchema`：新參數附 `description`；選項、`add_user_action` 的 `required` 加 `detail`；`add` 上的必填在程式裡查。

## 8. 畫面

收起時總表一列不多、卡片最多多一列。細節淡色、縮排、換行，不截斷。

### 8.1 總表的步驟

有細節的步驟，標題變成按鈕，後面接 `▸`（展開 `▾`），細節和標題對齊。沒細節的和現在一樣。「做完 n 步」裡的也能點開。

```
▾ 決定看板 v1 · 進行中
  ● 窗格兩個畫面 ▾
    上方兩個按鈕切換「總表」和「等你」。
    做完的判準：切回來還停在原本的位置。
  ⚑ 輸入框上方一列 ▸      等你決定：要不要顯示做完的數量
  ○ 英文說明
```

### 8.2 問題卡

多一列開關「▸ 選項細節」，放在「為什麼現在問」和選項之間；按一下所有選項的細節一起展開，各自接在「選了會怎樣」下面。理由：做決定要並排比較；一張卡只多一列。（省略框線）

```
▾ 選項細節
1 不顯示（建議）
  一列保持短 · 做完的在總表看
    那列一眼看完，但要開窗格才知道做完幾項。
2 顯示
  一眼看到進度
    那列多幾個字，窄的 terminal 會被截。
```

### 8.3 提案卡、待你處理卡

有細節時多一列「▸ 細節」：提案卡在「同意」的改動清單後、「不要」前，縮排同改動清單；待你處理卡在「為什麼」後、「指令」前。

### 8.4 變動紀錄

不加列。現在按一筆紀錄會多出「原因：…」（`pane.tsx:94-109`）；有細節的，同一次按下在原因底下接細節，多縮 2 格。項目變動紀錄裡收合的步驟瑣事，展開後每筆也一樣。卡片的「之前的變動」：單筆的列是同一個元件，可以點開；收合的步驟瑣事是按不了的純文字（`pane.tsx:413-420`），不顯示細節。理由：那一區只是卡片的背景。

不顯示細節：已送出的卡（`pane.tsx:247-263`）、沒攤開的卡（`265-273`）、輸入框上方那一列。

## 9. 互動

- 滑鼠：點有 `▸` 的步驟標題、「▸ 選項細節」「▸ 細節」、一筆紀錄；再點收起。預設全收，第一張卡也是。
- 鍵盤：窗格拿到鍵盤後 Tab 到那個按鈕、Enter（3.2）。不加新熱鍵：數字鍵已給第一張卡的選項（`pane.tsx:244`），`s` 已給送出（`pane.tsx:457`）。
- 展開狀態沿用 `toggle`（`register.tsx:211-215`），存在本機的 `expanded`。新鍵 `detail:<步驟或卡片 id>`；紀錄沿用 `why:<紀錄 id>`。`forget` 會丟掉認不得的鍵（`local.ts:110`），要加規則：步驟還在、卡片沒結案時保留。

## 10. 給 AI 的說明

`guide.ts` 的 `GUIDE`（英文；措辭可微調，意思不變）：

- note 那條（`guide.ts:10`）後面新增：`- A step's title says what it is in one line; its note, where it stands or who it waits on; its detail explains it: what it does for the user, how you will know it is done. Put explanations in details, not only in a spec or HTML page: the user reads them in the pane. Every new step needs one; give an older step one when you next work on it, once and in full.`
- 新增：`- Keep every why to one line; when the reason needs more, put the rest in why_detail (update_step) or detail (resolve_decision, resolve_direct_edit).`
- `add_decision`、`add_user_action`、superpowers 那幾條（`guide.ts:14`、`15`、`20`）補上要寫的細節，內容照 7.2；項目層那條（`guide.ts:7`）加：`propose_change` 的 detail 只在一行 why 講不完時寫，寫同意之後計畫會變怎樣；使用者會讀的那條（`guide.ts:21`）加 detail，寫明純文字、可換行、不用 markdown、上限 400 格（約 200 個中文字）、只重複標題會被拒。

## 11. 入口與異常輸入

### 11.1 會寫入細節的入口

必填：`add`、`detail` op；`add_decision` 的選項；`add_user_action`。選填：`propose_change`；`why_detail`；兩個 `resolve_*` 的 `detail`。跟著卡片：`apply_change`。重算：被保留的直接修改、merge 進來的行、本機那份。其他 op 不收步驟細節。

### 11.2 正規化（工具和重算共用，依序）

1. `\r\n`、`\r` 換成 `\n`；tab 換成空白。
2. 拿掉 `\n` 以外的 U+0000–U+001F、U+007F–U+009F，和雙向文字控制 U+202A–U+202E、U+2066–U+2069（終端機跳脫序列因此失效）。
3. 每行去掉行尾空白；第二行起的行首保留，給條列用。
4. 連續空行縮成一行；整段頭尾的空白和空行拿掉。

### 11.3 異常輸入

「標題」指：步驟的 `title`；選項的 `label` 和 `effect`；待你處理卡的 `action` 和 `why`；提案卡的 `question` 和 `why`；紀錄細節的 `why`。

| 輸入 | 必填的細節 | 選填的細節 | 重算時 |
|---|---|---|---|
| 沒給 | 拒絕（7.1、7.2） | 當沒有 | 當沒有 |
| 不是字串 | 拒絕 ① | 拒絕 ① | 整筆略過 |
| 空字串、只有空白或控制字元 | 拒絕 | 當沒給 | 當沒有，無開關 |
| 正規化後超過 400 格或 8 行 | 拒絕，不截斷 ② | 拒絕 ② | 照顯示 |
| 控制字元、多行 | 照 11.2 | 照 11.2 | 照 11.2 |
| 和標題重複（忽略大小寫、空白、標點） | 拒絕 ③ | 拒絕 ③ | 照顯示 |
| 含現有的計畫 id（見第 5 節第 9 條） | 拒絕 ④ | 拒絕 ④ | 照顯示 |
| markdown 符號 | 原樣 | 原樣 | 原樣 |

① `{field} must be a string` ② `{field} is {n} cells wide; keep it within 400 (about 200 Chinese characters). Put the rest in the spec and link it`（行數同理）③ `{field} only repeats the {title}; say what it leaves out` ④ `{field} names plan ids ({ids}); use the names the user sees`

## 12. 驗收條件

從工具呼叫的結果、窗格畫出的列（terminal、desktop 都跑）、重算的結果檢查。

1. `add` 沒 `detail` → 被拒（`ops[0].detail is required`），log 沒多一行。帶細節 → 標題後是 `▸`，按了出現細節、變 `▾`，再按消失。
2. 細節 `"  第一行\r\n\r\n\r\n第二\t行 \u001b[31m "` 畫成三列：「第一行」、空白、「第二 行 [31m」。
3. 200 個中文字過、201 個拒；400 個英文字母過、401 個拒；8 行過、9 行拒。
4. 等於標題（只差空白或句號）、放在 `edit` op 上，各自被拒。計畫裡有 id `design01` 時，含 `design01` 被拒，`design012`、`design01_x` 不擋；不存在的 id、短於 6 字元的 id 不擋。
5. `detail` op 補舊步驟 → 出現 `▸`，「變動紀錄（n 筆）」的 n 不變；空字串、和現有的一樣，各自被拒；只有 `note`、`detail` op 時可以不給 `why`。
6. `add_decision` 任一選項沒細節 → 被拒（`options[1].detail is required`）；有 → 多一列「▸ 選項細節」，按了每個選項下出現自己的細節。`add_user_action` 同理（「▸ 細節」）。
7. `propose_change` 帶 `detail` → 「同意」底下有「▸ 細節」，太長、含 id 照樣被拒；沒帶 → 沒有細節那一列，同 0.4.2。
8. 帶細節的提案套用後、帶 `why_detail` 或 `detail` 的紀錄，按下去原因下有細節；沒帶的只有原因。卡片「之前的變動」裡收合的列按不了。
9. 舊格式的 log（現有測試資料、這個 repo 的 `plan/log.jsonl`）：沒有被標記的行，窗格畫出的列和 0.4.2 一字不差。
10. 加上細節、全部收起時：總表列數不變，每張攤開的卡最多多一列。
11. 用 0.4.2 的 `replay.ts`、`checksum.ts`（`git show 3fb1e29:…`）重算新版寫的 log：沒有被標記的行；`step.add`、`card.open` 照常套用；`step.detail` 在 `skipped`（`unsupported kind`）。實作時跑一次附輸出，不留成測試。
12. 點開、收起後 `plan/log.jsonl`（本機模式：`$.store` 的 `log:`）一個位元組都沒變；本機窗格狀態有 `detail:<id>`，重算後仍展開，步驟刪掉後鍵被清掉。
13. 摘要裡沒細節的步驟有 `, no detail`；zh-TW 畫面沒有 id；兩張對照表的鍵一樣。
14. `claude plugin validate` 通過；版本 `0.5.0`；README 兩份的「項目和步驟」寫上細節。

## 13. 留給實作者決定的事

- 正規化放哪個模組（工具和重算同一個函式）；比對重複時忽略哪些標點；錯誤訊息的措辭。
- 按鈕的長標題會換行還是被截，型別檔沒寫（d.ts:1111-1216）。實作第一步用超長標題在 terminal、desktop 實測：換行 → 照 8.1 標題當按鈕；被截 → 標題照舊用 `Text`，後面另放只有 `▸` 的 plain 按鈕（d.ts:1157-1159）。

## 14. 要問 Johnny 的事

沒有。
