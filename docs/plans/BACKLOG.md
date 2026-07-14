# BACKLOG — prototype-first 缺口佇列與 OPEN 決策

> v2 · 2026-07-14 · A1–A10 使用情境規格重寫後的 gap／決策入口。
> 讀者：要選「下一個最有價值格子」的 AI coding agent；查 OPEN 待人類決策的任何 agent。
> 分工：現況問 `TRUTH.md`；需求問 self-contained `TARGET-shell.md`／`TARGET-viewer.md`（補充視覺來源＝兩份 tracked prototype HTML＋兩組 tracked route PNG）；全域不變量問 `TARGET-contracts.md`；驗收與紀律問 `PROCESS.md`。本檔只管「還缺什麼、先做哪個、哪些決策還開著」。

## §0 維護規約

1. gap 完成＝刪列；新 gap＝加列；本檔可整份重排。無 DONE(PR#) 欄、無打勾、無歷史留存——git 即審計。
2. **同一 route 同時最多一個 IN-PROGRESS gap**。gap 進 IN-PROGRESS 後，對應 TARGET 節規格即凍結；要改規格＝先 bump 該節凍結點（`<route>@v<N> frozen <date>`）再動工。
3. 每個 gap 動工的 PR body 必附「誠實邊界聲明」：完成後哪些仍是 NOT BUILT／未取得、UI 如何標示（規約見 PROCESS §2）。
4. 排序原則：先補「prototype 有整頁、repo 是轉址或佔位」的洞；再補 PARTIAL；最後做驗證／校正型工項。
5. 決策落定＝結論寫進 TARGET 正文後自 §2 刪項；本檔不留裁決帳。

## §1 gap 主表

依排序。每 gap 的 DONE 至少含：該頁 screenshot/E2E 與 TARGET IA／tracked prototype 對齊，並以該 route 兩張 tracked PNG 作輔助比對＋TRUTH 對應列同 PR 更新（PROCESS §2/§3）。

| gap id | route | 目標（TARGET 節錨） | 現況（TRUTH 列） | 距離×價值 | DONE 定義 | 誠實邊界 | blocker |
|---|---|---|---|---|---|---|---|
| `gap-conv-history` | `#conv` | TARGET-shell `#conv` 節 | TRUTH §1 `conv` 列 | 整頁洞×最高；**指定為新體系第一個執行 gap＝體系 E2E 驗收** | `#conv` 成為獨立轉檔歷史頁（非轉址），渲染轉檔歷史清單與動作；screenshot/E2E 對齊 prototype `#conv` 錨 | live GPU 轉檔證據未觀測時標 `not observed`；coverage 自我參照數字不得當品質宣稱（TRUTH §6） | 無 |
| `gap-review-room-alignment` | `#review` | TARGET-shell §4.1 `#review` 節 | TRUTH §1 非正典保留頁 `#review` 列 | PARTIAL×高 | `#review` 介面對齊 TARGET-shell §4.1 `#review` 節規格（route 獨立性與現況見 TRUTH §1 `#review` 列，本 gap 範圍＝介面對齊，不含 route 建立）；同 PR 更新 TRUTH §1 `#review` 列；E2E | Section/Snapshot 等 p15 工具維持 disabled＋待建標示 | 無 |
| `gap-viewer-m4-select-semantic` | `#viewer` | TARGET-viewer 區塊 1＋2（AC-1） | TRUTH §2 區塊 1／區塊 2 列 | PARTIAL×高（M4 核心迴路第一段） | 真串流畫面點選構件→高亮鎖定→右欄顯示 IFC Type／Name／GlobalId(22 碼)／PredefinedType／ObjectType／Tag／Fidelity；E2E | 串流遙測未取得標 n/a；無 GPU/harness 時 `KIT runtime=no`，不偽綠 | 無 |
| `gap-viewer-m4-tree-filter` | `#viewer` | TARGET-viewer 區塊 3（AC-9） | TRUTH §2 區塊 3 列 | PARTIAL×中 | 結構樹篩選支援 `dim`（其餘變暗）／`iso`（其餘隱藏）兩模式＋一鍵取消篩選；E2E | 樹資料未載入時走空狀態，不補假節點 | 無 |
| `gap-viewer-m4-mapping-table` | `#viewer` | TARGET-viewer 區塊 4（AC-3） | TRUTH §2 區塊 4 列 | PARTIAL×高 | GUID⇔USD 對應表逐件顯示，prim 命名 `G_<sanitized_guid>`、路徑 `/World/Elements/<IfcClass>/…`；`name_fallback` 降級標警示並計入統計；E2E | fidelity 不得宣稱 100%；降級可視不隱藏 | 無 |
| `gap-viewer-m4-geom-pset` | `#viewer` | TARGET-viewer 區塊 5＋6（AC-2/AC-5） | TRUTH §2 區塊 5／區塊 6 列 | PARTIAL×中 | 幾何條（world-mm BBox／體積／材質／樓層）＋Pset/Qto 面板；缺值以「— 缺 —」一級可視化，不靜默省略；E2E | Qto 須由真幾何計算；示意值一律標範例值 | 無 |
| `gap-viewer-m4-spatial` | `#viewer` | TARGET-viewer 區塊 7（AC-4） | TRUTH §2 區塊 7 列 | PARTIAL×中 | 每件可見 IfcBuildingStorey／IfcBuilding／IfcSite 包含鏈；來源有分類系統（MasterFormat/OmniClass/Uniformat）則顯示；E2E | 來源無分類碼時誠實缺省，不補假碼 | 無 |
| `gap-viewer-m4-a1-overlay-reverse` | `#viewer` | TARGET-viewer A1 疊加＋反向跳轉（AC-6/AC-7） | TRUTH §2 區塊 1 列＋§1 `a1` 列 | PARTIAL×高（M4 收尾） | A1 疊加 ON→選定檔 rule-run 失敗構件 3D 紅色高亮（資料源 governance :49102 經 coordinator proxy）；對應表列／問題列／結構樹三入口反向跳轉；`highlightPrimsRequest` 經 DataChannel，**Kit 回 ack 才標成功** | 證據未齊時高亮鍵維持 disabled；ack 未回不標成功 | 四證據鏈缺一不可：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path（現況見 TRUTH §2 區塊 1 列） |
| `gap-ss-03-force-release` | `#sessions` | TARGET-shell `#sessions` 節（IX-SS-03） | TRUTH §1 `sessions` 列 | PARTIAL×中 | `/api/sessions/:id/endpoints/:ep/release` 上線；僅在 heartbeat stale ∧ 無 first frame 時可強制釋放；`#sessions` 按鈕由 disabled 轉可用；E2E | 前置未達時按鈕維持 disabled；不做無條件 kill | IX-SS-02 心跳遙測真值（現況見 TRUTH §1 `sessions` 列；遙測屬 kit-manager-api p1——TRUTH §3 #6，解鎖工項待產品決策後加列，歸屬記於下方「不開 gap 聲明」） |
| `gap-issue-assignee` | `#a1`／`#issues` | TARGET-shell `#a1` BCF 面板＋`#issues` 節 | TRUTH §1 `a1`／`issues` 列（assignee 後端／前端現況以 `issues` 列為準） | PARTIAL×中（O7 已裁決：自由文字 assignee） | A1 BCF 面板指派欄可寫（後端 assignee 欄／create API／BCF `AssignedTo` 映射現況見 TRUTH §1 `issues` 列，勿重複實作 schema；本 gap 範圍＝前端寫入路徑）；E2E | 指派欄可用前 UI 維持「指派 · 待建」灰虛線，不提供假按鈕 | 無 |
| `gap-bcf-provenance-gate` | `#issues` | TARGET-contracts §1 #8＋§10.2、TARGET-shell `#issues` 節 | TRUTH §1 `issues` 列 | contract gap×高 | generic create 的 manual formal issue 不得進 BCF；`from-rule-run`／`from-diff` issue 可匯；UI 無 eligible issue 時 disabled；API regression tests＋E2E | 完成前不得宣稱 BCF 已強制兩步 provenance gate；直接 API bypass 風險須可見 | server-side enforcement 會觸碰 frozen governance surface，動工前需核准例外；只做 frontend gate 不足以阻止 API bypass |
| `gap-a3-clash` | `#a3` | TARGET-shell `#a3` 節（碰撞偵測 · Clash） | TRUTH §1 `a3` 列＋§3 #9 | PARTIAL×中（O6 已裁決：ifcclash；spec/plan 已備待開工） | 依既有 spec/plan（`docs/superpowers/specs/2026-07-07-a3-clash-ifcclash-design.md`＋`docs/superpowers/plans/2026-07-07-a3-clash-ifcclash.md`）從 Task 0 runtime probe 起步，落地 ifcclash 碰撞檢測與 clash 端點；probe unavailable（含 `has_occ=False` 類原因）必加 hard guard，顯示機器可讀原因而非 0 碰撞；E2E | 實作前 clash 區零假數、`重跑碰撞檢測` 維持 disabled＋待建標；引擎 unavailable 態是有效 UX，不偽裝成功 | 無硬依賴；Task 0 安裝／smoke 若補不起幾何能力，依核准 plan 交付 unavailable hard-guard 模式 |
| `gap-a1-sourcepicker` | `#a1` | TARGET-shell `#a1` 選檔節 | TRUTH §1 `a1` 列 | 收斂型×中 | 選檔樣式三選一（dd/cascade/tree）收斂為一式並寫入 TARGET-shell `#a1` 節；PROTO 切換列自規格移除 | 未裁決前正式 UI 維持現行樣式；三式並陳僅存在於 prototype | OPEN 決策 #1 |
| `gap-reports-hub` | `#reports` | TARGET-shell `#reports` 節 | TRUTH §1 `reports` 列 | PARTIAL×低 | 中心化報表頁聚合既有匯出入口，一頁可達；E2E | 未接的報表項標 p1 待建，不列假報表 | 無 |
| `gap-status-calibration`（一次性） | 全站 | —（校正工項，不新增規格） | TRUTH §1/§2 全部 `not observed` 項 | 校正型×中 | runtime 逐頁截圖比對 prototype 錨，TRUTH `not observed` 項全數改為實測狀態或確認 NOT-BUILT；截圖入 `artifacts/e2e/`（`.gitignore` 擋 `*.png`，須 `git add -f`） | 校正寧可保守；無證據一律維持 `not observed` | 無 |
| `gap-route-convergence`（一次性） | 全站 | TARGET-contracts §4＋TARGET-shell §0 | TRUTH §7 機器真相宣告 | 校正型×中 | repo 全部 route case（約 30+，含保留別名）逐條裁決：併入 22 正典／保留別名／排程退役；結論寫入 TARGET-contracts §4 與 TARGET-shell §0，TRUTH §7 同步——**做完即終結雙詞彙，不再永久對照** | 收斂完成前，雙詞彙並存屬現況事實（記於 TRUTH §7），不得假裝已統一 | 無 |

**尚未排入 gap 聲明**：A4–A10 的完整目標已在 TARGET-shell 對應節；現行 NOT BUILT／disabled 佔位是誠實的 runtime 現況，不是最終需求。這七頁在 §2 #7 決定第一個 vertical slice、服務／資料 ownership 與 contract 例外前不列入 §1；一旦裁決，只新增被選 route 的一個 gap，其他 route 仍維持誠實佔位。`#admin`、ChatUSD agent 真對話／MCP 執行（TRUTH §3 #2）與 kit-manager-api GPU/心跳遙測（TRUTH §3 #6，IX-SS-02 前置）同樣尚未排入 gap，UI 維持 disabled／「未取得」；遙測一旦立項即同時解鎖 `gap-ss-03-force-release` 的 blocker。

**viewer gap 實作接點註**：六個 `gap-viewer-m4-*` 的深規在 `TARGET-viewer.md`（該檔與 TARGET-shell `#viewer` 節均無「實作接點」欄）；viewer 前端真身＝`web-viewer-sample` viewer 端（經 `/ui/open` 302 進入的 :5173 baked viewer，非 `src/console/` 殼層），改動須重建 viewer docker image 才會生效。改檔位置以本註為錨，實際落點以 repo 現行結構為機器真相。

## §2 OPEN 待人類決策

禁偷渡定案：未裁決前一律採「預設行為」，任何 PR 不得以實作既成事實倒逼結論。每項附觸發條件。

1. **A1 選檔樣式三選一（dd／cascade／tree）**。觸發：`gap-a1-sourcepicker` 動工前，由人類挑一式。預設：維持現行實作樣式不動。
2. **底欄 job bar／QUEUE 真資料來源 API**。prototype 底欄轉檔進度與 HealthChips 數字為寫死示意，真資料 API 未指定。觸發：有人要求殼層底欄接真值時。預設：維持示意＋`DEMO` 標示，不偽綠。
3. **前端視覺／行為七項**（自實作手冊 §8 逐項搬運；均為可見外觀或行為改動，AI 不得自行拍板）：
   1. NVIDIA 綠值：DS `#84c714` vs 正統 `#76b900`。預設：保留 `#76b900`。
   2. 字體：導入 `--ec-sans`（Plus Jakarta Sans＋Noto Sans TC）重塑 body/nav/heading vs 維持 mono-only。預設：維持 mono-only。
   3. light theme／docs surface：是否以現行 `theme-light` toggle 為最終形、是否做 per-page docs surface。預設：維持現行 toggle 行為，不新做 docs surface。
   4. 雙語 i18n（`AIBIM.tt {zh,en}`＋LangToggle）：本輪做或延後。預設：延後——不做沒功能的 EN toggle。
   5. 卡片圓角：DS 正典 14px vs 現行約 6px。預設：維持現狀。
   6. `#semantic` 資料路徑：raw fetch 遷移到 whitelisted proxy 是行為變更，須單獨立項。預設：維持 raw fetch。
   7. token-tier 範疇：全面視覺採用 vs 只建 token tier＋共用元件 refactor。預設：只建 token tier，不全面重塑。
   觸發（共通）：任何觸碰對應視覺／行為面的 gap 動工前逐項確認。
4. **O3 版本命名規約**：MinIO「版本層」落地方式（資料夾命名規則、舊資料是否搬遷）——A2 真雙版本比對的前置。觸發：需要 v06/v07 級真差異比對前。預設：不動儲存層、不自創命名規約。
5. **O5 GPU 台數規劃**：落地端實際 GPU 台數與型號——session 容量與排程的前置。觸發：容量規劃或多卡排程設計前。預設：以單卡假設規劃（1 GPU＝1 Kit＝1 stream，無 live migration），不預先實作多卡排程。
6. **BCF 3.0 升級時點**：前置＝向 buildingSMART 確認 3.0 規格與官方支援。預設：固定 BCF 2.1（純 stdlib 匯出），UI 與文件標「3.0 為升級目標」。
7. **A4–A10 第一個 vertical slice 與 ownership**：從 A4 search/index、A5 IoT/FM、A6 schedule/cost、A7 capture/deviation、A8 dataset/Replicator、A9 robot mission、A10 scenario/orchestration 選一頁，逐一確認 authoritative service、coordinator proxy、資料保存位置、auth/audit 與需要的 §1.1 approved exception。觸發：任一 A4–A10 實作 gap 建立前。預設：不新增 route/API，不接 mock；維持現行 NOT BUILT／disabled 誠實佔位。

**已裁決不留帳**：O6＝ifcclash、O7＝自由文字 assignee、A1v2 三裁決、SaaS 10 裁決等結論已內化進 TARGET 正文；出處＝審批報告三檔（keep 原地）與 git history。本節只收未決事項。

## §3 遷移待辦（邊界事件，逐項待使用者授權）

1. **［待授權］閘 2 wiring**：把「產品 PR 觸碰四服務 route/API 面必須同 PR 更新 TRUTH.md」接進 `pr-review-agent.ps1` 的 body-evidence paths 機制。**不可裁減項**——這是防止 TRUTH 變 stale 副本的唯一結構性保險；改動在 docs/plans 之外，需另案授權。
2. **［待授權］實體搬移**：saas 六檔（`ai-bim-governance-saas-*.md`）搬 `vision/`、審批報告三檔搬 `archive/`。本輪 keep 原地＝願景分離效果打八折。
3. **［待授權］TRUTH 半自動重生腳本**：讀 `web-viewer-sample/src/console/data.ts` prov 標註＋`artifacts/e2e/` 清單，產出 TRUTH 主表草稿供人工核對。
4. **［待授權］行數預算 CI**：把新體系 7 檔行數上限註冊進 agent-doc-context-budget CI gate。
