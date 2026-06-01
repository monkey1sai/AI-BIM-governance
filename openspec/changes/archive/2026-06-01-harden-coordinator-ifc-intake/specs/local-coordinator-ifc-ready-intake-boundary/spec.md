# local-coordinator-ifc-ready-intake-boundary 規格增量 (harden-coordinator-ifc-intake)

> 對 `openspec/specs/local-coordinator-ifc-ready-intake-boundary/spec.md` 的規格增量。
> 補足 IFC-ready intake 在 explicit strict mode 下的誠實下載行為:strict 下 HTTP 拿不到 IFC SHALL 回 502 download_failed,而非靜默回 placeholder ok。

## ADDED Requirements

### Requirement: IFC-ready download SHALL honor an explicit strict mode

coordinator 的 IFC-ready intake 下載 SHALL 支援由 `IFC_DOWNLOAD_STRICT` 設定驅動的 explicit strict mode。當 strict 啟用時,若對 IFC source 的 HTTP 取得回 non-2xx,coordinator SHALL 以 `502` 回應並把該 intake job 的 download 狀態標為 failed,MUST NOT 以 placeholder 內容靜默回報下載成功、MUST NOT 進入 conversion dispatch。當 strict 未啟用(預設)時,SHALL 維持既有 fallback 行為(供 demo / local 在無真實 IFC source 時以 placeholder 跑通)。strict 的 code 預設 SHALL 為 false(不破壞既有 demo);production 部署 SHALL 透過 `IFC_DOWNLOAD_STRICT=true` 啟用。

#### Scenario: Strict mode rejects unreachable IFC with 502

- **WHEN** `IFC_DOWNLOAD_STRICT` 啟用(strict)
- **AND** coordinator 對 `POST /api/external/ifc-ready` 帶入的 IFC source 做 HTTP 取得時收到 non-2xx
- **THEN** coordinator SHALL 回應 `502`
- **AND** 該 intake job 的 download 狀態 SHALL 標為 failed
- **AND** SHALL NOT 以 placeholder 內容回報下載成功
- **AND** SHALL NOT 進入 conversion dispatch

#### Scenario: Non-strict default preserves placeholder fallback

- **WHEN** `IFC_DOWNLOAD_STRICT` 未設(預設 non-strict)
- **AND** IFC source 的 HTTP 取得失敗
- **THEN** coordinator SHALL 維持既有 fallback 行為(以 placeholder 讓 demo / local 流程跑通)
- **AND** 既有 intake / dispatch 行為 SHALL NOT 因本 change 改變
