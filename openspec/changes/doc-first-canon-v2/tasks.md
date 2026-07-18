# Tasks — doc-first-canon-v2

> **DoD 兩段化（全 task 通用）**：每條 task 的 DoD 區分 `draft-submitted`（AI 草稿已提交供審）與 `user-adopted`（使用者裁決採納／正本已改）。**本 change 的機器驗收 gate 只綁 `draft-submitted`；`user-adopted` 為追蹤狀態，明確排除於機器 gate 之外。** 本 change 完成語意＝全部 task 達 draft-submitted；archive 前 MUST 確認使用者對採納／退回已表態（讀正本 v2 version-bump commit 存在性，見 design.md），未表態不 archive。
> **採納訊號**：`user-adopted` 權威 artifact＝正本 v2 的 version-bump commit（merged、diff 觸及手寫正本、含版本號＋日期 bump、使用者核准/PR approve）；退回 artifact＝提案 PR 的使用者 close/comment 裁決記錄。

## 0. 前置 hard gate（critical-path，先於全部改寫 task）

- [x] 0.1 **Task 0 錨點可行性 spike（hard gate）**（2026-07-18 PASS,證據見 prep-evidence.md;補充:Hi-Fi 檔零 id 錨,植錨方案涵蓋雙檔）：以 repo 內實檔驗證 `.dc.html` 的錨點承載力。三段結論制入 design.md：(1) 章級穩定錨已證實存在（`.dc.html` 僅 `sec1..sec8`）、需求/區塊級錨不存在；(2) 首選＝v2 草稿自帶 `data-canon-id` 類細粒度穩定錨（屬提案文字一部分、隨使用者採納生效、與 R-A1 相容）；(3) sidecar anchor map 僅為使用者拒絕在正本植錨時的末位降級，design.md 明記其與 `file:line` 同屬易腐、不得作為 R-C1 主要載體。**DoD/draft-submitted**：植錨方案已入 v2 草稿或降級已記錄於 design.md，未完成即為早停 blocker。**DoD/user-adopted**：使用者接受植錨方案。
- [x] 0.2 **PF-1/PF-2 硬前置檢查**(2026-07-18 PASS:main 仍 v3 header @ spec.md:8,PF-2 未觸發;開 PR 前複跑)：實跑 `grep -n "Workflow v3 and product design artifacts have distinct, non-overlapping authority" openspec/specs/documentation-source-of-truth/spec.md` 確認 main 仍為 v3 header；若已變 v4 則本 change MODIFIED delta 先 rebase 對準 v4 再驗。**DoD/draft-submitted**：grep 輸出附於 PR body，header 狀態確認。
- [x] 0.3 **MODIFIED 範圍對齊檢查**(2026-07-18 PASS:2 MODIFIED header 逐字=main:8/31,其餘 4 條未觸碰,validate --strict 綠)：實跑 `openspec validate doc-first-canon-v2 --strict`＋diff，確認只 MODIFY `documentation-source-of-truth` 6 條中之 2 條（「Workflow v3…」「文件分工調整必須走 PR 治理流程」）、每條 header 逐字重現、其餘 4 條未觸碰；任何新增治理需求一律入 ADDED。**DoD/draft-submitted**：validate 通過＋範圍 diff 附 PR body。
- [x] 0.4 **R-A4 可回復基準建立＋dry-run restore**(2026-07-18 PASS:tag canon-v2-baseline-20260718 @ 0d24fb6,dry-run restore diff 空)：改寫前對兩份 `.dc.html`＋`docs-plans-README.md`＋`ai-bim-governance.css` 建立 git tag 或文件樹外 `.bak-<timestamp>`、回報路徑；執行一次 dry-run restore 證明 restore 後 diff 為空。**DoD/draft-submitted**：backup path/tag 記錄＋dry-run restore 驗證輸出附 PR body。

## 1. 變更控制 capability（design-canon-change-control）

- [x] 1.1 撰寫 `design-canon-change-control` spec delta（R-A1 手寫正本寫入邊界／R-A2 機器快照雙旗標／R-A3 support.js 禁改／R-A4 改版可回復）(2026-07-18 PASS:4 requirement/9 scenario,validate --strict 綠;3fc29a8 原「四項檢核零缺漏」結論已被三次 enforcement scenario 補強推翻——7d2f7e7 補 R-A3 support.js 對稱缺口、858f16f 補 R-A1「自行 merge」對稱缺口、本次補 R-A1「直接觸及正本檔即違規退回」direct-edit 對稱缺口;本輪驗證結果記錄,後續輪次可再補強)。**DoD/draft-submitted**：spec delta 完成＋validate 通過。**DoD/user-adopted**：使用者核准新 capability。
- [x] 1.2 撰寫 `AGENTS.md` 參照鏈修正草稿：指回 doc-first 權威序與 design-canon-change-control 條文（提案供審，不逕改 main）。(2026-07-18 PASS:`drafts/AGENTS-refchain.v2-draft.md` 3 段逐字對照——§3 Runtime/product behavior truth 定義句 AGENTS.md:132＋優先順序清單 AGENTS.md:134-142 兩段現行→建議＋1 段 design-canon-change-control R-A1 新增參照；已核對 `git diff main -- AGENTS.md` 為空、worktree 與 main 逐字相同；AGENTS.md 本體未改動)。**DoD/draft-submitted**：AGENTS.md 改寫草稿以 PR diff 提交、標「待使用者核准」。

## 2. documentation-source-of-truth MODIFIED＋ADDED（權威翻轉＋保存性）

- [x] 2.1 撰寫 MODIFIED「Workflow v3…」body：翻為 doc-first 權威序、內部裁決序、保留誠實鐵律半句＋非矛盾 scenario。**DoD/draft-submitted**：delta 完成＋header 逐字重現＋validate 通過。(2026-07-18 PASS,三點逐一驗證:(a) header @ delta:3 與 main:8 位元組級逐字一致(含 CRLF,經 python rstrip(\r)雙向比對確認);(b) body 含 doc-first 權威序 `docs/plans`=唯一需求權威／code 偏離=待修 implementation gap(delta:5)與內部裁決序 視覺=Hi-Fi+css 最高／行為=設計文件§01–§08 為權威(delta:7);(c) 誠實鐵律半句「亦不得以文件宣稱 runtime 已完成」原樣保留(delta:9)＋非矛盾 Scenario「誠實鐵律與 doc-first 非矛盾壓測」(delta:23-27)證明「標 planned」與「判待修 gap」並存無矛盾;三點皆已在原提案 commit 378a9c1 到位,本次為驗證非新寫,body 零修改;`npx openspec validate doc-first-canon-v2 --strict`綠)。
- [x] 2.2 撰寫 MODIFIED「文件分工調整必須走 PR 治理流程」body：加手寫正本面 cross-ref design-canon-change-control R-A1。**DoD/draft-submitted**：delta 完成＋header 逐字重現。(2026-07-18 PASS,兩點逐一驗證:(a) header @ delta:29 與 main:31 位元組級逐字一致(含 CRLF,經 python rstrip(\r)雙向比對確認);(b) body 含手寫正本面 cross-ref design-canon-change-control R-A1——第二段(delta:33)明文引用該 capability R-A1 並摘述其「不自行 merge、不原地編輯」約束，另附專屬 Scenario「AI 改寫手寫正本面」(delta:45-48)以 MUST/MUST NOT 語句重申，雙重承載且語意對齊 R-A1 原文「使用者專屬／AI 只能提案不自行 merge」(design-canon-change-control spec.md:5);兩點皆已在原提案 commit 378a9c1 到位,本次為驗證非新寫,body 零修改;`npx openspec validate doc-first-canon-v2 --strict`綠)。
- [x] 2.3 撰寫 ADDED R-B1（偏離處置序＋三態分類 code-defect/canon-defect/undecided）、R-B2（誠實鐵律非矛盾）、R-B3（carve-out 清單＋diff 斷言）、R-B4（需求正本邊界）、R-B5（R2 三態＋ProvTag 詞彙＋planned 三態 class）、R-B6（內嵌 viewport 防護＋spectator/issues 裁決）。**DoD/draft-submitted**：各 ADDED requirement ≥1 scenario＋validate 通過。(2026-07-18 PASS,六條逐一核對:R-B1 三態分類 code-defect/canon-defect/undecided 齊全＋cross-ref MODIFIED「Workflow v3…」＋2 scenario,對映裁1/裁2/風險表 canon-defect 出口,零修改;R-B2 誠實鐵律半句保留＋非矛盾證明＋1 scenario,零修改;R-B3 原僅列 §04 payload 委任/§01 鐵律1–3/README §3.4 凍結面/§07:575 deferral 四項,**缺誠實鐵律半句**——已補入 carve-out 清單第 5 項(canon 面＝README §3.5 誠實子句「不得以文件宣稱 runtime 已完成」,item 23/task 3.2 翻轉 §3.5 權威語意時 MUST 語意保留,斷言標的＝README §3.5 前後 diff;規範全文＋非矛盾證明 cross-ref R-B2、不重複文字)＋既有 scenario 覆蓋;R-B4 需求正本邊界(docs/plans=全部/外部 design repo=唯讀 authoring origin)＋1 scenario,對映裁4,零修改;R-B5 R2 三態(existing→整合/repo內可建→全棧/外接引擎才mock)＋ProvTag 7 值(asbuilt/artifact/demo/p1/p15/p3/p4)＋data-prov＋planned 三態 class enum(含 unclassified)＋OQ-1 asbuilt-partial 不採用＋2 scenario,對映裁6/裁8,零修改;R-B6 EmbeddedViewer iframe 跨-origin signaling* 消毒等價防護/KIT_SPECTATOR_COUNT 預設0/邀請連結真複製 navigator.clipboard/streamRole=spectator/issues 權威入口 unified #a1?dock=issues＋2 scenario,對映裁3/裁9/裁10,零修改;`npx openspec validate doc-first-canon-v2 --strict` 綠)。
- [ ] 2.4 **carve-out diff 斷言（R-B3 補償閘）**：對 carve-out 清單逐條列改寫前後語意等價檢核（行為面不變判準）；顯式化既有事實補列（item 14 類）不算誤動。**DoD/draft-submitted**：diff 斷言清單可執行、任一條被誤動即 blocker。

## 3. Wave 1（P0，低風險高解毒——先清障使 Wave 2 建於已清障權威條文上）

> Wave 為優先序/所屬批次欄位，MUST NOT 使任一 task 失去獨立追溯性或被合併。

- [ ] 3.1 **item 22（核心翻轉）**：§08 權威順序表改寫為 doc-first（現寫 code＋tests 第 1、書面需求第 4 → 翻為 docs/plans 需求第 1、code＋tests 為 runtime 現況查證面）。**DoD/draft-submitted**：§08 該區塊 draft diff＋Crosswalk 對號。
- [ ] 3.2 **item 23（核心翻轉）**：docs-plans-README §3.2/§3.5「現況行為權威＝code＋tests；設計文件＝目標權威」語意改寫為 doc-first（需求權威＝docs/plans；code 偏離＝待修 gap）。**DoD/draft-submitted**：README 區塊 draft diff＋Crosswalk 對號。
- [ ] 3.3 **item 24（核心翻轉）**：刪除 §03 命名核對 carve-out「以程式碼為準，不回頭改碼」。**DoD/draft-submitted**：§03 該區塊 draft diff（刪除）＋Crosswalk 對號。
- [ ] 3.4 **item 9**：§08 R3 收斂至 `ProvTag` 詞彙＋7 值 `Prov`＋`data-prov=fixture|live`；`asbuilt-partial` 外接待決值以 §08 R3 內顯式 non-normative『Open Decision 註記塊』承載、normative enum 保持封閉。**DoD/draft-submitted**：§08 R3 區塊 draft diff＋normative enum 封閉檢查。
- [ ] 3.5 **item 4**：§07:576 `docs/ai_journal/changes.jsonl` 從未存在 → 刪除或改指實存留痕機制。**DoD/draft-submitted**：§07 區塊 draft diff。
- [ ] 3.6 **item 5**：§07:578/§08:673 stale 編號（align tasks 2.4–2.8/3.4，現行 §2 只到 2.5、archive gate＝5.3）改寫；§07:579 stale「已知不一致」註記刪除。**DoD/draft-submitted**：§07/§08 區塊 draft diff。
- [ ] 3.7 **item 8**：§03:214 stale 自我糾錯刪除（§04:279 早標「已實作」）。**DoD/draft-submitted**：§03 區塊 draft diff（刪除）。

## 4. Wave 2（結構性重寫——§03/§08 大改寫，建於 Wave 1 已清障權威條文上）

- [ ] 4.1 **item 1**：§03 Route Map＋CH-G 收斂表改寫為「目標路由＋現況對照」，CH-G 標未做（`#/workspace`、`#/ops`、`#/app/:slug` 與七條舊 hash 重導全未落地，唯 `/ui/console`→301 真）。**DoD/draft-submitted**：§03 區塊 draft diff＋Crosswalk。
- [ ] 4.2 **item 2**：§06 `LineagePublicationOutbox` 六態標 planned（coordinator 僅 3 態；六態只在 rvt-ifc-usdc-lineage 提案）。**DoD/draft-submitted**：§06 區塊 draft diff。
- [ ] 4.3 **item 3**：§03:201 `resolveGovPanelState` gate 失真改寫（gate 只護 legacy overlay，unified docks 零 gate）＋「unified docks 接真 API＋gate」列 follow-up。**DoD/draft-submitted**：§03 區塊 draft diff。
- [ ] 4.4 **item 6**：§02 拓撲修正（governance-service＝host-native 非 Docker Web-Plane 容器 `compose.host-kit.yml:16`、MinIO＝外部非 compose service）。**DoD/draft-submitted**：§02 區塊 draft diff。
- [ ] 4.5 **item 7**：§06 `IfcReadyRecord`/`ConversionJob` status enum 對齊實碼。**DoD/draft-submitted**：§06 區塊 draft diff。
- [ ] 4.6 **item 10**：§08:727 `features/a1..a10` 目錄不存在、14 共用元件 0/14 → 標「目標結構/待抽取」＋補「`src/console/` 現況→目標」遷移方向。**DoD/draft-submitted**：§08 區塊 draft diff。
- [ ] 4.7 **item 11**：§08:679 Task 0–12「對映 §07 CH」無實質 crosswalk → 補對照表或刪宣稱。**DoD/draft-submitted**：§08 區塊 draft diff。
- [ ] 4.8 **item 12**：§08:709 A4「語意服務另接」→「deterministic 已全棧落地；semantic＝外接 LLM（對應 a4-semantic-search-model-qa change）」＋§08:707 A5–A10「前端完整」誤導改準確。具名外部依賴一律 genericize 為「外接 LLM」。**DoD/draft-submitted**：§08 區塊 draft diff＋無具名廠商依賴。
- [ ] 4.9 **item 13**：§04 tests/contracts 僅 2 檔、A 軸 API 零契約 →「最高標準」語意誠實化，A 軸契約標 planned。**DoD/draft-submitted**：§04 區塊 draft diff。
- [ ] 4.10 **item 14**：§04 補 element-mapping/for-session 家族（coordinator 直服、轉打 `:49101` 非 governanceProxy→`:49102`）、apply-overlay＝501 client-side-only、A3 create＝201、「PROXY /*」→「顯式白名單」語意、`:49100` WebRTC signaling 為合法瀏覽器直連埠（R2 補列）。此為顯式化既有事實補列（R-B3 判 normative(doc)、不算誤動 carve-out）。**DoD/draft-submitted**：§04 區塊 draft diff。
- [ ] 4.11 **item 15**：§01 鐵律 3「byte-for-byte」→行為級凍結描述（302/301/參數白名單）；`ui-open-regression.spec` 接 CI 列 follow-up；無測試護欄空窗標 known gap。**DoD/draft-submitted**：§01 區塊 draft diff＋known gap 標註。
- [ ] 4.12 **item 16**：README §3.3 `--ec-*`→`--ab-*`/`ai-bim-governance.css`（token 真相源）＋README §1 補列 `ai-bim-governance.css`（production 投影＋真實 import 雙身分）。**DoD/draft-submitted**：README 區塊 draft diff。
- [ ] 4.13 **item 17**：§03 i18n「字典置 `console/i18n.ts`」→更正為 `fixtures.ts` 現況或明定搬遷。**DoD/draft-submitted**：§03 區塊 draft diff。
- [ ] 4.14 **item 18**：§07 分期補 CH-H 家族（code 已出貨 CH-H1/H2/H3 semantic viewer）＋內嵌 viewport 立新期。**DoD/draft-submitted**：§07 區塊 draft diff。
- [ ] 4.15 **item 19**：§03 雙軌現況誠實入文（unified＝fixture 殼、真整合活在 legacy 深連結 `#a1-workbench`/`#semantic-search` 無 nav 入口）＋收斂 follow-up。**DoD/draft-submitted**：§03 區塊 draft diff。
- [ ] 4.16 **item 20**：metadata-only blocklist 可繞過→allowlist 化列 follow-up。**DoD/draft-submitted**：正本對應區塊 draft diff＋follow-up 具名。
- [ ] 4.17 **item 21**：Hi-Fi A4 標 LIVE vs 正本分界依 A4 hybrid 事實改寫。**DoD/draft-submitted**：對應區塊 draft diff。

## 5. 彙整、載體與撈回

- [ ] 5.1 **§03 merge-assembly**：items 1/3/8/13(§04 不同章)/17/19/24 中觸及 §03 者達 draft-submitted 後，組裝單一連貫 §03 全文；DoD＝章節全文 diff 恰為各區塊 diff 之聯集、零新增語意。**DoD/draft-submitted**：§03 全文 diff＝聯集可機器比對。
- [ ] 5.2 **§08 merge-assembly**：items 9/10/11/12/14(§04)/22 中觸及 §08 者達 draft-submitted 後，組裝單一連貫 §08 全文；DoD＝聯集、零新增語意。**DoD/draft-submitted**：§08 全文 diff＝聯集。
- [ ] 5.3 **gap ledger 建立（R-C1）**：獨立 ledger 檔，欄位含 classification/status/verified-as-of=2026-07-17/triage 優先序/符號級錨/adopted-in；21＋3 項 `file:line` 證據集中於此，正本內文零裸行號。CI 驗證掛 `test-agent-governance-check` 延伸。**DoD/draft-submitted**：ledger 完成＋正本內文無裸 file:line。
- [ ] 5.4 **normative Crosswalk 表（R-C2a）**：24 列，欄位＝失真項 ID/章節穩定錨/區塊錨/處置手法(normative(doc)|descriptive(tests-delegated))/可驗 DoD/所屬 Wave/對應裁決編號；每列獨立可勾。**DoD/draft-submitted**：24 列全對號、無缺格。
- [ ] 5.5 **24×11 追溯矩陣（R-C2b）**：證明零缺格；裁決 1 掛「1 MODIFIED＋1 ADDED」。**DoD/draft-submitted**：矩陣零缺格。
- [ ] 5.6 **裁決 7 撈回（R-C4）**：`git show a271e46^` 實查 TARGET-shell.md/TARGET-viewer.md/TARGET-contracts.md ＋ A5–A10 domain 契約（TelemetrySample/WorkOrder/ScheduleActivity/CaptureJob·Deviation/DatasetJob/RobotMission/Scenario/Issue source enum/A8→DatasetJob 例外）；逐句標 source commit、對照 11 條裁決 re-審、三值判定、統一標 planned；撈不到標「來源不可考、不撈回」。**DoD/draft-submitted**：撈回清單附 source file:line＋三值判定結果。
- [ ] 5.7 **Open Decisions 專章（R-B5/OQ）**：OQ-1（asbuilt-partial 不採用、§08 R3 non-normative 註記塊）、OQ-2（NVIDIA 綠授權盲區，僅 design.md＋ledger）；預設不採用、不逕自定案亦不逕自否決。**DoD/draft-submitted**：Open Decisions 表完成＋normative enum 封閉檢查。

## 6. 收斂與驗收

- [ ] 6.1 **planned 無裸標檢查**：正本 v2 任一 `planned` 標記皆附 R2 三態 class；無裁決背書者標 `unclassified` 綁 ledger triage。**DoD/draft-submitted**：無裸 planned。
- [ ] 6.2 **最終 `openspec validate doc-first-canon-v2 --strict` 實跑通過**；11 條裁決逐一對號索引表完成。**DoD/draft-submitted**：validate 輸出附 PR body。
- [ ] 6.3 **PR gate 預備**：pr-review-agent body-evidence 表預填誠實值、Requirement source＝本 change specs delta（doc-only paths 自我滿足）。**DoD/draft-submitted**：PR body 完成。
- [ ] 6.4 **（軟性、非機器 gate）J1–J5 旅程端到端走查**：走查整合後正本 v2 可端到端讀通、跨 task 無互斥；不列入完成 gate。**DoD/draft-submitted**：走查記錄（軟性）。
- [ ] 6.5 archive 前確認使用者對採納/退回已表態（讀正本 v2 version-bump commit 存在性）；未表態不 archive。**DoD/user-adopted**：version-bump commit 存在或退回記錄存在。
