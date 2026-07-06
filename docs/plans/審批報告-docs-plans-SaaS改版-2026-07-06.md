# 審批報告 — docs/plans SaaS 改版（雲地混合多租戶重定位）

> 日期：2026-07-06 · 依據：使用者最新明確指令（效力順序第一行）
> 範圍：docs/plans 全面 SaaS 重定位（11 既有檔增補/改寫 + 7 新檔 + 1 份 formal spec）
> 本報告為**現行最高審批紀錄**，承接《審批報告-docs-plans-A1v2-2026-07-02》與《審批報告-docs-plans-design-system-對齊重建-2026-06-23》；兩份歷史檔 **byte-identical 不動**，取代鏈僅由本報告 §1 聲明，不回頭改歷史檔。

---

## §1 本輪指令與裁決

### 1.1 指令來源與範圍

| # | 使用者指令（重定位） | 設計裁決 |
|---|---|---|
| 1 | 把 AI-BIM-governance 由「單站點單租戶已建成閉環」重定位為 **SaaS 平台** | 主線＝**雲端控制面 + 落地端 data/GPU plane 的雲地混合多租戶 SaaS**；SaaS≠全上雲；全雲託管 tier 僅 SaaS-M8 選項（客戶明確 opt-in，H6 例外）。現況站點＝**tenant zero**（第一個租戶，非過渡物） |
| 2 | 落地端能力如何定位 | 落地端六服務（Kit GPU 渲染／IFC→USD 轉檔／governance 檢核／本地 storage·MinIO／WebRTC 串流）為**一級產品元件持續演進、永不規劃淘汰**（H2） |
| 3 | 文件層如何落地 | docs/plans **不搬遷不改名**（H7）；新增全部標 PLANNED；11 既有檔僅在指定位置增補/改寫，凍結面零觸碰 |

### 1.2 效力序不變聲明

- **docs-plans-README §1 效力鏈零修改**：效力順序全文（含「效力不看版本號大小」）逐字不動。
- 新增全部 `saas-*` 檔與本審批報告一律為**增補層**，效力**低於** README §1 所列全部既有文件；衝突一律以**既有凍結契約**與**對齊矩陣 §4.4** 裁決為準。
- 本輪**零 code 變更、零凍結後端檔變更、data.ts 不動、22 路由不動、Prov 7 值不動**。

### 1.3 承接鏈

- 承接《**審批報告-docs-plans-A1v2-2026-07-02.md**》：其 §1 指令裁決（A1 雙來源選檔／BCF 審查面板／A1 連動橋）、§3 五條誠實紅線、§5 待決三項全部**延續**（見本報告 §2·§3·§5）。
- 承接《**審批報告-docs-plans-design-system-對齊重建-2026-06-23.md**》：其**四釘子誠實框架**延續（釘子 a MinIO 偵測已實作／釘子 b 轉檔紀錄待建／釘子 c `#minio` 結構顯示頁待建僅 local_fs 兩層樹／釘子 d 觸發點僅新增 IFC watcher 觸發）。
- 兩份歷史檔 **byte-identical 不動**；「無任一檔回頭把待建標成已交付」的地基原則延續至本輪全部 SaaS 增補。

---

## §2 A1-A10 逐值對齊延續（狀態零變動）

**裁決唯一源＝對齊矩陣 §4.4＝data.ts（程式碼覆寫文件）。SaaS 語境只加脈絡敘事，不改任一狀態、prov 值或裁決引用。**

| A 卡 | 狀態（不變） | SaaS 脈絡（只加不改裁決） |
|---|---|---|
| A1 | **built**（v2 新增面前端待實作） | 租戶 BYO-IDS 檢核入口；rule-run 為 CPU 軸不吃 GPU |
| A2 | **built** | 租戶內 changeset 一等公民（官方 ifcdiff）；A2 頁禁出現成本影響塊 |
| A3 | federation **built** / clash **NOT BUILT·blocked-on-OCC** | 跨專業疊合協作視圖；clash 在 `has_occ=False` 期間禁顯示任何真實 clash 數字 |
| A4 | **NOT BUILT·p4** | 以多租戶協作 persona 重寫願景敘事，維持 NOT BUILT + dashed panel |
| A5 | **NOT BUILT·p3** | 同上；TimescaleDB 未建 |
| A6-A10 | **NOT BUILT·p4** | 願景敘事可改文字，狀態標記/prov 值/裁決引用三者不動 |

- Prov 恰 **7 值**（`asbuilt|artifact|demo|p1|p15|p3|p4`）不擴；租戶級狀態以正交獨立欄位（`tenantId`/`scope`）表達，不進 prov 型別。
- NOT BUILT 呈現：一律「NOT BUILT·p3/p4，裁決見對齊矩陣 §4.4」，不重述論證、不自行展開狀態理由。

---

## §3 五條誠實紅線 SaaS 延續

**逐條延續 A1v2 報告 §3 紅線（原文逐字），並補本輪 SaaS 對應：**

1. **雙來源皆為真接線**（兩條 API 皆在 repo），但 **A1 頁的接線本身待實作**——矩陣 A1 列已標「v2 新增面：前端待實作，不得先標已交付」。→ SaaS 對應：全部 SaaS 能力標 **PLANNED·未建**；禁「已支援／已交付／即將完成／開箱即用」描述任何未建能力。
2. **指派 assignee**：issues schema 無此欄（O7 未決）→ UI 一律 dashed 待建標，禁下拉假控制（D-32）。→ SaaS 對應：issue/BCF ACL、assignee 授權模型全屬**待人類簽核的新決策**（§5）。
3. **連動橋**：證據單一來源＝`#sessions`／Runtime；未齊＝disabled＋原因可讀；成功只認 viewer ack（D-33）；不畫假綠燈。→ SaaS 對應：站點連線徽章（connected/offline-grace/expired）後端驅動，offline 標「本地自主運作中」不偽綠也不偽紅。
4. **選檔不觸發轉檔**：只跑 rule-run（CPU）；自動轉檔仍僅 watcher（opt-in 預設關）。→ SaaS 對應：計量綁「觸發稀缺資源的動作」非「看」；spectator 共看不計費但加入前須同租戶顯式驗證＋稽核 log（PLANNED）。
5. 270/889/990/271 與 MinIO 資料夾內容皆**測試資料**，UI 必標。→ SaaS 對應：所有定價/容量/費率/SLO/寬限期數字一律標「（規劃值·非實測）」；引用他家產品參數（Arc 5min 心跳/15min 判離線/14 天快取、GDC 7 天 survivability）標「參照值，本平台數值待定」。

**metadata-only 紀律（H6）**：描述雲端能看到什麼時只列白名單欄位（計數/狀態/hash/摘要/時戳/版本號）；凡提及上報/投影/dashboard 必同句聲明「IFC/USD payload 不出站」。

---

## §4 22 路由／六埠／七值一致性結論延續

**逐項聲明不變；租戶維度一律加在 hash／埠／prov 之外的更外層。**

| 面向 | 結論（延續，不變） | 租戶維度落點 |
|---|---|---|
| 22 條正典路由 hash | 逐字不動（hash 無斜線／#gpu 正典／#review 別名禁重定向／#admin 佔位／保留別名清單保留） | token `tenant_id` claim 為主、子網域為輔；path 前綴 `/t/:tenantId` 僅選配。引入 tenant-scoped hash＝待簽核 |
| `/ui/open?session=:id` handoff | byte-for-byte 凍結不動（session-id regex 不改） | 動 handoff 或 session-id regex＝待簽核 |
| 六服務埠表 | 逐字不動（coordinator `127.0.0.1:8004`／governance `:49102`／信令 `49100`／串流 `47998`／轉檔 `49101`／spectator `49110~49150`／kit-manager `:8010`／viewer `:5173`／MCP `9901-9903`） | 租戶隔離走 token/bucket/broker 外層，不改埠語意 |
| Prov 7 值 | `asbuilt\|artifact\|demo\|p1\|p15\|p3\|p4` 不擴 | 租戶狀態走正交欄位；第 8 值＝待簽核（TS2322） |
| MinIO 三層 key | `deriveIntakeFromKey`（種類=倒數第二段／版本=末段／中文→`mv_<hash8>`）語意不變；四釘子保持 | per-tenant bucket 外層隔離；改解析語意＝待簽核 |

---

## §5 10 個 open questions 終局裁決

| # | question | ruling（摘要） | rationale（摘要） |
|---|---|---|---|
| 1 | 多租戶路由策略（tenant-scoped hash？） | 租戶維度加在 22 條 hash 之外更外層（token claim 為主、子網域為輔）；22 條 hash 逐字不動；可直接落文件 | H4 增補不覆寫；tenant scope 屬 gateway/token 層，與前端路由表正交；四提案一致 |
| 2 | §1 單租戶 host 假設如何與多租戶並存？ | 維持現契約，§1 全 12 條凍結；只允許 token claim 中介層解析 + `X-Tenant-Id` additive optional header（缺省 fallback tenant zero）；突破面記待簽核 | §1 是最高後端契約，H4 禁覆寫；中介層+optional header 零改凍結面即可承載租戶身分 |
| 3 | 多租戶 provenance（tenant_asbuilt？） | 不新增第 8 個 prov 值；租戶狀態走正交欄位；改 data.ts:6 型別須獨立提案交人類拍板 | H3/H4 硬約束 + D-28 實證（prov=todo TS2322）；provenance 與租戶歸屬正交 |
| 4 | MinIO 多租戶隔離（改 deriveIntakeFromKey？） | per-tenant bucket 外層隔離，三層 key 語意完全不變；`mw_<tenantId>_<hash16>`（SaaS-M4）；標 PLANNED 禁寫「已支援多租戶」 | H4/H5；bucket 是最外層隔離鍵不侵入 watcher 解析；對齊 Azure Blob 三層路線 |
| 5 | GPU 資源模型（無 live migration 下排隊/配額？） | session broker 應用層 queue+preemption+fair-share；配額單位=併發 session 數；429+Retry-After；不承諾熱遷移/hot-swap/fractional GPU；time-slicing 永不作隔離 | H8 NVIDIA 官方兩次核實的物理死線；spectator 架構已建，SaaS 只加租戶 gate |
| 6 | O7 assignee 與多租戶授權（ACL/IX-SS-04？） | 維持現契約 + 全部記待簽核；assignee 維持 O7·P1 dashed（D-32）；IX-SS-04 裁定A 逐字保留；租戶門控走 token claim 非 IP allowlist | 涉凍結裁定+既有待決+auth，Shared Core「高風險 auth 須人類確認」 |
| 7 | 資料庫方案（遷單一 Postgres？） | 維持現契約，§8.3 事實（host-native SQLite + 雲端 MySQL）不過期；控制面新增自有 Postgres（全新雲端元件物理分離）；落地端遷移＝待簽核且屬更高效力文件管轄；不做 big-bang，走 expand-contract | 「程式碼覆寫文件」既定事實；落地端 DB 遷移牽動禁改後端檔＝高風險 |
| 8 | §8 七項是否隨 SaaS 一併定案？ | **維持 OPEN**，本輪明文不定案任何一項；SaaS 品牌演進僅以 candidate 提案寫入設計規格，拍板仍走 §8 守門 | 保存契約明警此為最易悄悄拍板繞過守門處；三評審一致點名 |
| 9 | docs/plans 目錄搬遷/改名？ | **不搬遷不改名**（H7）；11 既有檔檔名逐字保留；搬遷本身＝待簽核（連動兩 regex + dead-link 硬檢 + CODEOWNERS/ISSUE_TEMPLATE） | H7 明令 + CI 治理耦合；搬遷零收益高風險 |
| 10 | BCF 3.0 升級時點？ | 維持現契約，2.1 現行、3.0 列 PLANNED 優先目標；硬性禁宣稱「已支援 3.0」；實作前須向 buildingSMART 確認；3.0 授權面依賴 O7 簽核 | 官方對齊鐵律 + H5；3.0 per-entity authorization 與租戶 ACL 耦合 |

### 5.x 待人類簽核的新決策清單（未簽核前不得實作）

凡涉突破凍結面者，一律登錄為待簽核，禁在文件改寫或實作中偷渡：

1. **§1 突破四條件**：(a) governance API 需新增 user/org/project 參數；(b) 需改 §1 禁改後端檔（`app.py`/`governanceProxy.ts`/`conversion_authority.py` 等）；(c) target host 選擇邏輯侵入 proxy 路徑語意；(d) `/v1` gateway 若無法通過 golden-path 逐位元組對比測試。
2. **tenant-scoped hash**：任何引入 tenant-scoped hash／動 `/ui/open` handoff 或 session-id regex／routeCensus 復活加租戶欄位的需求。
3. **data.ts:6 型別變更**（牽動 a1Machine.ts 等全部消費者）。
4. **Keycloak 選型立項**：realm-per-tenant vs Organizations（社群效能牆數字 600+ 非官方須實測）。
5. **Windows host-native vs Linux K8s 架構分岔**：先於一切 GPU 擴縮設計，主線＝落地端維持 Windows host-native 自建排程層。
6. **datacenter tier MIG vs GPU-P 硬隔離選型**。
7. **O7 ACL 三條件**：(a) 引入 issue/BCF ACL schema 或 assignee 寫入路徑；(b) 調和 IX-SS-04 裁定A 與租戶門控；(c) 跨組織/跨專案 issue 可見性規則定義。
8. **DB 遷移三條件**：(a) 落地端 governance 遷 Postgres 或改 schema-per-tenant 而牽動禁改檔（SaaS-M4 前）；(b) 任何使 §8.3 過期的遷移（屬更高效力文件裁決）；(c) 不做 single-Postgres big-bang，任何遷移走 expand-contract 每次一張表。
9. **§8 七項逐項**：NVIDIA 綠值/字體/light theme/i18n/圓角/#semantic proxy 遷移/token-tier 範疇；任一定案須逐項顯式簽核，附「SaaS 品牌壓力不構成定案理由」聲明。
10. **docs/plans 搬遷**：須同 PR 原子同步兩 regex + AGENTS/CLAUDE/README 文件地圖 + CODEOWNERS + ISSUE_TEMPLATE + test-agent-governance-check.ps1。
11. **BCF 3.0 三條件**：(a) 實作任何 `/bcf/3.0` 端點前須完成 buildingSMART 規格確認並交簽核；(b) 銷售合約承諾 3.0 時程；(c) per-entity authorization 依賴 O7 簽核順序。

---

## §6 CI 治理耦合影響

- **docs/plans 目錄不搬**（見 §5 open question #9）：避開兩 regex（`$governancePattern`/`$frontendPattern`）+ dead-link 硬檢 + CODEOWNERS/ISSUE_TEMPLATE 連動失效。
- **本輪全部變更觸發** `check-pr-body-evidence.ps1` 的 **7 欄 AI Coding Governance 表**（PR body 逐欄誠實填，禁 `-`/`tbd`/`n-a`）。
- **兩份 prototype.html 變更額外觸發 7 欄 Frontend Verification 表**，逐字 label 誠實填：`Frontend route` / `Main button(s) tested` / `Fixture used` / `Visible success state` / `E2E command` / `Screenshot / trace` / `Known gaps`（`Screenshot / trace` 為單一欄位不拆分）。
- **formal spec** `docs/superpowers/specs/2026-07-06-plans-saas-replatform-design.md` 滿足 `missing_openspec`（docs/plans 大改需 specs 目錄 formal spec 佐證），必須與改寫同 PR。
- `pr-review-agent` **無 paths-ignore（PR#232）**：docs-only PR 亦跑完整檢查。PR body 修改需 push empty commit 重跑。

---

## §7 文件組變更清單

### 7.1 11 既有檔動法摘要（must_preserve 驗證法＝grep 錨點逐字存在）

| 檔 | action | 增補範圍 | 錨點驗證 |
|---|---|---|---|
| docs-plans-README.md | minimal-touch | 角色清單追加 8 列 + 檔尾「SaaS 增補層導讀」段 | grep「docs-plans-README §1」效力序全文 |
| 互動實作規格與標準對齊.md | minimal-touch | 檔尾 PART D：IX-TN-01~04（全 PLANNED） | grep A.1.1 22 條計數不變 |
| 開發軌跡與執行計畫.md | section-rewrite | PART 1 定位敘事 + M5+ SaaS-M 對照表 | grep A1 v2/D10、2.0.5 技術棧、SQLite/MySQL 更正段 |
| 設計規格.md | section-rewrite | §1-§2 SaaS 品牌 candidate 小節 | grep §1.5 Prov 映射、edge-console.css `--ec-*` |
| design-system-對齊矩陣.md | minimal-touch | 檔尾附錄（不在 §4.4 旁加欄） | grep §4.4 A1-A10 裁決表逐字 |
| 前端對齊DS-保留後端-實作手冊.md | section-rewrite | §5 行號核對 + 檔尾 §9 增補 | grep §1 十二條、`/ui/open` regex |
| 實作紀律與技術債防線.md | minimal-touch | §3 尾追加 D-34~D-37 | grep D-01~D-33、§7 唯一源聲明 |
| ai-bim-governance-prototype.html | 外科增補 | tenant 徽章/雲端控制面 PLANNED 標/導讀卡/連線徽章 | grep 22 路由 PAGES 頁數不變 |
| ai-bim-geo-viewer-prototype.html | 外科增補 | header 徽章 + A6-A10 願景改寫 + 雲地標註 | grep 七區塊 IA、clash NOT BUILT |
| 審批報告-docs-plans-A1v2-2026-07-02.md | keep-as-is | 零改動 | git diff 為空 |
| 審批報告-docs-plans-design-system-對齊重建-2026-06-23.md | keep-as-is | 零改動 | git diff 為空 |

### 7.2 7 新檔 + 1 spec

- `ai-bim-governance-saas-架構總覽.md`（雲地混合總綱）
- `ai-bim-governance-saas-租戶與身分.md`（租戶模型/Bridge 隔離/身分）
- `ai-bim-governance-saas-GPU經濟與計量計費.md`（session broker/三軸計量/方案分層，旗艦檔）
- `ai-bim-governance-saas-公開API與標準對齊.md`（/v1 物理分離/webhook/BCF/IDS/bSDD）
- `ai-bim-governance-saas-合規資料主權與生命週期.md`（ADR/資料主權三層/DR/GDPR）
- `ai-bim-governance-saas-遷移路線與里程碑.md`（SaaS-M1~M8 唯一詳規源）
- `審批報告-docs-plans-SaaS改版-2026-07-06.md`（本檔，現行最高審批）
- `docs/superpowers/specs/2026-07-06-plans-saas-replatform-design.md`（formal spec，CI 佐證）

### 7.3 驗證清單（機器可驗）

- §1 效力序 grep（README §1「效力不看版本號大小」逐字存在）
- A.1.1 **22 條列數不變**計數
- §4.4 逐值 grep（A1 built/A3 clash NOT BUILT/A4-A10 p3·p4）
- prov 7 值 grep（`asbuilt|artifact|demo|p1|p15|p3|p4`）
- 六埠 grep（`127.0.0.1:8004`、`49102`、`49110~49150` 等）
- 凍結路徑 grep（`/api/governance/rule-runs` 等 §1 十二條）
- 兩份審批歷史檔 git diff 為空

---

## §8 風險與未驗證假設彙總

1. **GPU-bound SaaS 無官方專屬多租戶指引**：GPU-session-minute 計量、GPU 視為 bridge silo 單元、租戶狀態 gate terminate Kit 皆由 AWS/Azure 通用 SaaS 原則類比推論，未經 NVIDIA Omniverse 多租戶白皮書一手交叉驗證——寫進各檔「未驗證假設」章，落地前須補查。
2. **Windows host-native vs Linux K8s 最大架構分岔**：官方無「雲端控制面+落地端 GPU worker 跨站拆分」參考架構；主線選「落地端維持 Windows host-native 自建排程層」＝放棄官方 K8s 路徑的重大自建投資；此決策標待人類簽核且先於一切 GPU 擴縮設計。
3. **GeForce EULA『No Datacenter Deployment』法律灰色地帶**：是否適用「公司自有 on-prem 硬體對外提供多租戶付費服務」條文未界定，須法務審查而非工程判斷；此為 GTM 前 go/no-go。
4. **定價/COGS 數字全為二手聚合**（AWS G6 `$0.80-1.02/GPU-hr`、Azure H100、APS token 皆非一手）：正式定價前須 AWS/Azure Pricing Calculator 與 APS 官方頁人工核對；Kit App Streaming 每 session 實吃 GPU-hr 無官方 sizing guide 須實測——文件全程標「規劃值·非實測」，但商業計畫不可據此定價。
5. **MIG 對 Kit 渲染的最低 profile/驅動需求無官方建議**：datacenter tier 硬隔離能否滿足 Kit 需 POC；POC 未過前 tenant-per-stamp 以下的共享 datacenter GPU 隔離設計不成立。
6. **凍結契約侵蝕風險（執行期）**：多租戶想像最易在 §1 target host、tenant-scoped hash、第 8 個 prov 值、O7 assignee、IX-SS-04 處悄悄鬆動——本裁決全數擋在「待人類簽核」閘門並登錄 D-34~D-37；下游 writer 執行與未來實作期仍需 GitNexus impact + golden-path 對比測試 + CI gate 把關。
7. **CI 治理耦合**：本輪全部變更觸發 7 欄 AI Coding Governance 表；兩份 prototype.html 額外觸發 7 欄 Frontend Verification 表（逐字 label，缺=exit 1）；formal spec 為 missing_openspec 佐證必須同 PR；PR body 修改需 push empty commit 重跑。
8. **metadata-only 白名單間接洩漏風險**：conversion ledger 摘要、rule-run 統計、稽核 log 中的檔名/GUID/專案字串可能間接洩漏模型內容，使 H6 承諾與 ISO 19650-5 need-to-know 打折；須白名單 schema + 網路擷取抽驗 + 去識別選項評估（D-35）。
9. **合規一手核實缺口**：ISO 19650-5 官方全文 403、BIM IP（CIC Protocol/ConsensusDocs 301）為二手行業文章、SOC2/ISO27001 對 WebRTC GPU 串流非典型負載無專門稽核指引、GDPR 備份抹除 SLA 無法規硬數字、台灣個資法/中國資料出境未涵蓋——已列 saas-合規檔 §9 待審清單。
10. **單租戶轉多租戶零停機回填 tenant_id 官方查無一手指引**：expand-contract+bridge 過渡為自建方案，每次只動一張表+雙寫驗證，SaaS-M4 前須充分 POC；pooled 收斂路徑與落地端 SQLite 單例現況存在連動未定（見 open question #7）。
11. **spectator/多人共看官方機制未證實**：現有 6 endpoint（primary 49100 + spectator 49110~49150）、`KIT_SPECTATOR_COUNT` 可能是專案自建非官方 multi-viewer API；多租戶並發能否長期靠 spectator 模型滿足須查 omni.kit.livestream 確認。
12. **離線寬限期與斷線行為的參照值風險**：Arc 14 天/GDC 7 天為他家產品值，本平台窗口、逾期憑證/金鑰刷新、離線租戶佔 GPU 處置均未定義，由合規/法務拍板；落地端隱性雲端硬依賴未盤點前不得宣稱離線自主（Outposts 警示），SaaS-M1 拔網 E2E 為第一道驗收。
13. **文件執行風險**：兩份 prototype 若誤新增第 23 頁會 desync data.ts 22 路由（brief 已明令禁止）；新 saas-* 檔若被誤讀為權威會發生效力序漂移（以 §0 狀態聲明 + README 導讀 + 本審批報告三重宣告緩解）；對齊矩陣採檔尾附錄而非 §4.4 旁加欄。
14. **§8 七項待決在 SaaS 品牌重塑壓力下最易被悄悄拍板繞過守門**：本輪明文維持 OPEN 並寫進本報告與設計規格 candidate 段；任何定案須逐項顯式簽核。
15. **/v1 gateway byte-identical 轉發引入新的 §1 靜默破壞面**（re-serialize/enum 大小寫）：以 golden-path 逐位元組對比測試（直打 `:8004` vs 經 `/v1`）+ D-34 防線 + 「前端 console 永不經 gateway」三重緩解；gateway 屬 SaaS-M6，失敗回退＝關閉 gateway 零影響 console。

---

> 本報告承接而不修改兩份歷史審批報告；A1-A10 逐值狀態與 §4.4 唯一源、五條誠實紅線內容自 A1v2 報告逐字延續。未簽核的新決策（§5.x）在取得人類簽核前一律不得實作。
