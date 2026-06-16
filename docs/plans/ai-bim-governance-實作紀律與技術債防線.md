# AI-BIM-Governance — 實作紀律與技術債防線（AI Coding Discipline & Anti-Tech-Debt）

> 版本：v1 · 2026-06-16 · 放置位置：`docs/plans/`（與 README、v2 規格、v3 計畫、互動規格並列）
> **這份是「HOW（怎麼做才不欠技術債、怎麼精準照規格落地）」層，不改任何「WHAT（功能與需求）」。**
> 需求、互動語意、驗收條件，一律仍以既有四份文件為準。本檔是**補充紀律層**，不取代任何規格。
>
> **效力定位**：既有效力順序維持不變 —— 互動實作規格（行為/標準）＞ v3 計畫（順序/DoD）＞ v2 規格（介面）＞ 兩份 .html（視覺示意）。本檔位於這個堆疊的「外圍執行紀律層」。**當本檔任何條目與上述規格字句衝突時，以規格為準，並回報以更新本檔。**
> **用法**：每一輪用 AI（Claude Code 等）開工前讀「§1 一頁速查」與「§2 八條最高原則」；交付前用「§8 交付前總檢查表」逐條打勾。

---

## 0. 給不懂工程的你（白話）

這份文件不是又一份規格，而是一張「**施工守則 + 出貨前檢查表**」。

我們已經有很完整的規格（要蓋什麼、長什麼樣、怎麼驗收）。但「請 AI 照規格寫程式」常出兩種毛病：

1. **欠技術債**：AI 為了快，把數字、版本、路由「寫死」在程式裡，或把「示意用的假畫面」當成真功能交出來。當下看起來會動，之後要改就到處踩雷、愈拖愈爛。
2. **偏離規格**：AI 憑印象、憑猜測補東西，沒回去查文件，做出來的跟規格對不上，或自己偷偷改了規格。

這份文件就是把「**不准這樣做**」和「**每次交件前要自己檢查的清單**」寫清楚，讓 AI 照著走、讓你（或任何人）拿著清單就能驗收，不必懂工程也能逐條打勾。

**一句話**：規格管「做什麼」，這份管「老老實實照做、不偷工、不留爛攤子」。

---

## 1. 一頁速查（貼在每輪開工與交付前）

### 開工前 3 件事
1. **先查文件，不靠記憶**：這輪要做的每個功能，先在 `docs/plans/` 找到對應的一條 DoD、或一張 IX 互動卡、或一支 API 草案。找不到 → 先停下來問人，不要自己發明。
2. **確認里程碑順序**：照 M0→M1（A1 純 CPU、不碰 3D）→M2→M3→M4→M5+，**不要先做 3D**。
3. **官方有就用官方**：diff 用 `ifcdiff`、BCF 用官方 bcf 庫語意、3D 量測/批註/剖切/書籤/場景樹/屬性/串流用 Omniverse 官方件；自製只做 BCF 橋接層與轉檔 coverage 報告。

### 交付前必過（精簡版，完整版見 §8）
- ☐ 沒有把示意（canvas 3D、go(id) 切頁、腳本對話）當成真功能交出去
- ☐ 沒有新增寫死的識別碼/版本字串/路由（識別碼、`BCF 2.1`、route 都走單一來源）
- ☐ 待建功能一律 `disabled` + 說明，**沒有假按鈕**（點了沒反應）
- ☐ 沒有樂觀更新（一律等 API 回應、用回應的事實重繪）
- ☐ 誠實標記走後端 `provenance`，前端沒寫死
- ☐ 危險動作走「intent→確認→稽核」三段式，確認框有白話後果
- ☐ 遇到文件矛盾/缺漏 → 留 `// TODO [SPEC-GAP]` 並問人，沒有自行臆測補上

---

## 2. 八條最高原則

看不懂細節時，回到這八條判斷。

| # | 原則 | 白話 | 出處 |
|---|---|---|---|
| **P1** | 示意 ≠ 交付 | 兩份 .html 是「行為示意，不是程式碼範本」。canvas 3D、`go(id)` 記憶體切頁、腳本化對話，都不能直接當成品。正式判準：走真 API、真資料、狀態機照 IX 卡、在 coordinator `/ui` 的 React EdgeConsole 跑起來。 | README 檔案角色；前輪審批落差 1/2 |
| **P2** | 畫面 = 事實 | 系統信任的根基。**禁止樂觀更新**（先改畫面再等 API）。狀態變化一律等 API 回應，用回應裡的事實重繪；失敗則畫面不變、只顯示錯誤。 | 互動規格 模式1 |
| **P3** | 單一真相源 | 每一種識別碼、版本字串、路由清單，全系統只有一個地方定義，其餘都引用。識別碼設定化、版本字串設定化、route contract 集中維護。 | 鐵律2/7；前輪審批落差 3/5/7 |
| **P4** | 官方件優先、自製只做橋接 | BCF 走官方 bcf 庫、diff 走 ifcdiff、3D 功能走 Omniverse 官方件、session 邊界照 NVIDIA 官方（terminate+recreate，無 live migration）。自製範圍僅限：BCF 橋接層、IFC→USD coverage 報告、coordinator 排程。 | 鐵律4/9/10/11；互動規格 PART C |
| **P5** | 需求靠回讀文件、不靠記憶 | 開工前讀對應規格節次。行為邊界不確定就回讀，不憑上一輪印象。尤其鐵律9/10/11 與 PART C 只寫在最高效力檔，容易被漏讀。 | README 效力順序 |
| **P6** | 做不到就標待建、不假裝完成 | 後端沒通、證據鏈沒齊的功能，一律 disabled + 待建徽章，不放假按鈕、不用示範資料冒充真資料、不宣稱已完成。 | 鐵律3；決策 D2；模式4 |
| **P7** | AI 只寫 session layer、不碰 source model | 改動只寫 session layer；還原＝關掉 session layer 可見性；永不改 source model（雜湊前後不變）。建 Issue/批改/送 BCF 等動作要真人確認。 | 鐵律6；決策 D5 |
| **P8** | 改規格前先停下來問人 | route contract、識別碼格式、共用資料模型欄位、API path 都是「不得單方面修改的合約」。發現舊規格不合理 → 提出討論再動，不在程式碼裡默默繞過。 | 本檔 §7；鐵律全體 |

---

## 3. 技術債陷阱清單（照這份避雷）

格式：**陷阱 → 為什麼會欠債 → 防法（可打勾）**。出處欄標明依據的鐵律/模式/審批落差。
> 註：出處欄的「審批落差 N」＝同資料夾《審批報告-md與html一致性交叉驗證-2026-06-16.md》逐項落差表第 N 項（2026-06-16 那輪 md↔html 一致性交叉驗證的發現），可回該報告查證。

| 代號 | 陷阱 | 為什麼會欠債 | 防法（可檢查） | 出處 |
|---|---|---|---|---|
| D-01 | 把 canvas 示意當 3D 交付 | geo-viewer 的 3D 是自寫 canvas 純示意，不是真串流 | 3D 畫面一律來自 Kit WebRTC 串流；指令走 DataChannel；非 canvas 自繪 | 審批落差 2/4 |
| D-02 | hash 路由加斜線（`#/a1`） | 舊文件殘留 `#/`，實測現況是 `#a1`（無斜線） | route 一律無斜線，照 §6 唯一清單 | 鐵律2；E1 |
| D-03 | 用 `go(id)` 記憶體切頁當真路由 | 原型沒有真 hash 路由，無法深連結/回上頁 | 每頁對應一個真 hash route，可直連可回退；不用全域 `go()` 管狀態 | 審批落差 1 |
| D-04 | BCF 版本字串寫死且版本錯（3.0） | 原型殘留「BCF 3.0」，現行其實是 2.1 | 版本字串集中一處常數；UI 顯示 `BCF 2.1`；升級只改一處 | E3；PART C C.1 |
| D-05 | 專案編號寫死在前端/測試 | 現況 270/889/990+271 皆暫時測試檔，舊值 270/899/988 已淘汰 | 識別碼進設定/fixture；業務邏輯不出現裸數字；測試資料 UI 標「測試資料」 | E5；鐵律7 |
| D-06 | 誠實標記寫死前端 | 與後端狀態脫鉤，標記會「說謊」 | 徽章走 `GET /api/provenance`；後端 `provenance.json` 每功能一條；前端不 hardcode | 鐵律3；模式4 |
| D-07 | 假按鈕（可點但沒事件、沒 disabled） | 違反誠實文化，使用者分不清壞掉還是待建 | 待建按鈕一律 `disabled + title`；不存在點了無反應的按鈕 | 鐵律3；模式4；審批落差 6 |
| D-08 | 樂觀更新（先改畫面再等 API） | 出現「畫面≠事實」的時間窗，動搖信任機制 | busy→等 API→以事實重繪；失敗畫面不變只顯示錯誤條 | 模式1 |
| D-09 | 輪詢忘了清理 / 失敗清空舊資料 | 記憶體洩漏；使用者分不清掛了還是真沒資料 | 離頁 `clearInterval`；失敗顯示「上次更新時間·連線異常」、不清空 | 模式2 |
| D-10 | 危險動作缺三段式確認 | 操作不可追溯、使用者不知後果 | 插隊/重試/釋放/terminate/drain/move/批次建issue/匯出 一律 intent→confirm→audited | 模式3 |
| D-11 | 版本 diff 自寫、不用 ifcdiff | 跨 schema 不保證正確、缺 GlobalId 鍵標準輸出，後期重做 | A2 用 `from ifcdiff import IfcDiff`；前端直接吃其 JSON；無自寫比對 | 鐵律9；C.1 |
| D-12 | A1/A2/A3/A5 各做各的 Issue schema | Issue 中心無法統一、BCF 欄位不一致 | 共用 v3 §2.0.3 同一 schema；`source` 填 A1/A2/A3/A5/manual；無 `A1Issue/A2Issue` | 鐵律5 |
| D-13 | 3D 功能在 web 端重做 | 與 Kit 升版行為不保證一致，維運災難 | 量測/批註/剖切/書籤/場景樹/屬性/串流走官方件；web 只開關+收證據；自製僅 BCF 橋接 | 鐵律11；C.3 |
| D-14 | AI 碰 source model | source 被改無法還原、失去版本真相源地位 | usd-code-mcp 目標一律 session layer；還原＝切可見性；驗收 source 雜湊不變 | 鐵律6；D5 |
| D-15 | 跳過 coverage、宣稱 100% 無損 | 不知哪些構件沒轉成功，日後找不到構件無從追查 | 每筆 ConvJob 出 coverage 報告；未建顯示待建徽章；不宣稱無損 | 鐵律10；模式6 |
| D-16 | browser 直連 governance :49102 | 繞過 proxy/認證；開發能跑、部署就壞 | 前端走 `/api/governance/*` proxy；前端不出現 `:49102` | 鐵律8；E4 |
| D-17 | 宣稱 session 無縫遷移 | 官方不支援，使用者操作後措手不及 | confirm 文案含「重啟搬移·約30–40秒·重載stage·短暫斷線」；UI/API 不出現 live migration/migrate | 鐵律4；IX-KG-02 |
| D-18 | 用 IfcConvert 輸出 USD | 官方不支援，會靜默失敗、整條管線依賴不存在功能 | IFC→USD 走自製轉檔器；備援 `IfcConvert --use-element-guids`→glb；無 IfcConvert 帶 .usd 輸出 | C.2 |
| D-19 | prim 命名不用 GlobalId | 對照表失效，A1 高亮/A4 搜尋/A2 onion-skin 全斷 | prim 一律 `G_<sanitized_guid>`；轉檔後寫 elementGuid↔usdPath 對照表 | 鐵律10；C.2 |
| D-20 | 3D 高亮啟用條件漏判 | 指令發出無反應，使用者以為壞了 | 啟用需四條件齊備：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ 構件有 usd_prim_path | IX-A1-06 |
| D-21 | 空狀態補假列 / 把 404·501 當錯誤 | 假列混淆真資料；待建被誤判成壞掉 | 空資料顯示「目前沒有 X+下一步」不補列；404/501 顯示待建徽章非錯誤 | 模式6 |
| D-22 | 拖放直接改前端狀態 | 等同樂觀更新且無稽核軌跡 | drop 後彈 IntentDialog→確認才 POST intent；drop 規則函式先寫並有單測 | 模式5；IX-KG-02 |
| D-23 | 跳過 M0→M1→M2 直接做 3D | 最快能交付客戶的 A1（純 CPU）反而最晚完成 | 每輪確認當前里程碑、不跳接；3D 高亮在 M3 前一律 disabled 標待建 | 鐵律1 |

---

## 4. 精準執行：里程碑驗收門（DoD 硬化）

> **原則**：本節**不新增任何功能需求或數字門檻**，只把 v3 既有的 DoD「講成可逐條打勾」並補上「要附什麼證據」。任何「必過條件」的實質內容若與 v3 原文不同，以 v3 為準。

每個里程碑的驗收 = 既有 DoD 全數達成 + 下列「證據要求」齊備。證據是「HOW 的紀律」（要求留痕），不是新需求。

| 里程碑 | 既有 DoD（以 v3 §3.3 原文為準） | 驗收要附的證據（紀律要求） |
|---|---|---|
| **M0 地基** | `/ui` 七頁能點到、誠實標記設定化、現況差距清單看得懂 | 七個 route 各一張瀏覽器截圖（URL hash + 有效畫面）；改 `provenance.json` 後重整即時反映的前後截圖；差距清單（每項列「實際現況 vs 規格要求」） |
| **M1 A1 核心閉環** | 上傳→檢核→Issue→BCF 全來真；A1 驗收清單全勾 | 真實 model.ifc 跑檢核的 API 請求/回應 log；規則 pass/fail 與命中構件清單；批次轉 Issue 的請求/回應＋Issue 中心可改狀態截圖；匯出 .bcfzip 能被第三方 BCF 2.1 檢視器開啟的截圖；Network 面板顯示走真 API（非 mock） |
| **M2 轉檔** | 丟新 model.ifc → model.usdc 自動出現 + coverage 報告 | 放檔前/後 storage 目錄截圖（含時間戳）；ConvJob status=done；coverage 報告（property/relationship/attribute）；抽查若干 prim（建議取樣 ≥5，為驗收抽樣數、非新增需求）命名為 `G_<guid>` 可反推 GlobalId |
| **M3 串流** | 瀏覽器看到 Kit 真 first frame；兩人同看一 session | viewer 有渲染畫面＋coordinator 記錄 `first_frame_at`（viewer 端回報、非埠 listen 推定）；兩分頁同看同一 sessionId（1 PRI+1 SPC）截圖；拖放搬移走重啟流程（confirm 文案含 30–40 秒斷線）＋audit log |
| **M4 3D 連動** | A1 高亮失敗構件、A4 框選；誠實標記更新 | 高亮按鈕四條件齊備才 enabled 的截圖；高亮前後 viewer 截圖；DataChannel 指令 trace（時間/指令/ack）；elementGuid↔usdPath 對照表樣本；標記由改 `provenance.json` 翻綠（非改前端）的截圖 |
| **M5 版本疊合** | O3 版本層落地→A2 ifcdiff→onion-skin；A3 疊合→clash | 多版本檔＋Version 表記錄；A2 走 `ifcdiff` 的 log＋三色 JSON；圖層開關前後 viewer 截圖；clash 引擎未選型（O6）前標待建、不假裝有 |
| **M6 IoT** | 綁定表＋模擬 MQTT 走通→3D 圖釘 | bindings 建立、模擬 MQTT log、即時狀態 API、A5 頁面狀態截圖；標「感測接線待建」 |
| **M7 OMNI 加值一** | A6 4D 播放；A8 replicator 出資料集 | 排程匯入 log＋viewport 不同時間點截圖；replicator 輸出 COCO 資料集寫入 storage＋格式驗證腳本通過 |
| **M8 進階** | A9 session-layer Copilot；A7 點雲偏差；A10 Isaac 巡檢 | A9 指令 trace＋還原後 source model 雜湊不變的前後對比；A7 偏差熱力圖＋抽測點數值；各項未達標一律標待建 |

---

## 5. IX 互動卡執行守則（實作要對齊、驗收要看到的證據）

> 行為合約以互動規格 PART B 原文為準。本節是「實作別走偏的提醒 + 驗收看什麼」。

**IX-A1（A1 五步 Stepper）**
- 對齊：狀態機 `idle→picked→running→scored→issued→delivered`，不新增 state、不改 event 名；進度輪詢 **1500ms**；失敗構件清單懶載入＋分頁；建 Issue 冪等鍵＝`rule_run_id + elementGuid`。
- 證據：Network 面板真 API 與 1500ms 輪詢；展開大量失敗構件不卡頓且有分頁；BCF 可被第三方開啟；重複建 Issue 顯示「已建過 n 筆，跳過」。

**IX-CV（轉檔佇列）**
- 對齊：佇列輪詢 **5000ms**；插隊/重試 endpoint 未建前 disabled+待建徽章；**拖曳排序已正式改為按鈕式插隊**；插隊/重試走 intent；coverage 未建顯示待建（模式6 的 501 規則）。
- 證據：`GET /api/external/ifc-ready` 真 response；插隊/重試 disabled 截圖；自動偵測關閉時琥珀條。

**IX-SS（Session ATC）**
- 對齊：`occupied` 只有在三欄證據齊全才顯示（`first_frame_at` 有值 + `last_heartbeat`≤15s + `stage matched`）；heartbeat>15s 顯示 stale 紅；`Open URL ≠ occupied`（只開分頁、不改狀態）；強制釋放前置＝stale ∧ 無 first frame。
- 證據：每 endpoint 三欄證據明確顯示；刻意製造 stale 的紅色截圖；Open URL 前後無狀態變更呼叫。

**IX-KG（Kit/GPU 機隊）**
- 對齊：drop 規則函式先寫＋單測（drain 中拒/已有 stream 拒/同節點忽略）；drop 不直接改狀態，走 confirm（含 30–40 秒文案）；drain 節點左緣琥珀條且不可成 drop 目標。
- 證據：drop 規則單測 pass；拖到 drain 節點的拒絕提示；confirm 文案截圖。

**IX-3D（3D Viewer / Review Room）**
- 對齊：`#viewer` 走 coordinator `/ui/open?session=` redirect，**不在 console 內嵌 WebRTC**；DataChannel 四指令 `openStage/focusPrim/selectPrims/clearHighlight` 每次留 trace；無 `usd_prim_path` 的列標 ⚠ name_fallback 且 disabled；`first_frame_at` 由 viewer 回報、console 不推定；高亮指令族帶 `source: a1|a2|a4` 共用。
- 證據：`#viewer` 不含 WebRTC iframe；指令 trace 截圖；mapping 缺省列 ⚠+disabled；高亮 payload 含 `source`。

---

## 6. 資料模型 / API / 識別碼「禁止偏離」清單

> 全部以 v3 §2.0.x 與既有 API 草案原文為準。以下是「不得自行更動」的合約。

**識別碼與欄位（不得偏離）**

| 項目 | 規格要求 | 禁止行為 |
|---|---|---|
| `elementGuid` | IFC GlobalId 原始值 | 不得用自增 ID/UUID 取代、不得 hash 後存（會對不回原構件） |
| `usdPath` | `G_<sanitized_guid>` | 不得換前綴/省略 `G_`；消毒邏輯前後端＋轉檔器三方一致 |
| `issueId` | 沿用 v3 §2.0.3 範例風格（範例值 `ISS-YYYY-MMDD-NNN`） | 要改格式先走 §7.2 流程、不自行決定；勿用裸 UUID 直接當 issueId |
| Issue `source` | `A1\|A2\|A3\|A5\|manual` | 不得新增值（要加先改規格） |
| Issue `severity` | `Critical\|Major\|Minor` | 不得改名（`High/Low` 是錯的）、不得新增等級 |
| Issue `status` | `open\|in_progress\|resolved\|closed` | 不得新增/改名 |
| Issue `viewpoint` | 無 3D 時填 `null` | 不得填假空字串/空物件 |
| ConvJob `status` | `queued\|running\|done\|failed` | 不得新增中間狀態（如 `processing`） |
| Session endpoint pool | `1 PRI + N SPC` | 不得讓 SPECTATOR 有寫入/操作權 |
| BCF 版本 | **現行 2.1** | 不得輸出 3.0（升級需走官方 bcf 庫、時機未到） |

**路由（route contract，唯一清單）**
`/ui`、`#home`、`#a1`、`#viewer`、`#conv`、`#sessions`、`#instances`、`#minio`、`#review`；operator 工具 `#kit`、`#demo-control`。
全部**無斜線**。不得新增、移除、改名任何 route（要改先改文件並確認）。

**API 邊界**
- governance 類經 coordinator `/api/governance/*` proxy；前端**不直連 `:49102`**。
- A2 diff：`POST /api/v1/models/{modelId}/diffs {from,to}` → `GET /api/v1/diffs/{diffId}`，不得改 path 或合併。
- A4 搜尋：`POST /api/v1/projects/{pid}/search {q}`，解析出的條件須顯示給使用者確認（透明）。
- 官方邊界：diff 用 `ifcdiff`、BCF 用官方 bcf 庫語意、IFC→USD 自製須出 coverage、viewer 功能用 Omniverse 官方件（自製僅 BCF 橋接）。

---

## 7. AI 動作邊界與防擅改

**7.1 危險動作三段式（intent → confirm → audited）**
適用：插隊、重試、強制釋放 endpoint、結束 session、drain、move（terminate+recreate）、批次建 Issue、匯出交付。
- **Intent**：開 confirm 對話框，文案含「成本與後果」白話（依 IX 卡，不得自行縮減；如 move 不得省略「約 30–40 秒/重載 stage/短暫斷線」）。
- **Confirm**：使用者明確按「確認執行」才 POST intent API，body 帶 `reason`（可空）。
- **Audited**：後端寫 audit（who/when/what/reason）；前端依模式1 以事實重繪，不樂觀更新。
- 任何快捷鍵/批次/腳本不得繞過 confirm（CI 例外須在 audit 標注自動化）。

**7.2 AI 不得自行更動的清單（要改先停下問人）**
route contract、Issue/BCF schema 欄位與值域、`elementGuid`/`usdPath` 格式、既有 API path 與 method、六個通用互動模式核心規則、誠實標記四值域、provenance 由後端驅動的原則。

**7.3 遇到文件矛盾/缺漏的處理（一律停、不臆測）**
情況：章節互相衝突、細節缺漏無法推出唯一答案、規格技術上有困難或錯誤。
處置：在程式碼插入下列 TODO，並列入當輪 self-check，交人裁定 ——

```
// TODO [SPEC-GAP]: 文件 [檔名 §節號] 與 [檔名 §節號] 矛盾/缺漏，待確認後再實作。
//   描述：[具體哪裡衝突或缺什麼]
//   本輪 self-check 已記錄；未自行填入推斷解法。
```

---

## 8. 交付前總檢查表（權威版，每輪逐條打勾）

> 每完成一個可驗收目標，交付前逐條打勾。未完成者須在本輪修復，或明確記為「刻意待建（附理由）」。標 N/A 的條目需確認本輪確實不涉及。

**A · 識別碼與字串（無寫死）**
- ☐ A1 無新增 `#/` 開頭路由（hash 無斜線）〔鐵律2/E1〕
- ☐ A2 業務邏輯無裸寫專案編號（270/889/990/271 只在設定/fixture）〔E5/鐵律7〕
- ☐ A3 BCF 版本字串只有一處定義，UI 顯示 `BCF 2.1`〔E3/C.1〕
- ☐ A4 前端無 `:49102` / `localhost:49102`〔鐵律8/E4〕
- ☐ A5 prim 命名一律 `G_<sanitized_guid>`〔鐵律10/C.2〕

**B · 誠實標記與假按鈕**
- ☐ B1 待建按鈕一律 `disabled` 且 `title` 非空〔鐵律3/模式4〕
- ☐ B2 無「可點但點了沒反應」的按鈕〔審批落差6〕
- ☐ B3 前端無 hardcode `已實作/示範資料/待建` 對應到具體功能（走 API）〔鐵律3/模式4〕
- ☐ B4 測試資料頁面有「測試資料」徽章〔鐵律7〕

**C · 更新模式（無樂觀更新）**
- ☐ C1 動作按鈕 API 回應前保持 busy，不提前改業務資料〔模式1〕
- ☐ C2 API 失敗：業務資料不變，只顯示錯誤條含 status code〔模式1〕
- ☐ C3 有輪詢的頁面離開時有 clearInterval/cleanup〔模式2〕
- ☐ C4 輪詢失敗顯示「上次更新時間·連線異常」、不清空舊資料〔模式2〕
- ☐ C5 輪詢節奏：佇列/Session/機隊 5000ms；執行中進度 1500ms〔模式2/IX-A1〕

**D · 危險動作（三段式）**
- ☐ D1 插隊/重試/釋放/terminate/drain/move/批次建issue/匯出 全部有 IntentDialog〔模式3〕
- ☐ D2 confirm 文案含白話成本與後果〔模式3〕
- ☐ D3 POST intent body 有 `reason` 欄位〔模式3〕

**E · 官方工具邊界**
- ☐ E1 A2 diff 走 `ifcdiff`，無自寫比對〔鐵律9/C.1〕
- ☐ E2 無 `IfcConvert` 帶 `.usd/.usdc` 輸出〔C.2〕
- ☐ E3 BCF 走官方庫語意/自建 2.1，無完全自寫 BCF-XML〔C.1〕
- ☐ E4 無 web 端自製量測/批註/剖切/書籤/場景樹/屬性元件〔鐵律11/C.3〕

**F · Schema 一致性**
- ☐ F1 A1/A2/A3/A5 建 Issue 用同一 schema（`source` 標來源）〔鐵律5〕
- ☐ F2 無 `A1Issue/A2Issue` 等獨立型別/資料表〔鐵律5〕
- ☐ F3 §6「禁止偏離」表的欄位值域未被新增/改名〔v3 §2.0.3〕

**G · 3D 邊界**
- ☐ G1 3D 畫面來自 Kit WebRTC，非 canvas 自繪〔審批落差2〕
- ☐ G2 高亮走 DataChannel `highlightPrimsRequest`，非本地重畫〔審批落差4/IX-A1-06〕
- ☐ G3 高亮按鈕四條件齊備才 enabled〔IX-A1-06〕
- ☐ G4 session move confirm 含 30–40 秒斷線、無「無縫遷移」字眼〔鐵律4/IX-KG-02〕
- ☐ G5 AI 操作只在 session layer，source model 雜湊不變〔鐵律6/A9〕

**H · 轉檔管線**
- ☐ H1 每筆 ConvJob 有 coverage 報告〔鐵律10/IX-CV-02〕
- ☐ H2 coverage 未建顯示待建徽章，不省略〔模式6〕
- ☐ H3 任何地方未宣稱「轉檔 100% 無損」〔鐵律7〕

**I · 路由、順序與需求對齊**
- ☐ I1 route 符合 §6 唯一清單，無遺漏/多出未登記 route〔鐵律2/審批落差7〕
- ☐ I2 實作順序 M0→M1→M2→M3→M4，M3 前不交付 3D〔鐵律1/審批落差3〕
- ☐ I3 本輪每個功能都對得上某條 DoD/IX 卡/API 草案（否則停下問人）〔§2 P5/P8〕
- ☐ I4 本輪所有 `// TODO [SPEC-GAP]` 已列入下方，未自行臆測補上〔§7.3〕

**本輪 SPEC-GAP 清單**：
- （若無，寫「本輪無 SPEC-GAP」）

---

## 9. 與既有文件的關係（效力定位與掛鉤）

- 本檔為**補充紀律層**，**不改任何需求/規格**。既有效力順序不變：互動規格 ＞ v3 ＞ v2 ＞ 兩份 .html。
- **衝突規則**：本檔任何條目與規格字句衝突時，**以規格為準**，並回報以更新本檔。
- **掛鉤**：README 與三份 .md 已各加一行指向本檔（純新增、未動原文）。每輪用 AI 開工時，把本檔與規格一起載入。
- **維護**：每次審批/實測發現新的技術債來源或落差，回來補一條 D-xx 與一條檢查表項目，讓防線隨專案成長。

---

*本檔所有條文均為「如何不欠技術債、如何照規格精準落地與驗收」的 HOW 層，未新增或修改任何功能需求；DoD、API、欄位、識別碼、互動模式均引用自 README、互動實作規格（PART A/B/C）、開發軌跡與執行計畫（v3 §2.0.x、D1–D9、M0–M8）、設計規格（v2.1）。*
