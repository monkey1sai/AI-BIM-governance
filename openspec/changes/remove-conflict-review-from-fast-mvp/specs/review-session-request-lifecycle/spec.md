# review-session-request-lifecycle — Spec Delta (remove-conflict-review-from-fast-mvp)

> Delta against `openspec/specs/review-session-request-lifecycle/spec.md`(本檔僅含本 change 的差異)。
> Implementation 階段於 §7.1 task 跑 grep 命中既有 requirement / scenario 名稱後,**用實際名稱替換**下列 `<placeholder>`,然後 `npx openspec validate ... --strict` 綠燈即可。
> 設計階段不憑空猜 requirement 名稱;parser-friendly header(`## REMOVED Requirements` / `### Requirement: ...` / `#### Scenario: ...`)與條目結構先寫好。

## REMOVED Requirements

### Requirement: <REPLACE-WITH-issue-highlight-handoff-requirement-name>

**Reason:** fast MVP demo 不展示衝突檢討 / issue highlight 功能;viewer 重做為「全螢幕 stream + auto-attach」後無 IssuePanel 插槽承接 issue 焦點;coordinator `/ui` 收斂為 3 卡單欄垂直流程,亦不含步驟 ④「標記問題」。本 requirement 隨 conflict review 功能整體退役。

**Migration:** 無外部 production consumer 依賴本 requirement 的 Socket.IO event / viewer UI 表現;如未來重新引入,以新 OpenSpec change form ADD requirement,並對應重新建立 viewer slot 與 coordinator event handler。

### Requirement: <REPLACE-WITH-annotation-create-update-delete-requirement-name>

**Reason:** annotation create / update / delete 流程屬衝突檢討協作的一部分,fast MVP 不展示;`/ui` 步驟 ⑤「紀錄回寫」與互動實驗室「建立審查標註」guided card 一併移除。

**Migration:** 無;若未來重新引入,以新 change ADD。

### Requirement: <REPLACE-WITH-selection-update-or-issue-focus-broadcast-requirement-name>

**Reason:** selection broadcast / issue focus 廣播由 coordinator Socket.IO 廣播給多人 viewer,但 fast MVP 是 Kit 1:1,只一個 viewer 連線,broadcast 無意義;且 viewer 主畫面改全螢幕 stream 無選取面板。本 requirement 隨 conflict review 功能整體退役。

**Migration:** 無;若未來支援多人協作再以新 change ADD。

## MODIFIED Requirements

### Requirement: <REPLACE-WITH-review-session-event-stream-requirement-name>

**Note:** 本 requirement 既有 scenario 列出「append-only lifecycle audit endpoint」可能涵蓋 issue / annotation 事件分類。implementation 階段確認 scenario 內若有 issue / annotation 字眼,改寫為「lifecycle audit endpoint 接受任意 event_type;fast MVP 範圍內不再產生 highlight / annotation event,但 schema 仍開放未來重新引入」。

**Reason:** event log endpoint 本身保留(`POST /api/review-sessions/:sessionId/events`、`GET .../events`、`GET .../lifecycle-events`),不影響 successor `fast-ifc-link-demo-loop` 觀察 session lifecycle 的能力。

(實際 scenario 文字 implementation 階段定稿)

#### Scenario: <既有 scenario 名稱 — 保留>

(若 scenario 內無 issue / annotation 字眼則整段保留,不寫進本 change)

---

## 校驗檢核(implementation 階段執行 §7 後)

1. `npx openspec validate remove-conflict-review-from-fast-mvp --strict` 綠燈
2. `npx openspec validate --specs --strict` 整體仍綠燈
3. `git diff openspec/specs/review-session-request-lifecycle/spec.md`(merge + sync 後)清楚顯示 ## REMOVED 段已 archive 進 spec 本體
