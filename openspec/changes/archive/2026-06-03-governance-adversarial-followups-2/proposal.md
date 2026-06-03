## Why

「最終全系統對抗複驗」對 governance-service 做雙懷疑者強確認，找出 7 個新 finding（已用真實 host py312 ifctester/pip probe 與合成 IFC 證實）：

- **F1（HIGH/honesty, a1-ids）A1-IDS-REUSE-FALSEPASS**：`run_ids` 重用同一 IDS specs 物件跨多 model 時，ifctester 0.8.5 的 requirement facet `passed_entities` 從不重置（只累加），加上 ifcopenshell 跨 model 重用 STEP `.id()`，前一 model 的 pass 殘留洩漏 → 第二 model 不合規構件被 `el.id() in passed_ids` 誤判 pass、score=100 假通過。
- **F2（HIGH/honesty, a1-ids）Required IDS spec 零適用構件誤報 100% pass**：非 prohibited 的 required spec（`minOccurs!=0`）找不到 applicable 構件時，ifctester 回 `spec.status=False`，但 `run_ids` 因 applicable 為空而不產任何 result → score=100，掩蓋「required 構件缺席」這個真實 IDS 失敗。
- **F3（HIGH/bug, a2-diff）同型別重複 Tag 幻影配對**：第二級 `_tagmap` 用 `setdefault((is_a, tag), e)` 壓平 → 同型別 2 個相同 Tag 構件只留第一個、第二個被丟 → 幻影 moved + 假 removed/added，且依插入序非確定。
- **F4（med/honesty, issues-db）from-rule-run 未守 model_version_id**：`issues_from_rule_run` 用 `run.get("model_version_id")`，None 仍建出無版本綁定的正式 issue（與 from-diff 已加的 422 守門不對稱，違誠實鐵律）。
- **F5（med/honesty, bcf）「不依賴 GPLv3 bcf-client」誤導**：經 `pip show` 查證，`ifctester` `Requires: bcf-client`，`bcf-client` 0.8.5 license 為 GPLv3 且 `Required-by: ifctester` → 環境確實 transitive 安裝 GPLv3 套件。`governance-service/bcf/` 本地模組經 grep 確認不 import bcf-client（只用 stdlib），但既有敘述宣稱「不依賴 GPLv3」會誤導。
- **F6（low/honesty）test_api.py 過時 docstring**：模組 docstring 寫「/health 誠實回報 ifctester=false」，與同檔 `test_health_reports_ifctester_true` 及 ifctester 已安裝矛盾。
- **F7（low）死碼 + docstring 失準**：`load_rule_set` 的 `yaml.safe_load(fh) if False else json.load(fh)` 死碼分支；`federation/coords.py` docstring 宣稱驗 'origin' 但實作只比 upAxis+metersPerUnit。

誠實鐵律：計分不得因 ifctester 內部殘留或零適用而捏造通過；issue 必綁 model_version；授權敘述以查證事實為準（不得宣稱環境不依賴 GPLv3 若 transitive 已安裝）。

## What Changes

- `governance-service/rule_engine/ids_runner.py`：
  - 新增 `_reset_ids_residual_state`：`run_ids` 進入點、`validate` 前重置 ifctester 不會自行清理的 requirement facet 殘留（`passed_entities`、`failures`），杜絕跨 model 洩漏（F1）。
  - 零-result fallback 擴充：spec `status is False` 且未產逐構件 result 時，applicable 非空補逐構件 fail、applicable 為空補一筆 spec 級 `required_absent` fail（F2），與既有 prohibited(maxOccurs==0) 分支互斥不重複計數。
- `governance-service/diff_engine/engine.py`：
  - 第二級 Tag 對齊以 `_tag_buckets`（保留所有同鍵構件）取代 `setdefault` 壓平；只有兩側該 `(is_a, tag)` 各恰 1 個才以 Tag 配對，歧義落第三級或 removed/added（F3）。
- `governance-service/issues/api.py`：
  - `from-rule-run` 對稱守門：run 缺 `model_version_id` 時 raise 422，與 from-diff 一致（F4）。
- 誠實敘述校正（F5）：`bcf/bcf_writer.py`、`bcf/__init__.py`、`app.py`、`rule_engine/excel_export.py`、`governance-service/CLAUDE.md` 改述為「匯出模組執行期不 import bcf-client、產物不含其程式碼；惟 ifctester transitive 安裝 bcf-client(GPLv3)」。
- 文件/死碼（F6/F7）：`tests/test_api.py` docstring 改為 ifctester 已安裝/health 如實回報 true；`rule_engine/engine.py` 死碼分支化簡為 `json.load(fh)`；`federation/coords.py` docstring 校正為只比 upAxis+metersPerUnit、不驗 origin。
- 測試：`tests/test_ids.py`（F1、F2 各 1 個真實 ifctester regression）、`tests/test_diff_engine.py`（F3 同型別重複 Tag regression）、`tests/test_issues.py`（F4 None mv → 422 regression）。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `governance-rule-run-authority`：IDS 計分跨 model 不殘留洩漏（F1）、required 零適用構件誠實 fail 不假通過（F2）。
- `model-version-diff-authority`：Tag 級對齊唯一性護欄，同型別多個相同 Tag 不幻影配對（F3）。
- `governance-issue-tracking`：from-rule-run 對稱守 model_version_id（缺則 422），不建無版本溯源 issue（F4）。
- `governance-bcf-export`：BCF GPLv3 依賴敘述誠實校正（匯出模組不連結，惟 ifctester transitive 安裝）（F5）。

## Impact

- Owner repo / folder：
  - `governance-service/rule_engine/ids_runner.py`、`governance-service/diff_engine/engine.py`、`governance-service/issues/api.py`、`governance-service/bcf/bcf_writer.py`、`governance-service/bcf/__init__.py`、`governance-service/app.py`、`governance-service/rule_engine/excel_export.py`、`governance-service/rule_engine/engine.py`、`governance-service/federation/coords.py`、`governance-service/CLAUDE.md`。
  - 測試：`governance-service/tests/test_ids.py`、`governance-service/tests/test_diff_engine.py`、`governance-service/tests/test_issues.py`、`governance-service/tests/test_api.py`。
- API / data shape：
  - `POST /api/issues/from-rule-run/{run_id}`：run 缺 `model_version_id` 時改回 422（先前會建出 `model_version_id=null` 的 issue）。其餘回傳語意不變。
  - IDS rule-run 的 `score` 在「重用 specs 跨 model」與「required 零適用」情況改為誠實（先前可能假回 100）；RuleRunResult 結構不變。
  - diff 在「同型別多個相同 Tag」情況的 added/removed/moved 計數改為正確（先前可能含幻影/假計數）；DiffResult 結構不變。
- Dependencies：
  - **不新增生產依賴**（純 stdlib + 既有 ifctester/ifcopenshell）。純 CPU。
- Non-goals：
  - 不改 IDS / diff / issue 的對外端點簽章；不改 BCF 匯出端點行為（僅授權敘述校正）；不移除或新增 bcf-client（既有 ifctester transitive 依賴維持不變）。
