# Tasks — spec-to-done-routing-gate（PR-A routing 脊椎）

對應 plan `docs/superpowers/plans/2026-06-18-routing-spine-pr-a.md`（8 task）+ spec `docs/superpowers/specs/2026-06-18-hexagon-harness-upgrade-design.md`。狀態依 PR-A 實際實作勾選。

- [x] 1. P0 baseline 模板（`artifacts/self-evolve/baseline.md` + clean-HEAD 記錄）。
- [x] 2. `.claude/workflows/routing.json` 四層 canonical 表 + `tests/test_routing_json.py` schema 測試（TDD）。
- [x] 3. `scripts/gen_routing.py` codegen 核心（validate / render_block / apply / `--check`）+ `tests/test_gen_routing.py` 4 單元測試（TDD）；含跳過未加 marker target 的增量 wiring robustness 修補。
- [x] 4. wire `std-evidence.js`（marker + `probe:engine→extract`、`evidence→judge`，行為等價）。
- [x] 5. wire `std-plan.js`（4 site + `:119` `planAuthor` flag(off) + 2 處 Fable 5 trailer 修正）。
- [x] 6. wire `std-implement.js`（7 site + 保護 3 處 do-not-codegen + 1 trailer + 補 `fix:cycle`/`fix:verify` 進 judge）。
- [x] 7. `tests/test_routing_consistency.py` 全域確定性 gate（drift + tier 對照 + judge 字面 + do-not-codegen + 衝突不變量）。
- [x] 8. 清 untracked throwaway 研究 workflow + `SKILL.md` codegen operator step + 全測試綠（routing 10/10、root contract 76/76 零回歸）。
