# Tasks：align-html-derived-design-gate-contract

每個 checkbox 都是獨立的 future commit＋push boundary；每項必須能在單一 session 完成、取得獨立驗證結果，且不得與其他項目重疊。

Scope guard：任何 task 都不得修改 HTML 內容、manifest、golden、baseline、capture script、rebaseline 行為、production UI、runtime、API、data/event、storage 或 session/conversion 行為。

## 1. Closed policy 與 ref-bound source collection

- [ ] 1.1 新增 closed-schema `scripts/config/design-gate-policy.json`，登錄 `ai-bim-frontend-backend-design` → `docs/plans/AI-BIM 前後端設計文件.dc.html` → `architecture_behavior` 與 `ai-bim-console-hifi` → `docs/plans/AI-BIM Console Hi-Fi.dc.html` → `console_hifi_visual`；複製目前已驗證的 Windows/Chromium、`windows-2025`、Node `20.20.2`、npm `10.9.4`、Playwright `1.61.1`、Chromium revision `1228`／version `149.0.7827.55`、DPR1、`1440x900`／`1920x1080`、`zh-TW`、`Asia/Taipei`、fonts-ready、animations-disabled、pixelmatch `0.1`、anti-aliasing excluded、max diff ratio `0.01`、semantic parity `1.0` 與 full-completion policy；以 schema fixtures 驗證 missing/unknown key 失敗，且 policy 不含自我參照 `policy_digest`。
- [ ] 1.2 實作 ref-bound source collector：current checkout source set 以 `git ls-files -- 'docs/plans/*.html'` 定義，base/head 則以等價 Git tree query 解析；對 raw Git blob bytes 計算 SHA-256，驗證 stable source ID、unique role、base-only deletion visibility，並以 tests 拒絕 external、origin-projected、untracked 與 ignored HTML。

## 2. Provenance registry 與 negative fixtures

- [ ] 2.1 實作 typed field-level provenance registry validator，讓 HTML-derived 與 policy-derived field 透過 `provenance_id` 可回溯至 source path/role、ref、commit、raw-blob digest、policy path/key/digest、semantic locator 與 extractor/schema version；missing、unknown、stale、drifted、dangling、wrong-kind、role-inconsistent 或 policy-digest-mismatched record 必須得到 `unknown_fail_closed`。
- [ ] 2.2 在 `scripts/tests/` 新增互不重疊的 negative fixtures，覆蓋 missing/external/untracked/ignored/role-ambiguous/renamed/deleted source、digest drift、policy mismatch、missing locator、dangling provenance、unknown path 與 incomplete evidence；逐一比對 exact failure/status、證明沒有 fixture 產生 `passed`，並以 excluded-file guard 證明未修改 manifest、golden、baseline、capture 或 rebaseline 檔案。

## 3. Base/head classifier 與 atomic status migration

- [ ] 3.1 擴充 `scripts/lib/design-system-gate.ps1` 的 base/head source＋manifest union classifier，保留 base-only mappings，並實作 current `mixed` 語意、`partial_reference_missing`、`design_source_update_only`、`gate_infrastructure_only`、source＋product fail-closed、backend-only `not_applicable` 與 invalid-input `unknown_fail_closed` precedence；以 focused scope tests 驗證每條分支。
- [ ] 3.2 在單一 atomic task 將 producer 與所有 direct status consumers/fixtures 收斂為恰好八值 `passed`、`mixed`、`partial_reference_missing`、`design_source_update_only`、`gate_infrastructure_only`、`design_source_and_product_mixed_fail_closed`、`unknown_fail_closed`、`not_applicable`；移除並拒絕 `reference_authority_mixed_fail_closed` 及任意 unknown value，建立八值 exact-equality fixtures，且不得同時接受新舊名稱。

## 4. Typed consumers 與 verification gates

- [ ] 4.1 將已驗證的 typed policy/provenance/classifier output 接入 PR-body validator、local preflight、gstack evidence hook 與 visual-result verifier；consumer 不得自行 rediscover source、覆寫 status 或以 PR prose 補 evidence，並以 consumer tests 證明 design fidelity 與 functional/runtime evidence 仍互相獨立。
- [ ] 4.2 執行 affected design-gate/reference/scope/PR-body/visual-result tests、provenance/status fixtures 與 `npx --no-install openspec validate align-html-derived-design-gate-contract --strict`；驗證 `passed` 只提供 full-completion eligibility、仍不足以取代適用的 semantic、visual、functional、runtime 與 independent E2E evidence。
- [ ] 4.3 執行 `gitnexus detect-changes --scope compare --base-ref main` 與 final excluded-file diff guard，證明 diff 僅限 design-gate governance、`scripts/`、`scripts/tests/` 與本 change artifacts；本 governance-only scope 的 GPU、Kit、WebRTC、first-frame、stage 與 DataChannel 驗證記為 `N/A` 而非 runtime/product pass，任何 excluded path 變更都必須停止並另開 successor。
