# MinIO 轉檔閉環可觀測性 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MinIO「偵測 → 持久轉檔紀錄 → 唯讀結構/紀錄視圖」做成可觀測閉環的 Phase 1（現可建、全 REAL），不碰待建的 IFC→USDC 轉檔權威。

**Architecture:** coordinator（Express 4，無 GPU）新增 (1) 持久 `ConversionLedger`（JSON 檔 + atomic swap，零新依賴，照 `CallbackOutbox` pattern）；(2) watcher 偵測即寫 ledger `status=queued`；(3) `GET /api/conversion/records` 讀 ledger；(4) `GET /api/minio/objects` 唯讀 S3 list proxy（複用 `MINIO_WATCH_*` config，新 `minioClient.ts` 工廠，**不改 watcher**）。前端 `#conv` / `#minio` 兩頁改接這兩個真實 API。

**Tech Stack:** TypeScript · Express 4 · @aws-sdk/client-s3（既有）· vitest + supertest · Playwright。前端 React（web-viewer-sample console）。

## Global Constraints

- **零新 production dependency**：ledger 持久化用 Node 內建 `fs`（照 `src/services/callbackOutbox.ts` 的「單一 JSON 檔 + `.tmp` atomic swap + `schema_version`」pattern）。不引入 SQLite / MySQL（會越界 + 違守則）。
- **服務邊界**：coordinator 對 MinIO 只做**唯讀** list/presign；ledger 是 coordinator-local **shadow**，非 metadata 權威（權威在外部 `bim-control · MySQL`）；不碰 IFC→USDC 轉檔本體（Phase 2）。
- **誠實鐵律**：converter 未落地時 ledger record 不得出現 `ready`、coverage 不得捏造、`model.usdc` 標 `pending · 待產生`；缺值標 `未取得` / `p1`（後端待建）。enum 後端逐字。
- **不碰 `minioWatcher.ts` 的 S3Client 建構與 `startMinioWatcher`**（避免 GitNexus HIGH risk）；新 list proxy 自建 client（共用工廠 `minioClient.ts`）。
- **路由註冊位置**：新 GET 路由插在 `app.get("/api/external/ifc-ready", …)`（app.ts:1158）之後、`/api/external/ifc-ready/:jobId` param route 之前（避免被 `:jobId` 吃掉）。
- **prov 對映**：repo `asbuilt/artifact/demo/p1/p15/p3/p4` ↔ DS `built/artifact/demo/ai/todo`。前端**不新增 Prov 值**（會 TS-break 所有 `Record<Prov,...>` + 測試）；`pending · 待產生` 用既有 `p1`（後端待建）標。
- **verify 指令**：coordinator `cd bim-review-coordinator && npm run verify`（= `npm run build && npm test`，tsc + vitest）；前端 `cd web-viewer-sample && npm run verify` + `npm run test:e2e`。

---

### Task 1: `ConversionLedger` 持久 service

**Files:**
- Create: `bim-review-coordinator/src/services/conversionLedger.ts`
- Modify: `bim-review-coordinator/src/config.ts`（加 `conversionLedgerStorePath`，照 `callbackOutboxStorePath` 模式）
- Test: `bim-review-coordinator/tests/conversion-ledger.test.ts`

**Interfaces:**
- Produces：
```ts
export type ConversionLedgerStatus = "detected" | "queued" | "converting" | "ready" | "failed";
export interface ConversionLedgerRecord {
  idempotency_key: string;            // mw_<hash16>（唯一鍵）
  correlation_id: string | null;      // minio-watch-<hash8>
  project_id: string;                 // safe id
  project_display_name: string;       // 中文原名
  category: string;                   // 種類（倒數二段）
  external_model_version_id: string;  // 版本（末段）
  object_key: string | null;          // Phase 1 可為 null（由 #minio list proxy 補視圖）
  bucket: string | null;
  conversion_job_id: string | null;
  status: ConversionLedgerStatus;
  coverage_report: unknown | null;    // Phase 2 回填
  usdc_key: string | null;            // Phase 2 回填
  detected_at: string;                // ISO
  updated_at: string;                 // ISO
}
export type ConversionLedgerUpsert = Pick<ConversionLedgerRecord,
  "idempotency_key" | "correlation_id" | "project_id" | "project_display_name" |
  "category" | "external_model_version_id" | "conversion_job_id" | "status"> &
  Partial<Pick<ConversionLedgerRecord, "object_key" | "bucket">>;
export class ConversionLedger {
  constructor(persistencePath: string | null);
  upsert(input: ConversionLedgerUpsert, now: string): ConversionLedgerRecord; // 以 idempotency_key 去重；已存在則只更新 status/conversion_job_id/updated_at，保留 detected_at
  recordCallbackOutcome(idempotencyKey: string, outcome: { status: ConversionLedgerStatus; usdc_key?: string | null; coverage_report?: unknown }, now: string): ConversionLedgerRecord | null; // Phase 2 用；找不到回 null
  get(idempotencyKey: string): ConversionLedgerRecord | null;
  list(): ConversionLedgerRecord[]; // detected_at desc
}
```
- Consumes：Node `fs` / `path`（內建）。`now` 一律由呼叫端傳 ISO 字串（避免 service 內取時鐘，方便測試）。

- [ ] **Step 1: Write the failing test**

```ts
// bim-review-coordinator/tests/conversion-ledger.test.ts
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversionLedger } from "../src/services/conversionLedger.js";

let tmp: string | null = null;
function storePath(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-ledger-"));
  return path.join(tmp, "conversion-ledger.json");
}
afterEach(() => { if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; } });

const base = {
  idempotency_key: "mw_abc123def4567890", correlation_id: "minio-watch-abc123de",
  project_id: "mv_1a2b3c4d", project_display_name: "松風庵", category: "機電",
  external_model_version_id: "000001", conversion_job_id: null, status: "queued" as const,
};

describe("ConversionLedger", () => {
  it("upsert 去重：同 idempotency_key 第二次只更新 status，保留 detected_at", () => {
    const led = new ConversionLedger(storePath());
    const a = led.upsert(base, "2026-06-23T01:00:00.000Z");
    const b = led.upsert({ ...base, status: "converting", conversion_job_id: "ifcready_1_aa" }, "2026-06-23T01:05:00.000Z");
    expect(led.list()).toHaveLength(1);
    expect(b.detected_at).toBe(a.detected_at);             // 保留首次
    expect(b.updated_at).toBe("2026-06-23T01:05:00.000Z"); // 更新
    expect(b.status).toBe("converting");
    expect(b.conversion_job_id).toBe("ifcready_1_aa");
  });
  it("持久化：重啟 reload 還在", () => {
    const p = storePath();
    new ConversionLedger(p).upsert(base, "2026-06-23T01:00:00.000Z");
    const reloaded = new ConversionLedger(p);
    expect(reloaded.get("mw_abc123def4567890")?.category).toBe("機電");
  });
  it("壞檔不 crash：JSON 損毀時當空 ledger 起手", () => {
    const p = storePath();
    fs.writeFileSync(p, "{ not json", "utf-8");
    const led = new ConversionLedger(p);
    expect(led.list()).toEqual([]);
    expect(() => led.upsert(base, "2026-06-23T01:00:00.000Z")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-ledger.test.ts`
Expected: FAIL（`Cannot find module '../src/services/conversionLedger.js'`）

- [ ] **Step 3: Write minimal implementation**

```ts
// bim-review-coordinator/src/services/conversionLedger.ts
import fs from "node:fs";
import path from "node:path";

export type ConversionLedgerStatus = "detected" | "queued" | "converting" | "ready" | "failed";
export interface ConversionLedgerRecord {
  idempotency_key: string; correlation_id: string | null;
  project_id: string; project_display_name: string; category: string; external_model_version_id: string;
  object_key: string | null; bucket: string | null; conversion_job_id: string | null;
  status: ConversionLedgerStatus; coverage_report: unknown | null; usdc_key: string | null;
  detected_at: string; updated_at: string;
}
export type ConversionLedgerUpsert = Pick<ConversionLedgerRecord,
  "idempotency_key" | "correlation_id" | "project_id" | "project_display_name" |
  "category" | "external_model_version_id" | "conversion_job_id" | "status"> &
  Partial<Pick<ConversionLedgerRecord, "object_key" | "bucket">>;

const SCHEMA = "conversion-ledger/v1";

export class ConversionLedger {
  private readonly records = new Map<string, ConversionLedgerRecord>();
  constructor(private readonly persistencePath: string | null = null) { this.load(); }

  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8")) as { records?: unknown };
      if (!Array.isArray(parsed.records)) return;
      for (const raw of parsed.records) {
        const r = raw as ConversionLedgerRecord;
        if (r && typeof r.idempotency_key === "string") this.records.set(r.idempotency_key, r);
      }
    } catch { this.records.clear(); } // 壞檔不 crash，下次 upsert 覆寫
  }
  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmp = `${this.persistencePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ schema_version: SCHEMA, records: [...this.records.values()] }, null, 2), "utf-8");
    fs.renameSync(tmp, this.persistencePath); // atomic
  }

  upsert(input: ConversionLedgerUpsert, now: string): ConversionLedgerRecord {
    const existing = this.records.get(input.idempotency_key);
    const record: ConversionLedgerRecord = {
      idempotency_key: input.idempotency_key, correlation_id: input.correlation_id,
      project_id: input.project_id, project_display_name: input.project_display_name,
      category: input.category, external_model_version_id: input.external_model_version_id,
      object_key: input.object_key ?? existing?.object_key ?? null,
      bucket: input.bucket ?? existing?.bucket ?? null,
      conversion_job_id: input.conversion_job_id ?? existing?.conversion_job_id ?? null,
      status: input.status,
      coverage_report: existing?.coverage_report ?? null,
      usdc_key: existing?.usdc_key ?? null,
      detected_at: existing?.detected_at ?? now,
      updated_at: now,
    };
    this.records.set(record.idempotency_key, record);
    this.persist();
    return record;
  }
  recordCallbackOutcome(idempotencyKey: string, outcome: { status: ConversionLedgerStatus; usdc_key?: string | null; coverage_report?: unknown }, now: string): ConversionLedgerRecord | null {
    const existing = this.records.get(idempotencyKey);
    if (!existing) return null;
    const next: ConversionLedgerRecord = { ...existing, status: outcome.status,
      usdc_key: outcome.usdc_key ?? existing.usdc_key,
      coverage_report: outcome.coverage_report ?? existing.coverage_report, updated_at: now };
    this.records.set(idempotencyKey, next); this.persist(); return next;
  }
  get(idempotencyKey: string): ConversionLedgerRecord | null { return this.records.get(idempotencyKey) ?? null; }
  list(): ConversionLedgerRecord[] {
    return [...this.records.values()].sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));
  }
}
```

- [ ] **Step 4: 加 config（`config.ts`）**

在 `config.ts` 的 `CoordinatorConfig` interface 加（照 `callbackOutboxStorePath`）：
```ts
conversionLedgerStorePath: string; // CONVERSION_LEDGER_STORE_PATH，default data/conversion-ledger.json
```
在 `loadConfig` 的回傳物件加（照既有 `callbackOutboxStorePath: process.env.CALLBACK_OUTBOX_STORE_PATH || path.join(cwd, "data", "callback-outbox.json")` 那行旁）：
```ts
conversionLedgerStorePath: process.env.CONVERSION_LEDGER_STORE_PATH || path.join(cwd, "data", "conversion-ledger.json"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-ledger.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add bim-review-coordinator/src/services/conversionLedger.ts bim-review-coordinator/src/config.ts bim-review-coordinator/tests/conversion-ledger.test.ts
git commit -m "feat(coordinator): 加持久 ConversionLedger（JSON+atomic swap，零新依賴）"
```

---

### Task 2: watcher 偵測即寫 ledger（intake 接線）

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（`createCoordinatorApp` 內建 ledger 實例；`POST /api/external/ifc-ready` handler 成功路徑後寫 ledger）
- Test: `bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `ConversionLedger`、`config.conversionLedgerStorePath`；intake 已驗證 body（`project_id` / `project_display_name` / `model_category` / `external_model_version_id`，見 app.ts:164 註解的 additive 欄位）+ `X-Idempotency-Key` / `X-Correlation-Id` header + 回傳 `ifc_ready_job_id`。
- Produces：每次 intake 成功 → ledger 一筆 `status="queued"`（以 header idempotency key 為鍵）。

- [ ] **Step 1: Write the failing test**

```ts
// bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-intake-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    externalIfcReadyWebhookSecret: "test-secret", externalIfcReadyIpAllowlist: [],
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});

const body = {
  event: "ifc_ready", tenant_id: "tenant_demo_001", project_id: "mv_1a2b3c4d",
  project_display_name: "松風庵", model_category: "機電", external_model_version_id: "000001",
  source_ifc: { ref: "http://127.0.0.1:9/bim-control/x/model.ifc", etag: "abc", filename: "model.ifc", format: "ifc" },
  requested_outputs: ["usdc"],
};

describe("intake → ledger", () => {
  it("intake 成功後 GET /api/conversion/records 出現 queued 紀錄", async () => {
    const app = makeApp();
    const res = await request(app.app).post("/api/external/ifc-ready")
      .set("X-Webhook-Secret", "test-secret")
      .set("X-Idempotency-Key", "mw_abc123def4567890")
      .set("X-Correlation-Id", "minio-watch-abc123de").send(body);
    expect(res.status).toBeLessThan(400);
    const recs = await request(app.app).get("/api/conversion/records");
    expect(recs.status).toBe(200);
    const item = recs.body.items.find((r: { idempotency_key: string }) => r.idempotency_key === "mw_abc123def4567890");
    expect(item).toBeTruthy();
    expect(item.status).toBe("queued");
    expect(item.category).toBe("機電");
    expect(item.project_display_name).toBe("松風庵");
  });
});
```
> 註：此測試同時依賴 Task 3 的 `GET /api/conversion/records`。若用 subagent-driven 逐任務執行，先實作本任務的 ledger 寫入 + Task 3 的 route 後再一起綠。可暫以 `app.locals`/直接讀 store path 斷言；建議與 Task 3 合併為同一 commit gate。

- [ ] **Step 2: Run → fail**（route 不存在 / ledger 未寫）

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-ledger-intake-integration.test.ts`
Expected: FAIL（404 或 item undefined）

- [ ] **Step 3: 在 `createCoordinatorApp` 建 ledger 實例**

`app.ts` 找到 `const callbackOutbox = new CallbackOutbox(...)`（app.ts:477 附近），其後加：
```ts
const conversionLedger = new ConversionLedger(config.conversionLedgerStorePath);
```
檔頭 import：`import { ConversionLedger } from "./services/conversionLedger.js";`

- [ ] **Step 4: 在 intake handler 成功路徑寫 ledger**

`POST /api/external/ifc-ready` handler（app.ts ~1074-1155）內，`externalIfcReadyStore.create(...)`（並 enqueue dispatch）成功之後、`response.json(...)` 之前加（欄位取自已驗證 body + header）：
```ts
// minio-watch 偵測 → 持久 ledger（shadow，coordinator-local；不阻塞 intake）
try {
  conversionLedger.upsert({
    idempotency_key: (request.header("x-idempotency-key") ?? job.idempotency_key) as string,
    correlation_id: request.header("x-correlation-id") ?? null,
    project_id: event.project_id,
    project_display_name: event.project_display_name ?? event.project_id,
    category: event.model_category ?? "",
    external_model_version_id: event.external_model_version_id ?? "",
    conversion_job_id: job.conversion_job_id ?? null,
    status: "queued",
  }, new Date().toISOString());
} catch { /* ledger 失敗不卡 intake（誠實降級，照 callbackOutbox 精神） */ }
```
> `event` = 已過 zod 的 body；`job` = `externalIfcReadyStore.create` 回傳。實作前用 `grep -n "externalIfcReadyStore.create" src/app.ts` 確認變數名（若非 `job`/`event` 則對應改）。`new Date()` 在 app handler 內可用（非 workflow 限制）。

- [ ] **Step 5: Run → pass**（與 Task 3 route 一起綠）

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-ledger-intake-integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts
git commit -m "feat(coordinator): watcher 偵測 intake 即寫 ConversionLedger（status=queued）"
```

---

### Task 3: `GET /api/conversion/records` route

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`（插在 `GET /api/external/ifc-ready` 之後、`/:jobId` 之前）
- Test: `bim-review-coordinator/tests/conversion-records-route.test.ts`

**Interfaces:**
- Produces：`GET /api/conversion/records?limit=N` → `{ count: number; items: ConversionLedgerRecord[] }`（detected_at desc）。
- Consumes：Task 1 ledger 實例 + `parseListLimit`（app.ts 既有 helper）。

- [ ] **Step 1: Write the failing test**

```ts
// bim-review-coordinator/tests/conversion-records-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-records-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});

describe("GET /api/conversion/records", () => {
  it("空 ledger 回 count=0 items=[]", async () => {
    const res = await request(makeApp().app).get("/api/conversion/records");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, items: [] });
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-records-route.test.ts`
Expected: FAIL（404，body 非 `{count:0,items:[]}`）

- [ ] **Step 3: 加 route**

`app.ts` 在 `app.get("/api/external/ifc-ready", …)`（app.ts:1158）區塊之後加（務必在 `/api/external/ifc-ready/:jobId` 之前）：
```ts
app.get("/api/conversion/records", (request, response) => {
  const limit = parseListLimit(request.query.limit);
  const items = conversionLedger.list();
  response.json({ count: items.length, items: items.slice(0, limit) });
});
```

- [ ] **Step 4: Run → pass**

Run: `cd bim-review-coordinator && npx vitest run tests/conversion-records-route.test.ts tests/conversion-ledger-intake-integration.test.ts`
Expected: PASS（Task 2 整合測試此時也應綠）

- [ ] **Step 5: Commit**

```bash
git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/conversion-records-route.test.ts
git commit -m "feat(coordinator): GET /api/conversion/records 讀持久 ledger"
```

---

### Task 4: `minioClient` 工廠 + `GET /api/minio/objects` 唯讀 list proxy

**Files:**
- Create: `bim-review-coordinator/src/services/minioClient.ts`（共用 S3Client 工廠 + list/role 純函式）
- Modify: `bim-review-coordinator/src/app.ts`（route，插在 `/api/external/ifc-ready` 後、`/:jobId` 前）
- Test: `bim-review-coordinator/tests/minio-objects-route.test.ts`

**Interfaces:**
- Produces：
```ts
export function createMinioS3Client(cfg: { endpoint: string; accessKey: string; secretKey: string }): S3Client;
export type MinioObjectRole = "source_ifc" | "parsed_usdc" | "other";
export interface MinioObjectView { key: string; etag: string; role: MinioObjectRole;
  project_id: string | null; project_display_name: string | null; category: string | null; version: string | null; }
export async function listMinioObjects(client: S3Client, bucket: string, prefix: string, keySuffix: string): Promise<MinioObjectView[]>;
// route: GET /api/minio/objects?prefix= → { bucket, prefix, count, objects: MinioObjectView[] }
```
- Consumes：`config.minioWatchEndpoint/Bucket/Prefix/AccessKey/SecretKey/KeySuffix`；`deriveIntakeFromKey`（判角色 + 擋路徑穿越）。**不改 `minioWatcher.ts`。**

- [ ] **Step 1: Write the failing test（用 HTTP S3 stub，照 minio-watch-intake-integration 慣例）**

```ts
// bim-review-coordinator/tests/minio-objects-route.test.ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import http from "node:http";
import { listMinioObjects, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
function startS3Stub(keys: string[]): Promise<void> {
  stub = http.createServer((_req, res) => {
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e"</ETag></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${contents}</ListBucketResult>`);
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}
afterEach(() => new Promise<void>((r) => stub ? stub.close(() => { stub = null; r(); }) : r()));

describe("listMinioObjects", () => {
  it("判角色：.ifc=source_ifc、.usdc=parsed_usdc，解析 project/category/version", async () => {
    await startS3Stub(["松風庵/root/main/000001/model.ifc", "松風庵/root/main/000001/model.usdc"]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const objs = await listMinioObjects(client, "bim-control", "", "/model.ifc");
    const ifc = objs.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.category).toBe("main");        // 倒數二段
    expect(ifc?.version).toBe("000001");       // 末段
    expect(objs.find((o) => o.key.endsWith(".usdc"))?.role).toBe("parsed_usdc");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd bim-review-coordinator && npx vitest run tests/minio-objects-route.test.ts`
Expected: FAIL（module 不存在）

- [ ] **Step 3: Write `minioClient.ts`**

```ts
// bim-review-coordinator/src/services/minioClient.ts
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { deriveIntakeFromKey } from "./minioWatcher.js";

export function createMinioS3Client(cfg: { endpoint: string; accessKey: string; secretKey: string }): S3Client {
  return new S3Client({ endpoint: cfg.endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } });
}
export type MinioObjectRole = "source_ifc" | "parsed_usdc" | "other";
export interface MinioObjectView { key: string; etag: string; role: MinioObjectRole;
  project_id: string | null; project_display_name: string | null; category: string | null; version: string | null; }

export async function listMinioObjects(client: S3Client, bucket: string, prefix: string, keySuffix: string): Promise<MinioObjectView[]> {
  const out: MinioObjectView[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const key = obj.Key;
      const role: MinioObjectRole = key.endsWith(".ifc") ? "source_ifc" : key.endsWith(".usdc") ? "parsed_usdc" : "other";
      // 用 .ifc 規約解析三段（同 watcher）；擋路徑穿越（deriveIntakeFromKey 拒空段 / . / ..）
      const probeSuffix = key.endsWith(".usdc") ? "/model.usdc" : keySuffix;
      const d = deriveIntakeFromKey({ key, prefix, keySuffix: probeSuffix });
      out.push({ key, etag: (obj.ETag ?? "").replace(/^"+|"+$/g, ""), role,
        project_id: d.ok ? d.projectId : null, project_display_name: d.ok ? d.projectDisplayName : null,
        category: d.ok ? d.category : null, version: d.ok ? d.externalModelVersionId : null });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}
```

- [ ] **Step 4: Run → pass**

Run: `cd bim-review-coordinator && npx vitest run tests/minio-objects-route.test.ts`
Expected: PASS

- [ ] **Step 5: 加 route（`app.ts`）**

```ts
app.get("/api/minio/objects", async (request, response) => {
  if (!config.minioWatchEndpoint || !config.minioWatchBucket) {
    response.json({ bucket: config.minioWatchBucket || null, prefix: "", count: 0, objects: [], note: "MinIO watch 未設定（未取得）" });
    return;
  }
  const rawPrefix = typeof request.query.prefix === "string" ? request.query.prefix : config.minioWatchPrefix;
  try {
    const client = createMinioS3Client({ endpoint: config.minioWatchEndpoint, accessKey: config.minioWatchAccessKey, secretKey: config.minioWatchSecretKey });
    const objects = await listMinioObjects(client, config.minioWatchBucket, rawPrefix, config.minioWatchKeySuffix);
    client.destroy();
    response.json({ bucket: config.minioWatchBucket, prefix: rawPrefix, count: objects.length, objects });
  } catch (err) {
    response.status(502).json({ error: "minio_list_failed", detail: err instanceof Error ? err.message : String(err) });
  }
});
```
檔頭 import：`import { createMinioS3Client, listMinioObjects } from "./services/minioClient.js";`
（route test 可額外 spawn 真 app + S3 stub，照 `minio-watch-intake-integration.test.ts`；核心邏輯已由 Step 1 純函式測試覆蓋。）

- [ ] **Step 6: Commit**

```bash
git add bim-review-coordinator/src/services/minioClient.ts bim-review-coordinator/src/app.ts bim-review-coordinator/tests/minio-objects-route.test.ts
git commit -m "feat(coordinator): GET /api/minio/objects 唯讀 S3 list proxy（複用 MINIO_WATCH config，不改 watcher）"
```

- [ ] **Step 7: coordinator 全綠**

Run: `cd bim-review-coordinator && npm run verify`
Expected: build OK + vitest 全 pass（含新 4 檔測試）

---

### Task 5: 前端 client — `getConversionRecords` + `getMinioObjects`

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`（若無則照既有 client 測試新增；否則併入頁面測試）

**Interfaces:**
- Produces：
```ts
export interface ConversionRecord { idempotency_key: string; project_id: string; project_display_name: string;
  category: string; external_model_version_id: string; conversion_job_id: string | null;
  status: "detected" | "queued" | "converting" | "ready" | "failed"; usdc_key: string | null;
  coverage_report: unknown | null; detected_at: string; updated_at: string; }
export interface MinioObject { key: string; etag: string; role: "source_ifc" | "parsed_usdc" | "other";
  project_id: string | null; project_display_name: string | null; category: string | null; version: string | null; }
// coordinatorClient.getConversionRecords(limit?) → { count, items: ConversionRecord[] }
// coordinatorClient.getMinioObjects(prefix?) → { bucket: string|null, count, objects: MinioObject[] }
```
- Consumes：既有 `jsonGet<T>`（coordinatorClient.ts:27）。

- [ ] **Step 1: 加方法 + 型別**

`coordinatorClient.ts` 物件內，照 `listIfcReady` / `minioWatchStatus` 模式加：
```ts
getConversionRecords: (limit = 50) =>
  jsonGet<{ count: number; items: ConversionRecord[] }>(`/api/conversion/records?limit=${limit}`),
getMinioObjects: (prefix?: string) =>
  jsonGet<{ bucket: string | null; count: number; objects: MinioObject[] }>(
    `/api/minio/objects${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`),
```
並 export 上述兩個 interface。

- [ ] **Step 2: 測試（若 client 有既有 vitest，照抄；否則跳到頁面測試覆蓋）**

Run: `cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts`
Expected: PASS（或 N/A → 由 Task 6/7 頁面測試覆蓋）

- [ ] **Step 3: Commit**

```bash
git add web-viewer-sample/src/console/coordinatorClient.ts
git commit -m "feat(console): coordinatorClient 加 getConversionRecords / getMinioObjects"
```

---

### Task 6: `#conv` 升級讀 ledger（保留 watcher liveness）

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`ConversionSchedulingPage`，pages.tsx:697）
- Test: `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`（既有，擴充）

**Interfaces:**
- Consumes：Task 5 `getConversionRecords` + 既有 `minioWatchStatus`（liveness）。

- [ ] **Step 1: 失敗測試（誠實：converter 未落地 → 不顯 ready）**

擴充既有 `ConversionSchedulingPage.test.tsx`，`vi.spyOn(coordinatorClient, "getConversionRecords")` 回兩筆（`queued` + `converting`），斷言：render 出 `機電 / 000001`、status 文案為「排隊 / 轉檔中」、**無任何 `ready` / coverage 數字**；watcher panel（`data-testid="minio-watch-panel"`）仍在。

- [ ] **Step 2: Run → fail**

Run: `cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx`
Expected: FAIL（仍讀舊 `listIfcReady`）

- [ ] **Step 3: 改 `ConversionSchedulingPage`**

把資料源從 `coordinatorClient.listIfcReady(50)` 改成 `coordinatorClient.getConversionRecords(50)`，render ledger 紀錄表（欄：專案 / 種類 / 版本 / status / job_id / 偵測時間）；**保留** `minioWatchStatus()` 的 liveness panel 與既有 watch-toggle 控制。status→中文用既有 prov 配色；`usdc_key==null` 標 `p1`「待產生」；coverage `null` 標「未取得」。

- [ ] **Step 4: Run → pass**

Run: `cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx
git commit -m "feat(console): #conv 改讀持久 ConversionLedger（保留 watcher liveness）"
```

---

### Task 7: `#minio` 升級讀真實 list proxy

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`MinioDataPage`，pages.tsx:1078）
- Test: `web-viewer-sample/src/console/MinioDataPage.test.tsx`（既有則擴充，否則新增）

**Interfaces:**
- Consumes：Task 5 `getMinioObjects`。

- [ ] **Step 1: 失敗測試**

`vi.spyOn(coordinatorClient, "getMinioObjects")` 回 `[{key:"松風庵/root/main/000001/model.ifc", role:"source_ifc", project_display_name:"松風庵", category:"main", version:"000001", ...}]`，斷言：render 三層（松風庵 → main → 000001）、`model.ifc` 標 `source IFC`、同夾無 `.usdc` → 標 `pending · 待產生`（prov `p1`）；**移除寫死 demo bucket layout**。

- [ ] **Step 2: Run → fail**

Run: `cd web-viewer-sample && npx vitest run src/console/MinioDataPage.test.tsx`
Expected: FAIL（仍讀 `governanceClient.filesTree()` / 寫死 demo）

- [ ] **Step 3: 改 `MinioDataPage`**

資料源加 `coordinatorClient.getMinioObjects()`，把回傳 objects 依 `project_display_name → category → version` 分組成三層樹 render；每物件依 `role` 標籤（`source IFC` cyan / `parsed_usdc` built / `other` 中性）；專案夾有 `.ifc` 無 `.usdc` → 顯 `pending · 待產生`（`p1`）。頁首保留「唯讀 intake 來源視圖，非 metadata 權威」誠實字樣。移除寫死 `prov="demo"` bucket layout 區塊（或保留為「規約說明」並明標 demo）。

- [ ] **Step 4: Run → pass**

Run: `cd web-viewer-sample && npx vitest run src/console/MinioDataPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/MinioDataPage.test.tsx
git commit -m "feat(console): #minio 改讀真實 GET /api/minio/objects（三層 + 角色，移除寫死 demo）"
```

---

### Task 8: 端到端 e2e + 前端全綠

**Files:**
- Create: `web-viewer-sample/e2e/minio-closed-loop.spec.ts`（照 `e2e/minio-watch-auto-intake.spec.ts` 自帶 harness）
- Test: 上述 spec

**Interfaces:**
- Consumes：完整鏈（coordinator + S3 stub + watcher）。

- [ ] **Step 1: Write e2e（照 minio-watch-auto-intake 模式）**

spawn coordinator（env：`MINIO_WATCH_ENABLED=true` + S3 stub 端點 + `MINIO_WATCH_INTERVAL_SECONDS=1` + `CONVERSION_LEDGER_STORE_PATH=<tmp>`），S3 stub 回一個 `…/000001/model.ifc`。流程：
1. `page.goto(\`${base}/ui#/minio\`)` → 斷言出現該物件 role `source IFC`、`model.usdc` 標 `待產生`。
2. `page.goto(\`${base}/ui#/conv\`)` → 斷言 ledger 紀錄 row 出現該版本、status `排隊/轉檔中`、watcher liveness `啟用中`、**無 `ready` 假狀態**。

- [ ] **Step 2: Run e2e**

Run: `cd web-viewer-sample && npx playwright test e2e/minio-closed-loop.spec.ts`
Expected: PASS

- [ ] **Step 3: 前端全綠 + commit**

Run: `cd web-viewer-sample && npm run verify`
Expected: build + vitest + struct-log 全綠

```bash
git add web-viewer-sample/e2e/minio-closed-loop.spec.ts
git commit -m "test(e2e): MinIO 閉環 #minio/#conv 四段一致、無假 ready"
```

---

## 完成後（DoD 對照）

- 上傳新 `model.ifc`（或 S3 stub）→ `#minio` 出現該物件（role source、`.usdc` 標 `待產生`）✅ Task 7
- ledger 出現 `queued` 紀錄（含 `idempotency_key`）✅ Task 1–3
- `#conv` 可見 job 與**真實** status + watcher liveness ✅ Task 6
- 全程 provenance 正確、**無假 `ready`、無捏造 coverage** ✅ Task 8 守衛
- Phase 2（completion 回填 `usdc_key` / `coverage` / `ready`）由轉檔權威經 callback 回填，**本 Phase 不做**（`recordCallbackOutcome` 已預留）

## 收尾

- 開 PR（base `main`）關聯 issue #250；CI 綠後依 repo 紀律 review。
- `docs/plans` 的 `#minio` 誠實標記已於 #251 更正，**本 Phase 落地後可把「現況僅偵測」更新為「Phase 1：真實 list + 持久 ledger 已建」**。
