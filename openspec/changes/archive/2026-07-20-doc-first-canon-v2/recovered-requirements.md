# Recovered Requirements — doc-first-canon-v2（R-C4 裁決 7 撈回防腐）

> **用途**：本檔是 R-C4「裁決 7 撈回防腐」的權威落地面——從 `a271e46^`（舊七檔體系刪除前之父版）實查撈回 TARGET-shell／TARGET-viewer／TARGET-contracts 的具體負向驗收句與 A5–A10 domain 契約，逐句標 source commit（file:line）、對照現行 11 條裁決 re-審、下三值判定。**本檔本身即為集中承載 file:line 證據之處**（比照 `gap-ledger.md` 之 R-C1 精神：v2 正本 SHALL NOT 內嵌裸 `file:line`；本檔屬 R-C4 之獨立追溯載體、非手寫正本本體，不受該條款限制，DoD 明文要求本檔含 source file:line）。

## 0. 撈回方法與來源

- **來源 commit**：`a271e46^` = `1abeb91a6645c58eae4994ace6d9bccde6597d3b`（"feat(a4): gap-a4-closeout runtime-gate evidence + BCF unavailable 裁決 + BACKLOG v4 重排 (#341)"，2026-07-15 14:17:11 +0800）——即 `a271e46`（"docs(plans): 以 AI-BIM 前後端設計文件.dc.html 取代 docs/plans 舊七檔體系 (#342)"）刪除舊七檔體系**前**的最後一個父版，本檔以下引註一律用此 SHA。
- **檔名確認**：實跑 `git show a271e46 --stat` 確認三檔刪除路徑逐字為 `docs/plans/TARGET-contracts.md`（404 行）、`docs/plans/TARGET-shell.md`（522 行）、`docs/plans/TARGET-viewer.md`（305 行）。
- **實查方式**：`git show a271e46^:docs/plans/TARGET-shell.md`／`TARGET-viewer.md`／`TARGET-contracts.md` 分別導出後逐行 Read／Grep；行號＝該歷史版本原始行號（未經改寫、未經 `cat -n` 之外的任何轉換）。
- **範圍界定**：任務原文列 4 個負向驗收句代表例＋9 項 A5–A10 domain 契約子項（7 實體＋Issue source enum＋A8 例外）。本輪撈回聚焦此清單逐項實查；未做超出清單之全 22 route 驗收句地毯式重寫（YAGNI——見 §4 範圍說明）。

## 1.（a）負向驗收句撈回（4 項，全數尋獲）

| ID | 撈回內容（改寫為 doc 語態） | Source（`1abeb91a`:file:line） | 對照裁決 | 三值判定 |
|---|---|---|---|---|
| R1 | usd_prim_path 缺失／null（mapping 缺）時，該筆連動一律 disabled、不得觸發 `highlightPrimsRequest`（A1/A2/A4 共同鐵律） | `docs/plans/TARGET-shell.md:109`（A1 IX-06 四條件）、`:137`（A2 驗收句「null mapping 不發 highlight」）、`:177`（A4 驗收句「mapping 缺失不 highlight」）；`docs/plans/TARGET-viewer.md:276`（IX-3D-03）；`docs/plans/TARGET-contracts.md:32`（§1 item 6「usd_prim_path 未映射時為 null（禁捏造）」） | 裁1（doc-first 總綱）、裁2（前端行為契約分層） | 相容 |
| R2 | A3 federation 之 `coord_check=mismatch` 阻擋下一步（build／Review Room 交付），並保留已輸入資料 | `docs/plans/TARGET-shell.md:149`（IA unit 欄）、`:153`（誠實 fallback「CRS/unit 不一致…各自阻擋下一步並保留已輸入資料」）、`:157`（驗收句「unit mismatch 阻擋」） | 裁1、裁2 | 相容 |
| R3 | BCF 匯出僅限 `source=rule-run｜diff` 建立之 issue，`manual` 建立者不可匯出（**此為舊 TARGET 文件之要求；經實查與現行實作不符，見 §1.1**） | `docs/plans/TARGET-contracts.md:34`（§1 item 8 兩步流程）、`:333`（§10.2 issue schema 備註）、`:335`（§10.2 gating「匯出資格必須限於由 from-rule-run／from-diff 建立的 issues」）；`docs/plans/TARGET-shell.md:307`（`#issues` BCF gating 誠實兩步） | 裁1、裁2（惟原「呼應 README §3.4／效力不變」之認定經查不成立，見 §1.1） | **與現行實作衝突 → 需使用者裁**（見 §1.1） |
| R4 | A1 3D 高亮／session-ready 需四條件同時成立：`DataChannel ready ∧ first_frame_at ∧ stage matched ∧ 目標 usd_prim_path 存在`；viewer 回 ack 才算完成（非 timer 假進度） | `docs/plans/TARGET-shell.md:105`（Evidence Inspector 欄位）、`:109`（IX-A1-06「3D 高亮四條件」）、`:117`（驗收句「WebRTC 首幀、stage matched、同 GUID prim 高亮 ack」） | 裁1、裁2 | 相容 |

**處置**（R1／R2／R4 相容 → 入 v2；R3 經實查與現行實作衝突 → undecided，比照 D8 不作正本斷言）：

| ID | 注入位置（data-canon-id） | 是否套 `planned` 標籤 |
|---|---|---|
| R1 | `c6-element-mapping`（§06，既有卡追加行內備註） | **否** |
| R2 | `c6-federated-set`（§06，既有卡追加行內備註） | **否** |
| R3 | **不作正本斷言**；`c6-issue-bcf-topic`（§06）卡改標「現行真實 gate＝kind=issue／有 ifc_guid、與 source 無關」＋撈回目標指回本檔 §1.1 | —（undecided，非採納） |
| R4 | `c6-review-session`（§06，既有卡追加行內備註） | **否** |

**用詞說明（為何 R1／R2／R4 不套 `planned`）**：R1／R2／R4 描述的是 A1–A4（已落地／真整合域，見 `c8-task-ch-crosswalk`「A1 / A2 / A3 真整合,已落地」與 `c8-domain-reality-table` A4 列「deterministic 檢索已全棧落地」）之既有系統行為，非「尚未建置」的目標。若套 `planned` 標籤等同宣稱已完成的行為尚未建置，違反誠實鐵律「不得以文件宣稱 runtime 已完成」之反向情形——不得把已完成說成未完成。任務原文摘要句「統一標 planned」之範圍，依任務內文細項分句解讀：僅 (b) A5–A10 domain 契約群組有「全列標 `planned`」之明文要求（見下），(a) 負向驗收句僅要求「注入 §04/§06 對應卡或 §08 R4 DoD 附錄區塊」，未附加標籤要求；本輪選擇前者（注入既有 §06 對應卡），並依誠實鐵律採「(a) 不套 `planned`／(b) 全套 `planned`」為候選標籤策略。**惟「`planned` 僅適用 (b) 群組」係對 spec.md R-C4（`spec.md:191`）SHALL 級「統一標 planned」之縮限解讀，屬 owner 單方認定；依 R-C4 本身「三值判定 SHALL 為 owner 提候選＋使用者終裁」之精神，該範圍認定不逕自定案，已改列本檔第三個「需使用者裁」項（見 §1.2）待使用者拍板。**（R3 為此四句之例外：經實查與現行實作衝突，改列 undecided、不作正本斷言，理由與證據見 §1.1。）

### 1.1 R3 更正——與現行實作衝突，改列「需使用者裁」（gap fix：2026-07-19，fixer）

R3 撈回句「BCF 匯出僅限 `rule-run｜diff` 建立之 issue、`manual` 不可匯出」**於現行系統不成立**。原判「相容／已落地、不套 `planned`」所依之旁證——現行 v2 draft §04 已列 `/from-rule-run/:runId`、`/from-diff/:diffId` 兩端點——僅證明「可由 rule-run／diff **建立** issue」，並未證明「BCF 匯出資格綁 `source`」；二者為不同斷言、驗證強度不足。實查現行 `governance-service` 程式碼與測試，BCF 匯出真實 gate 只看 `kind="issue"`（即有 `ifc_guid`），**與 `source_type` 無關**，`manual` 建立且帶 `ifc_guid` 之 issue 一樣可匯出：

- `governance-service/issues/store.py:92`——`create_issue` 之 `source_type` 預設 `"manual"`。
- `governance-service/issues/store.py:97`——`kind = "issue" if ifc_guid else "annotation"`，僅依 `ifc_guid` 有無、與 `source` 無關。
- `governance-service/issues/store.py:178-187`——`list_issues` 僅濾 `status/severity/model_version_id/kind`，**無** `source_type` 篩選。
- `governance-service/bcf/api.py:24`——`/api/bcf/export` 呼叫 `store.list_issues(..., kind="issue")`，未傳 `source_type`。
- `governance-service/issues/api.py:36-44`——手動建立端點 `POST /api/issues` 之 `IssueCreate` 本就可帶 `ifc_guid`（帶 guid → `kind="issue"` → 可匯出）。
- `governance-service/tests/test_bcf.py:141-165`——匯出測試中被排除者為「無 `ifc_guid` → annotation」（測試註解「annotation 不計」），排除理由是 `kind`、非 `source=manual`；**無**任何測試排除「`manual` 且帶 `ifc_guid`」之 issue。
- `web-viewer-sample/src/console/A1GovernanceWorkbenchPage.tsx:124`——前端 `bcfIssues` 亦只濾 `kind==="issue" && Boolean(issue.ifc_guid)`，不分 `source`。
- `bim-review-coordinator/src/routes/governanceProxy.ts:538-539`——`/api/governance/bcf/export` 為純二進位透傳、無篩選。

另註：原判引「呼應 README §3.4 後端凍結面」，實查現行 `README.md` 與 `docs/plans/docs-plans-README.md` §3.4 均無「BCF 匯出限 source」之凍結條款，該引用不成立。

**三值判定改判**：R3 屬「撈回之舊要求與現行實作衝突」——是否把匯出資格收緊為 `source`-gated，屬產品／安全設計決策，doc-only 撈回任務不得逕自認定，故改列**與現行實作衝突 → 需使用者裁**。處置比照 D8：不作正本斷言，僅於 `c6-issue-bcf-topic` 卡明標現行真實 gate（`kind=issue`／`ifc_guid`）並將撈回之收緊目標指回本節。

### 1.2 planned 標籤範圍認定——縮限 SHALL 條文，改列第三個「需使用者裁」項（gap fix：2026-07-19，fixer）

**爭點**：spec.md R-C4（`openspec/changes/doc-first-canon-v2/specs/documentation-source-of-truth/spec.md:191`）SHALL 明列「…逐一對照現行 11 條裁決 re-審…、**統一標 planned**」，其三值判定並定義「相容→入 v2 **標 planned**」；字面上「相容即標 planned」涵蓋全部 11 項「相容→採納」候選（R1／R2／R4＋D1–D7／D9），未區分 (a)(b) 兩類。本輪實作只對 (b) A5–A10 domain 契約群 8 項（D1–D7、D9）套 `planned(class: in-repo-fullstack-pending)`；(a) 負向驗收句 3 項（R1／R2／R4）刻意不套，理由見上 §1 用詞說明（三者描述 A1–A4 **已落地**行為，套 `planned` 違反誠實鐵律「不得把已完成說成未完成」）。該「已落地」事實另經本 session 獨立實查覆核屬實：`web-viewer-sample/src/console/governance/highlightBridge.ts:52-55`（R1：`primPathForGuid` 回 null 時 `highlightFailed` 直接 return `{ok:false, reason:"unmapped"}`、不建 `highlightPrimsRequest`）、`governance-service/federation/api.py:161-181`（R2：`coord_report` 不一致時 `mark_build_stale` ＋刪 stale build ＋回 409「federate aborted」、set／members 資料保留）。

**判定**：此縮限解讀**於事實面可信**（誠實鐵律為硬約束、非偏好），但屬 owner 對 SHALL 級條文的**單方面範圍縮限**。依 R-C4 本身「三值判定 SHALL 為 owner 提候選＋使用者終裁」之精神，owner 不得逕自認定此範圍；前一輪僅在 §1 用詞說明內以 owner 立場定案、未另立待裁項，且未回頭同步 spec.md:191 措辭，使 spec.md 現況文字（絕對「統一標 planned」）與 draft 已落地行為（R1／R2／R4 不套 `planned`）之間，出現本 change 自身要根除的「文件與現況不同步」落差。

**改列第三個「需使用者裁」項**（與 R3〔§1.1〕、D8〔§2〕並列於本檔待裁登記）。本項屬**標籤範圍政策**認定、非某條撈回句之三值判定，故**不改動** 13 項候選之撈回計數（仍 11 相容／2 undecided）。owner 提候選＋待使用者終裁：

| 選項 | 內容 | owner 傾向 |
|---|---|---|
| (i) | 確認「`planned` 僅適用 (b) 群組」；R1／R2／R4 維持行內備註、不套 `planned`，並由使用者授權**同步修正 spec.md:191 措辭**（把絕對「統一標 planned」改為「相容且尚未建置者標 `planned`；相容但描述 A1–A4 已落地行為者以行內備註落地、不套 `planned`」），消除 spec↔現況落差 | **傾向**（合誠實鐵律、且使 spec 內外一致） |
| (ii) | 維持 spec.md:191 字面「統一標 planned」，改為 R1／R2／R4 亦套**非** `planned` 之落地標籤（如 `landed`／`in-repo-live`）以「有標籤」滿足 SHALL 形式 | 備選（需新增標籤詞彙，牽動 §08 domain-reality 表詞彙封閉性） |
| (iii) | 其他處置 | 使用者另裁 |

**單一權責註記（R-C2）**：spec.md 非本 task（5.6，Files＝recovered-requirements.md＋draft）之權責檔；上表選項 (i) 之 spec.md:191 措辭同步修正，須使用者裁定後由 spec.md 權責方執行，本檔不逕自改動 spec.md（比照 task 5.4 對 `gap-ledger.md`、task 5.5 對 `design.md` 之 single-ownership 處置：發現跨檔落差時記錄並指名，不越權編輯）。使用者未裁定前，draft 現況〔(b) 套 `planned`、(a) 不套〕為 owner 提之**暫定候選態**、非最終定案。

## 2.（b）A5–A10 domain 契約撈回（9 項，全數尋獲）

| ID | 撈回內容 | Source（`1abeb91a`:file:line） | 對照裁決 | 三值判定 |
|---|---|---|---|---|
| D1 | `Scenario{scenarioId,baselineId,name,assumptions,inputRefs,createdBy}`（A6/A10 基準與替代方案） | `docs/plans/TARGET-contracts.md:308` | 裁1、裁6（R2 三態）、裁8（A5/A6/A10 逐元件拆分） | 相容 |
| D2 | `TelemetrySample{sourceId,pointCode,value,unit,observedAt,quality}`（A5/A9 時序量測） | `docs/plans/TARGET-contracts.md:309` | 裁1、裁6、裁8 | 相容 |
| D3 | `WorkOrder{workOrderId,assetId,issueId,status,assignee,dueAt,sourceRef}`（A5 維保閉環） | `docs/plans/TARGET-contracts.md:310` | 裁1、裁6、裁8 | 相容 |
| D4 | `ScheduleActivity{activityId,wbsCode,planned/actual dates,progress,costCode,elementGuids}`（A6 甘特／EVM／3D overlay 共同鍵） | `docs/plans/TARGET-contracts.md:311` | 裁1、裁6、裁8 | 相容 |
| D5 | `CaptureJob／Deviation{captureJobId,sourceUri/hash,transform,rms,elementGuid,deviationMm,toleranceMm}`（A7 對齊與偏差） | `docs/plans/TARGET-contracts.md:312`（資料模型列＋「精度與 tolerance 必須可追溯」）；`docs/plans/TARGET-shell.md:233`（`#a7` 誠實 fallback「未對齊前禁止顯 deviation」，即注入卡負向驗收句之來源） | 裁1、裁6、裁8 | 相容 |
| D6 | `DatasetJob{datasetJobId,stageHash,camera/seed,outputs,status,artifactRefs}`（A8 逐幀可回溯） | `docs/plans/TARGET-contracts.md:313` | 裁1、裁6、裁8 | 相容 |
| D7 | `RobotMission{missionId,mode,robotId,route/waypoints,sensorPack,status,eventRefs}`；`mode=simulation｜physical` 須由後端回傳並顯眼、不可由 UI 猜測；預設僅 simulation | `docs/plans/TARGET-contracts.md:314`；`mode` 誠實鐵律另見 `docs/plans/TARGET-shell.md:271`（A9 節「RobotMission.mode=simulation｜physical 必須由後端回傳並顯眼」）；「預設僅 simulation」注入句來源 `docs/plans/TARGET-shell.md:265`（`#a9` 使用情境「預設是模擬；實機模式另需 edge/ROS 證據」） | 裁1、裁6、裁8；`mode` 誠實揭露呼應現行 R3 Provenance（`c8-r3-provenance`） | 相容 |
| D8 | 共同 Issue 出海口 `source` 欄擴充為逐 app 歸屬列舉 `A1｜A2｜A3｜A4｜A5｜A6｜A7｜A9｜A10｜manual` | `docs/plans/TARGET-contracts.md:319-333`（JSON 範例 `"source":"A1"` ＋ 列舉定義） | 裁1；與現行 v2 draft `c6-issue-bcf-topic` 卡既有 `source: rule-run｜diff｜manual` 欄位**同名不同語意**（現行欄位＝issue 建立路徑／BCF 資格判準，撈回欄位＝app 歸屬） | **含糊／部分重疊** |
| D9 | A8 job failure 留在 `DatasetJob` 自身、不自動轉共同治理 Issue（A8 為共同 Issue schema 之唯一排除例外） | `docs/plans/TARGET-contracts.md:303`（資料模型表 Issue 列註「A8 job failure 留在 DatasetJob」）、`:333`（§10.2 同句＋「不自動轉治理 Issue」）；`docs/plans/TARGET-shell.md:306`（`#issues` IA「A8 job failure 不自動轉 Issue」） | 裁1、裁8 | 相容 |

**處置**：

| ID | 判定結果 | 注入位置（data-canon-id） | 標籤 |
|---|---|---|---|
| D1 | 相容 → 入 v2 | `c6-scenario`（§06 新卡群） | `planned(class: in-repo-fullstack-pending)` |
| D2 | 相容 → 入 v2 | `c6-telemetry-sample`（同上） | 同上 |
| D3 | 相容 → 入 v2 | `c6-work-order`（同上） | 同上 |
| D4 | 相容 → 入 v2 | `c6-schedule-activity`（同上） | 同上 |
| D5 | 相容 → 入 v2 | `c6-capture-job-deviation`（同上） | 同上 |
| D6 | 相容 → 入 v2 | `c6-dataset-job`（同上） | 同上 |
| D7 | 相容 → 入 v2 | `c6-robot-mission`（同上） | 同上 |
| D8 | **含糊／部分重疊 → undecided，不入 v2** | 未注入；僅於新卡群結尾加註提示句指回本檔 | — |
| D9 | 相容 → 入 v2 | 隨 D6 併入 `c6-dataset-job` 卡內文（非獨立卡，因語意本屬 DatasetJob 之行為規則） | `planned(class: in-repo-fullstack-pending)`（承 D6） |

D1–D7、D9 全數套用 `planned(class: in-repo-fullstack-pending)`，依任務原文明文「A5–A10 domain 契約→§06 新增「planned domain 實體(A5–A10)」卡群,全列標 `planned`」；卡群另加註記：外接引擎（Replicator／Cosmos／Isaac Sim／點雲 ICP 等）之 mock 合法性分類不變，仍以 `c8-domain-reality-table` 既有 `external(mock 合法,掛 ProvTag)` 為準，本卡群不改該表——`planned` 標籤僅描述**實體本身**（in-repo 資料形狀）尚待建置，非重新裁決外接引擎的 mock 政策。

**D8 未採納理由**：撈回句原意（Issue.source 逐 app 歸屬）與現行 v2 draft 已落地卡片 `c6-issue-bcf-topic` 的 `source: rule-run｜diff｜manual`（issue 建立路徑，直接對應 BCF 兩步 gating 判準）為**同名欄位、不同語意**。若直接把 `A1..A10` 併入同一欄位列舉，會與現行已通過 carve-out／crosswalk 驗證的欄位定義衝突，且該欄位目前是 A1/A2 已真整合行為的忠實描述，不應被回填舊文件的不同語意覆寫。是否需要新增獨立欄位（如 `origin_app`）承載 app 歸屬語意，屬需要使用者裁決的新設計決策，非本 doc-only 撈回任務可逕自認定，故列 undecided、不入 v2，僅在 §06 新卡群結尾留提示句指回本檔（見 draft 內 `planned domain 實體(A5–A10)` 卡群結尾備註句）。

## 3.「防復活」查核（R2 三態／裁決 6 是否推翻舊決策）

逐項檢查 (a)(b) 共 13 項撈回候選是否觸及已被 R2 三態（裁6）或裁8 推翻之舊決策（例如：舊版曾要求「先 mock 過渡」之類語句）：

- TARGET-shell.md／TARGET-contracts.md 中與 A5–A10 直接相關之段落（`#a5`–`#a10`、§10.1 資料模型）**未見**任何「先 mock 過渡」「暫以假資料上線」類語句；A8/A9 段落提及外接引擎（Replicator／Cosmos／Isaac Sim）之官方能力邊界，但未主張這些引擎本身要被 mock 掉，與現行 `c8-domain-reality-table` 之 `external(mock 合法,掛 ProvTag)` 分類（外接引擎層可 mock，非資料實體層）不衝突、亦非「舊決策復活」。
- 撈回句 R1–R4、D1–D9 皆為**資料形狀／行為規則**陳述，不涉及「要不要 mock」之實作路徑決策，故不落入裁6／裁8 的推翻範圍。
- 結論：13 項候選中**零項**觸發「已被 R2 三態／裁決 6 推翻」之淘汰情形；三值判定的「乾淨衝突 → 已淘汰、不入 v2」分支本輪**無**適用項目。

## 4. 未撈回／來源不可考

任務原文列出之 4 個負向驗收句代表例與 9 項 A5–A10 domain 契約子項，**全數於 `a271e46^` 尋獲對應來源**，無「來源不可考、不撈回」之項目。

範圍說明（避免誤讀為窮盡撈回）：TARGET-shell.md 尚有 A5–A10 以外之其餘 15 個 route（A1–A4、`#issues`、`#reports`、`#viewer`、`#review` 等）之驗收句，以及 A5–A10 段落內未被任務原文點名之其餘細節（如 A6 的 CV/SV/CPI/SPI 公式、A9 的 navmesh／E-stop 細節、A7 的 PDF/Excel/LAS 三種 artifact 匯出規格）**未**逐句撈回——這些不在任務原文「撈回兩類」之明確清單內，屬本輪 YAGNI 範圍外；如後續需要，應另立 task 明確點名範圍。

## 5. DoD 對照（draft-submitted）

- [x] 撈回清單附 source file:line：見 §1／§2 各列 Source 欄。
- [x] 三值判定結果：見 §1／§2 各列「三值判定」欄；13 項中 11 項相容已採納入 v2，2 項列 undecided、不入 v2（R3 經實查與現行實作衝突→需使用者裁，見 §1.1；D8 含糊／部分重疊）。
- [x] 對照 11 條裁決 re-審：見 §1／§2「對照裁決」欄；§3 另做「防復活」專項查核（R2 三態／裁6／裁8 有無推翻本輪候選）。
- [x] 撈不到的項標「來源不可考、不撈回」：本輪無此情形，見 §4 說明。
- [x] 採納句已入 draft；`planned` 標籤範圍（僅 (b) 群組套用）為 owner 提之**暫定候選**，其「縮限 spec.md:191 SHALL『統一標 planned』」之範圍認定已改列第三個「需使用者裁」項（見 §1.2）待使用者終裁：
  - R1／R2／R4 → `c6-element-mapping`／`c6-federated-set`／`c6-review-session`（既有卡追加備註，未套 `planned`，理由見 §1）。
  - R3 → 未作正本斷言（與現行實作衝突→需使用者裁，見 §1.1）；`c6-issue-bcf-topic` 卡改標現行真實 gate（`kind=issue`／`ifc_guid`）＋撈回目標指回本檔。
  - D1–D7、D9 → 新卡群 `c6-scenario`／`c6-telemetry-sample`／`c6-work-order`／`c6-schedule-activity`／`c6-capture-job-deviation`／`c6-dataset-job`／`c6-robot-mission`（全標 `planned(class: in-repo-fullstack-pending)`）。
  - D8 → 未入 v2，undecided，留提示句指回本檔。
- [x] 不改 §07:575 deferral 節奏：`carve-out-assertions.md` §3 合併執行 7 項於本次編輯後複跑全數 `PASS`（含 `[5] §07:575 A5-A10 deferral`）。
- [x] tasks.md 5.6 打勾（隨本次 commit 一併完成）。

---

verified-as-of：2026-07-19（本 task 對 `a271e46^`（`1abeb91a6645c58eae4994ace6d9bccde6597d3b`）三份歷史檔逐項 Read／Grep 實查所得；`carve-out-assertions.md` §3 合併執行 7 項於本次 draft 編輯後複跑全數 PASS；draft HTML div/span 標籤配對 300/300·618/618；CRLF 全檔保留（806 行、0 bare LF）；`data-canon-id` 全域 55 個、較編輯前 48 個增加 7 個且零重複；**gap fix 2026-07-19（fixer）**：R3 經實查 `governance-service` 程式碼與測試判定與現行實作衝突（BCF 匯出真實 gate＝`kind=issue`／`ifc_guid`、與 `source` 無關），三值判定由「相容」改列「需使用者裁」、新增 §1.1 承載證據、draft `c6-issue-bcf-topic` 卡改標現行真實 gate＋撈回目標指回本檔，採納計數由 12/1 更正為 11/2；另補 D5／D7 額外來源行號 `TARGET-shell.md:233`／`:265`。**gap fix 2026-07-19（fixer，第二輪）**：將「`planned` 標籤僅適用 (b) 群組」此對 spec.md:191 SHALL「統一標 planned」之縮限解讀，依 R-C4「owner 提候選＋使用者終裁」精神改列本檔第三個「需使用者裁」項（新增 §1.2、re-frame §1 用詞說明、更新 §5 DoD 對照）；R1／R2 之 A1–A4 已落地行為另經 `web-viewer-sample/src/console/governance/highlightBridge.ts:52-55`／`governance-service/federation/api.py:161-181` 本 session 獨立實查覆核屬實；spec.md 非本 task 權責檔，其 §191 措辭同步修正列為 §1.2 選項 (i) 待使用者裁、本檔不逕自改動；`npx openspec validate --strict` 複跑綠、draft 未改動故 carve-out §3 七項與 draft 結構檢核不受影響、仍 PASS。**gap fix 2026-07-19（fixer，第三輪：source 引註行號校正）**：R3 列 §10.2 issue schema 備註引註 `TARGET-contracts.md:307`→`:333`（:307 實為 §10.1〔header=:294〕EvidenceRef 實體列，:333 才是 §10.2〔header=:316〕issue schema 備註；`a271e46^` 導出後 Read offset＋grep -n 雙驗）；D9 列 `:335`→`:333`（:335 為 BCF 兩步 gating 句〔R3 已正確引用〕，D9 標的「A8 job failure 留在 DatasetJob，不自動轉治理 Issue」逐字實在 :333）；D7 列 Source 欄 verbatim quote 半形 pipe `simulation|physical`→全形『｜』（消 GFM 表格切欄錯位；python 掃全檔 5 表逐列欄數與表頭一致＝MISMATCHES 0）；三處僅校正 source 引註定位／表格轉義，撈回內容·三值判定·採納計數 11/2 均不變）。
