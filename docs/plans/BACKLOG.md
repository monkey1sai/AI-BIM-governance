# BACKLOG — design-system-first 缺口佇列與 OPEN 決策

> v3 · 2026-07-14 · 99% design fidelity＋operability/runtime dual-gate gap／決策入口。
> 讀者：要選「下一個最有價值格子」的 AI coding agent；查 OPEN 待人類決策的任何 agent。
> 分工：現況問 `TRUTH.md`；需求問 self-contained `TARGET-shell.md`／`TARGET-viewer.md`；2D design screen/state 問 repo-pinned manifest/baselines；全域不變量問 `TARGET-contracts.md`；驗收與紀律問 `PROCESS.md`。legacy HTML/PNG 只作 companion。本檔只管「還缺什麼、先做哪個、哪些決策還開著」。

## §0 維護規約

1. gap 完成＝刪列；新 gap＝加列；本檔可整份重排。無 DONE(PR#) 欄、無打勾、無歷史留存——git 即審計。
2. **同一 route 同時最多一個 IN-PROGRESS gap**。gap 進 IN-PROGRESS 後，對應 TARGET 節規格即凍結；要改規格＝先 bump 該節凍結點（`<route>@v<N> frozen <date>`）再動工。
3. 每個 gap 動工的 PR body 必附「誠實邊界聲明」：完成後哪些仍是 NOT BUILT／未取得、UI 如何標示（規約見 PROCESS §2）。
4. 排序原則：先補「approved design screen 有整頁、repo 是轉址或佔位」及 `reference_missing` 洞；再補 PARTIAL；最後做驗證／校正型工項。
5. 決策落定＝結論寫進 TARGET 正文後自 §2 刪項；本檔不留裁決帳。

## §1 gap 主表

依排序。每 gap 的 DONE 至少同時含：approved screen/state 兩 viewport pixel≤1%＋semantic 100%，以及 functional route/button/fixture/API/runtime ID/visible states/trace/network evidence；涉及 Kit 再加 first-frame/stage/DataChannel ack，並同 PR 更新 TRUTH（PROCESS §2/§3）。

| gap id | route | 目標（TARGET 節錨） | 現況（TRUTH 列） | 距離×價值 | DONE 定義 | 誠實邊界 | blocker |
|---|---|---|---|---|---|---|---|
| `gap-design-system-production-alignment` | `#home/#a1–#a10/#conv/#runtime` | contracts §5.1＋TARGET-shell 對應節 | TRUTH §1 design fidelity 欄 | approved baseline 已有、review trust 自鎖、production 未實測×最高 | `implemented_case_ids` 精確等於 11 個 `required_case_ids`；Playwright 對 current subject commit 產出全部 13 screens×2 viewport pixel≤1%＋semantic 100% result；workflow producer landed 後依既有授權啟用 `design-semantic-visual` required context；每 route functional/runtime gate另過 | concept golden 不代表 A5–A10 backend 已建；design pass 不改 Prov/建成狀態 | semantic state variants 尚缺、producer change 尚未 landed、required context暫緩；sole CODEOWNER 與 PR 作者同帳號，product gate fail closed |
| `gap-design-system-reference-coverage` | `#issues/#reports/#viewer/#gpu/#sessions/#instances/#minio/#admin/#spec/#review`＋Kit Manager 2D UI | contracts §5.1＋TARGET-shell/TARGET-viewer | TRUTH §1 `reference_missing` | 無 approved pixel reference×最高 | 上游 design authority 提供 screen/state；經明確確認 rebaseline 後加入 manifest/goldens，兩 viewport visual gate＋各 route functional/runtime gate 均可執行 | live WebRTC/GPU frame 不建 golden；Kit OpenUSD viewer/extensions 保留但不在本輪擴充 | 需上游 approved screen/state |
| `gap-frontend-functional-runtime-machine-gate` | 全部 user-facing routes／Kit Manager | PROCESS §2／§3 | PR body 目前只結構化檢查 functional/runtime 欄位 | machine evidence authority 尚缺×最高 | branch-protected functional/runtime producer＋validator 綁 current commit、route/button/fixture/API/network/runtime ID/visible states；Kit path 再驗 first-frame/stage/DataChannel ack；與 design job 採 AND | 不以 design pass 取代真 API/runtime；Kit OpenUSD extensions 不在本 gap 實作 | Kit Manager browser harness 與 live Kit runner 尚未成為 CI authority |
| `gap-design-gate-trust-determinism` | 全部 frontend／design gate infrastructure | PROCESS §3 | approval／CODEOWNERS／dismiss stale與admin enforcement已設定，但唯一 CODEOWNER 與 PR 作者同帳號、無 bypass，人工 gate 不可滿足；design context待 producer landed；npm dependency tree／runner image／font fingerprints未 pin | gate尚未具可用 merge authority且 pixel run不可完全重現×最高 | 新增至少一位獨立合格 CODEOWNER／協作者，或經明確授權落地可滿足的 solo-maintainer／trusted base-branch gate；land trusted workflow producer後依既有授權啟用 required context；保持 reference-only rebaseline 與 product PR 分離；resolved dependency snapshot、runner image與font fingerprint machine-verified | 不以降低保護掩蓋 reviewer 缺口；required context不得先於 producer／executable gate；完成前維持 `full_completion_allowed=false` | 需先解除 self-approval deadlock，再完成 merge→activation順序；需裁決 lock/snapshot policy |
| `gap-conv-history` | `#conv` | TARGET-shell `#conv` 節 | TRUTH §1 `conv` 列 | 整頁洞×最高 | `#conv` 成為獨立轉檔歷史頁（非轉址），渲染轉檔歷史清單與動作；`pipeline.default` design gate＋functional E2E 都通過 | live GPU 轉檔證據未觀測時標 `not observed`；coverage 自我參照數字不得當品質宣稱（TRUTH §6） | 無 |
| `gap-review-room-alignment` | `#review` | TARGET-shell §4.1 `#review` 節 | TRUTH §1 非正典保留頁 `#review` 列 | PARTIAL×高 | `#review` 介面對齊 TARGET-shell §4.1 `#review` 節規格（route 獨立性與現況見 TRUTH §1 `#review` 列，本 gap 範圍＝介面對齊，不含 route 建立）；同 PR 更新 TRUTH §1 `#review` 列；E2E | Section/Snapshot 等 p15 工具維持 disabled＋待建標示 | 無 |
| `gap-a4-closeout` | `#a4` | TARGET-shell `#a4` 節 | TRUTH §1 `a4` 列 | PARTIAL×高（**A8 動工前的收尾**——2026-07-14 裁決：先把已投入的 A4 推到可宣稱，再開下一片） | A4 語意查詢達 PROCESS §2 DoD 六條：`workspace.a4.default` visual gate＋tracked browser trace（`:8005` 隔離站）；BCF bridge 依 contracts §1 #8 裁決（新增 approved provenance bridge，或維持 unavailable 並於 UI 誠實標示）；E2E | BCF bridge 未核准前「建立 Issue (BCF)」維持 unavailable、不偽成功；confidence 僅在有定義／校正來源時顯示；Ornith vLLM 未連線時降級為 deterministic 且明示，不阻斷頁面、不偽稱 semantic | 無 |
| `gap-viewer-m4-select-semantic` | `#viewer` | TARGET-viewer 區塊 1＋2（AC-1） | TRUTH §2 區塊 1／區塊 2 列 | PARTIAL×高（M4 核心迴路第一段） | 真串流畫面點選構件→高亮鎖定→右欄顯示 IFC Type／Name／GlobalId(22 碼)／PredefinedType／ObjectType／Tag／Fidelity；E2E | 串流遙測未取得標 n/a；無 GPU/harness 時 `KIT runtime=no`，不偽綠 | 無 |
| `gap-viewer-m4-tree-filter` | `#viewer` | TARGET-viewer 區塊 3（AC-9） | TRUTH §2 區塊 3 列 | 小×中（**樹本身已建**——`console/viewer/StructureStats.tsx` 的空間巢狀樹經 coordinator spatial-tree for-session proxy 真 fetch、loading/error/no_url/ok 四態齊全；本 gap 只剩篩選模式） | 結構樹篩選支援 `dim`（其餘變暗）／`iso`（其餘隱藏）兩模式＋一鍵取消篩選；E2E | 樹資料未載入時走空狀態，不補假節點 | 無 |
| `gap-viewer-m4-mapping-table` | `#viewer` | TARGET-viewer 區塊 4（AC-3） | TRUTH §2 區塊 4 列 | PARTIAL×高 | GUID⇔USD 對應表逐件顯示，prim 命名 `G_<sanitized_guid>`、路徑 `/World/Elements/<IfcClass>/…`；`name_fallback` 降級標警示並計入統計；E2E | fidelity 不得宣稱 100%；降級可視不隱藏 | 無 |
| `gap-viewer-m4-geom-pset` | `#viewer`（**實作落在後端**） | TARGET-viewer 區塊 5（AC-2） | TRUTH §2 區塊 5 列 | **後端資料源**×中（**前端已建**——`console/viewer/IfcSemanticPanel.tsx` 的⑤幾何／分類碼卡已在，且依誠實鐵律標 roadmap N/A；區塊 6 的 Pset／Qto 面板亦已真 fetch 並逐 property 渲染。**缺口在後端 pipeline 無 BBox／體積／材質／分類碼來源**，端點依 contracts §1 #6 誠實回 `null`） | 轉檔／語意 pipeline 產出 world-mm BBox、體積、材質、樓層與分類系統碼，使 `/api/elements/semantics` 的 `geometry`／`classification` 不再恆為 `null`；前端幾何卡自動由 roadmap 態轉為顯示真值（前端無須改動即生效）；E2E | Qto 須由真幾何計算，不得以示意值填充；來源無分類碼時維持誠實缺省（contracts §1 #6 禁捏造） | 動工前先確認 ifcopenshell 幾何萃取在部署 runtime 可用——比照 A3 clash 的 `has_occ=False` 教訓，從 runtime probe 起步 |
| `gap-viewer-m4-a1-overlay-reverse` | `#viewer` | TARGET-viewer A1 疊加＋反向跳轉（AC-6/AC-7） | TRUTH §2 區塊 1 列＋§1 `a1` 列 | PARTIAL×高（M4 收尾） | A1 疊加 ON→選定檔 rule-run 失敗構件 3D 紅色高亮（資料源 governance :49102 經 coordinator proxy）；對應表列／問題列／結構樹三入口反向跳轉；`highlightPrimsRequest` 經 DataChannel，**Kit 回 ack 才標成功** | 證據未齊時高亮鍵維持 disabled；ack 未回不標成功 | 四證據鏈缺一不可：DataChannel ready ∧ first_frame_at ∧ stage matched ∧ usd_prim_path（現況見 TRUTH §2 區塊 1 列） |
| `gap-ss-03-force-release` | `#sessions` | TARGET-shell `#sessions` 節（IX-SS-03） | TRUTH §1 `sessions` 列 | PARTIAL×中 | `/api/sessions/:id/endpoints/:ep/release` 上線；僅在 heartbeat stale ∧ 無 first frame 時可強制釋放；`#sessions` 按鈕由 disabled 轉可用；E2E | 前置未達時按鈕維持 disabled；不做無條件 kill | IX-SS-02 心跳遙測真值（現況見 TRUTH §1 `sessions` 列；遙測屬 kit-manager-api p1——TRUTH §3 #6，解鎖工項待產品決策後加列，歸屬記於下方「不開 gap 聲明」） |
| `gap-issue-assignee` | `#a1`／`#issues` | TARGET-shell `#a1` BCF 面板＋`#issues` 節 | TRUTH §1 `a1`／`issues` 列（assignee 後端／前端現況以 `issues` 列為準） | PARTIAL×中（O7 已裁決：自由文字 assignee） | A1 BCF 面板指派欄可寫（後端 assignee 欄／create API／BCF `AssignedTo` 映射現況見 TRUTH §1 `issues` 列，勿重複實作 schema；本 gap 範圍＝前端寫入路徑）；E2E | 指派欄可用前 UI 維持「指派 · 待建」灰虛線，不提供假按鈕 | 無 |
| `gap-bcf-provenance-gate` | `#issues` | TARGET-contracts §1 #8＋§10.2、TARGET-shell `#issues` 節 | TRUTH §1 `issues` 列 | contract gap×高 | generic create 的 manual formal issue 不得進 BCF；`from-rule-run`／`from-diff` issue 可匯；UI 無 eligible issue 時 disabled；API regression tests＋E2E | 完成前不得宣稱 BCF 已強制兩步 provenance gate；直接 API bypass 風險須可見 | server-side enforcement 會觸碰 frozen governance surface，動工前需核准例外；只做 frontend gate 不足以阻止 API bypass |
| `gap-a3-clash` | `#a3` | TARGET-shell `#a3` 節（碰撞偵測 · Clash） | TRUTH §1 `a3` 列＋§3 #9 | PARTIAL×中（O6 已裁決：ifcclash；spec/plan 已備待開工） | 依既有 spec/plan（`docs/superpowers/specs/2026-07-07-a3-clash-ifcclash-design.md`＋`docs/superpowers/plans/2026-07-07-a3-clash-ifcclash.md`）從 Task 0 runtime probe 起步，落地 ifcclash 碰撞檢測與 clash 端點；probe unavailable（含 `has_occ=False` 類原因）必加 hard guard，顯示機器可讀原因而非 0 碰撞；E2E | 實作前 clash 區零假數、`重跑碰撞檢測` 維持 disabled＋待建標；引擎 unavailable 態是有效 UX，不偽裝成功 | 無硬依賴；Task 0 安裝／smoke 若補不起幾何能力，依核准 plan 交付 unavailable hard-guard 模式 |
| `gap-a1-sourcepicker` | `#a1` | TARGET-shell `#a1` 選檔節＋`workspace.a1.default` | TRUTH §1 `a1` 列 | 收斂型×中 | 選檔元件與 approved screen/state 對齊；legacy PROTO 切換列不進 production；visual＋functional E2E | API/source isolation 行為仍由 TARGET 契約決定，不由靜態畫面猜測 | 無 |
| `gap-reports-hub` | `#reports` | TARGET-shell `#reports` 節 | TRUTH §1 `reports` 列 | PARTIAL×低 | 中心化報表頁聚合既有匯出入口，一頁可達；E2E | 未接的報表項標 p1 待建，不列假報表 | 無 |
| `gap-status-calibration`（一次性） | 全站 | —（校正工項，不新增規格） | TRUTH §1/§2 全部 `not observed` 項 | 校正型×中 | runtime 逐頁 functional evidence＋approved screen 的 visual result 校正 TRUTH；`reference_missing` 不得用 legacy screenshot 補位。**含 viewer 區塊 6／7 取證**；證據入 `artifacts/e2e/` 並追蹤。 | 校正寧可保守；無證據一律維持 `not observed` | 無 |
| `gap-route-convergence`（一次性） | 全站 | TARGET-contracts §4＋TARGET-shell §0 | TRUTH §7 機器真相宣告 | 校正型×中 | repo 全部 route case（約 30+，含保留別名）逐條裁決：併入 22 正典／保留別名／排程退役；結論寫入 TARGET-contracts §4 與 TARGET-shell §0，TRUTH §7 同步——**做完即終結雙詞彙，不再永久對照** | 收斂完成前，雙詞彙並存屬現況事實（記於 TRUTH §7），不得假裝已統一 | 無 |

**尚未排入 gap 聲明**：A5–A10 的完整目標已在 TARGET-shell 對應節；現行 NOT BUILT／disabled 佔位是誠實的 runtime 現況，不是最終需求。A4 已於 2026-07-14 以 deterministic search vertical slice 接入 B 閉環（ownership＝governance-service + coordinator proxy；見 §2 #7 裁決）。其餘頁在選定 vertical slice 前不列入 §1。`#admin`、ChatUSD agent 真對話／MCP 執行（TRUTH §3 #2）與 kit-manager-api GPU/心跳遙測（TRUTH §3 #6，IX-SS-02 前置）同樣尚未排入 gap，UI 維持 disabled／「未取得」；遙測一旦立項即同時解鎖 `gap-ss-03-force-release` 的 blocker。

**viewer gap 實作接點註**：五個 `gap-viewer-m4-*` 的深規在 `TARGET-viewer.md`（該檔與 TARGET-shell `#viewer` 節均無「實作接點」欄）。

- **元件檔位置**：`web-viewer-sample/src/console/viewer/`（`MockViewport` / `StructureStats` / `IfcSemanticPanel` / `MappingTable`）。
- **渲染入口**：`web-viewer-sample/src/Window.tsx`（`Window.tsx` import `./console/viewer/MockViewport`）＝經 `/ui/open` 302 進入的 **:5173 baked viewer app**，**不是** `:8004/ui` 的 EdgeConsole 殼層——故改動須重建 viewer docker image 才會生效。

原註寫「viewer 前端真身…非 `src/console/` 殼層」意在區隔 EdgeConsole，但字面易被誤讀成「元件檔不在 `src/console/` 目錄下」，導致改錯位置（repo 內並無 `src/viewer/` 目錄）。2026-07-14 依 code 對帳更正。實際落點仍以 repo 現行結構為機器真相。

## §2 OPEN 待人類決策

禁偷渡定案：未裁決前一律採「預設行為」，任何 PR 不得以實作既成事實倒逼結論。每項附觸發條件。

1. **底欄 job bar／QUEUE 真資料來源 API**。design reference 的轉檔進度與 HealthChips 數字是示意，真資料 API 未指定。觸發：有人要求殼層底欄接真值時。預設：維持示意＋`DEMO` 標示，不偽綠。
2. **額外 theme／locale state**。current approved baseline 是 dark＋`zh-TW`；light theme、docs surface 或其他 locale 若成為產品需求，須先由上游提供 approved screen/state，再明確 rebaseline；不能用 CSS toggle 自行創造第二套標準。預設：只驗 current manifest state，不提供無功能 toggle。
3. **`#semantic` 資料路徑**。raw fetch 遷移到 whitelisted proxy 是 backend 行為變更，與 2D design authority 無關，須單獨立項。預設：維持現行契約，不因 visual work 偷改 API。
4. **O3 版本命名規約**：MinIO「版本層」落地方式（資料夾命名規則、舊資料是否搬遷）——A2 真雙版本比對的前置。觸發：需要 v06/v07 級真差異比對前。預設：不動儲存層、不自創命名規約。
5. **O5 GPU 台數規劃**：落地端實際 GPU 台數與型號——session 容量與排程的前置。觸發：容量規劃或多卡排程設計前。預設：以單卡假設規劃（1 GPU＝1 Kit＝1 stream，無 live migration），不預先實作多卡排程。
6. **BCF 3.0 升級時點**：前置＝向 buildingSMART 確認 3.0 規格與官方支援。預設：固定 BCF 2.1（純 stdlib 匯出），UI 與文件標「3.0 為升級目標」。
7. **A4–A10 vertical slice 與 ownership**：**第一片已裁決（2026-07-14）＝A4**，且已落地。authoritative service＝`governance-service`（`POST /api/search/model`，支援 `interpret_mode=deterministic｜semantic｜auto`；semantic＝Ornith vLLM OpenAI-compatible，key 不進 git——**能力現況一律以 TRUTH §1 `a4` 列為準**）；browser 經 coordinator `:8004` `/api/governance/search/model` 與 `for-session`／`for-ifc-ready`；資料不另建 index DB（當次開啟 IFC 掃描）；Issue 批次走既有 `POST /api/issues`（`source_type=manual`，BCF provenance bridge 未批）。<br>**下一片已裁決（2026-07-14）＝A8 Synthetic Data Studio**：理由＝唯一能把現有 GPU／Kit／USD 資產直接變成產品的頁（零新硬體、零新外部資料源、Replicator 與 Kit 同棧，TARGET-shell §a8 驗收句已可執行）。但其 ownership（authoritative service、Replicator runner 落點、資料集儲存位置、GPU／storage budget、需要的 contracts §1.1 approved exception）**必須先做 Task 0 runtime probe 才有意義**——比照 A3 clash 的 `has_occ=False` 教訓，未 probe 前不談 ownership、不列入 §1。<br>A5–A7／A9／A10 仍待各自 ownership 裁決。預設：不新增 route/API，維持 NOT BUILT／disabled。

**已裁決不留帳**：O6＝ifcclash、O7＝自由文字 assignee、A1v2 三裁決、SaaS 10 裁決等結論已內化進 TARGET 正文；出處＝審批報告三檔（keep 原地）與 git history。本節只收未決事項。

## §3 遷移待辦（邊界事件，逐項待使用者授權）

1. **［已授權 2026-07-14 · 未動工］閘 2 wiring**：把「產品 PR 觸碰四服務 route/API 面必須同 PR 更新 TRUTH.md」接進 `pr-review-agent.ps1` 的 body-evidence paths 機制。**不可裁減項**——這是防止 TRUTH 變 stale 副本的唯一結構性保險。
   - **觸發面採「中等寬度」**（已裁決）：四服務的 route／API 目錄（`web-viewer-sample/src/console/**`、`bim-review-coordinator/src/routes/**`、`governance-service/**/api.py`、`bim-streaming-server/**`）。純 refactor／測試 PR 可於 body 聲明「本 PR 不改變任何 route/API 建成面」豁免——**太寬會逼每個 PR 亂填 TRUTH，gate 會自我腐化**。
   - **前置已完成**：2026-07-14 開啟 main branch protection（`enforce_admins=true` ＋ require PR，見 PROCESS §4 D-34）。在此之前，11 道 required check 對 repo owner 全部失效，直接 push 可繞過所有 gate——**閘 2 至此才真正擋得住**。
   - 動工注意：`pr-review-agent` 是 main 的 REQUIRED check（strict，fail=BLOCKED），改壞會擋住所有 PR。先以 `scripts/tests/test-pr-body-evidence.ps1` 本機模擬驗證再上。
2. **［待授權］實體搬移**：saas 六檔（`ai-bim-governance-saas-*.md`）搬 `vision/`、審批報告三檔搬 `archive/`。本輪 keep 原地＝願景分離效果打八折。
3. **［待授權］TRUTH 半自動重生腳本**：讀 `web-viewer-sample/src/console/data.ts` prov 標註＋`artifacts/e2e/` 清單，產出 TRUTH 主表草稿供人工核對。
4. **［待授權］行數預算 CI**：把新體系 7 檔行數上限註冊進 agent-doc-context-budget CI gate。
