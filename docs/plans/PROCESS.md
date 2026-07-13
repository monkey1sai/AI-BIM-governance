# PROCESS — 工程紀律 / DoD / 驗收 / 文件防腐

> v1 · 2026-07-10 · AI-coding 文件體系重設計（依使用者指令，以兩份 prototype 為基準）
> 本檔回答唯一問題：「怎麼做才不出事、怎麼驗收、文件自身怎麼防腐」。
> 現況（建到哪）問 `TRUTH.md`；需求（要做成什麼樣）問 `TARGET-contracts.md` / `TARGET-shell.md` / `TARGET-viewer.md`；排序與 OPEN 決策問 `BACKLOG.md`。本檔不含任何 repo 現況事實——凡出現「現在是／仍是」句式即屬本檔 bug，改為引 TRUTH 對應錨。
> 全域契約條文（凍結面、埠表、路由、enum、Prov 映射、互動模式）一律引 `TARGET-contracts.md` §N，本檔不重抄。

---

## §1 誠實鐵律（一句原則＋三個機器載體）

**原則**：不得把 NOT BUILT 呈現為可操作或寫成已交付；缺遙測標「未取得」；demo 資料標示範資料；未觀測寫 not observed；**不足宣稱（把已建寫成未建）同樣是說謊**。

三個機器載體（誠實不靠自律，靠編譯器、後端語意與證據檔）：

1. **前端型別載體**：`Prov` 型別僅 7 值（`asbuilt/artifact/demo/p1/p15/p3/p4`），ProvTag 逐 Panel／逐 Field 掛標；`prov="todo"` 直接 TS2322 編譯即擋。Prov ↔ ProvTag 映射唯一一份在 contracts §5，本檔不重抄。
2. **後端誠實語意載體**：未建端點（apply-overlay 類）誠實回 `501`，不回假成功；enum 一律後端逐字 echo，前端禁自創值；ConversionLedger 為轉檔狀態的唯一真相；查無資料回 `not_found`，不臆測補值。
3. **證據載體**：`artifacts/e2e/` 下的 screenshot＋trace＋`summary.json` 是 user-facing 完成的**唯一證據**。注意 `artifacts/e2e/.gitignore` 預設擋**全部 evidence 檔型別**（`*.png`、`*.json`、`*.zip`、`*.trace` 等）：引用任何 evidence 前先逐檔 `git ls-files` 確認 tracked，未 tracked 一律 `git add -f`；untracked 的引用＝dead reference＝證據不存在。

UI 呈現規範：一律依 contracts §9 的六條誠實元件規範與六通用互動模式執行，本檔不重抄。

**明文廢除**：禁寫清單制度已廢除；狀態陳述一律用 TRUTH 的 enum（BUILT／PARTIAL／NOT BUILT）；發現錯誤＝改正本。

---

## §2 DoD 硬化（built 宣告的硬性條件）

`built` 宣告須**同時滿足全部五條**，缺一即降級（PARTIAL 或 NOT BUILT，依 TRUTH enum 記錄）：

1. **route 可達**：hash route 已登記於 contracts §4 正典路由表，且 console 確實渲染該頁（hash 無斜線：`#a1` 非 `#/a1`）。
2. **後端真接線（非 mock）**：Network 面板見真實 API response；無 `mock=true` / `allow_fake_mapping=true` / `fake_mapping_count>0`。
3. **provenance 成立**：`prov="asbuilt"` 或 `prov="artifact"`；非 `demo/p1/p15/p3/p4`。
4. **browser E2E evidence**：`artifacts/e2e/` 的 screenshot＋trace 存在、tracked、拍攝時間戳可追溯。
5. **0 blocker**：驗證軸無任何 severity=blocker 開放項。

**backend-only done 不接受**：user-facing 功能必須可從前端 route 操作並附 browser E2E evidence；缺 evidence 即降為待建，不得以「後端已通」抵充。

附加兩條 PR 義務：

- **(a) 誠實邊界聲明**：每個產品 PR body 必附「誠實邊界聲明」——本次完成後哪些相關能力仍 NOT BUILT／哪些遙測仍「未取得」、UI 如何標示（disabled＋prov／「未取得」＋idle）。沒有邊界可聲明時明寫「本次無殘餘 NOT BUILT 邊界」。
- **(b) TRUTH 同步**：觸碰四服務（`web-viewer-sample/`、`bim-review-coordinator/`、`governance-service/`、`bim-streaming-server/`）route／API 面的 PR，必須同 PR 更新 `TRUTH.md` 對應列（即 §6 閘 2 的紀律面）。

---

## §3 驗收證據規約

- **落點與命名**：per-page evidence 統一存 `artifacts/e2e/<page>-trace/`＋`<page>-*.png`＋`summary.json`；不落 `C:\` 根目錄（Windows EPERM 陷阱）；引用前依 §1 載體 3 確認 tracked。
- **branch-isolated stack 啟法**（未 merge 分支取證，不碰部署區 `:8004` / `:49102`）：`build:ui` → branch governance（`GOV_PORT=49103`＋`BIM_FILE_LIBRARY_ROOT`）→ branch coordinator（`PORT=8005` / `CONSOLE_DIST_DIR` / `GOVERNANCE_API_BASE`）→ E2E 一律打 `:8005`。
- **network 面斷言**：built／partial 頁只允許打 coordinator（`:8004` 或隔離站 `:8005`）的 `/api/*` proxy——前端不得出現 `:49102` 直連；TRUTH 標 NOT BUILT 的 route 斷言對 `/api/*` **零呼叫**（佔位頁不打 API）。
- **screenshot 對齊 prototype 錨**：每張驗收截圖標注對應的 prototype 頁錨（`ai-bim-governance-prototype.html#<id>` 或 viewer 原型區塊），比對項＝版面結構、誠實標記（prov／disabled／「未取得」）、主要互動元件是否與 TARGET 該節驗收句一致；不要求像素級一致。
- **誠實斷言**：缺遙測顯「未取得」＋idle LED；disabled 控制帶誠實 caption＋prov；demo 區帶 `prov="demo"`；enum 逐字比對。
- **已知穩定性**：截圖偶發 frozen 屬環境現象，重試取證即可，不得以 frozen 截圖充當證據。

---

## §4 技術債防線精選（長壽紀律，一行一條）

> 只收與 repo 進度無關的長壽紀律；「某頁現在長怎樣」類事實一律歸 TRUTH，不得凍進本表。歷史敘事型陷阱不搬（git 可考）。

| 代號 | 防線（一行式） |
|---|---|
| D-01 | 禁把 canvas 自繪示意當 3D 交付：3D 畫面一律來自 Kit WebRTC 串流、指令走 DataChannel。 |
| D-02 | hash route 一律無斜線（`#a1` 非 `#/a1`）；路由照 contracts §4 正典表。 |
| D-03 | 禁用記憶體 `go(id)` 假路由：每頁對應真 hash route，可深連結、可回退。 |
| D-04 | BCF 版本字串集中一處常數，UI 顯 `BCF 2.1`；3.0 須 buildingSMART 確認才升級。 |
| D-05 | 業務邏輯禁裸寫專案編號／測試識別碼（270/889/990/271 類）：由 coordinator config 判定 `local_fs` fixture 並標「測試資料」；MinIO 來源不因來源或編號自動標測試。 |
| D-06 | provenance 禁寫死前端：徽章由後端 provenance 驅動（`GET /api/provenance` 或資料內嵌欄位）。 |
| D-07 | 禁假按鈕：待建控制一律 `disabled + title`＋prov 標，無「可點但沒反應」。 |
| D-08 | 禁樂觀更新：busy → 等 API → 以回應事實重繪；失敗畫面資料不變、只顯錯誤。 |
| D-09 | 輪詢離頁必 `clearInterval`；fetch 失敗顯「上次更新時間·連線異常」、不清空舊資料。 |
| D-10 | 危險動作（插隊/重試/釋放/terminate/drain/move/批次建 issue/匯出）一律三段式 intent → confirm → audited。 |
| D-11 | A2 diff 引擎＝R2 簽核之自製多級鍵引擎（GlobalId→(is_a,Tag)→type+Name+loc，語意對齊 ifcdiff）；禁選型漂移；跨 schema 需求出現時再評估官方 ifcdiff（contracts §7）。 |
| D-12 | Issue 走單一共同出海口 schema（`source` 標 A1/A2/A3/A5/manual）；禁 per-App 獨立 Issue 型別。 |
| D-14 | AI 禁碰 source model：usd-code-mcp 一律寫 session layer；source 檔雜湊不變。 |
| D-15 | 每筆轉檔出 coverage 報告；禁宣稱 100% 無損；coverage 未建顯待建徽章。 |
| D-16 | browser 禁直連 governance `:49102`：一律走 coordinator `/api/governance/*` proxy。 |
| D-17 | 禁宣稱 session 無縫遷移：換 GPU＝terminate＋recreate（約 30–40 秒）；confirm 文案含成本；UI/API 不出現 live migration（contracts §6）。 |
| D-20 | 3D 高亮啟用四條件缺一即 disabled：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path。 |
| D-21 | 空狀態顯「目前沒有 X＋下一步」不補假列；404/501 顯待建徽章、非錯誤。 |
| D-22 | 拖放禁直接改前端狀態：drop 後彈 IntentDialog、確認才 POST intent；drop 規則函式先寫並有單測。 |
| D-24 | `stage matched` 判定紀律：必須等 viewer 端真實回報 `first_frame_at`；coordinator 不得推定；無證據不得標 matched。 |
| D-25 | coverage 數字語意義務：自我參照 coverage（如 `coverage_ratio=1` under usd_stage_enumeration）必附 selfref note（`conv-coverage-selfref-note`），禁當品質宣稱（同通用-1）。 |
| D-26 | dockerized 服務的 runtime env 只能走 compose 透傳（部署區頂層 `.env`）；改 service-local `.env` 對容器無效，禁以此宣稱已配置。 |
| D-27 | clash runtime probe 回 unavailable（含 `has_occ=False` 類原因）時必須 hard guard 顯示機器可讀原因；禁靜默回 0 碰撞。 |
| D-28 | `prov="todo"` 為 TS2322 編譯錯誤；文件層「待建」對映 `p1/p3/p4`，禁繞過型別。 |
| D-30 | `vi.mock` stub 給被 ref 掛載的元件必須用 `forwardRef`，否則 `ref.current` 恆 undefined；配 `vi.hoisted` 共享。 |
| D-31 | 雙來源選檔隔離：一邊失敗顯錯誤條、保留另一邊，禁默默換來源；來源切換後下游狀態清空回 idle；**選檔動作本身不觸發轉檔**。 |
| D-32 | 假指派禁令：schema 無對應欄位時，指派類 UI 一律 dashed 待建標＋title，禁 render 寫入無處去的下拉；狀態流轉只走後端 transition API 的證據型更新。 |
| D-33 | 連動證據只讀鏡射：跨頁證據以單一來源（`#sessions`／Runtime 遙測）只讀鏡射，消費端不自存、不推定；證據未齊控制 disabled；觸發類請求帶冪等鍵防重複；成功只認 viewer ack。 |
| 通用-1 | 品質數字必須有獨立分母；自我參照計數（分子分母同源）不得當品質宣稱，UI 須標注其語意（具體現況數值查 TRUTH §6）。 |
| 通用-2 | `fake_mapping`／mock 旗標（`mock=true`、`allow_fake_mapping=true`、`fake_mapping_count>0`、`mapping_method=fake_for_smoke_test`）一律當 fake 處理，嚴禁覆蓋真 `element_mapping.json`。 |
| 通用-3 | 文件矛盾／缺漏一律停下標註 `// TODO [SPEC-GAP]:`（列明衝突兩處），不自行臆測補實作；SPEC-GAP 清單隨 PR 揭露。 |

---

## §5 交付前檢查表（單張，每輪交付逐項核對）

> 本表為每輪交付的核對模板；核對結果寫進 PR body，不回寫本檔。未過項須修復，或明確記為「刻意待建（附理由）」。

- [ ] 1. hash route 無斜線；本輪 route 全數登記於 contracts §4 正典表，無未登記 route。
- [ ] 2. 待建控制一律 `disabled + title`＋prov 標記；無「可點但沒反應」的假按鈕。
- [ ] 3. 無樂觀更新：busy → 等 API → 以事實重繪；失敗時業務資料不變、只顯示錯誤（含 status code）。
- [ ] 4. 輪詢離頁有 cleanup；輪詢失敗顯「上次更新時間·連線異常」、不清空舊資料。
- [ ] 5. 危險動作全走三段式 intent → confirm → audited（body 帶 `reason`；move 文案含約 30–40 秒／重載 stage／短暫斷線）。
- [ ] 6. enum 後端逐字 echo，無自創值；`prov` 無 `"todo"` 字串。
- [ ] 7. 官方件邊界：A2 diff 走 R2 簽核之自製多級鍵引擎（語意對齊 ifcdiff，禁選型漂移，D-11）、BCF 走官方庫語意、3D 量測／批註／剖切／書籤／場景樹／屬性／串流走 Omniverse 官方件；無 web 端自製 3D 工具；無 `IfcConvert` 帶 `.usd/.usdc` 輸出。
- [ ] 8. Issue 走單一 schema（`source` 標來源）；無 per-App 獨立 Issue 型別；severity／status 值域未擅改。
- [ ] 9. 3D 畫面來自 Kit WebRTC 非 canvas 自繪；高亮四條件（DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path）齊備才 enabled；stage matched 只認 viewer 回報（D-24）。
- [ ] 10. 品質／覆蓋數字有獨立分母；未宣稱「100% 無損」；自我參照計數已標注（通用-1）。
- [ ] 11. 業務邏輯無裸寫專案編號／版本字串／識別碼（進設定或 fixture；版本字串集中一處常數）。
- [ ] 12. 本輪 `// TODO [SPEC-GAP]` 已全數列入 PR 揭露，未自行臆測補上。
- [ ] 13. **TRUTH 同 PR 已更新**（觸碰四服務 route／API 面時；§2(b)／§6 閘 2）。
- [ ] 14. **PR body 誠實邊界聲明已附**（§2(a)）。
- [ ] 15. **evidence tracked 已確認**（`git ls-files` 逐項驗；`artifacts/e2e/.gitignore` 預設擋 `*.png`、`*.json`、`*.zip`、`*.trace` 等全部 evidence 檔型別，未 tracked 一律 `git add -f`；無 dead reference）。

---

## §6 文件自身防腐（三閘＋守恆規則）

### 閘 1 — TARGET 純潔性

TARGET-* 三檔（contracts／shell／viewer）內**禁止出現對 repo 現況的建成宣稱**：

- 中文硬 gate：`rg -n -g 'TARGET-*.md' '已實作|已建成|已交付|已在|已落地|已於|已成立|repo 現況|PR #' docs/plans | rg -v '2026-07-09.*PR #319'` 必須 0 命中；唯一 allowlist 是 `TARGET-contracts.md` §1.1 逐字搬運的 approved-exception row。
- 英文補充 gate：`rg -ni -g 'TARGET-*.md' '\b(as-built|built|implemented|delivered)\b' docs/plans` 的每個命中都必須是 `NOT BUILT` UI literal、Prov 詞彙映射，或明確否定句；任何正向 repo 建成宣稱（例如 `唯一 built 景`、`hero built`、互動卡標題 `as-built`）一律阻擋。

現況一律改為引 TRUTH 對應錨。兩條 gate 的 CI 化待列入 BACKLOG §3；上線前由 reviewer 於 docs PR 手動執行。

邊角裁決：「待建」是需求屬性（本規格要求新增），不受此限；「NOT BUILT」字樣在 TARGET 檔僅允許作為**佔位頁 UI 的呈現需求**（規定頁面要顯示什麼），不允許作為現況陳述。

### 閘 2 — TRUTH 同步（**不可裁減項**）

產品 PR 觸碰 `web-viewer-sample/`、`bim-review-coordinator/`、`governance-service/`、`bim-streaming-server/` 的 route／API 面＝**必須同 PR 帶 `TRUTH.md` diff**。這是防止 TRUTH 淪為又一份 stale 副本的唯一結構性保險，任何精簡輪都不得裁掉本閘。

wiring 進 pr-review-agent 之前，先以本節紀律＋§5 檢查表第 13 項執行（誠實揭露：未 wiring 前屬人工紀律，TRUTH 存在 stale 風險）；wiring 待辦列 BACKLOG §3。

### 閘 3 — 就地改寫鐵則

任何核心檔發現錯誤＝**直接改正本＋同 PR 刪除被取代文字**。以下四種結構若被新增為 7 個核心檔本身的效力／維護機制，或被新增成平行需求源＝review 直接退回：

1. 增補層（在檔頭或檔尾疊「本節效力低於……」的新層）；
2. 禁寫清單（列舉「不得寫 X」的 prose 條目堆）；
3. 勘誤表（正文不改、另立表格記錯誤）；
4. 裁決帳（跨檔效力裁決的流水帳）。

**適用邊界**：本閘禁止的是「新增或延長平行效力層」，不是禁止字詞出現在規則說明、移轉對照或歷史引用。README §6 明列 keep 原地的 SaaS 六檔、審批報告、prototype 與歷史資產屬 retained supporting/history；其既有 legacy 狀態聲明不算 7 核心檔違規，但不得覆寫核心檔、不得進入 AI coder 必讀路徑，後續修改也不得再延長增補鏈。新增第 8 個核心檔或新的低效力需求檔仍是 blocker。

### 守恆規則

1. **行數預算**：7 個核心檔的行數上限以 README §5 預算表為準（該表即 CI 行數 gate 依據）；任一檔超限＝紅燈，處置是刪減或申請調整預算，不是拆增補檔。
2. **檔數守恆**：新增第 8 個核心檔＝需使用者明確授權的邊界事件；預設答案是「塞回既有 7 檔或不寫」。
3. **TARGET 凍結點規約**：TARGET 各節帶 `<route>@v<N> frozen <date>` 凍結點行；改版＝bump 版號＋一行明示作廢範圍，詳細規約引 TARGET-shell §0（contracts 全檔凍結點規約引 contracts §0），本檔不重抄。

---

*本檔為 docs/plans 唯一紀律檔。維護方式：發現新的長壽陷阱→補一條 §4 防線＋必要時一項 §5 檢查項；發現本檔條目與 contracts／TRUTH 衝突→依 §6 閘 3 就地改正本。*
