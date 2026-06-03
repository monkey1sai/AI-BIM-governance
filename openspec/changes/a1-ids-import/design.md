# Design — a1-ids-import

## IDS 映射

`ifctester` validate 後：每個 `specification` 有 `applicable_entities`，每個 `requirement` 有 `passed_entities`。
→ failed = applicable − passed。映射成 `RuleResult(ifc_guid, ifc_type, rule_code=spec.name, status pass/fail)`，
彙總為 `RuleRunResult`（與 YAML 引擎同型，可串 issue / 匯出）。

## 整合

- `rule-run` 請求新增 `ids_path`：有則 `ids_runner.run_ids_file(model, ids_path)`，否則 YAML `run_rules`。
- `/health` 回報 `ifctester=true`（已安裝）。
- 前端 A1 Rule Center 加 IDS 路徑輸入。

## 依賴 / 邊界

- 新增 `ifctester>=0.8.5`（buildingSMART IDS）；pip 附帶 `bcf-client`。純 CPU，無 GPU。
- 瀏覽器只打 :8004；IDS 規則跑與 YAML 同走 governance-service。

## 驗證

- pytest：IDS 對合成門模型（1 有/1 缺 FireRating）→ pass/fail 帶真實 guid、score 50。
- 真實 IFC smoke（72 門 → passed 1 / failed 71）與 YAML 引擎一致（交叉驗證）。
- `/health` ifctester=true。前端 build + vitest；coordinator tsc。
