> **Status: deferred 2026-07-29**（使用者裁決）。不計入 active WIP。
>
> **理由**：2026-07-29 收斂盤點實測，本 change 的實作已在 `origin/main` 與 `codex/openspec/a4-semantic-search-model-qa-convergence` 之間**雙向分岔**，任一側都不是完整實作：前端 live session-scoped Console 只在 convergence 分支（`A4SemanticSearchPage.tsx` 938 行 vs main 458 行 fixture 版），後端 deterministic engine／proofs 與 3D handoff 只在 main（`engine.py` 1160 vs 915、`proofs.py` 623 vs 356；6.3–6.5 僅 main 已勾）。實測 `merge origin/main` 產生 **126 個衝突 hunk／23 檔**。同時本 change 剩餘 21 項有多項受外部條件封鎖：1.8 需 credential owner 協調 rotate、7.4／7.5 需 Windows host-native Kit 與 authorized Ornith lab、8.7 需獨立 reviewer。傘型 change 在此狀態下無法一次收斂。
>
> **重啟條件**：(1) successor change `a4-console-convergence` 完成前後端收斂並 merge，使單一 canonical A4 實作存在於 `main`；(2) credential owner 完成 1.8 rotate；(3) Windows host-native Kit 與 authorized Ornith lab 環境就緒可跑 7.4／7.5；(4) 取得 8.7 獨立 review 資源。四者齊備後 thaw，並先與 successor 做 Requirement crosswalk 再續接剩餘 task。
>
> **Successor crosswalk**：`a4-console-convergence` 承接本 change 的 5.1／5.2（已在 convergence 分支落地但未進 main）與 5.3／5.6／8.3／8.4，並沿用 Requirement 名稱「Canonical A4 UI SHALL 可操作且接受誠實的 design gate」以利 crosswalk；其餘 Requirement 與 task 仍屬本 change，不得平行實作。

## Why

目前核可的 `#/workspace?dock=a4` 仍以固定假資料呈現，真實 A4 API 則停留在另一個未收斂的頁面；介面同時把「符合查詢條件」誤寫成「符合規範」，且 production proxy 仍可接受瀏覽器提供的 host 路徑。現在需要一份 session-bound、可追溯且不冒充法規判定的 A4 v1 契約，讓既有 deterministic IFC search、Ornith query interpreter、Evidence Trace 與 3D highlight 成為同一條可驗收流程。

## What Changes

- 新增 A4 v1 端到端能力：自然語言查詢先解析為受 schema 驗證的 JSON filters，再由 deterministic IFC scanner 執行；結果提供 `query_id`、interpretation source、structured Evidence Trace、mapped/unmapped/truncated counts，且只表達「符合查詢條件」，不作 compliance judgement。
- 將 `#/workspace?dock=a4` 從 fixture/roadmap 收斂為唯一核可的 live A4 Console 操作面，補齊 loading、empty、error、retry、degraded、Issue draft、3D handoff 與可驗證 provenance；舊 `#a4` / `#/a4` / `#semantic-search` 入口只做相容轉址或移除，不保留第二套實作。
- A4 完整 DoD 綁定 active Review Session；coordinator server-side resolve IFC、mapping、model version 與 stage。`for-ifc-ready` 保留為 table-only 相容入口，但不構成 3D/full completion。
- **BREAKING**：production browser 不再能向通用 `/api/governance/search/model` 提交 `ifc_source_path` 或 `element_mapping_path`；production UI 必須使用 session-scoped route。通用 route 僅可留給受控內部／測試用途或明確停用。
- `auto` mode 只在 deterministic candidate 為 `schema_valid=true`、`complete=true`、`usable=true` 時直接執行；否則 SHALL 呼叫 Ornith。任何 mode 預設只有完整且可用的 candidate 才可驅動 IFC scan。Ornith timeout、contract error、schema-invalid、`complete=false` 或 `usable=false` SHALL 回傳可見且可重試的錯誤，SHALL NOT 靜默執行 partial deterministic filters。若 `auto` 仍有 `schema_valid=true`、`complete=false`、`usable=true` 的 deterministic candidate，系統 MAY 提供顯示 exact filters 與 `unresolved_terms` 的二階段 partial fallback confirmation；只有使用者另次明確確認後才可執行，且結果 SHALL 標為 `partial_table_only`、`degraded_to_deterministic=true`，不得產生 Issue／3D eligibility 或宣稱 semantic/full completion。
- Console 不新增 WebRTC。Primary 使用者點 mapped row 時建立短效、session/actor-bound focus handoff，明確 Highlight 按鈕則建立多列 handoff；兩者都經 `/ui/open?session=` 進入既有 session viewer 後才送 DataChannel command。A4 只消費 shared owner 已正式提供的 terminal result/rejection 並沿用既有 `request_id` 做 correlation；若 authentic lease 與可信拒絕證據尚未由 shared capability 交付，A4 3D/full completion SHALL 為 `no`，本 change 不新增 shared event/schema/producer。
- A4 可由使用者勾選結果後建立可編輯的 Issue draft；送出前必須確認，並以短效 server-verifiable row evidence proof 保存 `source_type=a4_search`、`source_ref=query_id` 與 structured evidence snapshot。不得因 query match 自動建立 Issue 或 BCF，browser 自造 query/evidence payload 不得取得 A4 provenance。
- semantic completion 新增一個經 coordinator 的 live lab `Ornith-1.0-35B` smoke gate，只記錄去識別化 evidence；CI 維持 deterministic 與 mocked-model tests，不保存或輸出 token。任何已確認曾出現在 A4/Ornith tracked sample 的實際 credential 必須由 owner 協調 rotate/revoke，該 sample 只留 placeholder，否則 semantic/full completion 不得通過。
- A4 v1 不新增 persistent query-history DB；`query_id` 僅作 request/trace correlation，當前結果與 3D handoff intent 只在 browser/coordinator 的短效 session memory 保留，Issue 只複製被選取的 query/filter/evidence snapshot。
- 需要重新核可並 rebaseline `workspace.a4.default`，仍須通過 repo-pinned Windows Chromium DPR1、1440×900 / 1920×1080、pixel diff ≤1% 與 Playwright semantic 100% gate。

### 非目標

- 不產生自然語言答案，不加入法規 RAG／法條 citations，不宣告模型或構件符合／不符合規範。
- 不建立 query-history、RBAC、retention policy 或 analytics persistence。
- 不自動建立 Issue／BCF，不改變 Issue 既有狀態機，也不讓 coordinator 或瀏覽器成為 IFC／governance 資料權威。
- 不把 WebRTC/video/DataChannel runtime 內嵌進 Unified Console；3D 一律沿用既有 `/ui/open?session=` viewer handoff boundary。
- 不把 Ornith token、live model endpoint 或 lab availability 帶入 CI artifact、browser bundle、log 摘要或 committed fixture。

## Capabilities

### New Capabilities

- `a4-semantic-search`: 定義 session-scoped query interpretation、deterministic IFC search、Evidence Trace、honest result semantics、transient Console-to-viewer 3D handoff、explicit focus/highlight、model QA gate 與 A4 user-facing DoD。

### Modified Capabilities

- `edge-console-operator-frontend`: 將 A4 從 A4–A10 整段 roadmap 中移出，改為真實可操作頁；A5–A10 仍維持誠實 roadmap。
- `governance-issue-tracking`: 新增由 A4 使用者確認後手動建立 Issue 的 query/evidence provenance 契約，不改既有 rule-run/diff source semantics。

## Impact

- **Owning folders**：`governance-service/search/`（filter interpretation、deterministic search 與 signed row proof authority）、`governance-service/issues/`（Issue provenance persistence）、`bim-review-coordinator/src/app.ts`＋`src/routes/governanceProxy.ts`（session/stage resolve、短效 3D handoff、production path boundary）、`web-viewer-sample/`（canonical A4 Console、session viewer handoff/mapping、DataChannel interaction、E2E）、`docs/plans/` 與 design baselines（驗收對齊）。
- **API / data**：收斂 `POST /api/governance/search/model/for-session/:sessionId`；保留 `for-ifc-ready/:jobId` table-only；回應需有可驗證 query/interpretation/degradation/evidence、sanitized session binding、mapping status 與 highlight-eligibility 欄位。3D 經短效 coordinator handoff 進入 session viewer，實際 highlight ack 仍屬獨立 DataChannel evidence；A4 Issue 改走 session-scoped coordinator route，增加 source reference、含 primary artifact/active binding revision 的完整 snapshot hash、server-verifiable row proof 與 structured evidence snapshot。
- **Session / runtime**：完整流程依 active Review Session、server-resolved artifact/mapping/stage 及 primary viewer authority；highlight 經既有 WebRTC DataChannel，coordinator 僅做 session/control-plane resolve，不成為 IFC search 或 Issue authority。
- **Dependency / operations**：Ornith 是可選的 query interpreter 與 live-lab gate，不是 BIM／法規 truth，也不是 CI 必需依賴；exact local-lab location 與 credential source 是 operator-owned out-of-repo input，SHALL NOT 記錄在本 change。Runtime SHALL 由明確 server-side configuration 解析 URL/model/profile，token 僅由獨立 secret injection 載入；production semantic traffic SHALL 使用 TLS／mTLS／受信 tunnel，明文 HTTP 僅限明確 lab profile 與非敏感資料。
- **Active-change coordination**：本 change 不再修改 `unified-governance-console`；`align-frontend-design-system-reference` 已於 2026-07-24 historical correction 恢復為 `Status: deferred` 的 frozen change，其 retained delta 非 canonical authority，亦不形成目前 capability owner；完成與 `migrate-console-to-hifi-design` 的 requirement/successor crosswalk 前不得 thaw。`migrate-console-to-hifi-design` 仍會重做包含 `workspace.a4.default` 的全域 baseline，必須指定 final A4 golden owner 並在最後一次視覺遷移後重跑 A4 semantic/visual gates。`c-m4-runtime-command-bridge` 及其後續 shared hardening change 擁有 mutator authorization／terminal rejection boundary；A4 只把 authentic lease 與可信 rejection 當作 full-completion dependency，不在本 change 修改 shared protocol producer。
- **Boundary preservation**：governance-service 保有 search/Issue authority，coordinator 只 resolve/forward，streaming server/Kit 保有 runtime command authority，browser 不接觸 host path、mapping path或 model token，外部 cloud/IFC Worker 邊界不變。
