## 1. gpu-session-baseline（量測 harness，`scripts/`＋部署文件）

- [ ] 1.1 在 `scripts/` 建立 `measure-session-baseline.ps1`：nvidia-smi 取 VRAM/利用率＋WebRTC health probe＋TTFF；輸出結構化 JSON 報告含 GPU 型號盤點（判定消費級 RTX、MIG 不可用）、1 primary + k spectator VRAM 水位、TTFF、建立成功率
  - 註（2026-08 review 修正）：harness 已落地，但 TTFF 與 session 建立成功率在結構上仍未量測 —— 兩者只能由呼叫端經 -TtffMs / -SessionCreationSuccessRate 傳入（已加範圍驗證並標記 source=caller_supplied），本 harness 為唯讀、不建立 session，故無現場量測路徑；1.1 維持未勾選，待 1.3 soak 提供實測路徑後才可結案。
- [x] 1.2 報告 schema 加「環境指紋」必填欄位（GPU 型號/driver 版/Kit 版/fixture hash＋大小），缺欄位判不完整並拒絕被下游引用；於 `scripts/` 加最小驗證測試
  - 註（2026-08-14）：下游引用 gate 落地為 `Test-SessionBaselineReportForDownstream`（`scripts/lib/measure-session-baseline.ps1`）＋ CLI `scripts/validate-session-baseline-report.ps1`（exit 0 僅當 gpu_model/gpu_driver_version/kit_version/fixture_hash/fixture_size_bytes 五欄位 present+measured 且 completeness 主張一致；缺欄位、unmeasured、complete 旗標與欄位證據矛盾、未知 schema_version、壞檔/缺檔一律 fail-closed exit 1，結構化 verdict `gpu-session-baseline-report-validation/v1` 落 stdout，registry 已登錄）。同 PR 收斂 #511 遞延的 per-GPU fingerprint 缺口：`environment_fingerprint.gpus[]` 逐列 pin index/model/driver_version，scope 改為 `single_gpu|all_gpus|partial_gpu_rows`（有無法解析列時撤回 completeness）。`scripts/tests/test-measure-session-baseline.ps1` 新增 gate 與 CLI 測試（含 JSON round-trip、手改報告 fail-closed、legacy first_gpu_only 拒絕）。已知缺口：`scripts/tests/test-measure-session-baseline.ps1` 至今未接入任何 CI workflow（1.1 落地時即如此）；接線需修改 `.github/workflows/agent-governance.yml`（mechanism surface，觸發 self-referential bootstrap 契約），應由獨立 mechanism PR 帶 bootstrap 宣告處理，不在本 PR 夾帶。TTFF/建立成功率之實測路徑與 runtime 端 Kit build/fixture identity 驗證仍由 1.3 持有，本項不宣稱。
- [ ] 1.3 實作 ≥30 分鐘（目標 2 小時）soak：隔離 stack（獨立埠＋獨立 governance，沿用 branch E2E 隔離模式）＋獨佔量測窗＋內建 keepalive health probe；輸出記憶體斜率報告；自然斷流記 finding、連兩次同點才判污染
- [ ] 1.4 由 soak 報告訂洩漏 watchdog 門檻（只用本地實測、禁引用外部數字）；將 session 建立成功率下限/TTFF 上限/探針逾時/並發上限/idle-timeout/洩漏門檻以具體數值寫入可稽核部署文件並綁定環境指紋（禁模糊詞）
- [ ] 1.5 撰寫「環境指紋變動即 SLO 失效須重跑基準」部署文件段落；驗證：無基準報告時 admission 參數 loader 拒絕上線（硬 gate 測試）

## 2. session-lifecycle（回收倒數與互動保活）

- [ ] 2.1（coordinator＋web-viewer-sample）無互動軟門檻第二回收路徑（2026-07-22 使用者裁決）：viewer 互動事件（輸入／DataChannel 指令）上報彙整、連續 T_inactivity 無互動觸發回收倒數、倒數 10 秒廣播至該 session 全部已連線 viewer、前端倒數 UI 顯示、任一互動取消並重置、歸零經既有 session close 路徑 teardown（reason=inactivity 入 session ledger）；測試：忘關分頁回收、倒數中互動取消、活躍會議不因時長回收；前端倒數 UI 有 E2E 截圖/trace（「佇列中下一位獲派」不在本 change，屬母 change 佇列語意）
