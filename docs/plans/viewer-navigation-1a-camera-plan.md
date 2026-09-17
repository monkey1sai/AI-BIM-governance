# 1a 相機檢視 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在統一工作台已啟動的 primary viewer 接通六個預設視角、透視／正交切換、相機狀態讀取與飛行速度，並以本機真實 Chrome 證明畫面生效。

**Architecture:** 依設計方案 A：Kit messaging extension 新增 `cameraViewRequest`、`cameraStateRequest`、`flyNavigationRequest` 三個指令（沿用操作權檢查與 `correlated_result`）；瀏覽器以 `cameraViewBridge.ts` 的泛型交換物件處理請求編號、逾時與回報比對；統一工作台以新控制項呼叫，飛行本身沿用官方串流元件的滑鼠鍵盤轉送。contract JSON 先改，Kit、coordinator、瀏覽器三邊清單再跟著改，由既有一致性測試把關。

**Tech Stack:** Python 3（Kit 110 extension、pytest、pxr Gf）、TypeScript／React 18／Vite／Vitest、Node Express＋zod（coordinator）、JSON Schema 2020-12、NVIDIA Omniverse `omni.kit.viewport.utility` 2.0.1、`omni.kit.manipulator.camera` 110.0.0。

**Spec:** `docs/plans/viewer-navigation-walkthrough.md`（§4 元件、§5.1–§5.2 契約、§6 錯誤處理、§7 驗收）。

## Global Constraints

- 只在統一工作台（`web-viewer-sample/src/console/unified/`）已啟動的 **primary viewer** 生效；spectator 送出會改變畫面的指令時，Kit 回 `spectator_readonly`。
- 只支援桌機鍵盤滑鼠。
- 官方 API 優先：相機讀寫用 `omni.kit.viewport.utility`、`omni.kit.commands`，飛行速度用 `/persistent/app/viewport/camMoveVelocity`；不得自製傳輸層。
- 不修改 governance-service、`governanceProxy.ts`、`conversion_authority.py`。
- 座標單位公尺、Z 軸朝上；前、後、左、右以**模型座標**為準，不是真北。
- 瀏覽器端 Kit 指令逾時 10 秒；父視窗等待逾時 11 秒（與剖切相同）。
- 會改變畫面的新指令必須同時登記在：`tests/contracts/runtime-mutation-authority-v1.json`、Kit `runtime_authority.py`、coordinator `runtimeMutationAuthority.ts`、瀏覽器 `runtimeCommandProtocol.ts`。
- 在 branch `docs/viewer-navigation-design` 逐任務 commit 並 push；1a–1d 全部完成前**不開 PR**。
- commit 訊息結尾加 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。
- 畫面證據只能來自本機**真實 Chrome**；Playwright 內建 Chromium 不支援 H.264，不算證據。截圖與操作紀錄只存本機，不進公開 repo。
- 不得讀取、回顯或複製任何 `.env*` 或憑證檔；環境缺設定時停止並回報。

## File Structure

| 檔案 | 動作 | 職責 |
|---|---|---|
| `tests/contracts/kit-datachannel-v1.schema.json` | 修改 | 新增 3 個請求、3 個回報、`cameraState` 定義 |
| `tests/contracts/runtime-mutation-authority-v1.json` | 修改 | 新增 2 個會改變畫面的指令、1 個唯讀指令 |
| `tests/test_runtime_command_contracts.py` | 修改 | 新指令的 contract 測試；事件總數 31 → 37 |
| `bim-streaming-server/.../messaging/camera_view.py` | 新增 | 預設視角方向、朝向矩陣、相機狀態換算、`CameraViewController`、`KitCameraApi` |
| `bim-streaming-server/.../messaging/fly_navigation.py` | 新增 | `FlyNavigationController`：讀寫官方飛行速度設定 |
| `bim-streaming-server/.../messaging/runtime_authority.py` | 修改 | 指令清單與授權欄位 |
| `bim-streaming-server/.../messaging/stage_management.py` | 修改 | 登記與處理 3 個新指令；換場景時清除狀態 |
| `bim-streaming-server/tests/test_camera_view.py` | 新增 | 相機換算與控制器測試 |
| `bim-streaming-server/tests/test_fly_navigation.py` | 新增 | 飛行速度控制器測試 |
| `bim-streaming-server/tests/test_runtime_command_authority.py` | 修改 | 清單斷言 |
| `bim-streaming-server/tests/test_stage_management_runtime_authority.py` | 修改 | 新處理器測試、`make_manager` 新欄位 |
| `bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts` | 修改 | 指令清單與 zod 驗證 |
| `bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts` | 修改 | 新指令授權測試 |
| `web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts`（含 test） | 修改 | 會改變畫面的指令清單 |
| `web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts`（含 test） | 修改 | 事件目錄與回報對應 |
| `web-viewer-sample/src/clients/streamMessages.ts` | 修改 | 三個指令的 message builder |
| `web-viewer-sample/src/clients/cameraStreamMessages.test.ts` | 新增 | builder 測試 |
| `web-viewer-sample/src/console/cameraViewBridge.ts` | 新增 | 型別、解析、回報比對、`CorrelatedRuntimeExchange`、`PendingReply` |
| `web-viewer-sample/src/console/cameraViewBridge.test.ts` | 新增 | 上述單元測試 |
| `web-viewer-sample/src/Window.tsx` | 修改 | 三個交換物件、父視窗訊息、回報與拒絕路由 |
| `web-viewer-sample/src/console/cameraViewWindow.dom.test.tsx` | 新增 | iframe 端整合測試 |
| `web-viewer-sample/src/console/EmbeddedViewer.tsx`、`ReviewSessionViewerPane.tsx`、`unified/WorkspaceViewportHost.tsx` | 修改 | 新 handle 方法逐層傳遞 |
| `web-viewer-sample/src/console/EmbeddedViewer.camera.test.tsx` | 新增 | 父視窗請求與回覆比對測試 |
| `web-viewer-sample/src/console/unified/viewportSlot.ts`、`ViewportSlotProvider.tsx` | 修改 | 相機與飛行狀態、送出動作 |
| `web-viewer-sample/src/console/unified/useViewerCommandState.ts`（含 test） | 新增 | 共用的指令狀態 hook |
| `web-viewer-sample/src/console/unified/viewerCommandText.ts` | 新增 | 錯誤原因與相機摘要文字 |
| `web-viewer-sample/src/console/unified/CameraViewControls.tsx`（含 test） | 新增 | 視角與投影控制項 |
| `web-viewer-sample/src/console/unified/FlyNavigationControls.tsx`（含 test） | 新增 | 飛行說明、速度、讀取相機 |
| `web-viewer-sample/src/console/unified/WorkspacePage.tsx` | 修改 | 接通工具列按鈕與左側兩個新區塊 |
| `web-viewer-sample/src/console/unified/workspaceCameraControls.test.tsx` | 新增 | 工作台整合測試 |
| `web-viewer-sample/src/console/unified/workspaceStageTree.test.tsx` | 修改 | 相機按鈕改為可用 |
| `docs/plans/viewer-navigation-walkthrough.md` | 修改 | 1a 完成後勾選 §7.1，更新 §9 V1–V3 |

以下 `M=bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`，`W=C:\Repos\active\iot\AI-BIM-governance.worktrees\viewer-navigation-design`。所有命令從 worktree root 以 PowerShell 執行，除非另外註明。

---

### Task 0：本機真實 Chrome 驗收環境與 V1 飛行輸入驗證

這個任務不保留任何程式碼，產出是「環境可用」與「V1 是否成立」的證據。V1 不成立時，Task 9 的飛行說明與做法都要重新設計，必須先回報使用者再繼續。

**Files:** 無（證據存本機 `%USERPROFILE%\.codex\visualizations\<yyyy>\<mm>\<dd>\viewer-navigation-1a\`，不進 repo）

- [ ] **Step 1：確認預設埠沒有被占用**

Run: `pwsh -NoProfile -File scripts\dev\ensure-host-native-ports-free.ps1 -DetectOnly`
Expected: exit code 0（Kit、串流與轉檔服務的埠都可用；這個模式只讀取，不會結束任何程序）。

Run: `Get-NetTCPConnection -State Listen -LocalPort 8004,5173 -ErrorAction SilentlyContinue`
Expected: 沒有輸出。

任一項顯示埠被占用：停止並回報使用者，不要自行結束程序。

- [ ] **Step 2：安裝相依並建置**

```powershell
Push-Location web-viewer-sample; npm ci; npm run build:ui; Pop-Location
Push-Location bim-review-coordinator; npm ci; Pop-Location
Push-Location bim-streaming-server; .\repo.bat build; Pop-Location
```

Expected: 三段都以 exit code 0 結束；`web-viewer-sample\dist-ui\index.html` 存在；`bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe` 存在。

- [ ] **Step 3：以 worktree 程式碼啟動本機服務**

```powershell
$env:CONSOLE_DIST_DIR = "$PWD\web-viewer-sample\dist-ui"
$env:BIM_FILE_LIBRARY_ROOT = "C:\Repos\active\iot\AI-BIM-governance\storage"
$env:STREAMING_CONVERSION_WORK_DIR = "C:\Repos\active\iot\AI-BIM-governance"
pwsh -NoProfile -File scripts\start-all.ps1
```

Expected: `bim-review-coordinator`、`web-viewer-sample`、`bim-streaming-conversion-service` 三項健康檢查顯示 `[ok   ]`；`scripts\.run\bim-streaming-server.log` 出現 Kit 啟動完成的紀錄。
若任何服務因缺少設定而失敗，停止，分類為 `ENVIRONMENT_FAILURE` 回報使用者；**不要讀取或複製設定檔**。

- [ ] **Step 4：在真實 Chrome 開啟審查並取得 3D 畫面**

用真實 Chrome（Claude in Chrome 擴充功能，或以 CDP 啟動的本機 Chrome）開啟 `http://127.0.0.1:8004/ui#a1`，依現有流程選擇本機建築 IFC → 建立審查 → 啟動 3D。
Expected: 工作台顯示模型畫面；Viewer 摘要顯示畫面、指令通道、模型相符三項都就緒。記錄 session ID（只記在本機證據）。

- [ ] **Step 5：驗證 V1（內嵌 viewer 能收到飛行操作）**

1. 截圖 `v1-before.png`。
2. 在 3D 畫面點一下取得焦點，按住滑鼠右鍵，同時按住 `W` 約 1 秒後放開。
3. 截圖 `v1-after.png`。
4. 按住右鍵時滾動滾輪數格，再按住 `W` 約 1 秒，截圖 `v1-after-wheel.png`。

Expected: `v1-after.png` 的視點明顯前進；滾輪後同樣時間的前進距離不同。
若畫面沒有變化：分類為 `PRODUCT_FAILURE`（輸入未轉送到 Kit），停止並回報，附三張截圖與 Chrome console 錯誤；不要自行改用其他輸入方式。

- [ ] **Step 6：記錄環境與結論**

在證據目錄寫 `README.md`：branch、base commit、實際使用的命令、各服務埠、session ID、V1 結論與截圖檔名。完成後可先停止服務（`pwsh -NoProfile -File scripts\stop-all.ps1`），Task 10 會用新的建置結果重新啟動。

---

### Task 1：DataChannel contract

**Files:**
- Modify: `tests/contracts/kit-datachannel-v1.schema.json`
- Modify: `tests/contracts/runtime-mutation-authority-v1.json`
- Test: `tests/test_runtime_command_contracts.py`

**Interfaces:**
- Produces（線上格式，後續任務都依此實作）：
  - `cameraViewRequest.payload` ＝ 操作權信封＋`{"action":"preset","view":"top|front|back|left|right|iso","scope":"building|all"}` 或 `{"action":"projection","projection":"perspective|orthographic"}`
  - `cameraStateRequest.payload` ＝ `{"trace_id","session_id","request_id"}`
  - `flyNavigationRequest.payload` ＝ 操作權信封＋`{"speed": 0.01..1000}`
  - `cameraViewResult`／`cameraStateResult` ＝ `{"trace_id","request_id","result":"success|error","error"?,"camera"?}`；成功時必須有 `camera`，失敗時不得有
  - `flyNavigationResult` ＝ `{"trace_id","request_id","result","error"?,"speed"?}`；成功時必須有 `speed`
  - `cameraState` ＝ `{"projection","position":[3],"direction":[3],"up":[3],"target_distance","fov_deg":number|null,"ortho_height":number|null}`

- [ ] **Step 1：寫失敗測試**

在 `tests/test_runtime_command_contracts.py`：

(a) 在 `datachannel_message_samples()` 的 `"commandRejected"` 項目之前加入：

```python
        "cameraViewRequest": {**authority, "action": "preset", "view": "top", "scope": "building"},
        "cameraViewResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                             "camera": camera_state_sample()},
        "cameraStateRequest": {"trace_id": TRACE_ID, "session_id": SESSION_ID, "request_id": "request_001"},
        "cameraStateResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                              "camera": camera_state_sample()},
        "flyNavigationRequest": {**authority, "speed": 2.5},
        "flyNavigationResult": {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success",
                                "speed": 2.5},
```

(b) 在 `def kit_event_catalog()` 之前加入：

```python
def camera_state_sample() -> dict:
    return {
        "projection": "perspective",
        "position": [10.0, -20.0, 1.6],
        "direction": [0.0, 1.0, 0.0],
        "up": [0.0, 0.0, 1.0],
        "target_distance": 12.5,
        "fov_deg": 45.0,
        "ortho_height": None,
    }
```

(c) 把 `test_all_31_datachannel_payload_contracts_require_and_validate_trace_id` 改名為 `test_all_37_datachannel_payload_contracts_require_and_validate_trace_id`，並把函式內的 `assert len(samples) == 31` 改成 `assert len(samples) == 37`。

(d) 在 `test_every_runtime_mutator_requires_request_correlation` 的 parametrize 清單最後（`("resetStage", {}),` 之後）加入：

```python
        ("cameraViewRequest", {"action": "projection", "projection": "orthographic"}),
        ("flyNavigationRequest", {"speed": 1.0}),
```

(e) 在檔案末尾加入：

```python
@pytest.mark.parametrize("extra", [
    {"action": "preset", "view": view, "scope": scope}
    for view in ("top", "front", "back", "left", "right", "iso") for scope in ("building", "all")
] + [{"action": "projection", "projection": p} for p in ("perspective", "orthographic")])
def test_camera_view_request_accepts_closed_actions(extra):
    validator = load_validator("kit-datachannel-v1.schema.json")
    validator.validate({"event_type": "cameraViewRequest", "payload": {**authority_envelope(), **extra}})


@pytest.mark.parametrize("extra", [
    {"action": "preset", "view": "bottom", "scope": "building"},
    {"action": "preset", "view": "top"},
    {"action": "preset", "view": "top", "scope": "building", "projection": "perspective"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "projection"},
    {"action": "apply_state"},
    {"view": "top", "scope": "building"},
])
def test_camera_view_request_rejects_open_or_mixed_actions(extra):
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {"event_type": "cameraViewRequest", "payload": {**authority_envelope(), **extra}}
    assert list(validator.iter_errors(message))


@pytest.mark.parametrize("speed", [0, 0.009, 1000.1, "2", None, True])
def test_fly_navigation_request_rejects_out_of_range_speed(speed):
    validator = load_validator("kit-datachannel-v1.schema.json")
    message = {"event_type": "flyNavigationRequest", "payload": {**authority_envelope(), "speed": speed}}
    assert list(validator.iter_errors(message))


@pytest.mark.parametrize("event_type", ["cameraViewResult", "cameraStateResult"])
def test_camera_results_bind_camera_to_success_only(event_type):
    validator = load_validator("kit-datachannel-v1.schema.json")
    ok = {"trace_id": TRACE_ID, "request_id": "request_001", "result": "success", "camera": camera_state_sample()}
    validator.validate({"event_type": event_type, "payload": ok})
    missing = {key: value for key, value in ok.items() if key != "camera"}
    assert list(validator.iter_errors({"event_type": event_type, "payload": missing}))
    error = {"trace_id": TRACE_ID, "request_id": "request_001", "result": "error", "error": "Camera view could not be applied."}
    validator.validate({"event_type": event_type, "payload": error})
    assert list(validator.iter_errors({"event_type": event_type, "payload": {**error, "camera": camera_state_sample()}}))
    for field in ("viewer_lease_token", "internal_token", "raw_response"):
        assert list(validator.iter_errors({"event_type": event_type, "payload": {**ok, field: "x"}}))


@pytest.mark.parametrize("mutate", [
    lambda c: c.update(projection="fisheye"),
    lambda c: c.update(position=[0, 0]),
    lambda c: c.update(direction=[0, 0, "1"]),
    lambda c: c.update(target_distance=0),
    lambda c: c.update(fov_deg=180),
    lambda c: c.update(ortho_height=0),
    lambda c: c.pop("up"),
    lambda c: c.update(extra=True),
])
def test_camera_state_is_closed_and_bounded(mutate):
    validator = load_validator("kit-datachannel-v1.schema.json")
    camera = camera_state_sample()
    mutate(camera)
    message = {"event_type": "cameraStateResult", "payload": {
        "trace_id": TRACE_ID, "request_id": "request_001", "result": "success", "camera": camera}}
    assert list(validator.iter_errors(message))


def test_fly_result_binds_speed_to_success_only():
    validator = load_validator("kit-datachannel-v1.schema.json")
    base = {"trace_id": TRACE_ID, "request_id": "request_001"}
    validator.validate({"event_type": "flyNavigationResult", "payload": {**base, "result": "success", "speed": 3.0}})
    assert list(validator.iter_errors({"event_type": "flyNavigationResult", "payload": {**base, "result": "success"}}))
    assert list(validator.iter_errors({"event_type": "flyNavigationResult",
                                       "payload": {**base, "result": "error", "speed": 3.0}}))


def test_mutation_authority_vocabulary_lists_camera_commands():
    fixture = json.loads((CONTRACTS / "runtime-mutation-authority-v1.json").read_text(encoding="utf-8"))
    assert {"cameraViewRequest", "flyNavigationRequest"} <= set(fixture["mutatingEventTypes"])
    assert "cameraStateRequest" in fixture["readonlyEventTypes"]
    assert "cameraStateRequest" not in fixture["mutatingEventTypes"]
```

- [ ] **Step 2：確認測試失敗**

Run: `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_runtime_command_contracts.py -q -p no:cacheprovider`
Expected: FAIL，訊息包含 `assert kit_event_catalog() == set(samples)` 或 `'cameraViewRequest'` 找不到定義。

- [ ] **Step 3：修改 schema**

在 `tests/contracts/kit-datachannel-v1.schema.json`：

(a) `oneOf` 陣列最後加入六筆：

```json
    { "$ref": "#/$defs/cameraViewRequest" },
    { "$ref": "#/$defs/cameraViewResult" },
    { "$ref": "#/$defs/cameraStateRequest" },
    { "$ref": "#/$defs/cameraStateResult" },
    { "$ref": "#/$defs/flyNavigationRequest" },
    { "$ref": "#/$defs/flyNavigationResult" }
```

(b) `$defs` 內加入（依字母順序插入或放在最後皆可，JSON 需保持合法）：

```json
    "cameraVector": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": { "type": "number", "minimum": -1000000000, "maximum": 1000000000 }
    },
    "cameraState": {
      "description": "camera-state/v1. World metres, Z up. Readback of camera settings; not evidence of rendered pixels.",
      "type": "object",
      "required": ["projection", "position", "direction", "up", "target_distance", "fov_deg", "ortho_height"],
      "properties": {
        "projection": { "enum": ["perspective", "orthographic"] },
        "position": { "$ref": "#/$defs/cameraVector" },
        "direction": { "$ref": "#/$defs/cameraVector" },
        "up": { "$ref": "#/$defs/cameraVector" },
        "target_distance": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000000000 },
        "fov_deg": { "type": ["number", "null"], "exclusiveMinimum": 0, "exclusiveMaximum": 180 },
        "ortho_height": { "type": ["number", "null"], "exclusiveMinimum": 0, "maximum": 1000000000 }
      },
      "additionalProperties": false
    },
    "cameraCommandResultPayload": {
      "type": "object",
      "required": ["trace_id", "request_id", "result"],
      "properties": {
        "trace_id": { "$ref": "#/$defs/dataChannelTraceId" },
        "request_id": { "$ref": "#/$defs/requestId" },
        "result": { "enum": ["success", "error"] },
        "error": { "type": "string", "maxLength": 200 },
        "camera": { "$ref": "#/$defs/cameraState" }
      },
      "additionalProperties": false,
      "if": { "properties": { "result": { "const": "success" } } },
      "then": { "required": ["camera"] },
      "else": { "not": { "required": ["camera"] } }
    },
    "cameraViewRequest": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "cameraViewRequest" },
        "payload": {
          "allOf": [{ "$ref": "#/$defs/runtimeAuthorityEnvelope" }],
          "type": "object",
          "required": ["action"],
          "properties": {
            "action": { "enum": ["preset", "projection"] },
            "view": { "enum": ["top", "front", "back", "left", "right", "iso"] },
            "scope": { "enum": ["building", "all"] },
            "projection": { "enum": ["perspective", "orthographic"] },
            "retry_of_request_id": { "$ref": "#/$defs/requestId" }
          },
          "oneOf": [
            {
              "properties": { "action": { "const": "preset" } },
              "required": ["view", "scope"],
              "not": { "required": ["projection"] }
            },
            {
              "properties": { "action": { "const": "projection" } },
              "required": ["projection"],
              "allOf": [
                { "not": { "required": ["view"] } },
                { "not": { "required": ["scope"] } }
              ]
            }
          ],
          "unevaluatedProperties": false
        }
      }
    },
    "cameraViewResult": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "cameraViewResult" },
        "payload": { "$ref": "#/$defs/cameraCommandResultPayload" }
      }
    },
    "cameraStateRequest": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "cameraStateRequest" },
        "payload": {
          "type": "object",
          "required": ["trace_id", "session_id", "request_id"],
          "properties": {
            "trace_id": { "$ref": "#/$defs/dataChannelTraceId" },
            "session_id": { "type": "string", "minLength": 1, "maxLength": 200 },
            "request_id": { "$ref": "#/$defs/requestId" }
          },
          "additionalProperties": false
        }
      }
    },
    "cameraStateResult": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "cameraStateResult" },
        "payload": { "$ref": "#/$defs/cameraCommandResultPayload" }
      }
    },
    "flyNavigationRequest": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "flyNavigationRequest" },
        "payload": {
          "allOf": [{ "$ref": "#/$defs/runtimeAuthorityEnvelope" }],
          "type": "object",
          "required": ["speed"],
          "properties": {
            "speed": { "type": "number", "minimum": 0.01, "maximum": 1000 },
            "retry_of_request_id": { "$ref": "#/$defs/requestId" }
          },
          "unevaluatedProperties": false
        }
      }
    },
    "flyNavigationResult": {
      "type": "object",
      "required": ["event_type", "payload"],
      "properties": {
        "event_type": { "const": "flyNavigationResult" },
        "payload": {
          "type": "object",
          "required": ["trace_id", "request_id", "result"],
          "properties": {
            "trace_id": { "$ref": "#/$defs/dataChannelTraceId" },
            "request_id": { "$ref": "#/$defs/requestId" },
            "result": { "enum": ["success", "error"] },
            "error": { "type": "string", "maxLength": 200 },
            "speed": { "type": "number", "minimum": 0.01, "maximum": 1000 }
          },
          "additionalProperties": false,
          "if": { "properties": { "result": { "const": "success" } } },
          "then": { "required": ["speed"] },
          "else": { "not": { "required": ["speed"] } }
        }
      }
    }
```

(c) 在 `tests/contracts/runtime-mutation-authority-v1.json`：`mutatingEventTypes` 最後加入 `"cameraViewRequest"`、`"flyNavigationRequest"`；`readonlyEventTypes` 最後加入 `"cameraStateRequest"`。

- [ ] **Step 4：確認測試通過，並確認 Kit 目前沒有發出未登記事件**

Run: `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_runtime_command_contracts.py -q -p no:cacheprovider`
Expected: PASS（含 `test_production_kit_dispatches_only_catalogued_literal_events`）。

Run: `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider`
Expected: 全部通過（2026-09-17 未修改時的基準是 1319 passed）。
Kit 的 `bim-streaming-server/tests/test_runtime_command_authority.py` 與 coordinator 的 fixture 比對測試會在這一步之後暫時失敗，這是預期狀態，分別由 Task 4、Task 2 修正。

- [ ] **Step 5：Commit**

```bash
git add tests/contracts/kit-datachannel-v1.schema.json tests/contracts/runtime-mutation-authority-v1.json tests/test_runtime_command_contracts.py
git diff --cached --check
git commit -m "test(contracts): 新增相機視角、相機狀態與飛行速度的 DataChannel 契約" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 2：coordinator 指令授權

**Files:**
- Modify: `bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts:159-181`、`:283-305`
- Test: `bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts`

**Interfaces:**
- Consumes: Task 1 的線上欄位（Kit 以 snake_case 原樣轉送 `action`、`view`、`scope`、`projection`、`speed`）。
- Produces: `RUNTIME_MUTATION_AUTHORITY_VOCABULARY` 含新指令；`runtimeCommandContextSchemas.cameraViewRequest`、`.flyNavigationRequest`。

- [ ] **Step 1：寫失敗測試**

在 `runtimeMutationAuthority.test.ts` 的 `describe("RuntimeMutationAuthority", ...)` 內、`it("preauthorizes a server-resolved pending stage binding", () => {` 之前加入（沿用檔案內既有的 `testAuthority()` helper）：

```ts
  const cameraCommand = (requestedEventType: string, commandContext: Record<string, unknown>, requestId = "camera-1") => ({
    sessionId: "review_session_a", sourceClientId: "viewer_lease_a", credential: "test-lease",
    requestId, requestedEventType, commandContext,
  });

  it.each([
    ["cameraViewRequest", { action: "preset", view: "iso", scope: "all" }],
    ["cameraViewRequest", { action: "projection", projection: "orthographic" }],
    ["flyNavigationRequest", { speed: 2.5 }],
  ])("authorizes %s with a closed command context", (requestedEventType, commandContext) => {
    const { authority } = testAuthority();
    expect(authority.authorizeRuntimeCommand(cameraCommand(requestedEventType, { ...commandContext })))
      .toMatchObject({ authorized: true });
  });

  it.each([
    ["cameraViewRequest", { action: "preset", view: "bottom", scope: "all" }],
    ["cameraViewRequest", { action: "preset", view: "top" }],
    ["cameraViewRequest", { action: "projection", projection: "orthographic", view: "top" }],
    ["cameraViewRequest", { action: "apply_state" }],
    ["flyNavigationRequest", { speed: 0 }],
    ["flyNavigationRequest", { speed: 1001 }],
    ["flyNavigationRequest", { speed: Number.NaN }],
    ["flyNavigationRequest", { speed: 2, extra: true }],
  ])("denies %s with an invalid command context", (requestedEventType, commandContext) => {
    const { authority } = testAuthority();
    expect(authority.authorizeRuntimeCommand(cameraCommand(requestedEventType, { ...commandContext }, "camera-2")))
      .toMatchObject({ authorized: false, reason: "invalid_payload" });
  });

  it("denies camera commands for spectators and closed sessions", () => {
    const command = cameraCommand("cameraViewRequest", { action: "projection", projection: "perspective" }, "camera-3");
    const denied = testAuthority({}, {
      inspectRuntimeLease: () => ({ authorized: false, reason: "spectator_readonly", detailCode: "test_denial" }),
    });
    expect(denied.authority.authorizeRuntimeCommand(command)).toMatchObject({ authorized: false, reason: "spectator_readonly" });
    const { authority, setSessionStatus } = testAuthority();
    setSessionStatus(command.sessionId, "closed");
    expect(authority.authorizeRuntimeCommand(command)).toMatchObject({ authorized: false, reason: "session_lifecycle_blocked" });
  });
```

檔案後段的 `it("matches the tests-only cross-language runtime mutation vocabulary fixture", ...)` 有一份 `validContexts` 表，必須和 fixture 的會改變畫面指令一一對應。在其中 `resetStage: {},` 的下一行加入：

```ts
      cameraViewRequest: { action: "projection", projection: "orthographic" },
      flyNavigationRequest: { speed: 1 },
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location bim-review-coordinator; npx vitest run tests/services/runtimeMutationAuthority.test.ts; Pop-Location`
Expected: FAIL；fixture 比對測試顯示集合不一致，新測試顯示 `unsupported_command` 或 `invalid_payload`。

- [ ] **Step 3：實作**

在 `RUNTIME_MUTATION_AUTHORITY_VOCABULARY`：

```ts
  mutatingEventTypes: [
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "clipPlaneRequest",
    "measurementRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
    "cameraViewRequest",
    "flyNavigationRequest",
  ],
  readonlyEventTypes: ["loadingStateQuery", "getChildrenRequest", "cameraStateRequest"],
```

在 `runtimeCommandContextSchemas` 物件最後（`resetStage` 之後）加入：

```ts
  cameraViewRequest: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("preset"),
      view: z.enum(["top", "front", "back", "left", "right", "iso"]),
      scope: z.enum(["building", "all"]),
    }).strict(),
    z.object({
      action: z.literal("projection"),
      projection: z.enum(["perspective", "orthographic"]),
    }).strict(),
  ]),
  flyNavigationRequest: z.object({ speed: z.number().finite().min(0.01).max(1000) }).strict(),
```

- [ ] **Step 4：確認測試與建置通過**

Run: `Push-Location bim-review-coordinator; npm test; npm run build; Pop-Location`
Expected: 全部 PASS；build exit code 0。

- [ ] **Step 5：Commit**

```bash
git add bim-review-coordinator/src/services/runtimeMutationAuthority/runtimeMutationAuthority.ts bim-review-coordinator/tests/services/runtimeMutationAuthority.test.ts
git diff --cached --check
git commit -m "feat(coordinator): 授權相機視角與飛行速度指令" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 3：Kit 相機換算與控制器

**Files:**
- Create: `M/camera_view.py`
- Test: `bim-streaming-server/tests/test_camera_view.py`

**Interfaces:**
- Produces（Task 4 使用）：
  - `parse_camera_view_request(payload: dict) -> dict`：回傳 `{"action":"preset","view":str,"scope":str}` 或 `{"action":"projection","projection":str}`；不合法時 `raise ValueError`
  - `class CameraViewController(api)`：`sync_stage(stage) -> None`、`orient(stage, view: str) -> None`、`set_projection(stage, projection: str) -> None`、`read_state(stage) -> dict`（`camera-state/v1`）
  - `class KitCameraApi()`：實際 Kit adapter，方法見下方程式碼
- `api` 必須提供：`camera_path() -> str`、`camera_to_world(stage, path) -> Gf.Matrix4d`、`center_of_interest(stage, path) -> Gf.Vec3d`、`get_camera_attr(stage, path, name)`、`set_camera_attr(stage, path, name, value) -> None`、`set_camera_to_world(stage, path, matrix: Gf.Matrix4d) -> None`、`aspect_ratio() -> float | None`

- [ ] **Step 1：寫失敗測試**

建立 `bim-streaming-server/tests/test_camera_view.py`：

```python
"""Camera math and controller tests with an injected camera API; not GPU evidence."""
import math
import sys
from pathlib import Path

import pytest
from pxr import Gf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from camera_view import (  # noqa: E402
    APERTURE_UNITS_PER_WORLD_UNIT,
    PRESET_FORWARD,
    CameraViewController,
    camera_state_from,
    look_at_camera_to_world,
    parse_camera_view_request,
    vertical_fov_deg,
)


class FakeCameraApi:
    def __init__(self, matrix=None, coi=None, attrs=None, aspect=16 / 9):
        self.path = "/OmniverseKit_Persp"
        self.matrix = matrix or look_at_camera_to_world(Gf.Vec3d(0, -10, 2), PRESET_FORWARD["front"], "front")
        self.coi = coi or Gf.Vec3d(0, 0, -10)
        self.attrs = attrs or {"projection": "perspective", "focalLength": 18.147562, "horizontalAperture": 20.955,
                               "verticalAperture": 15.2908}
        self.aspect = aspect
        self.writes = []

    def camera_path(self):
        return self.path

    def camera_to_world(self, stage, path):
        return Gf.Matrix4d(self.matrix)

    def center_of_interest(self, stage, path):
        return Gf.Vec3d(self.coi)

    def get_camera_attr(self, stage, path, name):
        return self.attrs.get(name)

    def set_camera_attr(self, stage, path, name, value):
        self.writes.append((name, value))
        self.attrs[name] = value

    def set_camera_to_world(self, stage, path, matrix):
        self.writes.append(("transform", Gf.Matrix4d(matrix)))
        self.matrix = Gf.Matrix4d(matrix)

    def aspect_ratio(self):
        return self.aspect


def _close(actual, expected, tol=1e-6):
    return all(math.isclose(a, b, abs_tol=tol) for a, b in zip(actual, expected))


@pytest.mark.parametrize("payload,expected", [
    ({"action": "preset", "view": "iso", "scope": "all"}, {"action": "preset", "view": "iso", "scope": "all"}),
    ({"action": "projection", "projection": "orthographic"}, {"action": "projection", "projection": "orthographic"}),
])
def test_parse_accepts_closed_actions(payload, expected):
    assert parse_camera_view_request({**payload, "request_id": "r", "trace_id": "t"}) == expected


@pytest.mark.parametrize("payload", [
    {"action": "preset", "view": "bottom", "scope": "all"},
    {"action": "preset", "view": "top"},
    {"action": "preset", "view": "top", "scope": "all", "projection": "perspective"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "projection", "projection": "orthographic", "view": "top"},
    {"action": "apply_state"},
    {},
])
def test_parse_rejects_open_or_mixed_actions(payload):
    with pytest.raises(ValueError):
        parse_camera_view_request(payload)


@pytest.mark.parametrize("view", sorted(PRESET_FORWARD))
def test_look_at_matrix_points_camera_along_preset_forward(view):
    matrix = look_at_camera_to_world(Gf.Vec3d(1, 2, 3), PRESET_FORWARD[view], view)
    forward = matrix.TransformDir(Gf.Vec3d(0, 0, -1)).GetNormalized()
    up = matrix.TransformDir(Gf.Vec3d(0, 1, 0)).GetNormalized()
    assert _close(forward, PRESET_FORWARD[view])
    assert abs(Gf.Dot(forward, up)) < 1e-9
    assert _close(matrix.Transform(Gf.Vec3d(0, 0, 0)), (1, 2, 3))
    assert all(math.isfinite(v) for row in range(4) for v in matrix.GetRow(row))


def test_top_view_keeps_model_y_up_on_screen():
    matrix = look_at_camera_to_world(Gf.Vec3d(0, 0, 50), PRESET_FORWARD["top"], "top")
    assert _close(matrix.TransformDir(Gf.Vec3d(0, 1, 0)).GetNormalized(), (0, 1, 0))


def test_vertical_fov_uses_horizontal_aperture_fit():
    fov = vertical_fov_deg(horizontal_aperture=20.955, focal_length=18.147562, aspect=16 / 9)
    expected = math.degrees(2 * math.atan((20.955 / (16 / 9)) / (2 * 18.147562)))
    assert math.isclose(fov, expected)


def test_camera_state_reports_position_direction_distance_and_perspective_fov():
    api = FakeCameraApi()
    state = CameraViewController(api).read_state(object())
    assert state["projection"] == "perspective"
    assert _close(state["position"], (0, -10, 2))
    assert _close(state["direction"], (0, 1, 0))
    assert _close(state["up"], (0, 0, 1))
    assert math.isclose(state["target_distance"], 10)
    assert state["ortho_height"] is None and 0 < state["fov_deg"] < 180


def test_camera_state_reports_ortho_height_in_world_units():
    api = FakeCameraApi(attrs={"projection": "orthographic", "focalLength": 50.0, "horizontalAperture": 400.0,
                               "verticalAperture": 225.0}, aspect=16 / 9)
    state = camera_state_from(api.camera_to_world(None, None), api.center_of_interest(None, None),
                              "orthographic", 400.0, 50.0, 16 / 9, 225.0)
    assert state["fov_deg"] is None
    assert math.isclose(state["ortho_height"], 400.0 / (16 / 9) / APERTURE_UNITS_PER_WORLD_UNIT)


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_camera_state_refuses_non_finite_readback(bad):
    api = FakeCameraApi(coi=Gf.Vec3d(0, 0, bad))
    with pytest.raises(ValueError):
        CameraViewController(api).read_state(object())


def test_orient_keeps_position_and_writes_one_transform():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    controller.orient(object(), "top")
    kinds = [write[0] for write in api.writes]
    assert kinds == ["transform"]
    assert _close(api.matrix.Transform(Gf.Vec3d(0, 0, 0)), (0, -10, 2))
    assert _close(api.matrix.TransformDir(Gf.Vec3d(0, 0, -1)).GetNormalized(), (0, 0, -1))


def test_orthographic_matches_current_view_width_and_restores_perspective():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    stage = object()
    controller.set_projection(stage, "orthographic")
    width = 10 * 20.955 / 18.147562
    assert api.attrs["projection"] == "orthographic"
    assert math.isclose(api.attrs["horizontalAperture"], width * APERTURE_UNITS_PER_WORLD_UNIT)
    assert math.isclose(api.attrs["verticalAperture"], width / (16 / 9) * APERTURE_UNITS_PER_WORLD_UNIT)
    controller.set_projection(stage, "orthographic")
    assert [w for w in api.writes if w[0] == "projection"] == [("projection", "orthographic")]
    controller.set_projection(stage, "perspective")
    assert api.attrs == {"projection": "perspective", "focalLength": 18.147562,
                         "horizontalAperture": 20.955, "verticalAperture": 15.2908}


def test_stage_change_drops_perspective_backup():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    first, second = object(), object()
    controller.sync_stage(first)
    controller.set_projection(first, "orthographic")
    controller.sync_stage(second)
    api.attrs["horizontalAperture"] = 999.0
    controller.set_projection(second, "perspective")
    assert api.attrs["projection"] == "perspective"
    assert api.attrs["horizontalAperture"] == 999.0


def test_unknown_view_or_projection_is_rejected_without_writes():
    api = FakeCameraApi()
    controller = CameraViewController(api)
    with pytest.raises(ValueError):
        controller.orient(object(), "bottom")
    with pytest.raises(ValueError):
        controller.set_projection(object(), "fisheye")
    assert api.writes == []
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location bim-streaming-server; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_camera_view.py -q -p no:cacheprovider; Pop-Location`
Expected: FAIL，`ModuleNotFoundError: No module named 'camera_view'`。

- [ ] **Step 3：實作**

建立 `M/camera_view.py`：

```python
"""Camera view presets and camera-state/v1 readback.

Readback proves camera settings only; the rendered result needs real-browser evidence.
Directions use model axes (Z up), not true north.
"""
import math

# pxr is imported inside functions: stage_management host tests import this module
# while Kit stub modules (including a bare `pxr`) are installed.
_S = 1.0 / math.sqrt(3.0)
PRESET_FORWARD = {
    "top": (0.0, 0.0, -1.0),
    "front": (0.0, 1.0, 0.0),
    "back": (0.0, -1.0, 0.0),
    "left": (1.0, 0.0, 0.0),
    "right": (-1.0, 0.0, 0.0),
    "iso": (-_S, _S, -_S),
}
_PRESET_UP = {"top": (0.0, 1.0, 0.0)}
_WORLD_UP = (0.0, 0.0, 1.0)
PROJECTIONS = ("perspective", "orthographic")
SCOPES = ("building", "all")
# UsdGeomCamera: orthographic apertures are expressed in tenths of a world unit.
APERTURE_UNITS_PER_WORLD_UNIT = 10.0
_MAX_ABS = 1e9


def parse_camera_view_request(payload):
    action = payload.get("action")
    if action == "preset":
        view, scope = payload.get("view"), payload.get("scope")
        if view not in PRESET_FORWARD or scope not in SCOPES or "projection" in payload:
            raise ValueError("Invalid camera preset.")
        return {"action": "preset", "view": view, "scope": scope}
    if action == "projection":
        projection = payload.get("projection")
        if projection not in PROJECTIONS or "view" in payload or "scope" in payload:
            raise ValueError("Invalid camera projection.")
        return {"action": "projection", "projection": projection}
    raise ValueError("Invalid camera action.")


def look_at_camera_to_world(position, forward, view):
    from pxr import Gf
    up = Gf.Vec3d(*_PRESET_UP.get(view, _WORLD_UP))
    eye = Gf.Vec3d(position)
    return Gf.Matrix4d(1.0).SetLookAt(eye, eye + Gf.Vec3d(*forward), up).GetInverse()


def vertical_fov_deg(horizontal_aperture, focal_length, aspect):
    # Kit fits the aperture horizontally to the render resolution.
    return math.degrees(2.0 * math.atan((horizontal_aperture / aspect) / (2.0 * focal_length)))


def _finite_vec(vector):
    values = [float(v) for v in vector]
    if not all(math.isfinite(v) and abs(v) <= _MAX_ABS for v in values):
        raise ValueError("Camera readback is not finite.")
    return values


def camera_state_from(camera_to_world, center_of_interest, projection, horizontal_aperture,
                      focal_length, aspect, vertical_aperture):
    from pxr import Gf
    if projection not in PROJECTIONS:
        raise ValueError("Unsupported camera projection.")
    position = camera_to_world.Transform(Gf.Vec3d(0.0, 0.0, 0.0))
    direction = camera_to_world.TransformDir(Gf.Vec3d(0.0, 0.0, -1.0))
    up = camera_to_world.TransformDir(Gf.Vec3d(0.0, 1.0, 0.0))
    target = camera_to_world.Transform(Gf.Vec3d(center_of_interest))
    distance = (target - position).GetLength()
    if direction.GetLength() == 0 or up.GetLength() == 0 or not math.isfinite(distance) or distance <= 0:
        raise ValueError("Camera readback is degenerate.")
    ratio = aspect if aspect and math.isfinite(aspect) and aspect > 0 else horizontal_aperture / vertical_aperture
    state = {
        "projection": projection,
        "position": _finite_vec(position),
        "direction": _finite_vec(direction.GetNormalized()),
        "up": _finite_vec(up.GetNormalized()),
        "target_distance": _finite_vec([distance])[0],
        "fov_deg": None,
        "ortho_height": None,
    }
    if projection == "perspective":
        fov = vertical_fov_deg(horizontal_aperture, focal_length, ratio)
        if not (math.isfinite(fov) and 0 < fov < 180):
            raise ValueError("Camera field of view is invalid.")
        state["fov_deg"] = fov
    else:
        height = horizontal_aperture / ratio / APERTURE_UNITS_PER_WORLD_UNIT
        if not (math.isfinite(height) and 0 < height <= _MAX_ABS):
            raise ValueError("Camera orthographic height is invalid.")
        state["ortho_height"] = height
    return state


class CameraViewController:
    def __init__(self, api):
        self._api = api
        self._stage = None
        self._perspective_backup = None

    def sync_stage(self, stage):
        if stage is not self._stage:
            self._stage = stage
            self._perspective_backup = None

    def orient(self, stage, view):
        if view not in PRESET_FORWARD:
            raise ValueError("Invalid camera preset.")
        from pxr import Gf
        path = self._api.camera_path()
        current = self._api.camera_to_world(stage, path)
        position = current.Transform(Gf.Vec3d(0.0, 0.0, 0.0))
        self._api.set_camera_to_world(stage, path, look_at_camera_to_world(position, PRESET_FORWARD[view], view))

    def set_projection(self, stage, projection):
        if projection not in PROJECTIONS:
            raise ValueError("Invalid camera projection.")
        api, path = self._api, self._api.camera_path()
        current = api.get_camera_attr(stage, path, "projection")
        if current == projection:
            return
        if projection == "orthographic":
            state = self.read_state(stage)
            focal = float(api.get_camera_attr(stage, path, "focalLength"))
            horizontal = float(api.get_camera_attr(stage, path, "horizontalAperture"))
            vertical = float(api.get_camera_attr(stage, path, "verticalAperture"))
            aspect = api.aspect_ratio() or horizontal / vertical
            width = state["target_distance"] * horizontal / focal
            self._perspective_backup = (path, horizontal, vertical)
            api.set_camera_attr(stage, path, "projection", "orthographic")
            api.set_camera_attr(stage, path, "horizontalAperture", width * APERTURE_UNITS_PER_WORLD_UNIT)
            api.set_camera_attr(stage, path, "verticalAperture", width / aspect * APERTURE_UNITS_PER_WORLD_UNIT)
            return
        api.set_camera_attr(stage, path, "projection", "perspective")
        backup, self._perspective_backup = self._perspective_backup, None
        if backup is not None and backup[0] == path:
            api.set_camera_attr(stage, path, "horizontalAperture", backup[1])
            api.set_camera_attr(stage, path, "verticalAperture", backup[2])

    def read_state(self, stage):
        api, path = self._api, self._api.camera_path()
        projection = api.get_camera_attr(stage, path, "projection") or "perspective"
        return camera_state_from(
            api.camera_to_world(stage, path),
            api.center_of_interest(stage, path),
            projection,
            float(api.get_camera_attr(stage, path, "horizontalAperture")),
            float(api.get_camera_attr(stage, path, "focalLength")),
            api.aspect_ratio(),
            float(api.get_camera_attr(stage, path, "verticalAperture")),
        )


class KitCameraApi:
    """Official Kit camera access; authored on the session layer like resetStage."""

    def camera_path(self):
        from omni.kit.viewport.utility import get_active_viewport_camera_string
        return get_active_viewport_camera_string()

    def _camera(self, stage, path):
        from pxr import UsdGeom
        camera = UsdGeom.Camera(stage.GetPrimAtPath(path))
        if not camera:
            raise ValueError("Viewport camera unavailable.")
        return camera

    def camera_to_world(self, stage, path):
        from pxr import Usd
        return self._camera(stage, path).ComputeLocalToWorldTransform(Usd.TimeCode.Default())

    def center_of_interest(self, stage, path):
        from pxr import Gf
        value = self._camera(stage, path).GetPrim().GetAttribute("omni:kit:centerOfInterest").Get()
        if value is None:
            raise ValueError("Camera center of interest unavailable.")
        return Gf.Vec3d(value)

    def get_camera_attr(self, stage, path, name):
        return self._camera(stage, path).GetPrim().GetAttribute(name).Get()

    def set_camera_attr(self, stage, path, name, value):
        from pxr import Usd
        attribute = self._camera(stage, path).GetPrim().GetAttribute(name)
        with Usd.EditContext(stage, Usd.EditTarget(stage.GetSessionLayer())):
            if not attribute.Set(value):
                raise ValueError("Camera attribute could not be set.")

    def set_camera_to_world(self, stage, path, matrix):
        from pxr import Gf, Usd
        import omni.kit.commands
        camera = self._camera(stage, path)
        parent = camera.ComputeParentToWorldTransform(Usd.TimeCode.Default())
        old_local = camera.ComputeLocalToWorldTransform(Usd.TimeCode.Default()) * parent.GetInverse()
        new_local = Gf.Matrix4d(matrix) * parent.GetInverse()
        with Usd.EditContext(stage, Usd.EditTarget(stage.GetSessionLayer())):
            omni.kit.commands.execute(
                "TransformPrimCommand",
                path=path,
                new_transform_matrix=new_local,
                old_transform_matrix=old_local,
            )

    def aspect_ratio(self):
        from omni.kit.viewport.utility import get_active_viewport
        viewport = get_active_viewport()
        resolution = getattr(viewport, "resolution", None) if viewport is not None else None
        if not resolution or len(resolution) != 2 or not resolution[1]:
            return None
        return float(resolution[0]) / float(resolution[1])
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location bim-streaming-server; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_camera_view.py -q -p no:cacheprovider; Pop-Location`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/camera_view.py bim-streaming-server/tests/test_camera_view.py
git diff --cached --check
git commit -m "feat(kit): 新增相機預設視角、投影切換與相機狀態讀取" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 4：Kit 飛行速度與指令接線

**Files:**
- Create: `M/fly_navigation.py`
- Modify: `M/runtime_authority.py:12-29`、`:457-470`
- Modify: `M/stage_management.py`（import 區、`__init__`、`outgoing`、`incoming`、`_on_clip_plane` 之後、`_on_stage_closing`）
- Test: `bim-streaming-server/tests/test_fly_navigation.py`（新增）
- Test: `bim-streaming-server/tests/test_runtime_command_authority.py`
- Test: `bim-streaming-server/tests/test_stage_management_runtime_authority.py`

**Interfaces:**
- Consumes: Task 3 的 `CameraViewController`、`KitCameraApi`、`parse_camera_view_request`；`StageManager._frame_ifc_model(stage, scope) -> list[str]`（既有，失敗時 raise `ValueError`）。
- Produces: `FlyNavigationController(settings)`：`read() -> float`、`apply(speed) -> float`；`StageManager._on_camera_view`、`_on_camera_state`、`_on_fly_navigation`；Kit 發出 `cameraViewResult`、`cameraStateResult`、`flyNavigationResult`。

- [ ] **Step 1：寫失敗測試**

(a) 建立 `bim-streaming-server/tests/test_fly_navigation.py`：

```python
"""Fly-speed settings tests with injected settings; not evidence of camera motion."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging"))
from fly_navigation import VELOCITY, VELOCITY_MAX, VELOCITY_MIN, FlyNavigationController  # noqa: E402


class FakeSettings:
    def __init__(self, values=None):
        self.values = dict(values or {})
        self.ignore_writes = False

    def get(self, key):
        return self.values.get(key)

    def set_float(self, key, value):
        if not self.ignore_writes:
            self.values[key] = value


def test_read_uses_kit_fallback_when_unset():
    assert FlyNavigationController(FakeSettings()).read() == 1.0


def test_apply_writes_official_setting_and_reads_back():
    settings = FakeSettings({VELOCITY: 1.0})
    assert FlyNavigationController(settings).apply(2.5) == 2.5
    assert settings.values[VELOCITY] == 2.5


def test_apply_respects_kit_speed_limits():
    settings = FakeSettings({VELOCITY_MIN: 0.5, VELOCITY_MAX: 4.0})
    controller = FlyNavigationController(settings)
    assert controller.apply(10) == 4.0
    assert controller.apply(0.1) == 0.5


@pytest.mark.parametrize("bad", [0, 0.001, 1000.5, float("nan"), float("inf"), True, "2", None])
def test_apply_rejects_invalid_speed_without_writing(bad):
    settings = FakeSettings()
    with pytest.raises(ValueError):
        FlyNavigationController(settings).apply(bad)
    assert VELOCITY not in settings.values


def test_apply_reports_readback_mismatch():
    settings = FakeSettings({VELOCITY: 1.0})
    settings.ignore_writes = True
    with pytest.raises(ValueError):
        FlyNavigationController(settings).apply(3.0)
```

(b) 在 `bim-streaming-server/tests/test_runtime_command_authority.py` 的 `test_runtime_command_catalogs_are_explicit` 最後加三行，並在檔案末尾加一個測試：

```python
    assert "cameraViewRequest" in MUTATING_EVENTS
    assert "flyNavigationRequest" in MUTATING_EVENTS
    assert "cameraStateRequest" in READONLY_EVENTS
```

```python
def test_camera_commands_forward_only_their_command_fields():
    payload = {"action": "preset", "view": "top", "scope": "all", "projection": "x",
               "viewer_lease_token": "secret", "role": "primary"}
    assert runtime_authority._command_context("cameraViewRequest", payload) == {
        "action": "preset", "view": "top", "scope": "all", "projection": "x"}
    assert runtime_authority._command_context("flyNavigationRequest", {"speed": 2.5, "role": "primary"}) == {"speed": 2.5}
```

（`projection` 在 preset 時仍會被轉送，由 coordinator 的 zod 嚴格驗證拒絕；這個測試確認 Kit 不會自行吞掉欄位。）

(c) 在 `bim-streaming-server/tests/test_stage_management_runtime_authority.py`：

- `make_manager()` 內 `manager._section_plane = None` 下一行加入：

```python
    manager._camera_view = None
    manager._fly_navigation = None
```

- `test_constructor_registers_clip_request_result_and_stage_closing` 最後加入：

```python
    assert by_name["cameraViewRequest"] == manager._on_camera_view
    assert by_name["cameraStateRequest"] == manager._on_camera_state
    assert by_name["flyNavigationRequest"] == manager._on_fly_navigation
    assert {"cameraViewResult", "cameraStateResult", "flyNavigationResult"} <= set(outgoing)
```

- `test_every_stage_mutator_denial_emits_only_command_rejected_before_mutation` 的 `cases` 清單最後加入：

```python
        (manager._on_camera_view, "cameraViewRequest", {"action": "preset", "view": "top", "scope": "all"}),
        (manager._on_fly_navigation, "flyNavigationRequest", {"speed": 2.0}),
```

- `test_all_stage_inbound_handlers_drop_unverified_trace_before_read_or_mutation` 的 parametrize 清單最後加入：

```python
        ("_on_camera_view", "cameraViewRequest", {"action": "projection", "projection": "orthographic"}),
        ("_on_camera_state", "cameraStateRequest", {}),
        ("_on_fly_navigation", "flyNavigationRequest", {"speed": 2.0}),
```

- 檔案末尾加入：

```python
CAMERA = {"projection": "perspective", "position": [0.0, 0.0, 1.0], "direction": [0.0, 0.0, -1.0],
          "up": [0.0, 1.0, 0.0], "target_distance": 5.0, "fov_deg": 40.0, "ortho_height": None}


def _capture(monkeypatch):
    results = []
    monkeypatch.setattr(stage_management, "get_eventdispatcher", lambda: types.SimpleNamespace(
        dispatch_event=lambda name, payload: results.append((name, payload))))
    return results


def _camera_controller(calls):
    return types.SimpleNamespace(
        sync_stage=lambda stage: calls.append(("sync", stage)),
        orient=lambda stage, view: calls.append(("orient", view)),
        set_projection=lambda stage, projection: calls.append(("projection", projection)),
        read_state=lambda stage: CAMERA,
    )


def test_camera_preset_orients_then_frames_scope_and_reports_camera(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthority(True))
    manager._camera_view = _camera_controller(calls)
    monkeypatch.setattr(StageManager, "_frame_ifc_model",
                        classmethod(lambda cls, stage, scope: calls.append(("frame", scope)) or ["/World/Elements"]))
    manager._camera_task = types.SimpleNamespace(done=lambda: False, cancel=lambda: calls.append("cancel"))
    manager._on_camera_view(event({**base_payload("view-1"), "action": "preset", "view": "top", "scope": "all"}))
    assert calls == [("sync", context.stage), "cancel", ("orient", "top"), ("frame", "all")]
    assert results == [("cameraViewResult", {"result": "success", "camera": CAMERA,
                                              "request_id": "view-1", "trace_id": "rev_review_session_x"})]


def test_camera_projection_does_not_reframe(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthority(True))
    manager._camera_view = _camera_controller(calls)
    monkeypatch.setattr(StageManager, "_frame_ifc_model",
                        classmethod(lambda cls, stage, scope: pytest.fail("projection must not reframe")))
    manager._on_camera_view(event({**base_payload("view-2"), "action": "projection", "projection": "orthographic"}))
    assert calls == [("sync", context.stage), ("projection", "orthographic")]
    assert results[-1][1]["result"] == "success"


def test_camera_preset_refuses_stage_without_identity_elements_before_mutation(monkeypatch):
    context = DummyUsdContext()
    context.stage.GetPrimAtPath = lambda path: None
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthority(True))
    manager._camera_view = _camera_controller(calls)
    manager._on_camera_view(event({**base_payload("view-3"), "action": "preset", "view": "iso", "scope": "building"}))
    assert ("orient", "iso") not in calls
    assert results == [("cameraViewResult", {"result": "error", "error": "Camera view could not be applied.",
                                              "request_id": "view-3", "trace_id": "rev_review_session_x"})]


@pytest.mark.parametrize("bad", [
    {"action": "preset", "view": "bottom", "scope": "all"},
    {"action": "projection", "projection": "fisheye"},
    {"action": "apply_state"},
])
def test_camera_invalid_request_reports_generic_error_before_camera_access(monkeypatch, bad):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthority(True))
    manager._camera_view = types.SimpleNamespace(
        sync_stage=lambda stage: pytest.fail("invalid request reached the camera"))
    manager._on_camera_view(event({**base_payload("view-bad"), **bad}))
    assert results[-1][1]["result"] == "error"
    assert results[-1][1]["request_id"] == "view-bad"


def test_camera_failure_hides_private_exception_text(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthority(True))

    def boom(stage, projection):
        raise RuntimeError("private renderer exception")

    manager._camera_view = types.SimpleNamespace(sync_stage=lambda stage: None, set_projection=boom)
    manager._on_camera_view(event({**base_payload("view-4"), "action": "projection", "projection": "perspective"}))
    assert results[-1][1]["result"] == "error"
    assert "private" not in str(results) and "viewer-secret" not in str(results)


def test_camera_state_is_readonly_and_correlated(monkeypatch):
    context = DummyUsdContext()
    monkeypatch.setattr(stage_management.omni.usd, "get_context", lambda: context)
    results, calls = _capture(monkeypatch), []
    authority = FakeAuthority(False)
    manager = make_manager(authority)
    manager._camera_view = _camera_controller(calls)
    manager._on_camera_state(event({"request_id": "state-1", "session_id": "review_session_x",
                                    "trace_id": "rev_review_session_x"}))
    assert authority.calls == []
    assert calls == [("sync", context.stage)]
    assert results == [("cameraStateResult", {"result": "success", "camera": CAMERA,
                                               "request_id": "state-1", "trace_id": "rev_review_session_x"})]


def test_fly_navigation_applies_speed_and_reports_readback(monkeypatch):
    results, calls = _capture(monkeypatch), []
    manager = make_manager(FakeAuthority(True))
    manager._fly_navigation = types.SimpleNamespace(apply=lambda speed: calls.append(speed) or 2.5)
    manager._on_fly_navigation(event({**base_payload("fly-1"), "speed": 2.5}))
    assert calls == [2.5]
    assert results == [("flyNavigationResult", {"result": "success", "speed": 2.5,
                                                 "request_id": "fly-1", "trace_id": "rev_review_session_x"})]


def test_fly_navigation_failure_is_generic(monkeypatch):
    results = _capture(monkeypatch)
    manager = make_manager(FakeAuthority(True))

    def boom(speed):
        raise RuntimeError("private settings exception")

    manager._fly_navigation = types.SimpleNamespace(apply=boom)
    manager._on_fly_navigation(event({**base_payload("fly-2"), "speed": 2.5}))
    assert results == [("flyNavigationResult", {"result": "error", "error": "Fly speed could not be applied.",
                                                 "request_id": "fly-2", "trace_id": "rev_review_session_x"})]


def test_stage_closing_drops_camera_view_state():
    calls = []
    manager = make_manager(FakeAuthority(True))
    manager._camera_view = types.SimpleNamespace(sync_stage=lambda stage: calls.append(stage))
    manager._on_stage_closing()
    assert calls == [None]
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location bim-streaming-server; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_fly_navigation.py tests/test_runtime_command_authority.py tests/test_stage_management_runtime_authority.py -q -p no:cacheprovider; Pop-Location`
Expected: FAIL（`No module named 'fly_navigation'`、`AttributeError: ... '_on_camera_view'`、清單不一致）。

- [ ] **Step 3：實作**

(a) 建立 `M/fly_navigation.py`：

```python
"""Official Kit fly-speed setting; readback is not evidence of camera motion."""
import math

VELOCITY = "/persistent/app/viewport/camMoveVelocity"
VELOCITY_MIN = "/persistent/app/viewport/camVelocityMin"
VELOCITY_MAX = "/persistent/app/viewport/camVelocityMax"
MIN_SPEED = 0.01
MAX_SPEED = 1000.0


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


class FlyNavigationController:
    def __init__(self, settings):
        self._settings = settings

    def read(self):
        value = self._settings.get(VELOCITY)
        # omni.kit.manipulator.camera treats a missing speed as 1.
        return float(value) if _finite(value) and value > 0 else 1.0

    def apply(self, speed):
        if not _finite(speed) or not MIN_SPEED <= speed <= MAX_SPEED:
            raise ValueError("Invalid fly speed.")
        target = float(speed)
        low, high = self._settings.get(VELOCITY_MIN), self._settings.get(VELOCITY_MAX)
        if _finite(low):
            target = max(float(low), target)
        if _finite(high):
            target = min(float(high), target)
        self._settings.set_float(VELOCITY, target)
        actual = self.read()
        if not math.isclose(actual, target, rel_tol=1e-6, abs_tol=1e-9):
            raise ValueError("Fly speed readback mismatch.")
        return actual
```

(b) `M/runtime_authority.py`：`MUTATING_EVENTS` 集合最後加入 `"cameraViewRequest",`、`"flyNavigationRequest",`；`READONLY_EVENTS` 加入 `"cameraStateRequest",`；`_command_context` 的 `fields` 字典在 `"resetStage": ("scope",),` 之後加入：

```python
        "cameraViewRequest": ("action", "view", "scope", "projection"),
        "flyNavigationRequest": ("speed",),
```

(c) `M/stage_management.py`：

在 `runtime_authority` 的 try/except import 區塊之後加入：

```python
try:
    from .camera_view import CameraViewController, KitCameraApi, parse_camera_view_request
    from .fly_navigation import FlyNavigationController
except ImportError:  # pragma: no cover - test modules import this file directly.
    from camera_view import CameraViewController, KitCameraApi, parse_camera_view_request
    from fly_navigation import FlyNavigationController
```

`__init__` 中 `self._section_plane = None` 下一行加入：

```python
        self._camera_view = None
        self._fly_navigation = None
```

`outgoing` 清單在 `"measurementResult",` 之後加入：

```python
            "cameraViewResult",
            "cameraStateResult",
            "flyNavigationResult",
```

`incoming` 字典在 `'measurementRequest': self._on_measurement,` 之後加入：

```python
            'cameraViewRequest': self._on_camera_view,
            'cameraStateRequest': self._on_camera_state,
            'flyNavigationRequest': self._on_fly_navigation,
```

在 `_on_clip_plane` 方法之後加入：

```python
    def _camera_view_controller(self):
        if self._camera_view is None:
            self._camera_view = CameraViewController(KitCameraApi())
        return self._camera_view

    def _on_camera_view(self, event):
        request_payload = self._payload_dict(event.payload)
        if not self._authorize_mutator("cameraViewRequest", request_payload):
            return
        payload = {"result": "error", "error": "Camera view could not be applied."}
        try:
            command = parse_camera_view_request(request_payload)
            stage = omni.usd.get_context().get_stage()
            if not stage:
                raise ValueError("No stage.")
            controller = self._camera_view_controller()
            controller.sync_stage(stage)
            # A late first-frame framing task must not undo the user's explicit view.
            self._cancel_camera_setup()
            if command["action"] == "preset":
                if not stage.GetPrimAtPath("/World/Elements"):
                    raise ValueError("Camera presets need identity-authored IFC elements.")
                controller.orient(stage, command["view"])
                self._frame_ifc_model(stage, command["scope"])
            else:
                controller.set_projection(stage, command["projection"])
            payload = {"result": "success", "camera": controller.read_state(stage)}
        except Exception:
            carb.log_warn("Camera view request was not applied.")
        get_eventdispatcher().dispatch_event(
            "cameraViewResult", payload=correlated_result(request_payload, payload))

    def _on_camera_state(self, event):
        request_payload = self._payload_dict(event.payload)
        if self._verify_datachannel_trace("cameraStateRequest", request_payload) is None:
            return
        payload = {"result": "error", "error": "Camera state is unavailable."}
        try:
            stage = omni.usd.get_context().get_stage()
            if not stage:
                raise ValueError("No stage.")
            controller = self._camera_view_controller()
            controller.sync_stage(stage)
            payload = {"result": "success", "camera": controller.read_state(stage)}
        except Exception:
            carb.log_warn("Camera state request failed.")
        get_eventdispatcher().dispatch_event(
            "cameraStateResult", payload=correlated_result(request_payload, payload))

    def _on_fly_navigation(self, event):
        request_payload = self._payload_dict(event.payload)
        if not self._authorize_mutator("flyNavigationRequest", request_payload):
            return
        payload = {"result": "error", "error": "Fly speed could not be applied."}
        try:
            if self._fly_navigation is None:
                from carb import settings
                self._fly_navigation = FlyNavigationController(settings.get_settings())
            payload = {"result": "success", "speed": self._fly_navigation.apply(request_payload.get("speed"))}
        except Exception:
            carb.log_warn("Fly speed request was not applied.")
        get_eventdispatcher().dispatch_event(
            "flyNavigationResult", payload=correlated_result(request_payload, payload))
```

`_on_stage_closing` 中 `self._restore_section_plane()` 下一行加入：

```python
        if self._camera_view is not None:
            self._camera_view.sync_stage(None)
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location bim-streaming-server; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider; Pop-Location`
Expected: 新增測試全部通過。2026-09-17 未修改時的基準是 565 passed、8 skipped、7 failed；那 7 項都在 `test_stage_loading_stage_composition.py`（async 測試；pytest 顯示 `asyncio_mode` 設定無法辨識，屬既有環境問題）。實作後除了這 7 項，**不得出現新的失敗**。
注意：只挑部分檔案一起跑時，`test_client_send_bridge_single_path.py` 會因各檔的 Kit 模組替身互相影響而失敗（未修改時也一樣），以整個 `tests` 目錄的結果為準。

Run: `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider`
Expected: PASS（root contract 測試會掃描 Kit 發出的事件，新事件都已登記）。

Run: `Push-Location bim-streaming-server; .\repo.bat build; Pop-Location`
Expected: exit code 0。

- [ ] **Step 5：Commit**

```bash
git add bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/fly_navigation.py bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/runtime_authority.py bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_management.py bim-streaming-server/tests/test_fly_navigation.py bim-streaming-server/tests/test_runtime_command_authority.py bim-streaming-server/tests/test_stage_management_runtime_authority.py
git diff --cached --check
git commit -m "feat(kit): 接線相機視角、相機狀態與飛行速度指令" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 5：瀏覽器指令目錄與 message builder

**Files:**
- Modify: `web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts:12-24`
- Modify: `web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts:12-80`
- Modify: `web-viewer-sample/src/clients/streamMessages.ts`（檔案末尾）
- Test: `web-viewer-sample/src/viewer/core/runtimeCommandProtocol.test.ts`
- Test: `web-viewer-sample/src/viewer/core/runtimeEventCatalog.test.ts`
- Test: `web-viewer-sample/src/clients/cameraStreamMessages.test.ts`（新增）

**Interfaces:**
- Consumes: Task 1 線上格式。
- Produces:
  - `buildCameraViewRequest(input: CameraViewWire, requestId: string): StreamMessage`
  - `buildCameraStateRequest(requestId: string): StreamMessage`
  - `buildFlyNavigationRequest(speed: number, requestId: string): StreamMessage`
  - `type CameraViewWire = { action: "preset"; view: string; scope: string } | { action: "projection"; projection: string }`

- [ ] **Step 1：寫失敗測試**

(a) `runtimeCommandProtocol.test.ts` 內既有 `expect(isRuntimeMutator("clipPlaneRequest")).toBe(true);` 下一行加入：

```ts
        expect(isRuntimeMutator("cameraViewRequest")).toBe(true);
        expect(isRuntimeMutator("flyNavigationRequest")).toBe(true);
        expect(isRuntimeMutator("cameraStateRequest")).toBe(false);
```

(b) `runtimeEventCatalog.test.ts` 內既有 `expect(isSimpleRuntimeTerminalEvent("clipPlaneResult")).toBe(true);` 下一行加入：

```ts
        for (const request of ["cameraViewRequest", "cameraStateRequest", "flyNavigationRequest"]) {
            expect(isViewerToKitEventType(request)).toBe(true);
        }
        for (const result of ["cameraViewResult", "cameraStateResult", "flyNavigationResult"]) {
            expect(isKitToViewerEventType(result)).toBe(true);
        }
        expect(isRuntimeResponseForRequest("cameraViewResult", "cameraViewRequest")).toBe(true);
        expect(isRuntimeResponseForRequest("flyNavigationResult", "flyNavigationRequest")).toBe(true);
        expect(isRuntimeResponseForRequest("cameraViewResult", "clipPlaneRequest")).toBe(false);
        expect(isRuntimeResponseForRequest("cameraStateResult", "cameraStateRequest")).toBe(false);
        expect(isSimpleRuntimeTerminalEvent("cameraViewResult")).toBe(true);
        expect(isSimpleRuntimeTerminalEvent("flyNavigationResult")).toBe(true);
        expect(isSimpleRuntimeTerminalEvent("cameraStateResult")).toBe(false);
```

（`cameraStateRequest` 是唯讀指令，不進 runtime command tracker，所以不登記回報對應。）

(c) 建立 `web-viewer-sample/src/clients/cameraStreamMessages.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildCameraStateRequest, buildCameraViewRequest, buildFlyNavigationRequest } from "./streamMessages";

describe("camera stream message builders", () => {
    it("builds a preset request with only wire fields", () => {
        expect(buildCameraViewRequest({ action: "preset", view: "iso", scope: "all" }, "req-1")).toEqual({
            event_type: "cameraViewRequest",
            payload: { request_id: "req-1", action: "preset", view: "iso", scope: "all" },
        });
    });
    it("builds a projection request", () => {
        expect(buildCameraViewRequest({ action: "projection", projection: "orthographic" }, "req-2")).toEqual({
            event_type: "cameraViewRequest",
            payload: { request_id: "req-2", action: "projection", projection: "orthographic" },
        });
    });
    it("builds read-only camera state and fly speed requests", () => {
        expect(buildCameraStateRequest("req-3")).toEqual({ event_type: "cameraStateRequest", payload: { request_id: "req-3" } });
        expect(buildFlyNavigationRequest(2.5, "req-4")).toEqual({
            event_type: "flyNavigationRequest",
            payload: { request_id: "req-4", speed: 2.5 },
        });
    });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location web-viewer-sample; npx vitest run src/viewer/core/runtimeCommandProtocol.test.ts src/viewer/core/runtimeEventCatalog.test.ts src/clients/cameraStreamMessages.test.ts; Pop-Location`
Expected: FAIL（新斷言為 false；`buildCameraViewRequest` 不存在）。

- [ ] **Step 3：實作**

(a) `runtimeCommandProtocol.ts` 的 `runtimeMutatingEvents` 在 `"resetStage",` 之後加入 `"cameraViewRequest",`、`"flyNavigationRequest",`。

(b) `runtimeEventCatalog.ts`：
- `viewerToKitEventTypes` 在 `"getChildrenRequest",` 之後加入 `"cameraViewRequest",`、`"cameraStateRequest",`、`"flyNavigationRequest",`
- `kitToViewerEventTypes` 在 `"commandRejected",` 之後加入 `"cameraViewResult",`、`"cameraStateResult",`、`"flyNavigationResult",`
- `runtimeResponseRequestTypes` 在 `["cameraFrameResult", new Set(["resetStage"])],` 之後加入：

```ts
    ["cameraViewResult", new Set(["cameraViewRequest"])],
    ["flyNavigationResult", new Set(["flyNavigationRequest"])],
```

- `simpleRuntimeTerminalEvents` 在 `"cameraFrameResult",` 之後加入 `"cameraViewResult",`、`"flyNavigationResult",`

(c) `streamMessages.ts` 末尾加入：

```ts
export type CameraViewWire =
    | { action: "preset"; view: string; scope: string }
    | { action: "projection"; projection: string };

export function buildCameraViewRequest(input: CameraViewWire, requestId: string): StreamMessage {
    const fields = input.action === "preset"
        ? { action: input.action, view: input.view, scope: input.scope }
        : { action: input.action, projection: input.projection };
    return { event_type: "cameraViewRequest", payload: { request_id: requestId, ...fields } };
}

export function buildCameraStateRequest(requestId: string): StreamMessage {
    return { event_type: "cameraStateRequest", payload: { request_id: requestId } };
}

export function buildFlyNavigationRequest(speed: number, requestId: string): StreamMessage {
    return { event_type: "flyNavigationRequest", payload: { request_id: requestId, speed } };
}
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location web-viewer-sample; npx vitest run src/viewer/core src/clients/cameraStreamMessages.test.ts; npm run typecheck; Pop-Location`
Expected: PASS；typecheck exit code 0。

- [ ] **Step 5：Commit**

```bash
git add web-viewer-sample/src/viewer/core/runtimeCommandProtocol.ts web-viewer-sample/src/viewer/core/runtimeCommandProtocol.test.ts web-viewer-sample/src/viewer/core/runtimeEventCatalog.ts web-viewer-sample/src/viewer/core/runtimeEventCatalog.test.ts web-viewer-sample/src/clients/streamMessages.ts web-viewer-sample/src/clients/cameraStreamMessages.test.ts
git diff --cached --check
git commit -m "feat(viewer): 登記相機與飛行指令並新增 message builder" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 6：相機指令交換物件（`cameraViewBridge.ts`）

**Files:**
- Create: `web-viewer-sample/src/console/cameraViewBridge.ts`
- Test: `web-viewer-sample/src/console/cameraViewBridge.test.ts`

**Interfaces:**
- Produces（Task 7–9 使用）：

```ts
export type CameraPreset = "top" | "front" | "back" | "left" | "right" | "iso";
export type CameraProjection = "perspective" | "orthographic";
export type CameraScope = "building" | "all";
export type CameraViewInput =
  | { action: "preset"; view: CameraPreset; scope: CameraScope }
  | { action: "projection"; projection: CameraProjection };
export type Vec3 = [number, number, number];
export interface CameraState { projection: CameraProjection; position: Vec3; direction: Vec3; up: Vec3;
  targetDistance: number; fovDeg: number | null; orthoHeight: number | null }
export type CommandReason = "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback";
export interface CameraReply { status: "applied" | "unconfirmed" | "error"; clientRequestId?: string;
  requestId?: string; reason?: CommandReason; camera?: CameraState }
export interface FlyReply { status: "applied" | "unconfirmed" | "error"; clientRequestId?: string;
  requestId?: string; reason?: CommandReason; speed?: number }
export type CameraViewState = { status: "idle" | "pending" } | CameraReply;
export type FlyState = { status: "idle" | "pending" } | FlyReply;
export const PRESET_FORWARD: Record<CameraPreset, Vec3>;
export const FLY_SPEED_MIN = 0.01; export const FLY_SPEED_MAX = 1000;
export function parseCameraViewInput(value: unknown): CameraViewInput | null;
export function parseCameraState(value: unknown): CameraState | null;          // 接受線上 snake_case
export function parseClientCameraState(value: unknown): CameraState | null;    // 接受父視窗 camelCase
export function cameraViewReadback(input: CameraViewInput, payload: Record<string, unknown>): CameraState | null;
export function cameraStateReadback(_input: null, payload: Record<string, unknown>): CameraState | null;
export function parseFlySpeed(value: unknown): number | null;
export function flyReadback(speed: number, payload: Record<string, unknown>): number | null;
export function parseCameraReply(value: unknown): CameraReply | null;
export function parseFlyReply(value: unknown): FlyReply | null;
export interface ExchangeReply<V> { status: "applied" | "unconfirmed" | "error"; clientRequestId?: string;
  requestId?: string; reason?: CommandReason; value?: V }
export class CorrelatedRuntimeExchange<I, V> { start(value: unknown, clientRequestId: string): void;
  receive(payload: Record<string, unknown>): boolean; fail(requestId: string, reason: "transport" | "rejected"): void;
  sync(): void; dispose(): void }
export class PendingReply<R extends { clientRequestId?: string }> { readonly busy: boolean;
  start(id: string, post: () => void, transportReply: R): Promise<R>; settle(reply: R): boolean; cancel(): void }
```

- [ ] **Step 1：寫失敗測試**

建立 `web-viewer-sample/src/console/cameraViewBridge.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CorrelatedRuntimeExchange, PendingReply, cameraStateReadback, cameraViewReadback, flyReadback,
  parseCameraReply, parseCameraState, parseCameraViewInput, parseClientCameraState, parseFlyReply, parseFlySpeed,
  type CameraReply, type ExchangeReply,
} from "./cameraViewBridge";

const wireCamera = { projection: "perspective", position: [0, -10, 2], direction: [0, 1, 0], up: [0, 0, 1],
  target_distance: 10, fov_deg: 45, ortho_height: null };
const clientCamera = { projection: "perspective", position: [0, -10, 2], direction: [0, 1, 0], up: [0, 0, 1],
  targetDistance: 10, fovDeg: 45, orthoHeight: null };
afterEach(() => { vi.useRealTimers(); });

describe("camera input and state parsing", () => {
  it.each([
    [{ action: "preset", view: "iso", scope: "all" }],
    [{ action: "projection", projection: "orthographic" }],
  ])("accepts %j", value => { expect(parseCameraViewInput(value)).toEqual(value); });
  it.each([
    [{ action: "preset", view: "bottom", scope: "all" }],
    [{ action: "preset", view: "top" }],
    [{ action: "preset", view: "top", scope: "all", projection: "perspective" }],
    [{ action: "projection", projection: "fisheye" }],
    [{ action: "apply_state" }],
    [null], ["top"],
  ])("rejects %j", value => { expect(parseCameraViewInput(value)).toBeNull(); });
  it("converts wire camera to client camera and rejects open or non-finite shapes", () => {
    expect(parseCameraState(wireCamera)).toEqual(clientCamera);
    expect(parseCameraState({ ...wireCamera, extra: 1 })).toBeNull();
    expect(parseCameraState({ ...wireCamera, position: [0, Number.NaN, 0] })).toBeNull();
    expect(parseCameraState({ ...wireCamera, fov_deg: null })).toBeNull();
    expect(parseCameraState({ ...wireCamera, projection: "orthographic", fov_deg: null, ortho_height: 5 }))
      .toMatchObject({ projection: "orthographic", fovDeg: null, orthoHeight: 5 });
    expect(parseClientCameraState(clientCamera)).toEqual(clientCamera);
    expect(parseClientCameraState(wireCamera)).toBeNull();
  });
  it("accepts only bounded fly speeds", () => {
    expect(parseFlySpeed(2.5)).toBe(2.5);
    for (const bad of [0, 0.001, 1000.5, Number.NaN, "2", null]) expect(parseFlySpeed(bad)).toBeNull();
  });
});

describe("Kit readback matching", () => {
  it("confirms a preset only when the camera looks along the preset forward", () => {
    const input = { action: "preset", view: "front", scope: "building" } as const;
    expect(cameraViewReadback(input, { result: "success", camera: wireCamera })).toEqual(clientCamera);
    expect(cameraViewReadback(input, { result: "success", camera: { ...wireCamera, direction: [0, 0, -1] } })).toBeNull();
    expect(cameraViewReadback(input, { result: "error", error: "x" })).toBeNull();
  });
  it("confirms a projection only when Kit reports it", () => {
    const input = { action: "projection", projection: "orthographic" } as const;
    const ortho = { ...wireCamera, projection: "orthographic", fov_deg: null, ortho_height: 12 };
    expect(cameraViewReadback(input, { result: "success", camera: ortho })).toMatchObject({ projection: "orthographic" });
    expect(cameraViewReadback(input, { result: "success", camera: wireCamera })).toBeNull();
  });
  it("reads camera state and fly speed", () => {
    expect(cameraStateReadback(null, { result: "success", camera: wireCamera })).toEqual(clientCamera);
    expect(flyReadback(2, { result: "success", speed: 2 })).toBe(2);
    expect(flyReadback(2, { result: "success", speed: 0 })).toBeNull();
    expect(flyReadback(2, { result: "error" })).toBeNull();
  });
});

describe("reply parsing for the parent window", () => {
  it("requires correlation ids for applied replies and validates payloads", () => {
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: clientCamera }))
      .toEqual({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: clientCamera });
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", camera: clientCamera })).toBeNull();
    expect(parseCameraReply({ status: "applied", clientRequestId: "c1", requestId: "r1" })).toBeNull();
    expect(parseCameraReply({ status: "error", reason: "busy", clientRequestId: "c1" })).toEqual({
      status: "error", reason: "busy", clientRequestId: "c1" });
    expect(parseCameraReply({ status: "error", reason: "secret" })).toBeNull();
    expect(parseCameraReply({ status: "unconfirmed" })).toEqual({ status: "unconfirmed" });
    expect(parseFlyReply({ status: "applied", clientRequestId: "c1", requestId: "r1", speed: 3 }))
      .toEqual({ status: "applied", clientRequestId: "c1", requestId: "r1", speed: 3 });
    expect(parseFlyReply({ status: "applied", clientRequestId: "c1", requestId: "r1" })).toBeNull();
  });
});

function harness(snapshot: { value: string | null }) {
  const sent: Array<{ input: number; requestId: string }> = [];
  const replies: Array<ExchangeReply<number>> = [];
  const completed: Array<[string, string]> = [];
  let next = 0;
  const exchange = new CorrelatedRuntimeExchange<number, number>({
    parse: value => (typeof value === "number" ? value : null),
    readback: (input, payload) => (payload.value === input ? input : null),
    snapshot: () => snapshot.value,
    requestId: () => `req-${++next}`,
    send: (input, requestId) => { sent.push({ input, requestId }); return true; },
    complete: (requestId, outcome) => { completed.push([requestId, outcome]); },
    notify: reply => { replies.push(reply); },
  });
  return { exchange, sent, replies, completed };
}

describe("CorrelatedRuntimeExchange", () => {
  it("applies only a matching readback and ignores other request ids", () => {
    const h = harness({ value: "s1" });
    h.exchange.start(4, "c1");
    expect(h.sent).toEqual([{ input: 4, requestId: "req-1" }]);
    expect(h.exchange.receive({ request_id: "other", value: 4 })).toBe(false);
    expect(h.exchange.receive({ request_id: "req-1", value: 4 })).toBe(true);
    expect(h.replies).toEqual([{ status: "applied", value: 4, clientRequestId: "c1", requestId: "req-1" }]);
    expect(h.completed).toEqual([["req-1", "success"]]);
  });
  it("reports readback mismatch, busy, invalid and unavailable", () => {
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(4, "c1");
    h.exchange.start(5, "c2");
    h.exchange.receive({ request_id: "req-1", value: 3 });
    h.exchange.start("x", "c3");
    snapshot.value = null;
    h.exchange.start(6, "c4");
    expect(h.replies.map(reply => [reply.clientRequestId, reply.reason])).toEqual([
      ["c2", "busy"], ["c1", "readback"], ["c3", "invalid"], ["c4", "unavailable"]]);
  });
  it("times out after 10 seconds and supersedes on snapshot change", () => {
    vi.useFakeTimers();
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(1, "c1");
    vi.advanceTimersByTime(10_000);
    expect(h.replies[0]).toMatchObject({ status: "error", reason: "timeout" });
    h.exchange.start(2, "c2");
    snapshot.value = "s2";
    h.exchange.sync();
    expect(h.replies[1]).toMatchObject({ status: "unconfirmed", clientRequestId: "c2" });
    expect(h.completed[h.completed.length - 1]).toEqual(["req-2", "superseded"]);
  });
  it("marks a confirmed value unconfirmed once the snapshot changes", () => {
    const snapshot = { value: "s1" as string | null };
    const h = harness(snapshot);
    h.exchange.start(1, "c1");
    h.exchange.receive({ request_id: "req-1", value: 1 });
    snapshot.value = "s2";
    h.exchange.sync();
    expect(h.replies[h.replies.length - 1]).toEqual({ status: "unconfirmed" });
  });
  it("maps transport and rejection failures", () => {
    const h = harness({ value: "s1" });
    h.exchange.start(1, "c1");
    h.exchange.fail("req-1", "rejected");
    h.exchange.start(2, "c2");
    h.exchange.fail("req-2", "transport");
    expect(h.replies.map(reply => reply.reason)).toEqual(["rejected", "transport"]);
  });
});

describe("PendingReply", () => {
  const timeout: CameraReply = { status: "error", reason: "timeout" };
  const cancel: CameraReply = { status: "unconfirmed" };
  it("settles only the matching client request and cancels as unconfirmed", async () => {
    const pending = new PendingReply<CameraReply>(timeout, cancel, 11_000);
    const first = pending.start("c1", () => undefined, { status: "error", reason: "transport" });
    expect(pending.busy).toBe(true);
    expect(pending.settle({ status: "applied", clientRequestId: "other" })).toBe(false);
    expect(pending.settle({ status: "applied", clientRequestId: "c1", requestId: "r1", camera: parseClientCameraState(clientCamera)! })).toBe(true);
    await expect(first).resolves.toMatchObject({ status: "applied" });
    const second = pending.start("c2", () => undefined, { status: "error", reason: "transport" });
    pending.cancel();
    await expect(second).resolves.toEqual(cancel);
    expect(pending.busy).toBe(false);
  });
  it("resolves timeout and transport failures", async () => {
    vi.useFakeTimers();
    const pending = new PendingReply<CameraReply>(timeout, cancel, 11_000);
    const late = pending.start("c1", () => undefined, { status: "error", reason: "transport" });
    vi.advanceTimersByTime(11_000);
    await expect(late).resolves.toEqual(timeout);
    const broken = pending.start("c2", () => { throw new Error("private"); }, { status: "error", reason: "transport" });
    await expect(broken).resolves.toEqual({ status: "error", reason: "transport" });
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/cameraViewBridge.test.ts; Pop-Location`
Expected: FAIL，`Failed to resolve import "./cameraViewBridge"`。

- [ ] **Step 3：實作**

建立 `web-viewer-sample/src/console/cameraViewBridge.ts`：

```ts
export type CameraPreset = "top" | "front" | "back" | "left" | "right" | "iso";
export type CameraProjection = "perspective" | "orthographic";
export type CameraScope = "building" | "all";
export type CameraViewInput =
  | { action: "preset"; view: CameraPreset; scope: CameraScope }
  | { action: "projection"; projection: CameraProjection };
export type Vec3 = [number, number, number];
export interface CameraState {
  projection: CameraProjection; position: Vec3; direction: Vec3; up: Vec3;
  targetDistance: number; fovDeg: number | null; orthoHeight: number | null;
}
export type CommandReason = "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback";
type ReplyStatus = "applied" | "unconfirmed" | "error";
export interface CameraReply { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; camera?: CameraState }
export interface FlyReply { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; speed?: number }
export type CameraViewState = { status: "idle" | "pending" } | CameraReply;
export type FlyState = { status: "idle" | "pending" } | FlyReply;
export interface ExchangeReply<V> { status: ReplyStatus; clientRequestId?: string; requestId?: string; reason?: CommandReason; value?: V }

const S = 1 / Math.sqrt(3);
// Camera forward (where the camera looks) per preset, in model axes with Z up. Mirrors Kit camera_view.py.
export const PRESET_FORWARD: Record<CameraPreset, Vec3> = {
  top: [0, 0, -1], front: [0, 1, 0], back: [0, -1, 0], left: [1, 0, 0], right: [-1, 0, 0], iso: [-S, S, -S],
};
export const FLY_SPEED_MIN = 0.01;
export const FLY_SPEED_MAX = 1000;
const PRESETS = Object.keys(PRESET_FORWARD) as CameraPreset[];
const PROJECTIONS: CameraProjection[] = ["perspective", "orthographic"];
const SCOPES: CameraScope[] = ["building", "all"];
const REASONS: CommandReason[] = ["invalid", "busy", "unavailable", "rejected", "transport", "timeout", "readback"];
const MAX_ABS = 1e9;
const COS_HALF_DEGREE = Math.cos(Math.PI / 360);

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_ABS;
const vec3 = (value: unknown): Vec3 | null =>
  Array.isArray(value) && value.length === 3 && value.every(finite) ? [value[0], value[1], value[2]] : null;
const correlationId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export function parseCameraViewInput(value: unknown): CameraViewInput | null {
  if (!record(value)) return null;
  if (value.action === "preset" && onlyKeys(value, ["action", "view", "scope"])
    && PRESETS.includes(value.view as CameraPreset) && SCOPES.includes(value.scope as CameraScope)) {
    return { action: "preset", view: value.view as CameraPreset, scope: value.scope as CameraScope };
  }
  if (value.action === "projection" && onlyKeys(value, ["action", "projection"])
    && PROJECTIONS.includes(value.projection as CameraProjection)) {
    return { action: "projection", projection: value.projection as CameraProjection };
  }
  return null;
}

function buildCameraState(projection: unknown, position: unknown, direction: unknown, up: unknown,
  distance: unknown, fov: unknown, ortho: unknown): CameraState | null {
  const p = vec3(position), d = vec3(direction), u = vec3(up);
  if (!PROJECTIONS.includes(projection as CameraProjection) || !p || !d || !u || !finite(distance) || distance <= 0) return null;
  const perspective = projection === "perspective";
  if (perspective ? !(finite(fov) && fov > 0 && fov < 180) || ortho !== null
    : fov !== null || !(finite(ortho) && ortho > 0)) return null;
  return { projection: projection as CameraProjection, position: p, direction: d, up: u, targetDistance: distance,
    fovDeg: perspective ? fov as number : null, orthoHeight: perspective ? null : ortho as number };
}

export function parseCameraState(value: unknown): CameraState | null {
  if (!record(value) || !onlyKeys(value, ["projection", "position", "direction", "up", "target_distance", "fov_deg", "ortho_height"])) return null;
  return buildCameraState(value.projection, value.position, value.direction, value.up, value.target_distance, value.fov_deg, value.ortho_height);
}

export function parseClientCameraState(value: unknown): CameraState | null {
  if (!record(value) || !onlyKeys(value, ["projection", "position", "direction", "up", "targetDistance", "fovDeg", "orthoHeight"])) return null;
  return buildCameraState(value.projection, value.position, value.direction, value.up, value.targetDistance, value.fovDeg, value.orthoHeight);
}

function successCamera(payload: Record<string, unknown>): CameraState | null {
  return payload.result === "success" ? parseCameraState(payload.camera) : null;
}

function alignedWith(direction: Vec3, forward: Vec3): boolean {
  const length = Math.hypot(...direction);
  if (!(length > 0)) return false;
  const dot = (direction[0] * forward[0] + direction[1] * forward[1] + direction[2] * forward[2]) / length;
  return dot >= COS_HALF_DEGREE;
}

export function cameraViewReadback(input: CameraViewInput, payload: Record<string, unknown>): CameraState | null {
  const camera = successCamera(payload);
  if (!camera) return null;
  if (input.action === "preset") return alignedWith(camera.direction, PRESET_FORWARD[input.view]) ? camera : null;
  return camera.projection === input.projection ? camera : null;
}

export function cameraStateReadback(_input: null, payload: Record<string, unknown>): CameraState | null {
  return successCamera(payload);
}

export function parseFlySpeed(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= FLY_SPEED_MIN && value <= FLY_SPEED_MAX ? value : null;
}

export function flyReadback(_speed: number, payload: Record<string, unknown>): number | null {
  // Kit may clamp to its own speed limits; the reported value is the truth shown to users.
  return payload.result === "success" ? parseFlySpeed(payload.speed) : null;
}

function parseReplyBase(value: unknown): (Omit<ExchangeReply<never>, "value"> & { raw: Record<string, unknown> }) | null {
  if (!record(value) || !["applied", "unconfirmed", "error"].includes(value.status as string)) return null;
  if (value.clientRequestId !== undefined && !correlationId(value.clientRequestId)) return null;
  if (value.requestId !== undefined && !correlationId(value.requestId)) return null;
  if (value.status === "applied" && (!value.clientRequestId || !value.requestId)) return null;
  if (value.reason !== undefined && !REASONS.includes(value.reason as CommandReason)) return null;
  return { raw: value, status: value.status as ReplyStatus,
    ...(value.clientRequestId ? { clientRequestId: value.clientRequestId as string } : {}),
    ...(value.requestId ? { requestId: value.requestId as string } : {}),
    ...(value.reason ? { reason: value.reason as CommandReason } : {}) };
}

export function parseCameraReply(value: unknown): CameraReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const camera = raw.camera === undefined ? undefined : parseClientCameraState(raw.camera);
  if (camera === null || (reply.status === "applied" && !camera)) return null;
  return { ...reply, ...(camera ? { camera } : {}) };
}

export function parseFlyReply(value: unknown): FlyReply | null {
  const base = parseReplyBase(value);
  if (!base) return null;
  const { raw, ...reply } = base;
  const speed = raw.speed === undefined ? undefined : parseFlySpeed(raw.speed);
  if (speed === null || (reply.status === "applied" && speed === undefined)) return null;
  return { ...reply, ...(speed !== undefined ? { speed } : {}) };
}

/** One bounded runtime request with Kit readback. Authority and terminal ownership remain with Window. */
export class CorrelatedRuntimeExchange<I, V> {
  private pending: { input: I; clientRequestId: string; requestId: string; snapshot: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private confirmedSnapshot: string | null = null;
  constructor(private readonly host: {
    parse(value: unknown): I | null;
    readback(input: I, payload: Record<string, unknown>): V | null;
    snapshot(): string | null;
    requestId(): string;
    send(input: I, requestId: string): boolean;
    complete(requestId: string, outcome: "success" | "error" | "timed-out" | "superseded"): void;
    notify(reply: ExchangeReply<V>): void;
  }, private readonly timeoutMs = 10_000) {}
  start(value: unknown, clientRequestId: string): void {
    if (!correlationId(clientRequestId)) return;
    this.sync();
    if (this.pending) { this.host.notify({ status: "error", reason: "busy", clientRequestId }); return; }
    const input = this.host.parse(value), snapshot = this.host.snapshot();
    if (input === null || snapshot === null) {
      this.host.notify({ status: "error", reason: input === null ? "invalid" : "unavailable", clientRequestId }); return;
    }
    const requestId = this.host.requestId();
    this.pending = { input, snapshot, requestId, clientRequestId };
    this.timer = setTimeout(() => this.finish({ status: "error", reason: "timeout" }, "timed-out"), this.timeoutMs);
    try {
      if (!this.host.send(input, requestId)) this.finish({ status: "error", reason: "unavailable" }, "error");
    } catch {
      this.finish({ status: "error", reason: "transport" }, "error");
    }
  }
  receive(payload: Record<string, unknown>): boolean {
    const pending = this.pending;
    if (!pending || payload.request_id !== pending.requestId) return false;
    const value = this.host.readback(pending.input, payload);
    this.finish(value === null ? { status: "error", reason: "readback" } : { status: "applied", value },
      value === null ? "error" : "success");
    return true;
  }
  fail(requestId: string, reason: "transport" | "rejected"): void {
    if (this.pending?.requestId === requestId) this.finish({ status: "error", reason }, "error");
  }
  sync(): void {
    const snapshot = this.host.snapshot();
    if (this.pending && snapshot !== this.pending.snapshot) this.finish({ status: "unconfirmed" }, "superseded");
    if (this.confirmedSnapshot !== null && snapshot !== this.confirmedSnapshot) {
      this.confirmedSnapshot = null;
      this.host.notify({ status: "unconfirmed" });
    }
  }
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.pending = null; this.confirmedSnapshot = null;
  }
  private finish(reply: ExchangeReply<V>, outcome: "success" | "error" | "timed-out" | "superseded"): void {
    const pending = this.pending;
    if (!pending) return;
    const stale = this.host.snapshot() !== pending.snapshot;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.pending = null;
    this.confirmedSnapshot = !stale && reply.status === "applied" ? pending.snapshot : null;
    this.host.complete(pending.requestId, stale ? "superseded" : outcome);
    this.host.notify({ ...(stale ? { status: "unconfirmed" as const } : reply),
      clientRequestId: pending.clientRequestId, requestId: pending.requestId });
  }
}

/** Parent-window side: one outstanding request per command family. */
export class PendingReply<R extends { clientRequestId?: string }> {
  private current: { id: string; resolve: (reply: R) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(private readonly timeoutReply: R, private readonly cancelReply: R, private readonly timeoutMs = 11_000) {}
  get busy(): boolean { return this.current !== null; }
  start(id: string, post: () => void, transportReply: R): Promise<R> {
    return new Promise<R>(resolve => {
      const timer = setTimeout(() => {
        if (this.current?.id !== id) return;
        this.current = null; resolve(this.timeoutReply);
      }, this.timeoutMs);
      this.current = { id, resolve, timer };
      try { post(); } catch {
        clearTimeout(timer); this.current = null; resolve(transportReply);
      }
    });
  }
  settle(reply: R): boolean {
    const current = this.current;
    if (!current || reply.clientRequestId !== current.id) return false;
    this.current = null; clearTimeout(current.timer); current.resolve(reply);
    return true;
  }
  cancel(): void {
    const current = this.current;
    this.current = null;
    if (current) { clearTimeout(current.timer); current.resolve(this.cancelReply); }
  }
}
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/cameraViewBridge.test.ts; npm run typecheck; Pop-Location`
Expected: PASS；typecheck exit code 0。

- [ ] **Step 5：Commit**

```bash
git add web-viewer-sample/src/console/cameraViewBridge.ts web-viewer-sample/src/console/cameraViewBridge.test.ts
git diff --cached --check
git commit -m "feat(viewer): 新增相機與飛行指令的交換物件與回報比對" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 7：iframe 端接線（`Window.tsx`）

**Files:**
- Modify: `web-viewer-sample/src/Window.tsx`（import 區約第 15–17 行、`sectionExchange` 定義之後約第 882 行、`_onPageHide` 約第 815 行、`componentDidUpdate` 約第 897 行、`componentWillUnmount` 約第 912 行、`_runtimeMutatorBlockReason` 約第 1441 行、`_sendStreamMessage` 的 catch 約第 1674 行、`_handleParentMessage` 的訊息型別約第 2505 行與 `case "toolbar_action"` 之前、`commandRejected` 處理約第 4697 行、`clipPlaneResult` 路由約第 4765 行，以及檔案內其他呼叫 `this.sectionExchange.sync();` 的位置）
- Test: `web-viewer-sample/src/console/cameraViewWindow.dom.test.tsx`（新增）

**Interfaces:**
- Consumes: Task 5 的 builder；Task 6 的 `CorrelatedRuntimeExchange`、`parseCameraViewInput`、`cameraViewReadback`、`cameraStateReadback`、`parseFlySpeed`、`flyReadback`。
- Produces（父視窗 postMessage，全部帶 `protocol: "vg01"`）：
  - 收：`{type:"camera_view", camera: CameraViewInput, clientRequestId}`、`{type:"camera_state", clientRequestId}`、`{type:"fly_navigation", speed, clientRequestId}`
  - 送：`{type:"camera_view_result"|"camera_state_result", status, clientRequestId?, requestId?, reason?, camera?: CameraState}`、`{type:"fly_navigation_result", status, clientRequestId?, requestId?, reason?, speed?}`
  - 狀態快照改變時，已確認的結果會送出不帶 `clientRequestId` 的 `status:"unconfirmed"`。

1a 只讓 primary 使用：三種訊息都沿用剖切的 `canOperate` 與快照條件，所以 spectator 目前也不能讀取相機。Kit 端的 `cameraStateRequest` 本身是唯讀，1d 小地圖需要時再開放 spectator 讀取。

- [ ] **Step 1：寫失敗測試**

建立 `web-viewer-sample/src/console/cameraViewWindow.dom.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../Window";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import { resetTestCredentials, testCredentials, withTestCredentials } from "./__testdata__/viewerCredentials";
import type { BorrowedViewerCredentials } from "../clients/viewerCredentials";
import type { RuntimeCommandTracker } from "../viewer/core/runtimeCommandTracker";

const ORIGIN = "http://127.0.0.1:8004", TRACE = "ifcready_camera_test", SESSION = "review_session_camera";
interface Disposable { dispose(): void }
interface Target {
  state: Record<string, unknown>;
  componentMounted: boolean; reviewSocketEpoch: number; stageIntentGeneration: number;
  verifiedDataChannelAuthority: unknown;
  _handleParentMessage(event: MessageEvent): void;
  _handleCustomEvent(event: { event_type: string; payload: object }, generation?: number): void;
  _hasRemoteVideoFrame(): boolean;
  cameraViewExchange: Disposable; cameraStateExchange: Disposable; flyNavigationExchange: Disposable;
  runtimeCommandTracker: RuntimeCommandTracker;
  componentDidUpdate(): void;
}
let target: Target;
let credentials: BorrowedViewerCredentials;
let parent: { postMessage: ReturnType<typeof vi.fn> };
const savedEnv = { ...reviewEnv };
const originalParent = window.parent, originalReferrer = document.referrer;
const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  target_distance: 30, fov_deg: 40, ortho_height: null };

beforeEach(() => {
  vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", ORIGIN);
  window.history.replaceState({}, "", `/?session=${SESSION}&trace_id=${TRACE}`);
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  Object.defineProperty(document, "referrer", { value: ORIGIN + "/ui", configurable: true });
  testCredentials.leaseToken = "test-only-lease"; reviewEnv.sourceClientId = "test-only-primary";
  const props = withTestCredentials({}); credentials = props.viewerCredentials!;
  const app = new App(props as never); target = app as unknown as Target;
  target.componentMounted = true;
  target.verifiedDataChannelAuthority = { sessionId: SESSION, traceId: TRACE, connectionGeneration: target.reviewSocketEpoch };
  target.state = { ...target.state, viewerTab: "issues", reviewSessionId: SESSION, reviewLifecycleStatus: "active",
    stageLoadStatus: "matched", latestStreamConfig: { session_id: SESSION, trace_id: TRACE } };
  vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(true);
  vi.spyOn(app, "setState").mockImplementation((update: unknown) => {
    const patch = typeof update === "function" ? update(target.state) : update;
    if (patch && typeof patch === "object") target.state = { ...target.state, ...patch };
  });
  vi.spyOn(AppStream, "sendMessage").mockResolvedValue(undefined as never);
});
afterEach(() => {
  target.cameraViewExchange.dispose(); target.cameraStateExchange.dispose(); target.flyNavigationExchange.dispose();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  Object.assign(reviewEnv, savedEnv);
  resetTestCredentials();
  Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
  Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
});

function fromParent(data: Record<string, unknown>, origin = ORIGIN) {
  target._handleParentMessage(new MessageEvent("message", { origin, source: parent as unknown as Window,
    data: { protocol: "vg01", ...data } }));
}
function sendCamera(cameraInput: unknown = { action: "preset", view: "top", scope: "building" }, origin = ORIGIN) {
  fromParent({ type: "camera_view", camera: cameraInput, clientRequestId: "cam_1" }, origin);
}
function sent(index = 0) {
  return vi.mocked(AppStream.sendMessage).mock.calls[index][0] as unknown as { event_type: string; payload: Record<string, unknown> };
}
function kit(eventType: string, payload: Record<string, unknown>) {
  target._handleCustomEvent({ event_type: eventType, payload: { trace_id: TRACE, ...payload } });
}

describe("camera commands from the unified workspace to Kit", () => {
  it("sends a traced primary preset and confirms only the matching Kit readback", () => {
    sendCamera();
    expect(sent()).toMatchObject({ event_type: "cameraViewRequest", payload: {
      trace_id: TRACE, viewer_lease_token: "test-only-lease", role: "primary", action: "preset", view: "top", scope: "building" } });
    kit("cameraViewResult", { request_id: "unknown", result: "success", camera });
    expect(parent.postMessage).not.toHaveBeenCalled();
    const requestId = sent().payload.request_id as string;
    kit("cameraViewResult", { request_id: requestId, result: "success", camera });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "applied", clientRequestId: "cam_1", camera: expect.objectContaining({ targetDistance: 30 }) }), ORIGIN);
    expect(target.runtimeCommandTracker.getTerminal(requestId)?.outcome).toBe("success");
  });
  it("reports a readback mismatch when Kit looks the wrong way", () => {
    sendCamera();
    kit("cameraViewResult", { request_id: sent().payload.request_id, result: "success", camera: { ...camera, direction: [0, 1, 0] } });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "readback" }), ORIGIN);
  });
  it.each(["origin", "lease", "closed"] as const)("does not send through invalid %s", kind => {
    if (kind === "lease") credentials.accept({ leaseToken: "" });
    if (kind === "closed") target.state.reviewLifecycleStatus = "closed";
    sendCamera(undefined, kind === "origin" ? "https://evil.test" : ORIGIN);
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
  });
  it("refuses injected fields without sending", () => {
    sendCamera({ action: "preset", view: "top", scope: "building", viewer_lease_token: "injected" });
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "invalid" }), ORIGIN);
  });
  it("maps a Kit rejection to the camera UI", () => {
    sendCamera();
    kit("commandRejected", { request_id: sent().payload.request_id, rejected_event_type: "cameraViewRequest",
      reason: "spectator_readonly", runtime_state: "unchanged", retryable: false });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "rejected" }), ORIGIN);
  });
  it("maps a transport failure without exposing private text", async () => {
    vi.mocked(AppStream.sendMessage).mockRejectedValue(new Error("private-token-diagnostic"));
    sendCamera();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "transport" }), ORIGIN);
    expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("private-token");
  });
  it("reads camera state without mutator authority fields", () => {
    fromParent({ type: "camera_state", clientRequestId: "state_1" });
    expect(sent().event_type).toBe("cameraStateRequest");
    expect(sent().payload).toMatchObject({ trace_id: TRACE, session_id: SESSION });
    expect(sent().payload).not.toHaveProperty("viewer_lease_token");
    kit("cameraStateResult", { request_id: sent().payload.request_id, result: "success", camera });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_state_result",
      status: "applied", clientRequestId: "state_1" }), ORIGIN);
  });
  it("applies fly speed from Kit readback", () => {
    fromParent({ type: "fly_navigation", speed: 3, clientRequestId: "fly_1" });
    expect(sent()).toMatchObject({ event_type: "flyNavigationRequest", payload: { speed: 3, role: "primary" } });
    kit("flyNavigationResult", { request_id: sent().payload.request_id, result: "success", speed: 2 });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "fly_navigation_result",
      status: "applied", speed: 2, clientRequestId: "fly_1" }), ORIGIN);
  });
  it("invalidates a confirmed camera when the stage changes", () => {
    sendCamera();
    kit("cameraViewResult", { request_id: sent().payload.request_id, result: "success", camera });
    target.state.stageLoadStatus = "pending"; target.componentDidUpdate();
    expect(parent.postMessage).toHaveBeenLastCalledWith({ protocol: "vg01", type: "camera_view_result",
      status: "unconfirmed" }, ORIGIN);
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/cameraViewWindow.dom.test.tsx; Pop-Location`
Expected: FAIL（`target.cameraViewExchange` 為 undefined、沒有送出 `cameraViewRequest`）。

- [ ] **Step 3：實作**

(a) import：把 `import { buildClipPlaneRequest } from "./clients/streamMessages";` 改成

```ts
import { buildCameraStateRequest, buildCameraViewRequest, buildClipPlaneRequest, buildFlyNavigationRequest } from "./clients/streamMessages";
import {
    CorrelatedRuntimeExchange, cameraStateReadback, cameraViewReadback, flyReadback, parseCameraViewInput, parseFlySpeed,
    type CameraState, type CameraViewInput, type ExchangeReply,
} from "./console/cameraViewBridge";
```

(b) 在 `private sectionExchange = new SectionPlaneExchange({ ... });` 結束之後加入：

```ts
    private _cameraReplyMessage(type: "camera_view_result" | "camera_state_result", reply: ExchangeReply<CameraState>): Record<string, unknown> {
        const { value, ...rest } = reply;
        return { type, ...rest, ...(value ? { camera: value } : {}) };
    }

    private cameraViewExchange = new CorrelatedRuntimeExchange<CameraViewInput, CameraState>({
        parse: parseCameraViewInput,
        readback: cameraViewReadback,
        snapshot: () => this._sectionSnapshot(),
        requestId: () => createRuntimeRequestId(),
        send: (input, requestId) => this._sendStreamMessage(buildCameraViewRequest(input, requestId)),
        complete: (requestId, outcome) => {
            if (this.runtimeCommandTracker.hasContext(requestId)) {
                this.runtimeCommandTracker._claimRuntimeCommandTerminal(requestId, "cameraViewRequest", outcome);
            }
        },
        notify: (reply) => this._postToParent(this._cameraReplyMessage("camera_view_result", reply)),
    });

    // Read-only: not tracked by the runtime command tracker.
    private cameraStateExchange = new CorrelatedRuntimeExchange<true, CameraState>({
        parse: (value) => (value === true ? true : null),
        readback: (_input, payload) => cameraStateReadback(null, payload),
        snapshot: () => this._sectionSnapshot(),
        requestId: () => createRuntimeRequestId(),
        send: (_input, requestId) => this._sendStreamMessage(buildCameraStateRequest(requestId)),
        complete: () => undefined,
        notify: (reply) => this._postToParent(this._cameraReplyMessage("camera_state_result", reply)),
    });

    private flyNavigationExchange = new CorrelatedRuntimeExchange<number, number>({
        parse: parseFlySpeed,
        readback: flyReadback,
        snapshot: () => this._sectionSnapshot(),
        requestId: () => createRuntimeRequestId(),
        send: (speed, requestId) => this._sendStreamMessage(buildFlyNavigationRequest(speed, requestId)),
        complete: (requestId, outcome) => {
            if (this.runtimeCommandTracker.hasContext(requestId)) {
                this.runtimeCommandTracker._claimRuntimeCommandTerminal(requestId, "flyNavigationRequest", outcome);
            }
        },
        notify: (reply) => {
            const { value, ...rest } = reply;
            this._postToParent({ type: "fly_navigation_result", ...rest, ...(value !== undefined ? { speed: value } : {}) });
        },
    });

    private _syncCameraExchanges(): void {
        this.cameraViewExchange.sync();
        this.cameraStateExchange.sync();
        this.flyNavigationExchange.sync();
    }
```

(c) 檔案中每一處 `this.sectionExchange.sync();`（`_onPageHide`、`componentDidUpdate`，以及約第 2849 行那一處）的下一行加入 `this._syncCameraExchanges();`。

(d) `componentWillUnmount` 中 `this.sectionExchange.dispose();` 的下一行加入：

```ts
        this.cameraViewExchange.dispose();
        this.cameraStateExchange.dispose();
        this.flyNavigationExchange.dispose();
```

(e) `_runtimeMutatorBlockReason` 第一個條件中的陣列改為：

```ts
["selectPrimsRequest", "focusPrimRequest", "resetStage", "clipPlaneRequest", "highlightPrimsRequest", "clearHighlightRequest", "cameraViewRequest", "flyNavigationRequest"]
```

（量測選點時不得改動相機。）

(f) `_sendStreamMessage` 的 `.catch(() => { ... })` 中，`const diagnostic = "stream_transport_error";` 的下一行加入：

```ts
                if (outgoing.event_type === "cameraStateRequest" && isRecord(outgoing.payload)) {
                    this.cameraStateExchange.fail(getPayloadString(outgoing.payload, "request_id"), "transport");
                }
```

同一個 catch 內，`if (outgoing.event_type === "clipPlaneRequest") this.sectionExchange.fail(runtimeRequestId, "transport");` 的下一行加入：

```ts
                    if (outgoing.event_type === "cameraViewRequest") this.cameraViewExchange.fail(runtimeRequestId, "transport");
                    if (outgoing.event_type === "flyNavigationRequest") this.flyNavigationExchange.fail(runtimeRequestId, "transport");
```

(g) `_handleParentMessage` 開頭的訊息型別 `const m = e.data as { ... }` 內加入兩個欄位：

```ts
            camera?: unknown;
            speed?: unknown;
```

同一個 `switch` 中，`case "toolbar_action": {` 之前加入：

```ts
            case "camera_view": {
                if (e.source !== window.parent || !canOperate || !clientRequestId) return;
                this.cameraViewExchange.start(m.camera, clientRequestId);
                break;
            }
            case "camera_state": {
                if (e.source !== window.parent || !canOperate || !clientRequestId) return;
                this.cameraStateExchange.start(true, clientRequestId);
                break;
            }
            case "fly_navigation": {
                if (e.source !== window.parent || !canOperate || !clientRequestId) return;
                this.flyNavigationExchange.start(m.speed, clientRequestId);
                break;
            }
```

(h) `commandRejected` 處理中，`if (parsed.request_id && parsed.rejected_event_type === "measurementRequest") { ... }` 之後加入：

```ts
            if (parsed.request_id && parsed.rejected_event_type === "cameraViewRequest") {
                this.cameraViewExchange.fail(parsed.request_id, "rejected");
            }
            if (parsed.request_id && parsed.rejected_event_type === "flyNavigationRequest") {
                this.flyNavigationExchange.fail(parsed.request_id, "rejected");
            }
```

(i) 在 `clipPlaneResult` 的路由判斷（`&& this.sectionExchange.receive(payload)) return;`）之後加入：

```ts
        if (event.event_type === "cameraViewResult"
            && this.runtimeCommandTracker._correlateRuntimeCommandEvent(event.event_type, payload).disposition === "matched"
            && this.cameraViewExchange.receive(payload)) return;

        if (event.event_type === "flyNavigationResult"
            && this.runtimeCommandTracker._correlateRuntimeCommandEvent(event.event_type, payload).disposition === "matched"
            && this.flyNavigationExchange.receive(payload)) return;

        if (event.event_type === "cameraStateResult" && this.cameraStateExchange.receive(payload)) return;
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/cameraViewWindow.dom.test.tsx src/console/sectionPlaneBridge.dom.test.tsx src/console/sectionPlaneAuthority.dom.test.tsx; npm run typecheck; Pop-Location`
Expected: PASS；typecheck exit code 0。

- [ ] **Step 5：Commit**

```bash
git add web-viewer-sample/src/Window.tsx web-viewer-sample/src/console/cameraViewWindow.dom.test.tsx
git diff --cached --check
git commit -m "feat(viewer): 在 iframe 端接通相機視角、相機狀態與飛行速度" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 8：父視窗傳遞與工作台狀態

**Files:**
- Create: `web-viewer-sample/src/console/unified/useViewerCommandState.ts`
- Test: `web-viewer-sample/src/console/unified/useViewerCommandState.test.tsx`
- Modify: `web-viewer-sample/src/console/EmbeddedViewer.tsx`（import、`EmbeddedViewerHandle`、`sectionPending` 附近、訊息 `switch`、listener 清理、`useImperativeHandle`、iframe `onLoad`）
- Test: `web-viewer-sample/src/console/EmbeddedViewer.camera.test.tsx`（新增）
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`（handle 介面約第 125–140 行、`useImperativeHandle` 約第 735 行）
- Modify: `web-viewer-sample/src/console/unified/WorkspaceViewportHost.tsx:96-102`
- Modify: `web-viewer-sample/src/console/unified/viewportSlot.ts`（`ViewportHostActions`、`ViewportSlotApi`）
- Modify: `web-viewer-sample/src/console/unified/ViewportSlotProvider.tsx`

**Interfaces:**
- Consumes: Task 6 的型別、`PendingReply`、`parseCameraReply`、`parseFlyReply`；Task 7 的 postMessage 格式。
- Produces（Task 9 使用）：
  - `EmbeddedViewerHandle.sendCameraView?(input): Promise<CameraReply>`、`.queryCameraState?(): Promise<CameraReply>`、`.sendFlySpeed?(speed): Promise<FlyReply>`（`ReviewSessionViewerPaneHandle` 與 `ViewportHostActions` 同名同型別）
  - `ViewportSlotApi.cameraViewState?: CameraViewState`、`.sendCameraView?(input: CameraViewInput): void`、`.refreshCameraState?(): void`、`.flyState?: FlyState`、`.sendFlySpeed?(speed: number): void`
  - `useViewerCommandState<I, R>(gateRef, validate, resolveSend) => { state, run, invalidate }`

- [ ] **Step 1：寫失敗測試**

(a) 建立 `web-viewer-sample/src/console/unified/useViewerCommandState.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import { useViewerCommandState } from "./useViewerCommandState";

type Reply = { status: "applied" | "unconfirmed" | "error"; reason?: "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback"; value?: number };
let root: Root, box: HTMLDivElement;
let hook: ReturnType<typeof useViewerCommandState<number, Reply>>;
const gateRef: { current: ReviewSessionViewerPaneBatchGate | null } = { current: null };
let send: ((input: number) => Promise<Reply>) | undefined;
const validate = (input: number) => input > 0;
const resolveSend = () => send;
function Probe() { hook = useViewerCommandState<number, Reply>(gateRef, validate, resolveSend); return null; }
async function flush() { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  gateRef.current = { canSend: true, reason: "" };
  send = vi.fn(async (input: number) => ({ status: "applied" as const, value: input }));
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

it("sends one command and stores the reply", async () => {
  act(() => hook.run(2));
  expect(hook.state).toEqual({ status: "pending" });
  await flush();
  expect(hook.state).toEqual({ status: "applied", value: 2 });
  expect(send).toHaveBeenCalledTimes(1);
});
it("rejects invalid input and a closed gate without sending", () => {
  act(() => hook.run(0));
  expect(hook.state).toEqual({ status: "error", reason: "invalid" });
  gateRef.current = { canSend: false, reason: "viewer disconnected" };
  act(() => hook.run(2));
  expect(hook.state).toEqual({ status: "error", reason: "unavailable" });
  expect(send).not.toHaveBeenCalled();
});
it("ignores a second run while pending", async () => {
  act(() => { hook.run(2); hook.run(3); });
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
});
it("invalidate drops a late reply and marks the state unconfirmed", async () => {
  let resolve!: (reply: Reply) => void;
  send = vi.fn(() => new Promise<Reply>(r => { resolve = r; }));
  act(() => hook.run(2));
  await flush();
  act(() => hook.invalidate());
  expect(hook.state).toEqual({ status: "unconfirmed" });
  await act(async () => { resolve({ status: "applied", value: 2 }); });
  await flush();
  expect(hook.state).toEqual({ status: "unconfirmed" });
});
it("maps a thrown send to a transport error", async () => {
  send = vi.fn(async () => { throw new Error("private"); });
  act(() => hook.run(2));
  await flush();
  expect(hook.state).toEqual({ status: "error", reason: "transport" });
});
```

(b) 建立 `web-viewer-sample/src/console/EmbeddedViewer.camera.test.tsx`：

```tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EmbeddedViewer, type EmbeddedViewerHandle } from "./EmbeddedViewer";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: 40, orthoHeight: null };
function fire(data: unknown, origin: string, source: Window | null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
}
async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const ref = { current: null as EmbeddedViewerHandle | null };
  await act(async () => root.render(<EmbeddedViewer ref={ref} sessionId="review_session_camera" viewerOrigin={VIEWER_ORIGIN} />));
  const frame = container.querySelector("iframe")!, source = frame.contentWindow!;
  const post = vi.spyOn(source, "postMessage");
  fire({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, source);
  return { container, root, ref, frame, source, post,
    lastId: () => (post.mock.calls[post.mock.calls.length - 1][0] as { clientRequestId: string }).clientRequestId,
    async dispose() { post.mockRestore(); await act(async () => root.unmount()); container.remove(); } };
}

it("camera view resolves only the correlated reply from the actual frame", async () => {
  const view = await mount();
  const reply = view.ref.current!.sendCameraView!({ action: "preset", view: "iso", scope: "all" });
  expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "camera_view",
    camera: { action: "preset", view: "iso", scope: "all" } });
  const ack = { protocol: "vg01", type: "camera_view_result", status: "applied", requestId: "runtime_1",
    clientRequestId: view.lastId(), camera };
  fire(ack, "https://evil.test", view.source);
  fire({ ...ack, clientRequestId: "old" }, VIEWER_ORIGIN, view.source);
  fire({ ...ack, camera: { ...camera, fovDeg: 999 } }, VIEWER_ORIGIN, view.source);
  let settled = false; void reply.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  fire(ack, VIEWER_ORIGIN, view.source);
  expect(await reply).toMatchObject({ status: "applied", camera: { targetDistance: 30 } });
  await view.dispose();
});
it("camera state and fly speed use their own result types", async () => {
  const view = await mount();
  const state = view.ref.current!.queryCameraState!();
  fire({ protocol: "vg01", type: "camera_state_result", status: "applied", requestId: "r2", clientRequestId: view.lastId(), camera },
    VIEWER_ORIGIN, view.source);
  expect((await state).status).toBe("applied");
  const fly = view.ref.current!.sendFlySpeed!(3);
  expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "fly_navigation", speed: 3 });
  fire({ protocol: "vg01", type: "fly_navigation_result", status: "applied", requestId: "r3", clientRequestId: view.lastId(), speed: 2 },
    VIEWER_ORIGIN, view.source);
  expect(await fly).toMatchObject({ status: "applied", speed: 2 });
  await view.dispose();
});
it("rejects invalid input, reports busy, and cancels on reload or unmount", async () => {
  const view = await mount();
  expect(await view.ref.current!.sendFlySpeed!(0)).toEqual({ status: "error", reason: "invalid" });
  expect(await view.ref.current!.sendCameraView!({ action: "projection", projection: "fisheye" } as never))
    .toEqual({ status: "error", reason: "invalid" });
  const first = view.ref.current!.sendCameraView!({ action: "projection", projection: "orthographic" });
  expect(await view.ref.current!.queryCameraState!()).toEqual({ status: "error", reason: "busy" });
  await act(async () => view.frame.dispatchEvent(new Event("load")));
  expect(await first).toEqual({ status: "unconfirmed" });
  fire({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, view.source);
  const again = view.ref.current!.sendFlySpeed!(2);
  await act(async () => view.root.unmount());
  expect(await again).toEqual({ status: "unconfirmed" });
  view.post.mockRestore(); view.container.remove();
});
it("an unsolicited unconfirmed result invalidates viewer command state", async () => {
  const onSectionInvalidated = vi.fn();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<EmbeddedViewer sessionId="review_session_camera" viewerOrigin={VIEWER_ORIGIN}
    onSectionInvalidated={onSectionInvalidated} />));
  const source = container.querySelector("iframe")!.contentWindow!;
  fire({ protocol: "vg01", type: "camera_view_result", status: "unconfirmed" }, VIEWER_ORIGIN, source);
  fire({ protocol: "vg01", type: "fly_navigation_result", status: "unconfirmed" }, VIEWER_ORIGIN, source);
  expect(onSectionInvalidated).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount()); container.remove();
});
```

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/unified/useViewerCommandState.test.tsx src/console/EmbeddedViewer.camera.test.tsx; Pop-Location`
Expected: FAIL（找不到 `./useViewerCommandState`；`sendCameraView` 為 undefined）。

- [ ] **Step 3：實作**

(a) 建立 `web-viewer-sample/src/console/unified/useViewerCommandState.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandReason } from "../cameraViewBridge";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import { resolveViewerCommandGate } from "./viewportSlot";

type Reply = { status: "applied" | "unconfirmed" | "error"; reason?: CommandReason };
export type ViewerCommandState<R extends Reply> = { status: "idle" | "pending" } | R;

/** One-at-a-time viewer command with generation guards; mirrors the section-plane flow in ViewportSlotProvider. */
export function useViewerCommandState<I, R extends Reply>(
  gateRef: { readonly current: ReviewSessionViewerPaneBatchGate | null },
  validate: (input: I) => boolean,
  resolveSend: () => ((input: I) => Promise<R>) | undefined,
) {
  const [state, setState] = useState<ViewerCommandState<R>>({ status: "idle" });
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);
  const fail = (reason: CommandReason) => ({ status: "error", reason } as unknown as R);
  const invalidate = useCallback(() => {
    ++generation.current; busy.current = false;
    setState(previous => (previous.status === "idle" || previous.status === "unconfirmed"
      ? previous : { status: "unconfirmed" } as unknown as R));
  }, []);
  const run = useCallback((input: I) => {
    if (busy.current) return;
    if (!validate(input)) { setState(fail("invalid")); return; }
    const send = resolveSend();
    if (!resolveViewerCommandGate(gateRef.current).canSend || !send) { setState(fail("unavailable")); return; }
    const current = ++generation.current;
    busy.current = true; setState({ status: "pending" });
    void Promise.resolve().then(() => {
      if (current !== generation.current || !resolveViewerCommandGate(gateRef.current).canSend) return null;
      return send(input);
    }).then(reply => {
      if (current !== generation.current || !reply) return;
      busy.current = false; setState(reply);
    }).catch(() => {
      if (current !== generation.current) return;
      busy.current = false; setState(fail("transport"));
    });
  }, [gateRef, validate, resolveSend]);
  return { state, run, invalidate };
}
```

(b) `EmbeddedViewer.tsx`：

加入 import：

```ts
import {
  PendingReply, parseCameraReply, parseCameraViewInput, parseFlyReply, parseFlySpeed,
  type CameraReply, type CameraViewInput, type FlyReply,
} from "./cameraViewBridge";
```

`EmbeddedViewerHandle` 介面中 `sendSectionPlane?(...)` 下一行加入：

```ts
  sendCameraView?(input: CameraViewInput): Promise<CameraReply>;
  queryCameraState?(): Promise<CameraReply>;
  sendFlySpeed?(speed: number): Promise<FlyReply>;
```

`const cancelSection = () => { ... };` 之後加入：

```ts
  const cameraPending = useRef(new PendingReply<CameraReply>({ status: "error", reason: "timeout" }, { status: "unconfirmed" }));
  const flyPending = useRef(new PendingReply<FlyReply>({ status: "error", reason: "timeout" }, { status: "unconfirmed" }));
  const cancelViewCommands = () => { cameraPending.current.cancel(); flyPending.current.cancel(); };
  const startViewCommand = <R extends CameraReply | FlyReply>(pending: PendingReply<R>, send: (id: string) => void): Promise<R> => {
    if (!viewerReadyRef.current || !iframeRef.current?.contentWindow) return Promise.resolve({ status: "error", reason: "unavailable" } as R);
    if (pending.busy) return Promise.resolve({ status: "error", reason: "busy" } as R);
    const id = crypto.randomUUID();
    return pending.start(id, () => send(id), { status: "error", reason: "transport" } as R);
  };
```

訊息 `switch` 中 `case "section_result": { ... }` 之後加入：

```ts
        case "camera_view_result":
        case "camera_state_result": {
          const reply = parseCameraReply(m);
          if (!reply) break;
          // Every viewer command state is invalidated together (section, measurement, camera, fly).
          if (reply.status === "unconfirmed" && !reply.clientRequestId) { cancelViewCommands(); p.onSectionInvalidated?.(); break; }
          cameraPending.current.settle(reply);
          break;
        }
        case "fly_navigation_result": {
          const reply = parseFlyReply(m);
          if (!reply) break;
          if (reply.status === "unconfirmed" && !reply.clientRequestId) { cancelViewCommands(); p.onSectionInvalidated?.(); break; }
          flyPending.current.settle(reply);
          break;
        }
```

listener 清理改為：

```ts
    return () => { window.removeEventListener("message", onMsg); cancelSection(); cancelViewCommands(); };
```

`useImperativeHandle` 內 `sendSectionPlane: ...` 之後加入：

```ts
    sendCameraView: (input) => {
      if (!parseCameraViewInput(input)) return Promise.resolve({ status: "error", reason: "invalid" });
      return startViewCommand(cameraPending.current, id => post({ type: "camera_view", camera: input, clientRequestId: id }));
    },
    queryCameraState: () => startViewCommand(cameraPending.current, id => post({ type: "camera_state", clientRequestId: id })),
    sendFlySpeed: (speed) => {
      if (parseFlySpeed(speed) === null) return Promise.resolve({ status: "error", reason: "invalid" });
      return startViewCommand(flyPending.current, id => post({ type: "fly_navigation", speed, clientRequestId: id }));
    },
```

iframe 的 `onLoad` 改為：

```tsx
      onLoad={() => { viewerReadyRef.current = false; cancelSection(); cancelViewCommands(); propsRef.current.onSectionInvalidated?.(); propsRef.current.onMeasurementState?.({ status: "unconfirmed" }); }}
```

(c) `ReviewSessionViewerPane.tsx`：

import 區加入 `import type { CameraReply, CameraViewInput, FlyReply } from "./cameraViewBridge";`

`ReviewSessionViewerPaneHandle` 介面中 `sendSectionPlane?(input: SectionInput): Promise<SectionReply>;` 下一行加入：

```ts
  sendCameraView?(input: CameraViewInput): Promise<CameraReply>;
  queryCameraState?(): Promise<CameraReply>;
  sendFlySpeed?(speed: number): Promise<FlyReply>;
```

`useImperativeHandle` 中 `sendSectionPlane(input) { ... },` 之後加入：

```ts
    sendCameraView(input) {
      if (commandGateRef.current) return Promise.resolve({ status: "error", reason: "unavailable" });
      return viewerRef.current?.sendCameraView?.(input) ?? Promise.resolve({ status: "error", reason: "unavailable" });
    },
    queryCameraState() {
      if (commandGateRef.current) return Promise.resolve({ status: "error", reason: "unavailable" });
      return viewerRef.current?.queryCameraState?.() ?? Promise.resolve({ status: "error", reason: "unavailable" });
    },
    sendFlySpeed(speed) {
      if (commandGateRef.current) return Promise.resolve({ status: "error", reason: "unavailable" });
      return viewerRef.current?.sendFlySpeed?.(speed) ?? Promise.resolve({ status: "error", reason: "unavailable" });
    },
```

(d) `WorkspaceViewportHost.tsx` 的 `registerHostActions?.({ ... })` 物件中 `sendMeasurement: ...,` 之後加入：

```ts
      sendCameraView: (input) => paneHandleRef.current?.sendCameraView?.(input) ?? Promise.resolve({ status: "error", reason: "unavailable" }),
      queryCameraState: () => paneHandleRef.current?.queryCameraState?.() ?? Promise.resolve({ status: "error", reason: "unavailable" }),
      sendFlySpeed: (speed) => paneHandleRef.current?.sendFlySpeed?.(speed) ?? Promise.resolve({ status: "error", reason: "unavailable" }),
```

(e) `viewportSlot.ts`：

import 區加入 `import type { CameraReply, CameraViewInput, CameraViewState, FlyReply, FlyState } from "../cameraViewBridge";`

`ViewportHostActions` 介面中 `sendSectionPlane?: ...;` 下一行加入：

```ts
  sendCameraView?: (input: CameraViewInput) => Promise<CameraReply>;
  queryCameraState?: () => Promise<CameraReply>;
  sendFlySpeed?: (speed: number) => Promise<FlyReply>;
```

`ViewportSlotApi` 介面中 `invalidateSection?: () => void;` 下一行加入：

```ts
  cameraViewState?: CameraViewState;
  sendCameraView?: (input: CameraViewInput) => void;
  refreshCameraState?: () => void;
  flyState?: FlyState;
  sendFlySpeed?: (speed: number) => void;
```

(f) `ViewportSlotProvider.tsx`：

import 區加入：

```ts
import { parseCameraViewInput, parseFlySpeed, type CameraReply, type CameraViewInput, type FlyReply } from "../cameraViewBridge";
import { useViewerCommandState } from "./useViewerCommandState";
```

檔案頂層（`export function ViewportSlotProvider` 之前）加入：

```ts
type CameraCommand = CameraViewInput | { action: "read" };
const validateCameraCommand = (input: CameraCommand) => input.action === "read" || parseCameraViewInput(input) !== null;
const validateFlySpeed = (speed: number) => parseFlySpeed(speed) !== null;
```

在 `const [measurementState, setMeasurementState] = ...` 之前加入：

```ts
  const resolveCameraCommand = useCallback(() => {
    const actions = hostActionsRef.current;
    const sendCameraView = actions?.sendCameraView, queryCameraState = actions?.queryCameraState;
    if (!sendCameraView || !queryCameraState) return undefined;
    return (input: CameraCommand) => (input.action === "read" ? queryCameraState() : sendCameraView(input));
  }, []);
  const resolveFlySpeed = useCallback(() => hostActionsRef.current?.sendFlySpeed, []);
  const camera = useViewerCommandState<CameraCommand, CameraReply>(gateRef, validateCameraCommand, resolveCameraCommand);
  const fly = useViewerCommandState<number, FlyReply>(gateRef, validateFlySpeed, resolveFlySpeed);
  const { run: runCamera, invalidate: invalidateCamera } = camera;
  const { invalidate: invalidateFly } = fly;
  const sendCameraView = useCallback((input: CameraViewInput) => runCamera(input), [runCamera]);
  const refreshCameraState = useCallback(() => runCamera({ action: "read" }), [runCamera]);
```

`invalidateSection` 的 `useCallback` 本體最後加入 `invalidateCamera(); invalidateFly();`，依賴陣列由 `[]` 改為 `[invalidateCamera, invalidateFly]`。

`value` 的 `useMemo` 物件中 `sectionState, sendSectionPlane, invalidateSection,` 之後加入：

```ts
    cameraViewState: camera.state, sendCameraView, refreshCameraState,
    flyState: fly.state, sendFlySpeed: fly.run,
```

依賴陣列中 `sectionState, sendSectionPlane, invalidateSection,` 之後加入：

```ts
    camera.state, sendCameraView, refreshCameraState,
    fly.state, fly.run,
```

- [ ] **Step 4：確認測試通過**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/unified src/console/EmbeddedViewer.camera.test.tsx src/console/EmbeddedViewer.test.tsx; npm run typecheck; Pop-Location`
Expected: PASS；typecheck exit code 0。

- [ ] **Step 5：Commit**

```bash
git add web-viewer-sample/src/console/unified/useViewerCommandState.ts web-viewer-sample/src/console/unified/useViewerCommandState.test.tsx web-viewer-sample/src/console/EmbeddedViewer.tsx web-viewer-sample/src/console/EmbeddedViewer.camera.test.tsx web-viewer-sample/src/console/ReviewSessionViewerPane.tsx web-viewer-sample/src/console/unified/WorkspaceViewportHost.tsx web-viewer-sample/src/console/unified/viewportSlot.ts web-viewer-sample/src/console/unified/ViewportSlotProvider.tsx
git diff --cached --check
git commit -m "feat(console): 將相機與飛行指令接到統一工作台狀態" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 9：工作台控制項與工具列

**Files:**
- Create: `web-viewer-sample/src/console/unified/viewerCommandText.ts`
- Create: `web-viewer-sample/src/console/unified/CameraViewControls.tsx`
- Create: `web-viewer-sample/src/console/unified/FlyNavigationControls.tsx`
- Test: `web-viewer-sample/src/console/unified/CameraViewControls.test.tsx`
- Test: `web-viewer-sample/src/console/unified/FlyNavigationControls.test.tsx`
- Test: `web-viewer-sample/src/console/unified/workspaceCameraControls.test.tsx`（新增）
- Modify: `web-viewer-sample/src/console/unified/WorkspacePage.tsx`（import、`toolbarDisabled` 附近、工具列按鈕約第 284–312 行、左側剖切區塊之前約第 431 行）
- Modify: `web-viewer-sample/src/console/unified/workspaceStageTree.test.tsx:163-168`

**Interfaces:**
- Consumes: Task 6 型別與 `parseFlySpeed`、`FLY_SPEED_MIN`、`FLY_SPEED_MAX`；Task 8 的 `ViewportSlotApi` 欄位。
- Produces: `CameraViewControls({ ready, state, onSend })`、`FlyNavigationControls({ ready, state, camera, onSetSpeed, onReadCamera })`、`commandErrorText(reason)`、`cameraSummary(camera)`。

- [ ] **Step 1：寫失敗測試**

(a) 建立 `web-viewer-sample/src/console/unified/CameraViewControls.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CameraViewControls } from "./CameraViewControls";
import { getLang, setLang } from "../i18n";
import type { CameraState } from "../cameraViewBridge";

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
const ortho: CameraState = { projection: "orthographic", position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: null, orthoHeight: 12 };
beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
const button = (id: string) => box.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

it("starts idle with every control disabled when the viewer is not ready", () => {
  act(() => root.render(<CameraViewControls ready={false} state={{ status: "idle" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未套用視角");
  expect(box.textContent).toContain("不是真北");
  expect([...box.querySelectorAll("button, input")].every(el => (el as HTMLButtonElement).disabled)).toBe(true);
  expect(box.querySelector("canvas,video,iframe")).toBeNull();
});
it("sends each preset with the building scope and switches to all when site is included", () => {
  const send = vi.fn();
  act(() => root.render(<CameraViewControls ready state={{ status: "idle" }} onSend={send} />));
  for (const view of ["top", "front", "back", "left", "right", "iso"]) act(() => button(`camera-preset-${view}`).click());
  expect(send.mock.calls.map(call => call[0])).toEqual(["top", "front", "back", "left", "right", "iso"]
    .map(view => ({ action: "preset", view, scope: "building" })));
  act(() => box.querySelector<HTMLInputElement>('[data-testid="camera-include-site"]')!.click());
  act(() => button("camera-preset-top").click());
  expect(send).toHaveBeenLastCalledWith({ action: "preset", view: "top", scope: "all" });
});
it("sends projection changes and marks the confirmed projection", () => {
  const send = vi.fn();
  act(() => root.render(<CameraViewControls ready state={{ status: "applied", camera: ortho }} onSend={send} />));
  expect(button("camera-projection-orthographic").getAttribute("aria-pressed")).toBe("true");
  expect(button("camera-projection-perspective").getAttribute("aria-pressed")).toBe("false");
  expect(box.textContent).toContain("正交");
  expect(box.textContent).toContain("(1.00, 2.00, 3.00)");
  act(() => button("camera-projection-perspective").click());
  expect(send).toHaveBeenCalledWith({ action: "projection", projection: "perspective" });
});
it("disables actions while pending and explains errors without internal words", () => {
  act(() => root.render(<CameraViewControls ready state={{ status: "pending" }} onSend={vi.fn()} />));
  expect(button("camera-preset-top").disabled).toBe(true);
  expect(box.textContent).toContain("等待套用");
  for (const reason of ["rejected", "transport", "timeout", "readback"] as const) {
    act(() => root.render(<CameraViewControls ready state={{ status: "error", reason }} onSend={vi.fn()} />));
    expect(box.textContent).toContain("未能套用");
    expect(box.textContent).not.toContain("ACK");
    expect(box.textContent).not.toContain("Roadmap");
  }
  act(() => root.render(<CameraViewControls ready state={{ status: "unconfirmed" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未確認");
});
```

(b) 建立 `web-viewer-sample/src/console/unified/FlyNavigationControls.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FlyNavigationControls } from "./FlyNavigationControls";
import { getLang, setLang } from "../i18n";

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
const button = (id: string) => box.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
function setSpeed(value: string) {
  const input = box.querySelector<HTMLInputElement>('input[type="number"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("explains the official fly controls", () => {
  act(() => root.render(<FlyNavigationControls ready state={{ status: "idle" }} camera={{ status: "idle" }} onSetSpeed={vi.fn()} onReadCamera={vi.fn()} />));
  for (const text of ["先點一下 3D 畫面", "按住滑鼠右鍵", "W／A／S／D", "Q／E", "滾輪"]) expect(box.textContent).toContain(text);
});
it("applies only a bounded speed and shows the Kit readback", () => {
  const onSetSpeed = vi.fn();
  act(() => root.render(<FlyNavigationControls ready state={{ status: "idle" }} camera={{ status: "idle" }} onSetSpeed={onSetSpeed} onReadCamera={vi.fn()} />));
  act(() => button("fly-speed-apply").click());
  expect(onSetSpeed).toHaveBeenCalledWith(1);
  setSpeed("0");
  expect(button("fly-speed-apply").disabled).toBe(true);
  expect(box.querySelector('[role="alert"]')).not.toBeNull();
  setSpeed("2.5");
  act(() => button("fly-speed-apply").click());
  expect(onSetSpeed).toHaveBeenLastCalledWith(2.5);
  act(() => root.render(<FlyNavigationControls ready state={{ status: "applied", speed: 2 }} camera={{ status: "idle" }} onSetSpeed={onSetSpeed} onReadCamera={vi.fn()} />));
  expect(box.textContent).toContain("目前速度：2");
});
it("reads the camera and shows the confirmed position", () => {
  const onReadCamera = vi.fn();
  const camera = { status: "applied" as const, camera: { projection: "perspective" as const, position: [4, 5, 6] as [number, number, number],
    direction: [0, 1, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], targetDistance: 3, fovDeg: 45, orthoHeight: null } };
  act(() => root.render(<FlyNavigationControls ready state={{ status: "idle" }} camera={camera} onSetSpeed={vi.fn()} onReadCamera={onReadCamera} />));
  act(() => button("fly-read-camera").click());
  expect(onReadCamera).toHaveBeenCalledTimes(1);
  expect(box.querySelector('[data-testid="fly-camera-summary"]')!.textContent).toContain("(4.00, 5.00, 6.00)");
});
it("disables everything when the viewer is not ready", () => {
  act(() => root.render(<FlyNavigationControls ready={false} state={{ status: "idle" }} camera={{ status: "idle" }} onSetSpeed={vi.fn()} onReadCamera={vi.fn()} />));
  expect(button("fly-speed-apply").disabled).toBe(true);
  expect(button("fly-read-camera").disabled).toBe(true);
  expect(box.textContent).toContain("沒有操作權限");
});
```

(c) 建立 `web-viewer-sample/src/console/unified/workspaceCameraControls.test.tsx`：

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotContext, type ViewportSlotApi } from "./viewportSlot";
import { setLang } from "../i18n";
import type { CameraViewState } from "../cameraViewBridge";

let container: HTMLDivElement, root: Root | null;
async function flush(n = 6) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  setLang("zh");
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = null;
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); container.remove(); vi.restoreAllMocks(); });

function slot(overrides: Partial<ViewportSlotApi>): ViewportSlotApi {
  return {
    registerSlot: vi.fn(), slotEl: null, publish: vi.fn(), publishViewer: vi.fn(), viewerPublication: null,
    subscribeDock: vi.fn(() => vi.fn()), dockSubscription: null, publication: null,
    activeSessionId: "session_camera", setActiveSessionId: vi.fn(),
    gate: { canSend: true, reason: "" }, setGate: vi.fn(), stageTree: [], setStageTree: vi.fn(),
    requestStageTree: vi.fn(), selectPrim: vi.fn(), sendToolbarAction: vi.fn(), registerHostActions: vi.fn(),
    ...overrides,
  };
}
async function render(api: ViewportSlotApi) {
  root = createRoot(container);
  await act(async () => { root!.render(<ViewportSlotContext.Provider value={api}><WorkspacePage initialDock="a1" /></ViewportSlotContext.Provider>); });
  await flush();
}
const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;
const orthographic: CameraViewState = { status: "applied", camera: { projection: "orthographic", position: [0, 0, 1],
  direction: [0, 0, -1], up: [0, 1, 0], targetDistance: 1, fovDeg: null, orthoHeight: 5 } };

it("toolbar camera button opens the view tools and projection toggles to orthographic", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ sendCameraView }));
  const cameraButton = q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]');
  expect(cameraButton.disabled).toBe(false);
  await act(async () => { cameraButton.click(); });
  expect(q<HTMLDetailsElement>('[data-uc="ws-camera-view"]').open).toBe(true);
  const projection = q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]');
  expect(projection.getAttribute("aria-pressed")).toBe("false");
  await act(async () => { projection.click(); });
  expect(sendCameraView).toHaveBeenCalledWith({ action: "projection", projection: "orthographic" });
  await act(async () => { q<HTMLButtonElement>('[data-testid="camera-preset-front"]').click(); });
  expect(sendCameraView).toHaveBeenLastCalledWith({ action: "preset", view: "front", scope: "building" });
});
it("projection toggles back to perspective after an orthographic readback", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ sendCameraView, cameraViewState: orthographic }));
  const projection = q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]');
  expect(projection.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { projection.click(); });
  expect(sendCameraView).toHaveBeenCalledWith({ action: "projection", projection: "perspective" });
});
it("fly tools send speed and read the camera", async () => {
  const sendFlySpeed = vi.fn(), refreshCameraState = vi.fn();
  await render(slot({ sendFlySpeed, refreshCameraState }));
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-speed-apply"]').click(); });
  await act(async () => { q<HTMLButtonElement>('[data-testid="fly-read-camera"]').click(); });
  expect(sendFlySpeed).toHaveBeenCalledWith(1);
  expect(refreshCameraState).toHaveBeenCalledTimes(1);
});
it("camera and projection buttons stay disabled while the viewer cannot receive commands", async () => {
  const sendCameraView = vi.fn();
  await render(slot({ sendCameraView, gate: { canSend: false, reason: "viewer disconnected" } }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-camera-view"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
  expect(q<HTMLButtonElement>('[data-testid="camera-preset-top"]').disabled).toBe(true);
});
it("projection button waits while a camera command is pending", async () => {
  await render(slot({ sendCameraView: vi.fn(), cameraViewState: { status: "pending" } }));
  expect(q<HTMLButtonElement>('[data-testid="ws-toolbar-projection"]').disabled).toBe(true);
});
```

(d) `workspaceStageTree.test.tsx` 中這段：

```tsx
    const camBtn = container.querySelector('[data-testid="ws-toolbar-camera-view"]') as HTMLButtonElement | null;
    expect(camBtn?.disabled).toBe(true);
```

改為：

```tsx
    const camBtn = container.querySelector('[data-testid="ws-toolbar-camera-view"]') as HTMLButtonElement | null;
    expect(camBtn?.disabled).toBe(false);
```

其後的 `camBtn?.click()` 與 `not.toHaveBeenCalledWith("camera_view", "perspective")` 維持不變（相機按鈕現在只開啟左側視角工具，不經舊的 `sendToolbarAction`）。

- [ ] **Step 2：確認測試失敗**

Run: `Push-Location web-viewer-sample; npx vitest run src/console/unified/CameraViewControls.test.tsx src/console/unified/FlyNavigationControls.test.tsx src/console/unified/workspaceCameraControls.test.tsx src/console/unified/workspaceStageTree.test.tsx; Pop-Location`
Expected: FAIL（元件不存在；相機按鈕仍是停用）。

- [ ] **Step 3：實作**

(a) 建立 `web-viewer-sample/src/console/unified/viewerCommandText.ts`：

```ts
import { t } from "../i18n";
import type { CameraState, CommandReason } from "../cameraViewBridge";

export function commandErrorText(reason: CommandReason | undefined): string {
  return {
    invalid: t("輸入的值不正確。", "The value is not valid."),
    busy: t("已有操作等待回覆，請稍候。", "An operation is pending. Please wait."),
    unavailable: t("目前無法操作模型，請確認連線與操作權限。", "The model is unavailable. Check connection and access."),
    rejected: t("模型拒絕此操作，請確認目前操作權限。", "The model rejected this operation. Check access."),
    transport: t("傳送失敗，請確認連線後再試。", "Sending failed. Check the connection and try again."),
    timeout: t("尚未收到回覆；模型可能已變更，請確認畫面後重試。", "No response received; the model may have changed. Check the view before retrying."),
    readback: t("回覆無法確認結果，請確認畫面後重試。", "The response could not confirm the result. Check the view before retrying."),
  }[reason ?? "readback"];
}

const fixed = (value: number) => value.toFixed(2);

export function cameraSummary(camera: CameraState): string {
  const projection = camera.projection === "orthographic" ? t("正交", "Orthographic") : t("透視", "Perspective");
  return `${projection} · ${t("位置", "Position")} (${camera.position.map(fixed).join(", ")}) · `
    + `${t("視線", "Direction")} (${camera.direction.map(fixed).join(", ")})`;
}
```

(b) 建立 `web-viewer-sample/src/console/unified/CameraViewControls.tsx`：

```tsx
import { useState, type CSSProperties } from "react";
import { t } from "../i18n";
import type { CameraPreset, CameraViewInput, CameraViewState } from "../cameraViewBridge";
import { cameraSummary, commandErrorText } from "./viewerCommandText";

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", background: "var(--ab-surface)", color: "var(--ab-text)" };
const PRESETS: Array<{ view: CameraPreset; zh: string; en: string }> = [
  { view: "top", zh: "上", en: "Top" },
  { view: "front", zh: "前", en: "Front" },
  { view: "back", zh: "後", en: "Back" },
  { view: "left", zh: "左", en: "Left" },
  { view: "right", zh: "右", en: "Right" },
  { view: "iso", zh: "等角", en: "Isometric" },
];

export function CameraViewControls({ ready, state, onSend }: { ready: boolean; state: CameraViewState; onSend: (input: CameraViewInput) => void }) {
  const [includeSite, setIncludeSite] = useState(false);
  const blocked = !ready || state.status === "pending";
  const camera = state.status === "applied" ? state.camera : undefined;
  const scope = includeSite ? "all" : "building";
  const title = {
    idle: t("尚未套用視角", "No view applied"),
    pending: t("等待套用", "Waiting for response"),
    applied: t("相機狀態已確認", "Camera state confirmed"),
    unconfirmed: t("尚未確認", "Not confirmed"),
    error: t("未能套用", "Could not apply"),
  }[state.status];
  return <section aria-label={t("視角", "Views")} data-testid="camera-view-controls" style={{ flexShrink: 0, display: "grid", gap: 8, fontSize: 12 }}>
    <div role="group" aria-label={t("預設視角", "Preset views")} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {PRESETS.map(preset => <button key={preset.view} data-testid={`camera-preset-${preset.view}`} style={field} disabled={blocked}
        onClick={() => onSend({ action: "preset", view: preset.view, scope })}>{t(preset.zh, preset.en)}</button>)}
    </div>
    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="checkbox" data-testid="camera-include-site" checked={includeSite} disabled={blocked}
        onChange={event => setIncludeSite(event.target.checked)} />
      {t("包含場地與遠處構件", "Include site and distant elements")}
    </label>
    <div role="group" aria-label={t("投影", "Projection")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <button data-testid="camera-projection-perspective" style={field} disabled={blocked} aria-pressed={camera?.projection === "perspective"}
        onClick={() => onSend({ action: "projection", projection: "perspective" })}>{t("透視", "Perspective")}</button>
      <button data-testid="camera-projection-orthographic" style={field} disabled={blocked} aria-pressed={camera?.projection === "orthographic"}
        onClick={() => onSend({ action: "projection", projection: "orthographic" })}>{t("正交", "Orthographic")}</button>
    </div>
    <small>{t("方向以模型座標為準（Z 軸朝上），不是真北。", "Directions use model axes (Z up), not true north.")}</small>
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 5 }}>
      <strong>{title}</strong>
      {camera ? <span>{cameraSummary(camera)}</span> : null}
      {camera ? <span>{t("請在模型畫面確認視角。", "Check the view in the model.")}</span> : null}
      {state.status === "error" ? <span>{commandErrorText(state.reason)}</span> : null}
      {state.status === "unconfirmed" ? <span>{t("模型或連線已變更，請重新確認。", "The model or connection changed. Please verify again.")}</span> : null}
      {!ready ? <span>{t("模型尚未就緒或目前沒有操作權限。", "The model is not ready or access is unavailable.")}</span> : null}
    </div>
  </section>;
}
```

(c) 建立 `web-viewer-sample/src/console/unified/FlyNavigationControls.tsx`：

```tsx
import { useState, type CSSProperties } from "react";
import { t } from "../i18n";
import { FLY_SPEED_MAX, FLY_SPEED_MIN, parseFlySpeed, type CameraViewState, type FlyState } from "../cameraViewBridge";
import { cameraSummary, commandErrorText } from "./viewerCommandText";

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", background: "var(--ab-surface)", color: "var(--ab-text)" };

export function FlyNavigationControls({ ready, state, camera, onSetSpeed, onReadCamera }: {
  ready: boolean; state: FlyState; camera: CameraViewState; onSetSpeed: (speed: number) => void; onReadCamera: () => void;
}) {
  const [speed, setSpeed] = useState("1");
  const parsed = speed.trim() === "" ? null : parseFlySpeed(Number(speed));
  const blocked = !ready || state.status === "pending";
  const confirmedCamera = camera.status === "applied" ? camera.camera : undefined;
  const title = {
    idle: t("尚未設定速度", "Speed not set"),
    pending: t("等待套用", "Waiting for response"),
    applied: t("速度已套用", "Speed applied"),
    unconfirmed: t("尚未確認", "Not confirmed"),
    error: t("未能套用", "Could not apply"),
  }[state.status];
  return <section aria-label={t("飛行", "Fly")} data-testid="fly-controls" style={{ flexShrink: 0, display: "grid", gap: 8, fontSize: 12 }}>
    <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
      <li>{t("先點一下 3D 畫面。", "Click the 3D view first.")}</li>
      <li>{t("按住滑鼠右鍵並移動滑鼠：轉動視線。", "Hold the right mouse button and move the mouse: look around.")}</li>
      <li>{t("按住右鍵加 W／A／S／D：前、左、後、右移動。", "Hold the right button with W/A/S/D: move forward, left, back, right.")}</li>
      <li>{t("按住右鍵加 Q／E：下降／上升。", "Hold the right button with Q/E: move down/up.")}</li>
      <li>{t("按住右鍵時滾動滾輪：調整速度。", "Scroll the wheel while holding the right button: change speed.")}</li>
    </ol>
    <small>{t("建議在透視投影下飛行。", "Fly in perspective projection.")}</small>
    <label>{t("移動速度", "Move speed")}<input aria-label={t("移動速度", "Move speed")} type="number" step="any"
      min={FLY_SPEED_MIN} max={FLY_SPEED_MAX} style={field} disabled={blocked} value={speed}
      onChange={event => setSpeed(event.target.value)} /></label>
    {parsed === null ? <span role="alert">{t(`請輸入 ${FLY_SPEED_MIN} 到 ${FLY_SPEED_MAX} 之間的數字。`, `Enter a number from ${FLY_SPEED_MIN} to ${FLY_SPEED_MAX}.`)}</span> : null}
    <button data-testid="fly-speed-apply" style={field} disabled={blocked || parsed === null}
      onClick={() => { if (parsed !== null) onSetSpeed(parsed); }}>{t("套用速度", "Apply speed")}</button>
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 5 }}>
      <strong>{title}</strong>
      {state.status === "applied" && state.speed !== undefined ? <span>{t("目前速度：", "Current speed: ")}{state.speed}</span> : null}
      {state.status === "error" ? <span>{commandErrorText(state.reason)}</span> : null}
      {state.status === "unconfirmed" ? <span>{t("模型或連線已變更，請重新確認。", "The model or connection changed. Please verify again.")}</span> : null}
      {!ready ? <span>{t("模型尚未就緒或目前沒有操作權限。", "The model is not ready or access is unavailable.")}</span> : null}
    </div>
    <button data-testid="fly-read-camera" style={field} disabled={!ready || camera.status === "pending"} onClick={onReadCamera}>
      {t("讀取目前相機位置", "Read current camera")}
    </button>
    {confirmedCamera ? <span data-testid="fly-camera-summary">{cameraSummary(confirmedCamera)}</span> : null}
  </section>;
}
```

(d) `WorkspacePage.tsx`：

import 區在 `import { MeasurementControls } from "./MeasurementControls";` 之後加入：

```ts
import { CameraViewControls } from "./CameraViewControls";
import { FlyNavigationControls } from "./FlyNavigationControls";
import type { CameraViewState } from "../cameraViewBridge";
```

`const toolbarDisabled = !resolveViewerCommandGate(slot?.gate ?? null).canSend;` 之後加入：

```ts
  const cameraViewState: CameraViewState = slot?.cameraViewState ?? { status: "idle" };
  const cameraPending = cameraViewState.status === "pending";
  const orthographic = cameraViewState.status === "applied" && cameraViewState.camera?.projection === "orthographic";
```

把 `data-testid="ws-toolbar-camera-view"` 的整個 `<button ...>⬒</button>` 換成：

```tsx
            <button
              data-testid="ws-toolbar-camera-view"
              title={t("開啟視角工具：上、前、後、左、右、等角", "Open view presets: top, front, back, left, right, isometric")}
              aria-label={t("視角工具", "View presets")}
              disabled={toolbarDisabled}
              onClick={event => {
                const details = event.currentTarget.closest("aside")?.querySelector<HTMLDetailsElement>('[data-uc="ws-camera-view"]');
                if (details) { details.open = true; details.querySelector<HTMLElement>("summary")?.focus(); }
              }}
              style={toolbarBtnStyle(toolbarDisabled)}
            >
              ⬒
            </button>
```

把 `data-testid="ws-toolbar-projection"` 的整個 `<button ...>◫</button>` 換成：

```tsx
            <button
              data-testid="ws-toolbar-projection"
              title={orthographic ? t("切換為透視投影", "Switch to perspective") : t("切換為正交投影", "Switch to orthographic")}
              aria-label={t("切換投影", "Toggle projection")}
              aria-pressed={orthographic}
              disabled={toolbarDisabled || cameraPending}
              onClick={() => slot?.sendCameraView?.({ action: "projection", projection: orthographic ? "perspective" : "orthographic" })}
              style={toolbarBtnStyle(toolbarDisabled || cameraPending)}
            >
              ◫
            </button>
```

在 `<details className="op-tool-disclosure"><summary>{t("剖切", "Section plane")}</summary>` 之前加入：

```tsx
          <details className="op-tool-disclosure" data-uc="ws-camera-view"><summary>{t("視角", "Views")}</summary>
          <CameraViewControls ready={!toolbarDisabled} state={cameraViewState} onSend={input => slot?.sendCameraView?.(input)} />
          </details>
          <details className="op-tool-disclosure" data-uc="ws-fly"><summary>{t("飛行", "Fly")}</summary>
          <FlyNavigationControls ready={!toolbarDisabled} state={slot?.flyState ?? { status: "idle" }} camera={cameraViewState}
            onSetSpeed={speed => slot?.sendFlySpeed?.(speed)} onReadCamera={() => slot?.refreshCameraState?.()} />
          </details>
```

(e) 修改 `workspaceStageTree.test.tsx`，內容見 Step 1 (d)。

- [ ] **Step 4：確認測試、型別與建置通過**

Run: `Push-Location web-viewer-sample; npm test; npm run test:session-first; npm run typecheck; npm run build; Pop-Location`
Expected: 全部 PASS；各命令 exit code 0。`workspaceViewportHost.test.tsx` 的離線案例仍預期相機與投影按鈕停用，因為離線時 `toolbarDisabled` 為 true，不需修改。

- [ ] **Step 5：Commit**

```bash
git add web-viewer-sample/src/console/unified/viewerCommandText.ts web-viewer-sample/src/console/unified/CameraViewControls.tsx web-viewer-sample/src/console/unified/CameraViewControls.test.tsx web-viewer-sample/src/console/unified/FlyNavigationControls.tsx web-viewer-sample/src/console/unified/FlyNavigationControls.test.tsx web-viewer-sample/src/console/unified/workspaceCameraControls.test.tsx web-viewer-sample/src/console/unified/WorkspacePage.tsx web-viewer-sample/src/console/unified/workspaceStageTree.test.tsx
git diff --cached --check
git commit -m "feat(console): 工作台新增視角、投影與飛行控制項" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 10：完整檢查與本機真實 Chrome 驗收

**Files:**
- Modify: `docs/plans/viewer-navigation-walkthrough.md`（§7.1 勾選 1a、§9 V1–V3 結論）
- 證據：本機 `%USERPROFILE%\.codex\visualizations\<yyyy>\<mm>\<dd>\viewer-navigation-1a\`（不進 repo）

- [ ] **Step 1：跑完整的自動化檢查**

```powershell
C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider
Push-Location bim-streaming-server; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider; .\repo.bat build; Pop-Location
Push-Location bim-review-coordinator; npm test; npm run build; Pop-Location
Push-Location web-viewer-sample; npm test; npm run test:session-first; npm run typecheck; npm run build; npm run build:ui; Pop-Location
git fetch origin --prune
node --test .github/scripts/pr-safety.test.mjs
node .github/scripts/pr-safety.mjs --base (git merge-base HEAD origin/main) --head (git rev-parse HEAD)
```

Expected: root 全部通過；Kit 只允許既有的 7 項 `test_stage_loading_stage_composition.py` 失敗；其他全部通過且 exit code 0。任何新的失敗都要先分類（`PRODUCT_FAILURE`／`TEST_FAILURE`／`ENVIRONMENT_FAILURE`）再處理，不得略過。

- [ ] **Step 2：用新的建置啟動本機服務**

先確認 Task 0 啟動的服務已停止（`pwsh -NoProfile -File scripts\stop-all.ps1`），再照 Task 0 Step 1–3 重新啟動。
Expected: 與 Task 0 相同的健康檢查結果；`scripts\.run\bim-streaming-server.log` 顯示 messaging extension 載入，沒有 `camera_view` 或 `fly_navigation` 的 import 錯誤。

- [ ] **Step 3：真實 Chrome 驗收 1a**

在真實 Chrome 開啟 `http://127.0.0.1:8004/ui#a1`，建立審查並啟動 3D，依序操作並保存截圖與 Chrome DevTools 的 DataChannel／console 紀錄：

| 編號 | 操作 | 必要證據 | 通過條件 |
|---|---|---|---|
| A1 | 起始狀態 | `a1-start.png` | first frame、Stage 相符、指令通道就緒 |
| A2 | 依序按「上、前、後、左、右、等角」 | 每個視角一張截圖；每次 `cameraViewResult` 的 `direction` | 畫面方向符合；`direction` 與預設方向夾角 ≤ 0.5°；工作台顯示「相機狀態已確認」 |
| A3 | 勾「包含場地與遠處構件」後按「上」 | `a3-top-all.png` | 取景範圍比 A2 的「上」更大 |
| A4 | 工具列 ◫ 切到正交，再切回透視 | 兩張截圖；兩次回報的 `projection`、`ortho_height`、`fov_deg` | 正交時沒有透視變形，建物大小與切換前相近；切回後恢復原本的視角 |
| A5 | 飛行速度設 3，套用後按住右鍵加 W 約 1 秒；按「讀取目前相機位置」 | 前後截圖；`flyNavigationResult.speed`；讀取前後的 `position` | 速度回報 3（或 Kit 上下限夾住後的值）；`position` 明顯前進 |
| A6 | 開另一個 profile 以 spectator 觀看同一審查 | spectator 截圖 | spectator 的視角與飛行按鈕停用並說明原因 |
| A7 | 切換到另一個模型結果後回來 | 截圖 | 相機狀態顯示「尚未確認」，不沿用舊結果 |
| A8 | 切到正交後依序按「上」「等角」 | 兩張截圖；兩次回報的 `projection`、`direction`、`ortho_height` | 保持正交；方向正確；建物完整在畫面內 |
| A9 | 正交狀態下按工具列「建築主體」重置 | 截圖；工作台相機狀態 | 畫面回到開場視角；工作台相機狀態顯示「尚未確認」，◫ 不再顯示為按下 |

任何一項不通過：保存證據，分類後回報使用者，不要勾選 1a。
若 A4 正交畫面明顯過大或過小，代表 `APERTURE_UNITS_PER_WORLD_UNIT` 的換算與 Kit 110 實際行為不同：記錄實際倍率，回報後再修正 `camera_view.py` 與其測試。

- [ ] **Step 4：更新設計文件**

在 `docs/plans/viewer-navigation-walkthrough.md`：
- §7.1 僅在 Step 3 的 A1–A9（含 A6）全部通過後，才把 `- [ ] **1a 相機檢視**` 改為 `- [x] **1a 相機檢視**`，並在該行末尾加上「（2026-MM-DD 本機真實 Chrome 驗收通過）」，日期填實際驗收日。
- §9 的 V1、V2、V3 三列「何時確認」欄改為實際結論，例如「已確認：內嵌 viewer 可收到右鍵加 WASD（1a 驗收 A5）」「已確認：官方 `ViewportCameraState`；正交採修改投影屬性，倍率 …（A4）」「已確認：`/persistent/app/viewport/camMoveVelocity`（A5）」。
- 不寫入 session ID、主機名稱、截圖路徑或任何專案識別資料。

- [ ] **Step 5：Commit 並 push（不開 PR）**

```bash
git add docs/plans/viewer-navigation-walkthrough.md
git diff --cached --check
git commit -m "docs(plans): 記錄 1a 相機檢視驗收結果" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

向使用者回報：各任務 commit、實際執行的檢查與結果、真實 Chrome 驗收結論（逐項 A1–A7）、未驗證項目與風險。依使用者指示，1a–1d 全部完成前不開 PR。

---

## Self-Review

**Spec coverage（對照 `viewer-navigation-walkthrough.md`）**

| 設計要求 | 對應任務 |
|---|---|
| §1 只在統一工作台 primary viewer；spectator 唯讀 | Task 7（`canOperate`、快照條件）、Task 10 A6 |
| §5.1 `camera-state/v1` | Task 1 schema、Task 3 `camera_state_from`、Task 6 `parseCameraState` |
| §5.2 `cameraViewRequest`（preset／projection） | Task 1–4、Task 7；`apply_state` 屬 1b，不在本計畫 |
| §5.2 `cameraStateRequest` | Task 1、4、7、8、9 |
| §5.2 `flyNavigationRequest` | Task 1、2、4、7、8、9 |
| §5.2 `cameraStateSubscribe`、`levelSectionRequest`、`isolationRequest` | 屬 1c、1d，不在本計畫 |
| §4 新指令加入權限清單 | Task 1（fixture）、2（coordinator）、4（Kit）、5（瀏覽器） |
| §6 狀態與錯誤原因、逾時不假設結果 | Task 6（交換物件）、Task 8（hook）、Task 9（文字） |
| §6 換場景或失去操作權時重設 | Task 4（Kit `sync_stage(None)`）、Task 6（快照）、Task 8（`invalidateSection`） |
| §7.2 測試命令 | 各任務 Step 4、Task 10 Step 1 |
| §7.3 真實 Chrome 驗收 1a | Task 0、Task 10 Step 3 |
| §9 V1–V3 | Task 0（V1）、Task 10 A4／A5（V2、V3 實機確認；程式碼層已在計畫撰寫時查證官方原始碼） |

**計畫撰寫時已實際驗證的部分**（2026-09-17，以 base `dd1ad9b` 的暫存複本套用本計畫程式碼，未寫入 repo）

| 範圍 | 結果 |
|---|---|
| Task 1、3、4（contract 與 Kit） | 根目錄 `test_runtime_command_contracts.py` 77 passed；Kit 整套與未修改複本比較，沒有新增失敗 |
| Task 2（coordinator） | `runtimeMutationAuthority.test.ts` 34 passed；型別檢查通過；整套 2288 passed，另 3 個測試檔因暫存複本缺少 coordinator 以外的檔案而失敗（與本計畫無關） |
| Task 5–9（前端） | 全專案型別檢查通過；整套 156 個檔案、2114 passed |
| 未修改的基準（worktree） | root 1319 passed；Kit 565 passed、8 skipped、7 failed（既有 async 測試） |

**無法在撰寫時驗證、必須由執行者確認的部分**
- `KitCameraApi` 對真實 Kit 的呼叫（`TransformPrimCommand`、session layer 寫入、`viewport.resolution`）只能在 Kit runtime 驗證：`repo.bat build`（Task 4）與真實 Chrome 驗收（Task 10）。
- 正交投影的視野換算倍率（Task 10 A4）。
- 內嵌 viewer 能否收到飛行操作（Task 0 V1）。

**型別與名稱一致性**：`CameraViewInput`、`CameraState`、`CameraReply`、`FlyReply`、`CameraViewState`、`FlyState`、`ExchangeReply`、`CorrelatedRuntimeExchange`、`PendingReply` 由 Task 6 定義，Task 7–9 使用相同名稱；postMessage 型別 `camera_view`／`camera_view_result`／`camera_state`／`camera_state_result`／`fly_navigation`／`fly_navigation_result` 在 Task 7 與 Task 8 一致；Kit 事件名稱在 Task 1、4、5 一致。

## Execution Handoff

計畫存於 `docs/plans/viewer-navigation-1a-camera-plan.md`。執行方式二選一：

1. **Subagent-Driven（建議）**：每個任務派一個新的子代理執行，任務之間由我審查。
2. **Inline Execution**：在這個 session 依序執行，分批設檢查點。
