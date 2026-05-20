## Context

`local-coordinator-ifc-ready-intake-boundary` 已把 B 方案正式收斂為：外部客戶落地端 IFC Worker 只呼叫 `bim-review-coordinator` `POST /api/external/ifc-ready`，coordinator 再呼叫 `bim-streaming-server` 的 internal conversion authority，轉檔結果由 coordinator 寫入 metadata-only callback outbox。現有 `bim-streaming-server` 已有 `conversion_authority.py` 的 FastAPI app / store / converter interface 與測試，但缺少一個可直接啟動的 host-native service runner、固定 port、coordinator result ingestion loop 與 smoke evidence。

目前最大差距不是「誰擁有轉檔權威」，而是「這個權威能不能被本機服務穩定呼叫」。在使用者環境中，Kit/WebRTC rendering 仍可能被 GPU、Vulkan、Kit license、WSL2 graphics passthrough 卡住；conversion authority 必須能先在 host-native 層驗證，並且不能被誤當成 rendering 成功。

## Goals / Non-Goals

**Goals:**

- 在 `bim-streaming-server` 邊界內提供可啟動的 host-native conversion authority service，預設 `127.0.0.1:49101`。
- 重用既有 conversion authority job store、no-placeholder-ready 檢查、quality metrics 與 converter interface。
- 讓 `bim-review-coordinator` 的 external IFC-ready intake 能派工到 host-native service，並把成功/失敗 result 餵回 callback outbox。
- 補 smoke / evidence / docs，明確分出 `host_native_conversion_authority`、`streaming_internal_conversion`、`single_kit_render`、WebRTC / browser visual tiers。
- 保留 viewer ready gate：model 未 ready 時不送 `openStageRequest`；完整 browser E2E 以 PR #69 後的 viewer dependency 為基底。

**Non-Goals:**

- 不重建 `_worker` / `_bim-control`，也不新增舊 conversion API caller。
- 不用 host-native conversion service 取代 Docker Kit runtime、GPU rendering 或 WebRTC `49100`。
- 不解公司雲端 OQ1 callback endpoint/auth 與 OQ5 SSO。
- 不在 proposal 階段新增 production dependency；apply 階段若真的需要，另行說明。
- 不實作 multi-Kit scheduler 或 dedicated multi-instance capacity。

## Decisions

### D1 Host-native service 是 streaming-owned thin runner

選定：在 `bim-streaming-server` 內新增 host-native runner，載入既有 `create_conversion_api_app(...)`，預設綁定 `127.0.0.1:49101`，以 `STREAMING_CONVERSION_API_BASE` 提供 coordinator 呼叫。

理由：conversion authority 屬 `bim-streaming-server`，但 runner 不應塞進 live Kit/WebRTC process；host-native runner 讓 API、job store、converter adapter、quality gates 可以先被測通。

Alternative（否決）：放在 `bim-review-coordinator`。這會讓 coordinator 變成轉檔實作者，破壞 repo 邊界。

Alternative（否決）：只放在 Kit app extension。這會把 heavy conversion 與 live viewport runtime 綁死，GPU/Kit blocker 會阻塞本應可獨立驗證的 conversion API。

### D2 Converter adapter 只包執行，不放寬結果品質

選定：runner 使用 adapter 介面呼叫實際 IFC to USDC converter（例如既有 PowerShell script / headless converter app / subprocess），並把 outputs 正規化成 `model.usdc`、`element_mapping.json`、`entity_index.json`、`metadata.json` 與 quality metrics。

結果檢查沿用 streaming-owned no-placeholder-ready 語意：缺檔、placeholder、不可開啟、mapping quality 未達標時不得發布 `model.status="ready"`。

Alternative（否決）：先產假 USDC 讓 UI 通過。這會污染 B 方案 evidence，且與現有 no-placeholder-ready spec 衝突。

### D3 Coordinator 只做派工與 result ingestion

選定：coordinator 在 external IFC-ready intake 成功後呼叫 `POST /api/conversions/ifc-to-usdc`；取得 `conversion_job_id` 後保存 local job 狀態。轉檔完成後，coordinator 以輪詢、內部 worker loop 或明確 result callback 把 `GET /api/conversions/{id}/result` 轉成現有 `/api/internal/conversion-result` report，並由 callback outbox 處理 metadata-only cloud callback。

理由：coordinator 需要維護 idempotency、external_model_version_id binding、local web view session 與 cloud callback outbox；但它不應執行 converter 或保存大型模型 body。

### D4 Evidence 分層比一次 E2E 更重要

選定：新增 `host_native_conversion_authority` evidence tier。這一層 passed 代表 `49101` service、job API、result API、quality metrics 與 callback outbox 串得起來；它不代表 Kit launcher、WebRTC、browser viewport、DataChannel stage load passed。

理由：目前環境常見 blocker 是 GPU/Kit rendering，不應把 conversion API 的成功和 rendering 的成功混在一起。

### D5 Viewer 行為以 ready gate 驗證，不在 viewer 重算轉檔

選定：viewer 仍只讀 coordinator 的 `stream_config` 與 dev-only fallback result。`web-viewer-sample/src/Window.tsx` 的 ready gate 必須保持：`model.status === "ready"` 且 lifecycle 未 blocked 時才送 `openStageRequest`。

理由：viewer 是使用者操作層，不是 conversion authority；PR #69 已修正 viewer dependency，這個 change 的 E2E 要建立在該基底上驗證，而不是讓 viewer 繞過狀態機。

### D6 Windows 啟動以 PowerShell 為準

選定：docs / scripts 明確標示 Windows host-native conversion service 的啟動命令；涉及 `.bat` / Kit repo tooling 時以 PowerShell 執行，Git Bash 只作一般 git shell，不作 `.bat` launcher 的主要環境。

理由：此 repo 既有 Kit build/launcher 在 Windows shell 邊界有已知陷阱；規格與 tasks 要避免把環境錯誤誤判成 code regression。

### D7 Converter adapter 介面契約與輸出對照（風險 3／5／6 的 apply 落地解法）

選定：apply 階段新增一個 host-native converter adapter（建議名 `Ifc2UsdcPowershellConverterAdapter`），以**依賴注入**方式餵進既有 `create_conversion_api_app(settings=..., converter=...)`（`conversion_authority.py:57-66`）與 `StreamingConversionStore(..., converter=...)`（`:128-133`）。adapter 是唯一新增的轉檔執行體，**store 既有守門邏輯一律不改、不繞過**。

**adapter 介面契約（與 store 既有消費點對齊，不可改 store 簽章）：**

```python
class Ifc2UsdcPowershellConverterAdapter:
    """Host-native：以 PowerShell 執行 scripts/convert-ifc-to-usdc.ps1，
    產出 store 要求的四檔 + quality_metrics。缺前置一律 raise，不退回空殼、不產假檔。"""

    def __init__(self, *, repo_root: Path, powershell_exe: str = "powershell.exe",
                 kit_exe_path: Path | None = None, hoops_main_path: Path | None = None,
                 config_path: Path | None = None, timeout_seconds: int = 600,
                 work_dir: Path | None = None): ...

    def preflight(self) -> None:
        """檢查 kit.exe / hoops_main / config / convert-ifc-to-usdc.ps1 是否齊備；
        任一缺 → raise ConversionAuthorityError("converter_unavailable", <可執行的補救訊息>)。"""

    def convert(self, *, job: dict, ifc_ready_event: dict, output_dir: Path) -> Mapping[str, Any]:
        """1. self.preflight()
        2. 由 ifc_ready_event['ifc_artifact']['url'] 取得本機 .ifc
        3. powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ps1 絕對路徑>
              -IfcPath <ifc 絕對路徑> -OutputDir <output_dir 絕對路徑>
              -OutputName "model.usdc" -TimeoutSeconds <timeout> -Force
           （cwd=repo_root；禁止經 bash/sh；逾時 → kill + raise）
        4. 確認 output_dir/model.usdc 真的產生
        5. 另行產生 element_mapping.json / entity_index.json / metadata.json + quality_metrics
        6. return dict（見下表）。失敗一律 raise ConversionAuthorityError(code, message)。"""
```

**關鍵事實（風險 3 的真正缺口）**：`scripts/convert-ifc-to-usdc.ps1` 只輸出 `.usdc`（`convert-ifc-to-usdc.ps1:257-318`），**不產** `element_mapping.json / entity_index.json / metadata.json`；而 store 的 `_required_output_paths`（`conversion_authority.py:308-316`）要求這四檔齊全才放行。因此 adapter 的實作重點＝跑完 ps1 後**還要負責產出三個 sidecar 與 quality_metrics**（來源為 `ezplus.bim_ifc_usd_converter.kit` app 輸出或一個 enumeration pass）。

**`convert()` 回傳 dict → store → 對外 result 欄位對照：**

| adapter 回傳 key | 型別 | store 消費點 | 對外 result 位置 | 守門檢查 |
|---|---|---|---|---|
| `model_path` | `Path/str` → `model.usdc` | `_required_output_paths:308` | `result.artifacts.model_usdc` / `result.model.url` | 檔需存在；前 4096 bytes 不得含 `placeholder`（`:327-329`） |
| `mapping_path` | `Path/str` → `element_mapping.json` | 同上 | `result.artifacts.element_mapping` | `mock!=true` 且 `summary.fake_mapping_count==0`（除非 event 開 `allow_fake_mapping`）`:335-339` |
| `entity_index_path` | `Path/str` → `entity_index.json` | 同上 | `result.artifacts.entity_index` | 檔需存在 `:324-326` |
| `metadata_path` | `Path/str` → `metadata.json` | 同上 | `result.artifacts.metadata` | 檔需存在 `:324-326` |
| `quality_metrics` | `dict` | `_normalize_quality_metrics:341` | `result.quality_metrics` | 見下方硬閘 |

`quality_metrics` 硬閘（`_assert_publishable_outputs:318-339`）：`hard_quality_gates.usdc_openable` 與 `hard_quality_gates.has_renderable_prims` **必須由實際 USDC 驗證取得真值**，不得寫死 `True`；`source_ifc_entity_count` / `mapped_count` 供 `coverage_ratio` 計算。任一硬閘 false／缺 → store 走 `_fail_job:386`，`model.status="failed"`，coordinator 轉 `conversion_failed`。

理由：把風險 3（真接線）、風險 5（PowerShell 而非 Git Bash）、風險 6（不繞過 no-placeholder 守門、不退回 `HeadlessConverterNotConfigured` 空殼）三者收斂成一份可被 apply 直接照做、且不污染 B 方案 evidence 的契約。

Alternative（否決）：在 store 內直接呼叫 ps1。會讓 store 同時是守門者又是執行者，破壞既有可測邊界與 D2 的「adapter 只包執行」。

## Risks / Trade-offs

- [Host-native runner 可通但 Kit 不可通] → smoke/evidence 強制分層，`host_native_conversion_authority=passed` 不得升等為 `single_kit_render=passed`。
- [Converter adapter 依賴本機工具路徑] → 依 D7：以設定 + `preflight()` 顯示缺失，缺 converter 時標 `blocked`，不產假 ready result，不退回空殼。
- [ps1 只產 .usdc、缺三個 sidecar] → 依 D7：adapter 須額外產 `element_mapping.json`/`entity_index.json`/`metadata.json` + 真實 `quality_metrics`，否則 store `_required_output_paths` 直接擋下，不得放寬。
- [Result ingestion 可能重複] → 沿用 `correlation_id`、`idempotency_key`、`conversion_job_id`，coordinator callback outbox 必須可重試且不可重複建立 active conversion。
- [Callback endpoint OQ1 未定] → outbox 可以保留 pending/dead-letter evidence；不得把 callback 不可達視為 conversion failure。
- [Windows shell 差異造成誤判] → runbook 列出 PowerShell 命令與 Git Bash 限制；驗證結果記錄 shell、cwd、port、PID 與重要 env。

## Migration Plan

1. 在 branch `codex/openspec/introduce-host-native-conversion-authority-service` 完成 implementation，不在 `main` 直接開發。
2. 先新增 host-native runner / adapter tests，確認 `49101` API 可單獨跑。
3. 再接 coordinator dispatch/result ingestion，保留現有 `/api/external/ifc-ready` 與 callback outbox contract。
4. 補 smoke / evidence / docs，確認 conversion 與 rendering 分層。
5. 最後做 viewer E2E ready-gate 驗證；若 GPU/WebRTC 不可用，記錄 blocked/not_observed，不改成 passed。
6. Rollback：移除 runner/adapter 接線並把 coordinator `STREAMING_CONVERSION_API_BASE` 回到先前 contract stub；不需要恢復 `_worker` / `_bim-control`。

## Open Questions

- OQ1：真實公司雲端 callback endpoint/auth 仍由外部平台團隊確認，本 change 只保留 contract/outbox。
- OQ2：production converter 的最終 executable / Kit app / script 路徑、以及三個 sidecar + quality_metrics 的產出來源，依 D7 契約由 apply 階段以設定檔 + `preflight()` 解析；缺前置時 adapter 必須 raise `converter_unavailable`（標 `blocked`），**不得退回 `HeadlessConverterNotConfigured` 空殼或產假 ready**。
- OQ3：是否需要 long-running job worker queue；MVP 可先用 background task / local job store，後續再依量能升級。
- OQ4：完整 browser E2E 是否能在當前機器取得 GPU/WebRTC；不可用時只能標 blocked/not_observed。
