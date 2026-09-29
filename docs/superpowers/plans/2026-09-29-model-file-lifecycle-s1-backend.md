# 模型檔案生命週期 S1（契約與後端）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 coordinator 落地 `docs/plans/model-file-session-lifecycle-contract.md` 的 S1：轉檔紀錄帶 `sessions[]` 與 `source_ifc_filename`、已關閉清單帶檔名、`DELETE /api/review-sessions/{sessionId}`（purge）與 `DELETE /api/conversion/records/{key}`（墓碑），契約與生成型別同步，設計正本補卡。

**Architecture:** 連結與檔名推導集中在新的純函式模組 `services/modelFileLinks.ts`，路由只組裝。移除分兩種語意：session 是實體刪檔（`SessionStore.purge`＋`EventLog.remove`），轉檔紀錄是 ledger 墓碑（`ConversionLedger.remove`，`upsert` 遇墓碑忽略）加 intake job 刪除（`ExternalIfcReadyStore.remove`）。兩條 DELETE 掛既有 `rejectIfConversionControlUnauthorized` 守門並寫 audit 事件。

**Tech Stack:** TypeScript（Node 20、Express、zod v4）、vitest＋supertest、契約發射 `npm run contract:emit`、前端型別 `npm run generate:api-types -- --only=bim-review-coordinator`。

**Spec:** `docs/plans/model-file-session-lifecycle-contract.md`（§3 連結規則、§4 契約、§6 資料落地、§7 S1 完成條件）。

## Global Constraints

- 不改凍結檔：`conversion_authority.py`、`governanceProxy.ts`、governance `app.py`；不新增 governance 或 streaming 路由（契約 §4.6）。
- 不改 `POST /api/review-sessions/{sessionId}/close` 的守門與 payload（契約 §4.5）。
- 兩條 DELETE 一律先過 `rejectIfConversionControlUnauthorized`（`app.ts:2287`）。
- ledger 墓碑必須留在 `data/conversion-ledger.json`：watcher 以 `conversionLedger.get(idkey) !== null` 當水印（`app.ts:1311`）。
- `tests/contracts/coordinator-browser-api-v1.openapi.json` 與 `web-viewer-sample/src/generated/coordinator-api.ts` 必須由指令重生；`tests/browser-contract-drift.test.ts` 比對兩者的 sha256。
- 所有程式與受版控檔案只在 sibling worktree 的 branch `feat/model-file-lifecycle-s1` 修改；主 checkout 維持 `main == origin/main` 乾淨。
- 每個 commit 前跑 `git diff --cached --check`；commit 訊息結尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 回覆與文件用繁體中文；程式註解可中英混用但需說明「為什麼」。

## Review Focus

1. 「刪紀錄後 MinIO 物件被重新轉檔」：墓碑仍由 `get()` 回傳，`isLedgered` 為 true。Task 1 的測試 `keeps it in get()/list()` 釘住。
2. 「遲到的轉檔結果讓墓碑復活」：`upsert` 遇墓碑忽略並呼叫 hook。Task 1 的測試 `ignores upsert() on a tombstone` 釘住。
3. 「刪掉仍被 3D 使用的紀錄或 session」：DELETE record 對未結束 session 回 409 `record_in_use`；DELETE session 對非 closed／failed 回 409。Task 8、Task 9 的 409 測試釘住。
4. 「LAN 端非 allowlist 呼叫 DELETE 被靜默放行」：兩條路由第一行就是守門。Task 8 的 403 測試釘住（Task 9 同構）。
5. 「purge 後殘留 in-memory 狀態讓 runtime status 仍列出 session」：purge 呼叫 `viewerLeaseStore.releaseSession` 與 `idleReclaimService.removeSession`，再刪檔。Task 8 的測試在 purge 後查 `GET /api/runtime/status` 不含該 id 釘住。

## File Structure

| 動作 | 路徑 | 責任 |
|---|---|---|
| 建立 | `bim-review-coordinator/src/services/modelFileLinks.ts` | 純函式：session 歸屬（R1–R3）、檔名推導（§3.2）、在途判定（§4.4 表）、未結束 session 篩選 |
| 建立 | `bim-review-coordinator/tests/model-file-links.test.ts` | 上述純函式測試 |
| 建立 | `bim-review-coordinator/tests/conversion-ledger-remove.test.ts` | 墓碑、冪等、upsert 忽略、持久化 |
| 建立 | `bim-review-coordinator/tests/external-ifc-ready-remove.test.ts` | `source_ifc_filename` 與 `remove` |
| 建立 | `bim-review-coordinator/tests/session-purge-route.test.ts` | DELETE session 路由 |
| 建立 | `bim-review-coordinator/tests/conversion-record-remove-route.test.ts` | DELETE record 路由與 `GET /api/conversion/records` 擴充 |
| 建立 | `bim-review-coordinator/tests/closed-sessions-source-filename.test.ts` | 已關閉清單檔名 |
| 修改 | `bim-review-coordinator/src/services/conversionLedger.ts` | 狀態 `removed`、`removed_at`／`removed_by`、`remove()`、`upsert` 守門、hooks |
| 修改 | `bim-review-coordinator/src/services/externalIfcReadyStore.ts` | `source_ifc_filename`、`remove()` |
| 修改 | `bim-review-coordinator/src/types.ts` | `IfcReadyIntakeJob.source_ifc_filename` |
| 修改 | `bim-review-coordinator/src/services/sessionStore.ts` | `purge()` |
| 修改 | `bim-review-coordinator/src/services/eventLog.ts` | `remove()` |
| 修改 | `bim-review-coordinator/src/services/sessionOrigin.ts` | 檔名推導插入 job 檔名 |
| 修改 | `bim-review-coordinator/src/contract/schemas/conversion.ts` | enum、欄位、`ConversionRecordSession`、移除回應、key 參數 |
| 修改 | `bim-review-coordinator/src/contract/schemas/sessions.ts` | `ClosedSessionItem.source_ifc_filename`、purge 回應 |
| 修改 | `bim-review-coordinator/src/contract/schemas/ifcReady.ts` | job 鏡射加欄位 |
| 修改 | `bim-review-coordinator/src/contract/browserContract.ts` | 查詢參數與兩條 DELETE 路由 |
| 修改 | `bim-review-coordinator/src/app.ts` | 三條既有路由擴充、兩條 DELETE、ledger hook |
| 重生 | `tests/contracts/coordinator-browser-api-v1.openapi.json`、`web-viewer-sample/src/generated/coordinator-api.ts` | 契約與型別 |
| 修改 | `docs/plans/AI-BIM 前後端設計文件.dc.html`、`docs/agents/repository-boundaries.md`、`docs/plans/model-file-session-lifecycle-contract.md` | 設計正本卡、邊界、契約狀態 |

---

### Task 0: Worktree 與環境

**Files:**
- 無程式變更；建立 worktree 與 node_modules junction。

- [ ] **Step 1: 建立 governed worktree**

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
pwsh -NoProfile -NonInteractive -File scripts/dev/new-governed-worktree.ps1 -BranchName feat/model-file-lifecycle-s1 -Json
```

Expected: JSON 的 `clean: true`、`head` 等於 `origin_main`，`target` 為 `C:\Repos\active\iot\AI-BIM-governance.worktrees\model-file-lifecycle-s1`。

- [ ] **Step 2: 用 junction 借主 checkout 的 node_modules（不重裝）**

```powershell
$wt = "C:\Repos\active\iot\AI-BIM-governance.worktrees\model-file-lifecycle-s1"
$main = "C:\Repos\active\iot\AI-BIM-governance"
New-Item -ItemType Junction -Path "$wt\bim-review-coordinator\node_modules" -Target "$main\bim-review-coordinator\node_modules"
New-Item -ItemType Junction -Path "$wt\web-viewer-sample\node_modules" -Target "$main\web-viewer-sample\node_modules"
```

Expected: 兩個 junction 建立成功。清理時只能用 `[IO.Directory]::Delete($path)`，且先確認 `(Get-Item $path).Attributes -band [IO.FileAttributes]::ReparsePoint` 非 0；禁止 `Remove-Item -Recurse`（會穿越刪掉主 checkout 的 node_modules）。

- [ ] **Step 3: 基線測試綠燈**

```powershell
cd "$wt\bim-review-coordinator"; npm test
```

Expected: 全綠（含 `browser-contract-drift.test.ts`）。若紅，先停，不進 Task 1。

---

### Task 1: ConversionLedger 墓碑

**Files:**
- Modify: `bim-review-coordinator/src/services/conversionLedger.ts:14-60`（型別）、`:60-70`（建構）、`:137-145`（upsert）、`:204-230`（新方法）、`:273-284`（public 投影）
- Modify: `bim-review-coordinator/src/contract/schemas/conversion.ts:8-31`
- Test: `bim-review-coordinator/tests/conversion-ledger-remove.test.ts`

**Interfaces:**
- Produces: `ConversionLedgerStatus` 多一個 `"removed"`；`ConversionLedgerRecord.removed_at?: string`、`removed_by?: string`；`ConversionLedger.remove(idempotencyKey: string, now: string, actor: string): ConversionLedgerRecord | null`；建構子第二參數 `hooks: ConversionLedgerHooks`（`onUpsertIgnored?(record, input)`）。

- [ ] **Step 1: 寫失敗測試**

`bim-review-coordinator/tests/conversion-ledger-remove.test.ts`：

```ts
// model-file-session-lifecycle-contract §4.4：轉檔紀錄以墓碑移除，列仍留作 watcher 水印。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversionLedger, type ConversionLedgerUpsert } from "../src/services/conversionLedger.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function tempLedgerPath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-ledger-remove-"));
  roots.push(root);
  return path.join(root, "conversion-ledger.json");
}

const baseInput: ConversionLedgerUpsert = {
  idempotency_key: "mw_0123456789abcdef", correlation_id: "minio-watch-01234567",
  project_id: "proj_a", project_display_name: "專案A", category: "建築",
  external_model_version_id: "v1", conversion_job_id: "stream_conv_1", status: "ready",
  object_key: "proj_a/建築/v1/model.ifc", bucket: "bim-control",
};

describe("ConversionLedger.remove (tombstone)", () => {
  it("marks the row removed, keeps it in get()/list(), and persists", () => {
    const file = tempLedgerPath();
    const ledger = new ConversionLedger(file);
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    const removed = ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    expect(removed).toMatchObject({ status: "removed", removed_at: "2026-09-29T00:00:00.000Z", removed_by: "op", object_key: baseInput.object_key });
    expect(ledger.get(baseInput.idempotency_key)?.status).toBe("removed");
    expect(ledger.list().map((row) => row.status)).toEqual(["removed"]);
    const reloaded = new ConversionLedger(file);
    expect(reloaded.get(baseInput.idempotency_key)).toMatchObject({ status: "removed", removed_by: "op" });
  });

  it("is idempotent and returns null for unknown keys", () => {
    const ledger = new ConversionLedger(null);
    expect(ledger.remove("mw_ffffffffffffffff", "2026-09-29T00:00:00.000Z", "op")).toBeNull();
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    const first = ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    const second = ledger.remove(baseInput.idempotency_key, "2026-09-30T00:00:00.000Z", "other");
    expect(second).toEqual(first);
  });

  it("ignores upsert() on a tombstone and reports it through the hook", () => {
    const onUpsertIgnored = vi.fn();
    const ledger = new ConversionLedger(null, { onUpsertIgnored });
    ledger.upsert(baseInput, "2026-09-01T00:00:00.000Z");
    ledger.remove(baseInput.idempotency_key, "2026-09-29T00:00:00.000Z", "op");
    const result = ledger.upsert({ ...baseInput, status: "queued" }, "2026-09-29T01:00:00.000Z");
    expect(result.status).toBe("removed");
    expect(ledger.get(baseInput.idempotency_key)?.status).toBe("removed");
    expect(onUpsertIgnored).toHaveBeenCalledTimes(1);
    expect(onUpsertIgnored.mock.calls[0][0]).toMatchObject({ status: "removed" });
    expect(onUpsertIgnored.mock.calls[0][1]).toMatchObject({ status: "queued" });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
cd "$wt\bim-review-coordinator"; npx vitest run tests/conversion-ledger-remove.test.ts
```

Expected: FAIL，`ledger.remove is not a function`（型別錯誤也算失敗）。

- [ ] **Step 3: 實作**

`conversionLedger.ts` 第 14 行：

```ts
export type ConversionLedgerStatus = "detected" | "queued" | "converting" | "ready" | "failed" | "removed";
```

`ConversionLedgerRecord` 介面在 `updated_at: string;` 之後加：

```ts
  /** 墓碑（model-file-session-lifecycle-contract §4.4）：remove() 寫入；列保留作 watcher 水印。 */
  removed_at?: string;
  removed_by?: string;
```

在 `export class ConversionLedger` 之前加：

```ts
export interface ConversionLedgerHooks {
  /** upsert() 命中墓碑時呼叫；寫入已被忽略（契約 §4.4，避免遲到的轉檔結果讓紀錄復活）。 */
  onUpsertIgnored?: (record: ConversionLedgerRecord, input: ConversionLedgerUpsert) => void;
}
```

建構子改為：

```ts
  constructor(
    private readonly persistencePath: string | null = null,
    private readonly hooks: ConversionLedgerHooks = {},
  ) {
    this.load();
  }
```

`upsert()` 內 `const existing = this.records.get(input.idempotency_key);` 之後加：

```ts
    if (existing?.status === "removed") {
      this.hooks.onUpsertIgnored?.(structuredClone(existing), input);
      return structuredClone(existing);
    }
```

在 `get()` 之前加新方法：

```ts
  /**
   * 墓碑移除（契約 §4.4）。冪等：第二次呼叫回傳既有墓碑不改；未知鍵回 null。
   * 不刪列：MinIO watcher 以「ledger 有紀錄」為水印，刪列會重新轉檔。
   */
  remove(idempotencyKey: string, now: string, actor: string): ConversionLedgerRecord | null {
    this.assertAvailable();
    const existing = this.records.get(idempotencyKey);
    if (!existing) return null;
    if (existing.status === "removed") return structuredClone(existing);
    return this.commitRecord({ ...existing, status: "removed", removed_at: now, removed_by: actor, updated_at: now });
  }
```

`publicConversionRecord()` 回傳物件在 `failure_code: record.failure_code,` 之後加：

```ts
    removed_at: record.removed_at,
    removed_by: record.removed_by,
```

`contract/schemas/conversion.ts`：enum 改為 `"detected", "queued", "converting", "ready", "failed", "removed"`；`publicConversionRecord` 在 `updated_at: isoTimestamp,` 之後加：

```ts
  removed_at: z.string().optional(),
  removed_by: z.string().optional(),
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/conversion-ledger-remove.test.ts tests/conversion-ledger.test.ts tests/conversion-records-route.test.ts
```

Expected: PASS（`Expect<Equal<>>` 型別斷言在 vitest 的 esbuild 下不擋，但 `npm run build` 會；Task 5 前再跑 build）。

- [ ] **Step 5: Commit**

```powershell
git add src/services/conversionLedger.ts src/contract/schemas/conversion.ts tests/conversion-ledger-remove.test.ts
git diff --cached --check; git commit -m "feat(coordinator): conversion ledger tombstone remove() and upsert guard" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: ExternalIfcReadyStore 的檔名與 remove

**Files:**
- Modify: `bim-review-coordinator/src/types.ts:258-259`（`source_ifc_etag` 之後）
- Modify: `bim-review-coordinator/src/contract/schemas/ifcReady.ts:43`（`source_ifc_etag` 之後）
- Modify: `bim-review-coordinator/src/services/externalIfcReadyStore.ts:98-140`（create）、`:377`（新方法）
- Test: `bim-review-coordinator/tests/external-ifc-ready-remove.test.ts`

**Interfaces:**
- Produces: `IfcReadyIntakeJob.source_ifc_filename?: string | null`；`ExternalIfcReadyStore.remove(idempotencyKey: string): number`。

- [ ] **Step 1: 寫失敗測試**

```ts
// model-file-session-lifecycle-contract §3.2（job 檔名）與 §4.4（同鍵 intake job 刪除）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function event(suffix: string, filename: string | null): ExternalIfcReadyEvent {
  return {
    event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t",
    external_model_version_id: `version_${suffix}`, external_conversion_task_id: null,
    source_ifc: { ref: `http://127.0.0.1:1/${suffix}.ifc`, etag: `etag_${suffix}`, filename },
    callback_url: null,
  };
}
function create(store: ExternalIfcReadyStore, suffix: string, filename: string | null = `${suffix}.ifc`) {
  return store.create(event(suffix, filename), {
    correlationId: `corr_${suffix}`, idempotencyKey: `idem_${suffix}`, tenantId: "tenant_t",
    projectId: "project_t", externalModelVersionId: `version_${suffix}`,
  });
}

describe("ExternalIfcReadyStore source_ifc_filename and remove()", () => {
  it("records source_ifc.filename on the job, null when absent", () => {
    const store = new ExternalIfcReadyStore();
    expect(create(store, "a").source_ifc_filename).toBe("a.ifc");
    expect(create(store, "b", null).source_ifc_filename).toBeNull();
  });

  it("removes the job under an idempotency key from every index and persists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "eirs-remove-"));
    roots.push(root);
    const file = path.join(root, "external-ifc-ready.json");
    const store = new ExternalIfcReadyStore(file);
    const kept = create(store, "keep");
    const gone = create(store, "gone");
    expect(store.remove("idem_gone")).toBe(1);
    expect(store.remove("idem_gone")).toBe(0);
    expect(store.get(gone.ifc_ready_job_id)).toBeUndefined();
    expect(store.findExisting("idem_gone", "corr_gone")).toBeUndefined();
    expect(store.getByCorrelation("corr_gone")).toBeUndefined();
    expect(store.list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
    const reloaded = new ExternalIfcReadyStore(file);
    expect(reloaded.list().map((job) => job.ifc_ready_job_id)).toEqual([kept.ifc_ready_job_id]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/external-ifc-ready-remove.test.ts
```

Expected: FAIL（`source_ifc_filename` 為 undefined；`remove` 不存在）。

- [ ] **Step 3: 實作**

`types.ts` 的 `IfcReadyIntakeJob` 在 `source_ifc_etag: string;` 之後加：

```ts
  // model-file-session-lifecycle-contract §3.2：intake 時從事件 source_ifc.filename 記下；舊 job 無此欄位＝null。
  source_ifc_filename?: string | null;
```

`contract/schemas/ifcReady.ts` 的 `ifcReadyIntakeJob` 在 `source_ifc_etag: z.string(),` 之後加：

```ts
  source_ifc_filename: z.string().nullable().optional(),
```

`externalIfcReadyStore.ts` `create()` 的 job 物件在 `source_ifc_etag: event.source_ifc.etag,` 之後加：

```ts
      source_ifc_filename: event.source_ifc.filename ?? null,
```

在 `get(jobId: string)` 之前加：

```ts
  /** 刪除此冪等鍵下的 job（契約 §4.4）；回傳刪除數（0 或 1）。索引一併清掉並持久化。 */
  remove(idempotencyKey: string): number {
    const jobId = this.idempotencyIndex.get(idempotencyKey);
    if (!jobId) return 0;
    this.jobsById.delete(jobId);
    this.idempotencyIndex.delete(idempotencyKey);
    for (const [key, value] of this.correlationIndex) if (value === jobId) this.correlationIndex.delete(key);
    for (const [key, value] of this.sanitizedCorrelationIndex) if (value === jobId) this.sanitizedCorrelationIndex.delete(key);
    this.persist();
    return 1;
  }
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/external-ifc-ready-remove.test.ts tests/external-ifc-ready.test.ts tests/external-ifc-ready-persistence.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/types.ts src/contract/schemas/ifcReady.ts src/services/externalIfcReadyStore.ts tests/external-ifc-ready-remove.test.ts
git diff --cached --check; git commit -m "feat(coordinator): intake job source_ifc_filename and ExternalIfcReadyStore.remove" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: SessionStore.purge 與 EventLog.remove

**Files:**
- Modify: `bim-review-coordinator/src/services/sessionStore.ts:237`（`list()` 之前）
- Modify: `bim-review-coordinator/src/services/eventLog.ts:178`（`list()` 之前）
- Test: 併入 `bim-review-coordinator/tests/session-purge-route.test.ts`（Task 8 建立）之前，先以單元測試釘住：`bim-review-coordinator/tests/session-store-purge.test.ts`

**Interfaces:**
- Produces: `SessionStore.purge(sessionId: string): boolean`；`EventLog.remove(sessionId: string): boolean`。

- [ ] **Step 1: 寫失敗測試**

`bim-review-coordinator/tests/session-store-purge.test.ts`：

```ts
// model-file-session-lifecycle-contract §4.3：purge 只刪 session 檔與事件檔。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../src/services/eventLog.js";
import { SessionStore } from "../src/services/sessionStore.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-purge-unit-"));
  roots.push(root);
  return root;
}

describe("SessionStore.purge and EventLog.remove", () => {
  it("deletes the session file and reports false on a second call", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    const session = store.create({ tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit",
      kit_instance: { kit_instance_id: "kit-1", url: "http://127.0.0.1:49100" } as never });
    expect(store.get(session.session_id)).not.toBeNull();
    expect(store.purge(session.session_id)).toBe(true);
    expect(store.get(session.session_id)).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.purge(session.session_id)).toBe(false);
  });

  it("rejects unsafe ids before touching the filesystem", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    expect(() => store.purge("../etc/passwd")).toThrow();
  });

  it("removes the event file and reports false when there was none", () => {
    const log = new EventLog(path.join(tempRoot(), "events"));
    log.append("review_session_unit000001", "sessionCreated", {});
    expect(log.list("review_session_unit000001")).toHaveLength(1);
    expect(log.remove("review_session_unit000001")).toBe(true);
    expect(log.list("review_session_unit000001")).toEqual([]);
    expect(log.remove("review_session_unit000001")).toBe(false);
  });
});
```

`store.create` 的必填欄位以 `src/services/sessionStore.ts:146-180` 的 `CreateSessionInput` 為準；若 `kit_instance` 的實際型別與上面不同，改成該檔 `KitInstance` 要求的最小物件，測試意圖不變。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/session-store-purge.test.ts
```

Expected: FAIL（`purge`／`remove` 不存在）。

- [ ] **Step 3: 實作**

`sessionStore.ts` 在 `list(): ReviewSession[] {` 之前加：

```ts
  /**
   * 刪除 session 檔（契約 §4.3）。狀態檢查由路由負責；這裡只刪檔。
   * 不碰 .recreation-receipts 與 .corrupt-* 隔離檔；purge 後同 id 永久 404。
   */
  purge(sessionId: string): boolean {
    const file = this.filePath(sessionId); // filePath 內 assertSafeSessionId 擋不安全 id
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }
```

`eventLog.ts` 在 `list(sessionId: string): SessionEvent[] {` 之前加：

```ts
  /** 刪除該 session 的事件檔（契約 §4.3）；不存在回 false。 */
  remove(sessionId: string): boolean {
    const file = this.filePath(sessionId);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/session-store-purge.test.ts tests/unit_sessionstore.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/services/sessionStore.ts src/services/eventLog.ts tests/session-store-purge.test.ts
git diff --cached --check; git commit -m "feat(coordinator): SessionStore.purge and EventLog.remove" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: modelFileLinks 純函式與 sessionOrigin 檔名順序

**Files:**
- Create: `bim-review-coordinator/src/services/modelFileLinks.ts`
- Modify: `bim-review-coordinator/src/services/sessionOrigin.ts:59`
- Test: `bim-review-coordinator/tests/model-file-links.test.ts`

**Interfaces:**
- Produces:
  - `type ConversionRecordSessionLink = "ready_model" | "intake_job" | "artifact_binding"`
  - `interface ConversionRecordSession { session_id; status; created_at; updated_at; link }`
  - `linkSessionsToRecord(record, sessions, jobs): ConversionRecordSession[]`
  - `recordSourceFilename(record, jobs, linkedSessions): string | null`
  - `activeLinkedSessionIds(linked): string[]`
  - `isIntakeJobInFlight(job): boolean`

- [ ] **Step 1: 寫失敗測試**

```ts
// model-file-session-lifecycle-contract §3.1 歸屬規則、§3.2 檔名推導、§4.4 在途判定。
import { describe, expect, it } from "vitest";
import {
  activeLinkedSessionIds, isIntakeJobInFlight, linkSessionsToRecord, recordSourceFilename,
} from "../src/services/modelFileLinks.js";
import type { IfcReadyIntakeJob, ReviewSession } from "../src/types.js";

function session(overrides: Partial<ReviewSession> & Pick<ReviewSession, "session_id">): ReviewSession {
  return {
    tenant_id: "t", project_id: "p", model_version_id: "m", status: "active", mode: "single_kit_shared_state",
    created_by: "unit", created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
    kit_instance: {} as ReviewSession["kit_instance"], artifact_bindings: [], kit_instance_bindings: [], participants: [],
    ...overrides,
  };
}
function job(overrides: Partial<IfcReadyIntakeJob> & Pick<IfcReadyIntakeJob, "idempotency_key">): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: `ifcready_${overrides.idempotency_key}`, status: "accepted", idempotent_replay: false,
    correlation_id: "corr", tenant_id: "t", project_id: "p", external_model_version_id: "m",
    source_ifc_ref: "http://127.0.0.1:1/x.ifc", source_ifc_etag: "e", conversion_job_id: null,
    conversion_status: null, conversion_authority: null, download_status: "pending",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}
const record = { idempotency_key: "mw_0123456789abcdef", conversion_job_id: "stream_conv_1", object_key: null as string | null };

describe("linkSessionsToRecord", () => {
  it("applies R1 ready_model, R2 intake job, R3 artifact binding, first match wins, newest first", () => {
    const r1 = session({ session_id: "review_session_r1", ready_model_id: record.idempotency_key, created_at: "2026-09-03T00:00:00.000Z" });
    const r2 = session({ session_id: "review_session_r2", created_at: "2026-09-02T00:00:00.000Z" });
    const r3 = session({ session_id: "review_session_r3", status: "closed", created_at: "2026-09-01T00:00:00.000Z",
      artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m", artifact_id: "a", artifact_role: "derived",
        url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", conversion_job_id: "stream_conv_1" }] });
    const unrelated = session({ session_id: "review_session_x" });
    const jobs = [job({ idempotency_key: record.idempotency_key, review_session_id: "review_session_r2" })];
    expect(linkSessionsToRecord(record, [unrelated, r3, r2, r1], jobs)).toEqual([
      { session_id: "review_session_r1", status: "active", created_at: r1.created_at, updated_at: r1.updated_at, link: "ready_model" },
      { session_id: "review_session_r2", status: "active", created_at: r2.created_at, updated_at: r2.updated_at, link: "intake_job" },
      { session_id: "review_session_r3", status: "closed", created_at: r3.created_at, updated_at: r3.updated_at, link: "artifact_binding" },
    ]);
  });

  it("does not link through a null conversion_job_id", () => {
    const bound = session({ session_id: "review_session_b", artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m",
      artifact_id: "a", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", conversion_job_id: null }] });
    expect(linkSessionsToRecord({ ...record, conversion_job_id: null }, [bound], [])).toEqual([]);
  });
});

describe("recordSourceFilename", () => {
  it("prefers object_key, then job filename, then a linked session binding, then null", () => {
    const withKey = { ...record, object_key: "proj/建築/v1/model.ifc" };
    expect(recordSourceFilename(withKey, [], [])).toBe("model.ifc");
    const jobs = [job({ idempotency_key: record.idempotency_key, source_ifc_filename: "from_job.ifc" })];
    expect(recordSourceFilename(record, jobs, [])).toBe("from_job.ifc");
    const linked = session({ session_id: "review_session_l", artifact_bindings: [{ binding_id: "b", artifact_group_id: "g", model_version_id: "m",
      artifact_id: "a", artifact_role: "derived", url: null, mapping_url: null, load_order: 0, routing_policy: "same_instance", ready_status: "ready", source_ifc_filename: "from_binding.ifc" }] });
    expect(recordSourceFilename(record, [], [linked])).toBe("from_binding.ifc");
    expect(recordSourceFilename(record, [], [])).toBeNull();
  });
});

describe("activeLinkedSessionIds and isIntakeJobInFlight", () => {
  it("keeps only sessions that are not closed or failed", () => {
    expect(activeLinkedSessionIds([
      { session_id: "a", status: "active", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "c", status: "closed", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "f", status: "failed", created_at: "", updated_at: "", link: "ready_model" },
      { session_id: "n", status: "created", created_at: "", updated_at: "", link: "intake_job" },
    ])).toEqual(["a", "n"]);
  });

  it("follows the contract §4.4 in-flight table", () => {
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "accepted", download_status: "pending" }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "accepted", download_status: "failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "queued_for_conversion" }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: null }))).toBe(true);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: "ready" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatched", conversion_status: "failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dispatch_failed" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "dropped_on_restart" }))).toBe(false);
    expect(isIntakeJobInFlight(job({ idempotency_key: "k", status: "failed" }))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/model-file-links.test.ts
```

Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

`bim-review-coordinator/src/services/modelFileLinks.ts`：

```ts
// 模型檔案 ↔ 審查 session 連結（docs/plans/model-file-session-lifecycle-contract.md §3、§4.4）。
// 純函式：歸屬與檔名由 server 端計算，前端不得自行拼湊。
import type { ConversionLedgerRecord } from "./conversionLedger.js";
import type { IfcReadyIntakeJob, ReviewSession, SessionStatus } from "../types.js";

export type ConversionRecordSessionLink = "ready_model" | "intake_job" | "artifact_binding";

export interface ConversionRecordSession {
  session_id: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  link: ConversionRecordSessionLink;
}

/** §3.1：R1 ready_model_id、R2 intake job 反向參照、R3 binding 的 conversion_job_id；先命中先贏，created_at 降冪。 */
export function linkSessionsToRecord(
  record: Pick<ConversionLedgerRecord, "idempotency_key" | "conversion_job_id">,
  sessions: readonly ReviewSession[],
  jobs: readonly IfcReadyIntakeJob[],
): ConversionRecordSession[] {
  const jobSessionIds = new Set(jobs
    .filter((job) => job.idempotency_key === record.idempotency_key && job.review_session_id)
    .map((job) => job.review_session_id as string));
  const linked: ConversionRecordSession[] = [];
  for (const session of sessions) {
    let link: ConversionRecordSessionLink | null = null;
    if (session.ready_model_id === record.idempotency_key) link = "ready_model";
    else if (jobSessionIds.has(session.session_id)) link = "intake_job";
    else if (record.conversion_job_id !== null
      && session.artifact_bindings.some((binding) => binding.conversion_job_id === record.conversion_job_id)) link = "artifact_binding";
    if (link) {
      linked.push({ session_id: session.session_id, status: session.status, created_at: session.created_at, updated_at: session.updated_at, link });
    }
  }
  return linked.sort((left, right) =>
    Date.parse(right.created_at) - Date.parse(left.created_at) || right.session_id.localeCompare(left.session_id));
}

/** §3.2：object_key 檔名 → intake job 檔名 → 歸屬 session 的 binding 檔名 → null；查無資料不猜。 */
export function recordSourceFilename(
  record: Pick<ConversionLedgerRecord, "idempotency_key" | "object_key">,
  jobs: readonly IfcReadyIntakeJob[],
  linkedSessions: readonly ReviewSession[],
): string | null {
  const keyFilename = record.object_key?.split("/").pop() || null;
  if (keyFilename) return keyFilename;
  const jobFilename = jobs.find((job) => job.idempotency_key === record.idempotency_key && job.source_ifc_filename)?.source_ifc_filename ?? null;
  if (jobFilename) return jobFilename;
  for (const session of linkedSessions) {
    const bindingFilename = session.artifact_bindings.find((binding) => binding.source_ifc_filename)?.source_ifc_filename;
    if (bindingFilename) return bindingFilename;
  }
  return null;
}

/** 歸屬 session 中尚未結束者（closed／failed 以外），供 DELETE 409 record_in_use。 */
export function activeLinkedSessionIds(linked: readonly ConversionRecordSession[]): string[] {
  return linked.filter((item) => item.status !== "closed" && item.status !== "failed").map((item) => item.session_id);
}

/** §4.4 在途判定表：accepted 依 download_status、dispatched 依 conversion_status，其餘終態。 */
export function isIntakeJobInFlight(job: IfcReadyIntakeJob): boolean {
  switch (job.status) {
    case "accepted": return job.download_status !== "failed";
    case "queued_for_conversion": return true;
    case "dispatched": return job.conversion_status !== "ready" && job.conversion_status !== "failed";
    default: return false;
  }
}
```

`sessionOrigin.ts:59` 改為：

```ts
    source_ifc_filename: keyFilename ?? job?.source_ifc_filename ?? bindingFilename,
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/model-file-links.test.ts tests/session-origin.test.ts tests/runtime-status-session-origin.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/services/modelFileLinks.ts src/services/sessionOrigin.ts tests/model-file-links.test.ts
git diff --cached --check; git commit -m "feat(coordinator): model file link rules and source filename derivation" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 契約登錄、OpenAPI 與前端型別重生

**Files:**
- Modify: `bim-review-coordinator/src/contract/schemas/conversion.ts:37-50`
- Modify: `bim-review-coordinator/src/contract/schemas/sessions.ts:319-333`
- Modify: `bim-review-coordinator/src/contract/browserContract.ts:35-42`（import）、`:232-240`（close 之後）、`:401-407`（records 查詢）、`:410-425`（ready-review 之後）
- Regenerate: `tests/contracts/coordinator-browser-api-v1.openapi.json`、`web-viewer-sample/src/generated/coordinator-api.ts`

**Interfaces:**
- Produces（契約 schema 名稱，後續路由回應必須符合）：`ConversionRecordSession`、`ConversionRecordRemovalResponse`、`PurgeReviewSessionResponse`；`ConversionRecordItem` 多 `source_ifc_filename`、`sessions`；`ClosedSessionItem` 多 `source_ifc_filename`；operationId `purgeReviewSession`、`removeConversionRecord`。

- [ ] **Step 1: 先讓 drift 測試變紅（宣告即失敗）**

`contract/schemas/conversion.ts`：在檔頭 import 加 `sessionStatus`：

```ts
import { errorCode, isoTimestamp, named, sessionStatus } from "../primitives.js";
```

在 `conversionRecordItem` 之前加：

```ts
/** GET /api/conversion/records item.sessions[]：server 端算出的歸屬 session（契約 §3.1）。 */
export const conversionRecordSessionLink = named("ConversionRecordSessionLink", z.enum(["ready_model", "intake_job", "artifact_binding"]));
export const conversionRecordSession = named("ConversionRecordSession", z.strictObject({
  session_id: z.string(),
  status: sessionStatus,
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
  link: conversionRecordSessionLink,
}));
```

`conversionRecordItem` 的 extend 內在 `source_sha256: z.string().nullable(),` 之後加：

```ts
  source_ifc_filename: z.string().nullable(),
  sessions: z.array(conversionRecordSession),
```

在 `conversionRecordsResponse` 之後加：

```ts
// ── Conversion record removal (DELETE /api/conversion/records/{key}) ────────
export const conversionRecordKeyParam = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
export const conversionRecordRemovalResponse = named("ConversionRecordRemovalResponse", z.strictObject({
  idempotency_key: z.string(),
  status: z.literal("removed"),
  removed_at: isoTimestamp,
  intake_jobs_removed: z.number(),
}));
```

`contract/schemas/sessions.ts` 的 `closedSessionItem` 在 `recreated_from_session_id: z.string().nullable(),` 之後加：

```ts
  source_ifc_filename: z.string().nullable(),
```

在 `closedSessionPage` 之後加：

```ts
// ── Purge (DELETE /api/review-sessions/{sessionId}) ──────────────────────────
export const purgeReviewSessionResponse = named("PurgeReviewSessionResponse", z.strictObject({
  session_id: z.string(),
  status: z.literal("purged"),
  purged_at: isoTimestamp,
  removed: z.strictObject({ session_file: z.boolean(), events_file: z.boolean() }),
}));
```

`browserContract.ts`：在 `./schemas/conversion.js` 的 import 清單加 `conversionRecordKeyParam,`、`conversionRecordRemovalResponse,`；在 `./schemas/sessions.js` 的清單加 `purgeReviewSessionResponse,`。`listConversionRecords` 的 `query` 改為：

```ts
    query: z.object({ limit: z.string().optional(), include_removed: z.string().optional() }),
```

在 `closeReviewSession` 的 `defineRoute({...})` 之後加：

```ts
  defineRoute({
    operationId: "purgeReviewSession",
    method: "delete",
    path: "/api/review-sessions/{sessionId}",
    summary: "Purge a closed or failed Review Session's coordinator-local records (session file and event log).",
    tags: ["review-sessions"],
    auth: "operator",
    params: sessionParams,
    query: z.object({ reason: z.enum(["manual", "stale_cleanup"]).optional() }),
    responses: { 200: purgeReviewSessionResponse, 400: detailError, 404: errorCodeError, 409: errorCodeError, ...operatorGuard },
  }),
```

在 `openReadyModelReviewSession` 的 `defineRoute({...})` 之後加：

```ts
  defineRoute({
    operationId: "removeConversionRecord",
    method: "delete",
    path: "/api/conversion/records/{key}",
    summary: "Tombstone a conversion record and drop its intake job; the ledger row stays as the MinIO watcher watermark.",
    tags: ["conversion"],
    auth: "operator",
    params: z.object({ key: conversionRecordKeyParam }),
    responses: { 200: conversionRecordRemovalResponse, 400: errorCodeError, 404: errorCodeError, 409: errorCodeError, ...operatorGuard },
  }),
```

- [ ] **Step 2: 跑 drift 測試確認失敗**

```powershell
npx vitest run tests/browser-contract-drift.test.ts
```

Expected: FAIL，`equals a fresh emission`。

- [ ] **Step 3: 重生契約與前端型別**

```powershell
cd "$wt\bim-review-coordinator"; npm run contract:emit
cd "$wt\web-viewer-sample"; npm run generate:api-types -- --only=bim-review-coordinator
```

Expected: 第一行印 `wrote tests/contracts/coordinator-browser-api-v1.openapi.json`；第二行重寫 `src/generated/coordinator-api.ts` 且檔頭 `source-sha256` 更新（此步驟用 `npx -y openapi-typescript@7`，離線時先在主 checkout 跑一次讓 npx 快取）。

- [ ] **Step 4: 跑測試與 build 確認通過**

```powershell
cd "$wt\bim-review-coordinator"; npx vitest run tests/browser-contract-drift.test.ts; npm run build; npm run contract:check
cd "$wt\web-viewer-sample"; npx tsc --noEmit
```

Expected: 全部 PASS。前端 `tsc` 綠代表新增欄位對既有型別使用者是 additive。

- [ ] **Step 5: Commit**

```powershell
cd "$wt"
git add bim-review-coordinator/src/contract tests/contracts/coordinator-browser-api-v1.openapi.json web-viewer-sample/src/generated/coordinator-api.ts
git diff --cached --check; git commit -m "feat(contract): purgeReviewSession, removeConversionRecord, record sessions[] and source filenames" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `GET /api/conversion/records` 加 `sessions[]`、`source_ifc_filename`、`include_removed`

**Files:**
- Modify: `bim-review-coordinator/src/app.ts:3188-3210`；檔頭 import
- Test: `bim-review-coordinator/tests/conversion-record-remove-route.test.ts`（本 task 先寫 GET 部分，Task 9 追加 DELETE）

**Interfaces:**
- Consumes: Task 4 的 `linkSessionsToRecord`、`recordSourceFilename`。

- [ ] **Step 1: 寫失敗測試**

```ts
// model-file-session-lifecycle-contract §4.1（GET 擴充）與 §4.4（DELETE，Task 9 追加）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;

const READY_KEY = "mw_aaaa0000bbbb0001";
function ledgerRecord(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: READY_KEY, correlation_id: "minio-watch-aa000001", project_id: "proj_a",
    project_display_name: "專案A", category: "建築", external_model_version_id: "v1",
    object_key: "proj_a/建築/v1/model.ifc", bucket: "bim-control", conversion_job_id: "stream_conv_a",
    status: "ready", coverage_report: null, usdc_key: "proj_a/建築/v1/model.usdc",
    detected_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...overrides,
  };
}
function makeApp(ledgerRecords: unknown[], overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-record-remove-"));
  const ledgerPath = path.join(root, "conversion-ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: "conversion-ledger/v2", records: ledgerRecords }, null, 2), "utf-8");
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"), conversionLedgerStorePath: ledgerPath,
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false, minioWatchBucket: "bim-control", ...overrides,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function createBoundSession(app: CoordinatorApp, suffix: string, conversionJobId: string, filename?: string): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_${suffix}`, model_version_id: `model_${suffix}`,
    artifact_bindings: [{ artifact_group_id: `group_${suffix}`, artifact_id: `artifact_${suffix}`, artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`, mapping_url: null, load_order: 0, ready_status: "ready",
      conversion_authority: "bim-streaming-server", conversion_job_id: conversionJobId, source_ifc_filename: filename ?? null }],
  });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}
function createIntakeJob(app: CoordinatorApp, idempotencyKey: string, filename: string | null, reviewSessionId?: string) {
  const event: ExternalIfcReadyEvent = {
    event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t", external_model_version_id: "version_t",
    external_conversion_task_id: null, source_ifc: { ref: "http://127.0.0.1:1/t.ifc", etag: "etag_t", filename }, callback_url: null,
  };
  const job = app.externalIfcReadyStore.create(event, { correlationId: `corr_${idempotencyKey}`, idempotencyKey,
    tenantId: "tenant_t", projectId: "project_t", externalModelVersionId: "version_t" });
  if (reviewSessionId) app.externalIfcReadyStore.recordReviewSession(job.ifc_ready_job_id, reviewSessionId);
  return job;
}

describe("GET /api/conversion/records with sessions[] and source_ifc_filename", () => {
  it("links sessions by artifact binding and reports the object_key filename", async () => {
    const app = makeApp([ledgerRecord()]);
    const sessionId = await createBoundSession(app, "a", "stream_conv_a");
    const res = await request(app.app).get("/api/conversion/records");
    expect(res.status).toBe(200);
    expect(res.body.items[0].source_ifc_filename).toBe("model.ifc");
    expect(res.body.items[0].sessions).toEqual([expect.objectContaining({ session_id: sessionId, link: "artifact_binding" })]);
  });

  it("falls back to the intake job filename when object_key is null", async () => {
    const app = makeApp([ledgerRecord({ idempotency_key: "idem_devreg_1", object_key: null, bucket: null })]);
    createIntakeJob(app, "idem_devreg_1", "villa.ifc");
    const res = await request(app.app).get("/api/conversion/records");
    expect(res.body.items[0]).toMatchObject({ source_ifc_filename: "villa.ifc", sessions: [] });
  });

  it("hides removed records unless include_removed=1", async () => {
    const app = makeApp([ledgerRecord(), ledgerRecord({ idempotency_key: "mw_aaaa0000bbbb0002", conversion_job_id: "stream_conv_b",
      status: "removed", removed_at: "2026-09-02T00:00:00.000Z", removed_by: "op" })]);
    const hidden = await request(app.app).get("/api/conversion/records");
    expect(hidden.body.count).toBe(1);
    expect(hidden.body.items.map((item: { idempotency_key: string }) => item.idempotency_key)).toEqual([READY_KEY]);
    const shown = await request(app.app).get("/api/conversion/records?include_removed=1");
    expect(shown.body.count).toBe(2);
    expect(shown.body.items.find((item: { idempotency_key: string }) => item.idempotency_key === "mw_aaaa0000bbbb0002"))
      .toMatchObject({ status: "removed", removed_at: "2026-09-02T00:00:00.000Z", removed_by: "op" });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/conversion-record-remove-route.test.ts
```

Expected: FAIL（`source_ifc_filename`／`sessions` 為 undefined；removed 未被隱藏）。

- [ ] **Step 3: 實作**

`app.ts` 檔頭在 `import { ConversionLedger, publicConversionRecord } from "./services/conversionLedger.js";` 之後加：

```ts
import {
  activeLinkedSessionIds, isIntakeJobInFlight, linkSessionsToRecord, recordSourceFilename,
} from "./services/modelFileLinks.js";
import { deriveSessionOrigin } from "./services/sessionOrigin.js";
```

`GET /api/conversion/records` 路由整段改為：

```ts
  app.get("/api/conversion/records", (request, response) => {
    const limit = parseListLimit(request.query.limit);
    const key = typeof request.query.object_key === "string" ? request.query.object_key : null;
    const sourceId = typeof request.query.source_id === "string" ? request.query.source_id : null;
    // model-file-session-lifecycle-contract §4.1：墓碑預設隱藏；count 反映過濾後數量。
    const includeRemoved = request.query.include_removed === "1";
    const items = conversionLedger.list().filter(row => (includeRemoved || row.status !== "removed") && (key === null
      || (row.object_key === key && row.bucket === config.minioWatchBucket)
      || (row.object_key === null && row.idempotency_key === sourceId)));
    const jobs = externalIfcReadyStore.list();
    const sessions = store.list();
    const intakeByResult = new Map(jobs.map(job => [job.idempotency_key, job]));
    response.json({ count: items.length, items: items.slice(0, limit).map(row => {
      const fact = row.validation_records?.find(item => item.conversionJobId === row.conversion_job_id
        && item.readyModelId === row.idempotency_key);
      const intake = intakeByResult.get(row.idempotency_key);
      const failure = intake ? deriveFailure(intake) : null;
      // Public reason codes, not raw errors that can contain signed URLs or host paths.
      const failureCode = row.failure_code ?? (failure?.failure_stage === "dispatch" ? "dispatch_unconfirmed"
        : failure?.failure_stage === "download" ? "source_download_failed"
        : failure?.failure_stage === "conversion" ? "conversion_failed" : null);
      // §3.1／§3.2：歸屬與檔名由 server 端計算，前端不得自行拼湊。
      const linked = linkSessionsToRecord(row, sessions, jobs);
      const linkedSessions = sessions.filter(session => linked.some(item => item.session_id === session.session_id));
      return { ...publicConversionRecord(row), converter_version: fact?.converterVersion ?? null,
        failure_code: failureCode, dispatch_state: intake?.status ?? null,
        conversion_job_id: row.conversion_job_id ?? intake?.conversion_job_id ?? null,
        source_sha256: fact?.source.sha256 ?? null,
        source_ifc_filename: recordSourceFilename(row, jobs, linkedSessions),
        sessions: linked };
    }) });
  });
```

`activeLinkedSessionIds`、`isIntakeJobInFlight`、`deriveSessionOrigin` 在 Task 7 與 Task 9 使用；本步驟先 import 會讓 eslint 報 unused，若 `npm run build` 因 `noUnusedLocals` 失敗，先只 import 本 task 用到的兩個，Task 7／9 再補。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/conversion-record-remove-route.test.ts tests/conversion-records-route.test.ts tests/ledger-chip-status.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/app.ts tests/conversion-record-remove-route.test.ts
git diff --cached --check; git commit -m "feat(coordinator): conversion records carry linked sessions, source filename and include_removed" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 已關閉清單加 `source_ifc_filename`

**Files:**
- Modify: `bim-review-coordinator/src/app.ts:2038-2055`
- Test: `bim-review-coordinator/tests/closed-sessions-source-filename.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// model-file-session-lifecycle-contract §4.2：已關閉清單帶檔名（推導同 §3.2）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;
function makeApp(): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "closed-filename-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
  });
  return active;
}
afterEach(async () => {
  vi.restoreAllMocks();
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function closedSession(app: CoordinatorApp, suffix: string, filename: string | null): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_${suffix}`, model_version_id: `model_${suffix}`,
    artifact_bindings: [{ artifact_group_id: `group_${suffix}`, artifact_id: `artifact_${suffix}`, artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`, mapping_url: null, load_order: 0, ready_status: "ready",
      conversion_authority: "bim-streaming-server", source_ifc_filename: filename }],
  });
  expect(created.status).toBe(200);
  const closed = await request(app.app).post(`/api/review-sessions/${created.body.session_id}/close`).send({ reason: "test fixture" });
  expect(closed.status).toBe(200);
  return created.body.session_id as string;
}

describe("GET /api/review-sessions?status=closed source_ifc_filename", () => {
  it("returns the binding filename, and null when nothing is known", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const app = makeApp();
    const named = await closedSession(app, "named", "villa.ifc");
    const anonymous = await closedSession(app, "anon", null);
    const res = await request(app.app).get("/api/review-sessions?status=closed");
    expect(res.status).toBe(200);
    const byId = new Map(res.body.items.map((item: { session_id: string; source_ifc_filename: string | null }) => [item.session_id, item.source_ifc_filename]));
    expect(byId.get(named)).toBe("villa.ifc");
    expect(byId.get(anonymous)).toBeNull();
  });
});
```

`vi.spyOn(globalThis, "fetch")` 比照 `tests/sessions.test.ts:169`：closed 清單會算 `rebuildability`，需要擋掉對 artifact URL 的探測。

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/closed-sessions-source-filename.test.ts
```

Expected: FAIL（`source_ifc_filename` 為 undefined）。

- [ ] **Step 3: 實作**

`app.ts` closed 路由：在 `const page = closed.slice(0, limit);` 之前加：

```ts
      // model-file-session-lifecycle-contract §4.2：檔名推導與 runtime status 同源（deriveSessionOrigin）。
      const jobs = externalIfcReadyStore.list();
      const sourceFilenameFor = (session: ReviewSession): string | null => {
        let record: ConversionLedgerRecord | null = null;
        if (session.ready_model_id) {
          try { record = conversionLedger.get(session.ready_model_id); } catch { record = null; }
        }
        const job = (session.ready_model_id ? jobs.find((item) => item.idempotency_key === session.ready_model_id) : undefined)
          ?? jobs.find((item) => item.review_session_id === session.session_id) ?? null;
        return deriveSessionOrigin(session, record, job, config.minioWatchBucket || null).source_ifc_filename;
      };
```

`items` 的 map 物件在 `recreated_from_session_id: session.recreated_from_session_id ?? null,` 之後加：

```ts
        source_ifc_filename: sourceFilenameFor(session),
```

`ReviewSession`、`ConversionLedgerRecord` 型別若檔頭尚未 import，於 `import type { ... } from "./types.js";` 補 `ReviewSession`，於 conversionLedger 的 import 補 `type ConversionLedgerRecord`。

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/closed-sessions-source-filename.test.ts tests/sessions.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/app.ts tests/closed-sessions-source-filename.test.ts
git diff --cached --check; git commit -m "feat(coordinator): closed session list carries source_ifc_filename" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `DELETE /api/review-sessions/:sessionId`

**Files:**
- Modify: `bim-review-coordinator/src/app.ts:2822`（`/close` 路由之後、`/activity` 之前）
- Test: `bim-review-coordinator/tests/session-purge-route.test.ts`

**Interfaces:**
- Consumes: Task 3 `store.purge`、`eventLog.remove`；既有 `viewerLeaseStore.releaseSession`、`idleReclaimService.removeSession`、`resolveActor`、`rejectIfConversionControlUnauthorized`、`structLog.audit`。

- [ ] **Step 1: 寫失敗測試**

```ts
// model-file-session-lifecycle-contract §4.3：purge 已結束 session 的 coordinator 本地紀錄。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;
function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "session-purge-route-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false, ...overrides,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function createSession(app: CoordinatorApp, suffix: string): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({ project_id: `project_${suffix}`, model_version_id: `model_${suffix}` });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}
async function closeSession(app: CoordinatorApp, sessionId: string): Promise<void> {
  const closed = await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({ reason: "test fixture" });
  expect(closed.status).toBe(200);
}

describe("DELETE /api/review-sessions/:sessionId (purge)", () => {
  it("removes the session file and event log of a closed session; the id is gone everywhere afterwards", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "a");
    await closeSession(app, sessionId);
    const sessionFile = path.join(root as string, "sessions", `${sessionId}.json`);
    const eventsFile = path.join(root as string, "events", `${sessionId}.jsonl`);
    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(fs.existsSync(eventsFile)).toBe(true);

    const purged = await request(app.app).delete(`/api/review-sessions/${sessionId}?reason=stale_cleanup`);
    expect(purged.status).toBe(200);
    expect(purged.body).toMatchObject({ session_id: sessionId, status: "purged", removed: { session_file: true, events_file: true } });
    expect(purged.body.purged_at).toEqual(expect.any(String));
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(fs.existsSync(eventsFile)).toBe(false);

    expect((await request(app.app).get(`/api/review-sessions/${sessionId}`)).status).toBe(404);
    const runtime = await request(app.app).get("/api/runtime/status");
    expect(runtime.body.sessions.items.map((item: { session_id: string }) => item.session_id)).not.toContain(sessionId);
    const archive = await request(app.app).get("/api/review-sessions?status=closed");
    expect(archive.body.items.map((item: { session_id: string }) => item.session_id)).not.toContain(sessionId);
    const again = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error_code: "review_session_not_found" });
  });

  it("refuses a session that is not closed or failed with 409 review_session_not_closed", async () => {
    const app = makeApp();
    const sessionId = await createSession(app, "b");
    const refused = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error_code).toBe("review_session_not_closed");
    expect(["created", "active"]).toContain(refused.body.status);
    expect((await request(app.app).get(`/api/review-sessions/${sessionId}`)).status).toBe(200);
  });

  it("400 on an unsafe id and 404 on an unknown id", async () => {
    const app = makeApp();
    expect((await request(app.app).delete("/api/review-sessions/not%20a%20session")).status).toBe(400);
    const unknown = await request(app.app).delete("/api/review-sessions/review_session_000000000000");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error_code: "review_session_not_found" });
  });

  it("403 when the conversion-control guard rejects the caller", async () => {
    const app = makeApp({ conversionTriggerIpAllowlist: ["10.99.0.1"], devAuthToken: "dev-token" });
    const sessionId = await createSession(app, "c");
    await closeSession(app, sessionId);
    const refused = await request(app.app).delete(`/api/review-sessions/${sessionId}`);
    expect(refused.status).toBe(403);
    expect(fs.existsSync(path.join(root as string, "sessions", `${sessionId}.json`))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/session-purge-route.test.ts
```

Expected: FAIL（DELETE 回 404 Express 預設或非預期 body）。

- [ ] **Step 3: 實作**

`app.ts` 在 `/close` 路由的 `});` 之後、`app.post("/api/review-sessions/:sessionId/activity"` 之前加：

```ts
  // model-file-session-lifecycle-contract §4.3：purge 已結束 session 的 coordinator 本地紀錄。
  // 與 close 不同，purge 是 operator-only：掛 conversion 控制路由同一組守門（IP allowlist 或 operator token）。
  app.delete("/api/review-sessions/:sessionId", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
    const sessionId = request.params.sessionId;
    if (!isSafeSessionId(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    const session = store.get(sessionId);
    if (!session) {
      response.status(404).json({ error_code: "review_session_not_found" });
      return;
    }
    if (session.status !== "closed" && session.status !== "failed") {
      response.status(409).json({ error_code: "review_session_not_closed", status: session.status });
      return;
    }
    const actor = resolveActor(request);
    const reason = request.query.reason === "stale_cleanup" ? "stale_cleanup" : "manual";
    // 釋放以 session id 為鍵的記憶體狀態（close 已做過，這裡再做一次是冪等的保險）。
    viewerLeaseStore.releaseSession(sessionId);
    idleReclaimService.removeSession(sessionId);
    const eventsFileRemoved = eventLog.remove(sessionId);
    const sessionFileRemoved = store.purge(sessionId);
    const purgedAt = new Date().toISOString();
    structLog.withTraceId(session.trace_id ?? `rev_${sessionId}`).audit("session-lifecycle", "session.purge", {
      action: "session.purge", actor, target: sessionId, reason, previous_status: session.status,
      session_file_removed: sessionFileRemoved, events_file_removed: eventsFileRemoved,
    });
    response.json({
      session_id: sessionId, status: "purged", purged_at: purgedAt,
      removed: { session_file: sessionFileRemoved, events_file: eventsFileRemoved },
    });
  });
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/session-purge-route.test.ts tests/sessions.test.ts tests/session-idle-reclaim.test.ts tests/conversion-control-auth.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/app.ts tests/session-purge-route.test.ts
git diff --cached --check; git commit -m "feat(coordinator): DELETE /api/review-sessions/:sessionId purges closed sessions" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `DELETE /api/conversion/records/:key` 與 ledger hook

**Files:**
- Modify: `bim-review-coordinator/src/app.ts:1134`（ledger 建構）、`:3214` 之前（新路由，放在 `POST /api/conversion/records/:readyModelId/review-session` 之前）
- Test: 追加到 `bim-review-coordinator/tests/conversion-record-remove-route.test.ts`

**Interfaces:**
- Consumes: Task 1 `conversionLedger.remove`＋hooks、Task 2 `externalIfcReadyStore.remove`、Task 4 `activeLinkedSessionIds`、`isIntakeJobInFlight`、`linkSessionsToRecord`。

- [ ] **Step 1: 追加失敗測試**

在 Task 6 的測試檔末尾加：

```ts
describe("DELETE /api/conversion/records/:key", () => {
  it("tombstones a record nobody uses, drops its intake job, hides it from the list and stays a watermark", async () => {
    const app = makeApp([ledgerRecord({ idempotency_key: "idem_devreg_2", object_key: null, bucket: null, conversion_job_id: "stream_conv_d" })]);
    const job = createIntakeJob(app, "idem_devreg_2", "old.ifc");
    app.externalIfcReadyStore.markDownloadFailed(job.ifc_ready_job_id, "source gone");
    const removed = await request(app.app).delete("/api/conversion/records/idem_devreg_2");
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ idempotency_key: "idem_devreg_2", status: "removed", intake_jobs_removed: 1 });
    expect(removed.body.removed_at).toEqual(expect.any(String));
    expect((await request(app.app).get("/api/conversion/records")).body.count).toBe(0);
    expect((await request(app.app).get("/api/external/ifc-ready")).body.count).toBe(0);
    expect((await request(app.app).get("/api/conversion/records?include_removed=1")).body.items[0]).toMatchObject({ status: "removed", removed_by: "local-operator" });
    const replay = await request(app.app).delete("/api/conversion/records/idem_devreg_2");
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ status: "removed", removed_at: removed.body.removed_at, intake_jobs_removed: 0 });
  });

  it("409 record_in_use while a linked session is not closed, then 200 after closing it", async () => {
    const app = makeApp([ledgerRecord()]);
    const sessionId = await createBoundSession(app, "a", "stream_conv_a");
    const refused = await request(app.app).delete(`/api/conversion/records/${READY_KEY}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error_code: "record_in_use", sessions: [sessionId] });
    await request(app.app).post(`/api/review-sessions/${sessionId}/close`).send({ reason: "test fixture" });
    expect((await request(app.app).delete(`/api/conversion/records/${READY_KEY}`)).status).toBe(200);
  });

  it("409 record_in_flight while the intake job can still transition", async () => {
    const app = makeApp([ledgerRecord({ idempotency_key: "idem_devreg_3", object_key: null, bucket: null, conversion_job_id: null, status: "queued" })]);
    createIntakeJob(app, "idem_devreg_3", "busy.ifc");
    const refused = await request(app.app).delete("/api/conversion/records/idem_devreg_3");
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error_code: "record_in_flight", intake_status: "accepted" });
  });

  it("400 on a malformed key, 404 on an unknown key, 403 when the guard rejects", async () => {
    const app = makeApp([ledgerRecord()]);
    expect((await request(app.app).delete("/api/conversion/records/bad%20key")).body).toEqual({ error_code: "invalid_record_key" });
    expect((await request(app.app).delete("/api/conversion/records/mw_ffffffffffffffff")).body).toEqual({ error_code: "record_not_found" });
    await active?.dispose(); active?.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null;
    const guarded = makeApp([ledgerRecord()], { conversionTriggerIpAllowlist: ["10.99.0.1"], devAuthToken: "dev-token" });
    expect((await request(guarded.app).delete(`/api/conversion/records/${READY_KEY}`)).status).toBe(403);
    expect((await request(guarded.app).get("/api/conversion/records")).body.count).toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```powershell
npx vitest run tests/conversion-record-remove-route.test.ts
```

Expected: 新的四個測試 FAIL。

- [ ] **Step 3: 實作**

`app.ts:1134` 的 ledger 建構改為（`structLog` 在 `:775` 已宣告）：

```ts
  const conversionLedger = new ConversionLedger(config.conversionLedgerStorePath, {
    // 契約 §4.4：遲到的轉檔結果打到墓碑時忽略並留稽核，不讓紀錄復活。
    onUpsertIgnored: (record, input) => structLog
      .withTraceId(`external_${record.idempotency_key.replace(/[^A-Za-z0-9_-]/g, "_")}`)
      .audit("conversion-ledger", "conversion.ledger.upsert_ignored", {
        action: "conversion.ledger.upsert_ignored", actor: "system", target: record.idempotency_key,
        attempted_status: input.status, removed_at: record.removed_at ?? null,
      }),
  });
```

在 `app.post("/api/conversion/records/:readyModelId/review-session"` 之前加：

```ts
  // model-file-session-lifecycle-contract §4.4：轉檔紀錄墓碑＋intake job 刪除；streaming job／artifact 與 governance 不動。
  app.delete("/api/conversion/records/:key", (request, response) => {
    if (rejectIfConversionControlUnauthorized(request, response)) return;
    const key = request.params.key;
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(key)) {
      response.status(400).json({ error_code: "invalid_record_key" });
      return;
    }
    const record = conversionLedger.get(key);
    if (!record) {
      response.status(404).json({ error_code: "record_not_found" });
      return;
    }
    if (record.status === "removed") {
      response.json({ idempotency_key: key, status: "removed", removed_at: record.removed_at ?? record.updated_at, intake_jobs_removed: 0 });
      return;
    }
    const jobs = externalIfcReadyStore.list();
    const inUse = activeLinkedSessionIds(linkSessionsToRecord(record, store.list(), jobs));
    if (inUse.length > 0) {
      response.status(409).json({ error_code: "record_in_use", sessions: inUse });
      return;
    }
    const job = jobs.find((item) => item.idempotency_key === key) ?? null;
    if (job && isIntakeJobInFlight(job)) {
      response.status(409).json({ error_code: "record_in_flight", intake_status: job.status });
      return;
    }
    const actor = resolveActor(request);
    const now = new Date().toISOString();
    const removed = conversionLedger.remove(key, now, actor);
    const intakeJobsRemoved = externalIfcReadyStore.remove(key);
    structLog.withTraceId(job?.ifc_ready_job_id ?? `external_${key.replace(/[^A-Za-z0-9_-]/g, "_")}`)
      .audit("conversion-control", "conversion.record.remove", {
        action: "conversion.record.remove", actor, target: key, previous_status: record.status,
        intake_jobs_removed: intakeJobsRemoved,
      });
    response.json({ idempotency_key: key, status: "removed", removed_at: removed?.removed_at ?? now, intake_jobs_removed: intakeJobsRemoved });
  });
```

- [ ] **Step 4: 跑測試確認通過**

```powershell
npx vitest run tests/conversion-record-remove-route.test.ts tests/conversion-ledger-intake-integration.test.ts tests/minio-watch-surface.test.ts tests/reconversion*.test.ts
```

Expected: PASS。`minio-watch-surface.test.ts` 綠代表 `isLedgered` 語意未變；重派轉檔以新 intent 鍵建紀錄，不受墓碑影響（契約 §4.4 已如此規定）。

- [ ] **Step 5: Commit**

```powershell
git add src/app.ts tests/conversion-record-remove-route.test.ts
git diff --cached --check; git commit -m "feat(coordinator): DELETE /api/conversion/records/:key tombstones records and drops intake jobs" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 設計正本、邊界文件與契約狀態

**Files:**
- Modify: `docs/plans/AI-BIM 前後端設計文件.dc.html:255`（`c4-closed-session-recreate` 卡之後）
- Modify: `docs/agents/repository-boundaries.md:7`
- Modify: `docs/plans/model-file-session-lifecycle-contract.md`（狀態行）

- [ ] **Step 1: 設計正本 §04 補卡**

在 `data-canon-id="c4-closed-session-recreate"` 的 `</div>` 之後（同層）插入：

```html
        <div data-canon-id="c4-model-file-lifecycle" style="padding:10px 12px;border-top:1px solid rgba(120,160,210,.07);font-size:10.5px;color:#8aa0b8"><span style="color:#e6b23e">模型檔案與紀錄生命週期（docs/plans/model-file-session-lifecycle-contract.md）：</span>GET /api/conversion/records 每筆帶 server 端算出的 sessions[]（link：ready_model／intake_job／artifact_binding）與 source_ifc_filename，?include_removed=1 才列墓碑；GET /api/review-sessions?status=closed 帶 source_ifc_filename。DELETE /api/review-sessions/{sessionId} 只對 closed／failed 生效，刪 session 檔與事件檔，之後永久 404（舊 ID 永不復活不變）；DELETE /api/conversion/records/{key} 把 ledger 列改成 removed 墓碑（仍是 watcher 水印）並刪同鍵 intake job，被未結束 session 引用回 409 record_in_use、intake 在途回 409 record_in_flight。兩條 DELETE 掛 conversion 控制路由的守門；不刪 streaming job／artifact，不動 governance。</div>
```

- [ ] **Step 2: 邊界文件**

`docs/agents/repository-boundaries.md:7` 的 coordinator 責任欄末尾加「、session 與轉檔紀錄的 coordinator 本地清除（purge／tombstone，`docs/plans/model-file-session-lifecycle-contract.md`）」；不責任欄不變。

- [ ] **Step 3: 契約文件狀態行**

`docs/plans/model-file-session-lifecycle-contract.md` 第 3 行「狀態：**草案，待 owner 審閱**」改為「狀態：**S1 實作中（分支 `feat/model-file-lifecycle-s1`）；S2、S3 未開始**」。

- [ ] **Step 4: 檢查結構化日誌契約不需改**

```powershell
cd "$wt"; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider -q -k "structured_log or contract"
```

Expected: PASS。audit 的 `data` 只要求 `action`、`actor`、`target`，新事件的額外欄位是允許的；若此步驟紅，把新欄位加進 `tests/contracts/structured-log/schema.json` 的 audit 分支後再跑。

- [ ] **Step 5: Commit**

```powershell
git add "docs/plans/AI-BIM 前後端設計文件.dc.html" docs/agents/repository-boundaries.md docs/plans/model-file-session-lifecycle-contract.md
git diff --cached --check; git commit -m "docs: model file lifecycle card in design canon, coordinator boundary, contract status" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 全量驗證與 PR

**Files:**
- 無新增；驗證與交付。

- [ ] **Step 1: coordinator 全量**

```powershell
cd "$wt\bim-review-coordinator"; npm test; npm run build; npm run contract:check
```

Expected: 三者全綠。

- [ ] **Step 2: viewer 型別與測試**

```powershell
cd "$wt\web-viewer-sample"; npx tsc --noEmit; npm test
```

Expected: 綠。生成型別只增欄位，既有前端不受影響。

- [ ] **Step 3: root contracts**

```powershell
cd "$wt"; C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider -q
```

Expected: 綠。

- [ ] **Step 4: 本機真 API 煙霧（不需 Kit）**

啟動主 checkout 既有的 coordinator（或 worktree 內以臨時 `SESSION_STORE_DIR`／`EVENT_LOG_DIR`／`CONVERSION_LEDGER_STORE_PATH` 指向 `%TEMP%` 下的複本），用 Python urllib 依序：`GET /api/conversion/records` 看到 `sessions[]`；對一個已關閉 session `DELETE` 回 200 後 `GET` 回 404；重啟 coordinator 後該 session 仍不存在、墓碑仍在 ledger 檔。把回應 JSON 存到 `docs/evidence/model-file-lifecycle-2026-09-29/s1-smoke/`。此步驟不改真實 `data/`。

- [ ] **Step 5: PR**

```powershell
cd "$wt"; git push -u origin feat/model-file-lifecycle-s1
```

用 Write 工具寫 PR body 檔（不要在指令列內嵌），內容依 `.github/PULL_REQUEST_TEMPLATE.md` 七段：`## 變更摘要`、`## 修改原因`、`## 主要變更`、`## 驗證方式`（列 Step 1–4 的實際指令與結果）、`## 風險與影響`（墓碑語意、governance 孤兒引用、LAN 守門）、`## 回滾方式`（revert 單一 PR；ledger 墓碑列在舊版程式下會以未知狀態顯示，不影響 watcher）、`## 後續建議`（S2 前端、S3 E2E 與部署、streaming artifact 維運腳本）；另附「Change Classification」表；結尾加 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

```powershell
gh pr create --base main --head feat/model-file-lifecycle-s1 --title "feat(coordinator): model file lifecycle S1 - record links, session purge, record tombstone" --body-file <pr-body 路徑>
```

之後依 repo 規則：等 `pr-safety` 綠、agent 自審完整 diff 給可否合併判定、thread 全部 resolve，再依 owner 的常設授權合併並 `git fetch --prune`。合併後 S2 計畫才能開始（它要引用本 PR 合併後的生成型別）。
