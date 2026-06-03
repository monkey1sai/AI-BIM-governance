## 1. Preflight

- [x] 1.1 `pip install ifctester`（host Python312）成功；驗證 `ifctester.ids` 可用（附帶 bcf-client）。
- [x] 1.2 branch `codex/openspec/a1-ids-import`（stacked 於 a2-geometry-issue-impact）。

## 2. Tests First

- [x] 2.1 IDS 對合成門（1 有/1 缺 FireRating）→ pass/fail 帶真實 guid、score 50。
- [x] 2.2 `/health` ifctester=true（更新既有測試）。

## 3. Core

- [x] 3.1 `rule_engine/ids_runner.py`：ifctester validate → RuleRunResult 映射。
- [x] 3.2 `app.py`：rule-run `ids_path` 分支（IDS vs YAML）；`requirements.txt` 加 ifctester。

## 4. 前端 + evidence

- [x] 4.1 A1 Rule Center IDS 路徑輸入；governanceClient ids_path；誠實標示更新。
- [x] 4.2 sample IDS（`rules/sample-fire-rating.ids`）+ 真實 IFC smoke 證據（72 門 / passed 1 / failed 71，與 YAML 一致）。

## 5. Validation

- [x] 5.1 IDS + health 測試通過。
- [ ] 5.2 全套 pytest + 前端 build/test + coordinator tsc。
- [ ] 5.3 `npx openspec validate a1-ids-import --strict`。

## 6. Closeout

- [ ] 6.1 commit + PR（stacked 於 #158）。
- [ ] 6.2 merge 後 archive。
