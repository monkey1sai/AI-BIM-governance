# Design — 隔離 branch stack browser E2E

## 1. 決策：為何開新 capability，而不是擴充既有 capability

| 候選 | 為何不選 |
|---|---|
| `runtime-verification-evidence` | 它管的是「evidence 分級與真實性」（Kit render、conversion、batch、mapping baseline），全部針對**部署區／host-native runtime 的產出內容**。隔離 stack 管的是**在哪裡跑、port 怎麼分配、如何證明沒污染部署區**，屬於執行場所而非 evidence 分級。塞進去會讓一個已有 20 條 Requirement 的 capability 再擴張，且 MODIFIED delta 需整段複製既有條文，變更面遠大於實際新增。 |
| `test-deploy-rebuild-workflow` | 它的三條 Requirement 全部約束「固定 deployment checkout + fresh `origin/main` + 只走 `deploy.ps1 -Build`」。隔離 stack 的存在前提正好相反——**驗證未 merge 的 branch**。混在一起會讓「只用 fresh origin/main」這條硬規則出現例外解讀。 |
| `demo-runtime-readiness-smoke` | 面向 demo 就緒度與 GPU/Kit tier 分類，與 branch 隔離無關。 |

結論：新 capability `isolated-branch-stack-verification`，責任邊界單一——**未 merge branch 的 CPU governance／coordinator／browser operability evidence 在哪裡取得、如何證明隔離、evidence 如何自我標示**。Kit／WebRTC／GPU evidence 仍屬 host-native runtime，既有三個 capability 的條文一字不動。

## 2. Port 配置與保留集合

隔離驗證切片涵蓋 governance（CPU）、coordinator（control plane + `/ui`）與 browser viewer。repo-owned launcher 只擁有 governance／coordinator 的 backend lifecycle；viewer dev server 的 lifecycle 由 Playwright `webServer` 唯一擁有。

| 角色 | 部署區（保留，隔離 stack 禁用） | 隔離 branch stack |
|---|---|---|
| coordinator HTTP | `8004` | `8005` |
| governance HTTP | `49102` | `49103` |
| viewer dev server | `5173`／`5174` | `5180` |
| streaming server / runtime-manager | `8010`／`49101` | 不啟動 |
| Kit primary／spectator | `49100`／`49110–49150` | 不啟動 |

保留集合 = 部署區 port ∪ Kit range。launcher SHALL 在啟動前計算 resolved port set，與保留集合求交集；**非空即 fail closed**，不做「先啟動再回報」。

**parallel session offset**：只接受整數 `0..4`，resolved = base + offset（coordinator `8005+o`、governance `49103+o`、viewer `5180+o`）。launcher SHALL 先驗證 domain；負值、非整數或 `>4` 必須在 listener 查詢、cleanup 或服務啟動之前 fail closed。通過 domain 後仍須執行保留集合交集檢查；因此目前只有五組連續且可預測的隔離配置，不存在 offset `5`、`7..47` 或 `48+` 重新變合法的洞。

**為何 fail closed 而非自動找空 port**：自動配置會讓 evidence 裡的 port 每次不同，reviewer 無法用固定表判斷「這份 evidence 是不是打到部署區」。固定 base + 明示 offset + 拒絕越界，才能讓 stack manifest 成為可比對的機器事實。

## 3. 控制流與資料流

```txt
launcher (scripts/dev/start-isolated-branch-stack.ps1 -Action start -ChangeId <slug> -RunId <run-id> [-Offset n])
  → 驗證 ChangeId/RunId 為安全單一路徑 segment；缺值或既有同名 manifest即失敗，不覆寫
  → 驗證 offset 為 0..4；非法值在任何 listener/cleanup 動作前失敗
  → 解析 resolved port set
  → 與保留集合求交集；非空 → 退出並回報衝突 port 與 owner PID（不啟動任何服務）
  → port ownership preflight：只認 manifest PID + 精確 launcher entrypoint + process creation identity 三者一致的既有 backend
  → 只有 ownership 可證明時才可停止；未知／不一致 listener → fail closed，不停止任何 process
  → 啟動 governance :49103+o  → 健康檢查
  → 啟動 coordinator :8005+o（governance base 指向上一步） → 健康檢查
  → 產出 stack manifest JSON
        { stack_kind, offset, ports{}, base_urls{}, head_sha, started_at,
          lifecycle_owners{}, backend_ready{}, processes[{pid, entrypoint, creation_identity}] }

browser E2E (web-viewer-sample; viewer lifecycle owner = Playwright webServer)
  → 由必填 E2E_STACK_MANIFEST 讀 manifest；路徑須位於本 worktree artifacts/e2e/<change>/<run>/ 且 head_sha=HEAD
  → 解析 coordinator base 與 resolved viewer port
  → 若 E2E_COORDINATOR_BASE_URL 存在且與 manifest coordinator base 不同 → throw
  → 若 E2E_VIEWER_PORT 存在且與 manifest viewer port 不同 → throw
  → base 落入保留集合 → throw（不執行任何 spec）
  → viewer dev server 由 Playwright webServer 啟動，注入
        VITE_COORDINATOR_API_BASE = 隔離 coordinator origin
  → 全場掛 request watcher：任何 request 命中保留集合 port → 該 spec fail
  → require-real 模式：缺前置條件 = hard failure，不得 test.skip
  → screenshot / trace / console / network → artifacts/e2e/<change-id>/
  → 回寫 evidence manifest（stack_kind + observed runtime IDs + artifact 路徑）
```

**Source of truth 歸屬**：

| 資料 | 擁有者 | 說明 |
|---|---|---|
| port 配置與保留集合 | `openspec/specs/isolated-branch-stack-verification`（本 spec）→ 由 launcher 實作 | 文件與 script 都不得各自維護第二份表 |
| stack manifest | launcher（`artifacts/e2e/<change-id>/<run-id>/stack-manifest.json`） | `ChangeId`／`RunId` 皆由 caller 明示且只允許安全單一路徑 segment；同名 manifest 已存在即 fail closed，不覆寫。記錄 backend lifecycle owner、ready state 與可重驗 process identity；stop 後保留供 evidence 引用 |
| evidence manifest | 產出 evidence 的那個 change | 本 capability 只規定必要欄位，不代管內容 |
| browser manifest／coordinator base／viewer port 解析 | `web-viewer-sample/playwright.config.ts` | evidence run 必填 `E2E_STACK_MANIFEST`，且限定本 worktree 的 `artifacts/e2e/<change>/<run>/stack-manifest.json`、`head_sha=HEAD`；manifest 的 coordinator base 與 viewer port 皆為 authority，對應 env 只能相同、不得覆寫 |

launcher 的 `start`／`stop`／`status` 僅管理 governance／coordinator backend；三個 action 都以同一組 `-ChangeId`／`-RunId` 定位唯一 manifest。viewer dev server 由 Playwright 的 `webServer` 啟動，launcher 不啟停 viewer；status 只回報 manifest 所期待的 viewer port 與「external/Playwright-owned」狀態。若保留 `E2E_DISABLE_WEBSERVER=1`，外部 viewer 也必須已在 manifest 的同一 resolved viewer port 上，否則 fail closed。

## 4. 環境限制與誠實邊界

- **無 GPU／無 Kit**：隔離 stack 不啟動 streaming server、Kit、WebRTC。任何 3D highlight、first frame、stage truth、DataChannel 結論**不得**由隔離 stack evidence 推得；需要時仍走 host-native Kit 既有契約（每埠單一 viewer，primary `49100` + spectator `49110–49150`），並在 evidence 中分開標示。
- **不是 design gate**：pixel diff 與 semantic states 由 `verify-design-system-reference.ps1` / `verify-design-system-visual-result.ps1` 判定，與本 capability 正交。隔離 stack 的截圖是 functional evidence，不是 golden。
  - **該路徑的歷史事件**（2026-07-29）：`design-semantic-visual` 曾於 `13033cb` FAILURE，並由 #429（`2b9573e`）就地重核 A4 golden 轉 success；`bfcc433` 是當時的 success 快照，不是本 change 的 current-main 宣告。本 change 的 fresh baseline 是 `deb5af552022c3ee171e3174f59c9f1e3dfb5936`，PR 當下狀態仍必須以實跑 job 與 run link 重驗。詳見 `proposal.md` D-1／D-15。原則不變：隔離 stack evidence 不得推論 design gate 狀態。
- **不是部署路徑驗證**：`Deploy dry-run command` / `Full deploy tested` 欄位仍必須來自部署區或 `deploy.ps1`，不得以隔離 stack 代替。
- **Windows host-native**：launcher 為 PowerShell，走既有 `scripts/lib/preflight-ports.ps1`／`host-native-launcher.ps1` 慣例；POSIX mirror 不在本 change 範圍。
- **artifacts 入庫**：`artifacts/e2e/**` 的 PNG 依 repo 既有 `.gitignore` 設計需要明確入庫動作（`git add -f`）；本 capability 只要求「evidence 路徑可被 reviewer 取得」，不強制一定要 commit 二進位檔，但 PR body SHALL 給出可解析的路徑或 CI artifact 連結。

## 5. 已知風險

| 風險 | 處置 |
|---|---|
| launcher 的 port 清理誤殺其他 session 或部署區進程 | resolved set 先過 offset domain 與保留集合檢查；其後仍須以 manifest PID、精確 launcher entrypoint、creation identity 三重重驗 ownership。未知或不一致 listener 一律 fail closed，不停止 process |
| offset 慣例與保留集合太近 | domain 固定為 `0..4`，只提供五組連續配置；`>4` 在任何 listener／cleanup 前拒絕，不允許高 offset 繞回合法 |
| E2E 改為 require-real 後既有綠燈變紅 | 這是揭露既有假通過，不是回歸。首次落地時把 red 結果誠實記為 known gap 交回對應 change，不在本 change 修其他 capability 的實作 |
| 兩處（doc 與 script）port 表漂移 | machine check 直接比對 doc 表格、registry 與 launcher 的常數，漂移即 CI fail |
| A4 與本 change 同時在飛 | capability 不重疊；A4 若先用本 branch harness，PR body 揭露來源 branch/commit |
| `design-semantic-visual`（**advisory job，非 branch protection 的 required context**）的狀態隨 baseline 變動，PR body 若照抄舊敘述會失真 | 歷史時間線：`13033cb` failure → #429 起 success；`bfcc433` 只代表歷史快照。本 PR 必須在當下實跑並附 run link，才可描述目前狀態 |
| 本 change 在 `lifecycle-ledger.json` 新增第 5 筆 `status:"active"`，撞上 `scripts/tests/test-ai-coding-metrics.mjs` 對 `active-change-wip` 的硬編碼期望值，使 required check `agent-governance` 轉紅 | 已於本 change 內修正：該兩處期望值改由同一份 ledger 推導（`activeChangeCount`），不再硬編碼。WIP 預算上限（≤6）的真正 gate 在 `scripts/tests/verify-openspec-lifecycle.ps1`，未受影響。tasks 6.2 已擴為三步順序契約 |
| `design-canon-change-control` R-A2 只允許雙旗標腳本寫機器快照面，而該腳本無法增刪 `screens[]` 或改 route 歸屬；route IA 變更後 manifest 無合法更新路徑（**latent**：目前結構性斷言仍全數成立，且封鎖為三道牆而非一道） | 屬治理缺口，本 change 不代為裁決；記於 `proposal.md` D-4。**不指派 owner**——「rebaseline ownership」是 `align-frontend-design-system-reference` 解凍前必裁的四項互斥設計之一，指派即預決 crosswalk 結論（見 U-3）。本 change 全程不觸碰 manifest 與 baseline |
