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

Lane: F = 1–3 files, one service, no contract. B = one service, bounded feature, no public API/schema. G = ≥2 services, public API/schema, user-facing route, Kit/WebRTC, deploy/auth. Never self-upgrade to Lane S / spec-to-done.

## Service verify commands

Copy from this table (aligned with `docs/agents/sub-repo-verify-commands.md`). Do **not** default every Python service to repo-root `.venv`.

| Service | Frozen / boundary | Verify |
|---|---|---|
| `bim-review-coordinator` `:8004` | Session / intake / proxy. Do not invent backend fields. | `cd bim-review-coordinator; npm test` |
| `governance-service` `:49102` | Loopback A1/A2/A3/BCF. **Ban:** `app.py` | `cd governance-service; & "C:\Program Files\Python312\python.exe" -m pytest tests/ -v` |
| `web-viewer-sample` `:5173` | Browser client. **Only** call coordinator `:8004`. R2 tri-state. **Ban:** `governanceProxy.ts`, direct `:49101`/`:49102`/`:8010` | `cd web-viewer-sample; npm run test:session-first` (+ Playwright if user-facing) |
| `bim-streaming-server` `49100/49101` | IFC→USDC + Kit. **Ban:** `conversion_authority.py`. Kit needs first-frame/stage evidence. | `cd bim-streaming-server; python -m pytest tests/test_conversion_authority_api.py -q` |
| `services/kit-manager-api` `:8010` | Kit fleet API | `cd services/kit-manager-api; python -m pytest tests -q` |
| `apps/kit-manager-web` | Kit operator UI | `cd apps/kit-manager-web; npm run build` |

GitNexus (Lane B/G): `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`. After symbol/flow edits: `gitnexus detect-changes --scope compare --base-ref main`.

Worktree (any versioned write): `pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName <type>/<slug> -Json`. Ban bare `git worktree add`, `.claude/worktrees/`, repo-inner `.worktrees/`. Superpowers `using-git-worktrees` default location is **wrong** for this repo.

Task packet: emit JSON `task-packet/v2` and require `node scripts/dev/validate-task-packet.mjs --input <file>` (`valid: true` only). Packet does **not** authorize writing on `main`; user iron law still requires the governed worktree.

## Output recipe

Emit exactly this shape. Replace `<…>` with values from the request. Leave a slot blank only when the crafter cannot know it, and say so.

```text
[任務分級]: Lane <F / B / G>（禁止自行升為 Lane S / spec-to-done）
[目標服務]: <service + port from the table>
[涉及檔案/模組]: <真實路徑，或「先空著；Read 之後才能填」>
[需求來源]: <docs/plans 段落 | contract | issue | 本訊息>
[驗證指令]: <exact command from the table>

你是 AI-BIM-governance 的單一 coordinator。做不到就 HELD，不准差不多。

### 一、需求目標
1. <一句可驗證行為，含 route/button 或 API/status>
2. <成功時必須看見什麼>
3. <失敗/空集合/未支援時必須看見什麼；前端 R2：supported/unsupported/planned>

非目標：重構鄰近檔、補無關文件、修無關 lint、開治理工具 PR、改凍結面。

### 二、防偷懶硬約束（違反任一口 → 停工，狀態=HELD）
1. 零佔位符：禁止 TODO/FIXME/`...其餘代碼`/空 catch/用 mock 當完成。
2. 定義優先：改或呼叫任何函式/API/欄位前必須先 Read 真實檔案。回報「已讀路徑 + 符號名」。
3. 主工作區只讀。受版控寫入前必須先跑
   `pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName <type>/<slug> -Json`
   並證明 `git rev-parse HEAD` == `git rev-parse origin/main` 且 `git status --porcelain` 為空。
4. 凍結面：禁改 governance `app.py`、coordinator `governanceProxy.ts`、streaming `conversion_authority.py`。前端只打 `:8004`。後端沒有的能力標 planned/NOT BUILT。
5. 驗證指令必須用上方 [驗證指令] 槽，不准改 interpreter。
6. 禁止完成用語：should / probably / 應該過了 / 看起來對 / 理論上。沒有本輪終端機輸出，不准說 pass/done/完成。
7. Superpowers / spec-to-done / 開 PR / merge：未在使用者訊息被點名，一律不做。
8. 開工：`node scripts/dev/agents-board.mjs register --agent <cli> --task "<一句話>"` 然後 `status`。已有 active writer 重疊檔案就停。

### 三、執行步驟（未勾完不得進入下一步）
1. [ ] board register + status
2. [ ] 寫 task-packet JSON（schema `task-packet/v2`），跑 `node scripts/dev/validate-task-packet.mjs --input <file>`，`valid: true` 才能改檔
3. [ ] 建立 governed worktree；貼 helper JSON
4. [ ] Read 目標檔與呼叫端。Lane B/G 改 symbol 前跑 gitnexus impact；HIGH/CRITICAL 先回報
5. [ ] 最小 diff
6. [ ] 跑 [驗證指令]（完整、新鮮、讀 exit code）。失敗就修或 HELD
7. [ ] Lane B 改了 symbol 或 Lane G：`gitnexus detect-changes --scope compare --base-ref main`
8. [ ] 未要求 ship 就停在 worktree

### 四、完成標準（缺一列 = HELD）
最終回覆分四塊：Verified facts / Inferences / Unverified risks / Next actions。

必填：Changed files；已 Read 的定義（路徑 + 符號）；驗證命令 + 本輪 exit code + 失敗數（貼 log 片段）；GitNexus 結果或「Lane F 未跑，原因」；Edge cases；Known gaps。

user-facing 再加（沒證據填 not observed，Full completion claimed=no）：
Frontend route / Main button(s) tested / Fixture used / Backend API called / Runtime action / ID / Visible success or failure state / E2E command / Screenshot / trace / Design gate status / Known gaps
```

## Example

User: 「我想在 web-viewer-sample 增加一個檢查 BCF 匯出狀態的按鈕，如果後端還沒實作就顯示 planned」

```text
[任務分級]: Lane B (Bounded Change)
[目標服務]: web-viewer-sample (:5173)
[涉及檔案/模組]: 先空著；Read 之後才能填。候選起點：web-viewer-sample/src/console/a1Machine.ts、Window.tsx 內 governanceClient.bcfExportUrl、既有 a1Machine.test.ts
[需求來源]: 本訊息
[驗證指令]: cd web-viewer-sample; npm run test:session-first

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

### 三、執行步驟
1. [ ] board register + status
2. [ ] 寫 Lane B task-packet 並 `node scripts/dev/validate-task-packet.mjs --input <file>`
3. [ ] governed worktree
4. [ ] Read 真實 BCF client/型別；`gitnexus impact` 打到的 symbol
5. [ ] 最小 diff
6. [ ] `cd web-viewer-sample; npm run test:session-first`
7. [ ] `gitnexus detect-changes --scope compare --base-ref main`
8. [ ] 未要求 ship 則停

### 四、完成標準
Verified facts / Inferences / Unverified risks / Next actions。
必填：Changed files、已 Read 路徑+符號、本輪 PASS log、四態（含 Planned）證據、Known gaps。
user-facing 欄位齊；缺的填 not observed。
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
