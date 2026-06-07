## ADDED Requirements

### Requirement: 統一治理控制台 SHALL 由 coordinator :8004/ui 服務 React UnifiedConsole（六 hash 路由），viewer 經凍結 /ui/open handoff 進場

依北極星 IA，瀏覽器唯一可達面 SHALL 為 coordinator `:8004/ui`，由 coordinator gated 服務 `web-viewer-sample` 的 React UnifiedConsole（`vite base=/ui/` 產出）。控制台 SHALL 提供六條 hash 路由 `#/coordinator`、`#/intake`、`#/runtime`、`#/review`、`#/kit`、`#/demo-control`（路由判定 SHALL 同時相容 `#/<key>` 與 `#<key>`，且 coordinator `/ui` pathname 預設掛 console），viewer `?session=` 進件 SHALL 仍優先（不被 console 搶掛）。服務 SHALL gated 於 `CONSOLE_DIST_DIR`：未設定或目錄無 `index.html` 時 SHALL 誠實回退既有 `dev-console.html`（zero-risk 預設，不影響既有部署），SHALL NOT 因未產出 build 而中斷 `/ui`。

`/ui/console` SHALL 精確 301 收斂至 `/ui`；`/ui/open?session=` SHALL 維持 302 凍結 handoff（逐字保留 query），且 `/ui/console` 與 `/ui/open` SHALL 於任何 `/ui` static 或 SPA fallback「之前」精確註冊，SHALL NOT 被 `/ui/*` 萬用路由吞掉（RK6）。

#### Scenario: 六 hash 路由各自渲染對應 operator 頁且 nav 可切換

- **WHEN** 真人開 `:8004/ui` 並直接導航 `#/kit`、`#/demo-control`、`#/review`、`#/intake`、`#/runtime`、`#/coordinator`
- **THEN** 每條路由 SHALL 掛載對應 operator 頁（`#/kit`→Kit proxy 面板、`#/demo-control`→真實 IFC 進件、其餘對應頁），且 nav 點擊 SHALL 更新 hash 並切換內容
- **AND** SHALL 具 browser E2E 截圖證據（`unified-console-routes` / `unified-console-nav`）

#### Scenario: /ui/console 301 與 /ui/open 凍結不被吞（RK6）

- **WHEN** 請求 `/ui/console` 與 `/ui/open?session=review_session_demo`
- **THEN** `/ui/console` SHALL 回 301 且 `Location: /ui`；`/ui/open?session=` SHALL 回 302 轉址 viewer origin，且 SHALL NOT 等於 `/ui`（未被 static / SPA fallback 吞掉）
- **AND** `/ui` SHALL 回 200 服務 console

#### Scenario: CONSOLE_DIST_DIR 未設定時誠實回退 dev-console.html

- **WHEN** `CONSOLE_DIST_DIR` 未設定或目錄無 `index.html`
- **THEN** `/ui` SHALL 服務既有 `dev-console.html`（zero-risk），SHALL NOT 報錯或空白

### Requirement: Kit 控制 SHALL 經 coordinator /api/kit/* forward-only proxy，瀏覽器禁直連 :8010

`#/kit` 模型台與所有 Kit 狀態查詢 SHALL 經 coordinator `:8004 /api/kit/*` forward-only reverse-proxy 至 kit-manager `:8010`（loopback）。瀏覽器 SHALL NOT 直連 `:8010`。Kit 控制權威 SHALL 留 kit-manager（coordinator 僅轉發，不成為 Kit 權威；守 RK1）；變更型 `/api/kit/*` 請求 SHALL 需 operator/dev 授權（無授權回 403）。

#### Scenario: forward 取得 kit-manager 資料、無直連 :8010、變更型需授權

- **WHEN** 真人於 `:8004/ui#/kit` 點「查 Kit 狀態」
- **THEN** 三個欄位 SHALL 由 coordinator `/api/kit/*` forward 回 kit-manager 並原樣顯示 HTTP 狀態，瀏覽器 SHALL NOT 對 `:8010` 發任何請求
- **AND** 變更型 `POST /api/kit/instances/current/open` 無 token SHALL 回 403、帶 dev token SHALL 被轉發（非 403）
- **AND** SHALL 具 browser E2E 證據（`kit-proxy`）

### Requirement: 真實 ./storage IFC 垂直切片 SHALL frontend-operable 且誠實 runtime，不偽造成功

`#/demo-control` SHALL 讓真人從前端選真實 `./storage/*.ifc`（清單由 `GET /api/dev/ifc-sources` 提供，回應 SHALL 為契約 shape：`source_id`/`filename`/`relative_path`/`size_bytes`/`modified_at`，SHALL NOT 洩漏絕對檔案系統路徑或 `source_ref`），按一顆按鈕觸發真實註冊與轉檔（`POST /api/dev/ifc-sources/:sourceId/register`：coordinator 內部 loopback self-fetch → 既有 `POST /api/external/ifc-ready` 真進件 → streaming-server 真轉檔派工）。runtime 狀態 SHALL 誠實顯示（`converting`/`ready`/`runtime_blocked`/`conversion_timeout`/`download_failed`），SHALL NOT 在轉檔慢 / 阻塞時偽造成功；IFC byte 取用 SHALL loopback-only（瀏覽器不可達）。畫面 SHALL 顯示完整 lineage（`source_id`/`model_version_id`/`conversion_job_id`/`artifact_id`/`usdc_url`/`mapping`），ready 後 SHALL 可經凍結 `/ui/open?session=` 進 viewer 並顯示來源 IFC lineage + USDC artifact。

#### Scenario: 從前端選真 IFC → 真轉檔派工 → 誠實 runtime + lineage

- **WHEN** 真人於 `:8004/ui#/demo-control` 選真實 `./storage/*.ifc` 並按「註冊並轉檔（真實）」
- **THEN** 下拉 SHALL 由真 coordinator `GET /api/dev/ifc-sources` 填出真實 `./storage *.ifc`（無絕對路徑），register 後 SHALL 出現真實 `download_status=downloaded` + streaming `conversion_job_id`（`stream_conv_*`）+ lineage 欄位
- **AND** runtime 狀態 SHALL 落在誠實值（`converting`/`ready`/`runtime_blocked`/`conversion_timeout`/`conversion_failed`），畫面 SHALL NOT 顯示絕對檔案系統路徑或 public ifc-file byte URL
- **AND** SHALL 具 browser E2E 證據（`real-ifc-storage-intake`；轉檔 ready 後 `real-ifc-conversion-lineage` / `real-ifc-viewer-lineage` 佐證真 `model.usdc` + `element_mapping.json` + `artifact_id`）

### Requirement: primary / spectator 角色權威 SHALL 三層縱深，Stage/Artifact Binding SHALL 交易式套用

控制台 SHALL 以三層縱深落實 primary/spectator 角色權威：(1) UI `disabled` + `aria-disabled` + 誠實 readonly banner；(2) 前端 command 層 spectator SHALL NOT 送 mutating 指令；(3) 後端 coordinator `POST /api/review-sessions/:id/stage-binding` SHALL 以 `source_client_id`/primary 判定授權（非 UI-only gate）。Stage/Artifact Binding SHALL 交易式：選 1..N 個 ready USDC → 指定唯一 primary → 設 load_order → `composeStageRequest`，SHALL 等 Kit `bindingApplied` 確認才宣告 applied 並保留 last-good revision，SHALL NOT 在送出當下偽宣告成功。

#### Scenario: spectator 唯讀且不送 mutating；primary binding 交易式套用

- **WHEN** spectator 開啟 viewer overlay、primary 套用 Stage/Artifact Binding
- **THEN** spectator SHALL 見控制為 `disabled` + `aria-disabled` + 誠實 banner 且 SHALL NOT 送出 mutating；primary 套用後 SHALL 於 Kit `bindingApplied` 確認後出現 active binding revision
- **AND** SHALL 具 browser E2E 證據（`primary-spectator-authority`、`stage-artifact-binding`）
