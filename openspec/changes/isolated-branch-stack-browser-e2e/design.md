# Design — 隔離 branch stack browser E2E

## 1. 決策：為何開新 capability，而不是擴充既有 capability

| 候選 | 為何不選 |
|---|---|
| `runtime-verification-evidence` | 它管的是「evidence 分級與真實性」（Kit render、conversion、batch、mapping baseline），全部針對**部署區／host-native runtime 的產出內容**。隔離 stack 管的是**在哪裡跑、port 怎麼分配、如何證明沒污染部署區**，屬於執行場所而非 evidence 分級。塞進去會讓一個已有 20 條 Requirement 的 capability 再擴張，且 MODIFIED delta 需整段複製既有條文，變更面遠大於實際新增。 |
| `test-deploy-rebuild-workflow` | 它的三條 Requirement 全部約束「固定 deployment checkout + fresh `origin/main` + 只走 `deploy.ps1 -Build`」。隔離 stack 的存在前提正好相反——**驗證未 merge 的 branch**。混在一起會讓「只用 fresh origin/main」這條硬規則出現例外解讀。 |
| `demo-runtime-readiness-smoke` | 面向 demo 就緒度與 GPU/Kit tier 分類，與 branch 隔離無關。 |

結論：新 capability `isolated-branch-stack-verification`，責任邊界單一——**未 merge branch 的 runtime evidence 在哪裡取得、如何證明隔離、evidence 如何自我標示**。既有三個 capability 的條文一字不動。

## 2. Port 配置與保留集合

隔離 stack 只涵蓋三層：governance（CPU）、coordinator（control plane + `/ui`）、viewer dev server（browser）。

| 角色 | 部署區（保留，隔離 stack 禁用） | 隔離 branch stack |
|---|---|---|
| coordinator HTTP | `8004` | `8005` |
| governance HTTP | `49102` | `49103` |
| viewer dev server | `5173`／`5174` | `5180` |
| streaming server / runtime-manager | `8010`／`49101` | 不啟動 |
| Kit primary／spectator | `49100`／`49110–49150` | 不啟動 |

保留集合 = 部署區 port ∪ Kit range。launcher SHALL 在啟動前計算 resolved port set，與保留集合求交集；**非空即 fail closed**，不做「先啟動再回報」。

**parallel session offset**：接受非負整數 offset，resolved = base + offset（coordinator `8005+o`、governance `49103+o`、viewer `5180+o`）。governance base 距 Kit spectator range 起點 `49110` 只有 7，因此 offset 實務上限為 6；超過即被同一條不相交檢查擋下。這是刻意的：與其另配一組遠離 Kit 的 governance port 而讓既有 `a4-closeout.spec.ts`／`playwright.config.ts` 的 `49103`／`8005` 慣例失效，不如保留慣例並讓越界 fail closed。

**為何 fail closed 而非自動找空 port**：自動配置會讓 evidence 裡的 port 每次不同，reviewer 無法用固定表判斷「這份 evidence 是不是打到部署區」。固定 base + 明示 offset + 拒絕越界，才能讓 stack manifest 成為可比對的機器事實。

## 3. 控制流與資料流

```txt
launcher (scripts/dev/start-isolated-branch-stack.ps1 -Action start [-Offset n])
  → 解析 resolved port set
  → 與保留集合求交集；非空 → 退出並回報衝突 port 與 owner PID（不啟動任何服務）
  → port 清理 preflight：僅對 resolved port set 的 host-native listener 動作
  → 啟動 governance :49103+o  → 健康檢查
  → 啟動 coordinator :8005+o（governance base 指向上一步） → 健康檢查
  → 產出 stack manifest JSON
        { stack_kind, offset, ports{}, base_urls{}, head_sha, started_at, pids{} }

browser E2E (web-viewer-sample)
  → 讀 manifest 或 env 解析 coordinator base
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
| stack manifest | launcher（`artifacts/e2e/<change-id>/stack-manifest.json`） | 每次 start 覆寫；stop 後保留供 evidence 引用 |
| evidence manifest | 產出 evidence 的那個 change | 本 capability 只規定必要欄位，不代管內容 |
| browser base URL 解析 | `web-viewer-sample/playwright.config.ts` | 唯一解析點，spec 檔不得各自 hard-code fallback |

viewer dev server 由 Playwright 的 `webServer` 啟動（既有機制，`reuseExistingServer:false` + `strictPort`），launcher 不重複管理它——避免兩套生命週期互踩。

## 4. 環境限制與誠實邊界

- **無 GPU／無 Kit**：隔離 stack 不啟動 streaming server、Kit、WebRTC。任何 3D highlight、first frame、stage truth、DataChannel 結論**不得**由隔離 stack evidence 推得；需要時仍走 host-native Kit 既有契約（每埠單一 viewer，primary `49100` + spectator `49110–49150`），並在 evidence 中分開標示。
- **不是 design gate**：pixel diff 與 semantic states 由 `verify-design-system-reference.ps1` / `verify-design-system-visual-result.ps1` 判定，與本 capability 正交。隔離 stack 的截圖是 functional evidence，不是 golden。
  - **且該路徑目前為紅**（2026-07-29 唯讀查證，subject `13033cb`）：`design-semantic-visual` FAILURE，唯一失敗項 `workspace.a4.default`（diff ratio `0.2794` / `0.3186` > `0.01`），成因是 `#a4` 的 route IA 遷移使 golden 描繪的**已填充** A4 dock 面板已無路由可達（dock tab 與 `A4Dock` 元件仍在，面板被掏空為導流卡），非本 change 造成。詳見 `proposal.md`「相鄰既有缺口」表 D-1～D-13 與「三層交叉對抗驗證」節。因此「design gate 由既有路徑判定」**不得**被讀成「既有路徑健康、可直接引用為綠」；本 change 的 evidence 亦不得用來推論該紅燈已解除。
- **不是部署路徑驗證**：`Deploy dry-run command` / `Full deploy tested` 欄位仍必須來自部署區或 `deploy.ps1`，不得以隔離 stack 代替。
- **Windows host-native**：launcher 為 PowerShell，走既有 `scripts/lib/preflight-ports.ps1`／`host-native-launcher.ps1` 慣例；POSIX mirror 不在本 change 範圍。
- **artifacts 入庫**：`artifacts/e2e/**` 的 PNG 依 repo 既有 `.gitignore` 設計需要明確入庫動作（`git add -f`）；本 capability 只要求「evidence 路徑可被 reviewer 取得」，不強制一定要 commit 二進位檔，但 PR body SHALL 給出可解析的路徑或 CI artifact 連結。

## 5. 已知風險

| 風險 | 處置 |
|---|---|
| launcher 的 port 清理誤殺部署區進程 | 清理範圍硬綁 resolved port set；resolved set 由 base+offset 計算後先過不相交檢查，檢查未過就不進入清理階段 |
| offset 慣例與 Kit range 太近，parallel session 上限只有 7 | 明示於 spec 與文件；越界 fail closed 而非靜默 wrap |
| E2E 改為 require-real 後既有綠燈變紅 | 這是揭露既有假通過，不是回歸。首次落地時把 red 結果誠實記為 known gap 交回對應 change，不在本 change 修其他 capability 的實作 |
| 兩處（doc 與 script）port 表漂移 | machine check 直接比對 doc 表格、registry 與 launcher 的常數，漂移即 CI fail |
| A4 與本 change 同時在飛 | capability 不重疊；A4 若先用本 branch harness，PR body 揭露來源 branch/commit |
| main 的 `design-semantic-visual` 已為紅燈（**advisory job，非 branch protection 的 required context**），易被誤判為本 change 造成的回歸 | 成因與歸屬已記於 `proposal.md`「相鄰既有缺口」D-1～D-13；task 6.6 要求 PR body 揭露該紅燈為 pre-existing 且非本 change 範圍。⚠ 本 PR 只動 `docs/plans/` 與 `openspec/**`，未觸發 `ci.yml` 的 `frontend_visual_required`，故本 PR 的 `design-semantic-visual` 實際為 **skipped** 而非 failure——揭露時 SHALL 據實描述，不得宣稱本 PR 帶著該紅燈 |
| 本 change 在 `lifecycle-ledger.json` 新增第 5 筆 `status:"active"`，撞上 `scripts/tests/test-ai-coding-metrics.mjs` 對 `active-change-wip` 的硬編碼期望值，使 required check `agent-governance` 轉紅 | 已於本 change 內修正：該兩處期望值改由同一份 ledger 推導（`activeChangeCount`），不再硬編碼。WIP 預算上限（≤6）的真正 gate 在 `scripts/tests/verify-openspec-lifecycle.ps1`，未受影響。tasks 6.2 已擴為三步順序契約 |
| `design-canon-change-control` R-A2 只允許雙旗標腳本寫機器快照面，而該腳本無法增刪 `screens[]` 或改 route 歸屬；route IA 變更後 manifest 無合法更新路徑（**latent**：目前結構性斷言仍全數成立，且封鎖為三道牆而非一道） | 屬治理缺口，本 change 不代為裁決；記於 `proposal.md` D-4。**不指派 owner**——「rebaseline ownership」是 `align-frontend-design-system-reference` 解凍前必裁的四項互斥設計之一，指派即預決 crosswalk 結論（見 U-3）。本 change 全程不觸碰 manifest 與 baseline |
