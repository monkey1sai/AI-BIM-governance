# AI-BIM-governance SaaS 遷移路線與里程碑（SaaS-M1~M8）

## §0 文件狀態聲明與增量原則

**狀態聲明（增補層三行）**

- 本檔為增補層，效力低於 `docs-plans-README` §1 所列全部既有文件；衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項（A1、A2、A3-federation，見對齊矩陣 §4.4）外，一律 **PLANNED·未建**。
- 現況＝單站點閉環＝tenant zero；本平台目前已建成僅單站點單租戶閉環。

**本檔定位**

- 本檔為 **SaaS-M1~M8 詳規的唯一源**：每個 SaaS 里程碑的 scope／DoD／回退以本檔為準。
- `ai-bim-governance-開發軌跡與執行計畫.md` 僅放 SaaS-M 摘要對照表，避免雙權威；摘要與本檔衝突時以本檔為準。
- 雲端控制面服務規格見 `ai-bim-governance-saas-架構總覽.md`；租戶模型／隔離／身分見 `ai-bim-governance-saas-租戶與身分.md`；GPU 物理與計費見 `ai-bim-governance-saas-GPU經濟與計量計費.md`；對外 API 與標準見 `ai-bim-governance-saas-公開API與標準對齊.md`；合規與生命週期見 `ai-bim-governance-saas-合規資料主權與生命週期.md`。本檔只寫里程碑序列，互相引用不重複展開。

**增量原則（無 big-bang）**

- **無 big-bang 遷移**：任何遷移都走 expand-contract（先擴充、後收斂），絕不一次切換單一 Postgres／單一多租戶 DB。
- **每階段純 additive、可回退**：SaaS-M 各階段以純增補元件落地，零反向依賴；每階段獨立寫明回退動作，回退後回到前一階段狀態且零殘留。
- **階段編號接續既有 M0-M8**：本檔 SaaS 里程碑自 **SaaS-M1** 起編，接續既有 M0-M8 里程碑之後，不與既有編號衝突。
- **M0-M4 既有 DoD 語意不動聲明**：既有 M0-M4 的 DoD checkbox 語意，以及 A1 v2／D10 全部內容，一字不動；本檔不重排、不覆寫、不重新詮釋任何既有里程碑；M5+ 排序可依 SaaS 商業優先序重排，但既有 M0-M4 語意凍結。
- **凍結面守門**：凡涉突破 §1 十二條凍結面／22 路由 hash／Prov 型別／§4.4／§8 七項／禁改後端檔／DB 遷移的需求，一律記為「待人類簽核的新決策」，未簽核前不得實作（各階段內標明觸發條件）。

---

## §1 SaaS-M1｜tenant zero 最小增量（第一鏟，現況即可交付）

### 1.1 scope

- 新增 **outbound-only Edge Connector**（純 additive sidecar，PLANNED·SaaS-M1）：activation 一次性 token 註冊／每 5 分鐘心跳（參照值·本平台數值待定）／metadata-only 白名單上報／離線佇列＋冪等 key。
- 新增雲端唯讀 **Tenant & Site Registry**（tenant＝1）、**Connector Ingest Gateway**、**Cross-Site Dashboard**、**Audit & Compliance Ledger 骨架**（收稽核摘要）。
- **零改前端、零改凍結後端檔、零改 22 路由、零改六埠**：現況六服務 byte-identical 保留。
- 上報只承載白名單欄位（計數／狀態／hash／摘要／時戳／版本號）；**IFC/USD payload 不出站**（H6）。

### 1.2 DoD（五條逐字）

1. git diff 顯示 0 個凍結檔變更
2. connector 註冊成功 + 心跳 + 計量事件抵達雲端 dashboard
3. 拔網 E2E 實測落地端轉檔/檢核/GPU 渲染/WebRTC 全自主
4. 網路擷取證明 payload 零出站（只有白名單 metadata）
5. browser E2E evidence（artifacts/e2e/*.png + trace）

> 補充：拔網自主僅犧牲雲端可視性與遠端控制，落地端運算不受影響；上線前須先盤點落地端服務有無隱性雲端硬依賴（Outposts 警示），確認無硬依賴才可宣稱離線自主，SaaS-M1 拔網 E2E 為第一道驗收。

### 1.3 回退

- 停用／移除 Edge Connector sidecar，落地端回純單站點閉環，**零殘留**（純 additive、無反向依賴）。

---

## §2 SaaS-M2｜身分

### 2.1 scope

- org-per-tenant OIDC；每個 access token 強制帶 tenant_id claim。
- operator／viewer 兩級 scope 拆分（先拆治理權／觀看權，不等 3-legged 才補）。
- coordinator **租戶 context 中介層**：集中解析 token tenant_id claim；`X-Tenant-Id` 為 **additive optional** header，缺省走現況單租戶路徑（tenant zero fallback）。
- 企業自帶 IdP 走 Identity Brokering。
- tenant zero＝tenant_id=default 的隱含租戶，中介層逐步注入顯式 claim。

### 2.2 DoD

- SSO 登入可用；token 帶 claim 由中介層集中驗證與範圍過濾。
- tenant zero 向後相容：header 缺省時走現況單租戶路徑。
- **§1 byte-identical 迴歸測試綠**：proxy 路徑字串、enum 逐字 echo、envelope key 全部 byte-identical。
- browser E2E evidence（artifacts/e2e/*.png + trace）。

### 2.3 回退

- tenant_id claim 設為 optional 欄位；缺省 fallback 回單租戶行為，中介層等同透明。

> 待人類簽核觸發條件：凡需在 governance API 加 user/org/project 參數、或改 §1 禁改後端檔清單（app.py／governanceProxy.ts／conversion_authority.py 等）任一，即記為待人類簽核的新決策，未簽核前不得實作。

---

## §3 SaaS-M3｜session broker

### 3.1 scope

- 應用層 session broker：queue／quota／preemption／fair-share／租戶優先權 SLA 分級（複用 NVIDIA 官方兩層設計，詳見 GPU經濟檔 §2）。
- **429 + Retry-After 契約**：把 Kit port 8011 併發搶佔 race（vendor extension TOCTOU、輸家 crash）收斂為正式資源耗盡回應契約，資源滿回結構化 429（含佇列深度與預估等待），不讓輸家 process crash。
- warm pool：driver-loaded 待命池吸收 30-40 秒冷啟（規劃值·非實測）；閒置暖機 GPU 誠實計入 COGS。
- spectator 同租戶驗證 gate：spectator 共看不佔額外 GPU、不另計費，**但加入前必須通過同租戶顯式驗證＋稽核 log**（PLANNED）。
- 租戶狀態硬 gate：deactivate／offboard 立即 terminate 佔用中 Kit。
- per-tenant max-concurrent-sessions（依 tier）。

### 3.2 DoD

- 併發超限回 429 非 crash；配額生效。
- 跨租戶 spectator 被拒並留稽核 log（可驗）。
- warm pool 命中降冷啟（實測換手延遲，數字為規劃值·非實測）。
- browser E2E evidence（artifacts/e2e/*.png + trace，對應 IX-TN-02 / IX-TN-04）。

### 3.3 回退

- broker bypass flag：直落回既有 kit-manager-api 直呼，跳過排程層。

---

## §4 SaaS-M4｜資料隔離

### 4.1 scope

- governance **schema-per-tenant**（expand-contract：先加不動既有欄位、每次只動一張表、雙寫驗證）。
- per-tenant MinIO bucket（container-per-tenant）。
- 檔名鍵演進為 `mw_<tenantId>_<hash16>`（PLANNED·SaaS-M4）。
- deriveIntakeFromKey 三層 key 語意（種類＝倒數第二段／版本＝末段／中文→mv_<hash8>）完全不變，租戶隔離落在 bucket 層。

### 4.2 DoD

- 兩租戶資料互不可見。
- GDPR 原子抹除（DROP SCHEMA／刪 prefix ＋級聯清 ConversionLedger／mapping）可驗。
- deriveIntakeFromKey 三層解析不變。
- **涉 §1 禁改後端檔前先取得人類簽核**（涉禁改檔即待簽核，未簽核不得實作）。
- browser E2E evidence（artifacts/e2e/*.png + trace）。

### 4.3 回退

- 既有 schema 不動；新租戶才進新 schema，逐表 revert。

> 待人類簽核觸發條件：落地端 governance 資料要遷 schema-per-tenant 而牽動禁改後端檔清單（SaaS-M4 啟動前）；任何會使 §8.3 資料庫事實過期的遷移須先在更高效力文件層取得裁決。回填細則見 §10。

---

## §5 SaaS-M5｜計費產品化

### 5.1 scope

- Stripe 三 meter（gpu_session_minute／conversion_job 帶 complexity dimension／api_call）＋冪等去重（冪等 key＝`<tenantId>_<sessionId>_<event_time>`）。
- governance credit 換算（對外單一抽象貨幣，隱藏 GPU 秒數）。
- entitlements 硬 gate（session token 核發前檢查）。
- 封頂＋結轉＋超額加購（非直接阻斷，保 business continuity）。
- rate sheet／token estimator（供專案制採購預估 A1-A10 點數；所有費率為規劃值·非實測）。

### 5.2 DoD

- 三軸計量端到端對帳準確。
- Free／Team／Enterprise 配額生效。
- **先跑 shadow billing（只記帳不扣款）驗證對帳準確度**。
- 落地端斷線期間計量不阻斷運算，恢復後冪等回補、Aggregator 去重防重複計費。

### 5.3 回退

- 計費關閉、僅記帳不執行配額。

---

## §6 SaaS-M6｜公開 API 與標準

### 6.1 scope

- `/v1` gateway 與凍結 `/api` **物理分離**＋byte-identical 轉發；前端 console 不經 gateway，仍直打 :8004（§1 十二條零觸碰）。
- golden-path 逐位元組對比測試（直打 :8004 vs 經 `/v1`）。
- `/v1/versions` 服務發現（比照 Foundation `/foundation/versions`）。
- webhook HMAC（per-tenant secret；correlation key＋scope 比對非廣播；對接 ConversionLedger Phase 2 callback 回填待辦）。
- IDS 1.0 BYO-ruleset 端點（ifctester 包裝，只驗英數不驗幾何）。
- bSDD 只讀字典＋快取。
- BCF 3.0 相容面設計（實作 pending buildingSMART 確認；硬性禁宣稱「已支援 3.0」）。

### 6.2 DoD

- 對比測試綠（直打 :8004 vs 經 `/v1` byte-for-byte）。
- 第三方 BCF client 以 2.1 可串。
- webhook HMAC 驗簽通過。
- 租戶自帶 IDS 生效。

### 6.3 回退

- 關閉 gateway，console 直打 :8004 完全不受任何影響。

> 待人類簽核觸發條件：`/v1` gateway 若無法通過 golden-path 逐位元組對比測試；BCF `/bcf/3.0` 端點實作前須先完成向 buildingSMART 的規格確認並交人類簽核（3.0 授權面依賴 O7 租戶 ACL 簽核，先後順序須明確）。

---

## §7 SaaS-M7｜合規與資料主權

### 7.1 scope

- 租戶隔離 ADR 定稿（書面化哪些服務 pool／silo／stamp、跨租戶防護在哪層）。
- region／stamp pinning。
- SOC 2／ISO 27001／ISO 19650-5 準備（合規敘述多為二手，見 saas-合規檔 §9 待審清單）。
- 生命週期狀態機全量（active→deactivated→retained→purged；offboard terminate 演練）。
- per-tenant DR（Postgres PITR/WAL＋MinIO versioning）演練。
- Audit & Compliance Ledger 產品化（append-only，只讀不可刪改）。

### 7.2 DoD

- ADR 書面化（＝SOC 2 system description／ISO 27001 SoA 一級佐證）。
- 狀態機驅動 offboard 立即 terminate 佔用中 Kit（30-40 秒內，規劃值·非實測）。
- per-tenant 還原邊界實測（「只還原這個租戶」）。
- DR 演練達 tier 承諾（Free RPO 小時級／付費 PITR 5 分鐘級／企業獨立 pool，全部規劃值·非實測）。

### 7.3 回退

- 維持現況單站點資料留存。

---

## §8 SaaS-M8｜選項：全雲託管 tier（H6 例外）

### 8.1 scope

- 客戶明確 **opt-in**，payload 進雲＝H6 例外（文件與銷售須標「SaaS-M8 選項·客戶明確 opt-in·H6 例外」）。
- datacenter Linux GPU node（L4／L40S；datacenter 授權 GPU，非 GeForce 消費卡）。
- MIG（Ampere+，Linux）／Windows Server 2025 Hyper-V GPU-P（SR-IOV）硬隔離 POC；絕不用 time-slicing 隔離付費租戶。
- 顯式同意流程與資料落地合約。

### 8.2 DoD

- **無 GeForce 卡**（EULA 合規：GeForce 消費卡僅存在於客戶自有落地端）。
- 硬隔離 POC 通過（MIG 對 Kit 顯存 profile 須先 POC，見未驗證假設章）。
- 顯式同意流程留痕。

### 8.3 回退

- 停售全雲 tier，客戶回落地端模式；雲地混合主線不受影響。

> 待人類簽核觸發條件：Windows host-native vs Linux K8s 架構分岔立項（先於一切 GPU 擴縮設計）；datacenter tier 的 MIG vs GPU-P 硬隔離選型；GeForce EULA「自有 on-prem 對外多租戶付費」灰色地帶＝GTM 前法務 go/no-go。

---

## §9 跨階段紀律

- **開發流程**：預設採 repo-native lean mode；Superpowers `writing-plans`、`subagent-driven-development`、`verification-before-completion` 僅在使用者明確啟用時使用，且不得自動串接。詳見 `docs/agents/superpowers-invocation-policy.md`。
- **不在 main 開發**：走 branch → PR → Actions → merge。
- **GitNexus**：改任何 code symbol 前 MUST 跑 `impact`（前掃），commit 前 MUST 跑 `detect_changes`（後驗）；HIGH／CRITICAL risk 先回報。
- **每階段 browser E2E evidence**：gstack／Playwright，落 `artifacts/e2e/*.png` ＋ trace；backend-only done 不接受。
- **DoD 硬化五條件適用每個 SaaS 增量**：
  1. route 可達（user-facing feature 可從前端 route 操作）；
  2. 後端真接線非 mock（真接線／provenance 成立）；
  3. provenance 成立（Prov 只用既有 7 值 asbuilt|artifact|demo|p1|p15|p3|p4）；
  4. browser E2E evidence（截圖 + trace）；
  5. 0 blocker。

---

## §10 tenant zero → 多租戶回填策略細則

expand-contract 為本輪自建過渡方案（單租戶轉多租戶零停機回填 tenant_id 官方查無一手指引，AWS/Azure 皆預設新建多租戶；標自建方案，見未驗證假設章）。

**兩段式路徑**

1. **先 bridge（schema-per-tenant，不動既有欄位）**：新租戶進獨立 schema；既有 tenant zero schema 完全不動 → 驗證兩租戶互不可見 → 通過才續。
2. **要收斂 pooled 才逐表 tenant_id 化**：確需收斂到 pooled 共享時，才對既有表逐張加 tenant_id 欄位 → 先加欄位＋雙寫（新舊路徑並行寫）→ 驗證雙寫一致 → 收斂讀路徑 → 下一張表。

**鐵律**

- **每次只動一張表**：一次遷移一張表，附雙寫驗證清單與級聯清單（ConversionLedger／mapping 索引不漏，對應 D-37）。
- **先加不動、後收斂**：任何欄位先加不刪、先雙寫後切換；每步可獨立 revert。
- **凍結面守門**：涉禁改後端檔（app.py／conversion_authority.py 等）或使 §8.3 資料庫事實過期，先取得人類簽核（見 §4）。

---

## §11 未驗證假設

> 本章集中列出推論類設計；正文引用時以「（未驗證，見未驗證假設章）」標註。不得把 memory／研究摘要包裝成 runtime-verified fact。

- **GPU-bound SaaS 無官方多租戶指引**：GPU-session-minute 計量、GPU 視為 bridge silo 單元、租戶狀態 gate terminate Kit，皆由 AWS/Azure 通用 SaaS 原則類比推論，未經 NVIDIA Omniverse 多租戶白皮書或 GPU/HPC SaaS 一手案例交叉驗證。
- **Windows host-native vs Linux K8s 架構分岔**：官方無「雲端控制面＋落地端 GPU worker 跨站拆分」參考架構；主線選「落地端維持 Windows host-native 自建排程層」＝放棄官方 K8s 路徑的重大自建投資（待人類簽核，先於一切 GPU 擴縮設計）。
- **零停機回填 tenant_id 為自建方案**：expand-contract＋bridge 過渡無官方一手指引，SaaS-M4 前須充分 POC；pooled 收斂路徑與落地端 SQLite 單例現況存在連動未定（見 open question #7 待簽核）。
- **MIG 對 Kit 渲染 profile 未知**：datacenter tier 硬隔離能否滿足 Kit（吃顯存兇）需 POC；POC 未過前 tenant-per-stamp 以下的共享 datacenter GPU 隔離設計不成立。
- **spectator／多人共看官方機制未證實**：現有 6 endpoint（primary 49100 ＋ spectator 49110~49150）、KIT_SPECTATOR_COUNT 可能為專案自建非官方 multi-viewer API；多租戶並發能否長期靠 spectator 模型滿足須查 omni.kit.livestream 系列確認。
- **離線寬限期參照值**：Arc 14 天／GDC 7 天為他家產品值（參照值，本平台窗口待合規拍板）；逾期憑證／金鑰刷新行為、離線租戶佔 GPU 處置均未定義；落地端隱性雲端硬依賴未盤點前不得宣稱離線自主。
- **定價／COGS 數字全為二手聚合**：正式定價前須以 AWS/Azure Pricing Calculator 與 APS 官方頁一手核對；文件全程標「規劃值·非實測」規避誤導，商業計畫不可據此定價。
