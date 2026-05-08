## Why

`docs/verification/2026-05-08-spec-end-to-end-verification.md` 已證明 review-session lifecycle、viewer bootstrap、API smoke、Socket.IO two-user collaboration 與 close/release flow 可運作，但仍留下需要真實 runtime 條件的驗證缺口。這個 change 用 OpenSpec 明確收斂那些缺口，避免把硬體限制誤判成 spec 未完成，或在後續工作中重複驗證已完成的 API / control-plane 範圍。

## What Changes

- 建立 runtime verification evidence 的驗證契約，區分 non-GPU contract smoke、single Kit GPU viewport render、dedicated multi-Kit routing、大型 IFC 壓力與 Socket.IO 併發驗證。
- 定義每個驗證層級的前置條件、成功標準、可接受的 skip / blocked 記錄方式與證據位置。
- 將 `bim-streaming-server` 的 DataChannel stage-loading contract test 納入正式驗證清單，作為不需要 GPU 的最小補驗項目。
- 規劃有效幾何 IFC / USD 的 single Kit viewport screenshot 證據流程，避免再使用只有 ISO header 的 smoke fixture 宣稱實際渲染已通過。
- 規劃 `dedicated_instance` 多 Kit 並行 streaming 驗證，但明確列為需要多 Kit instance topology 的 follow-up，不把它混入目前 `local_fixed` 單 instance demo 條件。
- 規劃大型 IFC conversion / readiness 中間態與 Socket.IO 多使用者壓力驗證的門檻與報告格式。
- 不修改 production code、REST API、Socket.IO event、WebRTC / DataChannel payload 或資料儲存格式。

## Capabilities

### New Capabilities

- `runtime-verification-evidence`: 定義 spec runtime / hardware-dependent 驗證項目的分層證據、成功標準、blocked 記錄與報告更新方式。

### Modified Capabilities

- None.

## Impact

- 主要影響 `openspec/changes/complete-spec-runtime-verification/` 的 proposal、design、spec、tasks 文件。
- 後續 apply 時可能更新 `docs/verification/2026-05-08-spec-end-to-end-verification.md` 或新增同目錄的 follow-up verification report。
- Repo 邊界保持不變：
  - `bim-streaming-server` 只負責 Kit runtime、USD loading、WebRTC / DataChannel runtime evidence。
  - `bim-review-coordinator` 只負責 session、Kit binding、Socket.IO collaboration / concurrency evidence。
  - `_worker` 只負責 artifact / conversion / readiness evidence。
  - `_bim-control` 只負責 fake metadata / annotation persistence evidence。
  - `web-viewer-sample` 只負責 browser bootstrap、viewer UI、WebRTC client 與 user interaction evidence。
- 無 breaking change。
- 無新增 production dependency。
