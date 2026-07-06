# 2026-07-06 docs/plans SaaS 改版重定位 — formal spec

status: proposed
owner: docs/plans 治理小組
scope: 純文件變更(docs-only),零 code、零凍結契約變更

> 命名慣例:本檔依 `docs/superpowers/specs/` 目錄既有慣例命名為 `YYYY-MM-DD-<slug>-design.md`(見同目錄
> `2026-07-06-agent-doc-budget-machine-gates.md`、`2026-07-06-routing-model-fallback-lanes.md` 等同日既有檔)。
> 本檔位於 `docs/superpowers/specs/` 目錄下,是 `docs/plans/` 大改的 formal spec 佐證,消 pr-review-agent
> 的 `missing_openspec` blocker(`scripts/lib/pr-review-agent.ps1` 對 `^docs/superpowers/specs/.+\.md$` 視為
> 等同 formal spec evidence)。

## Why

現況 `AI-BIM-governance` 的 `docs/plans/` 文件群描述的是「單站點單租戶已建成閉環」的產品定位(coordinator
127.0.0.1:8004 單一部署、單租戶 governance token、單站 MinIO)。本輪 SaaS 改版把產品文件層重定位為「雲端控制
面 + 落地端 data/GPU plane」的雲地混合多租戶 SaaS(H1),但**本 PR 是純文件變更**:零 code、零凍結契約變更、
`data.ts` 不動、22 條正典路由不動。

驅動原因:
1. 現況站點是唯一已建成的產品實例,任何 SaaS 願景若不先在文件層把「這是 tenant zero,不是過渡物」講清楚,後
   續實作容易誤觸凍結面(§1 十二條後端凍結契約、A.1.1 22 條路由、Prov 七值、對齊矩陣 §4.4 裁決)。
2. `docs/plans/` 是 `AGENTS.md` §0.1 裁決鏈與 `docs-plans-README.md` §1 效力序直接管轄的文件集,任何大改
   依 repo 治理慣例(`agents-md-repo-local-doc-pattern` 教訓、`missing_openspec` gate)須有 formal spec 佐證,
   否則 `pr-review-agent` CI 擋線會擋 PR。
3. 十個懸而未決的多租戶設計問題(路由租戶維度、後端凍結面與租戶並存、Prov 是否加值、MinIO 隔離、GPU 資源
   模型、O7/IX-SS-04 授權面、資料庫遷移、§8 七項、目錄搬遷、BCF 3.0)已在 `wf3-final.json` 完成裁決,需要
   落地成可審查、可機器驗證的文件變更,而非停留在暫存 job 檔案。

## What Changes

本 PR 依 corpus map 動 19 個檔(11 既有檔 + 7 新檔 + 本 formal spec 本身),全部落在 `docs/plans/` 或
`docs/superpowers/specs/`,**不碰任何 `.ts`/`.tsx`/`.py`/`.ps1`/`.json`(除既有 job 暫存檔外)**。

### 既有檔動法(11 檔)

**4 個 minimal-touch(只增補指定段落,其餘一字不動)**
| 檔案 | 增補內容 |
|---|---|
| `docs/plans/docs-plans-README.md` | 角色清單追加 8 列新檔;檔尾新增「SaaS 增補層導讀(2026-07-06)」段 |
| `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` | 檔尾追加 PART D(4 張新 IX-TN 卡,全 PLANNED) |
| `docs/plans/ai-bim-governance-design-system-對齊矩陣.md` | 檔尾追加附錄:6 新檔 + 審批報告對照表 |
| `docs/plans/ai-bim-governance-實作紀律與技術債防線.md` | §3 清單尾端追加 D-34~D-37(SaaS 前瞻陷阱) |

**3 個 section-rewrite(只動指名章節,其餘逐字保留)**
| 檔案 | 可動範圍 |
|---|---|
| `docs/plans/ai-bim-governance-開發軌跡與執行計畫.md` | PART 1 定位敘事改寫 + PART 3 M5+ 段新增 SaaS-M1~M8 對照表 |
| `docs/plans/ai-bim-governance-設計規格.md` | §1-§2 視覺層新增「SaaS 品牌演進提案(candidate·未拍板)」小節 |
| `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md` | §5 行號經 GitNexus 核對後修正 + 檔尾新增 §9 增補章 |

**2 個 prototype 外科手術式增補(嚴禁整檔重生、嚴禁新增頁面)**
- `docs/plans/ai-bim-governance-prototype.html`
- `docs/plans/ai-bim-geo-viewer-prototype.html`

**2 個審批報告 keep-as-is(零改動)**
- `docs/plans/審批報告-docs-plans-design-system-對齊重建-2026-06-23.md`
- `docs/plans/審批報告-docs-plans-A1v2-2026-07-02.md`

### 新檔(7 個,全落 `docs/plans/` 同目錄,不搬遷不改前綴)

1. `docs/plans/ai-bim-governance-saas-架構總覽.md` — 雲地混合 SaaS 架構總綱
2. `docs/plans/ai-bim-governance-saas-租戶與身分.md` — 租戶模型 / Bridge 隔離 / 身分與 token 相容路徑
3. `docs/plans/ai-bim-governance-saas-GPU經濟與計量計費.md` — session broker / GPU 硬約束 / 三軸計量
4. `docs/plans/ai-bim-governance-saas-公開API與標準對齊.md` — /v1 物理分離 / webhook / BCF / IDS / bSDD
5. `docs/plans/ai-bim-governance-saas-合規資料主權與生命週期.md` — ADR / 資料主權三層 / 生命週期 / DR / GDPR
6. `docs/plans/ai-bim-governance-saas-遷移路線與里程碑.md` — SaaS-M1~M8 scope / DoD / 回退,唯一詳規源
7. `docs/plans/審批報告-docs-plans-SaaS改版-2026-07-06.md` — 本輪 SaaS 改版審批紀錄(現行最高審批)

### README.md 增補(2 處)

`README.md` 文件地圖章節(第 133-137 行既有六份文件清單處)追加 SaaS 新檔的一句話引註;不修改既有六份文件的
逐字檔名連結。

### 零變更聲明

**本 PR 零 code 變更、零凍結檔變更、`data.ts` 不動、22 條正典路由不動。** 不修改任何 `.ts`/`.tsx`/`.py` 檔;
不修改 `governance-service/app.py`、`governanceProxy.ts`、`conversion_authority.py` 等 §1 禁改後端檔清單;
不修改 `web-viewer-sample/src/console/data.ts`。

## Contract

以下 H1-H8 為本輪 SaaS 藍圖裁決(`wf3-final.json` `decision_summary`)的八條硬約束,全部文件變更逐條遵守:

- **H1** 雲地混合定位:雲端只做租戶/站點目錄、身分、計量計費、規則分發、跨站聚合、稽核帳本;SaaS ≠ 全上雲。
- **H2** 落地端六服務(Kit GPU 渲染、IFC→USD 轉檔、governance 檢核、本地 storage/MinIO、WebRTC 串流)為一級
  產品元件,永不規劃淘汰;全雲託管僅為 SaaS-M8 後期選項。
- **H3** A1-A10 建成裁決狀態一律不變:對齊矩陣 §4.4 為唯一裁決源,Prov 恰 7 值不擴。
- **H4** 增補層原則:SaaS 新增內容一律新增而非覆寫既有凍結面(22 路由、§1 十二條、Prov 型別、A.1.1)。
- **H5** 誠實地基:全部 SaaS 能力標 PLANNED/NOT BUILT;定價/容量/SLO 數字一律標「(規劃值·非實測)」。
- **H6** metadata-only:IFC/USD payload 不出站,雲端只收白名單 metadata 投影;全雲託管為明確 opt-in 例外。
- **H7** `docs/plans/` 目錄不搬遷、不改名、不改前綴。
- **H8** GPU 物理死線(NVIDIA 官方兩次核實):1 GPU=1 Kit instance=1 primary stream,無 live migration。

### Preservation 關鍵錨點清單(逐字不動)

- `docs-plans-README.md` §1 效力順序全文(含「效力不看版本號大小」)
- `互動實作規格與標準對齊.md` A.1.1 正典路由表 22 條(hash 無斜線;#gpu 正典;#review 別名禁重定向;#admin
  佔位;保留別名清單)
- `design-system-對齊矩陣.md` §4.4 A1-A10 建成裁決表(Hero built = A1+A2+A3-federation;A3-clash
  blocked-on-OCC;A4-A10 NOT BUILT·p3/p4)
- Prov 型別七值:`asbuilt|artifact|demo|p1|p15|p3|p4`(`data.ts:6`,禁發明第 8 值,`prov="todo"` 會
  `TS2322`)
- 六服務埠表:coordinator `127.0.0.1:8004`、governance-service `:49102`、信令 `49100`/串流 `47998`/轉檔
  `49101`/spectator `49110~49150`、viewer `:5173`、kit-manager-api `:8010`、MCP sidecars `9901-9903`
- 前端對齊DS手冊 §1 後端凍結契約全 12 條(禁改後端檔清單;proxy 路徑字串 byte-identical,如
  `POST /api/governance/rule-runs`)
- IX-SS-04 裁定 A(刻意不加 IP allowlist)逐字保留
- O7 assignee 維持 `O7·P1 dashed` 不提供假控制
- §8 七項待人類拍板清單維持 OPEN,本輪明文不定案任一項

### 待人類簽核的新決策(未簽核前不得實作)

本 PR 只記錄以下觸發條件,**不實作**任何一項:

1. 引入 tenant-scoped hash 路由 / 動 `/ui/open` handoff / session-id regex / routeCensus 復活加租戶欄位
2. governance API 新增 user/org/project 參數 / 修改 §1 禁改後端檔清單任一檔 / target host 選擇邏輯侵入
   proxy 路徑語意 / `/v1` gateway 無法通過 golden-path 逐位元組對比測試
3. 修改 `data.ts:6` Prov 型別
4. 修改 `deriveIntakeFromKey` 解析語意 / 改 `#minio` 頁既有呈現語意或四釘子任一釘
5. Windows host-native vs Linux K8s 架構分岔立項 / datacenter tier MIG vs GPU-P 硬隔離選型 / 對客戶承諾
   超出 H8 物理能力的 SLA
6. 引入 issue/BCF ACL schema 或 assignee 寫入路徑 / 調和 IX-SS-04 裁定A 與租戶門控 / 跨組織 issue 可見性
7. 落地端 DB 遷 Postgres 或改 schema-per-tenant(牽動禁改後端檔清單)/ 任何使 §8.3 資料庫事實過期的遷移
8. §8 七項(NVIDIA 綠值/字體/light theme/i18n/圓角/#semantic proxy 遷移/token-tier 範疇)任一項定案
9. `docs/plans/` 目錄搬遷或改名
10. 實作任何 `/bcf/3.0` 端點前

### 十個 open questions 裁決摘要

| # | 問題 | 裁決一句話 |
|---|---|---|
| 1 | 路由租戶維度 | 租戶維度在 22 條 hash 之外(token claim 為主、子網域為輔),22 條逐字不動 |
| 2 | §1 凍結面與多租戶並存 | 維持現契約,租戶身分僅經 coordinator 中介層 token claim + optional header 承載 |
| 3 | Prov 是否加 tenant_asbuilt | 不加第 8 值,租戶狀態用正交獨立欄位表達 |
| 4 | MinIO 多租戶隔離 | per-tenant bucket 外層隔離,`deriveIntakeFromKey` 三層語意不變 |
| 5 | GPU session 排隊/配額 | 應用層 session broker(queue/quota/fair-share/429+Retry-After),不承諾 live migration |
| 6 | O7/IX-SS-04 授權面 | 維持現契約,ACL/assignee 全記為待人類簽核 |
| 7 | 資料庫遷移 | 維持現契約(SQLite+MySQL),控制面新 Postgres 與落地端物理分離不算突破 |
| 8 | §8 七項是否隨 SaaS 定案 | 維持 OPEN,本輪明文不定案任一項 |
| 9 | `docs/plans/` 目錄搬遷 | 不搬遷不改名(H7) |
| 10 | BCF 3.0 升級時點 | 維持 2.1 現行,3.0 標 PLANNED,禁宣稱已支援 |

## Verification

以下為可機器驗證清單,PR 提交前逐項自查、CI 上以 `pr-review-agent` 對應 check 佐證:

1. **錨點逐字存在**(`grep -F` 對變更後檔案):
   - `grep -F "docs-plans-README §1" AGENTS.md CLAUDE.md` 命中不變(裁決鏈錨點未被本 PR 觸碰)
   - `grep -F "asbuilt|artifact|demo|p1|p15|p3|p4"` 於 `web-viewer-sample/src/console/data.ts` 命中(七值
     不變,本 PR 不修改此檔,僅作為 grep 佐證)
   - `grep -F "127.0.0.1:8004"` 於改動後的 `docs/plans/*.md` 內至少一處引用埠表時字串一致
   - `grep -F "/api/governance/rule-runs"` 於 `saas-公開API與標準對齊.md` 命中(逐字 wrap 對照表)
   - `grep -F "NOT BUILT·p4"` 於涉及 A4/A6-A10 的新舊段落命中,且**不重述**§4.4 論證(僅引用)
2. **A.1.1 路由列數不變**:改動後 `互動實作規格與標準對齊.md` 的 22 條正典路由清單行數 = 改動前行數
   (`git diff` 該檔應只在檔尾新增 PART D 區塊,A.1.1 表格區塊零 diff)。
3. **凍結後端檔零變更**:`git diff --stat main -- governance-service/ web-viewer-sample/src/console/data.ts
   web-viewer-sample/src/**/governanceProxy.ts` 輸出為空。
4. **dead-link 檢查**:`AGENTS.md` 第 140 行、`CLAUDE.md` 第 65 行對 `docs-plans-README.md` 的引用路徑
   `Test-Path` 為真;`README.md` 第 133-137 行既有六份文件相對連結不變。
5. **兩份審批歷史檔零改動**:`git diff main -- "docs/plans/審批報告-docs-plans-design-system-對齊重建-2026-06-23.md" "docs/plans/審批報告-docs-plans-A1v2-2026-07-02.md"` 輸出為空。
6. **check-pr-body-evidence 填寫指引**:本 PR 變更路徑會命中 `scripts/tests/check-pr-body-evidence.ps1` 的
   `$governancePattern`(`docs/(agents|plans)/`),PR body 須填「AI Coding Governance」七欄:
   `Linked issue` / `Requirement source` / `CODEOWNERS / owner review` / `GitNexus evidence` /
   `gstack evidence` / `Agent workflow changed?` / `Required checks expected`。若本 PR 亦觸碰
   `docs/plans/*prototype.html`,額外命中 `$frontendPattern`,須填「Frontend Verification」七欄:
   `Frontend route` / `Main button(s) tested` / `Fixture used` / `Visible success state` /
   `E2E command` / `Screenshot / trace` / `Known gaps`(prototype 為靜態原型,`Known gaps` 應誠實填寫
   「無 backend 接線,DEMO DATA」等級說明)。
7. **本 formal spec 命中 `missing_openspec` 排除規則**:`scripts/lib/pr-review-agent.ps1` 的
   `Test-PrReviewHasFormalOpenSpecEvidence` 對 `^docs/superpowers/specs/.+\.md$` 回傳真,本檔路徑即
   `docs/superpowers/specs/2026-07-06-plans-saas-replatform-design.md`,符合。
8. **7 個新 saas-* 檔逐檔誠實紀律揭露**(對應 `wf3-final.json` `honesty_rules[7]/[9]/[10]`;`pr-review-agent`
   不覆蓋此三項,由人工 checklist 於 PR review 時對 7 個新 `docs/plans/ai-bim-governance-saas-*.md` 逐檔核對):
   - `honesty_rules[7]`:每檔頭部固定 §0 狀態聲明三行(增補層效力低於 `docs-plans-README §1`;全文除已建成項
     外一律 PLANNED·未建;現況=單站點閉環=tenant zero)。驗收:`grep -c "§0"` 對每個新 saas-* 檔命中且該行
     位於檔案前段(非附錄)。
   - `honesty_rules[9]`:每檔須設「未驗證假設」章,集中列出推論類設計並於正文引用處標
     「(未驗證,見未驗證假設章)」。驗收:`grep -F "未驗證假設"` 對每個新 saas-* 檔至少命中一次(章節標題)。
   - `honesty_rules[10]`:凡段落出現「spectator」且描述共看/不計費,同段落須並提「同租戶顯式驗證」或
     「加入前」等限制句;凡段落出現「離線」且描述自主運作,同段落須並提「僅犧牲雲端可視性」。驗收:
     `grep -B2 -A2 -F "spectator"` 與 `grep -B2 -A2 -F "離線"` 命中處人工核對同段落是否並提對應限制句。

## Out of Scope

- 不實作任何 SaaS code(Edge Connector、session broker、Tenant Registry、`/v1` gateway 等一律 PLANNED)。
- 不動 §8 七項(NVIDIA 綠值/字體/light theme/i18n/圓角/#semantic proxy 遷移/token-tier 範疇)任一項定案。
- 不遷移資料庫(SQLite/MySQL 現況不動)。
- 不動 `web-viewer-sample/src/console/data.ts`。
- 不動 `routeCensus.test.ts` 或任何 CARC 相關程式碼。
- 不啟動 BCF 3.0 實作(僅設計面相容性文字,標 PLANNED)。
- 不修改 `check-pr-body-evidence.ps1`、`pr-review-agent.ps1` 或任何 CI script。
- 不搬遷或改名 `docs/plans/` 目錄或既有 11 檔檔名。
