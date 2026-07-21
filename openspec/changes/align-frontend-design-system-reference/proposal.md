# 變更：以docs/plans HTML重建前端設計權威與雙閘門

> **Status: deferred-proposed 2026-07-21**（併入 `governance-throughput-budget` 審批，非已生效裁決。理由：WIP 收斂——本 change tasks 0/23 未動工；specs delta 已由 #363（PF-3 reconcile）調和至 doc-first，deferred 不損失該調和成果。重啟條件：active change ≤2 有額度；重啟時須重跑 `npx openspec validate align-frontend-design-system-reference --strict` 確認 delta 仍對準當時 main spec，漂移則先 rebase 再動工。本註記只加不改原內容；使用者否決 defer 即撤下本註記。）

## Why

2026-07-14～2026-07-15 的設計文件整併後，repo 已由兩份 Git-tracked `docs/plans/*.html` 承接設計與規格；但現行 active change、manifest、route inventory 與 capture flow 仍引用外部 `C:\Repos\design\desigin-system`、已刪除文件或舊 hash routes。這會形成平行 design authority，也無法證明每個 screen、state、route 與 golden 都可從目前 checkout 的 HTML 重建。

## What Changes

- 將目前 checkout 中所有 Git-tracked `docs/plans/*.html` 定義為 design gate 的唯一權威輸入。現有集合為：
  - `AI-BIM 前後端設計文件.dc.html`：服務邊界、canonical route/IA、API 與交付語意。
  - `AI-BIM Console Hi-Fi.dc.html`：2D chrome、layout、screen、component 與互動 state 視覺。
- 將 `design-system-reference.manifest.json`、route inventory、screen/state IDs、semantic cases、golden baselines 與 visual result 定義為可重建、可驗證的衍生 artifacts；它們不得新增、覆寫或凍結 HTML 未定義的設計需求。Threshold、runner、status enum等 engineering policy由versioned repo policy裁決，manifest只記錄policy digest。
- 移除 design gate 對 repo 外絕對路徑、任意 screenshot、PR prose 或人工 boolean 的 authority／fallback。
- 將 visual fidelity gate 固定為 Windows runner、Chromium、DPR1、`1440x900` 與 `1920x1080`、每 viewport pixel diff ratio `<=0.01`，且 required semantic cases 100%。
- 由 changed paths 與 base/head 的 HTML-derived scope 聯集機器推導 product `passed`／`mixed`／`partial_reference_missing`，以及 non-product `design_source_update_only`／`gate_infrastructure_only`；同一 change 同時修改 authority HTML與production UI時為 `design_source_and_product_mixed_fail_closed`。Unknown、source drift、HTML-derived field 無法回溯至 HTML、policy-derived field 無法回溯至 versioned policy path/digest，或缺少衍生 artifacts 時 fail closed。
- 將 design fidelity 與 functional/runtime E2E 維持兩個獨立且均必要的 gate；HTML 正本為需求權威（doc-first），code＋tests／runtime evidence 為建成現況查證面（現況證據，非需求權威）。
- RVT↔IFC↔USDC lineage 新增的 Alignment、Attempts、Audit 等 surface，在 HTML 尚未定義前必須是 `reference_missing`，不得由 manifest 自行升格為 approved。

## 權責歸屬

- `docs/plans/*.html`：需求權威正本（doc-first），亦為 design gate 唯一權威輸入。
- `docs/plans/docs-plans-README.md`：人類導覽與權威分工入口，不是另一份設計稿。
- `docs/plans/design-system-reference.manifest.json` 與 baselines：從 HTML 產生的 machine snapshot。
- `web-viewer-sample/`：subject capture、semantic Playwright 與 frontend operability evidence。
- `scripts/tests/`、`.github/`：衍生物驗證、PR／merge gate 與 fail-closed policy。
- `openspec/`：capability delta 與待實作工作。

## 邊界影響

不變更 public API、event、DB schema、MinIO layout、session/conversion lifecycle、backend authority、Kit/WebRTC protocol 或 GPU ownership。前端仍只打 coordinator `:8004`。HTML 內的 demo API、fixture 數字與 roadmap state 不得覆寫 code、tests/contracts 或 runtime truth。

## 本次重建範圍

本次交付只重建 proposal、design、delta specs與implementation tasks，不重拍 golden、不改 production frontend、不聲稱現行 gate已通過。整個 OpenSpec change的 eventual apply scope則包含tasks列出的HTML metadata、derived artifacts、machine gates與functional/runtime evidence。

## 非目標

- 本 change 不讀取、回寫或要求存在任何 repo 外 design workspace。
- 不在本 change 擴充 Kit OpenUSD Web Viewer 或 OpenUSD extensions。
- 不以 design screenshot 取代真 IFC、Kit first-frame、stage truth 或 DataChannel ack。
- 不對 live WebRTC/GPU frame做 `<=0.01` pixel assertion。
- 不偽造 HTML 尚未提供的 semantic variants、lineage screen 或 route。
