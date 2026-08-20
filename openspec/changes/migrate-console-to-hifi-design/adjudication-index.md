# Hi-Fi convergence adjudication index

## Recorded owner rulings（2026-08-20 grill-with-docs）

Authority：`docs/plans/docs-plans-README.md` §3 R1＋`design-canon-change-control` R-A1。AI 不得寫入 `docs/plans/*.dc.html`、`docs-plans-README.md`、`ai-bim-governance.css`。

| ID | Ruling | Binding effect |
|---|---|---|
| HIFI-01 | **拒絕** 93 個 legacy-only declaration。維持 current canon 86 個 `--ab-*`。 | 不得把 `drafts/ai-bim-governance.token-extension.proposed.css` 合併或抄進正本。task 1.2 = won't-add。 |
| HIFI-02 | **允許元件本地 geometry**。無跨頁語意重用的 spacing／radius／字級／letter-spacing 可留在元件。 | 禁止為單一 literal 新開 `--ab-*`。 |
| HIFI-03 | **四個都不放行**：`LifecycleStrip`（CRITICAL）、`A1GovernanceWorkbenchPage`、`ConversionPage`、`ReviewSessionViewerPane`（HIGH）。 | No product edit。不得 cherry-pick `94a5575` 的 style／session-payload diff。 |
| HIFI-04 | **本 change 不再做 consumer 打包遷移**；以後若開 visual 工作，一律單一 route／screen 切片。 | 本 change 剩餘＝2.8／3.7 E2E。6.4／7.4 = deferred-this-change。 |
| 6.4 | **deferred-this-change**：本 change 不執行 origin↔`docs/plans/` 正本對齊。 | checkbox 維持未勾；不擋 2.8／3.7；下次 human 改 Hi-Fi 正本時再做 R-A4。 |
| 7.4 | **deferred-this-change**：本 change 不收 9 STALE + 6 UNVERIFIABLE。 | 8 條措辭 STALE → spec-alignment successor；3D 標紅 → #603；6 UNVERIFIABLE → 部署 E2E 窗。checkbox 未勾。 |

## Decisions reserved for the user

| ID | Decision | Evidence | Status |
|---|---|---|---|
| HIFI-01 | 93 legacy declarations：adopt／consolidate／reject | `token-gap-ledger.md`；parallel CSS draft | **recorded 2026-08-20：reject** |
| HIFI-02 | 每個 literal geometry 必須變 token，或可留元件本地 | Existing delta 嚴於 current canon | **recorded 2026-08-20：allow component-local geometry** |
| HIFI-03 | 放行 CRITICAL／HIGH consumer 遷移？ | GitNexus impact table in ledger | **recorded 2026-08-20：no sign-off** |
| HIFI-04 | consumer migration 按 route 切片或打包？ | dual-gate／R4 | **recorded 2026-08-20：no bundled consumer migration; future visual = single route** |
| 6.4 | 是否由 human owner 同步 `C:\Repos\design\desigin-system` 與 repo `docs/plans/` 正本 | R-A1／R-A4 backup＋version bump | **recorded 2026-08-20：deferred-this-change**（本 change 不執行；checkbox 未勾） |
| 7.4 | 9 STALE spec 改文件，或補 Kit 3D 標紅；6 UNVERIFIABLE 是否另開部署 E2E | `artifacts/2026-08-12-hifi-consumer-spec-scenario-audit.md` | **recorded 2026-08-20：deferred-this-change**（本 change 不執行；checkbox 未勾） |

## Required adoption sequence

1. ~~User records decisions HIFI-01 through HIFI-04.~~ **Done 2026-08-20**（本檔上表）。
2. AI keeps the canon proposal in parallel draft form and does not modify the protected file in place. Draft 僅歷史提案，不是待合併清單。
3. Only the human owner performs any approved canon adoption and records version/date bump, backup path or tag, and restore dry-run evidence; approval alone does not grant AI protected-canon write authority. HIFI-01 拒絕採納，故本 change **不啟動** canon 寫入。
4. Frontend consumer work reruns GitNexus impact against its then-current base. HIFI-03／04：本 change **不啟動** consumer 遷移。
5. Each affected route runs typecheck, unit tests, browser operability, semantic cases, and applicable 1440x900/1920x1080 DPR1 visual gates.
6. Rebaseline uses only `capture-design-system-reference.mjs --rebaseline --confirm-rebaseline`; no manual manifest or PNG replacement.

## Explicit non-decisions

- OpenSpec strict validation does not approve token values or prove current factual accuracy.
- The legacy branch being clean does not make its mixed bundle mergeable.
- A CSS draft with zero current consumers does not authorize modification of the protected canon.
- This reconciliation does not claim full Hi-Fi migration, visual fidelity, or user-facing completion.
