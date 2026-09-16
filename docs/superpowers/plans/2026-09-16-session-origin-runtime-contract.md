# Session Origin Runtime Contract（PR-1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/runtime/status` 的每筆 `sessions.items[]` 新增必填 `origin` 區塊，讓 console 能顯示 session 的來源專案、種類、MinIO key、建立方式，而不必用 id 前綴猜。

**Architecture:** 新增純函式 `deriveSessionOrigin(session, ledgerRecord, ifcReadyJob)`（`src/services/sessionOrigin.ts`），由 `buildRuntimeStatus` 以 `ready_model_id` 對 ledger 與 ifc-ready job 索引後呼叫；contract `runtimeSessionSummary` 同步加 `origin` strictObject；`app.ts` 只多傳一個 `conversionRecordByReadyModelId` 查詢函式。

**Tech Stack:** TypeScript（ESM，`.js` import 後綴）、zod v4 contract、vitest、supertest。

**Spec:** `docs/superpowers/specs/2026-09-16-session-identity-display-design.md` §1。

## Global Constraints

- `kind` 只能由 `recreated_from_session_id` 與 `created_by` 推導，不得讀 `session_id` 前綴。
- 所有查無資料的欄位為 `null`，不得用空字串或推測值；`category` 空字串視為 `null`。
- 不改 `sessions.count / active_count / participant_count`、不改任何寫入路徑、不新增端點、不新增依賴。
- contract 為 `z.strictObject`，`origin` 為必填；response validation（enforce mode）會抓漏欄。
- 每個 task 完成後 `cd bim-review-coordinator && npx vitest run <檔案>` 綠再 commit；commit 前 `git diff --cached --check`。
- worktree：`C:\Repos\active\iot\AI-BIM-governance.worktrees\session-origin-runtime-contract`（branch `feat/session-origin-runtime-contract`），主 checkout 不動。

---

### Task 1: `deriveSessionOrigin` 純函式

**Files:**
- Create: `bim-review-coordinator/src/services/sessionOrigin.ts`
- Test: `bim-review-coordinator/tests/session-origin.test.ts`

**Interfaces:**
- Consumes: `ReviewSession`、`IfcReadyIntakeJob`（`src/types.ts`）、`ConversionLedgerRecord`（`src/services/conversionLedger.ts`）。
- Produces:
  ```ts
  export type SessionOriginKind = "auto_conversion_ready" | "console_request" | "recreated" | "api_explicit";
  export interface SessionOrigin {
    kind: SessionOriginKind;
    created_by: string;
    intake_source: "minio_watch" | "external" | null;
    project_display_name: string | null;
    category: string | null;
    bucket: string | null;
    source_object_key: string | null;
    source_ifc_filename: string | null;
    recreated_from_session_id: string | null;
    ledger_detected_at: string | null;
  }
  export function objectKeyFromSourceIfcRef(ref: string | null | undefined): string | null;
  export function deriveSessionOrigin(session: ReviewSession, record: ConversionLedgerRecord | null, job: IfcReadyIntakeJob | null): SessionOrigin;
  ```

- [ ] **Step 1: 寫失敗測試**

```ts
// bim-review-coordinator/tests/session-origin.test.ts
import { describe, expect, it } from "vitest";
import { deriveSessionOrigin, objectKeyFromSourceIfcRef } from "../src/services/sessionOrigin.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

const ISO = "2026-09-16T05:08:55.017Z";
function session(over: Partial<ReviewSession> = {}): ReviewSession {
  return {
    session_id: "review_session_abc", tenant_id: "t", project_id: "mv_6c51d572", model_version_id: "24e598ab-1",
    status: "active", mode: "single_kit_shared_state", created_by: "dev_user_001", created_at: ISO, updated_at: ISO,
    kit_instance: { instance_id: "kit_local_001", provider: "local_fixed", status: "ready", stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1", media_port: 1024 },
    artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...over,
  };
}
function record(over: Partial<ConversionLedgerRecord> = {}): ConversionLedgerRecord {
  return {
    idempotency_key: "mw_010792d2cce6bf9b", correlation_id: "minio-watch-010792d2", project_id: "mv_6c51d572",
    project_display_name: "東勢區許良宇紀念圖書館", category: "建築", external_model_version_id: "24e598ab-1",
    object_key: null, bucket: "bim-control", conversion_job_id: "stream_conv_1", status: "ready",
    coverage_report: null, usdc_key: null, detected_at: "2026-09-08T08:42:32.485Z", updated_at: ISO,
    ...over,
  };
}
function job(over: Partial<IfcReadyIntakeJob> = {}): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "ifcready_1", status: "dispatched", idempotent_replay: false, correlation_id: "minio-watch-010792d2",
    idempotency_key: "mw_010792d2cce6bf9b", intake_source: "minio_watch", tenant_id: "t", project_id: "mv_6c51d572",
    external_model_version_id: "24e598ab-1",
    source_ifc_ref: "http://192.168.20.234:9000/bim-control/%E6%9D%B1%E5%8B%A2/root/%E5%BB%BA%E7%AF%89/24e598ab-1/model.ifc",
    source_ifc_etag: "etag", conversion_job_id: "stream_conv_1", conversion_status: "ready", conversion_authority: "bim-streaming-server",
    ...over,
  } as IfcReadyIntakeJob;
}

describe("objectKeyFromSourceIfcRef", () => {
  it("解出 bucket 之後的 URL-decoded key", () => {
    expect(objectKeyFromSourceIfcRef("http://h:9000/bim-control/a%20b/c/model.ifc")).toBe("a b/c/model.ifc");
  });
  it("非 http(s)、無 key 段或非法 URL → null", () => {
    expect(objectKeyFromSourceIfcRef("ftp://h/bucket/k")).toBeNull();
    expect(objectKeyFromSourceIfcRef("http://h/bucket-only")).toBeNull();
    expect(objectKeyFromSourceIfcRef("not a url")).toBeNull();
    expect(objectKeyFromSourceIfcRef(null)).toBeNull();
  });
});

describe("deriveSessionOrigin", () => {
  it("recreated_from_session_id 優先於 created_by → recreated", () => {
    const o = deriveSessionOrigin(session({ created_by: "coordinator-auto-conversion-ready", recreated_from_session_id: "review_session_old" }), null, null);
    expect(o.kind).toBe("recreated");
    expect(o.recreated_from_session_id).toBe("review_session_old");
  });
  it("coordinator-auto-conversion-ready → auto_conversion_ready，intake_source 取自 job", () => {
    const o = deriveSessionOrigin(session({ created_by: "coordinator-auto-conversion-ready" }), null, job());
    expect(o.kind).toBe("auto_conversion_ready");
    expect(o.intake_source).toBe("minio_watch");
  });
  it("coordinator-ready-review-request → console_request", () => {
    expect(deriveSessionOrigin(session({ created_by: "coordinator-ready-review-request" }), null, null).kind).toBe("console_request");
  });
  it("其他 created_by → api_explicit 並保留 created_by 原字串", () => {
    const o = deriveSessionOrigin(session({ created_by: "dev_user_001" }), null, null);
    expect(o.kind).toBe("api_explicit");
    expect(o.created_by).toBe("dev_user_001");
  });
  it("ledger 命中：display_name／category／bucket／detected_at；object_key null 時由 job source_ifc_ref 解出 key 與 filename", () => {
    const o = deriveSessionOrigin(session(), record(), job());
    expect(o.project_display_name).toBe("東勢區許良宇紀念圖書館");
    expect(o.category).toBe("建築");
    expect(o.bucket).toBe("bim-control");
    expect(o.ledger_detected_at).toBe("2026-09-08T08:42:32.485Z");
    expect(o.source_object_key).toBe("東勢/root/建築/24e598ab-1/model.ifc");
    expect(o.source_ifc_filename).toBe("model.ifc");
  });
  it("ledger object_key 有值時優先於 job", () => {
    const o = deriveSessionOrigin(session(), record({ object_key: "ifc-test/architecture/v1/model.ifc" }), job({ source_ifc_ref: "http://h/b/other/x.ifc" }));
    expect(o.source_object_key).toBe("ifc-test/architecture/v1/model.ifc");
  });
  it("ledger 與 job 皆無：全部 null；filename 退回 artifact_bindings.source_ifc_filename", () => {
    const o = deriveSessionOrigin(session({ artifact_bindings: [{ binding_id: "b1", artifact_group_id: "g", model_version_id: "v", artifact_id: "a", source_ifc_filename: "legacy.ifc", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready" }] }), null, null);
    expect(o.project_display_name).toBeNull();
    expect(o.category).toBeNull();
    expect(o.bucket).toBeNull();
    expect(o.source_object_key).toBeNull();
    expect(o.source_ifc_filename).toBe("legacy.ifc");
    expect(o.intake_source).toBeNull();
    expect(o.ledger_detected_at).toBeNull();
    expect(o.recreated_from_session_id).toBeNull();
  });
  it("category 空字串 → null；job 缺 intake_source → null；source_ifc_ref 非法 → key null", () => {
    const o = deriveSessionOrigin(session(), record({ category: "" }), job({ intake_source: undefined, source_ifc_ref: "nope" }));
    expect(o.category).toBeNull();
    expect(o.intake_source).toBeNull();
    expect(o.source_object_key).toBeNull();
    expect(o.source_ifc_filename).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/session-origin.test.ts`
Expected: FAIL，`Cannot find module '../src/services/sessionOrigin.js'`。

- [ ] **Step 3: 最小實作**

```ts
// bim-review-coordinator/src/services/sessionOrigin.ts
// session 來源（origin）推導：只用 server-owned 事實（created_by／recreated_from_session_id／ledger／ifc-ready job），
// 不得讀 session_id 前綴。查無資料一律 null（N5 誠實鐵律）。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../types.js";

export type SessionOriginKind = "auto_conversion_ready" | "console_request" | "recreated" | "api_explicit";

export interface SessionOrigin {
  kind: SessionOriginKind;
  created_by: string;
  intake_source: "minio_watch" | "external" | null;
  project_display_name: string | null;
  category: string | null;
  bucket: string | null;
  source_object_key: string | null;
  source_ifc_filename: string | null;
  recreated_from_session_id: string | null;
  ledger_detected_at: string | null;
}

export const AUTO_CONVERSION_READY_CREATOR = "coordinator-auto-conversion-ready";
export const CONSOLE_READY_REVIEW_CREATOR = "coordinator-ready-review-request";

/** `http(s)://host/<bucket>/<key…>` → URL-decoded `<key…>`；其他形狀 → null。 */
export function objectKeyFromSourceIfcRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  let url: URL;
  try { url = new URL(ref); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  try { return segments.slice(1).map((segment) => decodeURIComponent(segment)).join("/"); } catch { return null; }
}

function originKind(session: ReviewSession): SessionOriginKind {
  if (session.recreated_from_session_id) return "recreated";
  if (session.created_by === AUTO_CONVERSION_READY_CREATOR) return "auto_conversion_ready";
  if (session.created_by === CONSOLE_READY_REVIEW_CREATOR) return "console_request";
  return "api_explicit";
}

export function deriveSessionOrigin(
  session: ReviewSession,
  record: ConversionLedgerRecord | null,
  job: IfcReadyIntakeJob | null,
): SessionOrigin {
  const sourceObjectKey = record?.object_key ?? objectKeyFromSourceIfcRef(job?.source_ifc_ref);
  const keyFilename = sourceObjectKey?.split("/").pop() || null;
  const bindingFilename = session.artifact_bindings.find((binding) => binding.source_ifc_filename)?.source_ifc_filename ?? null;
  return {
    kind: originKind(session),
    created_by: session.created_by,
    intake_source: job?.intake_source ?? null,
    project_display_name: record?.project_display_name || null,
    category: record?.category || null,
    bucket: record?.bucket ?? null,
    source_object_key: sourceObjectKey,
    source_ifc_filename: keyFilename ?? bindingFilename,
    recreated_from_session_id: session.recreated_from_session_id ?? null,
    ledger_detected_at: record?.detected_at ?? null,
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/session-origin.test.ts`
Expected: PASS（9 tests）。

- [ ] **Step 5: Commit**

```bash
git add bim-review-coordinator/src/services/sessionOrigin.ts bim-review-coordinator/tests/session-origin.test.ts
git diff --cached --check
git commit -m "feat(coordinator): deriveSessionOrigin 純函式（kind／ledger／ifc-ready job 來源推導）"
```

---

### Task 2: contract `sessionOrigin` schema

**Files:**
- Modify: `bim-review-coordinator/src/contract/schemas/runtime.ts`（`runtimeSessionSummary` 定義處，約 :32-58）

**Interfaces:**
- Consumes: Task 1 的 `SessionOrigin` 型別。
- Produces: `export const sessionOrigin`（zod strictObject）；`runtimeSessionSummary` 新增必填 `origin: sessionOrigin`。

- [ ] **Step 1: 寫失敗測試（型別層）**

在 `runtime.ts` 加型別等價斷言（編譯期測試）：

```ts
import type { SessionOrigin } from "../../services/sessionOrigin.js";
export type _SessionOrigin = Expect<Equal<z.output<typeof sessionOrigin>, SessionOrigin>>;
```

- [ ] **Step 2: 跑 tsc 確認失敗**

Run: `cd bim-review-coordinator && npx tsc -p tsconfig.json --noEmit`
Expected: FAIL，`sessionOrigin` 未定義。

- [ ] **Step 3: 實作 schema**

在 `runtimeSessionSummary` 之前加：

```ts
export const sessionOrigin = named("SessionOrigin", z.strictObject({
  kind: z.enum(["auto_conversion_ready", "console_request", "recreated", "api_explicit"]),
  created_by: z.string(),
  intake_source: z.enum(["minio_watch", "external"]).nullable(),
  project_display_name: z.string().nullable(),
  category: z.string().nullable(),
  bucket: z.string().nullable(),
  source_object_key: z.string().nullable(),
  source_ifc_filename: z.string().nullable(),
  recreated_from_session_id: z.string().nullable(),
  ledger_detected_at: isoTimestamp.nullable(),
}));
export type _SessionOrigin = Expect<Equal<z.output<typeof sessionOrigin>, SessionOrigin>>;
```

在 `runtimeSessionSummary` 的 `viewer_leases` 之後加一行：`origin: sessionOrigin,`。

- [ ] **Step 4: 跑 tsc 確認通過**

Run: `cd bim-review-coordinator && npx tsc -p tsconfig.json --noEmit`
Expected: PASS（`runtimeStatus.ts` 尚未產出 `origin`，但 schema 與產出函式回傳 `Record<string, unknown>`，型別層不會紅；runtime 驗證於 Task 3 補）。

- [ ] **Step 5: Commit**

```bash
git add bim-review-coordinator/src/contract/schemas/runtime.ts
git diff --cached --check
git commit -m "feat(contract): runtimeSessionSummary 新增必填 origin 區塊"
```

---

### Task 3: `buildRuntimeStatus` 索引與注入

**Files:**
- Modify: `bim-review-coordinator/src/runtimeStatus.ts`（`RuntimeStatusInput` :16-22、`buildRuntimeStatus` :23-75、`summarizeSessionForRuntime` :117-148）
- Test: `bim-review-coordinator/tests/runtime-status-session-origin.test.ts`

**Interfaces:**
- Consumes: Task 1 `deriveSessionOrigin`；`loadConfig()`（`src/config.ts`）。
- Produces: `RuntimeStatusInput.conversionRecordByReadyModelId?: (readyModelId: string) => ConversionLedgerRecord | null`；每筆 `sessions.items[i].origin: SessionOrigin`。

- [ ] **Step 1: 寫失敗測試**

```ts
// bim-review-coordinator/tests/runtime-status-session-origin.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildRuntimeStatus } from "../src/runtimeStatus.js";
import type { ConversionLedgerRecord } from "../src/services/conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

const ISO = "2026-09-16T05:08:55.017Z";
function session(over: Partial<ReviewSession> = {}): ReviewSession {
  return {
    session_id: "review_session_abc", tenant_id: "t", project_id: "mv_6c51d572", model_version_id: "24e598ab-1",
    status: "active", mode: "single_kit_shared_state", created_by: "coordinator-auto-conversion-ready", created_at: ISO, updated_at: ISO,
    kit_instance: { instance_id: "kit_local_001", provider: "local_fixed", status: "ready", stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1", media_port: 1024 },
    artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...over,
  };
}
const RECORD: ConversionLedgerRecord = {
  idempotency_key: "mw_010792d2cce6bf9b", correlation_id: "minio-watch-010792d2", project_id: "mv_6c51d572",
  project_display_name: "東勢區許良宇紀念圖書館", category: "建築", external_model_version_id: "24e598ab-1",
  object_key: null, bucket: "bim-control", conversion_job_id: "stream_conv_1", status: "ready",
  coverage_report: null, usdc_key: null, detected_at: "2026-09-08T08:42:32.485Z", updated_at: ISO,
};
const JOB = {
  ifc_ready_job_id: "ifcready_1", status: "dispatched", idempotent_replay: false, correlation_id: "minio-watch-010792d2",
  idempotency_key: "mw_010792d2cce6bf9b", intake_source: "minio_watch", tenant_id: "t", project_id: "mv_6c51d572",
  external_model_version_id: "24e598ab-1", source_ifc_ref: "http://192.168.20.234:9000/bim-control/lib/root/arch/24e598ab-1/model.ifc",
  source_ifc_etag: "etag", conversion_job_id: "stream_conv_1", conversion_status: "ready", conversion_authority: "bim-streaming-server",
  review_session_id: "review_session_abc",
} as IfcReadyIntakeJob;

type Items = Array<{ session_id: string; origin: { kind: string; intake_source: string | null; project_display_name: string | null; source_object_key: string | null } }>;
function items(result: Record<string, unknown>): Items {
  return (result.sessions as { items: Items }).items;
}

describe("buildRuntimeStatus sessions.items[].origin", () => {
  it("以 ready_model_id 對 ledger 與 ifc-ready job 注入 origin", () => {
    const result = buildRuntimeStatus({
      config: loadConfig(), startedAt: Date.now(),
      sessions: [session({ ready_model_id: "mw_010792d2cce6bf9b" })],
      ifcReadyJobs: [JOB],
      conversionRecordByReadyModelId: (id) => (id === "mw_010792d2cce6bf9b" ? RECORD : null),
    });
    const [item] = items(result);
    expect(item.origin.kind).toBe("auto_conversion_ready");
    expect(item.origin.intake_source).toBe("minio_watch");
    expect(item.origin.project_display_name).toBe("東勢區許良宇紀念圖書館");
    expect(item.origin.source_object_key).toBe("lib/root/arch/24e598ab-1/model.ifc");
  });
  it("無 ready_model_id 時以 job.review_session_id 對應；無 ledger 查詢函式仍必有 origin（全 null 欄位）", () => {
    const result = buildRuntimeStatus({
      config: loadConfig(), startedAt: Date.now(),
      sessions: [session({ created_by: "dev_user_001" })],
      ifcReadyJobs: [JOB],
    });
    const [item] = items(result);
    expect(item.origin.kind).toBe("api_explicit");
    expect(item.origin.intake_source).toBe("minio_watch");
    expect(item.origin.project_display_name).toBeNull();
  });
  it("count／active_count 不受影響", () => {
    const result = buildRuntimeStatus({ config: loadConfig(), startedAt: Date.now(), sessions: [session(), session({ session_id: "s2", status: "closed" })], ifcReadyJobs: [] });
    expect((result.sessions as { count: number; active_count: number }).count).toBe(2);
    expect((result.sessions as { count: number; active_count: number }).active_count).toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd bim-review-coordinator && npx vitest run tests/runtime-status-session-origin.test.ts`
Expected: FAIL，`item.origin` 為 undefined。

- [ ] **Step 3: 實作**

`runtimeStatus.ts` 頂部加 import：

```ts
import type { ConversionLedgerRecord } from "./services/conversionLedger.js";
import { deriveSessionOrigin } from "./services/sessionOrigin.js";
```

`RuntimeStatusInput` 加：

```ts
  /** ledger 查詢（app.ts 傳 conversionLedger.get）；未提供時 origin 的 ledger 欄位為 null。 */
  conversionRecordByReadyModelId?: (readyModelId: string) => ConversionLedgerRecord | null;
```

`buildRuntimeStatus` 內、`leasesBySession` 之後加索引（只掃一次）：

```ts
  // session origin：以 ready_model_id 對 ifc-ready job（idempotency_key）與 ledger；退回 job.review_session_id。
  const jobByReadyModelId = new Map<string, IfcReadyIntakeJob>();
  const jobBySessionId = new Map<string, IfcReadyIntakeJob>();
  for (const job of input.ifcReadyJobs) {
    if (job.idempotency_key && !jobByReadyModelId.has(job.idempotency_key)) jobByReadyModelId.set(job.idempotency_key, job);
    if (job.review_session_id && !jobBySessionId.has(job.review_session_id)) jobBySessionId.set(job.review_session_id, job);
  }
  const originFor = (session: ReviewSession) => {
    const record = session.ready_model_id ? input.conversionRecordByReadyModelId?.(session.ready_model_id) ?? null : null;
    const job = (session.ready_model_id ? jobByReadyModelId.get(session.ready_model_id) : undefined) ?? jobBySessionId.get(session.session_id) ?? null;
    return deriveSessionOrigin(session, record, job);
  };
```

`sessions.items` 改為：

```ts
      items: input.sessions.map((session) =>
        summarizeSessionForRuntime(session, leasesBySession.get(session.session_id) ?? [], originFor(session)),
      ),
```

`summarizeSessionForRuntime` 簽名加第三參數 `origin: SessionOrigin`（import type 自 `./services/sessionOrigin.js`），回傳物件於 `viewer_leases` 後加 `origin,`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd bim-review-coordinator && npx vitest run tests/runtime-status-session-origin.test.ts tests/session-origin.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add bim-review-coordinator/src/runtimeStatus.ts bim-review-coordinator/tests/runtime-status-session-origin.test.ts
git diff --cached --check
git commit -m "feat(coordinator): runtime/status sessions.items 注入 origin（ledger＋ifc-ready job 索引）"
```

---

### Task 4: `app.ts` 接線＋整合測試＋全量驗證

**Files:**
- Modify: `bim-review-coordinator/src/app.ts:1951-1963`（`GET /api/runtime/status`）
- Test: `bim-review-coordinator/tests/runtime-status-session-origin.test.ts`（追加整合案）

**Interfaces:**
- Consumes: Task 3 的 `conversionRecordByReadyModelId`；`app.ts:1171` 的 `conversionLedger`。
- Produces: 真 HTTP `GET /api/runtime/status` 每筆 session 含 `origin`，通過 enforce-mode contract validation。

- [ ] **Step 1: 寫失敗整合測試**（追加到同檔）

```ts
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (active) { active.io.close(); await new Promise<void>((resolve) => active?.server.close(() => resolve())); active = null; }
});

describe("GET /api/runtime/status origin（HTTP）", () => {
  it("POST /api/review-sessions 建立的 session 回 origin.kind=api_explicit、created_by 原字串、ledger 欄位 null", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-origin-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"), corsOrigins: ["http://127.0.0.1:5173"],
    });
    const created = await request(active.app).post("/api/review-sessions").send({
      project_id: "project_demo_001", model_version_id: "version_demo_001", created_by: "dev_user_001",
      artifact_bindings: [{
        artifact_group_id: "ag_version_demo_001", artifact_id: "auto_usdc_stream_conv_status_001", artifact_role: "derived",
        url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
        mapping_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/element_mapping.json",
        load_order: 0, ready_status: "ready", conversion_authority: "bim-streaming-server",
        conversion_job_id: "stream_conv_status_001", conversion_status: "ready",
      }],
    });
    expect(created.status).toBe(200);
    const status = await request(active.app).get("/api/runtime/status");
    expect(status.status).toBe(200);
    const item = (status.body.sessions.items as Array<{ session_id: string; origin: Record<string, unknown> }>)
      .find((entry) => entry.session_id === created.body.session_id);
    expect(item?.origin).toEqual({
      kind: "api_explicit", created_by: "dev_user_001", intake_source: null, project_display_name: null, category: null,
      bucket: null, source_object_key: null, source_ifc_filename: null, recreated_from_session_id: null, ledger_detected_at: null,
    });
  });
});
```

- [ ] **Step 2: 跑測試確認現況**

Run: `cd bim-review-coordinator && npx vitest run tests/runtime-status-session-origin.test.ts`
Expected: 此案在 Task 3 後已可能 PASS（app.ts 未傳 ledger 查詢函式時 ledger 欄位本就 null）；重點是 Step 3 接線後 ledger 命中路徑生效。若 enforce-mode contract validation 因 `origin` 缺失而紅，代表 Task 3 未落地。

- [ ] **Step 3: app.ts 接線**

`app.ts:1956` 的 `buildRuntimeStatus({ ... })` 加：

```ts
      conversionRecordByReadyModelId: (readyModelId) => conversionLedger.get(readyModelId),
```

- [ ] **Step 4: 全量驗證**

Run（cwd `bim-review-coordinator`）：
```bash
npx vitest run
npm run build
```
Expected：全綠；`tests/sessions.test.ts`、`ready-model-session.test.ts`、`minio-source-object-key.test.ts`、`viewer-leases.test.ts` 等既有案不變。

- [ ] **Step 5: Commit**

```bash
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/runtime-status-session-origin.test.ts
git diff --cached --check
git commit -m "feat(coordinator): /api/runtime/status 接線 ledger 查詢；origin HTTP 整合測試"
```

---

### Task 5: 前端型別相容（同 PR，避免 main 上 tsc 紅）

**Files:**
- Modify: `web-viewer-sample/src/console/__testdata__/contractFixtures.ts:99-130`（`runtimeSessionSummary` builder 預設）
- 檢查：`web-viewer-sample` 內所有 `satisfies RuntimeSessionSummary` 或手寫 `RuntimeSessionSummary` 物件字面量。

**Interfaces:**
- Consumes: Task 2 contract（前端 `coordinatorClient.ts:234` 直接 import contract 型別）。
- Produces: 前端 `npx tsc --noEmit -p .` 與 `npx vitest run` 綠；不改任何 UI。

- [ ] **Step 1: 跑 tsc 找出缺 origin 的字面量**

Run: `cd web-viewer-sample && npx tsc --noEmit -p .`
Expected: FAIL，列出缺 `origin` 的物件（至少 `contractFixtures.ts` 的 `runtimeSessionSummary`）。

- [ ] **Step 2: 補預設值**

`contractFixtures.ts` 的 `runtimeSessionSummary` 物件在 `viewer_leases: [],` 後加：

```ts
  origin: {
    kind: "api_explicit",
    created_by: "dev_user_001",
    intake_source: null,
    project_display_name: null,
    category: null,
    bucket: null,
    source_object_key: null,
    source_ifc_filename: null,
    recreated_from_session_id: null,
    ledger_detected_at: null,
  },
```

其他 tsc 指出的字面量以相同物件補齊（用 `fx.runtimeSessionSummary({...})` builder 的檔案不需改）。

- [ ] **Step 3: 跑 tsc 與 vitest 確認通過**

Run（cwd `web-viewer-sample`）：
```bash
npx tsc --noEmit -p .
npx vitest run
```
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add web-viewer-sample/src/console/__testdata__/contractFixtures.ts
git diff --cached --check
git commit -m "test(web-viewer): contract fixture 補 runtimeSessionSummary.origin 預設"
```

---

## Self-review

- Spec §1 `origin` 欄位 10 個：Task 1 型別＋Task 2 schema 逐一對應 ✔；`kind` 四規則 Task 1 ✔；`object_key` fallback／filename fallback／`intake_source` null／`category` 空字串 Task 1 測試 ✔；索引一次 Task 3 ✔；`app.ts` 接線 Task 4 ✔；不改 count 類 Task 3 測試 ✔；前端型別相容 Task 5 ✔。
- 型別一致：`SessionOrigin`／`sessionOrigin`／`conversionRecordByReadyModelId` 在各 task 命名相同 ✔。
- 無 TBD／placeholder ✔。
