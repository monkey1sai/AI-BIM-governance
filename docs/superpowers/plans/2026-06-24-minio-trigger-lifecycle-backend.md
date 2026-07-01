# MinIO 手動觸發 + 轉檔 lifecycle 可觀測性（後端地基）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `bim-review-coordinator` 補齊 A1 重構（排序 B）所需的後端地基：修掉 presigned 簽章外洩（P0）、新增單一權威 `conversion_lifecycle_status`、把 `project_display_name`/`category` 落 store 並對外曝光、新增 `POST /api/conversion/trigger {key}` 手動觸發端點。

**Architecture:** 全部 additive，既有 28 欄 `IfcReadyIntakeJob` 與既有 `summarizeIfcReadyJob` 輸出零回退。lifecycle 重用既有 `ConversionLedgerStatus` 型別（禁另宣告）。trigger 端點比照既有 `POST /api/dev/ifc-sources/:id/register` 的「server-side presign + loopback self-POST `/api/external/ifc-ready`」模式，重用 `minioWatcher` 純函式。

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import 後綴), Express, vitest + supertest, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`。

## Global Constraints

- 相依規格：`docs/superpowers/specs/2026-06-24-ifc-ready-api-field-redesign-design.md`（PR #257）。本計畫實作其中 A1 所需的子集 + P0。
- **誠實鐵律**：presigned 簽章 / secret 絕不入對外 response 與 log；轉檔未完成禁出現 `ready`；缺值用明確 `null`，不塞假字串。
- **OQ1 已裁決**：`project_display_name`/`category` 直接寫入 `externalIfcReadyStore`（additive nullable），不採 ledger-join。
- **lifecycle 型別單一來源**：`conversion_lifecycle_status` 一律用 `import type { ConversionLedgerStatus }`，禁在 job 端另宣告同名 enum。
- ESM import 一律帶 `.js` 後綴（NodeNext）。
- 既有 `summarizeIfcReadyJob` 26 欄輸出逐字保留，新欄位 additive append。
- 驗證：`npm run verify`（= `npm run build && npm test`，即 `tsc -p tsconfig.json` + `vitest run`），於 `bim-review-coordinator/` 執行。
- 提交前跑 `git diff --cached --check`（trailing whitespace）。
- 每個 commit 訊息結尾兩行 footer：
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 與 `Claude-Session: https://claude.ai/code/session_01RbVD4qzSmRy7VBrSy8stZ6`。

---

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `src/services/presignedRef.ts` | `maskPresignedRef()` 純函式：剝除 presigned 簽章 query | 建立 |
| `src/services/lifecycleStatus.ts` | `deriveLifecycleStatus(job)` 純函式：job → `ConversionLedgerStatus` | 建立 |
| `src/services/minioClient.ts` | 加 `presignMinioObject()`（reuse `createMinioS3Client`+`getSignedUrl`） | 修改 |
| `src/types.ts` | `IfcReadyIntakeJob` 加 `project_display_name`/`category` | 修改 |
| `src/services/externalIfcReadyStore.ts` | `create()` 擷取 event 兩欄入 job | 修改 |
| `src/app.ts` | summarize 遮蔽 ref + 加 lifecycle/兩溯源欄；session response 遮蔽 ref；新增 trigger 端點 | 修改 |
| `tests/presigned-ref.test.ts` | maskPresignedRef 單元 + 誠實守衛 | 建立 |
| `tests/lifecycle-status.test.ts` | deriveLifecycleStatus 映射表單元 | 建立 |
| `tests/conversion-trigger.test.ts` | trigger 端點（驗證/冪等/守門，presign 以 vi.mock 假打） | 建立 |

---

## Task 1: P0 — presigned 簽章遮蔽（對外出口）

修掉現役安全/誠實違規：`summarizeIfcReadyJob`(app.ts:2357) 與 local-web-view session response(app.ts:1848) 對外原樣吐含 `X-Amz-Signature` 的 1 小時 presigned URL。新增純函式遮蔽，套用於兩個**瀏覽器可見**出口，並加誠實守衛測試。callback outbox(app.ts:1575) 屬機器對雲端、是否需要 presigned 由下游決定，**本計畫不動 1575**（見 §開放問題）；行 1309 僅 `Boolean(ref)` 不洩漏，不動。

**Files:**
- Create: `src/services/presignedRef.ts`
- Create: `tests/presigned-ref.test.ts`
- Modify: `src/app.ts:2357`（summarize）、`src/app.ts:1848`（session）

**Interfaces:**
- Produces: `maskPresignedRef(ref: string): string` — 給 Task 後續與 summarize 使用。

- [ ] **Step 1: 寫 maskPresignedRef 失敗測試**

建立 `tests/presigned-ref.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { maskPresignedRef } from "../src/services/presignedRef.js";

describe("maskPresignedRef", () => {
  it("剝除 presigned 簽章 query，只留物件位址", () => {
    const ref =
      "http://192.168.20.234:9000/bim-control/proj/main/uuid/model.ifc" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc&X-Amz-Date=20260624T000000Z" +
      "&X-Amz-Expires=3600&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host";
    expect(maskPresignedRef(ref)).toBe(
      "http://192.168.20.234:9000/bim-control/proj/main/uuid/model.ifc",
    );
  });

  it("非 presigned URL 原樣返回", () => {
    expect(maskPresignedRef("http://127.0.0.1:8004/api/dev/ifc-file/model.ifc")).toBe(
      "http://127.0.0.1:8004/api/dev/ifc-file/model.ifc",
    );
  });

  it("非 URL（etag 風格）原樣返回", () => {
    expect(maskPresignedRef("devstorage:model.ifc")).toBe("devstorage:model.ifc");
  });

  it("空字串原樣返回", () => {
    expect(maskPresignedRef("")).toBe("");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/presigned-ref.test.ts`
Expected: FAIL（`Cannot find module '../src/services/presignedRef.js'`）

- [ ] **Step 3: 實作 maskPresignedRef**

建立 `src/services/presignedRef.ts`：

```typescript
// 遮蔽 presigned URL 的簽章 query（X-Amz-*）。只留 origin+pathname，簽章/憑證/過期不外洩。
// 誠實鐵律：對外 response 不得含 presigned 簽章。非 URL 或無簽章參數者原樣返回。
export function maskPresignedRef(ref: string): string {
  if (!ref) return ref;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return ref; // 非 URL（如 devstorage:filename）原樣
  }
  let hasSignature = false;
  for (const k of url.searchParams.keys()) {
    if (k.toLowerCase().startsWith("x-amz-")) {
      hasSignature = true;
      break;
    }
  }
  if (!hasSignature) return ref;
  return `${url.origin}${url.pathname}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/presigned-ref.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: 套用於 summarize 出口（app.ts:2357）**

先在 `src/app.ts` 既有 `./services/*.js` import 群組加入此行（reviewer major：給精確錨點以免 ESLint import-order 報錯）。錨點：緊接在既有
`import { createMinioS3Client, listMinioObjects } from "./services/minioClient.js";`（app.ts:25）**之後**新增一行。`presignedRef` 與 `minioClient` 同屬 `./services/` 群組，置於其後不破壞 import 群組順序：

```typescript
import { maskPresignedRef } from "./services/presignedRef.js";
```

> 註：若 repo 啟用了 import 排序 lint 規則，依其字母序自動修正 import 群組內次序即可（`maskPresignedRef`/`presignedRef.js` 與群組內既有 `minioClient.js`/`minioWatcher.js` 同層級）；本步只要求落在 `./services/*.js` 群組內、非散在他處。

把 `summarizeIfcReadyJob` 內（約行 2357）：

```typescript
    source_ifc_ref: job.source_ifc_ref,
```

改為：

```typescript
    source_ifc_ref: maskPresignedRef(job.source_ifc_ref),
```

- [ ] **Step 6: 套用於 local-web-view session 出口（app.ts:1848）**

把 `artifact_resolution` 內（約行 1848）：

```typescript
    source_ifc_ref: job.source_ifc_ref,
```

改為：

```typescript
    source_ifc_ref: maskPresignedRef(job.source_ifc_ref),
```

- [ ] **Step 7: 加誠實守衛整合測試（GET 回應不含簽章）**

在 `tests/presigned-ref.test.ts` 末尾追加。

> **teardown 與既有測試對齊（reviewer blocker / major 修正）**：
> 既有整合測試（`tests/external-ifc-ready.test.ts:30-43`、`tests/minio-watch-status-route.test.ts:10-17`、`tests/conversion-ledger-intake-integration.test.ts:32-36`）的 `afterEach` 一律走三步
> `await active.dispose(); active.io.close(); await new Promise(r => active?.server.close(() => r()))`。
> 缺 `io.close()` 會讓 Socket.IO keep-alive 連線阻止 `server.close` callback 觸發 → vitest 報 open handles / 逾時。
> `CoordinatorApp.dispose` 在介面（app.ts:291）是 `() => Promise<void>` **必要方法（非 optional）**，故**不可**用 `active.dispose?.()` 的可選鏈（多餘且在 strict 下無意義）；一律 `await active.dispose()`。
> import 次序：本檔上半段是純單元測試（只 import `vitest` + `maskPresignedRef`），此 Step 把整合測試所需的 `request`/`fs`/`os`/`path`/`createCoordinatorApp`/`afterEach` import **補到檔首既有 import 區**（與上半段 import 並列），不要在檔案中段重複 import。本檔不使用 `vi.mock`，無 forwardRef hoisting 限制。

```typescript
// ↓ 補到 tests/presigned-ref.test.ts 檔首既有 import 區（與 vitest / maskPresignedRef import 並列）
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (!active) return;
  // 三步 teardown，與既有整合測試一致：dispose 先收斂 watcher/timer，再 io.close，最後 server.close。
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

describe("誠實守衛：對外 ifc-ready response 不含 presigned 簽章", () => {
  it("GET /api/external/ifc-ready 列表 body 不含 X-Amz-Signature", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-presign-test-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
    });
    const res = await request(active.app).get("/api/external/ifc-ready");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });
});
```

> 註：此測試在空 store 下即驗「列表端點不外洩簽章」的結構保證；後續 Task 4 的 trigger 整合測試會在有真 job 時再覆蓋一次。此測試本身不啟 watcher（無 `minioWatch*` config）、不 `server.listen()`，`request(active.app)` 走 in-process 路由即可，故 GET 路徑無 self-POST 依賴。

- [ ] **Step 8: 跑全測試確認通過**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build 成功 + 全測試 PASS（含新 5 個 presigned 測試）

- [ ] **Step 9: Commit**

```bash
git add src/services/presignedRef.ts tests/presigned-ref.test.ts src/app.ts
git commit -m "$(cat <<'EOF'
fix(coordinator): 遮蔽對外 ifc-ready response 的 presigned 簽章（P0）

summarizeIfcReadyJob 與 local-web-view session response 原樣吐含 X-Amz-Signature
的 1 小時 presigned URL（洩漏短效憑證）。新增 maskPresignedRef 純函式剝除簽章
query，套用於兩個瀏覽器可見出口，加誠實守衛測試。callback outbox(1575) 不動。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RbVD4qzSmRy7VBrSy8stZ6
EOF
)"
```

---

## Task 2: `conversion_lifecycle_status` 單一權威狀態

新增 `deriveLifecycleStatus(job)` 純函式（凍結映射表，重用 `ConversionLedgerStatus`），在 `summarizeIfcReadyJob` additive 曝光 `conversion_lifecycle_status`。

**Files:**
- Create: `src/services/lifecycleStatus.ts`
- Create: `tests/lifecycle-status.test.ts`
- Modify: `src/app.ts`（summarize 加欄 + import）

**Interfaces:**
- Consumes: `ConversionLedgerStatus`（`./conversionLedger.js`）、`IfcReadyIntakeJob`（`../types.js`）
- Produces: `deriveLifecycleStatus(job: IfcReadyIntakeJob): ConversionLedgerStatus`

**凍結映射表**（IfcReadyIntakeStatus + download_status + conversion_status → lifecycle）：

| 條件（由上至下短路） | lifecycle |
|---|---|
| `status` ∈ {failed, dispatch_failed, dropped_on_restart} 或 `download_status==="failed"` | `failed` |
| `conversion_status==="ready"` | `ready` |
| `status==="dispatched"` | `converting` |
| `status==="queued_for_conversion"` | `queued` |
| 其餘（accepted / downloading / downloaded 未派工） | `detected` |

- [ ] **Step 1: 寫 deriveLifecycleStatus 失敗測試**

> **任務間 types.ts 互依（reviewer major 釐清）**：本 helper 以 `... } as IfcReadyIntakeJob` **斷言**建構，故 base object 不必列齊 `IfcReadyIntakeJob` 全部欄位——缺的（含 Task 3 才加的 `project_display_name`/`category`、以及既有 optional `download_status?`）在 `as` 斷言下不會 TS 報錯。`download_status` 在 types.ts:210 本就是 optional（`download_status?: ... | null`），故各測試以 `overrides` 帶 `download_status: "failed"` 合法。**任務執行順序 Task 2 → Task 3** 對本 helper 無影響：Task 3 對 `IfcReadyIntakeJob` 的新增欄位皆為 optional nullable（`?: string | null`），不會讓既有 `as` 斷言失效。**若**未來把欄位改成 required（本 plan 不做），才需回頭補 base object。

建立 `tests/lifecycle-status.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { deriveLifecycleStatus } from "../src/services/lifecycleStatus.js";
import type { IfcReadyIntakeJob } from "../src/types.js";

function job(overrides: Partial<IfcReadyIntakeJob>): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "j1",
    status: "accepted",
    idempotent_replay: false,
    correlation_id: "c1",
    idempotency_key: "k1",
    tenant_id: "t1",
    project_id: "p1",
    external_model_version_id: "v1",
    source_ifc_ref: "ref",
    source_ifc_etag: "etag",
    conversion_job_id: null,
    conversion_status: null,
    conversion_authority: null,
    created_at: "2026-06-24T00:00:00.000Z",
    updated_at: "2026-06-24T00:00:00.000Z",
    ...overrides,
  } as IfcReadyIntakeJob;
}

describe("deriveLifecycleStatus 凍結映射", () => {
  it("accepted → detected", () => {
    expect(deriveLifecycleStatus(job({ status: "accepted" }))).toBe("detected");
  });
  it("queued_for_conversion → queued", () => {
    expect(deriveLifecycleStatus(job({ status: "queued_for_conversion" }))).toBe("queued");
  });
  it("dispatched → converting", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatched" }))).toBe("converting");
  });
  it("dispatched + conversion_status=ready → ready", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatched", conversion_status: "ready" }))).toBe("ready");
  });
  it("failed → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "failed" }))).toBe("failed");
  });
  it("dispatch_failed → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "dispatch_failed" }))).toBe("failed");
  });
  it("dropped_on_restart → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "dropped_on_restart" }))).toBe("failed");
  });
  it("download_status=failed 壓過 accepted → failed", () => {
    expect(deriveLifecycleStatus(job({ status: "accepted", download_status: "failed" }))).toBe("failed");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/lifecycle-status.test.ts`
Expected: FAIL（`Cannot find module '../src/services/lifecycleStatus.js'`）

- [ ] **Step 3: 實作 deriveLifecycleStatus**

建立 `src/services/lifecycleStatus.ts`：

```typescript
import type { ConversionLedgerStatus } from "./conversionLedger.js";
import type { IfcReadyIntakeJob } from "../types.js";

// 單一權威：intake 狀態 → 轉檔生命週期狀態。重用 ConversionLedgerStatus（禁另宣告 enum）。
// 凍結映射（由上至下短路），詳見 plan §Task 2。誠實：converter 落地前不會出現 ready。
export function deriveLifecycleStatus(job: IfcReadyIntakeJob): ConversionLedgerStatus {
  if (
    job.status === "failed" ||
    job.status === "dispatch_failed" ||
    job.status === "dropped_on_restart" ||
    job.download_status === "failed"
  ) {
    return "failed";
  }
  if (job.conversion_status === "ready") return "ready";
  if (job.status === "dispatched") return "converting";
  if (job.status === "queued_for_conversion") return "queued";
  return "detected";
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/lifecycle-status.test.ts`
Expected: PASS（8 passed）

- [ ] **Step 5: summarize 加 conversion_lifecycle_status 欄位**

在 `src/app.ts` import 區加入：

```typescript
import { deriveLifecycleStatus } from "./services/lifecycleStatus.js";
```

在 `summarizeIfcReadyJob` return 物件，於 `conversion_status: job.conversion_status,`（約行 2364）之後 additive 插入：

```typescript
    conversion_lifecycle_status: deriveLifecycleStatus(job),
```

- [ ] **Step 6: 跑全測試確認通過（既有 26 欄 + 新欄並存）**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build 成功 + 全測試 PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/lifecycleStatus.ts tests/lifecycle-status.test.ts src/app.ts
git commit -m "$(cat <<'EOF'
feat(coordinator): 新增 conversion_lifecycle_status 單一權威狀態

deriveLifecycleStatus 純函式（凍結映射，重用 ConversionLedgerStatus），於
summarizeIfcReadyJob additive 曝光 conversion_lifecycle_status。既有 26 欄零回退。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RbVD4qzSmRy7VBrSy8stZ6
EOF
)"
```

---

## Task 3: OQ1 — `project_display_name`/`category` 落 store + 曝光

`ExternalIfcReadyEvent` 帶 `project_display_name`/`model_category`，但 `externalIfcReadyStore.create()` 未存入 job → 對外不可見。依 OQ1 裁決直接落 store，並於 summarize 曝光（對外命名 `category`）。

**Files:**
- Modify: `src/types.ts`（`IfcReadyIntakeJob` 加兩欄）
- Modify: `src/services/externalIfcReadyStore.ts`（`create()` 擷取兩欄）
- Modify: `src/app.ts`（summarize 加兩欄）
- Modify: `tests/external-ifc-ready.test.ts`（斷言曝光）

**Interfaces:**
- Produces: `IfcReadyIntakeJob.project_display_name?: string | null`、`IfcReadyIntakeJob.category?: string | null`

- [ ] **Step 1: 寫整合失敗測試（intake 帶兩欄 → GET 可見）**

在 `tests/external-ifc-ready.test.ts` **末尾新增一個 `describe`**（reviewer major：明確「複用該檔既有設施、不另立」）。該檔已具備：
- module-level `let active` + `afterEach`（lines 30-43，三步 `dispose → io.close → server.close`）→ **此測試不要再宣告 `active`/`afterEach`**，呼叫既有 `makeApp(...)` 即由既有 `afterEach` 收尾；
- `makeApp(overrides: Partial<CoordinatorConfig> = {})`（line 46，spread overrides，可吃 `externalIntakeWebhookSecret`/`externalIntakeIpAllowlist`）；
- `WEBHOOK_SECRET` 常數 + `authHeaders()`（line 65）+ `payload()`（line 60，由 `CONTRACT.example` 衍生）。
  沿用 `authHeaders()`/`WEBHOOK_SECRET`，避免硬寫 `"test-secret"` 與該檔常數漂移：

```typescript
describe("OQ1：project_display_name / category 對外曝光", () => {
  it("intake 帶 project_display_name + model_category → GET 列表可見 category/project_display_name", async () => {
    // 複用既有 makeApp（預設已帶 streamingConversionApiBase 不可達 → dispatch graceful）。
    // 預設 config 的 webhook secret 即 WEBHOOK_SECRET（該檔既有測試已依賴），故沿用 authHeaders()。
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_oq1", "X-Idempotency-Key": "idem_oq1" }))
      .send({
        ...payload(),
        project_id: "p_safe",
        project_display_name: "許良宇圖書館",
        model_category: "main",
        external_model_version_id: "v2026",
      });
    // download/dispatch 不可達為 graceful（job 仍建、欄位已存）；只取 job id，不假設特定 status。
    const jobId = res.body.ifc_ready_job_id as string;
    expect(jobId).toBeTruthy();
    const list = await request(app.app).get("/api/external/ifc-ready");
    const item = (list.body.items as Array<Record<string, unknown>>).find(
      (j) => j.ifc_ready_job_id === jobId,
    );
    expect(item?.project_display_name).toBe("許良宇圖書館");
    expect(item?.category).toBe("main");
  });
});
```

> 註：`payload()` 由契約 `CONTRACT.example` 衍生，已含合法 `source_ifc`/`tenant_id` 等必填欄位；此處只 override 要驗的四欄（`project_id`/`project_display_name`/`model_category`/`external_model_version_id`）。`source_ifc.ref` 沿用契約範例值即可（OQ1 驗的是兩欄落庫，不依賴 ref 可下載）。若契約範例未含 `model_category`/`project_display_name`，spread override 會補上。GET 列表回傳鍵名（`items` vs 其他）以該檔既有列表測試（約 line 283）實際斷言為準。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts -t OQ1`
Expected: FAIL（`item.project_display_name` 為 undefined）

- [ ] **Step 3: types.ts 加兩欄**

在 `src/types.ts` 的 `IfcReadyIntakeJob` 介面，於 `project_id: string;` 之後加：

```typescript
  project_display_name?: string | null;
  category?: string | null;
```

- [ ] **Step 4: store.create() 擷取兩欄**

在 `src/services/externalIfcReadyStore.ts` 的 `create()` 內，建構 job 物件處（與 `project_id`、`external_model_version_id` 同段），additive 加：

```typescript
      project_display_name: event.project_display_name ?? null,
      category: event.model_category ?? null,
```

- [ ] **Step 5: summarize 曝光兩欄**

在 `src/app.ts` 的 `summarizeIfcReadyJob` return 物件，於 `project_id: job.project_id,` 之後 additive 插入：

```typescript
    project_display_name: job.project_display_name ?? null,
    category: job.category ?? null,
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts -t OQ1`
Expected: PASS

- [ ] **Step 7: 跑全測試**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build 成功 + 全測試 PASS

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/services/externalIfcReadyStore.ts src/app.ts tests/external-ifc-ready.test.ts
git commit -m "$(cat <<'EOF'
feat(coordinator): project_display_name/category 落 store 並對外曝光（OQ1）

依 OQ1 裁決放寬 key-structure R5：externalIfcReadyStore.create 擷取 event 的
project_display_name/model_category 入 job，summarizeIfcReadyJob 對外以 category
曝光。修溯源斷鏈（#conv 不再只剩 mv_<hash8>）。additive nullable。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RbVD4qzSmRy7VBrSy8stZ6
EOF
)"
```

---

## Task 4: `POST /api/conversion/trigger {key}` 手動觸發端點

前端只送 MinIO object `key`，coordinator server-side 驗證（≥3 段）+ presign + 重用 watcher intake 邏輯 self-POST `/api/external/ifc-ready`。冪等鍵 `mw_<hash16>`，同 key 回既有 job。守門比照既有 `/api/conversion/*` 控制路由（`rejectIfIpNotAllowed`）。

**Files:**
- Modify: `src/services/minioClient.ts`（加 `presignMinioObject()`）
- Modify: `src/app.ts`（新增端點，置於既有 `/api/conversion/*` 路由附近）
- Create: `tests/conversion-trigger.test.ts`

**Interfaces:**
- Consumes: `deriveIntakeFromKey`、`idempotencyKeyFor`、`correlationIdFor`（`./services/minioWatcher.js`）、`createMinioS3Client`（`./services/minioClient.js`）、`maskPresignedRef`（Task 1）
- Produces: `presignMinioObject(cfg, bucket, key): Promise<string>`

- [ ] **Step 1: 寫 presignMinioObject 不動測試骨架 + trigger 驗證失敗測試**

建立 `tests/conversion-trigger.test.ts`（presign 以 `vi.mock` 假打，避免依賴真 MinIO）。

> **reviewer blocker / major：self-POST 必須打得通，否則「合法 key → 202」永遠失敗。**
> 端點 self-POST `/api/external/ifc-ready`（見 Step 4，走 `config.minioWatchSelfBaseUrl || http://127.0.0.1:${config.port}`）。
> supertest `request(app.app)` 只在 process 內路由、**不啟 HTTP listener**；若不 `server.listen()`，self-POST 的 `fetch` 會 ECONNREFUSED → 端點回 502，合法 key 拿不到 202。
> 因此 `makeApp` 必須照既有 `tests/minio-watch-intake-integration.test.ts:58-119` 的權威模式：
> 1. `await server.listen(0, "127.0.0.1")` 取得真實 bound port；
> 2. 把該 port 以 `config.minioWatchSelfBaseUrl = http://127.0.0.1:<port>` 注入（端點 self-POST 即打到自己這支真 listener）；
> 3. 因為要先建 app 再 listen 再注入 selfBaseUrl，`makeApp` 改為 **async**，呼叫處 `await makeApp()`。
> 並用三步 teardown（`dispose → io.close → server.close`，對齊既有測試）；`dispose` 非 optional，不用 `?.`。
>
> 注意 `minioWatchSelfBaseUrl` 有值會觸發 app.ts:418「立即啟動 watcher」路徑；為避免測試窗內 watcher 自動 tick 干擾，`makeApp` 同時設 `minioWatchEnabled: false`（watcher runtime 關閉，但 selfBaseUrl seam 仍供 trigger 端點 self-POST 使用——seam 是讀值，不依賴 watcher 是否啟動）。

```typescript
import request from "supertest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// 假打 presign：trigger 端點呼叫 presignMinioObject 時回固定 URL，不連真 MinIO。
vi.mock("../src/services/minioClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/minioClient.js")>();
  return {
    ...actual,
    presignMinioObject: vi.fn().mockResolvedValue(
      "http://minio.test:9000/bim-control/proj/main/uuid/model.ifc?X-Amz-Signature=fake",
    ),
  };
});

import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (!active) return;
  // 三步 teardown，與既有整合測試一致（dispose 非 optional）。
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("server bind failed");
  return a.port;
}

// async：先建 app → listen(0) 取真實 port → 以 minioWatchSelfBaseUrl 注入該 port，
// 讓 trigger 端點 self-POST /api/external/ifc-ready 打到自己這支真 listener（否則 502）。
async function makeApp(): Promise<CoordinatorApp> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-trigger-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    externalIntakeWebhookSecret: "test-secret",
    externalIntakeIpAllowlist: [],
    minioWatchEnabled: false, // watcher runtime 關閉，避免自動 tick；selfBaseUrl seam 仍可被 trigger 端點讀用。
    minioWatchEndpoint: "http://minio.test:9000",
    minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak",
    minioWatchSecretKey: "sk",
    minioWatchPrefix: "",
    minioWatchKeySuffix: "/model.ifc",
    minioWatchTenantId: "tenant_demo_001",
  });
  const port = await listenOnRandomPort(active.server);
  // 注入真實 port 給 self-POST loopback（端點讀 config.minioWatchSelfBaseUrl）。
  active.config.minioWatchSelfBaseUrl = `http://127.0.0.1:${port}`;
  return active;
}

describe("POST /api/conversion/trigger", () => {
  it("malformed key（少於三段）→ 400", async () => {
    const app = await makeApp();
    const res = await request(app.app).post("/api/conversion/trigger").send({ key: "a/model.ifc" });
    expect(res.status).toBe(400);
  });

  it("缺 key → 400", async () => {
    const app = await makeApp();
    const res = await request(app.app).post("/api/conversion/trigger").send({});
    expect(res.status).toBe(400);
  });

  it("合法 key → 202 + ifc_ready_job_id，且 response 不含 presigned 簽章", async () => {
    const app = await makeApp();
    const res = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "proj/main/uuid/model.ifc" });
    expect([200, 202]).toContain(res.status);
    expect(res.body.ifc_ready_job_id).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });
});
```

> **selfBaseUrl 注入時機說明**：`config.minioWatchSelfBaseUrl` 是 `CoordinatorConfig` 欄位（config.ts:101）、`createCoordinatorApp` 回傳的 `active.config` 是同一個 config 物件。trigger 端點在**請求時**才讀 `config.minioWatchSelfBaseUrl`，故在 `listen` 之後、發請求之前 mutate `active.config.minioWatchSelfBaseUrl` 即可生效（不需在 createCoordinatorApp 當下就帶 selfBaseUrl，反而可避開 app.ts:418 立即啟 watcher 的路徑）。若實作者偏好 immutable config，可改為在 createCoordinatorApp 傳入 `minioWatchSelfBaseUrl: "http://127.0.0.1:0"` 佔位後仍 listen(0) 再 mutate；二擇一即可，重點是端點 self-POST 的 base 指向實際 listen 的 port。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-trigger.test.ts`
Expected: FAIL（`presignMinioObject` 不存在於 mock 的 importOriginal，或端點 404）

- [ ] **Step 3: 實作 presignMinioObject**

此步分兩處改動（reviewer major：原文「在末尾加（import 區補…）」把「檔末加函式」與「檔首補 import」兩個不同位置混在一句，拆清楚）。

**(3a) 檔首 import 區**：`minioClient.ts` 現有 import 只有
`import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";`（line 4）與
`import { deriveIntakeFromKey } from "./minioWatcher.js";`（line 5）。
把 `GetObjectCommand` **併入既有 `@aws-sdk/client-s3` 那一行**（改成 `import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";`），並在其下**新增**一行 presigner import：

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
```

> `@aws-sdk/s3-request-presigner` 已在 plan Tech Stack 列為相依；若 `package.json` 尚未列入須先 `npm i`（與 plan §Tech Stack 一致，非新增非預期依賴）。

**(3b) 檔案末尾**：在 `minioClient.ts` 既有 export 函式**之後**追加 `presignMinioObject`（複用同檔 `createMinioS3Client`）：

```typescript
// server-side 生成 presigned GET URL（簽章只活在後端，不外洩瀏覽器）。
export async function presignMinioObject(
  cfg: { endpoint: string; accessKey: string; secretKey: string },
  bucket: string,
  key: string,
): Promise<string> {
  const client = createMinioS3Client(cfg);
  try {
    return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 3600,
    });
  } finally {
    client.destroy();
  }
}
```

- [ ] **Step 4: 實作 trigger 端點**

在 `src/app.ts` import 區補：

```typescript
import { presignMinioObject } from "./services/minioClient.js";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "./services/minioWatcher.js";
```

> 註：`createMinioS3Client`/`listMinioObjects` 既有 import 保留；`deriveIntakeFromKey` 等若已 import 則勿重複。

在既有 `PUT /api/conversion/watch`（約行 783）路由「之後、`/api/external/ifc-ready/:jobId` param 路由之前」附近，加入：

```typescript
  // A1 手動觸發：前端只送 MinIO object key，coordinator server-side presign + 重用 watcher
  // intake 邏輯 self-POST /api/external/ifc-ready。冪等鍵 mw_<hash16>，同 key 回既有 job。
  // 守門比照其他 /api/conversion/* 控制路由（rejectIfIpNotAllowed）。
  app.post("/api/conversion/trigger", async (request, response) => {
    if (rejectIfIpNotAllowed(request, response)) return;
    if (!config.minioWatchEndpoint || !config.minioWatchBucket) {
      response.status(503).json({ detail: "MinIO 未設定（endpoint/bucket 缺）" });
      return;
    }
    const key = typeof request.body?.key === "string" ? request.body.key : "";
    if (!key) {
      response.status(400).json({ detail: "缺 key" });
      return;
    }
    const derived = deriveIntakeFromKey({
      key,
      prefix: config.minioWatchPrefix,
      keySuffix: config.minioWatchKeySuffix,
    });
    if (!derived.ok) {
      response.status(400).json({ detail: `key 不合法：${derived.reason}` });
      return;
    }
    let presignedRef: string;
    try {
      presignedRef = await presignMinioObject(
        {
          endpoint: config.minioWatchEndpoint,
          accessKey: config.minioWatchAccessKey,
          secretKey: config.minioWatchSecretKey,
        },
        config.minioWatchBucket,
        key,
      );
    } catch (err) {
      response.status(502).json({ detail: `presign 失敗：${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    // etag 在手動觸發無法事先取得，用 key 當穩定 idempotency 來源（同 key 重觸發回既有 job）。
    const idemKey = idempotencyKeyFor(config.minioWatchBucket, key, key);
    const corrId = correlationIdFor(config.minioWatchBucket, key, key);
    // self-POST loopback：複用既有 watcher seam config.minioWatchSelfBaseUrl（config.ts:101、
    // app.ts:399 同一條），有值時優先（測試以 listen(0) 的真實 port 注入）；fallback 才用
    // config.port（production 預設 8004，process 已 listen 該 port）。
    // ⚠ reviewer blocker：supertest 整合測試 request(app.app) 不呼叫 server.listen()，
    // 若硬編 http://127.0.0.1:${config.port}（預設 8004，無人 listen）→ fetch ECONNREFUSED → 502，
    // 合法 key 永遠拿不到 202。故端點必須讀 selfBaseUrl seam，測試端 makeApp 須 listen(0)+注入。
    const selfBase = config.minioWatchSelfBaseUrl || `http://127.0.0.1:${config.port}`;
    try {
      const upstream = await fetch(`${selfBase}/api/external/ifc-ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": config.externalIntakeWebhookSecret,
          "X-Correlation-Id": corrId,
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          event: "ifc_ready",
          tenant_id: config.minioWatchTenantId,
          project_id: derived.projectId,
          project_display_name: derived.projectDisplayName,
          model_category: derived.category,
          external_model_version_id: derived.externalModelVersionId,
          external_conversion_task_id: `${derived.externalModelVersionId}_manual`,
          source_ifc: { ref: presignedRef, etag: key, filename: "model.ifc", format: "ifc" },
          requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
        }),
      });
      const text = await upstream.text();
      const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      // 誠實：回應不夾帶 presigned ref（即使上游回了也遮蔽；source_ifc_ref 由上游 summarize 已遮蔽）
      response.status(upstream.status).json({ ...parsed, trigger_source: "manual" });
    } catch (err) {
      response.status(502).json({ detail: `trigger 失敗：${err instanceof Error ? err.message : String(err)}` });
    }
  });
```

> 註：`rejectIfIpNotAllowed`、`config.minioWatch*`（含 `config.minioWatchSelfBaseUrl`，config.ts:101）、`config.externalIntakeWebhookSecret`、`config.port` 均為既有 config 欄位；若 `request.body` 未經 json middleware，確認 app 已掛 `express.json()`（既有 intake 路由已依賴，故已掛）。既有 dev `register` 端點（app.ts:1989）同樣 self-POST，但它硬編 `config.port` 且**無 supertest 覆蓋**故從未在 in-process 測試被驗；本端點因有測試覆蓋，必須走 `minioWatchSelfBaseUrl` seam。

- [ ] **Step 5: 跑 trigger 測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-trigger.test.ts`
Expected: PASS（3 passed）

> 若 `idempotencyKeyFor(bucket, key, key)` 因 key 含 `|` 觸發 precondition，改用 `idempotencyKeyFor(bucket, key, "manual")` 並同步調整 test 期望；MinIO 規約 key 不含 `|`，正常情況不會發生。

- [ ] **Step 6: 跑全測試**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build 成功 + 全測試 PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/minioClient.ts src/app.ts tests/conversion-trigger.test.ts
git commit -m "$(cat <<'EOF'
feat(coordinator): 新增 POST /api/conversion/trigger 手動觸發端點

前端只送 MinIO object key，coordinator server-side presign（簽章不外洩）+ 重用
watcher deriveIntakeFromKey/idempotencyKeyFor 邏輯 self-POST /api/external/ifc-ready。
冪等鍵 mw_<hash16>，同 key 回既有 job。守門比照 /api/conversion/* 控制路由。
= folderview spec R-TRIGGER-ENDPOINT，A1「排入轉檔排程」按鈕的後端。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RbVD4qzSmRy7VBrSy8stZ6
EOF
)"
```

---

## Self-Review（對照規格）

- **P0 全出口遮蔽**（spec §8.1 #1）：Task 1 覆蓋 2357/1848 兩個瀏覽器出口 + 守衛測試；1309 是 Boolean 安全；1575 callback 列入開放問題（不盲遮）。✓（部分，1575 待決）
- **conversion_lifecycle_status + 單一 helper**（spec §8.1 #2）：Task 2 凍結映射 + 重用 ConversionLedgerStatus。✓
- **OQ1 store-direct**（spec §0）：Task 3。✓
- **trigger 端點 = R-TRIGGER-ENDPOINT**：Task 4，server-side presign、key 驗證、冪等。✓
- **join 鍵用 idempotency_key（不可用後填的 conversion_job_id）**（spec §8.1 #4）：trigger 用 `idempotencyKeyFor` 派生 `mw_<hash16>`，與 watcher 一致。✓（跨路徑一致性由既有 store 去重保證）

## 開放問題（實作中若遇到須回報）

- **OQ-IMPL-1（callback outbox ref，app.ts:1575）**：callback payload 的 `source_ifc.ref` 是否需保留 presigned 供雲端下游下載？若否則一併遮蔽；若是則改記純 object key。**實作前須確認雲端 callback consumer 契約**，不盲遮（可能斷下游）。
- **OQ-IMPL-2（測試標頭/helper 名稱）**：Task 3 Step 1 的 intake POST 標頭與 `makeApp` overrides 欄位名，以 `tests/external-ifc-ready.test.ts` 既有寫法為準（若 `externalIntakeIpAllowlist`/`externalIntakeWebhookSecret` 的 config 鍵名不同，照 `src/config.ts` 實際鍵名）。
- **OQ-IMPL-3（idempotencyKeyFor 第三參數）**：手動觸發無 etag，本計畫用 `key` 當第三參數；若日後要「同 key 不同版本重觸發」須改帶真 etag（需先 HEAD object）。Phase 1 不做。
