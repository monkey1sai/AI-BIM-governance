# Adjudication Index — doc-first-canon-v2（tasks.md 6.2）

> **用途**：11 條裁決（design.md §2）逐一對號落實位置——spec delta requirement id、draft data-canon-id、task commit sha——並附驗證方式，供 PR 審查者與 archive 前使用者裁決核對「哪條裁決落在哪個 requirement／哪個草稿錨點／哪個 commit」。
>
> **Base＝design.md §2**：本檔「裁決摘要」與整體裁決編號逐字取自 design.md §2「11 條裁決索引表」，不改動該表本身文字（single-ownership，design.md 擁有者續留）；本檔新增的是原表所無的四欄——Spec delta requirement id／draft data-canon-id／task commit sha／驗證方式。
>
> **commit sha 取法**：與 `crosswalk.md` §0「落實 commit」同一方法論——`git log --oneline` 對 `task#N:`／裁決相關 `fix:` 前綴訊息逐一比對 tasks.md 子任務編號後取得，欄位填**該項落地的最後一個 commit sha**（含 gap-fix／review-fix，即目前 worktree 內的最終狀態）；多 commit 鏈見 §2 附錄。
>
> **draft 三檔捷徑**（下列 grep 指令 cwd＝本 worktree 根目錄）：
> ```bash
> MAIN="openspec/changes/doc-first-canon-v2/drafts/AI-BIM 前後端設計文件.v2-draft.dc.html"
> HIFI="openspec/changes/doc-first-canon-v2/drafts/AI-BIM Console Hi-Fi.v2-draft.dc.html"
> README="openspec/changes/doc-first-canon-v2/drafts/docs-plans-README.v2-draft.md"
> ```

## 1. 11 條裁決對號主表

| # | 裁決摘要（design.md §2 逐字） | Spec delta requirement id | draft data-canon-id | task commit sha | 驗證方式 |
|---|---|---|---|---|---|
| 1 | doc-first 權威模型；三處遺跡改寫（§08 表／README §3.2-3.5／§03 carve-out 刪） | MODIFIED "Workflow v3 and product design artifacts have distinct, non-overlapping authority"（documentation-source-of-truth）＋ADDED R-B1 doc-first 偏離處置序與三態分類＋R-C2 失真地圖逐條改寫（items 22/23/24 唯一落實） | item22=`c8-authority-table`（$MAIN sec8）；item23=README `<!-- canon:r-authority-order -->`＋`<!-- canon:r-runtime-authority -->`；item24=`c3-naming-check`（$MAIN sec3） | item22=`32edfa2`；item23=`6698b75`；item24=`f079ef0`（MODIFIED body／R-B1 本文＝`378a9c1`，見 §2 附錄） | `openspec validate --strict` 綠（§4）；本次親跑 crosswalk.md item22/23/24 grep DoD 複核（`docs/plans 需求正本`→1、`需求權威＝本目錄設計正本（doc-first）`→1、`以下以程式碼為準,不回頭改程式碼命名`→0）；carve-out-assertions.md §3 七項 PASS |
| 2 | 內部裁決序（前端視覺／行為契約／場景圖分層；跨域→R2 三態） | MODIFIED "Workflow v3…"（同上，body 第 2 段「內部裁決序 SHALL 為…」）＋ADDED R-B1（cross-ref，同一 requirement 之不同段落，非第二份改寫文字） | 無專屬 owner；design.md §3「24×11 追溯矩陣」裁2 欄覆蓋 items 1／3／14／21／22／24（與裁1 共構、非裁2 獨有落實面，見 §3 附註） | body／R-B1＝`378a9c1`（task 2.1／`a35ae7f` 驗證「三點逐一到位…零修改」） | `openspec validate --strict` 綠；tasks.md 2.1 PASS 記錄三點逐字位置比對（header／前端視覺-行為契約分層／跨域 R2 三態）；design.md §3 矩陣「裁2」欄 X 標記交叉核對（task 5.5／`6c12e8d` 已核對零缺格） |
| 3 | Workspace 3D 內嵌 viewport 升格；/ui/open 凍結併存；lease/spectator follow-up | ADDED R-B6 內嵌 viewport 防護先行（documentation-source-of-truth） | item18=`c7-ch-schedule-table`（新增 CH-H／CH-I 列，$MAIN sec7）＋`c3-badge-workspace-handoff`（$MAIN sec3，HandoffButton 遺跡改寫）；follow-up `embedded-viewport`（design.md §6a，non-normative，無 data-canon-id，實作留待該 follow-up change） | `0cb7989` | `openspec validate --strict` 綠；本次親跑 `grep -A20 'data-canon-id="c7-ch-schedule-table"' $MAIN \| grep -cE "CH-H\|CH-I"` → 2；carve-out-assertions.md §3 相關子集 PASS（未觸及 §04 payload 委任／鐵律 1-3） |
| 4 | 需求正本＝docs/plans；外部 design repo 唯讀 authoring origin | ADDED R-B4 需求正本邊界（documentation-source-of-truth） | 無（design.md §3「裁4」矩陣零覆蓋，純條文化承載，不改寫任一 v2 草稿正文區塊；design.md:83 明載） | `378a9c1`（task 2.3／`acd878a` 驗證「docs/plans=全部、外部 design repo=唯讀 authoring origin，1 scenario；對映裁4。零修改」） | `openspec validate --strict` 綠；spec.md R-B4 requirement/scenario 人工核對（外部 design repo 主張新需求 SHALL 無效，須先走 R-A1 提案）；design.md §3 矩陣「裁4」欄逐格核對零 X（task 5.5／`6c12e8d`） |
| 5 | 變更控制（手寫正本使用者專屬／機器快照雙旗標／support.js 禁改／版本 bump） | ADDED R-A1 手寫正本寫入授權邊界＋R-A2 機器快照面寫入路徑限定＋R-A3 support.js 生成物永不手改＋R-A4 改版可回復性（design-canon-change-control capability，全部 4 requirement） | 無（design.md §3「裁5」矩陣零覆蓋；本 capability 規範「誰能動正本」之治理程序，不改寫 v2 草稿任一正文區塊） | `9de421a`（design-canon-change-control/spec.md 最終狀態；鏈見 §2 附錄） | `openspec validate --strict` 綠；本次親跑 requirement/scenario 計數 grep（`^### Requirement:`→4、`^#### Scenario:`→9）；R-A4 dry-run restore 證據：tag `canon-v2-baseline-20260718`＝`0d24fb6`（本次親跑 `git rev-parse` 確認存在），dry-run restore diff 空（tasks.md 0.4 記錄） |
| 6 | R2 API 三態（整合／全棧／外接才 mock）；A4 mock 邊界劃在 LLM 解讀層 | ADDED R-B5 R2 三態、mock 邊界與狀態詞彙統一（documentation-source-of-truth） | item12=`c8-r2-api-tristate`＋`c8-domain-reality-table`＋`c8-task-sequence-table`（$MAIN sec8；另涉 README `<!-- canon:r-four-iron-rules -->` R2 子句同錨） | `633b832`（鏈見 §2 附錄） | `openspec validate --strict` 綠；本次親跑 `grep -cE "Isaac\|Replicator\|P6[^0-9]" $MAIN` → 0（具名外部依賴已 genericize）；`grep -A20 'data-canon-id="c8-domain-reality-table"' $MAIN \| grep -c "planned(class: in-repo-fullstack-pending)"` → 3 |
| 7 | git history（a271e46 父版）撈回 TARGET-*／A5–A10 契約、對照裁決 re-審 | ADDED R-C4 裁決 7 撈回防腐（documentation-source-of-truth） | task 5.6 於 $MAIN sec6 新增 7 張 domain 實體卡：`c6-telemetry-sample`／`c6-work-order`／`c6-schedule-activity`／`c6-capture-job-deviation`／`c6-dataset-job`／`c6-robot-mission`／`c6-scenario`（全標 `planned(class: in-repo-fullstack-pending)`）；逐句 source commit 標注另存獨立 artifact `recovered-requirements.md`（R-C1 分離原則：裸 file:line 證據不進正本） | `879f2e1`（鏈見 §2 附錄） | `openspec validate --strict` 綠；本次親跑 7 張新卡 grep（`data-canon-id="c6-(telemetry-sample\|work-order\|schedule-activity\|capture-job-deviation\|dataset-job\|robot-mission\|scenario)"`）→ 7；carve-out-assertions.md §3 七項 PASS（不改 §07:575 A5–A10 deferral 節奏）；recovered-requirements.md 三值判定表逐句附 source commit |
| 8 | A5/A6/A10 逐元件拆分（in-repo 全棧／外接 mock 合法） | ADDED R-B5（同裁6，requirement 內「A5/A6/A10 SHALL 依逐元件拆分」句） | item12=`c8-r2-api-tristate`＋`c8-domain-reality-table`（同裁6，A5/A6/A10 逐元件標記於 `c8-domain-reality-table` 內 3 處 `planned(class: in-repo-fullstack-pending)`） | `633b832`（同裁6） | 同裁6驗證；crosswalk.md item12「對應裁決編號」欄含「裁1,6,8」（design.md §3 矩陣核對，task 5.5） |
| 9 | KIT_SPECTATOR_COUNT 預設 0；邀請連結真複製；內嵌 spectator streamRole | ADDED R-B6（同裁3，「spectator 與 issues 裁決落地方向」scenario 前半） | item14=`c4-coordinator-api`（§04 HTTP 語意；裁9 的 spectator 面 normative 落於延伸錨 `c8-r2-api-tristate` 之「:49100(WebRTC signaling)與 spectator 埠段」正式契約句，$MAIN sec4/sec8，與 crosswalk.md item14／design.md §3 矩陣「裁9」欄一致。KIT_SPECTATOR_COUNT 預設 0／邀請連結真複製之具名參數屬 §07 CH-I follow-up embedded-viewport 塊 item18=`c7-ch-schedule-table`／`0cb7989`，係 non-normative 前提脈絡、非本裁決 normative 落點） | `dcadd6f` | `openspec validate --strict` 綠；本次親跑 `grep -c ":49100(WebRTC signaling)與 spectator 埠段" $MAIN` → 1（item14 §04 spectator 埠段 normative 落點，同 crosswalk.md item14 DoD）；`grep -c "KIT_SPECTATOR_COUNT 預設 0、邀請連結真複製" $MAIN` → 1（$MAIN sec7 CH-I follow-up 前提脈絡） |
| 10 | issues 權威入口 unified #a1?dock=issues；legacy #issues 雙軌退役 | ADDED R-B6（同裁3/9，同一 scenario 後半） | item19=`c3-badge-dual-track`（$MAIN sec3）；follow-up `unified-docks-real-api`（design.md §6a，non-normative，無 data-canon-id） | `6729fea` | `openspec validate --strict` 綠；本次親跑 `grep -c "雙軌現況(2026-07-18)" $MAIN` → 1；`grep -c "issues 權威入口【目標】=unified #a1?dock=issues" $MAIN` → 1 |
| 11 | migrate-console／align-frontend 反向漂移按 code reconcile 後 archive | 無 normative spec requirement（design.md §6a follow-up 表列名「openspec-ledger-reconcile（裁決 E）」，non-normative、不構成實作授權；design.md §1.2 記載排序約束：MUST NOT 早於 canon v2 採納 archive） | 無（follow-up 本身不改寫 v2 草稿；design.md §3「裁11」矩陣部分覆蓋 items 3／5／10／16／19，見 §3 附註） | `378a9c1`（design.md §6a 該列自提案原始 commit 起未再修改；task 5.5／`6c12e8d` 僅修正 §3 矩陣說明句、未動 §6a 表） | `openspec validate --strict` 綠；design.md §6a follow-up 表人工核對（對應 in-flight change＝migrate-console-to-hifi-design、align-frontend-design-system-reference）；design.md §3 矩陣「裁11」欄 X 標記核對（task 5.5／`6c12e8d`，design.md:83 修正後文字） |

## 2. 多 commit 鏈附錄（補充主表「task commit sha」單一終態值）

| 裁決 | commit chain（時間序，最後一個＝主表 task commit sha） |
|---|---|
| 1（item22） | `8d12b8b`（task#7 base：§08 權威順序表翻轉為 doc-first）→ `32edfa2`（task#7 review-fix：移除誤植「使用者最新明確指令」列） |
| 1（item23） | `6698b75`（單一 commit：README §3 權威語意翻轉） |
| 1（item24） | `f079ef0`（單一 commit：刪 §03 命名核對 carve-out） |
| 1/2（MODIFIED body／R-B1 本文） | `378a9c1`（提案原始寫入）→ 驗證：`a35ae7f`（task#3／tasks.md 2.1，零修改）、`acd878a`（task#5／tasks.md 2.3，零修改） |
| 5（R-A1..A4） | `378a9c1`（提案原始，4 requirement／6 scenario）→ `7d2f7e7`（task#1，補 R-A3 support.js 對稱 enforcement scenario）→ `858f16f`（task#1，補 R-A1 自行 merge 對稱 enforcement scenario）→ `9de421a`（補 R-A1 direct-edit 對稱 enforcement scenario；終態 4 requirement／9 scenario） |
| 6/8（item12） | `6a6cfa1`（task#7 base：item12 A4 hybrid 誠實化＋R2 卡三態重寫）→ `68e1507`（task#7 fix：§08 餵法表殘留對齊）→ `633b832`（task#7 fix：A5/A6/A10 planned 補封閉 class token） |
| 7（task 5.6／R-C4） | `4041ce7`（task#5：撈回入 draft＋新建 recovered-requirements.md，tasks.md 5.6 打勾）→ `af85e48`（task#5 fix：R3 撈回誠實化＋補 D5/D7 來源行號）→ `e45b3e3`（task#5 fix：縮限 planned 標籤範圍，改列第三值「需使用者裁」）→ `879f2e1`（fix：校正四項引註／錨欄失真，R-C4 撈回＋gap-ledger） |
| 3（item18） | `0cb7989`（單一 commit：§07 補 CH-H semantic viewer 家族＋CH-I 內嵌 viewport 新期，翻轉 §03 handoff badge） |
| 9（item14） | `dcadd6f`（單一 commit：§04/§08 HTTP 語意顯式化補列——apply-overlay 501／A3 create 201／element-mapping→:49101／PROXY 白名單／:49100 signaling 與 spectator 埠段；裁9 spectator 面即落此 §04 正式契約，與 crosswalk.md item14／design.md §3 矩陣一致，非 §07 CH-I／item18） |
| 10（item19） | `6729fea`（單一 commit：§03 補雙軌現況誠實入文徽章） |

## 3. 方法論與交叉核對備註

- **「裁決→data-canon-id」對映規則（三分）**：(i) design.md §2「落地位置」欄逐字明列 R-C2 item # 者——裁1＝items 22/23/24／裁3＝item 18／裁6＝item 12／裁8＝item 12——本檔直接取該 item 於 `crosswalk.md` 已驗證的 data-canon-id／commit；(ii) design.md §2 僅列 R-B6／R-C4＋task、未逐字列 item # 者——裁9／裁10／裁7——改依 design.md §3「24×11 追溯矩陣」（task 5.5／`6c12e8d` 核對版，零缺格）該裁決欄 X 標記回落對應 item 後再取 `crosswalk.md` 已驗證值：裁9→item14（矩陣「14 §04 HTTP 語意」列裁9 格 X；crosswalk.md item14 對應裁決＝裁1,2,6,9）、裁10→item19（矩陣「19 §03 雙軌」列裁10 格 X），裁7 自身落實為 §06 task 5.6 之 c6-* 實體卡（非 crosswalk 編號 item）；(iii) design.md §2 未列 item # 者——裁2／裁4／裁5／裁11——本檔如實標「無」或「無專屬」（其矩陣覆蓋屬背書關係、非自身落點，見本節後續 note）。全程以 design.md §2＋§3 兩來源為準，**不臆造** design.md 未載明的 item 歸屬；凡 §2 未逐字列 item # 者一律回落 §3 矩陣、不另擇他解——此即裁9 取 item14（§04 正式契約）而非 §07 CH-I／item18 之依據：CH-I 內「KIT_SPECTATOR_COUNT」字面屬 follow-up embedded-viewport 前提脈絡、non-normative，crosswalk.md 與 design.md §3 矩陣均把 item18 記為裁1,3 背書、把裁9 的 normative 落點歸 §04 item14。
- **裁2／裁9／裁10 與裁1／裁3 共用同一條文之不同段落／scenario**：MODIFIED "Workflow v3…" body 分三段（doc-first 權威模型→裁1；內部裁決序→裁2；誠實鐵律半句→非 11 條裁決之一，屬 R-B2 cross-ref）；R-B6 的「spectator 與 issues 裁決落地方向」單一 scenario 同時承載裁9（KIT_SPECTATOR_COUNT／邀請連結）與裁10（issues 入口）前後兩句。裁6／裁8 共用同一 R-B5 requirement 之不同句子（R2 三態 vs A5/A6/A10 逐元件拆分）。此為 design.md §1.1「新增治理需求一律入 ADDED…MUST NOT 產生第二份改寫文字」single-ownership 原則之直接後果，非本檔遺漏或裁決重複。
- **裁4／裁5 矩陣零覆蓋為既定事實非缺格**：design.md §3:83（task 5.5／`6c12e8d` 核對後文字）明載「裁 4（需求正本邊界→R-B4）、裁 5（變更控制→design-canon-change-control）矩陣零覆蓋，不直接改任一失真項文字，而以獨立條文承載」；R-C2b（spec.md:166-173）「覆蓋失真或明列條文化落實」為「或」非互斥關係，零覆蓋＋條文化承載仍屬合規，不觸發 R-C2b 缺格 scenario。
- **裁7／裁11 矩陣部分覆蓋**：design.md §3:83 同段落記載「裁7→items 2/11/13；裁11→items 3/5/10/16/19」（矩陣 X 標記，非本檔臆造）；此為裁決對其他 item 的**背書關係**（該 item 的最終文字與裁7／裁11 的裁決結論一致），並非裁7／裁11 自身的落實 commit——裁7 自身落實仍為 task 5.6（`879f2e1`），裁11 自身無落實 commit（純 non-normative follow-up 具名，design.md §6a）。
- **verified-as-of**：2026-07-19，本檔所有 grep／validate 指令於本 task 執行時對 worktree 內三份 v2 草稿與兩份 spec delta 逐項親跑複核（見各列「驗證方式」欄輸出），非轉抄先前 PASS note。

## 4. 最終 `openspec validate doc-first-canon-v2 --strict` 輸出

執行環境：worktree 根目錄 `C:/Repos/active/iot/AI-BIM-governance/.worktrees/doc-first-canon-v2`（branch `openspec-doc-first-canon-v2`）；openspec CLI 版本 `1.6.0`（`npx openspec --version`，與 design.md §7 記載一致）；執行時間 2026-07-19。

```
$ npx openspec validate doc-first-canon-v2 --strict
Change 'doc-first-canon-v2' is valid
```

exit code＝0。
