## 1. Preflight

- [x] 1.1 branch `codex/openspec/governance-issue-db` + worktree（off main，含 A1+A2+A3）。

## 2. Failing Tests First

- [x] 2.1 issue lifecycle + 非法轉換被擋 + audit 計數。
- [x] 2.2 from-rule-run（失敗構件 → issue，帶真實 guid、kind=issue）。
- [x] 2.3 from-diff（變更構件 → issue）；無 guid → annotation。

## 3. Core Implementation（governance-service/issues/）

- [x] 3.1 `store.py`：SQLite issues/issue_events + 受控狀態機 + audit + BCF kind 區分。
- [x] 3.2 `api.py`：APIRouter（CRUD + transition + from-rule-run + from-diff）；`app.py` include_router。

## 4. Coordinator proxy + 前端

- [x] 4.1 `governanceProxy.ts`：additive `/api/governance/issues*`（HTTP 透傳，非 socket push）。
- [x] 4.2 console Issues 頁 Issue Center（失敗構件建 issue + 列表 + transition）；governanceClient issue 方法；Overview backlog 誠實更新。

## 5. Validation

- [x] 5.1 `pytest tests/`（含 issues 5 測）。
- [ ] 5.2 前端 build + vitest；coordinator tsc。
- [ ] 5.3 `npx openspec validate governance-issue-db --strict`。
- [ ] 5.4 `git diff --cached --check`。

## 6. Closeout

- [ ] 6.1 commit + PR（stacked followup base main）。
- [ ] 6.2 merge 後 archive。

## 7. 後續

- [ ] 7.1 A2 issue-impact（resolved/reopened/new）連動本 Issue DB。
- [ ] 7.2 BCF .bcfzip 匯出（issue → BCF）。
- [ ] 7.3 雲端 control-plane issue 同步。
