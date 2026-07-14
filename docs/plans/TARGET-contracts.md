# TARGET-contracts — 全域凍結契約（跨頁不變量唯一正本）

> v4 · 2026-07-14 · A1–A10 使用情境與 route 身分重寫
> `TARGET-contracts@v4 frozen 2026-07-14`
> 作廢範圍（v3→v4）：舊 A9「設計／審查 Copilot」與 A10「機器人／巡檢模擬」身分，以及僅以兩份 HTML 作視覺來源的基準；依 route PNG 設計輸入改為 A9 機器人／自主巡檢、A10 其他應用／AI 決策工作台，將 IA 內化到 self-contained TARGET，並加入跨應用量測與證據 envelope。
> 作廢範圍（v2→v3）：§7 A2 版本差異列原載「ifcdiff · 禁自寫 diff」抵觸 2026-07-10 R2 使用者簽核裁決（A2 現行採簽核之自製多級鍵引擎，語意對齊 ifcdiff）；v3 依 R2 更正。
> 作廢範圍（v1→v2）：§4 路由身分表「群組」欄 12 列誤植（`#viewer`/`#gpu`/`#a6`–`#a10` 誤標「核心治理」、`#conv`/`#sessions`/`#instances`/`#minio` 誤標「OMNIVERSE RUNTIME」、`#runtime` 誤標「落地端控制台 / SYSTEM」）；v2 依 prototype `EC_NAV` 導航五組（工作台／核心治理／OMNIVERSE RUNTIME／落地端控制台／SYSTEM）更正。

## §0 讀取協定

1. 本檔是全體系跨頁、長壽、逐字級不變量的**唯一正本**；動任何 code 前先讀 §1–§5。
2. TARGET-shell / TARGET-viewer 與本檔衝突＝該檔的 bug，就地修該檔，不改本檔。
3. 修訂本檔＝使用者明確授權＋bump 檔頭凍結點（`TARGET-contracts@v<N> frozen <date>`）＋一行作廢範圍。
4. 本檔不記載 repo 的建成現況（建成狀態一律查 `TRUTH.md`）；文中「待建」是需求屬性（本規格要求新增），非建成宣稱。
5. 引用單向：TARGET-shell / TARGET-viewer / PROCESS 以「contracts §N」錨引用本檔；本檔不引用 TRUTH / BACKLOG。
6. 共用 shell／viewer 骨架以兩份 tracked HTML 為視覺來源；A1–A10 每 route 的 `ai-bim-geo-viewer-A<n>.png` 與 `ai-bim-geo-Ai-codeing-A<n>.png` 是 tracked supplementary visual source，durable 正本仍是 TARGET-shell 對應節。視覺來源中的數字、ID、日期、路徑、協定標籤與健康值不是資料契約。

---

## §1 後端凍結面契約（BACKEND PRESERVATION CONTRACT — 13 條＋已批准例外表）

> 以下 13 條與 §1.1 例外表自舊手冊《前端對齊DS-保留後端-實作手冊》§1／§1.1 **一字不差**搬運（byte-diff 校對；唯一刻意差異＝第 7 條 session enum 更正舊手冊誤植，依據與說明見 §2）。任何一條被違反＝做錯，必須 revert。

1. **拓樸凍結**：前端**只能打 coordinator `127.0.0.1:8004`**。**永遠不得**新增對 governance-service `:49102`、streaming-server `:49101`、kit-manager `:8010` 的直連。一切走 `/api/governance/*`、`/api/dev/conversions*`、`/api/kit/*`、`/api/external/*` proxy。
2. **proxy 路徑字串 byte-identical（不得改名）**：
   `POST /api/governance/rule-runs`、`/api/governance/rule-runs/for-session/:sessionId`、`/results`、`/failures`、`/export`；`/api/governance/diffs*`（create / `:diffId` / `/items` / `/apply-overlay` / `/issue-impact`）；`/api/governance/federated-sets*`（create / `:setId/members` / `/validate-coords` / `/build` / `/review-room`）；`/api/governance/issues*`（create / list / `:issueId/transition` / `from-rule-run/:runId` / `from-diff/:diffId`）；`/api/governance/bcf/export`；`/api/governance/files/tree`；`/api/governance/element-mapping/for-session/:sessionId`。
3. **轉檔 dev proxy 路徑凍結**：`/api/dev/conversions`（GET/POST）、`/api/dev/conversions/:jobId`、`/:jobId/result`、`/api/dev/conversions/mock`。coordinator 會改寫到 streaming-server `/api/conversions*`，**不得改名**。
4. **`/ui/open?session=...` 凍結 handoff（RK6 CRITICAL）**：必須保留 302→viewer redirect、session-id regex `^(lwv_|review_session_)[A-Za-z0-9_]+$`，且必須註冊在 `/ui` SPA fallback **之前**；**禁止**任何 catch-all 吃掉 `/ui/open` 或 `/ui/console`。React console 由 `/ui` 與 `/ui/*` SPA fallback 提供。
5. **`apply-overlay` 故意回 501**：`POST /api/governance/diffs/:id/apply-overlay` 是 **by design 501**（overlay 走 client `highlightPrimsRequest`，非 server-push）。前端**不得**把它接到「真實後端 overlay」當缺功能補；維持 `p15`。
6. **誠實資料契約不動**：A1 `RuleResult` / A2 `DiffItem` 的 `usd_prim_path` 未映射時為 `null`（**禁捏造**）；semantics endpoint 的 `classification` / `geometry` 維持 `null` + `roadmap[]`；`coverage_ratio==1` 在 `usd_stage_enumeration` 下是**結構性自我參照**——前端**可重新標註說明**，但**不得改後端數值**；`source_kind`（`local_fs` vs `s3`）是 UI 用來判斷檔案來源的誠實標記。
7. **穩定 enum（逐字 echo，禁自創）**：`change_type`（added/removed/moved/geometry_changed/property_changed）；issue `status`（open/assigned/in_progress/resolved/rejected/reopened）；`severity`（low/medium/high/critical）；conversion `status`（queued/running/succeeded/succeeded_with_warnings/failed/cancelled）；session `status`（created/active/closing/closed/failed）；ifc-ready job status；`KitInstance.status`。`ifc_guid` 是 BCF/governance 永遠存在的主鍵。
8. **rule-run export 只支援 `?fmt=excel`**（`fmt=bcf` → 400）。**BCF 匯出是獨立 endpoint**（`/api/governance/bcf/export` → `.bcfzip`），且**只有在用 `from-rule-run`/`from-diff` 建立 issues 之後**才可用。BCF gating UI 必須誠實呈現這個兩步流程。
9. **control-plane 授權不動**：`prioritize`/`retry`/`watch`/`trigger`（`POST /api/conversion/trigger`，2026-07-10 認列既有實作）是 IP-allowlist gated 且 audited（trigger 另有 IntentDialog 確認＋idempotency）；`/close` **故意不 gate**（cooperative/operator 雙語意，IX-SS-04）；Kit `open`/`close` 需 `x-dev-token`。前端**不得**假設這些是公開/匿名，也**不得**移除目前送出的 auth header。
10. **權威歸屬凍結**：coordinator 對 project/artifact metadata **只是 reference，非資料權威**。轉檔 artifact / `quality_metrics` / lineage 仍從 streaming-server（經 proxy）讀；rule/diff/issue 權威仍在 governance-service（經 proxy）。**不得**把權威搬進前端或 coordinator。
11. **回應 envelope key 是載重結構（不得 flatten/改名）**：list 用 `{items,count}`（conversions、ifc-ready）或 `{issues}`/`{projects}`/`{results}`/`{items}`；failures 用 `{items,total,limit,offset}`。
12. **DO-NOT-RE-ADD（2026-05-21 已退役）**：socket 協作 server-push（`highlightRequest`/`selectionUpdate`/`annotationCreate`、`getReviewIssues`、`createAnnotation`、`/api/model-versions/:id/review-bootstrap`）。只剩 `/events` 與 `/lifecycle-events`。**禁改的後端檔**：governance-service（`app.py`、`diff_engine/api.py`、`federation/api.py`、`issues/api.py`、`bcf/api.py`、`file_library/api.py`）、coordinator（`src/app.ts`、`src/routes/governanceProxy.ts`）、streaming `conversion_authority.py`。
13. **加性慣例（2026-07-10，R6 止血線）**：新增 coordinator 端點一律進 `src/routes/*.ts`（沿 `governanceProxy.ts` 先例，`app.ts` 僅允許一行 mount）；新增 governance 端點一律進所屬 domain 的 `api.py`（rule-run 面進 `rule_engine/api.py`）。**禁止再向 `app.ts`／`app.py` 巨石 append**；既有巨石拆分屬待人類簽核的獨立決策，不在本條範圍。

### §1.1 已批准例外表（Approved Backend-Freeze Exceptions）

本表只記錄已被後續設計明確批准的例外；不得外推成 §1 全面放寬。新增任一例外都必須更新本表並列 Requirement source。

| 日期 | 例外 | Requirement source | 邊界 |
|---|---|---|---|
| 2026-07-08 | 新增 A1 for-ifc-ready rule-run proxy：`/api/governance/rule-runs/for-ifc-ready/:jobId` | `docs/superpowers/specs/2026-07-08-a1-minio-downloaded-rule-run-design.md` | 僅服務 A1 v2 從 ifc-ready job 對應已下載 IFC 執行 rule-run；不允許改名既有 proxy、不允許新增租戶/host/path 語意、不允許把 A1 選檔改成轉檔觸發器。 |
| 2026-07-09（2026-07-10 追認） | `GET /api/governance/rule-runs`（history 清單）＋ `source_metadata` 持久化（commit `4949b9b`，動 `governanceProxy.ts`／`app.py`／`db.py`） | `docs/superpowers/plans/2026-07-09-a1-minio-worktree-conflict-resolution.md`＋`docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R3 | 唯讀 history proxy＋additive metadata 欄；不改名既有 proxy、不洩漏 host path/secret、不改變 rule-run 建立語意。 |
| 2026-07-09（2026-07-10 追認） | `POST /api/external/ifc-ready/:jobId/review-session`＋A1 inline viewer（`mode="a1-inline"`，PR #319） | PR #319＋`docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R1（IX-3D-01 v2.1 修訂） | 僅 A1 工作台、evidence-gated＋手動啟動；其他 console 頁仍禁內嵌 WebRTC；不改 `/ui/open` 凍結 handoff。 |
| 2026-07-10（預簽） | `governance-service/app.py` `export_rule_run` cache-miss 改由 DB 重建（`_RUN_CACHE` miss → `store.get_run`＋`get_results`） | `docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R6（bug fix，行為僅「409→成功匯出」） | 僅此函式；不動其他 app.py 端點；匯出格式與 `?fmt=excel` 契約不變。 |

**效力宣告**：`ai-bim-governance-saas-公開API與標準對齊.md` §1.3 之逐字複本為歷史快照，無效力，以本節為準。

---

## §2 穩定 enum 逐字清單

> 自 §1 第 7 條展開為速查；字串**一字不差**，前端逐字 echo。

- `change_type`：`added` / `removed` / `moved` / `geometry_changed` / `property_changed`
- issue `status`：`open` / `assigned` / `in_progress` / `resolved` / `rejected` / `reopened`
- `severity`：`low` / `medium` / `high` / `critical`
- conversion `status`：`queued` / `running` / `succeeded` / `succeeded_with_warnings` / `failed` / `cancelled`
- session `status`：`created` / `active` / `closing` / `closed` / `failed`（機器真相＝`bim-review-coordinator/src/types.ts:1` `SessionStatus`；舊手冊原載 `queued/active/closing/closed` 屬誤植——coordinator 無 `queued`、漏 `created`/`failed`，v1 已與舊手冊來源同步更正）
- 另有 ifc-ready job status 與 `KitInstance.status`：以後端回應為唯一來源，逐字顯示。
- `ifc_guid` 是 BCF/governance 永遠存在的主鍵。

**原則**：狀態 enum 由後端逐字 echo，前端不得重命名、翻譯取代或自創顯示值（本地化只可「加註」，原值必須可見）。

---

## §3 六服務埠表＋雲地歸屬

| 服務 | 埠（loopback bind） | 能做 | 絕對不能做 |
|---|---|---|---|
| coordinator | `127.0.0.1:8004` | session/instance、`/ui`、`/api/governance/*` proxy、ifc-ready intake、`/ui/open?session=` redirect | 不渲染 / 不開 USD stage / 不存大型模型 |
| governance-service | `127.0.0.1:49102` | A1 rule-run / A2 diff / A3 federation / Issue / BCF / `/api/files/tree`（CPU） | **永遠 host-native；browser 不直連，一律經 coordinator proxy** |
| bim-streaming-server | 信令 `49100` / 串流 `47998` / 轉檔 API `49101` / spectator `49110`（起，KIT_SPECTATOR_COUNT 決定範圍） | IFC→USDC 轉檔 / Kit runtime / viewport / WebRTC + DataChannel | 不處理登入 / 不當 project 資料權威 / 不當長期 Issue DB |
| web-viewer-sample（viewer） | `127.0.0.1:5173` | 顯示串流 / DataChannel 互動 | 不啟 Kit / 不分配 GPU；前端 disabled 不是授權邊界 |
| kit-manager-api | `127.0.0.1:8010` | **規格保留埠**：`#instances`/`#runtime` 遙測、Kit 啟停（服務建成狀態查 `TRUTH.md`） | — |
| MCP sidecars | `9901/9902/9903` | omni-ui-mcp / kit-mcp / usd-code-mcp 官方驗證 | — |

> **真實 MinIO endpoint**（`192.168.20.234:9000` / bucket `bim-control`）為 bim-review-coordinator 的**外連依賴**（outbound S3Client），非 loopback bind；不在埠表中，由部署區 `.env` 注入，不在程式碼硬編碼。

**雲地歸屬裁決（寫死）**：

- **coordinator = `:8004` container**。殼層原型 `#minio` 頁 DepsList 將 coordinator 標為 host 屬**筆誤**，以本表為準。
- **viewer = `:5173` container**（機器真相＝`compose.runtime-manager.yml` viewer service）。寫作 brief（`briefs/TARGET-contracts.md.brief.md` 第 4 條）將 viewer 標 host-native 屬**筆誤**，以本表為準。
- governance-service / Kit（信令 `49100`·串流 `47998`）/ 轉檔權威 `:49101` = **host-native**；容器只跑 web plane（coordinator + viewer），容器缺 Vulkan ICD——GPU 工作一律在 host-native plane。
- 每頁 UI 的「依賴 · DEPENDENCIES」清單須標 host-native / container 歸屬，不得把 host-native 服務標成容器內可直連。

---

## §4 路由契約（正典 22 條身分表＋9 個別名＋1 個獨立保留頁）

> 本表是路由**身分**（route × 頁名 × 群組 × 後端歸屬）；「群組」欄以 prototype `EC_NAV` 導航五組為樣貌真相。各 route 的建成狀態**唯一落點＝`TRUTH.md`**，本表不載狀態。
> 路由機器真相＝`web-viewer-sample/src/console/data.ts` `PAGES[]`＋`EdgeConsole.tsx` switch case；本表不手工鏡像 repo 全部 case。

| 碼 | route | UI 頁名 | 群組 | 後端 / 服務歸屬 |
|---|---|---|---|---|
| ⌂ | `#home` | 今天要做什麼 | 工作台 | coordinator（彙整） |
| A1 | `#a1` | 治理與模型檢核（P0） | 核心治理 | governance-service rule_engine（經 proxy） |
| A2 | `#a2` | 版本差異與責任 | 核心治理 | governance-service diff_engine（GlobalId 鍵） |
| A3 | `#a3` | 跨專業疊合 | 核心治理 | governance-service federation；clash＝Kit / ifcclash（GPU） |
| A4 | `#a4` | 語意查詢與證據 | 核心治理 | search/index service（規劃；經 coordinator） |
| A5 | `#a5` | IoT / FM 數位分身 | 核心治理 | MQTT/BMS/FM integration plane（規劃；經 coordinator） |
| BC | `#issues` | Issue / BCF 中心 | 核心治理 | governance-service issues + bcf |
| RP | `#reports` | 報表中心 | 核心治理 | governance-service excel_export |
| 3D | `#viewer` | 3D Viewer 呈現 | OMNIVERSE RUNTIME | 證據面板（不內嵌 3D）；3D 來自 streaming-server WebRTC |
| 01 | `#gpu` | GPU 審查室 / Review Room（MVP） | OMNIVERSE RUNTIME | coordinator `/ui/open` redirect → web-viewer + streaming-server |
| A6 | `#a6` | 4D / 5D 進度與成本整合 | OMNIVERSE RUNTIME | schedule/cost authority（規劃）＋USD timeSamples（GPU） |
| A7 | `#a7` | 掃描比對 / Reality Capture | OMNIVERSE RUNTIME | capture alignment/deviation service（規劃）＋point cloud（GPU） |
| A8 | `#a8` | Synthetic Data | OMNIVERSE RUNTIME | Replicator + Cosmos Transfer |
| A9 | `#a9` | 機器人 / 自主巡檢 | OMNIVERSE RUNTIME | Isaac Sim（模擬權威）＋可選 ROS/edge adapter（另案） |
| A10 | `#a10` | 其他應用 / AI 決策工作台 | OMNIVERSE RUNTIME | coordinator 聚合 A1–A9 證據＋受控 AI/report services（規劃） |
| CV | `#conv` | IFC→USD 轉檔排程（P1） | 落地端控制台 | coordinator `/api/dev/conversions` proxy + `/api/conversion/records`；轉檔權威＝streaming-server |
| SS | `#sessions` | Session 管理 | 落地端控制台 | coordinator `/api/review-sessions` |
| KG | `#instances` | Kit / GPU 機隊 | 落地端控制台 | kit-manager-api `/instances`（規格保留埠，見 §3） |
| M | `#minio` | MinIO 資料 | 落地端控制台 | coordinator `GET /api/minio/objects` + local_fs `GET /api/governance/files/tree` |
| RT | `#runtime` | Runtime 監控 | SYSTEM | kit-manager-api `/runtime` + `/health`（規格保留埠） |
| SY | `#admin` | 系統管理 | SYSTEM | coordinator（auth/config） |
| ▦ | `#spec` | 設計規格說明 | SYSTEM | 靜態 |

**保留 deep link（10 列＝9 個別名＋1 個獨立保留頁；不列入 22 條主表，不得砍斷）**：

| key | no | 說明 |
|---|---|---|
| `overview` | OV | Overview 別名 |
| `coordinator` | CO | Coordinator Console |
| `intake` | IN | Model Intake |
| `review` | G | **Review Room（ReviewRoomPage，獨立頁，非 `#gpu` 別名）** |
| `semantic` | SE | Semantic Viewer |
| `apps` | AP | Applications · A1–A10 |
| `version-diff` | A2 | A2 deep-link 別名（`data.ts` `RM_APPS` A2.route，同 VersionDiffPage、同後端） |
| `federation` | A3 | A3 deep-link 別名（`data.ts` `RM_APPS` A3.route，同 FederationPage） |
| `kit` | — | operator 工具（kit-manager-web；保留） |
| `demo-control` | — | operator 工具（RealIfcConsolePage；打 coordinator `/api/dev/*` + `/api/external/ifc-ready`；保留） |

計數核對：正典 route＝22、別名＝9、獨立保留頁＝1（`#review`）。

> 殼層原型內建 `EC_ALIAS` 6 條（`overview→home、coordinator→sessions、intake→conv、semantic→a4、apps→spec、review→gpu`）僅為單檔 demo 便利，**非正式別名語意**；正式語意以上表為準，其中 `review→gpu` 重定向在正式殼層為**禁止**（原型自身註記同此裁決）。

**四鐵則**：

1. hash 一律**無斜線**（`#a1` 非 `#/a1`）；`readHash()` 可容忍 `#/x` 並剝斜線，但文件與連結一律寫無斜線形。
2. `/ui/open?session=:id` 為**凍結 handoff path**（byte-for-byte；redirect target 與 session-id regex 見 §1 第 4 條；禁 `/ui/*` 萬用 redirect 吃掉）。
3. `#gpu`＝GPU 審查室正典 route；`#review`＝**獨立 ReviewRoomPage 保留頁**——兩者是不同元件，**永不合併、永不互相重定向、永不砍 case**。
4. 路由的機器真相＝`data.ts PAGES[]`＋`EdgeConsole.tsx`；升格第 23 條主表需走升格決策（專屬後端 or 專屬互動卡＋無法被現有頁吸收＋使用者核可）。

---

## §5 Prov 7 值 ↔ DS 5 級 ProvTag 映射（全體系唯一一份）

repo `Prov` 型別（機器真相＝`web-viewer-sample/src/console/data.ts:6`）**恰好 7 值、無 `todo`**：`asbuilt` / `artifact` / `demo` / `p1` / `p15` / `p3` / `p4`。

| DS 5 級（顯示標籤） | repo Prov 值 | 標籤語意 |
|---|---|---|
| built | `asbuilt` | AS-BUILT（實線綠） |
| artifact | `artifact` | 實測 artifact（實線青） |
| demo | `demo` | 示範資料（1px dashed amber） |
| ai | `p1` / `p15` | 後端待建 · P1 / P1.5（紫） |
| todo | `p3` / `p4` | 願景 Phase 3 / Phase 4（1px dashed 灰） |

- **`prov="todo"` 會 TS2322，禁用**——`todo` 僅是 DS 顯示級標籤，**不是 Prov 值**；待建一律用 `p1`/`p15`/`p3`/`p4`。
- 缺遙測 → 「未取得」＋ idle LED（無 glow，不偽綠）；demo 數據 → `prov="demo"`＋標「示範資料」；願景數字 → 標「願景敘事 · 示意」。
- **視覺真相宣告**：token 唯一真相＝`web-viewer-sample/src/console/edge-console.css` 的 `--ec-*` 與 review-room `styles.css`；文件不抄數值、不另定 px。

---

## §6 GPU 物理鐵律

- **1 GPU = 1 Kit instance = 1 primary stream**（同時 session ≤ GPU 數）。NVIDIA 官方核實：GPU worker「number: 1 per stream」、叢集 stream 上限＝GPU 數 → https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/requirements.html
- **無 live migration**：streaming session 綁定單一 GPU pod，生命週期僅 create / connect / disconnect / terminate，**無 migrate API**；換模型/GPU＝**terminate + recreate**（新 stream 啟動約 30–40 秒；shader cache 冷可 15 分鐘以上）→ https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html
- **spectator 不另吃 GPU**：1 個 Kit process＝1 PRIMARY（`:49100`）＋ N SPECTATOR（`49110`–`49150`，由 `KIT_SPECTATOR_COUNT` 決定）；spectator 收同一 render stream；**每個 signaling endpoint 一次只服務一個 viewer**。
- 健康判定看「viewer 真的收到 frame」，不是看埠有沒有 listen（`port has listen ≠ viewer sees frame`）；首幀由 track event 驅動，禁 timer 假進度。
- 任何 UI 涉及 drain / move / 重新指派 GPU 的文案，必須白話揭露成本（terminate+recreate、30–40 秒、重載 stage、短暫斷線）。

---

## §7 官方對齊鐵律（官方支援才做；自製只做橋接）

> 三領域一律「官方有就用官方，自製只做橋接」；能力邊界不可逾越。禁憑記憶寫版本/API，鎖版前以實際 Kit build 內版本為準。

| 能力 | 官方件 / API | 能力邊界（不可逾越） | 出處 |
|---|---|---|---|
| IFC 解析 / Pset·Qto / 空間樹 | IfcOpenShell 0.8.x（`open` / `util.element.get_psets` / `get_container`） | — | https://docs.ifcopenshell.org/ |
| 規則驗證 | buildingSMART **IDS 1.0** + **ifctester**（官方 reporter 含 Bcf 輸出） | 只驗英數（屬性/分類/材質/關係），不驗幾何、不驗計算值、假設已 schema-valid | https://docs.ifcopenshell.org/ifctester.html |
| 版本差異（A2） | **簽核之自製多級鍵引擎**（governance-service diff_engine：GlobalId→(is_a,Tag)→type+Name+loc；moved 用 placement Δ、property 用 pset hash；**語意對齊 ifcdiff**：GlobalId 主鍵、JSON added/deleted/changed）——2026-07-10 R2 使用者簽核，選型理由＝三級配對抗 GUID churn＋moved 責任語意＋直接對接 Issue/3D schema | 禁選型漂移（引擎更換須使用者重新簽核）；跨 IFC schema 比對不保證正確——跨 schema 需求出現時再評估官方 `ifcdiff` | https://docs.ifcopenshell.org/ifcdiff.html |
| 碰撞偵測（A3） | IfcOpenShell **ifcclash**（選型已裁決＝ifcclash） | 幾何運算，不可用 IDS 驗；需 OpenCASCADE 幾何後端（`has_occ` hard guard，缺件不得靜默回 0 碰撞） | https://docs.ifcopenshell.org/ |
| BCF 交換 | IfcOpenShell 官方 **`bcf`** 庫（BCF-XML 2.1/3.0） | 匯出**現行 2.1**；**3.0 僅為升級目標**（升級前先向 buildingSMART/官方庫確認語意）；component 必帶 IfcGuid（22 字元） | https://docs.ifcopenshell.org/bcf.html |
| IFC→USD 轉檔 | 自製 conversion authority（IfcOpenShell 讀幾何＋語意 → usd-core 寫 USD）；備援 `IfcConvert --use-element-guids` → glb → glTF importer | **IfcConvert 無 USD 輸出**（官方能力邊界）；prim 命名 `G_<sanitized_guid>` 並把原始 GUID 存 customData（見 §8）；mapping coverage 報告是義務 | https://docs.ifcopenshell.org/ifcconvert.html |
| prim 高亮 / 選取 | Kit `omni.usd` selection group（`register_selection_group` + `set_selection_group_outline_color`） | 走 DataChannel `highlightPrimsRequest`，web 端不重渲染 | https://docs.omniverse.nvidia.com/extensions |
| isolate / 可見性 / 4D | `UsdGeom.Imageable` visibility（timeSamples；`SetStartTimeCode/EndTimeCode`） | visibility 是 token → **held 不內插** | https://openusd.org/release/glossary.html |
| 量測 / 批註 / 剖切 / 書籤 | `omni.kit.tool.measure` · `omni.kit.tool.markup` · `omni.kit.window.section` · `omni.kit.waypoint.core` | **M5+ 一律用官方 extensions，不自建**；剖切/批註寫 session layer，不污染 source | https://docs.omniverse.nvidia.com/extensions |
| 場景樹 / 屬性面板 | `omni.kit.widget.stage` · `omni.kit.window.property` | — | https://docs.omniverse.nvidia.com/extensions |
| WebRTC 串流 | `omni.kit.livestream.webrtc` / `.app` | §6 物理鐵律全數適用 | https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html |
| 瀏覽器↔Kit 指令通道 | 瀏覽器 `AppStreamer.sendMessage(JSON {event_type,payload})` ⇄ Kit `omni.kit.livestream.messaging` | 全指令統一 `{event_type,payload}` JSON；沿用 NVIDIA `web-viewer-sample` 的 `*Request`/`*Result` ack 慣例；web 端只發訊息、不重渲染 | https://docs.omniverse.nvidia.com/extensions |
| 合成資料（A8） | **Omniverse Replicator**（Annotator/Writer） | ground-truth 標註；**先驗證官方 API 再寫規格**，禁自造資料管線 | https://developer.nvidia.com/blog/how-to-build-a-generative-ai-enabled-synthetic-data-pipeline-for-perception-ai/ |
| 擬真擴增（A8/A9） | **NVIDIA Cosmos Transfer**（NIM `POST /v1/infer`） | 只擬真不標註；版本／授權／部署形態鎖定前先驗證，不得把生成影像當真實感測證據 | https://developer.nvidia.com/blog/how-to-build-a-generative-ai-enabled-synthetic-data-pipeline-for-perception-ai/ |
| 機器人模擬（A9） | **Isaac Sim**（PhysX；`isaacsim.sensors.physx`） | 預設只能標 `SIMULATION`；未有 ROS/edge ownership、auth 與真 telemetry evidence 時不得呈現為實機；感測器能力鎖版前先驗證 | https://docs.isaacsim.omniverse.nvidia.com/latest/replicator_tutorials/tutorial_replicator_cosmos.html |
| AI 決策／Copilot（A10） | evidence-linked operation plan；需要 USD 操作時才用 **usd-code-mcp :9903** | 建議必帶 evidence refs、confidence/限制並經 human confirm；任何場景寫入只到 **session layer**，source 檔雜湊不變 | — |

**自製唯一例外＝BCF 橋接層**：把官方 markup/waypoint 內容轉成 `bcf topic + viewpoint + snapshot`（用官方 bcf 庫）。這層是本產品的差異化價值，也是唯一值得自寫的 viewer 周邊。

---

## §8 USD 命名規約與 mapping fidelity

- prim 路徑規約：`/World/Elements/<IfcClass>/G_<sanitized_guid>`。
- sanitize 規則：GUID 中非 `[A-Za-z0-9_]` 字元一律 → `_`。
- sanitize 有碰撞風險 → **原始 GUID 必須另存 customData**（`prim.SetCustomDataByKey("ifc:GlobalId", guid)`），保證可逆。
- mapping fidelity 二級：`guid_exact` / `name_fallback`。**降級必須可見**（列標警示）、**進統計**（mapped/unmapped/fallback 計數）、**不得隱藏、不得宣稱 100%**。
- IFC 語意承載：`prim.SetCustomDataByKey("ifc:Pset:<name>", v)` 或 typed attribute（`ifc:*`）；語意不走幾何檔。

---

## §9 六通用互動模式＋誠實元件規範

### 9.1 六通用互動模式（80% 互動是這六型的組合）

**模式 1 · 證據型更新（Evidence-based update）——本案唯一允許的更新方式**
```text
使用者按下動作 → 按鈕進入 busy（disabled + spinner 字樣）
→ 呼叫 API → 等回應
→ 成功：以「回應裡的事實」重繪（不是以「我以為會發生的事」重繪）
→ 失敗：按鈕復原 + 顯示錯誤條（紅，含 status code 與 message），畫面資料不變
禁止：樂觀更新（先改畫面再等 API）。理由：本系統的信任=畫面等於事實。
```

**模式 2 · 輪詢（Polling）**
```text
頁面進入時 fetch 一次 → setInterval 輪詢 → 頁面離開時 clearInterval
節奏：佇列/Session/機隊類 5000ms；執行中的進度（rule-run、conversion running）1500ms
規則：輪詢中新資料「就地更新列」，不整頁閃爍；fetch 失敗顯示「上次更新 HH:MM:SS · 連線異常」徽章，不清空舊資料
```

**模式 3 · 危險動作三段式（Intent → Confirm → Audited result）**
```text
適用：插隊/重試/強制釋放/結束 session/drain/move/批次建 issue/匯出交付
① intent：點按鈕 → 開 confirm 對話框，內容必須含「成本與後果」白話
   （例 move：「這是重啟搬移：先終止再於新節點重建，約 30–40 秒、重載 stage、短暫斷線」）
② confirm：明確按「確認執行」→ POST intent API（body 含 reason 欄位，可空）
③ result：依模式 1 證據型更新；audit 記錄（who/when/what/reason）由後端寫
```

**模式 4 · Provenance 徽章（誠實標記渲染）**
```text
資料源：GET /api/provenance（或頁面資料內嵌 provenance 欄位），前端絕不硬編碼
狀態 → 樣式：AS-BUILT(綠) / 實測 artifact(青) / 示範資料(琥珀) / 後端待建·P1(灰虛線)
規則：每個區塊右上角一枚；待建功能的按鈕 render 成 disabled + title 說明，「不提供假按鈕」
```

**模式 5 · 拖放（Drag & Drop）→ 一律轉譯成 intent API**
```text
HTML5 DnD：draggable 元素 dragstart 寫 payload(JSON: {kind, id}) 進 dataTransfer
目標 dragover：用「規則函式」判斷可否放（不可放 → dropEffect='none' + 目標紅框提示原因）
drop：不直接改狀態 → 走模式 3（彈 confirm → POST intent）
規則函式範例（fleet）：目標節點 drain 中→拒；目標已有 running stream→拒（1 GPU=1 stream）；same node→忽略
```

**模式 6 · 空狀態與錯誤狀態**
```text
空資料：顯示「目前沒有 X」+ 下一步建議（例：storage 無 IFC → 顯示放檔路徑與 Refresh 鈕）——不補假列
API 錯誤：保留舊資料 + 錯誤條；404/501 視為「後端待建」→ 顯示待建徽章而非錯誤
```

### 9.2 誠實元件規範（六條，元件級呈現義務）

1. **未建功能不可操作**：disabled `Button`＋誠實 caption＋prov mini-tag（`todo`/`ai` 顯示級）；disabled 時不綁 onClick，**不提供假按鈕**。
2. **NOT BUILT / blocked 區塊**：`Panel` 帶 `phase`（header 紅色斜線 hatch＋紅框）——待建區塊的唯一視覺語言。
3. **無 runtime 畫面**：`DarkStage` 佔位（全黑＋45° 斜線 hatch＋右上角 `Runtime = no` 小標＋置中 mono 說明）；**絕不放假渲染圖**。
4. **缺遙測缺值**：`HealthChip`/`MetricCard` 顯「未取得」＋idle LED（**無 glow，絕不偽綠**）；demo 數值一律在 note 標 `DEMO`/「示意」。
5. **寫入型動作**一律走模式 3 confirm（IntentDialog），confirm 文案含成本與後果。
6. **空狀態**走模式 6：給下一步指引，**不補假列、不補假數**（記分板未跑前、BCF 無 topic 時皆同）。

補充義務：每頁 PageHead 必掛頁級 ProvTag＋HostTag（host-native vs container 歸屬，見 §3）；證據單一來源（如 A1 連動橋四格證據只讀鏡射 `#sessions`/Runtime 權威值，不自行推定）；viewer 回 ack 才標成功。

---

## §10 資料契約

### 10.1 共用資料模型（所有應用講同一套語言）

| 實體 | 關鍵欄位 | 白話 |
|---|---|---|
| Project | `projectId`、名稱、階段 | 一個工程案；只有 coordinator config 指定的 `local_fs` fixture 顯示「測試資料」，MinIO 來源不得僅因來源或編號被標成測試 |
| Model | `modelId`(UUID)、projectId、discipline(OpenBIM 類別)、來源檔資訊 | 一個模型資料夾 |
| Version | `versionId`(v01/v02…)、modelId、上傳者、時間、備註 | 同一模型的某一版 |
| Element | `elementGuid`(IFC GlobalId)、ifcClass、名稱、樓層、屬性 bag、`usdPath` | 一個構件；`elementGuid ↔ usdPath` 對照表是 3D 連動的關鍵 |
| RuleResult | `checkId`、ruleId、status(pass/fail)、severity、命中 elementGuids | A1 一條規則的檢核結果 |
| Issue | `issueId`、來源(app)、severity、標題、描述、elementGuids、指派、狀態、BCF 欄位 | 共同治理出海口；A1/A2/A3/A4/A5/A6/A7/A9/A10 可產生，A8 job failure 留在 DatasetJob |
| ConvJob | `jobId`、modelId、狀態、進度、coverage 報告 | 一筆 IFC→USD 轉檔任務 |
| Session | `sessionId`、kitInstanceId、stage 路徑、endpoint pool(1 PRI + N SPC)、health | 一場 GPU 審查 |
| KitInstance | `nodeId`、GPU 型號/util/VRAM、Kit PID/埠、載入 stage、drain 狀態 | 一台 GPU 節點上的 Kit |
| EvidenceRef | `evidenceId`、sourceType、sourceId、uri、hash、observedAt、quality | 查詢解譯、AI 建議、報表與 Issue 都只能引用可追溯證據 |
| Scenario | `scenarioId`、baselineId、name、assumptions、inputRefs、createdBy | A6/A10 的基準與替代方案；不得以畫面卡片值充當輸入 |
| TelemetrySample | `sourceId`、pointCode、value、unit、observedAt、quality | A5/A9 的時序量測；值、單位、時間與品質不可拆開 |
| WorkOrder | `workOrderId`、assetId、issueId、status、assignee、dueAt、sourceRef | A5 維保閉環，必要時連到共同 Issue |
| ScheduleActivity | `activityId`、wbsCode、planned/actual dates、progress、costCode、elementGuids | A6 甘特、EVM 與 3D overlay 的共同鍵 |
| CaptureJob / Deviation | `captureJobId`、sourceUri/hash、transform、rms、elementGuid、deviationMm、toleranceMm | A7 對齊與偏差；精度與 tolerance 必須可追溯 |
| DatasetJob | `datasetJobId`、stageHash、camera/seed、outputs、status、artifactRefs | A8 每張輸出可回溯到場景、相機、seed、annotator/writer 版本 |
| RobotMission | `missionId`、mode、robotId、route/waypoints、sensorPack、status、eventRefs | A9 任務；`mode=simulation|physical` 必須可見且不可由 UI 猜測 |

### 10.2 Issue 共同出海口 schema（A1/A2/A3/A4/A5/A6/A7/A9/A10 共用）與 BCF gate

```json
{
  "issueId": "ISS-2026-0612-001",
  "source": "A1",
  "severity": "high",
  "title": "FireDoor 缺 FireRating（37 件）",
  "projectId": "270", "modelId": "123a909a-…", "version": "v07",
  "elementGuids": ["1xF3…", "…"],
  "ruleId": "ARC-DOOR-REQ-001",
  "assignee": "Architect",
  "status": "open",
  "viewpoint": null
}
```

- `source` ∈ `A1|A2|A3|A4|A5|A6|A7|A9|A10|manual`；A8 job failure 留在 DatasetJob，不自動轉治理 Issue。`severity` 與 `status` 值域**以 §2 凍結 enum 為準**（後端逐字 echo，本 schema 不另立值域）。
- 匯出 BCF＝把 Issue 打包成 `.bcfzip`（現行 **BCF 2.1**；每個 issue 一個資料夾：`markup.bcf` 描述＋`viewpoint.bcfv` 視角＋`snapshot.png` 截圖）；沒有 3D 時 viewpoint/snapshot 可缺省，**誠實標「無視角資訊」**，不假截圖。
- BCF 兩步 gating 的目標契約以 §1 第 8 條為準：匯出資格必須限於由 `from-rule-run`／`from-diff` 建立的 issues。A3/A4/A5/A6/A7/A9/A10 雖共用 Issue schema，沒有新增 approved exception／provenance bridge 前不得宣稱可匯 BCF。

### 10.3 資料庫事實層宣告

- governance-service 治理帳本（rule-run / issue / audit）＝ **SQLite（host-native）**。
- 雲端控制面 metadata 權威 DB ＝ **MySQL（`bim-control`）**，非 Postgres。
- coordinator 對 project/artifact metadata 只是 reference（§1 第 10 條）；轉檔狀態真相＝ledger。

### 10.4 A1–A10 結果與量測共同 envelope

- 每份結果至少帶 `project_id`、`model_version_id`、`generated_at`、`source_refs[]`、`provenance`、`status`；涉及方案或 runtime 時再帶 `scenario_id`／`runtime_id`，未知值為 `null`，不得補假 ID。
- 每個 KPI/量測都是 `{value, unit, observed_at, quality, source_ref, baseline?, delta?}`；沒有 unit、時間或獨立分母的數字不得上綠燈，也不得把 PNG 示意數字 hardcode 成 fixture 真相。
- AI／自然語言輸出至少帶 `{claim, confidence, interpreted_inputs, evidence_refs, limitations}`；UI 必須能從 claim 展開到證據，不接受只有流暢文字的黑箱結果。
- 任何 3D 結果仍須能追到 `ifc_guid ↔ usd_prim_path`、stage truth、first frame 與 DataChannel/Kit ack；圖片或預錄 frame 不能代替 runtime evidence。
- 會改狀態、建 Issue、建工單、啟動 job/mission 或匯出的動作必須回 `operation_id`／`audit_id` 並支援冪等鍵；UI 只在回讀成功後更新。

---

## §11 雲地邊界

1. **模型 payload（IFC/USD/點雲）不出站**——3D 審查與轉檔一律在落地端 GPU plane 完成。
2. 雲端控制面＝**metadata-only（計數/狀態/hash/摘要/時戳/版本號），全部 PLANNED**；詳規見 `ai-bim-governance-saas-*.md` 六檔（PLANNED 增補層，效力低於本檔）。
3. **未導入多租戶時的呈現義務**：tenant 徽章（虛線 pill「tenant zero · 單站點」＋`DEMO DATA` 小標）、站點連線狀態條與 nav「雲端控制面」註記一律虛線框＋`PLANNED`——**不偽綠也不偽紅**。
4. 雲端不可達不得影響任何落地端功能（轉檔/檢核/GPU 渲染/WebRTC 自主運作）；離線態文案標「本地自主運作中」。

---

## §12 租戶維度互動卡（IX-TN-01～04）

1. **不動 §4、不新增 hash route**：以下 4 張卡只在既有頁疊加租戶維度呈現；不得修改 22 條正典 route 或新增 tenant-scoped hash。
2. **租戶維度在 hash 之外**：主承載＝token `tenant_id` claim（由 coordinator 中介層集中解析），輔助＝子網域；path 前綴 `/t/:tenantId` 只可作 hash 外選配。tenant-scoped hash 是待人類簽核的新決策。
3. **里程碑前置**：卡上 `SaaS-Mx` 以前置里程碑為準，詳規見 `ai-bim-governance-saas-遷移路線與里程碑.md`；未啟動對應階段時 UI 一律使用 `PLANNED` 姿態，runtime 狀態查 `TRUTH.md`。

> 誠實標記共同紀律：卡內任何數字為「規劃值·非實測」；不以「支援完成／交付完成／即將完成／開箱即用」描述未具 runtime evidence 的能力；Prov 只用既有 7 值，租戶狀態以 `tenantId`／`scope` 正交欄位表達。

**IX-TN-01 租戶脈絡注入（PLANNED · SaaS-M2）**
- **目的**：把「這個請求屬於哪個租戶」從隱含變成可稽核的顯式脈絡，且對 tenant zero 完全向後相容。
- **前置**：SaaS-M2 身分階段啟動（org-per-tenant OIDC、`tenant_id` claim 簽發）。
- **互動流程**：登入後 token 帶 `tenant_id` claim；coordinator 租戶 context 中介層在 `/api/*` proxy 前集中驗證、解析 claim 並做範圍過濾（不讓各 service 自兜隔離）。只有**明確無 claim 且命中允許的 tenant-zero 相容路徑**時，前端 console 才顯示「單租戶（tenant zero）」；claim／header 一旦存在但 malformed、簽章無效、租戶未知或彼此不一致，不得降級成 tenant zero。
- **API 面**：不新增、不改名任何凍結 proxy 路徑；`X-Tenant-Id` 為 **additive optional header**，只有明確缺省且 request 屬允許的 tenant-zero 相容 flow 時才 fallback；`/v1` gateway（SaaS-M6）一律驗 tenant-scoped token 後 byte-identical 轉發。invalid／malformed claim 回 `401`，unknown tenant／scope 或 claim-header mismatch 回 `403`，兩者都必須在 proxy 前終止且不得觸達 downstream。**§1 proxy 路徑字串 byte-identical 不動。**
- **狀態機**：`no-claim + allowed-tenant-zero-flow → tenant-zero`；`valid-claim → claim-resolved`；`malformed/invalid-signature → rejected-401`；`unknown/scope-mismatch/header-mismatch → rejected-403`。任何 rejected 狀態均不得進入 proxy／downstream。
- **誠實標記**：`PLANNED`；凡在 governance API 加 user/org/project 參數或改 §1 禁改後端檔（app.py/governanceProxy.ts/conversion_authority.py）＝**待人類簽核的新決策**，禁在本卡預設通過。
- **驗收**：明確無 claim／header 且命中 allowed tenant-zero flow 時，行為與 tenant-zero baseline **逐位元組相同**；valid claim 存在時範圍過濾生效且徽章值＝後端回報值；malformed／invalid／unknown／mismatch case 各有 401/403 contract test，並斷言 downstream 收到 0 request。

**IX-TN-02 GPU 配額 429 呈現（PLANNED · SaaS-M3）**
- **目的**：把 GPU 資源耗盡從「輸家 process crash」改成使用者看得懂的「容量滿」狀態，而非紅色錯誤。
- **前置**：SaaS-M3 session broker 啟動（queue/quota、429+Retry-After 契約收斂 port 8011 併發搶佔 race）。
- **互動流程**：使用者於既有 `#sessions`／A1 建立 session；配額滿時後端回結構化 **429 + `Retry-After`**（含佇列深度、預估等待）；前端以**模式 1**證據型更新渲染「容量滿」卡片（顯示佇列深度、預估等待〔規劃值·非實測〕、重試按鈕），以**模式 6**錯誤狀態呈現——**429 非故障，呈現為「容量滿」非紅色錯誤**；重試按鈕依 `Retry-After` 倒數後才可再按。
- **API 面**：沿用既有 session 建立端點（`POST /api/review-sessions*`）的回應；429 為 additive 回應碼，成功路徑不變。
- **狀態機**：`submitting → 429 capacity-full（顯示等待/重試）→ retry → queued/granted`；**禁樂觀更新**。
- **誠實標記**：`PLANNED`；佇列深度/預估等待/warm pool 命中率皆為規劃值·非實測；不承諾 live migration/hot-swap/彈性熱擴縮。
- **驗收**：併發超額時前端顯示「容量滿」而非 crash 或紅錯；重試按鈕遵守 `Retry-After`；席位釋出後同一使用者重試可 granted。

**IX-TN-03 站點連線狀態徽章（PLANNED · SaaS-M1）**
- **目的**：讓 operator 一眼看出落地端與雲端控制面的連線狀態，且離線不被誤讀為故障。
- **前置**：SaaS-M1 Edge Connector 啟動（activation 註冊、5 分鐘心跳〔參照值，本平台數值待定〕、metadata-only 上報）。
- **互動流程**：console 頁首以**模式 4** provenance 徽章（後端驅動）顯示三態 `connected / offline-grace / expired`；`offline-grace` 徽章文案固定標「**本地自主運作中**」——**不偽紅也不偽綠**，並提示「僅犧牲雲端可視性與遠端控制，落地端轉檔/檢核/GPU 渲染/WebRTC 不受影響」；`expired` 提示需重連刷新憑證/金鑰。
- **API 面**：徽章值來自 Edge Connector outbound 心跳摘要（六服務 up/down、GPU 是否在跑、佇列深度）；**僅 metadata（計數/狀態/hash/摘要/時戳/版本號），IFC/USD payload 不出站**。
- **狀態機**：`connected → offline-grace → expired → connected`；離線寬限期為規劃值·非實測，平台窗口待合規拍板。
- **誠實標記**：`PLANNED`；徽章純 metadata，雲端不可達不影響任何本地功能；狀態一律後端驅動，前端不推定。
- **驗收**：拔網 E2E 時徽章轉 `offline-grace` 且標「本地自主運作中」，同時落地端四項本地功能實測全自主；網路擷取證明 payload 零出站。

**IX-TN-04 spectator 同租戶驗證（PLANNED · SaaS-M3）**
- **目的**：spectator 共看在多租戶下必須先驗證同租戶，防跨租戶偷看模型審查。
- **前置**：SaaS-M3 session broker 啟動；沿用 spectator 架構（primary 49100 + spectator 49110～49150，`KIT_SPECTATOR_COUNT`）。
- **互動流程**：使用者以 `streamRole=spectator` 加入既有 session 前，broker 顯式驗證其 `tenant_id` 與 primary session 同租戶並留**稽核 log**；通過才連 spectator endpoint；拒絕時以**模式 6**明確錯誤呈現「非同租戶，無法加入此審查」，不畫假成功。
- **API 面**：spectator 加入沿用 `/ui/open?streamRole=spectator` 通道；驗證與稽核為 additive gate，不改既有 handoff URL/session-id regex。
- **狀態機**：`join-request → tenant-check → allowed（連線）| denied（模式 6 錯誤 + 稽核）`。
- **誠實標記**：`PLANNED`；spectator 共看不佔額外 GPU、不計費，但加入前必須通過同租戶顯式驗證＋稽核 log；與 **IX-SS-05 A1 連動橋供應端**關係不變——spectator 仍讀 `#sessions` 權威證據值，不自行推定。
- **驗收**：跨租戶加入被拒並留稽核 log；同租戶 spectator 正常共看且證據值與 `#sessions` 一致（同一輪詢周期）。
