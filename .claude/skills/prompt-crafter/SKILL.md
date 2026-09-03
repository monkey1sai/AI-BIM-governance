---
name: prompt-crafter
description: Use when the user asks to craft or standardize a task prompt, mentions 差不多先生 or anti-shortcut, or wants a kickoff prompt before a coding agent starts implementation.
---

# Prompt Crafter

Turn a vague request into a copy-paste kickoff prompt. This skill **emits a prompt**; it does not implement the feature unless the user also asked to implement.

**Core principle:** A prompt with a missing required slot is invalid. Do not emit "should be enough" prose.

## When

- User wants a task prompt for Claude / Codex / Grok / Gemini
- User says agents skip details, invent APIs, or claim done without evidence
- User starts with `/prompt-crafter`

Do **not** use this skill to add more AGENTS.md rules or open a meta-governance PR.

## How to assemble

1. Extract lane, service, goal, success/failure states from the user text.
2. Fill **every** required slot in the output recipe. Unknown file paths stay `先空著；Read 之後才能填` — never invent `src/components/...`.
3. Copy the verify command from the table below. Do not guess an interpreter.
4. Output one Markdown `text` code block the user can paste into the next session.
5. If the request is only "make me a prompt", stop after the block. Do not start coding.

Lane: F = 1–3 files, one service, no contract. B = one service, bounded feature, no public API/schema. G = ≥2 services, public API/schema, user-facing route, Kit/WebRTC, deploy/auth. Never self-upgrade to Lane S / spec-to-done. Lane G 的 `[目標服務]` 與 `[驗證指令]` 槽必須列出**每一個**受影響服務與各自的驗證指令，再加一條 integration／browser E2E。

## Service verify commands

Copy from this table (aligned with `docs/agents/sub-repo-verify-commands.md`). Do **not** default every Python service to repo-root `.venv`.

| Service | Frozen / boundary | Verify |
|---|---|---|
| `bim-review-coordinator` `:8004` | Session / intake / proxy. Do not invent backend fields. | `cd bim-review-coordinator; npm test` |
| `governance-service` `:49102` | Loopback A1/A2/A3/BCF. **Frozen for frontend / cross-service tasks:** `app.py`（governance-service 自身的後端任務可改，但一律 Lane G＋`gitnexus impact`） | `cd governance-service; & "C:\Program Files\Python312\python.exe" -m pytest tests/ -v` |
| `web-viewer-sample` `:5173` | Browser client. **Only** call coordinator `:8004`. R2 tri-state. **Ban:** `governanceProxy.ts`, direct `:49101`/`:49102`/`:8010` | `cd web-viewer-sample; npm run test:session-first` (+ Playwright if user-facing) |
| `bim-streaming-server` `49100/49101` | IFC→USDC + Kit. **Ban:** `conversion_authority.py`. Kit needs first-frame/stage evidence. | `cd bim-streaming-server; python -m pytest tests/test_conversion_authority_api.py -q` |
| `services/kit-manager-api` `:8010` | Kit fleet API | `cd services/kit-manager-api; python -m pytest tests -q` |
| `apps/kit-manager-web` | Kit operator UI | `cd apps/kit-manager-web; npm run build` |

GitNexus (Lane B/G): `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`. After symbol/flow edits: `gitnexus detect-changes --scope compare --base-ref main`.

Worktree (any versioned write): Windows → `pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName <type>/<slug> -Json`。POSIX（無 `pwsh`）→ `git fetch origin --prune && git worktree add -b <type>/<slug> ../AI-BIM-governance.worktrees/<slug> origin/main`，開工前貼出 `git rev-parse HEAD` == `git rev-parse origin/main` 且 `git status --porcelain` 為空的證明。Ban：不從 freshly fetched `origin/main` 起的 `git worktree add`、`.claude/worktrees/`、repo-inner `.worktrees/`。Superpowers `using-git-worktrees` default location is **wrong** for this repo.

Task packet: emit JSON `task-packet/v2` and require `node scripts/dev/validate-task-packet.mjs --input <file>` (`valid: true` only). `<file>` 必須放在 repo 外（如 `$TEMP`／scratchpad）或 gitignored 的 `.agents/` 之下，且在 governed worktree 建好之後才寫；放進主 checkout 會讓 helper 以 `primary_checkout_invariant_failed` 拒絕。Packet does **not** authorize writing on `main`; user iron law still requires the governed worktree.

## Output recipe

Emit exactly this shape. Replace `<…>` with values from the request. Leave a slot blank only when the crafter cannot know it, and say so.

```text
[任務分級]: Lane <F / B / G>（禁止自行升為 Lane S / spec-to-done）
[目標服務]: <service + port from the table；Lane G 列出每一個受影響服務>
[涉及檔案/模組]: <真實路徑，或「先空著；Read 之後才能填」>
[需求來源]: <docs/plans 段落 | contract | issue | 本訊息>
[驗證指令]: <exact command from the table；Lane G 每個受影響服務一條＋一條 integration／Playwright E2E>

你是 AI-BIM-governance 的單一 coordinator。做不到就 HELD，不准差不多。

### 一、需求目標
1. <一句可驗證行為，含 route/button 或 API/status>
2. <成功時必須看見什麼>
3. <失敗/空集合/未支援時必須看見什麼；前端 R2：supported/unsupported/planned>

非目標：重構鄰近檔、補無關文件、修無關 lint、開治理工具 PR、改凍結面。

### 二、防偷懶硬約束（違反任一口 → 停工，狀態=HELD）
1. 零佔位符：禁止 TODO/FIXME/`...其餘代碼`/空 catch/用 mock 當完成。
2. 定義優先：改或呼叫任何函式/API/欄位前必須先 Read 真實檔案。回報「已讀路徑 + 符號名」。
3. 主工作區只讀。受版控寫入前必須先建 governed worktree：Windows 跑
   `pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName <type>/<slug> -Json`；
   POSIX 跑 `git fetch origin --prune && git worktree add -b <type>/<slug> ../AI-BIM-governance.worktrees/<slug> origin/main`。
   兩者都要貼出 `git rev-parse HEAD` == `git rev-parse origin/main` 且 `git status --porcelain` 為空。
4. 凍結面（前端／跨服務任務）：禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`；前端只打 `:8004`；後端沒有的能力標 planned/NOT BUILT。任務本身就是該服務的後端變更時，不套此禁令，但一律 Lane G＋先跑 `gitnexus impact`。
5. 驗證指令必須用上方 [驗證指令] 槽，不准改 interpreter。
6. 禁止完成用語：should / probably / 應該過了 / 看起來對 / 理論上。沒有本輪終端機輸出，不准說 pass/done/完成。
7. Superpowers / spec-to-done / push / 開 PR / merge：未在使用者訊息被點名，一律不做。例外：Lane G 契約要求的 **PR local preflight**（本機 gate，不 push、不開 PR）必須做，做不到就 HELD。
8. 開工：`node scripts/dev/agents-board.mjs register --agent <cli> --task "<一句話>"`，記下輸出的 session id，然後 `status`。已有 active writer 重疊檔案就停。收工必跑 `node scripts/dev/agents-board.mjs done --agent <cli> --session <id>`。

### 三、執行步驟（未勾完不得進入下一步；依 Lane 只貼一份）

Lane F / B（最多 5 條，對齊 AGENTS.md 的 3–5 項 inline checklist）：
1. [ ] board register（記 session id）+ status；建立 governed worktree（貼 helper JSON 或 POSIX 證明）
2. [ ] 在 repo 外／`.agents/` 寫 task-packet JSON（`task-packet/v2`），`validate-task-packet.mjs` 回 `valid: true`；Read 目標檔與呼叫端，Lane B 改 symbol 前跑 `gitnexus impact`（HIGH/CRITICAL 先回報）
3. [ ] 最小 diff
4. [ ] 跑 [驗證指令]（完整、新鮮、讀 exit code）；Lane B 改了 symbol 再跑 `gitnexus detect-changes --scope compare --base-ref main`
5. [ ] 停在 worktree（未點名不 push／開 PR）；`agents-board.mjs done --agent <cli> --session <id>`

Lane G：
1. [ ] board register（記 session id）+ status；建立 governed worktree（貼 helper JSON 或 POSIX 證明）
2. [ ] 在 repo 外／`.agents/` 寫 task-packet JSON，`validate-task-packet.mjs` 回 `valid: true`
3. [ ] Read 每個受影響服務的目標檔與呼叫端；改 shared/exported symbol 前跑 `gitnexus impact`，HIGH 要補強策略、CRITICAL 要 sign-off
4. [ ] 最小 diff（每個受影響服務各自最小）
5. [ ] 每個受影響服務跑各自的 [驗證指令]，再跑 integration／user-facing Playwright E2E（完整、新鮮、讀 exit code）
6. [ ] `gitnexus detect-changes --scope compare --base-ref main`
7. [ ] PR local preflight（本機 gate；未點名不 push、不開 PR）
8. [ ] `agents-board.mjs done --agent <cli> --session <id>`

### 四、完成標準（缺一列 = HELD）
最終回覆分四塊：Verified facts / Inferences / Unverified risks / Next actions。

必填：Changed files；已 Read 的定義（路徑 + 符號）；驗證命令 + 本輪 exit code + 失敗數（貼 log 片段）；GitNexus 結果或「Lane F 未跑，原因」；Edge cases；Known gaps。

user-facing 再加（沒證據填 not observed，Full completion claimed=no）：
Frontend route / Main button(s) tested / Fixture used / Backend API called / Runtime action / ID / Visible success or failure state / E2E command / Screenshot / trace / Design gate status / Known gaps
```

## Example

User: 「我想在 web-viewer-sample 增加一個檢查 BCF 匯出狀態的按鈕，如果後端還沒實作就顯示 planned」

```text
[任務分級]: Lane G (Governed Change)（新增 user-facing 按鈕與可觀測 BCF 狀態流程 → AGENTS.md Lane G「user-facing route/workflow」）
[目標服務]: web-viewer-sample (:5173)；只打 bim-review-coordinator (:8004) 既有 proxy，不改 coordinator／governance 程式碼
[涉及檔案/模組]: 先空著；Read 之後才能填。候選起點：web-viewer-sample/src/console/a1Machine.ts、Window.tsx 內 governanceClient.bcfExportUrl、既有 a1Machine.test.ts
[需求來源]: 本訊息
[驗證指令]: cd web-viewer-sample; npm run test:session-first；再跑 user-facing Playwright E2E（route/button/Loading/Success/Failure/Planned 四態 + trace）

你是 AI-BIM-governance 的單一 coordinator。做不到就 HELD，不准差不多。

### 一、需求目標
1. 在既有治理/A1 面增加「檢查 BCF 匯出狀態」控制與狀態指示，不新開入口 route。
2. 只打 coordinator `:8004` 既有 BCF/governance proxy；成功時 UI 顯示匯出狀態與相關 id。
3. 後端 501 / 未支援 / 契約為 planned 時，UI 顯示 Planned，不得崩潰或臆造 payload。

非目標：改 governance `app.py`、改 coordinator `governanceProxy.ts`、直連 `:49102`。

### 二、防偷懶硬約束
1. 零佔位符：Loading / Success / Failure / Planned 四態都要實作。
2. 定義優先：先 Read `bcfExportUrl` 與 A1 machine 既有 `bcfExported` gating，禁止發明新 endpoint。
3. 主工作區只讀；用 `scripts/dev/new-governed-worktree.ps1` 從 origin/main 開工。
4. 驗證指令不得改成 root `.venv` pytest。

### 三、執行步驟（Lane G）
1. [ ] board register（記 session id）+ status；governed worktree
2. [ ] 在 repo 外寫 Lane G task-packet 並 `node scripts/dev/validate-task-packet.mjs --input <file>`
3. [ ] Read 真實 BCF client/型別；`gitnexus impact` 打到的 symbol
4. [ ] 最小 diff
5. [ ] `cd web-viewer-sample; npm run test:session-first`；再跑 Playwright E2E（四態 + trace/screenshot）
6. [ ] `gitnexus detect-changes --scope compare --base-ref main`
7. [ ] PR local preflight（不 push、不開 PR）
8. [ ] `agents-board.mjs done --agent <cli> --session <id>`

### 四、完成標準
Verified facts / Inferences / Unverified risks / Next actions。
必填：Changed files、已 Read 路徑+符號、本輪 PASS log、四態（含 Planned）證據、Playwright E2E command + screenshot/trace、Known gaps。
user-facing 欄位齊；缺的填 not observed，Full completion claimed=no。
```

## Rationalizations

| Excuse | Reality |
|---|---|
| 「路徑先填 src/components 沒關係」 | 那是臆造。填「先空著；Read 之後才能填」。 |
| 「Python 一律 .venv」 | governance-service 必須用 `C:\Program Files\Python312\python.exe`。 |
| 「Lane F 所以可以在 main 改」 | 任何受版控寫入都走 governed worktree。 |
| 「packet 通過就可以開工」 | packet 只驗結構，不授權在 main 寫入。 |
| 「skill 很長，我縮成四行」 | 缺槽位的輸出是無效產出。重填 recipe。 |
| 「這次只是 prompt，先實作再說」 | 使用者沒說實作就停在 code block。 |
