---
as_of: 2026-07-14
as_of_commit: 9a49d96
generated_from: 人工核對（2026-07-10 repo 盤點 + code 逐檔讀；2026-07-13 對 #323–#329 增量複核；2026-07-14 BCF provenance 路徑複核；2026-07-14 A9/A10 route 身分與 viewer 七區塊 code 對帳）；未來可換腳本重生
---

# TRUTH — 現況帳本

> v1 · 2026-07-10 · AI-coding 文件體系重設計（依使用者指令，以兩份 prototype 為基準）
> 本檔是全 docs/plans 體系**唯一**可寫 `BUILT / PARTIAL / NOT-BUILT` 的檔。現況問本檔；需求與驗收條件問 `TARGET-*`；排序與 OPEN 決策問 `BACKLOG.md`；紀律問 `PROCESS.md`。本檔不解釋「為什麼」、不留歷史敘事（git 即審計）。

## §0 維護規約

1. 本檔是唯一可寫建成狀態（BUILT/PARTIAL/NOT-BUILT）的檔；其他檔出現建成宣稱＝bug，改該檔。
2. 改變任一 route 建成面的產品 PR，必須同 PR 更新本檔對應列（閘 2，見 PROCESS §6）。
3. 過期＝就地改寫；本檔可整檔拋棄重生——來源＝repo prov 標註（`data.ts`）＋tests＋`artifacts/e2e/`，不是上一版本檔。
4. 未觀測一律寫 `not observed`，不留空、不猜測。

## §1 殼層 22 route 現況主表

route＝EdgeConsole hash route（無斜線，`#a1` 非 `#/a1`）；prototype 錨＝`ai-bim-governance-prototype.html` 頁 id。狀態三值 enum；主 Prov 取自 `web-viewer-sample/src/console/data.ts`（7 值：asbuilt/artifact/demo/p1/p15/p3/p4）。

| route | prototype 錨 | 狀態 | 主 Prov | 與 prototype 差距一句 | 驗收指令 / evidence |
|---|---|---|---|---|---|
| `#home` | `#home` | PARTIAL | asbuilt | Smart Todo 導向頁齊；Recent Risk 列為 demo 資料；PROCESS §2 要求的 tracked browser trace 未觀測 | `artifacts/e2e/2026-07-10-wave-b/home.png`；trace not observed |
| `#a1` | `#a1` | PARTIAL | asbuilt | 五步狀態機＋雙來源檢核＋記分板＋3D 高亮 session＋Issue/Excel/BCF 齊；rollback=p1；tracked browser trace 未觀測 | `artifacts/e2e/edge-console-primary-ui-deploy/edge-console-a1-desktop.png`、`artifacts/e2e/real-ifc-storage-intake.png`；governance pytest（rule_engine/ids/bcf）；trace not observed |
| `#a2` | `#a2` | PARTIAL | asbuilt | diffs＋issue-impact 齊；apply-overlay 後端誠實回 501、3D 著色走 client highlight（p15）；selector E2E 與 tracked trace 未觀測 | governance pytest（diff）；selector E2E / trace not observed |
| `#a3` | `#a3` | PARTIAL | asbuilt | federation（建 set/validate-coords/build usda/handoff）已建；clash 為 NOT BUILT／未開工，O6 已裁決 ifcclash | governance pytest（federation）；clash 端點 grep=0（not observed） |
| `#a4` | `#a4` | PARTIAL | asbuilt | B 閉環語意查詢：`POST /api/search/model` 支援 `interpret_mode=deterministic\|semantic\|auto`；semantic＝Ornith vLLM OpenAI-compatible（env `ORNITH_API_KEY`／`A4_LLM_*`，key 不進 git）→ JSON filters → IFC 掃描；coordinator for-session/for-ifc-ready＋`/search/llm-status`；EdgeConsole `#a4` 可切模式；3D highlight 仍 client-pull；BCF bridge 未建 | governance `test_search_model.py`＋`test_search_llm.py`；coordinator search proxy tests；viewer A4 page tests；live Ornith 連線依 env；browser trace not observed |
| `#a5` | `#a5` | NOT-BUILT | p3 | AppVisionPage 佔位頁，後端不存在 | not observed（vision 頁自標 p3） |
| `#issues` | `#issues` | PARTIAL | asbuilt | 3 內建規則＋IDS-XML 匯入＋BCF 匯出＋Issue 生命週期齊；BCF export path 目前匯出全部 formal issues，generic create 帶 `ifc_guid` 時預設 `source_type=manual` 仍會進匯出，未執行 TARGET 的 rule-run/diff provenance gate；「在 3D 標示」p1 disabled；assignee 後端齊（schema `assignee` 欄＋create API＋BCF `AssignedTo` 映射：`issues/store.py`·`issues/api.py`·`bcf/bcf_writer.py`）、前端寫入 UI 未建（顯「指派 pending」）；tracked browser trace 未觀測 | `issues/store.py`＋`issues/api.py`＋`bcf/api.py` source inspection；`artifacts/e2e/issues-tab.png`；governance pytest（issues/ids/bcf）；trace not observed |
| `#reports` | `#reports` | PARTIAL | p1 | StubPage 狀態清單；A1 Excel 匯出已在（指向既有匯出）；coverage 報表／review package=p1 未建 | `npm run verify`；報表產生器 UI not observed |
| `#viewer` | `#viewer` | PARTIAL | asbuilt | ViewerPresentationPage 說明頁；對照 geo-viewer 原型七區塊差距大（見 §2） | `artifacts/e2e/viewer-tree-focus.png`、`artifacts/e2e/gov-viewer-layout.png` |
| `#gpu` | `#gpu` | PARTIAL | asbuilt | Review Room 殼已建；MockViewport 無 first frame 時顯示 deterministic no-GPU（不偽稱 live 3D） | `artifacts/e2e/primary-spectator-authority.png`、`artifacts/e2e/stage-artifact-binding.png` |
| `#a6` | `#a6` | NOT-BUILT | p4 | AppVisionPage 佔位頁，後端不存在 | not observed |
| `#a7` | `#a7` | NOT-BUILT | p4 | AppVisionPage 佔位頁，後端不存在 | not observed |
| `#a8` | `#a8` | NOT-BUILT | p4 | AppVisionPage 佔位頁，後端不存在 | not observed |
| `#a9` | `#a9` | NOT-BUILT | p4 | 機器人／自主巡檢 AppVisionPage 佔位頁（`slug="robot-sim"`，身分對齊 TARGET-shell §a9），後端不存在 | not observed |
| `#a10` | `#a10` | NOT-BUILT | p4 | 其他應用／AI 決策工作台 AppVisionPage 佔位頁（`slug="ai-decision"`，身分對齊 TARGET-shell §a10；ChatUSD 併入本 route，舊 `usd-copilot` 存為 legacy alias）；後端不存在。殼層全域 ChatUSD 右欄（`EdgeConsole.tsx` `ec-agent`，標 ROADMAP·A10、input disabled）是**全站元件，非本頁特徵** | not observed |
| `#conv` | `#conv` | PARTIAL | asbuilt | repo 為 AliasRedirect→`#minio`；轉檔歷史 UI 專頁未建；後端 list（`/api/conversion/records`）＋proxy 已在 | `artifacts/e2e/md-merge-trace/01-alias-redirect-queue-highlight.png`、`artifacts/e2e/real-ifc-conversion-lineage.png` |
| `#sessions` | `#sessions` | PARTIAL | asbuilt | 真 runtime status＋per-row 結束 session（IX-SS-04）已落地；Force release／Reclaim=p1 disabled；terminate E2E 與 tracked trace 未觀測 | `artifacts/e2e/infra-slice/sessions-evidence-bridge.png`；terminate E2E / trace not observed |
| `#instances` | `#instances` | PARTIAL | asbuilt | Kit instance 真遙測已在；GPU busy/VRAM=未取得（標 demo）、drain/move=p1 | `artifacts/e2e/infra-slice/instances-live-kit.png` |
| `#minio` | `#minio` | PARTIAL | asbuilt | ModelDataPage 三頁合一：真 S3 逐層＋SSE＋轉檔生命週期；usdc 回填 p1、bucket layout 示意標 demo；tracked browser trace 未觀測 | `artifacts/e2e/md-merge-trace/02-object-detail-real-ledger.png`、`artifacts/e2e/infra-slice/minio-ledger-coverage.png`；coordinator `npm test`（minio-objects/folder route）；trace not observed |
| `#runtime` | `#runtime` | PARTIAL | asbuilt | 監控彙總齊；GPU 遙測=未取得（標 demo）；tracked browser trace 未觀測 | `artifacts/e2e/infra-slice/runtime-monitor-summary.png`；trace not observed |
| `#admin` | `#admin` | NOT-BUILT | p1 | StubPage：RBAC／rulesets／runtime policy 全未建 | not observed（stub 自標 p1） |
| `#spec` | `#spec` | PARTIAL | asbuilt | Repo boundary contract 對照說明頁（kit-manager-api 標 p1）；browser screenshot/trace 未觀測 | `npm run verify`；browser evidence not observed |

**非正典保留頁**（不列入 22 條主表；身分見 contracts §4 別名表）：

| route | 狀態 | 主 Prov | 現況一句 | 驗收指令 / evidence |
|---|---|---|---|---|
| `#review` | PARTIAL | asbuilt | 獨立 route 直渲染 ReviewRoomPage（非轉址；機器真相＝`EdgeConsole.tsx` `case "review"`）；與 TARGET-shell §4.1 規格的介面對齊差距未逐項校對（見 BACKLOG gap-review-room-alignment）；Section/Snapshot=p15 | `artifacts/e2e/primary-spectator-authority.png`（經 `#gpu` 殼取證，GpuReviewRoomPage 內嵌同一 ReviewRoomPage）；`#review` 直達截圖 not observed |

## §2 viewer 七區塊現況（對照 `ai-bim-geo-viewer-prototype.html`）

| 區塊 | 狀態 | 現況一句 / evidence |
|---|---|---|
| 1 點選高亮 | PARTIAL | Review Room attach＋focus/select/clearHighlight=asbuilt；highlightPrimsRequest=p15 client-pull；`artifacts/e2e/primary-spectator-authority.png` |
| 2 IFC 語意 | PARTIAL | IfcSemanticPanel／SemanticViewerPage 需手貼 mapping URL；`artifacts/e2e/element-semantics.png` |
| 3 結構樹 dim/iso | PARTIAL | 空間巢狀樹已建：`console/viewer/StructureStats.tsx` 經 coordinator spatial-tree for-session proxy 真 fetch（loading/error/no_url/ok 四態；無 session 時退回 element_mapping 類別計數，fake mapping 帶警示）；**dim／iso 篩選模式與一鍵取消未建**；tracked browser trace 未觀測 |
| 4 GUID⇔USD 對應表 | PARTIAL | MappingTable 元件＋同置測試在；c-m4 mapping row click 截圖 not observed（本機 evidence 未入 git） |
| 5 幾何條 | PARTIAL | UI 已建：`console/viewer/IfcSemanticPanel.tsx` ⑤幾何／分類碼卡誠實標 roadmap N/A（BBox／體積／材質、MasterFormat/OmniClass/Uniformat 分類碼 pipeline 無來源、端點回 null，不捏造）；**缺口在後端資料源，不在前端 UI**；tracked browser trace 未觀測 |
| 6 Pset/Qto | PARTIAL | UI 已建且真 fetch：`console/viewer/IfcSemanticPanel.tsx` 經 coordinator `/api/governance/elements/for-session/:sessionId/:guid` 逐 Pset 逐 property 渲染（null 顯「—」）；五態齊（no_sel/loading/ok/error/not_found）；tracked browser trace 未觀測 |
| 7 Spatial | PARTIAL | UI 已建且真 fetch：`console/viewer/IfcSemanticPanel.tsx` ⑥空間關係渲染 IFC 空間包含鏈（同一 elements for-session 端點），無容納關係時誠實表態；tracked browser trace 未觀測 |

## §3 NOT BUILT 硬清單（13 項；任何文件不得寫成已交付）

1. A5–A10 全部後端（IoT-FM/4D5D/reality capture/synthetic data/robot sim/AI 決策工作台）。A4 後端已建（PARTIAL；deterministic＋Ornith vLLM semantic 兩模式，見 §1 `a4` 列；仍非完整 TARGET IA，BCF bridge 未建）。
2. ChatUSD agent 欄真實對話/MCP 執行（純版型，input disabled）。
3. server→viewer push highlight（2026-05-21 已退役；現行 client-pull p15）。
4. viewer section/snapshot（p15）。
5. A2 apply-overlay 3D 著色（端點 501；著色走 client highlight p15）。
6. GPU per-node 遙測/kit-manager-api/drain/move/Reclaim/Force-release（p1）。
7. Admin RBAC/ruleset/runtime policy（stub p1）。
8. mapping coverage 報表與 review package（p1）。
9. A3 clash detection（未開工；O6 已裁決 ifcclash，核准 spec/plan 從 runtime probe 起步；2026-06-23 `has_occ=False` spike 不是 repo runtime 現況）。
10. session store 跨部署 volume 保證（`SessionStore` 已寫 `data/sessions/*.json` 磁碟；程序重啟檔案仍在，但 Docker volume／checkout 清除仍會丟）。
11. A1 rollback（p1）。
12. MinIO usdc/coverage/ready 回填（p1）。
13. conversion dispatch queue 持久化（in-memory FIFO；coordinator 重啟即 `dropped_on_restart`）。

## §4 A1–A10 一覽

| A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | A10 |
|---|---|---|---|---|---|---|---|---|---|
| PARTIAL | PARTIAL | split（federation implementation exists／clash NOT BUILT·未開工） | PARTIAL | p3 | p4 | p4 | p4 | p4 | p4 |

Hero runtime slices＝A1＋A2＋A3 federation＋A4 語意查詢（deterministic＋Ornith vLLM semantic）；依 PROCESS §2 的新硬 gate，缺 tracked browser trace 時仍記 PARTIAL。

## §5 已建閉環

MinIO watch／手選 IFC → coordinator intake（ifc-ready job＋ConversionLedger）→ streaming :49101 IFC→USDC＋element_mapping.json → review session＋Kit 綁 stage → :8004/ui EdgeConsole（A1 檢核→Issue→Excel/BCF；A2 diff；A3 federation；A4 semantic search for-session/for-ifc-ready→governance filter results→manual Issue；MD 頁全生命週期；sessions/instances/runtime 觀測；Review Room attach 3D＋focus/select/highlight client-pull）→ `/ui/open` 302 → :5173 WebRTC viewer（primary＋spectator）。
已入 git 的最強證據＝`artifacts/e2e/real-ifc-*` 三張＋`stage-artifact-binding.png`＋`primary-spectator-authority.png`＋`md-merge-trace/`、`infra-slice/` 系列；c-m4／seven-axis 系列截圖 not observed（本機 evidence 未入 git）。

## §6 已知系統性缺陷（現況事實，不是紀律）

- conv `coverage_ratio=1` 為自我參照（usd_stage_enumeration 同源分母），非 IFC lossless 覆蓋率，不得當品質宣稱。
- 轉檔併發搶 Kit vendor port 8011 的 race 已修（#325：`convert-ifc-to-usdc.ps1` 停用轉檔用不到的 HTTP listener）；部署區重建後的真轉檔回歸 not observed。
- **易失 vs 持久（勿混）**：`SessionStore`＝磁碟 JSON（`SESSION_STORE_DIR`／預設 `data/sessions`）；`ConversionDispatchQueue`／預設 ifc-ready 記憶體 map＝程序重啟即失；callback outbox 可掛 path，deliver 需顯式 `deliverPending`（非自動保證雲端收到）。

## §7 機器真相宣告

- 路由 case 權威＝`web-viewer-sample/src/console/data.ts` `PAGES[]`＋`EdgeConsole.tsx`（repo 實有 ~30 case 含保留別名；收斂見 BACKLOG gap-route-convergence）。
- Prov 權威＝`data.ts` 逐 Panel/Field 標註（7 值 enum，禁 `prov="todo"`，TS2322）。
- 本表是快照非權威：與 code＋tests 不符時，改本表。
