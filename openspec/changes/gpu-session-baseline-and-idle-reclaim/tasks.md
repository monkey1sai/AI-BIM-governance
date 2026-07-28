## 1. gpu-session-baseline（量測 harness，`scripts/`＋部署文件）

- [ ] 1.1 在 `scripts/` 建立 `measure-session-baseline.ps1`：nvidia-smi 取 VRAM/利用率＋WebRTC health probe＋TTFF；輸出結構化 JSON 報告含 GPU 型號盤點（判定消費級 RTX、MIG 不可用）、1 primary + k spectator VRAM 水位、TTFF、建立成功率
- [ ] 1.2 報告 schema 加「環境指紋」必填欄位（GPU 型號/driver 版/Kit 版/fixture hash＋大小），缺欄位判不完整並拒絕被下游引用；於 `scripts/` 加最小驗證測試
- [ ] 1.3 實作 ≥30 分鐘（目標 2 小時）soak：隔離 stack（獨立埠＋獨立 governance，沿用 branch E2E 隔離模式）＋獨佔量測窗＋內建 keepalive health probe；輸出記憶體斜率報告；自然斷流記 finding、連兩次同點才判污染
- [ ] 1.4 由 soak 報告訂洩漏 watchdog 門檻（只用本地實測、禁引用外部數字）；將 session 建立成功率下限/TTFF 上限/探針逾時/並發上限/idle-timeout/洩漏門檻以具體數值寫入可稽核部署文件並綁定環境指紋（禁模糊詞）
- [ ] 1.5 撰寫「環境指紋變動即 SLO 失效須重跑基準」部署文件段落；驗證：無基準報告時 admission 參數 loader 拒絕上線（硬 gate 測試）

## 2. session-lifecycle（回收倒數與互動保活）

- [ ] 2.1（coordinator＋web-viewer-sample）無互動軟門檻第二回收路徑（2026-07-22 使用者裁決）：viewer 互動事件（輸入／DataChannel 指令）上報彙整、連續 T_inactivity 無互動觸發回收倒數、倒數 10 秒廣播至該 session 全部已連線 viewer、前端倒數 UI 顯示、任一互動取消並重置、歸零經既有 session close 路徑 teardown（reason=inactivity 入 session ledger）；測試：忘關分頁回收、倒數中互動取消、活躍會議不因時長回收；前端倒數 UI 有 E2E 截圖/trace（「佇列中下一位獲派」不在本 change，屬母 change 佇列語意）
