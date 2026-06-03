# Design — governance-adversarial-followups-2

## Context

「最終全系統對抗複驗」對 governance-service 雙懷疑者強確認，7 個 finding 集中在 A1-IDS 計分誠實（F1/F2）、A2-diff Tag 配對正確性（F3）、Issues-DB 版本綁定對稱性（F4）與授權敘述誠實（F5），外加兩個低風險文件/死碼（F6/F7）。全部以真實 host py312（ifctester 0.8.5 / ifcopenshell 0.8.5）probe 證實後才動手，符合「先量再改」。

## Goals / Non-Goals

- Goals：杜絕 IDS 假通過（殘留洩漏、零適用）、修正 diff 幻影配對、補齊 issue 版本綁定守門、校正授權敘述為查證事實。
- Non-Goals：不改對外端點簽章；不移除/新增 bcf-client（既有 ifctester transitive 依賴維持）；不做 BCF 匯入；不擴充 IDS/diff 功能面。

## Key Decisions

### F1：只重置 facet 級殘留，不覆寫 spec 級狀態

ifctester 0.8.5 的 `Specification.validate()` 已會重設 spec 級 `passed_entities`/`failed_entities`/`applicable_entities`/`status`（probe 證實第二次 validate 後 `spec.passed_entities` 變 `[]`、`spec.status` 翻 `False`），唯獨**不重設 requirement facet 的 `passed_entities`**（只累加）——這才是洩漏來源。

決策：`_reset_ids_residual_state` 只清 `facet.passed_entities` 與 `facet.failures`，**不**碰 spec 級狀態。原因：(1) spec 級本就由 ifctester 重設，重複清無益；(2) 既有測試以 fake spec（`_FakeSpecs.validate` 為 no-op）在 `__init__` 設好 `status=False`/`applicable_entities`，若在此清空會破壞那些 fake-spec 測試。初版誤清 spec 級導致 3 個既有測試紅，收斂為只清 facet 後全綠——符合「兩種改法效果一樣時選副作用更小者」。

### F2：零-result fallback 區分 applicable 空/非空

`run_ids` 既有 fallback 只在 `applicable` 非空時補 fail。required spec（`minOccurs>=1`）零適用時 ifctester 回 `spec.status=False`、`applicable=[]`，舊碼完全不產 result → score=100。

決策：fallback 條件去掉 `and applicable`；分兩路——applicable 非空維持原逐構件 fail；applicable 為空補一筆 **spec 級** fail（`ifc_guid=None`、evidence `required_absent=True`），誠實反映 required 構件缺席且不捏造構件 guid。與上方 prohibited(`maxOccurs==0`) 分支天然互斥（該分支已 `continue`），不重複計數。

### F3：唯一性護欄取代 setdefault 壓平

第二級 `setdefault((is_a, tag), e)` 對同 `(is_a, Tag)` 多構件只留第一個，丟掉其餘並依插入序交叉錯配，產生幻影 moved + 假 removed/added（probe：反向插入序下 matched=1/moved=1/removed=1/added=1，正確應 matched=2/0 變更）。

決策：改用 `_tag_buckets` 保留每個複合鍵的所有構件，只有「兩側該鍵各恰 1 個」才以 Tag 配對；任一側 >1（歧義）不配，交給第三級 type+name+loc 或 removed/added。唯一-Tag 情況行為不變（既有 `test_tag_alignment_same_type_different_guid` 仍綠）。此法消除對 `by_type` 迭代序的依賴。

### F4：from-rule-run 對稱 422

from-diff 已在 `target_model_version_id` 缺失時回 422；from-rule-run 卻用 `run.get("model_version_id")`，None 仍建 issue，誠實鐵律不對稱破口。決策：rule run 缺 `model_version_id` 時 raise 422（訊息與 from-diff 平行），並把 items 的 `model_version_id` 改用驗證後的 `mv` 區域變數。

### F5：以查證事實校正授權敘述

`pip show` 證實 `ifctester Requires: bcf-client`、`bcf-client` license=GPLv3 且 `Required-by: ifctester`——環境**確實 transitive 安裝 GPLv3 套件**。但 `grep import bcf governance-service/bcf/` = 0，本地匯出模組只用 stdlib。

決策：精確區分兩層——(a)「匯出模組執行期不 import bcf-client、產物不含其程式碼」為真，保留；(b)「不依賴 GPLv3」在環境層面為**偽**，改述為「ifctester 會 transitive 安裝 bcf-client(GPLv3)，匯出產物不含其程式碼」。requirements.txt 既有註解已誠實標示，保留。此為純文件/敘述校正，零行為變更。

## Risks / Trade-offs

- F1 reset 假設 ifctester 屬性名（`passed_entities`/`failures`）；以型別探測（isinstance set/list）保護，非 ifctester 真物件安全略過。若未來 ifctester 改名需同步——已在 docstring 標注以 0.8.5 為準。
- `run_ids` 上游 impact 為 HIGH（fan-out：`run_ids_file`、`scripts/run_ids_evidence.py:main`、`app.py:_execute`），但本次改動保持 `(model, specs, label)` 簽章與 `RuleRunResult` 回傳結構不變，僅內部計分誠實化；以 78-test 全綠 + evidence 腳本無硬斷言驗證無破壞。
- F2 對「applicable 為空且 status False」補 spec 級 fail，可能讓部分原本 score=100 的 IDS run 改為 <100——這是修正假通過的預期行為，非退化。

## Verification

- 真實 host py312 ifctester probe：F1（重用 specs good→bad 門，第二次 failed=1/score=0）、F2（required minOccurs=1 無門，failed=1/score=0）。
- 合成 IFC probe：F3（同型別重複 Tag 反向插入序，修後 matched=2/0 變更）。
- `pip show ifctester|bcf-client` + grep：F5 三項事實。
- `pytest governance-service/tests -q`：78 passed（baseline 74 + F1/F2/F3/F4 各 1）。
- `npx openspec validate governance-adversarial-followups-2 --strict`：通過。
