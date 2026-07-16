## 背景

### 現況

- `governance-service/search/` 已能把 query 轉成 filters 並以 `ifcopenshell` 掃描 IFC；Ornith 只參與 query → JSON filters，不產生答案。現有 `auto` error fallback、evidence shape 與 completion semantics 尚不足以支撐 user-facing semantic done。
- `bim-review-coordinator/src/routes/governanceProxy.ts` 已有 `for-session/:sessionId` 與 `for-ifc-ready/:jobId` resolver，但通用 proxy 仍會原樣接受 browser body 的 `ifc_source_path`，session/job route 也接受 browser 提供的 `element_mapping_path`。
- `web-viewer-sample/src/console/A4SemanticSearchPage.tsx` 有真 API table，但位於非 canonical surface，並保留 path mode、直接批次建 Issue 與「到別處做 3D highlight」的 partial flow。
- 核可的 `#/workspace?dock=a4` / `workspace.a4.default` 目前是固定 fixture，顯示「符合／不符合規範」與固定計數；這與 search 實際只能證明 query predicate match 相衝突。
- `highlightPrimsRequest` / `highlightPrimsResult`、`focusPrimRequest` / `focusPrimResult`、mapping 與 primary/spectator runtime authority 已存在，A4 應作為既有協定的新 consumer，而不是建立第二套 3D protocol。
- Issue 單筆建立目前固定為 `source_type=manual`、`source_ref=null`，A4 僅把 query/evidence 拼進 description，不能提供結構化、不可變的來源快照。
- 安全的 filename-only 掃描在 tracked `.env.example` 與 `env.sample` 偵測到 candidate assignment；其有效性未驗證且值未在本文件重述。只有 owner 確認為 A4/Ornith 實際 credential 的值才納入本 change 的 rotation/revocation gate；既有非 A4 development defaults 不在此 cleanup scope。已確認曾被版本控制的 credential 都應視為可能曝露，刪除字串不能取代 owner-side rotate/revoke。

### 探索證據（非 normative）

2026-07-16 的規格盤問以 server-side environment 注入的 credential 呼叫 OpenAI-compatible lab endpoint；`/models` 與 `/chat/completions` 均觀察到 served model `Ornith-1.0-35B`。該次 completion 以 `finish_reason=length` 結束，因此只把其「先做 structured search v1、不要先做生成式 QA」建議當作 adversarial design input，沒有把不完整回覆當成產品正確性或模型品質證據。credential 值、raw request 與 raw response 均不得寫入本 change 或測試 artifact。

### A4 本地 lab operational input（operational、非 normative）

- Exact lab endpoint、local evidence source、hash 與 credential source 都是 operator-owned、out-of-repo input；本 change、committed fixture、CI artifact、browser bundle、shell history 與 log SHALL NOT 記錄它們。
- Live smoke 只可在需要時把選定 configuration 注入 governance-service process memory，使用後清除；credential、endpoint 與 local path 都不是產品設定契約。
- Runtime SHALL 使用 explicit server-side configuration；任何 lab HTTP 只可在 explicit `trusted_lab_http` profile 與 non-sensitive data 下使用，不能成為 runtime default 或 production transport readiness evidence。

**備註（決策原因）：** 實際 lab 位置不需要進入規格才能讓 implementation 選擇正確的 server-side boundary，反而會讓 change 本身成為內部 metadata artifact。把它保留在 operator-owned out-of-repo input，仍可重現授權 live smoke，也能防止 endpoint、path 或 credential source 被提交。

### 約束與假設

- A4 的產品編號以 `docs/plans/AI-BIM 前後端設計文件.dc.html` 的 A4 Semantic Search 為準；`unified-governance-console` 內另有把 A4 稱為「治理分」的 legacy numbering，這次不擴張成 A1–A10 全面重新編號。
- full A4 flow 假設 active Review Session 可由 coordinator resolve 到 server-side IFC source、real mapping、model version 與目前 stage；任一必要 binding 缺失都要誠實降級或拒絕。
- search/Issue authority 留在 governance-service；session/control-plane resolution 留在 coordinator；mapping/stage/DataChannel authority 留在 streaming/Kit；browser 只持 UI state。
- `workspace.a4.default` 是 2D design authority，但 visual fidelity 不能取代真 API、Ornith、mapping、Kit command 或 first-frame evidence。
- Ornith 是可選 interpreter，不是 BIM、IFC、法規或 compliance authority；token 只能由 server-side secret injection 提供。
- 所有 session-scoped A4 routes 都假設 coordinator 能先取得 server-authenticated principal；browser body／headers 的 actor 欄位不能建立 authority。Local-dev identity 只算 lab scope。
- Production semantic transport 必須使用 verified HTTPS、mTLS 或受信 loopback tunnel；non-loopback HTTP 只限明確 lab profile，且不得處理敏感專案 query。

### 假設、成功標準與最小安全改動

- **Assumption**：既有 deterministic interpreter 與 IFC scanner 可保留，主要補強 orchestration、contracts、provenance 與 canonical UI，不重寫 search engine。
- **Success criteria**：一個 primary 使用者能在 active session 的 canonical A4 dock 執行 query、看到 validated filters 與 honest Evidence Trace，經短效 `/ui/open?session=` handoff 在真 session viewer 明確 focus/highlight mapped result，並在確認後建立帶 A4 provenance 的 Issue；spectator、model failure、unmapped、empty、truncated、handoff expiry 與 retry 狀態均可觀察且不偽裝成功。
- **Smallest safe change**：重用既有 `for-session` proxy、search engine、Issue store、`/ui/open?session=` viewer 與 focus/highlight message types；新增必要 response fields、additive Issue evidence storage、短效 coordinator handoff、viewer-side mapping bridge、A4 UI wiring 與 tests，不把 WebRTC 植入 Console，也不在本 change 修改 shared runtime event/schema/producer。
- **Verification gates**：contract/unit → coordinator integration → browser operability → design fidelity → live lab Ornith smoke → Kit/WebRTC command evidence。未通過後兩者時可以分別宣告 deterministic/API 或 partial UI 通過，但不得宣告 semantic/full completion。

### 利害關係人

- Edge operator / BIM reviewer：需要可理解、可重試且不冒充 compliance 的結果。
- Governance service owner：負責 filter schema、IFC execution、Evidence Trace 與 Issue provenance。
- Coordinator owner：負責 session-bound server resolution 與 production request boundary。
- Viewer / Kit owner：負責 primary/spectator authority、focus/highlight command 與 runtime evidence。
- QA / design owner：負責 `workspace.a4.default` re-approval、semantic cases、visual gate、lab smoke 與 E2E artifact。

## 目標／非目標

**目標：**

- 把 A4 收斂成「NL query → validated filters → deterministic IFC search → Evidence Trace → explicit 3D action」的一條 session-bound v1。
- 讓 deterministic、semantic 與 auto 三模式有可測的 invocation/failure/degradation semantics。
- 關閉 production browser 對 host IFC/mapping path 的控制，並清楚區分 full session flow 與 table-only compatibility flow。
- 讓 UI 用詞、Issue provenance、model QA、runtime ack 與 design/operability gates 可稽核。
- 保留既有 service authority 與 protocol，採 additive、可 rollback 的資料 migration。

**非目標：**

- 不做生成式 natural-language answer、法規 RAG、法條 citation 或 compliance decision。
- 不讓 Ornith 讀取 IFC bytes、決定 match、建立 Issue、發送 3D command或成為資料權威。
- 不建立 query-history DB、analytics、RBAC 或 retention policy。
- 不自動建立 Issue/BCF，不改 Issue 狀態機，不自動把 query match 視為 violation。
- 不以 `for-ifc-ready` table-only、mock DataChannel、單張 screenshot 或 visual parity 宣告 full completion。
- 不在本 change 解決 legacy A1–A10 雙編號 taxonomy；另開 convergence change 才能安全重寫歷史 specs。

## 資料與控制流程

```mermaid
sequenceDiagram
    participant CON as Console #/workspace?dock=a4
    participant VIEW as Session viewer /ui/open?session=
    participant CO as bim-review-coordinator :8004
    participant GOV as governance-service :49102
    participant LLM as Ornith-1.0-35B (lab)
    participant KIT as Kit/DataChannel runtime

    CON->>CO: POST /api/governance/search/model/for-session/:sessionId<br/>{query, interpret_mode, limit}
    CO->>CO: authorize active session; resolve IFC/mapping/model/stage server-side
    CO->>GOV: POST /api/search/model with resolved server fields
    GOV->>GOV: deterministic parse + schema validation
    opt semantic mode or auto needs semantic interpretation
        GOV->>LLM: query only; request JSON filters
        LLM-->>GOV: structured candidate + model metadata
        GOV->>GOV: validate candidate; never trust raw text
    end
    GOV->>GOV: deterministic IFC scan + Evidence Trace
    GOV-->>CO: query_id, interpretation, results, stats, evidence
    CO-->>CON: unchanged authority payload + session binding summary
    opt row focus or explicit highlight (primary only)
        CON->>CO: POST /api/review-sessions/:sessionId/a4-handoffs<br/>{action, evidence_proof[]}
        CO->>GOV: verify proof/snapshot/model/mapping and accepted prims
        GOV-->>CO: verified signed search-time binding + prims
        CO->>CO: compare current session/artifact/active_binding_revision; bind actor/primary/expiry
        CO-->>CON: opaque handoff_id, expires_at, /ui/open URL
        CON->>VIEW: navigate /ui/open?session=...&a4_handoff=...
        VIEW->>CO: consume same-session handoff_id
        CO-->>VIEW: trusted action + accepted prims
        VIEW->>KIT: focusPrimRequest or highlightPrimsRequest
        KIT-->>VIEW: result or commandRejected with request_id
    end
    opt user selects, edits, and confirms Issue draft
        CON->>CO: POST session-scoped A4 Issue route with provenance snapshot
        CO->>GOV: forward-only
        GOV-->>CON: Issue + audit record
    end
```

### 真相來源權責

| 資料／狀態 | Authority | v1 persistence | Browser responsibility |
|---|---|---|---|
| Review Session、primary/spectator role、model/stage binding | coordinator + existing runtime contracts | existing session stores | 選擇／attach session；永不提供 host paths |
| IFC bytes／host-resolved source | existing artifact/conversion path；由 coordinator resolve | existing artifact lifecycle | 無 |
| element mapping／mapping provenance | streaming conversion artifact | existing `element_mapping.json` lineage | 只 render mapped/unmapped status |
| interpreted filters、match results、`query_id`、unconsumed proofs | governance-service search execution | 只限 transient | UI session 持 current result/proof；不得 mint/alter proof |
| A4 3D handoff intent | coordinator active-session transient store | opaque、bounded TTL、無 durable event/query record | URL 只接收 `handoff_id`；不得提供 trusted prim/session/principal |
| Ornith credential/config | governance-service process environment | 只限 secret manager／environment | 永不接收或 render token |
| Kit focus/highlight state 與 ack | session viewer + Kit runtime/DataChannel | 只限 runtime/event evidence | Console handoff；viewer 送 authorized explicit command 並 render ack/rejection |
| confirmed Issue、A4 snapshot 與三個 digests | governance-service Issue DB | 只在 user confirmation 後 persistent | 編輯 draft、逐 row confirm，再顯示 returned/replayed Issue ID |

## 決策

### D1 — v1 是 structured semantic search，不是生成式 QA 或 compliance

系統 SHALL 把 natural-language query 解譯為 schema-valid filters，再用 deterministic IFC logic 執行。Ornith SHALL 只提議 filter JSON。Final row label SHALL 為 `matched_query`／`not_matched_query`（UI：符合／未符合查詢條件），永遠不得標 compliant/non-compliant。

**備註（決策原因）：** 現有可驗證 authority 是 IFC class/storey/property predicate 與 evidence trace；repo 沒有法規 corpus、citation entity、jurisdiction/version resolution 或 compliance rule engine bridge。先做生成式回答會把語言流暢度誤當事實正確性，也會讓硬編碼「符合規範」看似有依據。把 model 限制在 interpreter role，可由 JSON schema、deterministic executor 與原 IFC 值逐層驗證。

**未採用方案：**

- 「一次做 RAG + 法規引用 + verdict」：缺 citation/version truth 與驗收 corpus，風險超過 A4 v1。
- 「完全不使用模型」：無法涵蓋自然語言變體，也不符合本次明確的 Ornith model QA 目標。
- 「模型直接回傳 GUID」：模型沒有 IFC authority，且無法提供 deterministic replay。

### D2 — 完整 A4 需要 active Review Session、authenticated principal 與 server-side resolution

Canonical production request SHALL 為 `POST /api/governance/search/model/for-session/:sessionId`，browser body 限 query controls（`query`、`interpret_mode`、bounded `limit`、optional retry correlation）。Coordinator SHALL 先由 `UserAuthProvider` 取得 authenticated principal，再 authorize active session，從 server-owned state resolve `ifc_source_path`、`element_mapping_path`、`model_version_id` 與 active stage；它也 SHALL 以 internal provenance 傳 verified `review_session_id`／principal reference，永不信任 browser replacement。

`POST /api/governance/search/model/for-ifc-ready/:jobId` MAY 保留為 compatibility table-only flow。它 SHALL NOT 發 session-bound row proof、啟用 Issue／3D controls 或滿足完整 A4，因 job 本身不能證明 active viewer authority、stage、primary role、mapping alignment 或 DataChannel readiness。

Generic `/api/governance/search/model` SHALL NOT 讓 production browser code 以 host path 或 mapping path 呼叫。若為 internal tests/dev 保留，MUST loopback/internal-gated，且在 production UI contract 之外。

**備註（決策原因）：** browser-supplied paths cross the host trust boundary and permit stale/wrong model or mapping combinations. Session resolution gives one server-verifiable unit tying model version, artifact, mapping, stage and viewer authority together. Keeping `for-ifc-ready` table-only preserves a useful compatibility/debug path without weakening the meaning of full completion.

**未採用方案：** client path picker、client-supplied mapping override，以及把 IFC-ready job 當成 active review session。

### D3 — interpretation mode 是 explicit state machine

Service SHALL 先評估 deterministic interpretation，並為 candidate 提供 `schema_valid`、`complete`、`usable` 與 `unresolved_terms`。這些 flags SHALL 由 governance-service validator 依原 query、normalized filters 與 consumed spans 計算，Ornith 自報值不得成為 execution authority。

| Mode | Model invocation | 可執行條件 | Failure behavior |
|---|---|---|---|
| `deterministic` | never | 只有 schema-valid、complete、usable candidate 直接執行 | incomplete but usable 先要求二階段確認；invalid/unusable 回 visible error |
| `semantic` | always | 只有 validator 判定 Ornith candidate schema-valid、complete、usable 才執行 | incomplete/unusable/invalid/timeout 都回 visible retryable error；不得 fallback |
| `auto` | deterministic 不完整時 | complete deterministic 直接執行，否則只有 complete Ornith result 可執行 | Ornith 非完整成功時 MAY 提供 deterministic partial confirmation，但第一次 response 零 rows |

Candidate 只有在 schema-valid、每個 constraint-bearing segment 都已轉為 normalized supported filter 或 harmless stopword、`unresolved_terms=[]` 且沒有 contradictory/unsupported constraint 時，MAY 設 `complete=true`。Deterministic candidate 只有至少一個 supported filter、通過 schema/operator/class validation 且沒有 unsafe construct 時才是 `usable`。`usable` 不代表 `complete`；例如「找四樓的門且靠近逃生梯」可產生 usable class/storey filters，但 proximity intent 未解決時 MUST incomplete。任何 incomplete candidate 預設不得執行。

若 deterministic partial candidate 可用，service SHALL 先回零 rows 的 `partial_fallback_confirmation_required`，顯示 exact filters／遺漏條件並發短效 `partial_fallback_id`，綁 query/session/principal/model/artifact/revision/expiry。只有同一 principal 另次 explicit confirmation，且全部 binding 未變時才 MAY 執行 exact candidate；confirmed result SHALL 為 `partial_table_only`，不得發 proof、Issue 或 3D eligibility。

**備註（決策原因）：** Always invoking Ornith 會增加 latency/cost 與 nondeterminism；silent fallback 會隱藏 semantic failure，甚至讓 partial query 看似完整。`usable=true` 只代表部分 filters 可安全執行，不代表完整 query 已被表達。先零執行、顯示 exact omissions，再要求二階段確認，可保留 deterministic utility 又不讓 rows 先被誤用。

**未採用方案：** always-LLM、broad catch-and-silent-fallback，以及沒有 declared winning source 就合併 deterministic/LLM candidates。

### D4 — Response contract 保存 structured trace，不保存 raw model text

每次 execution attempt SHALL 取得 governance-service 產生的新 opaque `query_id`（例如 `a4q_*`）。Retry MAY 包含 `retry_of_query_id`；兩個 identifier 都不建立 persistent query record。

Response contract SHALL 至少包含：

```json
{
  "query_id": "a4q_opaque",
  "status": "ok",
  "interpret_mode": "auto",
  "session_binding": {
    "review_session_id": "review_session_opaque",
    "model_version_id": "model_version_opaque",
    "primary_artifact_id": "artifact_opaque",
    "active_binding_revision": "binding_revision_opaque"
  },
  "interpretation": {
    "source": "deterministic_or_ornith",
    "schema_version": "a4_filters_v1",
    "schema_valid": true,
    "complete": true,
    "usable": true,
    "degraded_to_deterministic": false,
    "unresolved_terms": [],
    "filters": {}
  },
  "model_invocation": {
    "invoked": false,
    "served_model": null,
    "latency_ms": null,
    "finish_reason": null,
    "error_code": null
  },
  "stats": {
    "scanned": 0,
    "matched": 0,
    "not_matched": 0,
    "mapped": 0,
    "unmapped": 0,
    "returned": 0,
    "truncated": false
  },
  "results": [{"evidence_proof": "opaque_signed_row_proof"}],
  "evidence_refs": []
}
```

`not_matched` SHALL 表示 candidate-scope `scanned - matched`，永不表示 non-compliance；`matched` SHALL 表示完整 scanned match count，`returned` 則是 limited row count。Session-scoped full-flow response SHALL 提供 sanitized `session_binding`，包含 trusted review session、authenticated principal opaque reference、model version、primary artifact 與既有 `active_binding_revision`，但不得有 host path／internal endpoint。Complete result row SHALL 包含 IFC identity、actual matched values、predicate traces、mapping status、optional accepted real `usd_prim_path` 與短效 opaque governance-signed `evidence_proof`。Signed claims SHALL 把 unique proof ID、`kid`、expiry、trusted session/principal 綁到 complete immutable snapshot 的 `snapshot_hash`。Browser SHALL NOT mint／alter claims。Table-only 或 confirmed partial result SHALL 不含 session proof，並標 Issue／3D ineligible。Raw completion、signing secret、token、Authorization header、absolute host path、remote response body 與 endpoint SHALL NOT 出現在 response/evidence/log summary。

`GET /api/governance/search/llm-status` SHALL 是 canonical UI readiness endpoint。Sanitized projection SHALL 區分 `configured`、`disabled`、`available` 與 `unavailable/unknown`，並包含 `checked_at`、`check_source`（`bounded_probe`／`last_query`／`config_only`）、transport class 與 freshness/TTL metadata。`available`／`unavailable` 只能用於仍在 TTL 內的 bounded probe／query observation；config-only 或 stale observation SHALL 為 `unknown`（explicit disabled 時為 `disabled`）。它 MAY 提供 configured model／timeout，但 SHALL NOT 提供 base URL、credential、headers、remote body 或 raw probe。Configured model name 只是 intent；只有成功 query/live smoke 的 `model_invocation.served_model` 可證明 actual served model。

LLM config SHALL explicit fail closed：`A4_LLM_ENABLED` 未設定預設 `false`，不得因 key 存在自動啟用；URL/model/timeout/credential/profile/transport 缺漏、alias conflict 或 disallowed scheme/host 時 zero outbound。`verified_https` 必須驗 CA/hostname；`loopback_tunnel` 只允許 loopback endpoint；`trusted_lab_http` 只限 explicit lab profile + allow-insecure + allowlist，且不得算 production readiness。

**備註（決策原因）：** `query_id` 用來關聯 UI、model smoke、highlight 與 Issue provenance，而不需要 history storage。Structured trace 讓 contract/unit tests 可重播；raw completion 更大、更不穩定、可能含 user data，且不是 execution authority。Explicit config/transport 防止漏設 URL 時帶 key 誤連 lab，也把 lab availability 與 production security 分開。

### D5 — Canonical A4 UI 保持誠實、可操作，且獨立接受 design gate

`#/workspace?dock=a4` SHALL 是 canonical A4 surface。Legacy `#a4`、`#/a4` 與目前 `#semantic-search` SHALL 在保留 relevant session context 下 redirect，或在 caller migration 後移除；不得 mount 第二套 A4。Surface SHALL 提供 idle、loading、success、empty、uninterpreted、semantic error、partial-confirmation-required、confirmed partial、retrying、proof-expired-draft-preserved 與 source/session-unavailable states。Retry SHALL 重送 last explicit user input 並顯示 prior `query_id` relationship；不得 silent change mode/filters。

UI SHALL render query-match wording、validated filters、interpretation source、model invocation/degradation state、Evidence Trace 與 mapped/unmapped/truncated counts。Fixed fixture counts、law citations 與 compliance wording SHALL 從 live states 移除。

Canonical Console SHALL NOT host WebRTC/video 或送 DataChannel message。它 SHALL 把 mapped-row focus 與 explicit multi-row highlight 當 session handoff actions，顯示 handoff creating/expired/rejected states，並經 coordinator-provided `/ui/open?session=` URL navigate。Separate session viewer SHALL 擁有 DataChannel readiness 與 command outcome UI。

`workspace.a4.default` 需要 explicit re-approval/rebaseline，因 truthful labels 與 live states 會實質改變 approved baseline。Implementation SHALL 跑 repo-pinned Windows Chromium DPR1 1440×900／1920×1080、pixel diff ≤1% 與 Playwright semantic 100%。Functional/runtime evidence 維持獨立。

**備註（決策原因）：** 同時保留 real API page 與 separate fixture page 會形成兩套 A4 truth。重用 canonical approved route 可保留 IA；rebaseline 則承認修正 misleading language 是 intentional product change，不把它藏成 pixel drift。

### D6 — 3D 使用 transient viewer handoff；focus／highlight 分離、明確且限 primary

Unified Console SHALL 保留「WebRTC 只在 `/ui/open?session=` 後開始」的邊界。Primary principal 點一個 mapped row 時，A4 dock SHALL 使用該 row signed proof 向 handoff route 請求一個 `focus`；selected mapped rows 的 highlight SHALL 需要 distinct explicit button 與 `highlight` handoff。Governance-service SHALL 驗每個 proof 的 signature/snapshot/model/mapping/accepted prim，但不是 current Kit stage authority。Coordinator SHALL 重新授權 session/principal/active primary lease，resolve current artifact/revision，要求全部 proof 未過期且綁同一 session/principal/model/artifact/revision；任一 mismatch 都 atomic reject，不得 silent drop。Intent 只留 bounded transient memory，`expires_at` 取 configured TTL 與 proof expiry 最小值，並只回 opaque `handoff_id`、expiry 與 coordinator `/ui/open` URL；URL 不得含 query/evidence/host/prim/proof。

Session viewer SHALL 經 coordinator consume handoff、驗證未過期且已授權，並在每個 command attempt 前比對 coordinator-bound session/principal/model/artifact/revision 與 current loaded stage。它 SHALL 經 viewer-side handoff/mapping bridge 取得 trusted accepted prims，等待 DataChannel ready 後只送一個 one-element `focusPrimRequest` 或一個 `highlightPrimsRequest`。Console SHALL NOT 直接送 message，也不得假設 `mappingCache` 已接進 `console/unified/*`。

每個 DataChannel request SHALL 帶 existing protocol 的 unique `request_id` 與 active session/viewer identity。Viewer UI SHALL correlate `focusPrimResult`／`highlightPrimsResult`，顯示 pending/succeeded/rejected/timed-out 並保存 rejection/timeout evidence。Explicit retry SHALL 建新 `request_id` + `retry_of_request_id`；每次 retry 前重新驗 principal、session、primary lease、artifact/revision、loaded stage 與 DataChannel。Unmapped row 停用 handoff；truncated result 不表示 unreturned matches 已 highlight。Expired/consumed/mismatched handoff SHALL fail closed 並要求新 handoff。

Spectator controls 在 Console/viewer SHALL 為 `disabled` + `aria-disabled` 並附原因；兩者都 SHALL NOT 為 spectator 送 mutating command。完整 A4 runtime SHALL 依賴 shared capability 驗 coordinator-issued primary lease authenticity，而不是只驗 `role==primary` 與 token shape。

A4 只 SHALL 消費 shared owner 正式定義的 terminal result/rejection；本 change 不新增 shared event/schema、Kit／`harness/fakeKit.ts` producer 或 rollout。Authentic lease 或可關聯可信 rejection 未交付時，A4 table/Issue MAY 保持 partial，但 3D／Full completion SHALL 為 `no`。Full 3D completion 需要 observed handoff ID、current first-frame、bound stage、DataChannel、command `request_id`、authentic lease/capability validation 與 real result/rejection evidence；mock echo 不是 production proof。

**備註（決策原因）：** Row navigation 與 visual highlight 有不同 intent/blast radius，explicit highlight 可防 broad query 意外改變 shared scene。Console 沒有 real video/DataChannel，也不 consume `mappingCache`；假裝已有接線會依賴不存在的 wiring。短效 opaque handoff 保留 Console/viewer 邊界且不建立 history/URL leak。Governance 驗 signed search snapshot，coordinator/runtime 擁有 current stage/lease truth；每次 retry 重驗可防 stale stage。Shared protocol 由獨立 owner harden，避免 A4 建第二個權威。

### D7 — A4 Issue creation 由人明確確認並保存 immutable provenance

A4 UI SHALL 只從 user-selected rows 建 Issue drafts。Title、description、severity、assignee 在 confirmation 前 SHALL 可編輯。Multi-row confirmation SHALL 對 session-scoped coordinator route 發 independent single-row requests，使每筆 atomic，UI 可誠實呈現 partial outcomes。Coordinator SHALL 重新授權 active session、authenticated principal 與 active primary lease，forward browser payload 無法 override 的 trusted context。每個 confirmed row SHALL 建一個 Issue，包含：

- `source_type=a4_search`
- `source_ref=<query_id>`
- `model_version_id` 與 `ifc_guid`
- search 所觀察到的 `primary_artifact_id` 與 `active_binding_revision`
- 只在 mapped 時提供 real `usd_prim_path`
- immutable structured `a4_evidence_snapshot`，包含 schema version、query text、interpreted filters、interpretation source/degradation state、artifact/revision、selected-row actual values/predicate traces 與 mapping status
- 該 row 的 unexpired server-signed `evidence_proof`

Governance-service SHALL 比對 trusted current session/principal 與 signed claim，並在指派 A4 provenance 前驗 signature、`kid`、expiry 與 `snapshot_hash`。首次 consume SHALL 在同一 transaction 保存 Issue、snapshot、unique proof ID、exact-token `proof_digest` 與包含 initial editable fields 的 `creation_request_hash`。已 consumed replay 先重新授權，再 constant-time 比對三個 digest；完全相同時即使 proof expired/key retired 也回 existing Issue，任一不同回 409。這些欄位只掛 confirmed Issue，不建立 query-history DB。

Proof signing SHALL 使用 secret injection 的 dedicated server-only keyring，永不使用 committed/default key 或 Ornith token。Proof 帶 `kid`；唯一 active key 簽發，previous key 在 normal rotation SHALL verify-only 保留到最後一張 proof expiry + clock skew。Emergency revocation MAY 立即拒絕未 consumed proof。沒有 valid key 時 search MAY table-readable，但 proof issuance/A4 Issue/full completion SHALL fail closed。

Search completion、match、selection 或 highlight SHALL NOT auto-create Issue／BCF。Existing explicit BCF export MAY 後續作用於 confirmed GUID-bound Issue，但 Issue creation 本身 SHALL NOT export BCF。

未 consumed proof 過期 SHALL 回 `a4_proof_expired` 與 rerun/draft-preserved hints；UI 只在 browser memory 保存 draft，重跑原 query/mode 後要求重新確認 current row/binding。不得自動換 proof 或寫 partial Issue。

**備註（決策原因）：** query match is neither a defect nor a compliance failure. Human selection/edit/confirmation preserves reviewer accountability. Storing an immutable snapshot on the Issue gives durable provenance without persisting every exploratory query. Schema validation alone cannot prove a browser payload came from A4；a short-lived signed row proof makes the provenance server-verifiable while retaining the no-history decision.

**未採用方案：** 每個 match 自動建立 Issue、free-text-only evidence，以及新的 A4 Issue state machine。

### D8 — v1 不保存 query history

Search results、raw query、model metadata、unconsumed proofs、`partial_fallback_id` 與 A4 3D handoff intent SHALL 只留 current UI/coordinator/governance session memory。Handoff 使用 opaque ID、在任一 proof 已過期時拒絕、expiry 取 configured TTL 與 proof expiry 最小值，並依 policy purge intent；不得把 query/evidence 加 durable session events。Invalid multi-row input atomic reject，不 silent persist/drop。v1 SHALL NOT 新增 query-history table／analytics stream。只有 user-confirmed Issue 保存 selected snapshot、proof ID 與三個 digests；不得保存 unselected rows 或 searchable query record。

**備註（決策原因）：** History 會立即引入 retention、RBAC、deletion 與 sensitive-project-query 問題，而 core workflow 不需要它。`query_id`、short-lived partial/handoff ID 與 `request_id` 已足夠做 in-session correlation，同時讓 URL/durable events 不含 query/evidence。

### D9 — Model QA 分開 deterministic/CI 與 live-lab gates

CI SHALL 跑 deterministic parser/executor tests 與 mocked Ornith contract tests，涵蓋 valid JSON、schema violation、timeout、HTTP error、bad finish reason/empty、incomplete/unusable、partial confirmation 與 no-secret logging。CI SHALL NOT 需要 live network 或 model credential。

Live smoke 或 semantic/full completion 前，credential hygiene SHALL 證明受影響的 A4/Ornith tracked sample 只含 placeholders，且 credential owner 已 rotate/revoke 曾 commit／otherwise exposed 的實際 A4/Ornith credential。本 change 不授權 implementation agent invent、print 或 overwrite real secret；rotation 是 owner-coordinated external action。

Semantic completion SHALL 另要求至少一次經 coordinator session route 的 live lab smoke，使用 explicit server-side URL/model/profile/transport、injected credential 與 non-sensitive query/fixture。Sanitized artifact SHALL 記 timestamp、`query_id`、served model 正好為 `Ornith-1.0-35B`、interpretation source、latency、finish reason、structured filters、response status、config-source key names、transport class 與 secret-scan result；不得記 token、Authorization header、endpoint、absolute path、raw model text 或 sensitive query。

若 Ornith unavailable，deterministic functionality MAY 保持可用並分開回報，但 `semantic completion` 與 `Full completion claimed` SHALL 為 `no`。`trusted_lab_http` 只可證明 lab integration，不能滿足 production transport readiness。

**備註（決策原因）：** Mocks 提供 repeatable CI coverage，但不能證明 endpoint/model/config compatibility；live smoke 可證明 integration，又不讓每個 PR 依賴 LAN model。分開 labels 可避免 model downtime 被誤報成 search correctness，反之亦然。Credential 一旦進 Git 可能留在 clones/history，因此 completion gate 是 rotation/revocation，不只是 redaction。

### D10 — Capability ownership、design baseline 與 legacy naming 需要明確 sequencing

本 change SHALL 不再修改 `unified-governance-console`，因此不與 active `align-frontend-design-system-reference` 形成 capability overlap。Canonical A4 route、live states、design gate 與 runtime evidence 全由 `a4-semantic-search` 擁有；A5–A10 roadmap 由 `edge-console-operator-frontend` 擁有。

Active `migrate-console-to-hifi-design` 依 contract behavior-neutral，但會替換 console token authority 並 rebaseline 全部 approved screens，包括 `workspace.a4.default`。Implementation MAY parallel，但 maintainers SHALL 指定 final A4 golden capture owner。後續 design migration SHALL NOT 用 old fixture state 覆寫 A4 live baseline；後續 A4 rebaseline SHALL 使用 resulting token authority。Preferred closeout：先完成 visual migration，refresh A4 screen against resulting authority，最後只 implement/re-approve 一次 live A4。

Active、未 archived 的 `c-m4-runtime-command-bridge` 擁有 shared runtime mutator authorization 與 command-specific result contract。A4 SHALL NOT 建 parallel shared owner 或 coordinator runtime-operations proxy。Authentic lease 與 compatible terminal rejection 應在 C-M4 archive/reconcile 後由獨立 successor change 修改 `viewer-runtime-command-bridge`；A4 只保留 handoff、retry revalidation 與 A4-specific consumer requirements，並把 shared hardening 當 full-completion dependency。

Legacy `unified-governance-console` vertical-slice requirement 把 A4 稱為 governance score，仍是 known naming conflict。本 change SHALL 在自己的 routes/copy 中辨識 canonical A4 Semantic Search，但 SHALL NOT 修改該 capability 或重寫 affected A4 surfaces 之外的 A1–A10 taxonomy。

**備註（決策原因）：** Overlapping deltas 可能各自 validate，卻在 sequential archive 互相覆寫；兩個 valid rebaseline 也可能讓 last writer 留下 stale screen。直接移除 overlapping capability delta，比只記 archive order 更能滿足 NoSuccessor gate。Shared protocol 必須由一個獨立 owner 修改，否則其他 runtime consumers 沒有共同 authority。Explicit ownership 可防 documentation、visual 與 compatibility regressions；taxonomy rewrite 則需要 separate product decision。

## 風險／取捨

- **[Partial deterministic fallback 遺漏 user intent]** → incomplete candidate 第一次零執行；顯示 exact filters／`unresolved_terms`，只在二階段 explicit confirmation 後產生 `partial_table_only`，且不發 proof／Issue／3D eligibility。
- **[Ornith latency/availability 讓 UI 卡住]** → bounded timeout、visible pending/cancel-safe UI、explicit retry、deterministic fast path 與 separate semantic label。
- **[Model JSON schema-valid 但語意錯誤]** → server-computed consumed spans／completeness、strict allowlist/schema、deterministic executor、顯示 filters/actual IFC values，不接受 model GUID/verdict。
- **[LLM config 漏設或 alias conflict 誤連 lab]** → explicit enable、complete config、alias mismatch fail closed、zero outbound，禁止固定 runtime default。
- **[明文 lab HTTP 傳輸 token/query]** → 只限 explicit `trusted_lab_http` + allowlist + non-sensitive data；production 要 verified HTTPS/mTLS/loopback tunnel。
- **[Browser path/identity injection 或 model/mapping mismatch]** → production session-only、`UserAuthProvider` principal、server resolution、body/header 不可提權、containment/lineage checks。
- **[Issue evidence schema migration]** → additive nullable field/table、schema version、舊 rows 不 fabricated backfill。
- **[Proof expiry/replay 無法辨識 altered draft]** → `snapshot_hash` + exact-token `proof_digest` + initial `creation_request_hash`，constant-time replay compare；未 consumed expiry 保留 draft 並要求 rerun/reconfirm。
- **[Signing key absent/reused/rotation unsafe]** → dedicated keyring、唯一 active `kid`、normal retention 至 last expiry + skew、emergency revoke、不得重用 Ornith key。
- **[Ack lost/reordered 或 retry 遇到 stage/lease change]** → 每次 attempt 新 `request_id`，retry 前重新驗 principal/lease/artifact/revision/stage，stale state zero-send 並要求 new handoff。
- **[Console 長出第二套 WebRTC/mapping]** → `/ui/open?session=` 是唯一 3D boundary，只新增 transient handoff/viewer bridge，測 Console zero DataChannel。
- **[Shared runtime hardening 未交付]** → 由 C-M4 後續獨立 owner 修改；A4 只消費 terminal outcome，未交付時 3D/full completion 為 `no`。
- **[Design rebaseline 正規化 misleading fixture]** → re-approval 綁 neutral copy/live states，functional/runtime gates 獨立。
- **[Live lab evidence 洩漏 secret/query/內部 metadata]** → non-sensitive fixture/query、whitelist artifact、secret scan、support/deploy bundle exclusion，不保存 raw request/response/endpoint。
- **[Tracked A4/Ornith credential 已可能曝露]** → 受影響 sample 改 placeholder 但不冒充 rotation；owner rotate/revoke 未確認前阻擋 semantic/full completion。
- **[Design baseline 最後寫入者覆蓋 A4]** → 指定 final A4 golden owner，最後一次 visual migration 後重跑 semantic/visual gates。
- **[Dual A4 numbering]** → 本 change 使用 canonical copy/route；taxonomy 另案，不修改 `unified-governance-console`。

## 遷移計畫

1. 不輸出值地建立 credential safety gate：owner 協調 exposed A4/Ornith credential rotation/revocation、受影響 samples 只留 placeholders、current tree/artifacts 通過 secret scan。
2. 先建立 current baseline，再加 filter coverage/invariants、partial confirmation、response trace、error/degradation 與 no-secret/path tests。
3. 讓 LLM config explicit fail closed，加入 transport/profile matrix、alias conflict/zero-outbound 與 endpoint/error redaction。
4. 新增 `query_id`、interpretation/model metadata、stats 與短效 partial confirmation state；需要時短期保留既有 response fields。
5. 新增 dedicated proof-signing keyring、active `kid`、bounded previous-key verification 與 no-key fail closed；不重用 Ornith token。
6. 只為 complete eligible rows 發短效 signed proof；測 field mutation、expiry、rotation、cross-boundary，且不保存 query history。
7. Additive/schema-versioned Issue provenance 保存三個 digests；先驗 current session/principal/lease，再指派 A4 source；exact replay idempotent，同 query different rows 不被 generic source-ref 去重。
8. Harden coordinator search/Issue/handoff routes：`UserAuthProvider` first、移除 body/header identity/path authority、production generic path gate、`for-ifc-ready` table-only。
9. 以 live session-bound Console 取代 fixture，加入全部 states、partial confirmation、proof-expiry draft recovery、transient handoff 與 viewer bridge；Console 不內嵌 WebRTC。
10. 與 `migrate-console-to-hifi-design` 協調 final baseline owner，最後一次 visual migration 後 re-approve/rebaseline 並跑雙 viewport gates。
11. 驗 shared authentic lease／terminal rejection dependency 已由獨立 owner 交付，再跑 handoff integration、browser E2E 與 real Kit evidence；A4 branch 不修改 shared producer。
12. Tracked credential rotation/revocation 經 owner 確認後，跑 config-driven sanitized live Ornith smoke；只有適用 gates 全過才標 semantic/full completion。
13. Archive 前確認 A4 只修改三個無 overlap capabilities，更新 `edge-console-operator-frontend` base Purpose，不修改 `unified-governance-console`。

### 回滾

- UI MAY revert 到 prior component，但 rollback state MUST 標 partial/roadmap，MUST NOT 把 misleading compliance copy 還原成 live evidence。
- Additive Issue columns/table MAY 保留 unused；rollback 不得 drop data。
- Coordinator MAY disable A4 session route，但 MUST NOT 重新開 browser-controlled host path fallback。
- A4 handoff route MAY 獨立 disable 並保留 honest table/Issue；不得把 unverified prim/proof 放 URL 或讓 Console 直接送 DataChannel。
- Live Ornith failure 只 rollback semantic-completion status；deterministic/confirmed partial table MAY 誠實保留。
- Production transport/auth/shared-runtime dependency 未過時 SHALL fail closed；不得改用 lab HTTP/local-dev identity 冒充 production readiness。

## 開放問題

- Implementation MAY 選 additive JSON column 或 normalized child table 保存 `a4_evidence_snapshot`；選擇必須保留 immutability、schema versioning、atomic Issue creation 與 DB compatibility。
- Sanitized evidence artifact 的 exact path/name 應遵守 implementation 時 repo evidence convention；required fields 已由 D9 固定。
- Hi-Fi migration 的 final A4 baseline owner 與 C-M4 後續 shared hardening owner 必須在 A4 archive 前確認；這是 sequencing prerequisite，不是 unresolved product behavior。
