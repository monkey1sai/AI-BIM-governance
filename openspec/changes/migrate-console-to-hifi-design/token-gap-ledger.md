# Hi-Fi token-gap ledger — current-main reconciliation

## Scope and immutable anchors

- Current main: `008acb6f5658e1a759616f38dfbde9f7bedd1567`
- Initial convergence analysis base: `64cadb06c8eba6400aecb8f75125dd2f7df2e1b7`（兩者只差 `docs/evidence/pr-398-test-deploy-risk-verification/README.md`，CSS/product blobs 未變）
- Current canon CSS blob: `78c23c936f530b2938520f05588d114dd9b230ab`
- Legacy checkpoint: `94a557571c25fe6e058251d39e3dad139eb65bf3`
- Legacy canon CSS blob: `2abb09ebe78a2929ce47bdefa1b3226448b21b6e`
- Legacy merge-base: `e43e01f225fae6ed1d71ef240c219917a43939a5`

本 ledger 只調和現況與候選設計，不是 merge 證明，也不是使用者對手寫正本的核准。受保護的 `docs/plans/ai-bim-governance.css`、兩份 `.dc.html` 與 `docs-plans-README.md` 均未修改。

## Verified current-main state

- `EdgeConsole.tsx` 已真實 import `../../../docs/plans/ai-bim-governance.css` 與 `legacy-console.css`。
- `web-viewer-sample/src/console/edge-console.css` 已不存在。
- 排除 tests/specs 後，`web-viewer-sample/src/console` 沒有 production `--ec-*` 消費。
- PostCSS parser 對 current canon 得到 86 個 unique `--ab-*` declarations、對 legacy checkpoint 得到 179 個，差集為 93 個；兩檔均無同名重複 declaration。
- 93 個 legacy-added declarations 在 current-main console consumer 中的引用數為 0；因此不能以舊 consumer tree 的使用情況推定 current main 全部需要。
- Legacy consumer 相對 current canon 共缺 94 個名稱：93 個是本 draft 保存的候選；`--ab-not-real` 只位於 `design-token-source-guard.test.ts` 的負向測試 fixture，不是第 94 個待新增 token。`--ab-ok-text` 與 `--ab-violet-text` 已在 current canon 同一行的第二個 declaration 定義，不是缺口。

## Legacy proposed declaration census

| Category | Count | Initial disposition |
|---|---:|---|
| literal spacing | 16 | `user-decision`: prefer consolidation where an existing semantic scale is equivalent |
| radius | 6 | `user-decision` |
| font size | 15 | `user-decision` |
| font weight | 5 | `user-decision` |
| line height | 5 | `user-decision` |
| letter spacing | 8 | `user-decision` |
| color/alpha/transparent | 38 | `user-decision`: semantic reuse before alpha proliferation |
| **Total** | **93** | proposal only; none adopted |

Exact names and CSS-equivalent values are preserved in `drafts/ai-bim-governance.token-extension.proposed.css`. The draft is not imported and must not be copied into the protected canon without recorded user approval.

## Existing-token consumer slice assessment

Legacy commits also contain style-only replacements that use tokens already present on current main. They are not applied in this reconciliation because current blast-radius gates are not uniformly safe:

| Symbol | GitNexus risk | Disposition |
|---|---|---|
| `A1GovernanceWorkbenchPage` | HIGH | candidate only after explicit warning, strengthened regression plan, affected tests + visual gate |
| `ProvLegend` | LOW | candidate after affected tests + visual gate |
| `ConversionPage` | HIGH | requires explicit warning and strengthened regression plan |
| `GovernanceOverlay` | LOW | candidate after affected tests + visual gate |
| `LifecycleStrip` | CRITICAL | blocked pending user sign-off |
| `MinioTreePane` | LOW | candidate after affected tests + visual gate |
| `ObjectDetailPane` | LOW | candidate after affected tests + visual gate |
| `ReviewSessionViewerPane` | HIGH | blocked; legacy file also mixes session payload changes that must not be ported |
| `StreamConfigReader` | LOW | candidate after affected tests + visual gate |
| `SpatialTreeView` | LOW | candidate after affected tests + visual gate |

The exact index used for this assessment was rebuilt from the fresh convergence worktree. The table records the conservative production-only (`includeTests=false`) result: `A1GovernanceWorkbenchPage`, `ConversionPage`, and `ReviewSessionViewerPane` each affected three indexed processes; `LifecycleStrip` affected five. Including tests changes caller counts and can lower the tool's risk heuristic, so it is not used to downgrade the production gate.

## Excluded legacy bundle content

The two legacy commits are not a safe cherry-pick unit. They combine protected canon edits, machine reference changes, 15 user-facing PNGs, frontend product code/tests, OpenSpec artifacts, dependency metadata, and session-contract changes. In particular, the legacy `ReviewSessionViewerPane` tree differs from current main around `user_id` and local-dev carrier behavior; only four visual hunks were identified, but none are applied here.

## Acceptance boundary

This proposal-only slice is complete when OpenSpec strict validation and `git diff --check` pass. It does **not** satisfy the product change's visual, semantic, browser, version/date, backup, restore, rebaseline, or full-completion gates.
