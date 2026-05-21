# Tasks — remove-conflict-review-from-fast-mvp

> `/goal` 視這份 tasks.md 為**參考路徑**;acceptance condition 見 `proposal.md` § Impact / `design.md` §5。任一 task 失敗 stop 給人類。

## 0. Pre-implementation setup

- [x] 0.1 切 worktree + branch(`codex/openspec/remove-conflict-review-from-fast-mvp` from `origin/main`)— 已完成,本 worktree 即是
- [x] 0.2 寫 proposal / design / tasks / specs delta — 完成本 task 之同時
- [x] 0.3 寫 brainstorming overall design — `docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`
- [ ] 0.4 Commit design phase(本 task 完成後)— message:`chore(openspec): scaffold remove-conflict-review-from-fast-mvp design + overall fast-mvp brainstorming spec`
- [ ] 0.5 等使用者 review brainstorming design + OpenSpec proposal,核可後才進 §1

## 1. Grep 列實際刪除 symbol(implementation 開頭執行)

- [ ] 1.1 coordinator side conflict-review code:
      ```bash
      grep -rn -E "highlight|selection|annotation|issueFocus" bim-review-coordinator/src
      grep -rn -E "highlight|selection|annotation|issue" bim-review-coordinator/tests
      ```
      把命中 handler / function / field 名寫進 §3 / §4 對應 task description
- [ ] 1.2 viewer side conflict-review code:
      ```bash
      grep -rn -E "IssuePanel|EventLogPanel|highlightRequest|annotationCreate|issueFocus" web-viewer-sample/src
      grep -rn -E "issue|annotation|highlight" web-viewer-sample/src/types web-viewer-sample/tests
      ```
- [ ] 1.3 docs 命中段:
      ```bash
      grep -rn -E "issue|annotation|highlight|collaboration" AGENTS.md
      grep -rn -E "issue|annotation" bim-review-coordinator/CLAUDE.md web-viewer-sample/CLAUDE.md
      ```

## 2. GitNexus pre-change impact analysis

- [ ] 2.1 `gitnexus_impact({target:"registerReviewNamespace", direction:"upstream"})`
- [ ] 2.2 `gitnexus_impact({target:"IssuePanel", direction:"upstream"})`
- [ ] 2.3 `gitnexus_impact({target:"DemoControlPanel", direction:"upstream"})`
- [ ] 2.4 任一回 HIGH/CRITICAL → stop,回報後等使用者裁定
- [ ] 2.5 `gitnexus_context({name:"sessionStore"})` 確認 issue 欄位 callers

## 3. Coordinator deletions

- [ ] 3.1 `src/socket/reviewNamespace.ts`:刪 §1.1 grep 命中的 highlight/selection/annotation/issueFocus event handlers;保留 join/leave/presence/heartbeat/sessionCreated
- [ ] 3.2 `src/services/sessionStore.ts`:刪 §1.1 命中的 issue fields 與 operation methods
- [ ] 3.3 `src/types.ts`:刪對應 type
- [ ] 3.4 `src/public/dev-console.html`:
      - step bar 由 5 改 3(刪 ④/⑤ `<a>` 元素;改 header 「步驟 ③ / 5」 → 「步驟 ③ / 3」)
      - 刪 guided cards 三張:「標示問題位置」/「建立審查標註」/「轉檔資料流」
      - 刪 Raw HTTP/Socket panel 內 `emitHighlight` / `emitSelection` / `emitAnnotation` 按鈕及對應 `<button>` element
- [ ] 3.5 `src/public/dev-console.js`:刪 `guidedHighlightIssue` / `guidedAnnotation` / `emitHighlight` / `emitSelection` / `emitAnnotation` functions 與相關 state(`conversionReviewResults` 等若 only 服 issue 流則一併移除)
- [ ] 3.6 `tests/`:含 §1.1 關鍵字的 test spec 整檔或對應 describe 刪除

## 4. Viewer deletions

- [ ] 4.1 `src/components/IssuePanel.tsx`(整檔刪除)
- [ ] 4.2 `src/components/EventLogPanel.tsx`(整檔刪除)
- [ ] 4.3 `src/types/issues.ts`(整檔刪除)
- [ ] 4.4 `src/clients/bimControlClient.ts`:刪 §1.2 命中的 issue-related methods
- [ ] 4.5 `src/clients/reviewSocket.ts`:刪 highlight / selection / annotation event subscriptions
- [ ] 4.6 `src/types/streamMessages.ts`:刪 issue / annotation DataChannel message types
- [ ] 4.7 `src/components/DemoControlPanel.tsx`:刪 IssuePanel / EventLogPanel slot + issue 樹 state/handlers
- [ ] 4.8 `src/App.tsx` / `src/AppStream.tsx`:若 import `IssuePanel` / `EventLogPanel` / `types/issues` 則同步移除
- [ ] 4.9 `tests/` 含 `__tests__/`:同 §3.6 規則

## 5. Compose viewer port bind

- [ ] 5.1 `compose.host-kit.yml`:`viewer.ports` 改 `"127.0.0.1:${VIEWER_PORT:-5173}:5173"`(diff 見 design.md §3)

## 6. Docs 對齊

- [ ] 6.1 `AGENTS.md` §5.4 Collaboration Flow:標記「已退役 - fast MVP 不包含」
- [ ] 6.2 `AGENTS.md` §5.5 Review Result Visualization Flow:同上
- [ ] 6.3 `AGENTS.md` §7.4 Review 資料:同上
- [ ] 6.4 `AGENTS.md` §8 各「不應做的事」內 issue / annotation 段:對齊或標記
- [ ] 6.5 `bim-review-coordinator/CLAUDE.md`:review session 內 issue/annotation 描述同步
- [ ] 6.6 `web-viewer-sample/CLAUDE.md`(若命中):同上

## 7. OpenSpec spec delta

- [ ] 7.1 grep `openspec/specs/review-session-request-lifecycle/spec.md` 內 issue/highlight/annotation/selection requirement 名 + scenario 名
- [ ] 7.2 在本 change 內 `specs/review-session-request-lifecycle/spec.md` 補完 ## REMOVED Requirements,每筆含 ### Requirement 名稱 + Reason + Migration
- [ ] 7.3 `npx openspec validate remove-conflict-review-from-fast-mvp --strict` 綠燈
- [ ] 7.4 `npx openspec validate --specs --strict`(整 specs 仍綠)

## 8. L1 unit verification

- [ ] 8.1 `cd bim-review-coordinator && npm run verify`(= `npm run build && npm test`)
- [ ] 8.2 `cd web-viewer-sample && npm run build && npm run test:session-first`
- [ ] 8.3 `python -m pytest tests -p no:cacheprovider`
- [ ] 8.4 `cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q`(baseline check,確認沒漂移)

## 9. L3 GitNexus post-change

- [ ] 9.1 `gitnexus_detect_changes({scope:"all"})` 確認影響面 = §3 / §4 / §5 / §6 / §7 預期 file set
- [ ] 9.2 對任一新出現的 unexpected file → stop debug

## 10. L4 container & network

- [ ] 10.1 `docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example up -d --build viewer`
- [ ] 10.2 `docker ps | grep ai-bim-web-plane`:viewer + coordinator 都 Up
- [ ] 10.3 `netstat -ano | grep :5173`:只見 `127.0.0.1:5173`,**不**見 `0.0.0.0:5173`
- [ ] 10.4 `netstat -ano | grep :8004`:仍見 `0.0.0.0:8004`(coordinator 對 LAN 不變)
- [ ] 10.5 `docker exec ai-bim-web-plane-host-kit-coordinator-1 node -e "fetch('http://127.0.0.1:8004/health').then(r=>r.text()).then(console.log)"`:回 status ok

## 11. L5 真實 UI / client(mcp__claude-in-chrome)

- [ ] 11.1 ToolSearch 載入 `mcp__claude-in-chrome__navigate / read_page / find / read_console_messages / javascript_tool / gif_creator / tabs_*`
- [ ] 11.2 `tabs_context_mcp` 取目前 tab 狀態
- [ ] 11.3 `tabs_create_mcp` 開新 tab navigate `http://127.0.0.1:8004/ui`
- [ ] 11.4 `read_page` 確認 step bar 3 顆數字
- [ ] 11.5 `get_page_text` 全文 grep「標示問題」「建立審查標註」「紀錄回寫」「IssuePanel」「EventLogPanel」 = 0 hit
- [ ] 11.6 `find` 「建立示範審查會議」按鈕並 `click`,等卡片更新
- [ ] 11.7 `read_console_messages` pattern「highlight|annotation|issue」 = 0 hit
- [ ] 11.8 開另一 tab navigate `http://127.0.0.1:5173/`
- [ ] 11.9 `javascript_tool` query `document.querySelectorAll('[data-testid="issue-panel"]').length === 0`
- [ ] 11.10 `read_console_messages`:無 unhandled import error
- [ ] 11.11 `gif_creator` 錄 11.3 ~ 11.7 整段;檔名 `remove-conflict-review-ui-walkthrough.gif` 落在 `docs/verification/evidence/2026-05-21-remove-conflict-review/`

## 12. Commit / Push / PR

- [ ] 12.1 `git status` 確認 staged file set = §3 ~ §7 預期
- [ ] 12.2 `git add` 個別 file(不用 `git add -A`,避免誤加 secrets / `*.ifc`)
- [ ] 12.3 `git commit` message(繁中):
      ```
      移除衝突檢討功能,viewer 改 127.0.0.1 bind

      - 刪 coordinator highlight/selection/annotation Socket.IO handlers
      - 刪 viewer IssuePanel/EventLogPanel/types/issues
      - 刪 issue-related test fixture
      - compose.host-kit.yml viewer.ports 改 127.0.0.1 bind
      - AGENTS.md §5.4/§5.5/§7.4 對齊
      - OpenSpec REMOVED requirements: review-session-request-lifecycle

      For fast-ifc-link-demo-loop predecessor (NoSuccessorWhilePredecessorOpen gate)
      ```
- [ ] 12.4 `git push -u origin codex/openspec/remove-conflict-review-from-fast-mvp`
- [ ] 12.5 `gh pr create`(繁中 title + description + 嵌入 gif evidence)
- [ ] 12.6 GitHub Actions CI 全綠
- [ ] 12.7 Reviewer approves(可能我 self-review,或請使用者)
- [ ] 12.8 `gh pr merge --squash`

## 13. Post-merge sync

- [ ] 13.1 切回 main 工作目錄,`git fetch origin --prune` + 本地 main 對齊 origin/main
- [ ] 13.2 OpenSpec sync:把 spec delta 併入 `openspec/specs/`
- [ ] 13.3 `git mv openspec/changes/remove-conflict-review-from-fast-mvp/ openspec/changes/archive/<YYYY-MM-DD>-remove-conflict-review-from-fast-mvp/`
- [ ] 13.4 `npx openspec validate --specs --strict` 綠燈
- [ ] 13.5 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`(AGENTS.md §1.6):加 archive 摘要、更新 spec count、釋放 NoSuccessorWhilePredecessorOpen gate
- [ ] 13.6 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html` 鏡像
- [ ] 13.7 worktree closeout(AGENTS.md §0.1 closeout flow):`git worktree remove` + `git branch -D codex/openspec/remove-conflict-review-from-fast-mvp` + `git push origin --delete codex/openspec/remove-conflict-review-from-fast-mvp`

## 14. Goal done

- [ ] 14.1 §0 ~ §13 全 check
- [ ] 14.2 通知使用者 predecessor archived,NoSuccessorWhilePredecessorOpen gate 已開,可進 successor `fast-ifc-link-demo-loop`
