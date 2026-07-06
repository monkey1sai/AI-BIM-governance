# routing 模型 lane fallback 形式化：每個 tier 預先宣告供應中斷降落點

- 日期：2026-07-06
- Branch：`routing-fallback-lanes`
- 形式地位：本檔為本 PR 的 formal spec（`docs/superpowers/specs/*.md`，消 pr-review-agent `missing_openspec`）

## 問題

spec-to-done routing 已收斂到單一設定點（`.claude/workflows/routing.json` → `gen_routing.py` codegen → 三支 std-*.js），但各 tier 的模型名寫死且**沒有預先決定的退役降落點**。SKILL.md「模型預算」節只有 arbiter 一條散文前科（2026-06-15 fable 供應中斷 → 暫改 opus/max），其餘四個 tier 沒有政策；模型退役當天要臨場重新推導決策，且散文無機器驗證，會漂移。

## 假設

供應中斷應變的正確層次是「宣告式資料 + 驗證 + runbook」，不是 runtime 自動切換：`agent()` 的 model 參數由 harness enum 把關，模型退役時腳本必然顯性失敗（fail-loud），此時人工照 runbook 一次 config 修改即可恢復——比在每個 call-site 包 try-fallback 更小、更可審計，也保留「降級必須是人工可見決策」的既有 gate 精神。

## 改動面（最小）

1. `routing.json`：每個 tier 加 `fallback` 鏈（宣告式資料，codegen 不消費、行為零改動）＋頂層 `fallback_policy` 政策說明。降落點皆錨定既有政策：
   - `arbiter`: fable → **opus/max**（2026-06-15 前科的正式化）
   - `judge`: opus → **fable/max**（judge 不降、只可升）
   - `standard`: sonnet → **opus/max**（與腳本內建 BLOCKED 升級通道同向）
   - `reason`: opus → **fable/max**（升向不損品質；零 call-site 死配置，見 2026-07-02 spec §g）
   - `extract`: haiku → **sonnet/high**（最便宜合法選項；錯誤顯性、下游必複核）
2. `scripts/gen_routing.py` `validate()`：fallback 鏈必填、模型必須存在於 allowed_efforts、effort 合法、不得與本階相同。
3. 測試：`test_routing_json.py` 新增 `test_fallback_chains_pinned`（逐字釘住降落點）；`test_gen_routing.py` 新增 5 支 validate 拒絕/接受測試。`test_routing_consistency.py` 不動（generated block 無變化）。
4. `SKILL.md`：散文政策改指向形式化欄位；「維運注意事項」新增退役應變 runbook（§2）。

## 成功標準

- `gen_routing.py --check` 無漂移（三支 std-*.js 零位元組變化）。
- 全套 root contracts pytest 綠（含既有 11 支 routing 測試 + 新增測試）。
- 模型退役日的應變成本 = 改一個 config 欄位 + 跑 codegen + 同 commit 更新 pinned tests，決策已預先寫死不需重推導。

## 明確不做（YAGNI）

- runtime 自動 fallback（call-site try-chain）：invasive、掩蓋供應事件、違反「降級必須人工可見」。
- 多步 fallback 鏈：每步都要政策依據，現階段每 tier 一步已覆蓋單一模型退役；雙模型同時退役屬人工裁決域（fallback_policy 已載明）。
- `.codex` copy 同步：本改動不觸 phase/gate/HELD/resume/evidence/ship 語義（SKILL.md §源真聲明的 MUST-sync 清單），Codex 側模型 lane 為獨立映射。
