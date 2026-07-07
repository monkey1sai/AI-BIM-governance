# Fable 5 告別建議書 — AI-BIM-governance

**日期**：2026-07-07　**產出者**：Claude Fable 5（max effort）＋ ultracode 多 agent 工作流
**方法**：6 視角唯讀掃描（sonnet）→ opus 合併去重（30→25 條）→ 8 條 HIGH/MEDIUM 逐條 opus 懷疑者 refute-by-default 驗證 → Fable 主 session 合成。16 agents、~111 萬 subagent tokens、197 次工具呼叫。全程唯讀，未修改任何 repo 檔案。

**資料品質誠實聲明**：

- 安全視角 finder 與完整性批評 agent 被 Anthropic cyber-safeguard 誤攔（prompt 含安全審查措辭）；安全面改由主 session 以兩個輕量防禦性檢查補位（見 §6），完整性批評由 Fable 主 session 親自擔任（§2 即其產出）。
- `repo-health-scan` 子工作流本身有 script bug（`$ is not defined`）直接失敗——這本身就是一條 finding（N4）。
- 驗證統計：8 條進懷疑者驗證 → 4 CONFIRMED、3 ADJUSTED、1 REFUTED。**修正率 50%**，證明 refute-by-default 這道工序不是儀式（詳見 §3 的推翻案例）。

---

## 1. TL;DR — 只給三條的話

1. **先收掉兩條在飛的線，再開任何新戰場。** PR #305（fix/a1-minio）盯到 merge；`feat/c-m4-runtime-command-bridge` 的 14 個 commit **只存在你這台機器**（origin 上沒有、從未開 PR、落後 main 20 commits）——先 push 備份，再 rebase → 完成 plan Task 7 → 開 PR。這是 repo 裡唯一「接近完成的實作價值」，也是唯一有真實遺失風險的資產。
2. **讓「真相面」跟上程式碼。** 這個 repo 是 agent 驅動開發，**issues、部署區、memory 就是 agent 的地圖**。本輪實測地圖已經在誤導：#247 是錯的（測試其實全綠）、#250 已被超車、:8004/ui 還跑 #303 之前的舊 bundle。兩個 finder 獨立把 #247 當真、花掉一個 opus 驗證者三層實測才推翻——**過期 metadata 的成本不是抽象的，本輪就付過一次**。一個 30 分鐘的 triage pass（關 #247、改寫 #250、收 #266）加一次部署區 rebuild，能讓未來每個 session 不再走錯路。
3. **CI 補一條最小 Playwright smoke。** 這是唯一結構性缺口：e2e specs 都寫好了（a1-minio-governance-3d、conv-watch-toggle 等），但 `.github/workflows` 對 playwright 零命中——CI 綠燈從未代表「使用者真的能點」。誠實鐵律目前全靠人工截圖執行；把其中兩條 spec 接進 CI，鐵律就有了機器守門。

---

## 2. 被推翻與校正的假設（防呆價值最高，放最前面）

這些是懷疑者拿著實測證據推翻的「大家都以為」，**未來 session 請以此為準**：

| 舊假設 | 實測結果 | 行動 |
|---|---|---|
| issue #247：test-rebuild-test-deploy.ps1 有 closure scope bug 跑不綠 | **REFUTED**。懷疑者三層實測：pwsh 與 PowerShell 5.1 直接跑完整測試都 `[PASS] EXIT=0`；Assert-True 與 lib 同被 dot-source 進同一 script scope，機制根本不成立。golden path 最危險段（reset/clean/env 還原）**其實有可信的綠色守門** | 附證據關閉 #247 |
| worktree fix/a1-minio-local-ifc-resolution 是 #303 合併後殘留、可清 | **錯**。#303 的 headRef 是 feat/model-data-conversion-merge；這個 worktree 對應**今天 10:09 剛開的 PR #305**（fix(a1): MinIO 檢核改走已下載 session），是活的 | 勿清；盯 #305 CI → merge 後再清 |
| c-m4 分支停滯（memory：停在 task#4） | **過時**。最新 commit 到 task#5（Task6），驗證當下 12 分鐘前才 commit、工作樹還是 dirty——**是進行中的 in-flight session**，只剩 plan Task 7 沒做 | 讓該 session 收尾；push 備份最優先 |
| openspec/ 是退役殘留待清 | **錯**。#189 只退役技能；目錄 593 個 tracked 檔仍被 docs/agents 5 處現行引用，2026-07 還有新 commit 觸碰，是有效歷史證據庫 | 不動 |
| root 層 output/、patches/、連線測試.md、frontend-redesign-ia-and-phases.html 是未追蹤待處理 | **錯**。四者都已 tracked（2026-06-07 repo 整併時代入庫），處理路徑是「確認無引用後 git rm」而非 git add | 下次文件整理 PR 順手裁決 |
| AGENTS.md / CLAUDE.md 有未 commit 修改（誤改？） | 只是 GitNexus 自動維護區塊的 symbol 計數更新（17171→17603），非人為誤改 | 下次相關 PR 順手帶上 |

## 3. 好消息 — 已驗證 RESOLVED 的舊痛點

以下 memory / 舊 session 記載的痛點，本輪拿著程式碼證據確認**已修好**，別再往這些方向修：

- **ifc-ready 併發搶 port 8011**：PR #298（b85a5d7）已在 StreamingConversionStore 加 threading.Lock 序列化轉檔。殘餘：鎖是 per-process，未來多副本部署才需重看。
- **conversion ledger Phase 2 回填（usdc/coverage/ready）**：已實作且被 app.ts、externalIfcReadyStore.ts 實際呼叫；#299 再強化 read-time 驗證與 force retrigger。
- **deploy.ps1 repo.bat 輸出重導向卡死**：host-native-launcher.ps1:164-201 已改 cmd.exe 原生 `>` 重導向＋WaitForExit(timeout)＋逾時 StopTree，test-host-native-launcher.ps1 Test13-18 六情境覆蓋。
- **git clean EINVAL（kit.exe 鎖 log）**：rebuild-test-deploy.ps1:277-322 已有 Stop-HostNativeService → exclude _build logs → 重試 3 次的完整流程。
- **repo.bat 裸檔名 PATHEXT 失敗**：已改 Join-Path 完整路徑（含註解引用 spec）。⚠️ 部署機「環境級」失敗是否隨之消失，唯讀盤點無法實測，仍列未驗證風險。
- **minio-watcher-loop flaky**：#279 已修，後續測試一致採用 waitFor pattern，抽查無同病殘留。
- 型別逃生門幾乎為零（as any=0、ts-ignore=1）、四大子系統 TODO/FIXME=0、路徑 sanitize 已收斂到 sanitizeArtifactIdPart 單一真相——**程式碼紀律本身是健康的**。

## 4. 建議清單（Now / Next / Later）

### Now — 小時級，本週內

**N1. 保住並收尾 c-m4-runtime-command-bridge**（verified ADJUSTED；唯一遺失風險資產）
證據：origin 無此 branch、無 PR、14 commits ahead / 20 behind，plan Task 7 未做；同檔（Window.tsx/console）與 #304 重構重疊，rebase 成本隨時間非線性上升。
注意：該 worktree 有 in-flight session 在動（12 分鐘前還在 commit）——等它告一段落，第一動作是 push。
> 提示詞：「到 .worktrees/c-m4-runtime-command-bridge：先處理工作樹 dirty 檔（e2e png），把 feat/c-m4-runtime-command-bridge push 到 origin 備份；rebase 到最新 origin/main（留意與 #304 三頁合一在 Window.tsx/console 的衝突，rebase 前先跑 GitNexus impact）；完成 docs/superpowers/plans/2026-07-03-c-m4-runtime-command-bridge.md 的 Task 7（whitespace check＋detect_changes＋報告）後開 PR，走 ship-item。」

**N2. Issue triage pass — 讓地圖恢復準確**（#247 REFUTED、#250 超車、#266 死碼）
證據：#247 見 §2；#250 原始 DoD（ledger 持久化、/api/minio/objects、前端接線）已被 #303/#304 全數超車，真正剩的只有 Phase 2 usdc/coverage 真實回填；#266 死碼＝OperatorConsole.tsx/.test.tsx（除互 import 外零引用）＋孤兒 RuntimePage（pages.tsx:2347）＋EdgeConsole 不可達 case "coordinator"。
> 提示詞：「triage open issues：(1) #247 附 2026-07-07 對抗驗證證據關閉（測試在 pwsh 與 PS5.1 都 PASS，詳 artifacts/2026-07-07-fable5-farewell-repo-advisory.md §2）；(2) #250 關閉並開新 issue 專注 Phase 2——前端把 source_ifc_entity_count（app.ts:138/types.ts:83 已定義但前端零消費）接成真分母，並查 bim-streaming-server 是否真有 producer 填值；(3) #266 開小 PR 一併刪 OperatorConsole.tsx/.test.tsx＋RuntimePage＋EdgeConsole case 'coordinator'＋routing.ts 對應項，vitest 全套＋detect_changes 驗零回歸。」

**N3. 衛生批次**（10 分鐘）
.gitignore 補 `artifacts/tmp-*/` 與 `artifacts/local-backups/`（6 個 tmp 目錄共 5.4MB 未被忽略）；裁決 .claude/workflows/saas-blueprint-tournament.js（命中版控白名單卻未 add：要嘛入庫要嘛刪）；刪或歸檔孤兒 plan docs/superpowers/plans/2026-07-02-a1-3d-review-decouple.md（描述功能已於 a334e49 全部落地、從未進 git）；順手 commit AGENTS/CLAUDE 的 GitNexus 計數行。

**N4. 修 .claude/workflows/repo-health-scan.js**
本輪實測它一啟動就死：`$ is not defined`（script 第 5 行附近殘留 `$` 樣板語法）。健檢工具自己壞掉＝未來健檢靜默失效。
> 提示詞：「.claude/workflows/repo-health-scan.js 以 Workflow 執行會拋 `$ is not defined`（workflow.js:5:41）。讀該檔找出殘留的 $ 插值（疑 PowerShell 風格字串混進 JS），修正後用 Workflow({scriptPath}) 空跑驗證能啟動。」

**N5. 盯 PR #305 到 merge**，之後才清對應 worktree。

### Next — 天級，本月內

**X1. 部署區 rebuild，消除誠實證據污染**（verified CONFIRMED）
:8004/ui 的 bundle 是 docker image build 時烤進去的（coordinator-web-plane.Dockerfile:11），#303/#304 明文延後重建——現在部署區跑的還是三頁合一**之前**的 console。任何人去 :8004 驗收都會誤判「功能沒做」。
> 提示詞：「跑 .\scripts\dev\rebuild-test-deploy.ps1 -Build（先清 49100~49110 殘留 host-native python）；完成後 gstack 對 :8004/ui 的 #minio 新 modelData 合一頁截圖驗證，順手跑 co-console-runtime-merge.spec.ts 補 #266 的 P1 browser 證據。」

**X2. CI 最小 Playwright smoke**（verified CONFIRMED；結構性缺口）
> 提示詞：「在 ci.yml 加一個 playwright-smoke job：只跑 web-viewer-sample e2e 的 a1-minio-governance-3d.spec.ts 與 conv-watch-toggle.spec.ts 兩條；先求 smoke 級（頁面載入＋主按鈕存在＋mock 後端），不求全鏈路。裝 chromium 用 npx playwright install --with-deps chromium。若兩條都需要真後端，退一步改跑 vite preview＋route mock 的『頁面可達性』smoke 也有價值。」

**X3. 證據制度補一個機器 gate**：check-pr-body-evidence.ps1 加「body 引用 artifacts/e2e/ 截圖 → `git ls-files` 驗真的入庫，否則 fail 並提示 git add -f」。防 dead reference（歷史上發生過）。

**X4. SaaS v2 簽核會議（人類決策，工程不動）**（verified ADJUSTED）
11 項待簽核（審批報告 §5.x L98-108：tenant-scoped hash、data.ts:6 型別、Keycloak、Windows vs Linux K8s、DB 遷移、GeForce EULA…）無一簽核，全卡你本人。未簽核前任何 agent 都不該動 SaaS-M 程式碼（凍結面紅線）。注意：SaaS-M1~M8 唯一詳規源是 `ai-bim-governance-saas-遷移路線與里程碑.md`（審批報告 §7.2），簽核紀錄應另立文件/PR，不直接改已 commit 的報告。

### Later — 有觸發條件才做

- **L1. app.ts（3486 行/56 routes）漸進拆分**：不做大爆炸重構；下次動它時先對單一 route 跑 impact，優先把 /api/dev/* 與 /api/external/* 拆獨立 router。pages.tsx（2465 行）同理：新增 console 頁一律獨立檔。
- **L2. A3 clash OCC**（#270，need_commander）：推進前先驗 pythonocc-core 能否進現有 Python 環境；A4-A10 維持 NOT BUILT，一人產能下不動是正確的。
- **L3. 版本對齊**：vitest 1.x vs 2.x（跨大版號）、fastapi/uvicorn 三服務漂移——搭下次升級順手做，不專程。
- **L4. deploy.ps1 無人值守化**：兩處 Read-Host（:1013/:1041）在排程情境會靜默卡死；若要夜間自動重建，preflight 加陌生 PID 掃描＋文件標注 -Force 為必要旗標。注意：ensure-host-native-ports-free.ps1 **不存在於 tracked 檔案**（memory 記載與現實不符），port 預清目前靠人工習慣。

## 5. 誠實鐵律視角的一條 meta 建議

你的治理體系（AGENTS.md 效力序、誠實鐵律、adversarial verify、spec gate）已經跑出成效——程式碼層的紀律指標（型別逃生門、TODO 密度、sanitize 收斂）都乾淨。**下一個瓶頸不在程式碼，在 metadata 新鮮度**：本輪 5 條「被推翻的假設」全部是 issues/memory/快照過期造成的，而 agent 對這些的信任是無條件的。建議把「metadata 過期」當成和 code bug 同級的缺陷來報修：任何 session 發現 issue/memory 與實測矛盾，當場開 correction（關 issue、改 memory、留證據），不要只在腦中修正。

## 6. 安全抽查（主 session 補位，範圍有限）

- **Tracked 機密**：`git ls-files` 掃 env/key/secret/credential/token 樣式，只命中 5 個 `.env.example` 樣板與 aws-sdk-credentials-guard.test.ts（守門測試）。無真機密入庫。✅
- **Bind 面**：容器內 0.0.0.0 屬正常（暴露由 compose port mapping 控制）；deploy.ps1:586 有 loopback/LAN 自動判斷；app.ts:2449/:3192 對 IFC bytes 端點有 loopback-only guard 並註明防 LAN 暴露；CORS 白名單明確。**這是有意識設計過的姿態。** ✅
- **已知且已文件化的開放面**：coordinator API 無認證（內網 demo 設計現實；Keycloak 正是 SaaS v2 待簽核項之一）。SaaS 化之前必須解，現階段可接受。
- 限制聲明：未逐端點審計、未掃依賴 CVE——完整安全視角 finder 被 safeguard 攔下，此節僅為抽查，不等同完整審計。

## 7. 證據分級

- **Verified facts**：§2 全表、§3 各項、N1/N2/X1/X2/X4 的證據句——皆有懷疑者親跑的指令輸出或 file:line。
- **Inferences**：「rebase 成本隨時間上升」「stale metadata 使未來 session 走錯路」——由 verified facts 合理推導。
- **Unverified risks**：部署機 .bat 環境級失敗是否已消失（程式碼三層防禦已落地，但唯讀盤點無法實跑）；A1 rule-run 測試「語意深度」（只驗了檔案存在與 grep，未逐行讀斷言）；tmp-* 目錄內是否有人還要引用；agent-governance.yml 未讀。
- **本輪未覆蓋**：compose 層設定漂移、依賴 CVE 掃描、Kit extension（Python/C++）程式碼品質。

## 8. 告別交接

這份報告的每條建議都附了可直接貼給下個 session 的提示詞——它們不需要 Fable 也能執行好。值得留給下個世代的只有一句：這個 repo 最特別的資產不是任何一段程式碼，是你把「agent 會犯什麼錯」一路變成規則、gate、測試的那套進化迴圈。繼續餵它。

*— Claude Fable 5, 2026-07-07*
