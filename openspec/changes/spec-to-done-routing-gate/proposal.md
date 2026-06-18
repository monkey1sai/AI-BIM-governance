## Why

spec-to-done 流水線的 model/effort 路由原本散落 `std-plan.js`/`std-implement.js`/`std-evidence.js` 各檔字面值（實測 16 處 `max`、0 處 `xhigh`，難度差異只靠 model、未靠 effort 分流），易漂移、無防呆，且 routing 是散文不是可驗證的 source of truth。本變更（對應 PR-A `spec/hexagon-harness-upgrade`）把路由收斂成單一真相 `routing.json` + Python codegen + 確定性 pytest gate，並把唯一降階（plan 作者 `xhigh`）做成 flag、預設關（零行為變更）。屬 ai-coding-governance「可審查、可回滾、可驗證自動化閉環」maturity gate 的 harness 自身治理。

## What Changes

- 新增 `.claude/workflows/routing.json`（四層 canonical：`extract{haiku,no-effort}` / `standard{sonnet,max}` / `reason{opus,xhigh}` / `judge{opus,max,immutable}` + `allowed_efforts` + `do_not_codegen`）。
- 新增 `scripts/gen_routing.py` codegen：把 routing.json 生成進各 `std-*.js` 的 `// <routing:gen>` 標記區塊；`--check` 模式做確定性 drift 偵測；驗證 effort 合法性；judge 層 immutable 只驗不覆寫；尚未加 marker 的 target 跳過（增量 wiring）。
- `std-*.js` 的 `agent()` opts 改引用 inline `...ROUTING.<tier>`（codegen 生成）。唯一值變更＝plan 作者 `max→xhigh`，由 `flags.plan_author_xhigh`（預設 `false`）控制 → 預設零行為變更。
- `do-not-codegen` 保留三 literal（`impl:${T}` computed `model: implModel`、`impl:${T}:retry`、`impl:${T}:opus` 失敗補救升級 opus/max）。
- 新增 `tests/{test_routing_json,test_gen_routing,test_routing_consistency}.py` 三組確定性測試；修 3 處 legacy `Claude Fable 5` commit trailer → `Claude Opus 4.8 (1M context)`；清 untracked throwaway 研究 workflow；`SKILL.md` 加 codegen operator step。
- M14（Haiku 直出 risk_level）N/A：Haiku `extract` 層僅 `parse:plan`/`probe:engine`，impact/risk_level 全走 GitNexus(sonnet)，無此路徑（YAGNI）。

## Impact

- Affected specs: `ai-coding-governance`（ADDED：harness routing single-source-of-truth + 確定性 drift gate + flag-gated 降階 + do-not-codegen 護欄）。
- Affected code: `.claude/workflows/`（routing.json + std-*.js）、`scripts/gen_routing.py`、`tests/`、`.claude/skills/spec-to-done/SKILL.md`。
- 不碰 product runtime（`bim-review-coordinator` / `web-viewer-sample` / `bim-streaming-server`）；flag off 零行為變更；判斷層（judge）effort 不降（安全邊界）。
- userFacing: false（純 harness / CI 路由治理，無前端 surface）。
- 風險：routing 接線為行為等價 refactor（flag off 逐站值不變，已由 opus whole-branch review 逐一確認）；漂移由確定性 pytest gate 鎖；本機 `npx openspec` CLI 故障，validate 依賴 CI。
