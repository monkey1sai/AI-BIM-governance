# Design — remove-conflict-review-from-fast-mvp

> Brainstorming 整體 design 見同 worktree `docs/superpowers/specs/2026-05-21-fast-mvp-loop-overall-design.md`。本檔聚焦此 change 的技術決策。

## 1. 決策:刪 code(不 feature flag、不 archive folder)

| 選項 | 取捨 | 結論 |
|---|---|---|
| A. 直接刪 code | 乾淨,不可逆;diff 大但 reviewer 容易判斷;baseline 變乾淨,successor 在乾淨 map 上開發 | **採用** |
| B. Feature flag(env `ISSUE_REVIEW_ENABLED=false`) | 可逆,但死碼留著;successor UI 重做要繞著走;test 要 split feature on/off | 不採用 |
| C. 移到 `docs/archive/`(`git mv`) | git history 保留;source tree 不留;需要拿回時 grep 看得到 | 不採用(成本介於 A/B 之間但沒有 B 的可逆性優勢) |

理由:使用者明確指示「現階段只需要能做到接 API 轉檔 + 看畫面,衝突檢討先移除」,且 successor 將重設 viewer / UI,留任何死碼都會增加 successor 的 blast radius。OpenSpec spec 內的 REMOVED requirement 已記下歷史,需要時可從 git history `git log -- web-viewer-sample/src/components/IssuePanel.tsx` 找回。

## 2. 刪除範圍 — implementation 階段 grep 命令(精確化)

設計階段不憑空猜實際 handler / method / field 名;以下命令 implementation 階段執行,grep 結果寫進 `tasks.md` 對應 item:

```bash
# coordinator side
grep -rn -E "highlight|selection|annotation|issueFocus" bim-review-coordinator/src
grep -rn -E "highlight|selection|annotation|issue" bim-review-coordinator/tests

# viewer side
grep -rn -E "IssuePanel|EventLogPanel|highlightRequest|annotationCreate|issueFocus" web-viewer-sample/src
grep -rn -E "issue|annotation|highlight" web-viewer-sample/src/types
grep -rn -E "issue|annotation|highlight" web-viewer-sample/tests

# docs
grep -rn -E "issue|annotation|highlight|collaboration" AGENTS.md
grep -rn -E "issue|annotation" bim-review-coordinator/CLAUDE.md web-viewer-sample/CLAUDE.md
```

## 3. Compose `viewer.ports` 改 127.0.0.1 bind

```diff
 viewer:
   environment: !override
     VITE_COORDINATOR_API_BASE: "${WEB_VIEWER_COORDINATOR_API_BASE:-http://127.0.0.1:${COORDINATOR_PORT:-8004}}"
     VITE_COORDINATOR_SOCKET_URL: "${WEB_VIEWER_COORDINATOR_SOCKET_URL:-http://127.0.0.1:${COORDINATOR_PORT:-8004}}"
   ports: !override
-    - "${VIEWER_PORT:-5173}:5173"
+    - "127.0.0.1:${VIEWER_PORT:-5173}:5173"
```

驗收:rebuild + up viewer container 後 `netstat -ano | grep :5173` 應只見 `127.0.0.1:5173`,**不**見 `0.0.0.0:5173` / `[::]:5173`(Docker backend `com.docker.backend.exe` listening pattern 對應 loopback 而非 wildcard)。

## 4. OpenSpec ## REMOVED Requirements 寫法

`openspec/specs/review-session-request-lifecycle/spec.md` 既有 requirement 名稱以 implementation 階段 grep 為準。本 change 內 `specs/review-session-request-lifecycle/spec.md` 用以下 parser-friendly format(預估;確切 requirement 名由 grep 該 spec 命中後寫入):

```markdown
## REMOVED Requirements

### Requirement: <既有 requirement 名稱>

**Reason:** fast MVP demo 不展示衝突檢討功能,viewer / `/ui` 重做後無 UI 插槽承接;本 requirement 隨 conflict review 功能整體退役。

**Migration:** 無 — 沒有外部 consumer 依賴 issue/highlight/annotation Socket.IO event 與 viewer IssuePanel。如未來重新引入,以新 OpenSpec change form ADD requirements。

(可能多筆 ### Requirement,看 spec 命中數)
```

## 5. Verification 5 級(`/goal` acceptance)

```
L1 unit:
  cd bim-review-coordinator && npm run verify
  cd web-viewer-sample      && npm run build && npm run test:session-first
  python -m pytest tests -p no:cacheprovider
  cd bim-streaming-server   && python -m pytest tests/test_conversion_authority_api.py -q
L2 spec:
  npx openspec validate --specs --strict   # 全綠
L3 graph:
  gitnexus_impact 對所有改動 symbol      # 無 HIGH/CRITICAL
  gitnexus_detect_changes()                # 影響面 = expected
L4 container & network:
  docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml \
    --env-file .env.web-plane.host-kit.example up -d --build viewer
  netstat -ano | grep :5173                # 只 127.0.0.1
  netstat -ano | grep :8004                # 仍 0.0.0.0(coordinator 對 LAN)
  docker exec ai-bim-web-plane-host-kit-coordinator-1 node -e \
    "fetch('http://127.0.0.1:8004/health').then(r=>r.text()).then(console.log)"
                                            # → "ok"
L5 真實 UI / client 操作(mcp__claude-in-chrome):
  (A) coordinator /ui 視覺驗收
      - navigate http://127.0.0.1:8004/ui
      - read_page 確認 step bar = 3 顆數字(不再有「標記問題」「紀錄回寫」)
      - read_page 全文 grep「標示問題」「建立審查標註」「紀錄回寫」= 0 hit
      - find/click「建立示範審查會議」按鈕 → 卡片更新、session 出現
      - read_console_messages pattern「highlight|annotation|issue」= 0 hit
  (B) viewer 載入驗收
      - navigate http://127.0.0.1:5173/
      - javascript_tool document.querySelectorAll('[data-testid="issue-panel"]').length === 0
      - read_console_messages 無 import error / undefined module
  (C) LAN 隔離 spot-check
      - netstat 已視為強證據;外部 IP host-to-host probe 為 best-effort
  (D) gif_creator 錄 A 全程,命名 remove-conflict-review-ui-walkthrough.gif → 附 PR description
```

## 6. Blast radius / Risk

| 風險 | 評估 | 緩解 |
|---|---|---|
| `registerReviewNamespace` 改動影響啟動流程 | LOW | direct caller 僅 `createCoordinatorApp`;介面不變只移除內部 handler |
| `sessionStore` schema 變更 | LOW | 移除的是 issue 子欄位,主 schema (`session_id` / `kit_instance` / `artifact_bindings`) 不動 |
| `DemoControlPanel` 移除 IssuePanel/EventLogPanel 插槽後 layout 變空 | LOW | successor 重做整個 viewer 主畫面為全螢幕 stream,空插槽會被覆蓋 |
| OpenSpec validate `--strict` 失敗 | MEDIUM | REMOVED parser header 必須 `## REMOVED Requirements` 不能拼錯;scenario format 保留 `#### Scenario: ...` 結構 |
| 既有 archive(`2026-05-12-coordinator-session-lifecycle-events-audit`)曾鎖定 issue 相關 lifecycle event | LOW | 該 archive 是 audit endpoint 寫入,不阻擋 issue handler 刪除;event log 仍可記錄非 issue 事件 |
| GitNexus index stale | LOW | commit 後 PostToolUse hook 自動 `npx gitnexus analyze`;若 stale 跑 `--embeddings` 重新 build |
| `_bim-control` / `_worker` 已退役但 `bimControlClient` 仍存在 | LOW | 不全刪 client,只刪 issue methods;tests/fakes 內 `cloud_bim_control_api.py` 不動 |

## 7. Predecessor / Successor coupling

- 本 change = predecessor;merge + archive 完成後 NoSuccessorWhilePredecessorOpen gate 才開
- successor = `fast-ifc-link-demo-loop`(brainstorming `2026-05-21-fast-mvp-loop-overall-design.md` Section 3)
- successor 假設本 change 已 archive:viewer 已無 IssuePanel/EventLogPanel slot、coordinator socket 已無 issue handlers、`/ui` 步驟 ④⑤ 已刪、compose viewer 已 127.0.0.1 bind
- 如本 change 中途取消,successor 也要對應調整(回到舊 baseline 上做 net add + delete)

## 8. 文件對齊範圍(implementation 階段定稿)

`AGENTS.md` 預估命中段落(以實際 grep 為準):

- §5.4 Collaboration Flow(annotation event 廣播 sequence)
- §5.5 Review Result Visualization Flow(issue → DataChannel highlight)
- §7.4 Review 資料(`_bim-control` 為 review issue / annotation 權威)
- §8.x「不應做的事」內提到 annotation / issue 段落

`bim-review-coordinator/CLAUDE.md`:`review session lifecycle 事件` 段落內若含 annotation/issue 字眼

文字策略:**標記「已退役 - fast MVP 不包含」並收斂**,而非整段刪。理由:
- 保留歷史 context,給未來重新引入時參考
- successor 若重建協作機制以新 OpenSpec change ADD,可在那時 unmark
- 避免 AGENTS.md 章節編號連動變化
