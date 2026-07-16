## 1. HTML source contract

- [ ] 1.1 以 `git ls-files -- 'docs/plans/*.html'` 建立唯一 source set，為每份 HTML 定義 stable `source_id`、`source_role`、版本與 normalized contract；禁止 repo 外 fallback
- [ ] 1.2 在 `AI-BIM 前後端設計文件.dc.html` 提供可確定性抽取的 canonical routes、legacy redirects、live／concept／not-built provenance 與 backend boundary
- [ ] 1.3 在 `AI-BIM Console Hi-Fi.dc.html` 提供 stable screen/state IDs、semantic actions、viewport eligibility 與 dynamic-region metadata
- [ ] 1.4 更新 `docs-plans-README.md`、AGENTS／workflow 入口，明定所有 tracked HTML 是 design gate 唯一權威，manifest／goldens 只是衍生物

## 2. Derived manifest and baselines

- [ ] 2.1 建立versioned `scripts/config/design-gate-policy.json`，由它裁決threshold、runner、viewports、status enum與full-completion rule；manifest v2分離 `design_sources[]`、`render_dependencies[]`、`route_inventory[]`、`screens[]`，並只複製policy fields與digest
- [ ] 2.2 從 HTML 重建 canonical route inventory；移除以舊 `#home`／`#a1..a10` route 作 production authority 的 mapping
- [ ] 2.3 從 Hi-Fi HTML 在固定 Windows／Chromium 環境重拍兩個 viewport goldens，並原子更新 source、contract、asset、font、runner 與 aggregate digests
- [ ] 2.4 更新 capture／rebaseline tool，只能從 current checkout tracked HTML 產生 reference；source drift、untracked source 或無法追溯 field 一律 fail closed
- [ ] 2.5 pin 並 machine-verify resolved npm dependency snapshot、Windows runner image、browser 與 font fingerprints；完成前 `full_completion_allowed=false`

## 3. Machine gates

- [ ] 3.1 更新 schema validator、negative tests 與 independent PNG recomputation，驗證所有衍生 field 能回溯至 HTML source
- [ ] 3.2 將 changed-path classifier、PR body validator、local preflight 與 CI 接到較嚴格的 base/head HTML-derived manifest union
- [ ] 3.3 由 HTML-derived semantic contract 實作 branch-protected Playwright cases；missing、skipped、blocked 或 case set drift均 fail closed
- [ ] 3.4 維持 pixel threshold `<=0.01`、semantic 100%，並保留 functional/runtime E2E 為另一個 required gate
- [ ] 3.5 對 `passed`／`mixed`／`partial_reference_missing`／`design_source_update_only`／`gate_infrastructure_only`／`design_source_and_product_mixed_fail_closed`／`unknown_fail_closed` 建立fixtures與regression tests，證明missing或non-product scope不能宣告full completion
- [ ] 3.6 將 lineage Alignment／Attempts／Audit 等 HTML 未涵蓋 surface 列為 `reference_missing`；HTML 更新前不得由 manifest 自行核准
- [ ] 3.7 在 current subject gate 可執行且綠燈後，才更新 branch-protection required contexts並回讀遠端設定，避免 expected-context deadlock
- [ ] 3.8 建立獨立source-update/rebaseline lane；同一change觸及tracked HTML與production UI時fail closed並要求split，production gate只能比較已落地主線的HTML snapshot

## 4. Functional and runtime evidence

- [ ] 4.1 建立 branch-protected functional/runtime producer＋validator，涵蓋 canonical route、主要 action、fixture、real API、loading/success/failure/retry 與 domain/runtime ID
- [ ] 4.2 對適用 route 補 Kit first-frame、stage 與 DataChannel ack；live frame 不進 design pixel comparison
- [ ] 4.3 更新 PR machine fields，分開呈現 HTML source、visual result、semantic result、functional/runtime result、missing scope 與 full-completion claim

## 5. Source convergence and closeout

- [ ] 5.1 移除 active docs、scripts、workflow 與 OpenSpec 對外部 `desigin-system`、已刪七檔、legacy prototype authority 或 arbitrary screenshot 的依賴
- [ ] 5.2 以 strict OpenSpec、schema/negative tests、visual gate、functional browser E2E 與 `git diff --check` 驗證整體 change
- [ ] 5.3 僅在 1.1–5.2 完成，或未完工作已拆到不重疊 successor change 後 archive，讓 canonical capability specs 落地
