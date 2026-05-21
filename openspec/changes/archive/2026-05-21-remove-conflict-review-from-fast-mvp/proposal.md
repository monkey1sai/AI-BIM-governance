## Why

`AI-BIM-governance` 2026-05-21 後收斂為 fast MVP demo path:外部送 `ifc-ready` → coordinator 同步下載 + dispatch → 轉檔 ready → 一條 viewer 連結點開看 3D stream(對應 successor change `fast-ifc-link-demo-loop`)。在這條 happy path 之外,目前 repo 仍承載「衝突檢討 / 標示問題位置 / 建立審查標註」協作功能,跨 coordinator Socket.IO、viewer `IssuePanel` / `EventLogPanel`、`bimControlClient` issue methods、tests fixture。這套機制:

- fast MVP 不展示、現場 demo 不使用
- viewer 即將改為「query-string auto-attach + 全螢幕 stream + 邊框 HUD」(見 successor design),`IssuePanel` / `EventLogPanel` 等元件將失去插槽
- `/ui` 即將收斂為 3 卡單欄垂直流程(① 提交 / ② 進度 / ③ 連結),目前步驟 ④/⑤ 對應的衝突檢討卡片必須移除
- 維持留著 = 死碼,viewer/coordinator 重做 UI 時還要繞著它走,blast radius 反而變大

同時 `compose.host-kit.yml` viewer.ports 目前綁 `0.0.0.0:5173`,違反「viewer 是 Kit 1:1 endpoint,不可直接暴露給 LAN」邊界(見 memory `webrtc-1on1-entrypoint-via-coordinator-ui`)。本 change 一併把 viewer.ports 改 `127.0.0.1:5173:5173`,在進入 successor 之前清掉這個邊界落差。

本 change **純減法 + 一行 compose 修正 + 文件對齊**;不新增任何 production behaviour,blast radius 預估 LOW。

## What Changes

### 刪除 — coordinator (`bim-review-coordinator/`)

- `src/socket/reviewNamespace.ts`:Socket.IO `/review` namespace 內 `highlight*` / `selection*` / `annotation*` / `issueFocus*` event handlers
- `src/services/sessionStore.ts`:issue-related fields(實際欄位由 implementation 階段 grep 列出)
- `src/types.ts`:對應 type 刪除
- `src/public/dev-console.html`:
  - step bar 由 5 步改 3 步(刪 ④「標記問題 (Mark)」、⑤「紀錄回寫 (Record)」)
  - guided cards 刪「標示問題位置」「建立審查標註」「轉檔資料流」三張
  - Raw HTTP/Socket panel 內 `emitHighlight` / `emitSelection` / `emitAnnotation` 按鈕
- `src/public/dev-console.js`:`guidedHighlightIssue` / `guidedAnnotation` / `emitHighlight` / `emitSelection` / `emitAnnotation` functions 與相關 state
- `tests/`:含 `highlight` / `selection` / `annotation` / `issue` 關鍵字的 spec

### 刪除 — viewer (`web-viewer-sample/`)

- `src/components/IssuePanel.tsx`(整檔)
- `src/components/EventLogPanel.tsx`(整檔;dev-console raw 區仍可 debug socket events)
- `src/types/issues.ts`(整檔)
- `src/clients/bimControlClient.ts`:issue-related methods(實際 method 名由 implementation 階段 grep 列出)
- `src/clients/reviewSocket.ts`:highlight/selection/annotation event subscriptions
- `src/types/streamMessages.ts`:issue/annotation DataChannel message types
- `src/components/DemoControlPanel.tsx`:`IssuePanel` / `EventLogPanel` slot + issue 樹 state/handlers
- `src/App.tsx` / `src/AppStream.tsx`:若有 import `IssuePanel` / `EventLogPanel` / `types/issues` 則同步移除
- `tests/` (含 `__tests__`):同 coordinator 規則

### 修改 — Docker compose

- `compose.host-kit.yml` `viewer.ports`:
  - 由 `"${VIEWER_PORT:-5173}:5173"`(等於 `0.0.0.0:5173`,LAN 可達)
  - 改 `"127.0.0.1:${VIEWER_PORT:-5173}:5173"`(只 loopback 可達)

### 修改 — 文件(對齊新邊界)

- `AGENTS.md`:§5.4 Collaboration Flow、§5.5 Review Result Visualization Flow、§7.4 Review 資料、§8(各 repo「不應做的事」內 annotation/issue 段落)— 標記「已退役 - fast MVP 不包含」並收斂內文;若 successor 將重建協作機制,以新 change 形式重新引入
- `bim-review-coordinator/CLAUDE.md`:review session 內 issue/annotation 描述同步
- `web-viewer-sample/CLAUDE.md`(若有命中關鍵字):同上

### 明確排除(本 change 不做)

- 不動 `/api/external/ifc-ready` / conversion / callback outbox / session create 路徑(留給 successor)
- 不動 `bim-streaming-server/` / Kit 任何 source
- 不引入新 production dependency
- 不接真實外部 `bim-control` 雲端(`tests/fakes` 不動,只移除 issue 相關 test fixture)
- 不重設 `/ui` 內容為 3 卡片版面(留給 successor `fast-ifc-link-demo-loop`)
- 不改 viewer 主畫面成全螢幕 stream + HUD(同上)
- 不刪除 `bim-control-revit-intake-facade` / `worker-rvt-ifc-bridge` / `worker-artifact-pipeline` 等已退役 capability(它們已是 archive context,不在本 change 範圍)

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `review-session-request-lifecycle`:REMOVED issue / highlight / annotation handoff scenarios(實際 requirement 名 implementation 階段 grep 確認後填入 `specs/review-session-request-lifecycle/spec.md` ## REMOVED Requirements 區段)

### Removed Capabilities

- None(僅移除 capability 內部分 requirement,capability 本身保留作 fast MVP `joinSession` / `leaveSession` / `presence` / `heartbeat` / `sessionCreated` 使用)

## Impact

- Owner repo/folder:`bim-review-coordinator/src/`、`web-viewer-sample/src/`、repo root `compose.host-kit.yml`、`AGENTS.md`、`bim-review-coordinator/CLAUDE.md`(可能 `web-viewer-sample/CLAUDE.md`)
- API:無外部 API contract 變更;Socket.IO `/review` namespace 內部 event 移除(目前無外部 production consumer,僅 repo 內自循使用)
- Data structure:`session.*` 內 issue / annotation fields 移除(grep 列出實際欄位後再決定要不要保留 schema 但停止寫入,還是直接刪)
- Affected integration:none(`tests/fakes` 外部契約面不變)
- Affected symbols(apply 前需 GitNexus impact analysis):`registerReviewNamespace`、`IssuePanel`、`EventLogPanel`、`DemoControlPanel`、`bimControlClient` issue methods、`reviewSocket` subscriptions;預期 GitNexus `risk_level = LOW`(direct caller = `createCoordinatorApp` / `DemoControlPanel`,不改外部 API surface)
- Tests/contracts:`tests/contracts/` 不動;刪 issue / annotation / highlight 相關 test spec
- Dependencies:無新增 / 無移除 npm / python 套件
- Predecessor / Successor:本 change 為 successor `fast-ifc-link-demo-loop` 的 predecessor;merge + archive 完成後再開 successor branch,維持 NoSuccessorWhilePredecessorOpen gate
- Acceptance verification:5 級(L1 unit / L2 spec validate / L3 GitNexus / L4 container & netstat / L5 真實 UI by `mcp__claude-in-chrome`),詳見 `design.md` §5
- Brainstorming source-of-truth:`docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`(同 worktree 內)Section 2
