## REMOVED Requirements

### Requirement: A4–A10 願景詳頁 SHALL 整段標願景，情境 SHALL 標範例且 SHALL NOT 當真實實測

**Reason**: A4 Semantic Search 已有 governance API、coordinator resolver 與核可的 canonical workspace screen，且本 change 將其收斂為 session-bound live capability；繼續把 A4 與 A5–A10 一起標「後端未建 / p4 願景」會與可執行 contract 衝突，也會讓 fixture 被誤認為唯一 A4。

**Migration**: 以本 delta 新增的 `A5–A10 願景詳頁...` requirement 取代 roadmap 集合；A4 route/copy/operability 只由 `a4-semantic-search` requirements 管理。archive 時同步把 base spec Purpose 的「A4–A10 願景藍圖」改為「A4 可操作能力 + A5–A10 願景藍圖」。

## ADDED Requirements

### Requirement: A5–A10 願景詳頁 SHALL 整段標願景，A4 SHALL 導向可操作的 workspace capability

AppsPage 的 A5–A10 roadmap 卡 SHALL 可點並導向泛用 vision 詳頁（`app/<slug>`）。每個 vision 詳頁 SHALL 顯示 DB schema / REST api / UI 面板 / MVP 驗收 / sprint steps / risks，且 SHALL 明確標示「後端未建」（願景，prov `p3`/`p4`：A5=`p3`、A6–A10=`p4`）。詳頁的 scenario SHALL 標示為「範例情境（願景敘事，非真實 run）」，SHALL NOT 將 RM_APPS 內具體數字呈現為本系統真實實測。詳頁的 api 區 SHALL 標示為「願景 API 設計（非已實作 route）」，SHALL NOT 呈現為可呼叫的真實端點。vision 詳頁 SHALL NOT 顯示任何捏造的成功數字（如 99.1% / 92.4%）。

A4 SHALL NOT 再導向泛用 vision 詳頁或標 `p4/backend not built`；A4 SHALL 導向 canonical `#/workspace?dock=a4`，並只有在 `a4-semantic-search` 的 API/session/runtime evidence 通過時標示對應 live provenance。

**備註（決策原因）:** A5–A10 仍沒有 runtime authority，繼續以 roadmap 誠實呈現；A4 已具備部分真 API，但現況 live/fixture 分裂。把 A4 從泛用 roadmap requirement 移出，能讓 A4 只剩一個端到端行為 owner，也避免為了讓 A4 上線而誤把 A5–A10 一起宣告完成。使用 REMOVED + ADDED 而不是改名的 MODIFIED，是為了保留 OpenSpec requirement identity 並避免 archive 後留下誤導的「A4–A10」標題。

#### Scenario: A5–A10 願景詳頁明確標後端未建且情境標為範例

- **WHEN** 操作員從 Applications 點開任一 A5–A10 roadmap 卡
- **THEN** 詳頁 SHALL 顯示「後端未建」之願景標示（prov `p3` 或 `p4`）
- **AND** scenario 區 SHALL 標示為「範例情境」且「非真實 run」
- **AND** api 區 SHALL 標示為「願景 API 設計（非已實作 route）」
- **AND** SHALL NOT 顯示捏造的成功數字（99.1% / 92.4%）

#### Scenario: Roadmap 卡來源狀態對齊 RM phase

- **WHEN** 載入 Applications 的 A5–A10 roadmap 卡
- **THEN** 每張卡 SHALL 帶 `app/<slug>` route（可點）
- **AND** A5 SHALL 標 `p3`，A6/A7/A8/A9/A10 SHALL 標 `p4`

#### Scenario: A4 由 roadmap 收斂至 canonical live workspace

- **WHEN** 操作員從 Applications 或舊 A4 hash 入口開啟 A4
- **THEN** frontend SHALL 導向 `#/workspace?dock=a4` 並保留有效 session context
- **AND** SHALL NOT 掛載泛用 vision page、固定 fixture success 或 `p4/backend not built` copy
- **AND** A4 live/partial provenance SHALL 由真實 session/API/model/runtime gates 決定，visual parity SHALL NOT 單獨提升其狀態
