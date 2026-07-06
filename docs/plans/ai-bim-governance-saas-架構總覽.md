# AI-BIM-governance SaaS 架構總覽（雲地混合多租戶）

## §0 文件狀態聲明

**狀態聲明（增補層三行）**

- 本檔為增補層，效力低於 `docs-plans-README` §1 所列全部既有文件；衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項（A1、A2、A3-federation，見對齊矩陣 §4.4）外，一律 **PLANNED·未建**。
- 現況＝單站點閉環＝tenant zero；本平台目前已建成僅單站點單租戶閉環。

**本檔定位**

- 本檔為 SaaS 架構總綱：雲端控制面、落地端 edge plane、雲地通訊契約、metadata-only 邊界、斷線 survivability 的統一入口。
- 分工邊界（互相引用、不重複展開）：租戶模型／隔離／身分見 `ai-bim-governance-saas-租戶與身分.md`；GPU 物理與計量計費見 `ai-bim-governance-saas-GPU經濟與計量計費.md`；對外 API 與標準見 `ai-bim-governance-saas-公開API與標準對齊.md`；合規／生命週期／DR 見 `ai-bim-governance-saas-合規資料主權與生命週期.md`；里程碑 scope／DoD／回退見 `ai-bim-governance-saas-遷移路線與里程碑.md`。
- 本檔只寫架構總綱與服務落章，不展開租戶隔離策略、計費表、合規條款細節。

---

## §1 雲地混合定位與 H1-H8 硬約束

### 1.1 產品重定位（一句話）

AI-BIM-governance 由「單站點單租戶已建成閉環」重定位為「**雲端控制面 + 落地端 data/GPU plane**」的雲地混合多租戶 SaaS。**SaaS≠全上雲**：雲端只做租戶/站點目錄、身分、計量計費、規則版本分發、跨站聚合 dashboard 與稽核帳本；客戶站點（落地端）保有 Kit GPU 渲染、IFC→USD 轉檔、governance 檢核、本地 storage/MinIO、WebRTC 串流。現況站點即 **tenant zero**，是第一個租戶而非過渡物。

四家官方雲地混合模式（Azure Arc / AWS Outposts / Google Distributed Cloud / NVIDIA Fleet Command）一致結論：**斷線時 data plane 自主續跑，只犧牲雲端可視性與遠端控制**，本平台主線設計即據此。

### 1.2 H1-H8 硬約束逐條（改寫不得違反）

| 代號 | 硬約束原文語意 |
| --- | --- |
| **H1** | 雲地混合為主線；**SaaS≠全上雲**。雲端＝控制面（目錄/身分/計量/規則分發/聚合/稽核），落地端＝data/GPU plane；全雲託管僅為 SaaS-M8 後期選項（客戶明確 opt-in，H6 例外）。 |
| **H2** | 落地端六服務為**一級產品元件**，持續演進、永不規劃淘汰；不得把落地端視為過渡或被雲端取代的暫存物。 |
| **H3** | A1-A10 規格狀態**一律不變**；建成裁決唯一源＝對齊矩陣 §4.4＝data.ts（程式碼覆寫文件），任何文件不得自行升降狀態、不得以 SaaS 願景暗示已建。 |
| **H4** | **增補不覆寫**：租戶維度一律新增而非覆寫既有契約/路由/型別；22 條正典 hash、Prov 7 值、§1 十二條凍結面逐字不動。 |
| **H5** | **誠實地基**：所有 SaaS 能力標 PLANNED/NOT BUILT；現況已建成僅單站點閉環；定價/容量/SLO/寬限期數字一律標「規劃值·非實測」，參照他家產品值標「參照值，本平台數值待定」。 |
| **H6** | **metadata-only 邊界**：IFC/USD payload 不出站，雲端只收白名單 metadata；全雲託管 tier 為 SaaS-M8 選項·客戶明確 opt-in·H6 例外。 |
| **H7** | docs/plans **目錄不搬遷、不改名**；既有 11 檔檔名逐字保留（含全形 CJK），新檔沿用 `ai-bim-governance-saas-*` 慣例放同目錄。 |
| **H8** | **GPU 物理與法務死線**：1 GPU＝1 Kit＝1 stream、無 live migration、換模型/GPU＝terminate+recreate；GeForce EULA 明文禁 datacenter deployment（消費卡只存在落地端）；銷售與文件不承諾熱遷移/hot-swap/一 session 多 stream/fractional GPU。 |

---

## §2 三層 control plane（global / stamp / tenant）

雲端控制面採 AWS Fault Isolation Boundaries 白皮書定義的 **control plane**：提供 **CRUDL**（Create/Read/Update/Delete/List）管理 API＋編排＋目錄＋計量＋telemetry 聚合，**刻意做得比 data plane 簡單**、失效機率統計上更低、blast radius 小；與 data plane 用獨立資源隔離（bulkhead）。

依 Azure「Considerations for Multitenant Control Planes」拆三層：

| 層 | 職責 | 對應本平台 |
| --- | --- | --- |
| **global control plane** | 跨 stamp 決定 tenant 落點與生命週期 | 雲端 global 層只認「tenant→站點清單」與租戶生命週期狀態機，不介入 stamp 內部。 |
| **stamp control plane** | 單一部署單元內管 tenant 資源供給 | **每客戶站點＝一個 stamp**；stamp 內的 GPU 排程、session broker、本地 storage 全由落地端自管。 |
| **tenant control plane** | 租戶自助設定 | 租戶層設定（entitlements 檢視、規則包選擇等，PLANNED）。 |

全程**不對落地端開任何 inbound port**；控制面與 data plane 資源隔離（獨立 DB/App Server/resource group）以防 noisy-neighbor 並縮小高權限系統攻擊面。

> 引用來源：AWS Fault Isolation Boundaries（control-planes-and-data-planes 白皮書）；Azure Architecture Center — Considerations for Multitenant Control Planes。

---

## §3 雲端控制面服務清單（8 服務·全部 PLANNED·未建）

控制面自有**全新雲端 Postgres**（新元件），不觸碰落地端 SQLite（`governance.db`）與雲端 MySQL（`bim-control`）既有事實。API 面為示意，實作前須經 §8 相關簽核觸發條件檢核。

| # | 服務 | 職責 | API 面（示意） | 資料歸屬 |
| --- | --- | --- | --- | --- |
| 1 | **Tenant & Site Registry** | tenant→project→model-container 最上兩層＋tenant→站點映射；租戶生命週期狀態機（active→deactivated→retained→purged）權威源；<10 租戶可先退化為 configuration。 | `/cp/tenants`、`/cp/tenants/:id/sites`、`PATCH /cp/tenants/:id/state` | 雲端 Postgres |
| 2 | **Identity & Access Broker** | org-per-tenant，簽發帶 `tenant_id` claim 的短期 OIDC token；operator/viewer 兩級 scope；企業自帶 IdP 走 Keycloak Identity Brokering。 | `/cp/auth/*`、`/cp/.well-known/openid-configuration` | 雲端 Postgres |
| 3 | **Rule & Pipeline Version Distribution** | governance 規則包/租戶 BYO IDS/conversion pipeline 版本化 artifact（比照 Fleet Command Helm 與 Greengrass component recipe+artifact+dependency），分階段 rollout＋失敗回滾；**落地端 pull，雲端不 push 進站**。 | `GET /cp/rules/manifest?siteId=`、`GET /cp/rules/:version/package`、`POST /cp/rollouts` | 雲端 Postgres |
| 4 | **Metering & Billing Aggregator** | 接收 connector 上報的三軸用量事件，HMAC 簽章＋冪等鍵去重，配額扣減後推 Stripe meter。 | `POST /cp/meter/ingest`、`GET /cp/tenants/:id/usage`、`GET /cp/tenants/:id/entitlements` | 雲端 Postgres |
| 5 | **Cross-Site Aggregation Dashboard** | 唯讀跨站 **metadata 投影**（轉檔筆數、governance pass/fail 統計、GPU 使用率/佇列深度、站點健康度、per-tenant SLO 達成率、ledger hash/摘要）；**IFC/USD payload 不出站**（絕不呈現或儲存，H6）。 | `GET /cp/fleet/health`、`GET /cp/dashboard/*` | 雲端 Postgres（僅 metadata） |
| 6 | **Audit & Compliance Ledger** | 信任視角**一級服務**：**append-only、只讀不可刪改**；收錄控制面每筆 tenant-context 操作＋落地端回補的稽核摘要（session 建立、spectator 同租戶驗證結果、危險動作三段式確認、租戶狀態轉移）；對應 SOC 2「每個 request/query/背景工作是否在明確 tenant context 下執行」稽核路徑。 | `GET /cp/audit?tenant=&from=&to=` | 雲端 Postgres（append-only） |
| 7 | **GPU Capacity Planner** | 跨 stamp 聚合 GPU 稼動率與佇列深度，為 GPU 保留 tier onboarding 做半自動容量審核；**只做規劃建議，絕不跨雲地邊界調度落地端 Kit**（調度屬 stamp 內 session broker）。 | 內部規劃報表（無跨界指令） | 雲端 Postgres（僅 metadata） |
| 8 | **Connector Ingest Gateway** | TLS 端點收 outbound 遙測/心跳，驗 HMAC＋短期憑證輪替。 | TLS ingest 端點 | 雲端 Postgres |

> 引用來源：AWS IoT Greengrass（component＝recipe+artifact+dependency）；NVIDIA Fleet Command（Helm chart 部署模型）。

---

## §4 落地端 edge plane

### 4.1 六服務原封保留（現況已建成，byte-identical，埠號逐字不動）

| 服務 | 埠 / 位址（逐字） | 邊界鐵律 |
| --- | --- | --- |
| coordinator | **127.0.0.1:8004** | 前端唯一入口＋`/api/governance/*` proxy，缺席回 502。 |
| governance-service | **:49102** | 永遠 host-native、browser 不直連、一律經 coordinator proxy。 |
| bim-streaming-server（信令） | 信令 **49100** | WebRTC 信令。 |
| bim-streaming-server（串流） | 串流 **47998** | WebRTC media。 |
| bim-streaming-server（轉檔 API） | 轉檔 **49101** | IFC→USD 轉檔 API。 |
| bim-streaming-server（spectator） | spectator **49110~49150** | 由 `KIT_SPECTATOR_COUNT` 控制。 |
| kit-manager-api | **:8010** | Kit 實例管理。 |
| viewer | **:5173** | Kit 1:1 endpoint，不當入口。 |
| Kit | Windows host-native GPU 渲染 | 容器缺 Vulkan ICD，host-native vs container plane 分離鐵律。 |
| MCP sidecars | **9901-9903** | 側車。 |

`scripts/deploy.ps1` golden path、本地 storage/MinIO、`governance.db` 單例 SQLite、ConversionLedger（in-memory＋JSON atomic swap，鍵 `mw_<hash16>`）全部不動。

### 4.2 新增：Edge Connector（純 additive sidecar·PLANNED·零反向依賴·移除即零殘留）

五職責 a-e：

- **(a) 註冊**：一次性 activation token 換站點身分憑證（比照 Arc onboarding / SSM `mi-` 前綴），短期憑證可輪替可撤銷，綁 `tenant_id`＋`site_id`。
- **(b) 心跳**：每 5 分鐘（參照值·本平台數值待定）outbound 上報站點健康摘要（六服務 up/down、GPU 是否在跑、佇列深度、warm pool 狀態、磁碟餘裕），**絕不含 payload**。
- **(c) metadata 上報**：讀既有 coordinator 唯讀 API（`GET /api/conversion/records`、`/api/minio/objects`、session/runtime 狀態、rule-run 統計）投影成計量/健康/稽核事件，**只送白名單欄位**（計數/狀態/hash/摘要/時戳/版本號），比照 Arc「does not store customer data」；**IFC/USD payload 不出站**（H6）。
- **(d) 規則版本拉取**：pull 規則包/IDS 寫入本地 staging，governance-service 照既有機制消費，支援回滾，本地快取（參照 Arc 14 天·參照值待定）。
- **(e) 離線佇列**：計量/稽核事件本地持久佇列＋冪等 key，恢復連線批次回補。

安全：零信任、最小權限，雲端不持有落地端 GPU/storage 憑證，connector 主動認證雲端、雲端不可逆向連回。

### 4.3 六服務演進路線（每步 additive，凍結面不破，對應 SaaS-M 階段）

| 服務 | 演進 | 階段 | 凍結守門 |
| --- | --- | --- | --- |
| coordinator | 新增租戶 context 中介層（解析 token `tenant_id` claim；`X-Tenant-Id` additive optional header，缺省走現況單租戶路徑）；proxy 路徑字串 byte-identical 永不改名。 | SaaS-M2 | §1 十二條凍結 |
| governance-service | SaaS-M1~M3 維持單例 SQLite（tenant zero）；SaaS-M4 起 schema-per-tenant bridge（expand-contract，先加不動既有欄位，每次只動一張表）——碰 §1 禁改後端檔即觸發待人類簽核。 | SaaS-M4 | §8.2 / §8.6 |
| bim-streaming-server＋kit-manager-api | 長出 session broker 層（職責對應 NVIDIA 官方兩層）；port 8011 併發搶佔 race 升級為 429+Retry-After 契約；kit-manager-api 承接租戶狀態硬 gate（deactivate/offboard 立即 terminate 佔用中 Kit）。 | SaaS-M3 | 詳規見 GPU經濟檔 |
| Kit | 永遠 Windows host-native、永遠 stamp 內部 data-plane 元件，不跨雲地邊界（排程層自建，此設計自建、非官方參考架構，未驗證，見§9未驗證假設章）。 | 全程 | H2 / H8 |
| viewer / MinIO | per-tenant bucket，`deriveIntakeFromKey` 三層解析不動。 | SaaS-M4 | §8.5 |

**Edge API Adapter（選配，SaaS-M6+）**：on-prem/BYO 客戶可在落地端直接暴露 `/v1` 公開 API 供內網整合，不經雲端 gateway，回退時前端 console 直打 :8004 不受影響（強化 H2 一級元件定位）。

---

## §5 outbound-only 通訊契約

| 面向 | 契約 |
| --- | --- |
| **方向** | 一律**落地端→雲端 outbound**（比照 Azure Arc「All connections are outbound」、AWS SSM Hybrid Activation「inbound access to server on firewall is not required」）；雲端**不開任何 inbound port** 連回落地端。 |
| **協定** | 控制/計量走 HTTPS 443；長連線通知（規則更新、rollout 觸發）走 WSS，由落地端主動建立。 |
| **頻率** | 心跳每 5 分鐘、逾 15 分鐘判離線（**參照 Arc，本平台值待定**）。 |
| **規則分發** | 落地端 **pull**（定期輪詢＋WSS 通知觸發），雲端不 push 進站（比照 Greengrass component 下發設定與版本差異）。 |
| **計量/稽核** | 事件批次上報；斷線本地佇列、恢復後**冪等回補**（至少一次投遞，Aggregator 冪等去重）。 |
| **內容** | 只承載控制/計量/狀態/hash/摘要；**IFC/USD payload 不出站**（H6，詳 §6）。 |
| **遠端除錯** | ＝客戶明確授權後的**臨時 tunnel**，非常態通道。 |

> 引用來源：Microsoft Learn — Azure Arc network requirements / agent overview（All connections are outbound）；AWS Systems Manager Hybrid Activations（activations.html）；AWS IoT Greengrass（how-it-works.html）。

---

## §6 metadata-only 投影白名單（H6 執行點）

雲端能看到什麼，以白名單界定；此為 H6 的可驗收執行點。

- **允許（白名單）**：計數 / 狀態 / hash / 摘要 / 時戳 / 版本號。
- **禁止**：IFC/USD payload 與模型內容片段（幾何、Pset 值本體、原始檔位元組）。
- **同句聲明**：凡描述上報/投影/dashboard，必同句聲明「**IFC/USD payload 不出站**」；比照 Arc「does not store customer data」。
- **間接洩漏風險**：conversion ledger 摘要、rule-run 統計、稽核 log 中的**檔名/GUID/專案字串**可能間接洩漏模型內容，使 H6 承諾與 ISO 19650-5 need-to-know 打折；須評估去識別選項（登錄防線 D-35，詳實作紀律檔）。
- **驗收**：**網路擷取抽驗**——擷取 outbound 流量檔，grep 無 payload 特徵；SaaS-M1 DoD 之一。

> 引用來源：Microsoft Learn — Azure Arc agent overview（does not collect PII / store customer data，metadata 不出 region）。

---

## §7 斷線 survivability

### 7.1 落地端全自主清單（雲端完全不可達時仍可完整運作）

| 能力 | 斷線行為 |
| --- | --- |
| IFC→USD 轉檔 | 落地端完整運作，不受影響。 |
| governance 檢核 | 落地端完整運作，不受影響。 |
| GPU 渲染 | 落地端完整運作，不受影響。 |
| WebRTC 串流 | 落地端完整運作，不受影響。 |

四家官方一致：**斷線只犧牲雲端可視性與遠端控制**（Arc「An outage of Azure Arc will not affect the customer workload itself」、Outposts data-plane 經 Local Gateway 續跑、Fleet Command edge servers continue to operate、GDC survivability mode）。

### 7.2 離線寬限期與逾期處置

- 離線寬限期＋本地佇列：**參照 GDC 7 天 survivability / Arc 14 天 policy 快取**（**參照值，本平台窗口由合規/法務拍板**）。
- 逾期須重連刷新憑證/金鑰（參照 GDC「refresh authentication tokens, storage encryption keys」），工作負載本身不受影響；不要求每筆操作即時雲端 ACK。

### 7.3 上線前硬要求

上線前**必須盤點落地端服務有無隱性雲端硬依賴**（Outposts 警示：即使 data plane 可續跑，地端服務若有隱性 region API 依賴仍可能失效），確認無硬依賴才可宣稱離線自主；**SaaS-M1 DoD 以拔網 E2E 實測驗收**。

> 引用來源：AWS Outposts（region-connectivity.html，7 天 telemetry 快取＋隱性依賴警示）；Google Distributed Cloud（how-it-works，7 天 survivability mode）；Microsoft Learn — Azure Arc agent overview（14 天 policy 快取）。

---

## §8 待人類簽核的新決策彙總表

下列項目涉突破凍結面，**未簽核前不得實作**；本表為總綱彙整，與 `審批報告-docs-plans-SaaS改版-2026-07-06.md` §5 互為引用。**「觸發條件」欄為代表性摘錄、非窮盡清單**，完整觸發子項以審批報告 §5 為準。

| # | 待決事項 | 觸發條件 |
| --- | --- | --- |
| 8.1 | §1 單租戶 host 假設突破 | governance API 需新增 user/org/project 參數；或 target host 選擇邏輯需侵入 proxy 路徑語意；或 /v1 gateway 無法通過 golden-path 逐位元組對比測試。 |
| 8.2 | tenant-scoped hash | 任何要引入 tenant-scoped hash（而非 token claim/子網域外層）的需求；或動到 `/ui/open` handoff 或 session-id regex。 |
| 8.3 | data.ts:6 Prov 型別變更 | 未來確需修改 Prov 型別（牽動 a1Machine.ts 等全部消費者），須以獨立提案附消費者影響面分析交人類拍板（現況：不新增第 8 值）。 |
| 8.4 | Keycloak 選型 | realm-per-tenant vs Keycloak Organizations 立項（社群效能牆 600+ 為非官方數字須實測）。 |
| 8.5 | Windows-Linux 架構分岔 | 落地端 Windows host-native vs 官方 Kit 容器化 Linux-only 立項；先於一切 GPU 擴縮設計。 |
| 8.6 | 落地端 DB 遷移 | governance 資料要遷 Postgres 或改 schema-per-tenant 而牽動禁改後端檔（SaaS-M4 啟動前）；任何會使 §8.3 資料庫事實過期的遷移屬更高效力文件裁決之事。 |
| 8.7 | O7 assignee 與 IX-SS-04 | 引入 issue/BCF ACL schema 或 assignee 寫入路徑；或需調和 IX-SS-04 裁定A（刻意不加 IP allowlist）與租戶門控。 |
| 8.8 | docs-plans 搬遷 | 若確需搬遷目錄，須同 PR 原子同步兩 regex＋AGENTS.md/CLAUDE.md/README.md 引用點＋CODEOWNERS/ISSUE_TEMPLATE＋治理測試斷言（現況：H7 不搬遷）。 |
| 8.9 | §8 七項品牌待決 | NVIDIA 綠值/字體/light theme/i18n/圓角/#semantic proxy 遷移/token-tier 任一項定案時，逐項顯式簽核；SaaS 品牌壓力不構成定案理由。 |
| 8.10 | BCF 3.0 實作 | 實作任何 /bcf/3.0 端點前須先完成向 buildingSMART 規格確認並交人類簽核；per-entity authorization 與 O7 租戶 ACL 有依賴，須待 O7 簽核後。 |

---

## §9 未驗證假設

正文引用下列推論類設計時標「（未驗證，見未驗證假設章）」；不得把 memory、generated wiki、研究摘要包裝成 runtime-verified fact。

- **跨站拆分無官方 Kit 參考架構**：NVIDIA Omniverse Kit App Streaming 官方兩份頁面（overview、infra）皆只描述「整套 streaming stack 部署在同一 Kubernetes 叢集」，**未提供「control plane 在雲、GPU worker 在地端」的跨站拆分參考架構**；本平台落地端 host-native＋自建排程層屬自建投資，非官方背書（未驗證，屬文件缺口而非證實不支援）。
- **Fleet Command outbound-only 未明文**：Fleet Command 嚴格 outbound-only 屬合理推論，官方公開文件未明文寫死；節點註冊 handshake 的實際 API/協定規格未查得（來源多為行銷頁與 Developer Blog）。
- **GDC 7 天 survivability 細節為摘要引述**：GDC connected 的 7 天 survivability mode 細節為 WebFetch 摘要引述，未逐字讀完整頁；本平台離線窗口最終值由合規/法務拍板。
- **落地端隱性雲依賴未盤點**：即使類比四家官方可宣稱斷線自主，本平台仍須自行盤點落地端服務（轉檔、governance、Kit streaming）是否有雲端硬依賴（Outposts 警示）；未盤點前不得宣稱離線自主，SaaS-M1 拔網 E2E 為第一道驗收。
- **雲地心跳/寬限期參照值**：心跳 5 分鐘、15 分鐘判離線、14 天/7 天快取皆為他家產品參照值，本平台實際數值待定/待合規拍板。

---

## 引用來源（research-hybrid-edge.json 所列官方文件）

- Microsoft Learn（官方）：Azure Arc overview / Connected Machine agent overview / network-requirements-consolidated；Azure Architecture Center — Considerations for Multitenant Control Planes。
- AWS 官方文件/白皮書：What is AWS Outposts / region-connectivity；Control planes and data planes（Fault Isolation Boundaries 白皮書）；Systems Manager Hybrid Activations；How AWS IoT Greengrass works。
- Google Cloud 官方文件：About Google Distributed Cloud air-gapped / glossary / architecture；How Distributed Cloud connected works。
- NVIDIA 官方：Fleet Command product page / FAQ / Developer Blog；Kit App Streaming — Infrastructure & Setup / Overview。
