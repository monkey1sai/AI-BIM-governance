# 審批報告 — docs/plans AI-coding 文件體系重設計（2026-07-10 授權 · 2026-07-13 落地）

> 歷史審批紀錄（無效力；活的結論已內化進 TRUTH/TARGET/PROCESS/BACKLOG 正文）。
> 本報告是本輪重設計的唯一裁決追溯來源。

## §1 授權與動機

- **使用者指令（2026-07-10，效力最高）**：對開發進度與結果非常不滿意，指示以 `ai-bim-governance-prototype.html` 與 `ai-bim-geo-viewer-prototype.html` 兩份原型為基準，重新設計 docs/plans 的 AI coding 文件體系。此指令授權重建/覆寫既有 plans 文件（含原「非使用者指令不得重建」的互動實作規格）。
- **診斷關鍵證據**（多 agent 勘查，詳 git history 本 PR 描述）：2026-06-01 起改文件/治理的 commits（136）多於改四個產品服務的 commits（105）；舊 16 檔（約 449KB／4,627 行）以三輪「不動正文＋疊增補層」改版累積出 README §1.1 裁決帳、各檔禁寫清單與跨檔效力序，單一任務平均需跨讀多檔多跳。

## §2 設計程序（ultracode 多 agent）

5 盤點（殼層原型逐頁／viewer 原型逐區／16 檔病理／repo 實況／失敗根因）→ 4 架構提案（垂直切片工單制／契約中心／現況-目標分離／最小核心）→ 3 評審（可執行性／抗腐化／保真與遷移風險）→ 仲裁合成 → 7 檔撰寫 → 每檔誠實性＋可執行性雙驗證（45 findings、23 fixed）→ 全域批評（9 findings、7 fixed）→ 主迴圈人工複核與增量修正。

**勝出架構＝「壽命正交三分」**（評審一致最高分：現況/目標/紀律分檔，結構性根絕增補層腐化），並移植他案精華（per-route 垂直切片欄位、凍結點語法、防腐三閘、計數核對閘）。

## §3 新體系（核心 7 檔，合計約 1,530 行 vs 舊核心 6 檔約 4,600 行）

| 檔 | 角色 | 行數上限 |
|---|---|---|
| `docs-plans-README.md` | 入口 | 200 |
| `TRUTH.md` | 現況帳本（唯一可寫 BUILT/PARTIAL/NOT-BUILT） | 260 |
| `TARGET-contracts.md` | 全域凍結契約 | 420 |
| `TARGET-shell.md` | 殼層 22 route 垂直切片 | 950 |
| `TARGET-viewer.md` | viewer 七區塊＋AC-1~21 | 360 |
| `BACKLOG.md` | 缺口佇列＋OPEN 決策 | 220 |
| `PROCESS.md` | 紀律／DoD／防腐三閘 | 320 |

刪除 6 舊正本：互動實作規格與標準對齊／開發軌跡與執行計畫／設計規格／實作紀律與技術債防線／design-system-對齊矩陣／前端對齊DS-保留後端-實作手冊（去向對照＝README §7；原文 git history）。keep 原地：兩份 prototype HTML、saas-* 六檔、審批報告、nvidia-cosmos-diagram.jpg。

## §4 刪除前驗證閘（五條，2026-07-13 全過）

| 閘 | 結果 |
|---|---|
| (a) 計數核對 | 凍結契約 13 條＋approved exceptions 4 筆（唯一刻意差異＝session enum 更正誤植，見 contracts §2）；正典路由 22＋別名 9＋獨立保留頁 1；IX 卡 30 張（殼層 21＋IX-3D 5＋IX-TN 4）逐張落點；NOT BUILT 硬清單 12；viewer AC 21 |
| (b) NOT BUILT 反向 grep | 新 7 檔零「已交付/已實作」誤寫 |
| (c) TARGET 純潔性 gate | 中文正向建成詞排除 contracts §1.1 approved-exception 的 `PR #319` 逐字列後 0 命中；英文 `as-built\|built\|implemented\|delivered` 命中逐筆只允許 NOT BUILT UI literal、Prov 詞彙映射、狀態機 token 或明確否定句，零正向 repo 建成宣稱 |
| (d) 行數預算 | 7 檔全數低於上限（README 99／TRUTH 104／contracts 372／shell 478／viewer 285／BACKLOG 67／PROCESS 154） |
| (e) evidence tracked | TRUTH 引用之 `artifacts/e2e/*` 16 個精確檔案逐一 `git ls-files` 確認 tracked；目錄／wildcard aggregate 另列、不冒充單檔證據 |

## §5 本輪主迴圈裁決（撰寫後增量修正，逐項可覆核）

1. **R2 對齊**：workflow 初稿誤取 stale「禁自寫 diff／一律 ifcdiff」；已依 2026-07-10 R2 使用者簽核裁決（A2＝自製多級鍵引擎，語意對齊 ifcdiff）更正 contracts §7（bump v3）、TARGET-shell #a2（bump v2）、PROCESS §5.7／§4 D-11。
2. **session enum**：契約第 7 條依 coordinator `types.ts` `SessionStatus` 更正舊手冊誤植（queued/… → created/active/closing/closed/failed），於 contracts §1 前言與 §2 明文揭露。
3. **D 碼防線補齊**：TARGET 檔實際引用的 D 碼已於 PROCESS §4 一行化收錄（來源＝舊實作紀律），刪檔後零斷鏈。
4. **TRUTH 時效**：as_of 更新至 94e817b（#323–#329 增量複核：四服務無 route/API 面變更；8011 port race 已修 #325，部署區重建後真轉檔回歸 not observed；#327 僅 env ownership，#328／#329 僅 agent workflow governance）。
5. **活指標同步**：AGENTS.md、CLAUDE.md、README.md、docs/agents/product-operability-and-script-contract.md、repo-health SKILL、兩個 `.claude/workflows/*.js`、agent-task issue template、PROJECT_DEVELOPMENT_WORKFLOW、active OpenSpec specs、demo 與 SaaS keep docs之舊檔引用改指新體系；歷史文件（superpowers plans/specs、archive、evidence、審批報告）不回寫，斷鏈依 README §7 對照表救援。
6. **Landing review 修補**：雙軸 review 找到並關閉 PR #327 回退、freeze item 13／`trigger`／3 筆例外漏失、IX-TN 4 卡漏失、active dead refs、MinIO R8 與 A3 O6 舊裁決復活、TARGET 英文建成宣稱、TRUTH/PROCESS DoD 矛盾與 alias 語意計數等 blocker。

## §6 待授權項（不在本輪執行；正本＝BACKLOG §3）

閘 2 wiring（TRUTH 同步接進 pr-review-agent）、saas/審批實體搬移、TRUTH 半自動重生腳本、7 檔行數預算 CI。OPEN 產品決策（選檔樣式三選一、底欄真資料源、前端視覺七項、O3/O5、BCF 3.0 時點）正本＝BACKLOG §2。
