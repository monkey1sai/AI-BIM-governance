# AI-BIM-governance 協作規則

本檔只保留會影響安全、產品邊界與交付品質的規則。衝突時依序採用：使用者最新明確指令、本檔、`CLAUDE.md`、工具預設。

## 工作區與變更範圍

- 主工作區維持 `main == origin/main` 且 tracked files 乾淨；程式或受版控檔案一律在獨立 sibling worktree 與獨立 branch 修改。
- 開始前先讀相關 source、tests 與本檔連結的必要文件；保留使用者既有修改，不做無關重構。
- 不得揭露或修改 credentials，不得繞過 branch protection、CODEOWNERS、ACL 或 review。
- 禁止未經明確授權的 force push、admin bypass、production deploy、migration、權限變更、破壞性清理與財務操作。
- `.env` 可讀取作本機驗證，但不得回顯值或修改既有秘密；`.env.example` 可維護。

## 產品邊界

變更前先確認 owning service；詳細邊界見 `docs/agents/repository-boundaries.md`。

| Service | Responsibility |
|---|---|
| `bim-review-coordinator` (:8004) | 對外 IFC-ready intake、session/control、browser-facing governance proxy |
| `bim-streaming-server` (49100/49101) | internal IFC→USDC conversion、Kit/WebRTC runtime |
| `governance-service` (:49102 loopback) | A1/A2/A3 rules、diff、federation、issue/BCF authority |
| `web-viewer-sample` (:5173) | browser client；REST/Socket.IO 到 coordinator，WebRTC/DataChannel 到 Kit |
| `apps/kit-manager-web` / `services/kit-manager-api` (:8010) | operator UI、Kit fleet operations/telemetry |

公司雲端 `bim-control` 與客戶 IFC Worker 是外部服務，本 repo 不 mirror 或啟動。產品現況以 code 和 tests 為準；目標需求入口為 `docs/plans/docs-plans-README.md`。

## 實作與驗證

- 先重現最小 baseline，再做最小有效改動；不新增未要求的抽象、依賴或設定層。
- 依受影響 service 執行 targeted tests；命令見 `docs/agents/local-verification.md`。
- User-facing workflow 必須以真 API/runtime 加 Functional & Semantic browser E2E 驗證；Kit/WebRTC 另保留 first frame、Stage、DataChannel 與 ACK 證據。
- Runtime/deploy 變更必須驗證 canonical `scripts/deploy.ps1` 路徑；正式測試部署只從已合併且 freshly fetched 的 `origin/main` 執行。
- 完成時列出 changed paths、實際執行的 checks、未驗證項目與風險。失敗、跳過或歷史證據不得當作本次通過。

## GitHub 交付

- PR 使用 `.github/PULL_REQUEST_TEMPLATE.md` 的七個人類可讀段落。
- `main` 要求經 PR 合併、`pr-safety` 通過（branch 須與 `main` 同步到最新）與所有對話已解決；管理員不得繞過，禁止 force push 與刪除。2026-09-24 起不再要求 GitHub 核准（取消 CODEOWNER 核准與 last-push approval）；合併授權來自 owner 對該 PR 的明確指示。
- `pr-safety` 是唯一 required check，本身不跑檢查，只彙總同 workflow 的其他 job：`safety`（每個 PR 都跑，做 diff whitespace/conflict-marker、changed JSON 語法、changed PowerShell 語法與新增行秘密掃描）與 `.github/scripts/ci-scope.mjs` 依 changed paths 選出的 service jobs（coordinator、viewer、governance、streaming、cfd_tools、kit_manager_api、kit_manager_web、root_contracts、vocabulary）。`safety` 非 success、該跑卻 skip、不該跑卻 fail/cancel、classifier 未成功，一律判失敗。
- CI 不含 browser/Kit/WebRTC/GPU E2E、`scripts/tests/*.ps1` 與 compose config；這些仍是本機與真站驗證。`pr-safety` 綠燈不取代人工審查。
- 自動審查、代理批准、自動合併與自動部署不構成 merge authority。合併前重讀 exact head、required check、unresolved threads 與 mergeability。
- 不得由 agent 冒充人類核准；merge/deploy 各自需要明確授權。

## 精簡文件

- 服務與資料流：`docs/agents/repository-boundaries.md`
- 本機驗證：`docs/agents/local-verification.md`
- worktree、GitHub、部署與程序停止安全：`docs/agents/delivery-safety.md`
- 從退役 OpenSpec 遷移的未完成產品需求：`docs/plans/remaining-product-backlog.md`
