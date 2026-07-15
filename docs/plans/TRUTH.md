---
as_of: 2026-07-15
as_of_commit: d78ceef
generated_from: 人工核對（2026-07-10 repo 盤點 + code 逐檔讀；2026-07-13 對 #323–#329 增量複核；2026-07-14 BCF provenance 路徑複核；2026-07-14 A9/A10 route 身分與 viewer 七區塊 code 對帳；2026-07-15 design reference／branch-protection 回讀）；未來可換腳本重生
---

# TRUTH — 現況帳本

> v2 · 2026-07-15 · design reference coverage 與 visual fidelity 實測欄
> 本檔是全 docs/plans 體系**唯一**可寫 `BUILT / PARTIAL / NOT-BUILT` 的檔。現況問本檔；需求與驗收條件問 `TARGET-*`；排序與 OPEN 決策問 `BACKLOG.md`；紀律問 `PROCESS.md`。本檔不解釋「為什麼」、不留歷史敘事（git 即審計）。

## §0 維護規約

1. 本檔是唯一可寫建成狀態（BUILT/PARTIAL/NOT-BUILT）的檔；其他檔出現建成宣稱＝bug，改該檔。
2. 改變任一 route 建成面的產品 PR，必須同 PR 更新本檔對應列（閘 2，見 PROCESS §6）。
3. 過期＝就地改寫；本檔可整檔拋棄重生——來源＝repo prov 標註（`data.ts`）＋tests＋`artifacts/e2e/`，不是上一版本檔。
4. 未觀測一律寫 `not observed`，不留空、不猜測。

## §1 殼層 22 route 現況主表

route＝EdgeConsole hash route（無斜線，`#a1` 非 `#/a1`）；design screen/state 取自 tracked `design-system-reference.manifest.json`，缺少時寫 `reference_missing`。visual fidelity 只記本 commit 實測結果；未執行一律 `not observed`，不能把 99% 目標寫成現況。狀態三值 enum；主 Prov 取自 `web-viewer-sample/src/console/data.ts`（7 值：asbuilt/artifact/demo/p1/p15/p3/p4）。

目前 manifest 有 13 個 default screens／26 個 goldens，read-only authoring snapshot 已包含 `design-doc.html`。2026-07-15 branch-protection 回讀確認 `required_approving_review_count=1`、`require_code_owner_reviews=true`、`dismiss_stale_reviews=true`、`enforce_admins=true`；但 `.github/CODEOWNERS` 全域只列 `@monkey1sai`，direct collaborator 也只有同一帳號，且沒有 review bypass。由該帳號建立 PR 時沒有獨立 code owner 可核准，故人工 review gate 現況是 `blocked_self_approval_deadlock`，不能算 review trust 已建立；遠端設定尚未降低，解除方式必須是新增至少一位獨立合格 CODEOWNER／協作者，或經明確授權改採可滿足的 solo-maintainer／trusted base-branch gate。遠端 main 尚無 `design-semantic-visual` producer，因此該 context 未留在 required 清單，避免 expected-context deadlock；啟用授權已取得，待 workflow landed 且 machine gate 可執行後再啟用。現況 `semantic_contract.status=state_variants_reference_missing`、`implemented_case_ids=[]`，functional/runtime machine producer／validator亦未建；viewer lockfile 刻意未追蹤，runner 只有 `windows-2025` label、字型只驗 ready，resolved dependency tree／runner image／font fingerprints均未 pin。因此 frontend product design job仍 fail closed、`full_completion_allowed=false`，production 99% alignment全部仍為 `not observed`。golden／CI job定義都不等於 product pass。

| route | design screen/state | 狀態 | 主 Prov | 現況／visual fidelity | 驗收指令 / evidence |
|---|---|---|---|---|---|
| `#home` | `console.home.default` | PARTIAL | asbuilt | Smart Todo 導向頁齊；Recent Risk 列為 demo；visual result／tracked browser trace 均 not observed | `artifacts/e2e/2026-07-10-wave-b/home.png`；dual gate not observed |
| `#a1` | `workspace.a1.default` | PARTIAL | asbuilt | 五步狀態機＋雙來源檢核＋記分板＋3D 高亮 session＋Issue/Excel/BCF 齊；rollback=p1；visual result／tracked browser trace 均 not observed | `artifacts/e2e/edge-console-primary-ui-deploy/edge-console-a1-desktop.png`、`artifacts/e2e/real-ifc-storage-intake.png`；governance pytest（rule_engine/ids/bcf）；dual gate not observed |
| `#a2` | `workspace.a2.default` | PARTIAL | asbuilt | diffs＋issue-impact 齊；apply-overlay 誠實回 501、3D 著色走 client highlight（p15）；visual result／selector E2E／trace not observed | governance pytest（diff）；dual gate not observed |
| `#a3` | `workspace.a3.default` | PARTIAL | asbuilt | federation set/coords/build/handoff 已建；clash NOT BUILT；visual result not observed | governance pytest（federation）；clash 端點 grep=0；visual result not observed |
| `#a4` | `workspace.a4.default` | PARTIAL | asbuilt | deterministic/semantic/auto 搜尋與 proxy 已建；3D highlight client-pull；BCF bridge 未建；visual result／browser trace not observed | governance search tests＋coordinator proxy tests＋viewer A4 tests；dual gate not observed |
| `#a5` | `concept.a5.default` | NOT-BUILT | p3 | AppVisionPage 佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed（vision 頁自標 p3） |
| `#issues` | `reference_missing` | PARTIAL | asbuilt | Issue/BCF 生命週期部分已建；provenance gate與 assignee 前端未齊；approved pixel reference／tracked browser trace not observed | governance pytest（issues/ids/bcf）；dual gate not observed |
| `#reports` | `reference_missing` | PARTIAL | p1 | StubPage 狀態清單；A1 Excel 匯出已在；coverage/review package=p1；approved pixel reference missing | `npm run verify`；visual/browser evidence not observed |
| `#viewer` | `reference_missing` | PARTIAL | asbuilt | ViewerPresentationPage 說明頁；2D pixel reference missing；七區塊 runtime 現況見 §2 | runtime screenshots 已有；2D visual gate/trace not observed |
| `#gpu` | `reference_missing` | PARTIAL | asbuilt | Review Room 殼已建；no-GPU 誠實態；2D pixel reference missing | runtime screenshots 已有；2D visual gate not observed |
| `#a6` | `concept.a6.default` | NOT-BUILT | p4 | AppVisionPage 佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed |
| `#a7` | `concept.a7.default` | NOT-BUILT | p4 | AppVisionPage 佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed |
| `#a8` | `concept.a8.default` | NOT-BUILT | p4 | AppVisionPage 佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed |
| `#a9` | `concept.a9.default` | NOT-BUILT | p4 | 機器人／自主巡檢佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed |
| `#a10` | `concept.a10.default` | NOT-BUILT | p4 | AI 決策工作台佔位、後端不存在；concept golden 存在但 production visual result not observed | not observed |
| `#conv` | `pipeline.default` | PARTIAL | asbuilt | AliasRedirect→`#minio`；轉檔歷史專頁未建；後端 list＋proxy 已在；visual result not observed | runtime screenshots 已有；design gate not observed |
| `#sessions` | `reference_missing` | PARTIAL | asbuilt | runtime status＋per-row close 已建；Force release/Reclaim=p1；pixel reference missing，terminate E2E/trace not observed | runtime screenshot 已有；dual gate not observed |
| `#instances` | `reference_missing` | PARTIAL | asbuilt | Kit instance 遙測部分已在；GPU busy/VRAM未取得、drain/move=p1；pixel reference missing | runtime screenshot 已有；design gate not observed |
| `#minio` | `reference_missing` | PARTIAL | asbuilt | 真 S3＋SSE＋轉檔生命週期；usdc 回填 p1；pixel reference missing／trace not observed | coordinator tests＋runtime screenshots；dual gate not observed |
| `#runtime` | `runtime.ops.default` | PARTIAL | asbuilt | 監控彙總齊；GPU 遙測未取得；visual result／tracked browser trace not observed | runtime screenshot 已有；dual gate not observed |
| `#admin` | `reference_missing` | NOT-BUILT | p1 | StubPage；approved pixel reference missing | not observed（stub 自標 p1） |
| `#spec` | `reference_missing` | PARTIAL | asbuilt | Repo boundary 對照頁；approved pixel reference／browser evidence missing | `npm run verify`；dual gate not observed |

**非正典保留頁**（不列入 22 條主表；身分見 contracts §4 別名表）：

| route | 狀態 | 主 Prov | 現況一句 | 驗收指令 / evidence |
|---|---|---|---|---|
| `#review` | PARTIAL | asbuilt | 獨立 route 直渲染 ReviewRoomPage；design screen=`reference_missing`，Section/Snapshot=p15；2D visual gate與直達 trace not observed | `artifacts/e2e/primary-spectator-authority.png`（runtime companion）；`#review` direct dual gate not observed |

## §2 viewer 七區塊 runtime 現況（legacy geo-viewer 只作互動 companion）

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

Hero runtime slices＝A1＋A2＋A3 federation＋A4 語意查詢（deterministic＋Ornith vLLM semantic）；依 PROCESS §2 dual gate，缺 visual result 或 tracked browser/runtime trace 時仍記 PARTIAL。

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
- Design reference coverage 權威＝`docs/plans/design-system-reference.manifest.json` 的 `route_inventory[]`；目前 semantic variants、design required-check enforcement與 functional/runtime machine gate均未完成，product job／full-completion claim必須 fail closed。production 是否達標只認 current-checkout CI Playwright output 經 validator 重算，且只有在對應 check 已納入 branch protection後才具 merge authority；目前尚未納入，不能由 golden、PR body或外部 JSON 推定。
- 本表是快照非權威：與 code＋tests 不符時，改本表。
