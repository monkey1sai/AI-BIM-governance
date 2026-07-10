# plans×code 修復輪 — 設計與裁決紀錄（2026-07-10）

> 本檔是 2026-07-10「docs/plans × 工作區 code 全面分析」後的修復輪 spec：記錄 7 視角分析結論、使用者 grill 裁決帳、範圍邊界。
> 對應 plan：`docs/superpowers/plans/2026-07-10-plans-code-remediation.md`。
> 分析報告 artifact：https://claude.ai/code/artifact/77125fe9-1f94-4ee5-93c1-b7725af006f7

## 1. 背景（分析輪結論摘要）

7 個唯讀視角（路由契約／誠實標記／凍結契約+MinIO 四釘子／里程碑缺口／SaaS+邊界+紀律／架構熱點／資深評審）對照 `docs/plans/*` 與工作區 code：

- 合規面大體健康：SaaS 零漂移、六服務埠界一致、四釘子落實、路由 22 條幾乎全對齊、root contract 85 passed。
- 兩個 code×最高效力規格正面衝突（A1 內嵌 3D、A2 自製 diff 引擎）→ 本輪以「承認現況、修文件」裁決收口。
- 一批 plans 明文要求但 code 未做到的合規調整（測試資料標記、GovernanceOverlay 編號撞名、typecheck 缺口等）。
- 一批 code 已跑在文件前面的 docs stale（A.1.1 `#conv` 列為首）。
- 程式設計水準總評：中上、局部資深；服務合併結論：現在一對都不該合。

## 2. 裁決帳（2026-07-10 grill-me，使用者逐項裁決）

| # | 議題 | 裁決 |
|---|---|---|
| R1 | A1 內嵌 3D viewer（PR #319 vs IX-3D-01／2026-07-02 解耦設計） | **承認新決策**：修訂 IX-3D-01（允許 evidence-gated、手動啟動的 a1-inline viewer）、手冊 §5.A 同步、`POST /api/external/ifc-ready/:jobId/review-session` 補登 exception ledger。code 不動。 |
| R2 | A2 diff 引擎（自製多級鍵 vs 鐵律 #9/D-11「一律用 ifcdiff」） | **保留自製引擎**：修鐵律 #9 與 D-11，補選型理由（三級配對抗 GUID churn＋moved 責任語意＋直接對接 Issue/3D schema）與已知限制（跨 schema 不保證正確）；另排驗證實驗（270 專案 ver000001 vs ver000002 真實版本檔＋ifcdiff 對照），結果回寫文件。 |
| R3 | 凍結契約 exception ledger 漏登 | **追認補登**：commit `4949b9b`（rule-run history + source_metadata）與 PR #319 端點兩筆，各附 Requirement source。 |
| R4 | NAV 群組（code 分組 vs A.1.1「群組」欄相反） | **路由表 A.1.1 為準，改 code**：`data.ts` 分組重排＋測試＋E2E 證據。 |
| R5 | 衛生範圍 | 四項全納：tracked 殘留 git rm／untracked 殘留清單化（確認後刪）／kit-manager-api 補 golden path／stage_composition 抽單一契約。 |
| R6 | 凍結面重構 | F1（app.ts 巨石拆分）本輪不做，**立加性慣例**寫進手冊 §1；F3（`_RUN_CACHE` 匯出 409）**簽核修復**（cache miss 時由 DB 重建）並登記 exception。 |
| R7 | 品質小修 | 全納：F12（fetch timeout 下沉）、F2（config 預設機密 prod fail-fast）、S3（跨服務 enum parity 測試）、F7（8011 listener 根因）、S2（externalIfcReadyStore 持久化）。 |
| R8 | 測試資料標記前提修正 | **MinIO＝真實資料監控**（鐵律 #7 該句依現實改寫，MinIO 側不標）；local_fs storage 270/889/990/271＝本地測試 fixtures，A1 local_fs 來源加「測試資料」badge，清單由**後端 config 驅動**（不裸寫編號，守 D-05／鐵律 #3）。 |
| R9 | GovernanceOverlay 編號撞名 | **對齊權威 A1–A10**：overlay 條目重排成與 `data.ts` 權威語意一致（A4/A8 依權威 p4 disabled；「治理分/完整性」「Issue/BCF」等真功能重新歸屬 A1；碰撞條目對齊 A3 clash 現況）。 |
| R10 | 執行方式 | 本 session、本 worktree（`worktree-remediation-plan-20260710`）、Claude Code 直接執行；PR 依 Wave A–D 切，依慣例 auto-merge。 |

## 3. 範圍外（本輪明確不做）

- 前端架構 W1–W6（pages.tsx 拆頁、route table-driven、usePolledJob、http.ts、data.ts 搬移）→ 延後另立架構 plan（W1 綁 A1 v2 in-flight plan）。
- F5（list_runs SQL 下推）、F8（converter adapter 拆類）、F1（app.ts 拆 router）→ 延後。
- in-flight 三份已核可 plan（A1 closeout bridge/assignee、A2 assignee consume、A3 clash ifcclash）→ 已有 plan，不重複、不搶跑。
- 規則庫擴充至 ≥10 條 → 等 O2 工作坊定案。
- 服務合併 → 裁決為不合併；kit-manager-web 收斂記觸發條件，不在本輪。

## 4. in-flight 分支碰撞檢查（2026-07-10）

`docs/codex-governance-auto-update-design`、`fix/deploy-rebuild-worktree-e2e`、`fix/r1-governance-scan-scope` 與本輪碰撞面**零檔案重疊**。唯一鄰接：`fix/deploy-rebuild-worktree-e2e` 新增 `scripts/tests/test-rebuild-test-deploy.ps1`（未改 deploy.ps1 本體）——Wave C 的 golden-path task 執行前須確認該分支 merge 狀態，已 merge 則將其測試納入回歸。

## 4.1 落地紀錄

- **Wave A**：PR #321 merged（2026-07-10）——spec+plan＋R1/R2/R3/R6/R8 文件落地＋docs stale 同步。
- **Wave B**：本 spec 隨 PR-B 更新——B1–B10 全數落地；發現修正：F4（db.py busy_timeout）實測為**誤報**（Python `sqlite3.connect` 預設 `timeout=5.0` 即 5000ms，與 IssueStore 對稱），改留回歸守門測試；W4 改以 `coordinatorUrl()` 統一 base（保留狀態碼原樣顯示語意，較原 plan 的 typed-client 改寫更小）。
- **Wave D**：D1 fetch timeout 下沉（15s，AbortSignal.timeout）；D2 production 預設機密 fail-fast；D3 enum parity 守門（root contracts）；D4 externalIfcReadyStore 持久化（**env opt-in**——未設 `EXTERNAL_IFC_READY_STORE_PATH` 維持 volatile，app.ts 零變更；載入時 in-flight 誠實調和）；D5 轉檔 Kit 停用 :8011 HTTP listener（Kit MCP 驗證鍵名；實跑回歸留待部署區重建）；D6 實驗完成——**兩組真實版本零 GUID churn、兩引擎輸出同構、自製 47s vs 官方 183s（條件不對等）**，三級配對屬防禦性設計尚無自家資料實證（詳 `artifacts/2026-07-10-a2-diff-vs-ifcdiff-experiment.md`），已回寫鐵律 #9。
- **Wave C**：C1 tracked 殘留 ×5 git rm（`artifacts/git-cleanup-*`/`audit-wip` 實為 untracked→歸 C2）；C2 使用者裁決三組全刪，已執行（殘餘：`.tmp/pending-delete-*` 內 4 個 pytest 快取目錄 ACL 鎖需 admin，指令見 `artifacts/2026-07-10-untracked-cleanup-list.md`）；C3 kit-manager-api 入 golden path＝deploy.ps1 **Phase 4c-2**（原 4d 已是 docker compose，插序修正）＋`Start-HostNativeKitManager`＋stop-all 服務表，Parser 驗證 OK、deploy 實跑留待下次重建口令；C4 契約檔實名 `streaming-datachannel-events.md`，鏡像站點實為六處（完整 ×4＋token 級 ×2）。

## 5. 驗收總則

- 每個 code task 附最小測試與驗證指令；user-facing 變更（NAV 分組、overlay、A1 badge、A6 卡）須附 branch 隔離 stack 的 Playwright/headless 截圖證據（`artifacts/e2e/`，PNG 需 `git add -f`）。
- 凍結檔改動僅限 R1/R3/R6 簽核項，PR body 引用本 spec 為 Requirement source。
- 每 wave 一個 PR：PR-A（spec+plan+裁決文件落地+docs stale）→ PR-B（合規 code 修）→ PR-C（衛生+golden path）→ PR-D（品質小修+實驗）。
