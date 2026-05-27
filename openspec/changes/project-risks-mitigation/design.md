## Context

B 方案（雲地分離）架構下，邊界已收斂。實際運行中，本專案有五個風險點：

1. coordinator in-memory queue 在重啟時遺失 queued job
2. CI 無 GPU 環境，Kit 渲染與 WebRTC 串流無法自動化驗證
3. fallback (IfcOpenShell + pxr) 與 primary (HOOPS Kit) 視覺一致性
4. WebRTC DataChannel `openStageRequest` 在 race 條件下的行為
5. AI agent 在含退役服務歷史文件的 repo 上做設計時的越界與幻覺風險

這五點在 main 上**都已有意識地被接受**並各自有最小 mitigation。但缺少正式 OpenSpec 把「接受邊界」與「最小義務」明文化，導致後續 PR 反而可能誤改最小行為，或 AI agent 把現行行為誤判為待修 bug。

本 change 的設計目標：**只做 spec 層級的明文化，不做實作升級**。實作升級各自獨立 OpenSpec change。

## Goals / Non-Goals

**Goals:**
- 把五個風險寫成 SHALL/MUST spec，定義「接受邊界 + 最小義務 + 升級實作必須另開 change」三件事
- 讓 spec 通過 `openspec validate --strict`
- 為 PR reviewer 與 AI agent 提供可引用的明文依據

**Non-Goals:**
- ❌ 在本 change 把 in-memory queue 升級為 sqlite / Redis（另開 change）
- ❌ 在本 change 加 fallback vs primary visual regression test（另開 change）
- ❌ 在本 change 引入 DataChannel state machine 或 exclusive lock（另開 change）
- ❌ 在本 change 把 GitNexus 跨界校驗整合到 CI workflow（另開 change）
- ❌ 本地配置虛擬 GPU 或雲端 GPU 測試節點（另開 change）

## Decisions

### Decision 1：spec 描述「已接受的最小行為」而非「目標未來行為」

- **採用**：5 個 Requirement 都用「MUST 採用 in-memory FIFO」「MUST 透過 drain() 標記 dropped_on_restart」這類描述當下行為的 SHALL/MUST。
- **不採用**：「MUST 升級為 sqlite」「MUST 引入 state machine」這類描述未來目標的 SHALL/MUST。
- **原因**：spec 是當前 main 行為的契約，不是 wishlist。Wishlist 應該是 successor change 的 proposal，而非本 change 的 spec。

### Decision 2：每個 Requirement 多加一個 "out of scope" scenario

- **採用**：每個 Requirement 加一個 `#### Scenario: <topic> is out of scope` block，明寫「若要升級實作 MUST 另開 OpenSpec change」。
- **原因**：避免後續 contributor 引用本 spec 的 risk 描述當作「自動授權」去改 production code。

### Decision 3：tasks.md 把 §2 三個 follow-up tasks 標為 deferred-to-successor-change

- **採用**：原 §2 的 sqlite queue / CI GitNexus / DataChannel state machine 三個 task 標成 `[~]`（deferred）並指向應立的 successor change 框架。
- **不採用**：把 task 留 `[ ]` 然後嘗試在本 PR 做（會超出 scope 並破壞最小閉環）。
- **原因**：明文化 deferred 讓後續 reviewer 不會誤以為本 change 未完成。

## Risks / Trade-offs

- **trade-off：spec 不推進實作升級**：好處是 commit 範圍小、可審；壞處是真實 mitigation 仍依賴後續 change，spec pass 不等於 risk 已消除。
- **risk：spec 與實際行為脫鉤**：若未來 main 上的 `ConversionDispatchQueue.drain()` 行為被移除，本 spec 就會「過時」。緩解：spec 條文裡 hardcode 具體 symbol name (`ConversionDispatchQueue.drain()`)，AI agent / reviewer 改該 symbol 時容易連動發現。

## Open Questions

(none — scope 已收斂)
