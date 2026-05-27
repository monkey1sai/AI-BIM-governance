## Why

B 方案（雲地分離）架構下，本專案在系統持久化、CI 驗證環境、Fallback 一致性、網路競態以及 AI 開發流程上有五個**已被有意識接受的風險**。這些風險目前都有最小 mitigation（in-memory queue 的 `drain()` / `dropped_on_restart`、host-native smoke runbook、`-SkipAutoLoad` + DataChannel 載入、AGENTS.md + PR review agent），但缺少正式 spec 把「邊界、最小義務、未來升級的立案規則」明文化。

沒有這份 spec，後續 contributor / AI agent 容易誤把 in-memory queue / fallback marker / last-write-wins 行為當成 bug 去「順手修」，反而破壞已驗證的最小閉環。

## What Changes

- 把五項風險（記憶體佇列持久化、CI 無 GPU 驗證盲區、Fallback 視覺一致性、WebRTC DataChannel 競態、AI 歷史幻覺與越界）正式定義為 SHALL/MUST spec，明文：
  - 目前**現行接受**的風險邊界
  - 各風險最小 mitigation 的**強制義務**
  - 任何「升級實作」(sqlite persistence / visual regression test / DataChannel state machine / CI GitNexus 整合) 一律 **MUST 另開獨立 OpenSpec change**，不在本 spec 授權範圍內
- 不引入 production code 改動。本 change 是純文件 / spec 層級。

## Capabilities

### New Capabilities
- `project-risks-mitigation`: 定義五個核心系統風險的接受邊界、最小 mitigation 義務、與升級實作的立案規則。

### Modified Capabilities
(none)

## Impact

- 影響後續 PR review：reviewer 可引用本 spec 拒絕在不開新 change 的情況下改動已被有意識接受的最小行為（例如把 in-memory queue 順手換 sqlite）。
- 影響後續 AI agent：明確的 SHALL/MUST 邊界讓 agent 不會把「現行最小行為」誤判為 bug。
- 不影響 runtime：no production code change，no spec/code conflict。

## Out of Scope (deferred to successor changes)

下列 follow-up 一律 **MUST 另開獨立 OpenSpec change**，本 change 不實作：

| Successor topic | 對應風險 |
|---|---|
| sqlite (或等效) queue persistence | RISK-IN-MEMORY-QUEUE-PERSISTENCE |
| Fallback vs primary visual regression test | RISK-FALLBACK-VISUAL-INCONSISTENCY |
| DataChannel state machine + exclusive lock | RISK-WEBRTC-DATA-CHANNEL-RACE |
| CI workflow 加 GitNexus 跨界自動校驗 | RISK-AI-AGENT-HISTORICAL-HALLUCINATION |
| GPU-bound CI runner (虛擬 GPU / 雲端 GPU) | RISK-CI-GPU-VERIFICATION-BLINDSPOT |
