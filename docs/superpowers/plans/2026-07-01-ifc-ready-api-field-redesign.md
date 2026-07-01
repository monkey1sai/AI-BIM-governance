# ifc-ready API 欄位重新設計 Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 讓 `summarizeIfcReadyJob`(GET /api/external/ifc-ready 列表)投影三視圖對帳主鍵 `idempotency_key` 與誠實觀測欄位(`failure_reason`/`failure_stage`/`usdc_role`/`data_volatility`/`idempotent_replay`/`conversion_lifecycle_status`/`project_display_name`/`category`),前端 `#/conv` 的「Ifc-ready jobs」表據以與 ledger / minio 視圖對齊,並以 browser E2E 佐證。

**Architecture:** coordinator(`bim-review-coordinator`,Express + TS,in-memory `ExternalIfcReadyStore` + 持久 `ConversionLedger`)在 `summarizeIfcReadyJob` 做 additive/nullable 投影;前端 `web-viewer-sample`(React + Vite,`EdgeConsole` `#/conv` → `ConversionSchedulingPage`)擴充 `IfcReadyListItem` 型別與 jobs 表 render。誠實鐵律:presigned 簽章已由既有 `maskPresignedRef`/`sanitizeJobForExternal` 遮蔽(勿回退),converter 未落地前 `usdc_role` 恆 `pending`、無假 ready。

**Tech Stack:** TypeScript(coordinator Node ESM + viewer React)、vitest(+ supertest 整合)、Playwright(e2e)、zod(intake schema)。

---

## 基線紀律(動手前必跑,拿 baseline)

```bash
cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npm test 2>&1 | tail -20
```
預期:既有測試全綠(基準)。前端同理:
```bash
cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
```
每個 Task 改完用同一把尺比較;沒比 baseline 好(紅→綠以外的既有測試轉紅)就 revert。

---

## 現況盤點:已落地,禁止重做(先量再改)

> spec 撰於 2026-06-24,其後 closed-loop Phase 1(#250/#254)、minio-trigger-lifecycle-backend、minio-folderview 等姊妹 spec 已把 spec 大半欄位落地。以下為**已驗證存在於 main(commit 0d41615)** 的實作,本 plan **不得重寫**:

| spec 要求 | 現況(檔案:行) | 結論 |
|---|---|---|
| P0 全出口遮蔽 presigned(must_fix #1) | `maskPresignedRef`(`src/services/presignedRef.ts`)+ `sanitizeJobForExternal`(`app.ts:2658`);守衛測試 `tests/presigned-ref.test.ts` 已覆蓋 list/`:jobId`/shadow/POST session/POST intake 202/200 replay 六出口斷言不含 `X-Amz-Signature` | ✅ 已完成 |
| 凍結 lifecycle 映射 + 單一 helper(must_fix #2 / OQ5) | `deriveLifecycleStatus`(`src/services/lifecycleStatus.ts`,重用 `ConversionLedgerStatus`);已 wire 進 `summarizeIfcReadyJob`(`app.ts:2627`)與 `:jobId`(`app.ts:1538`);測試 `tests/lifecycle-status.test.ts` | ✅ 已完成 |
| `project_display_name`/`category` 落 store + 投影(OQ1 / must_fix #3) | `ExternalIfcReadyStore.create` 已寫入(`src/services/externalIfcReadyStore.ts:57-58`);`summarizeIfcReadyJob` 已投影(`app.ts:2614-2615`)。OQ1 裁決(spec §0)= 放寬 R5 直接落 store,**已生效** | ✅ 已完成 |
| `POST /api/conversion/trigger`(folderview R-TRIGGER-*) | `app.ts:928`,只收 `key`、server-side presign、`deriveIntakeFromKey` ≥3 段驗證、self-POST loopback | ✅ 已完成 |
| `GET /api/conversion/records`(ledger 視圖) | `app.ts:1374`;FE `ConversionRecord`(`coordinatorClient.ts:265`)已消費 `idempotency_key`/`project_display_name`/`category`/`usdc_key`/`coverage_report`/`object_key` | ✅ 已完成 |
| `watcher_liveness` / `baseline_count` 端點歸屬(OQ4 / must_fix #6) | 屬 `GET /api/external/minio-watch/status`(`app.ts:1524`);watcher 已計 `poll_count`/`last_poll_at`/`triggered_total`/`skipped_malformed_total`(`minioWatcher.ts:180+`);FE `MinioWatchStatus`(`coordinatorClient.ts:210`)已消費 | ✅ 已完成(不進 job_output) |
| `deriveIntakeFromKey` ≥3 段(OQ2 code 面) | `minioWatcher.ts:71` 已 `segments.length<3` 拒、`category=length-2`、`version=length-1` | ✅ code 正確(僅 docstring 需清理,見 Task 4) |

---

## 本 plan 的真實 delta(spec §3.2 NEW,尚未落地 + 有前端綁定點)

`summarizeIfcReadyJob`(`app.ts:2607-2644`)目前**未**輸出下列欄位,導致 `#/conv` 的「Ifc-ready jobs」表無法與 ledger / minio 表以同一把 `idempotency_key` 對齊(spec §1 gap-b、§4.1、must_fix #4):

| 欄位 | 成本級別(must_fix #7) | 來源 | 前端綁定點 |
|---|---|---|---|
| `idempotency_key` | 投影(job 已有 `types.ts:184`) | `job.idempotency_key` | #conv jobs 表 join 主鍵 |
| `idempotent_replay` | 投影(job 已有 `types.ts:182`) | `job.idempotent_replay` | #conv 誠實標記 |
| `conversion_lifecycle_status` | 投影(helper 已有) | `deriveLifecycleStatus(job)` | #conv chip(list 型別缺,detail 有) |
| `project_display_name` / `category` | 投影(已在 summarize,list 型別缺) | `job.*` | #conv 專案欄 |
| `failure_reason` / `failure_stage` | 新 helper(投影既有 `download_failure`/`dispatch_error`) | `deriveFailure(job)` | #conv 失敗欄 |
| `usdc_role` | 投影(常數推導,Phase1 恆 pending) | lifecycle 推導 | #conv 誠實 USDC 標籤 |
| `data_volatility` | 常數(store 為 in-memory) | `"in_memory_volatile"` | #conv 易失性標記 |

---

## 明確排除(YAGNI + 開放問題,不在本 plan;見回傳 blocker)

spec §5 明訂「無綁定點的欄位不加(YAGNI,避免重演 tenant_id 吐了沒人用)」。下列 spec §3.2 NEW 欄位**本 plan 不做**,理由如下,須另 spec 或維護者裁決:

- `source_object_key` / `source_bucket` / `source_ifc_ref_expires_at` / `key_segments` / `provenance_source` / `is_baseline`:需改 `IfcReadyIntakeJob` type + `ExternalIfcReadyStore.create` + intake handler + **`minioWatcher.ts` self-POST payload**(觸碰 §6.7「watcher 自動語意凍結」,須 `detect_changes` 佐證未改觸發語意,風險高);且 `{bucket,key,etag}` 對帳三元組**已可由 ledger(`ConversionRecord.object_key`)+ `/api/minio/objects` 觀測**,job_output 重複投影無新前端綁定點(YAGNI)。
- 階段時戳 `detected_at`/`queued_at`/`dispatched_at`/`converted_at`:需在 store `mark*` 各寫入點補時戳(wiring),目前**無前端 render 綁定**(YAGNI);`converted_at` 屬 Phase 2。
- `usdc_key` / `coverage_report`(job_output):Phase 2 回填(OQ7,callback outbox wiring 未接通),job 端恆 null;既有 ledger 已載此二欄,前端由 ledger 讀。本 plan 只在 job_output 投影 `usdc_role=pending` 誠實標記,不重複 null 欄位。
- OQ3(既有 consumer):`app.ts:1831` 的 internal callback payload 仍帶原始 presigned `source_ifc.ref`(送外部雲端 callback,`sanitizeJobForExternal` docstring `app.ts:2654-2656` 明列此 internal 出口為刻意 carve-out)。是否遮蔽此出口須先確認雲端 consumer 是否依賴 presigned 下載——屬開放問題,本 plan 不動 internal 出口;Task 2 守衛測試只斷言**瀏覽器可見出口**不洩漏。

---

## Task 0(前置):確認起點乾淨

- [ ] 確認 worktree 在對的 branch 與 commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git status --short && git branch --show-current
  ```
  預期:branch = `feat/ifc-ready-api-field-redesign`,工作樹乾淨(或僅 plan 檔)。
- [ ] 跑基線(見上「基線紀律」),記下綠燈數。

---

## Task 1: `deriveFailure` helper — 收斂 failure_reason / failure_stage

把分散的 `download_failure` / `dispatch_error` 收斂成單一 `{failure_reason, failure_stage}`(spec §4.3、must_fix,禁塞假值)。純新增檔,不動既有 symbol。

**Files:**
- Create `bim-review-coordinator/src/services/failureReason.ts`
- Create `bim-review-coordinator/tests/failure-reason.test.ts`

**Steps:**

- [ ] 寫失敗測試 `bim-review-coordinator/tests/failure-reason.test.ts`(沿用 `tests/lifecycle-status.test.ts` 的 `job()` fixture 寫法):
  ```ts
  import { describe, expect, it } from "vitest";
  import { deriveFailure } from "../src/services/failureReason.js";
  import type { IfcReadyIntakeJob } from "../src/types.js";

  function job(overrides: Partial<IfcReadyIntakeJob>): IfcReadyIntakeJob {
    return {
      ifc_ready_job_id: "j1", status: "accepted", idempotent_replay: false,
      correlation_id: "c1", idempotency_key: "k1", tenant_id: "t1", project_id: "p1",
      external_model_version_id: "v1", source_ifc_ref: "ref", source_ifc_etag: "etag",
      conversion_job_id: null, conversion_status: null, conversion_authority: null,
      created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z",
      ...overrides,
    } as IfcReadyIntakeJob;
  }

  describe("deriveFailure 收斂失敗欄", () => {
    it("無失敗 → 兩者皆 null(誠實留白)", () => {
      expect(deriveFailure(job({}))).toEqual({ failure_reason: null, failure_stage: null });
    });
    it("download_status=failed + download_failure → stage=download", () => {
      expect(deriveFailure(job({ download_status: "failed", download_failure: "timeout" })))
        .toEqual({ failure_reason: "timeout", failure_stage: "download" });
    });
    it("dispatch_failed + dispatch_error → stage=dispatch", () => {
      expect(deriveFailure(job({ status: "dispatch_failed", dispatch_error: "no slot" })))
        .toEqual({ failure_reason: "no slot", failure_stage: "dispatch" });
    });
    it("dropped_on_restart + dispatch_error → stage=dispatch", () => {
      expect(deriveFailure(job({ status: "dropped_on_restart", dispatch_error: "restart drop" })))
        .toEqual({ failure_reason: "restart drop", failure_stage: "dispatch" });
    });
    it("download 失敗優先於 dispatch(下載失敗即不派工)", () => {
      expect(deriveFailure(job({ download_status: "failed", download_failure: "net", status: "dispatch_failed", dispatch_error: "x" })))
        .toEqual({ failure_reason: "net", failure_stage: "download" });
    });
  });
  ```
- [ ] 跑,確認**失敗**(module 不存在):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/failure-reason.test.ts 2>&1 | tail -15
  ```
  預期:`Failed to resolve import "../src/services/failureReason.js"` 或全紅。
- [ ] 最小實作 `bim-review-coordinator/src/services/failureReason.ts`:
  ```ts
  import type { IfcReadyIntakeJob } from "../types.js";

  // 失敗段(閉環六段的可觀測子集;conversion/callback/key_malformed 屬其他來源,Phase 1 job 端只產 download/dispatch)。
  export type FailureStage = "download" | "dispatch" | "conversion" | "callback" | "key_malformed";

  export interface JobFailure {
    failure_reason: string | null;
    failure_stage: FailureStage | null;
  }

  /**
   * 單一權威:把分散的 download_failure / dispatch_error 收斂成 {failure_reason, failure_stage}。
   * 誠實:無失敗 → 兩者皆 null(不塞假值)。優先序:download 先於 dispatch(下載失敗即不派工)。
   */
  export function deriveFailure(job: IfcReadyIntakeJob): JobFailure {
    if (job.download_status === "failed" && job.download_failure) {
      return { failure_reason: job.download_failure, failure_stage: "download" };
    }
    if (
      (job.status === "dispatch_failed" || job.status === "dropped_on_restart") &&
      job.dispatch_error
    ) {
      return { failure_reason: job.dispatch_error, failure_stage: "dispatch" };
    }
    return { failure_reason: null, failure_stage: null };
  }
  ```
- [ ] 跑,確認**通過**:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/failure-reason.test.ts 2>&1 | tail -15
  ```
  預期:`Test Files 1 passed`、`Tests 5 passed`。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add bim-review-coordinator/src/services/failureReason.ts bim-review-coordinator/tests/failure-reason.test.ts && git diff --cached --check && git commit -m "feat(coordinator): 新增 deriveFailure helper 收斂 failure_reason/failure_stage"
  ```

---

## Task 2: `summarizeIfcReadyJob` 投影對帳鍵 + 誠實欄位

在列表與 `:jobId` 兩出口 additive 投影 `idempotency_key`/`idempotent_replay`/`failure_reason`/`failure_stage`/`usdc_role`/`data_volatility`(`conversion_lifecycle_status`/`project_display_name`/`category` 已在列表,補進 detail 一致性)。既有 26 欄逐字保留(closed-loop R11)。

**Files:**
- Modify `bim-review-coordinator/src/app.ts`(import 區 ~L32-40、`summarizeIfcReadyJob` L2607-2644、`:jobId` handler L1528-1539)
- Modify `bim-review-coordinator/tests/external-ifc-ready.test.ts`(新增投影斷言)

**Symbols modified:** `summarizeIfcReadyJob`(先跑 impact,見下)

**Steps:**

- [ ] 改動前跑 GitNexus impact(規範 MUST):
  ```
  mcp__gitnexus__impact({ target: "summarizeIfcReadyJob", direction: "upstream", repo: "AI-BIM-governance" })
  ```
  預期:呼叫點為 GET list(`app.ts:1368`)、runtime status(`app.ts:2565`);risk 非 HIGH/CRITICAL 才續(是則先回報)。
- [ ] 寫失敗測試,加進 `bim-review-coordinator/tests/external-ifc-ready.test.ts`(沿用該檔既有 `POST /api/external/ifc-ready` 落 job 再 `GET` 的整合寫法;若該檔無 helper,沿用 `tests/presigned-ref.test.ts` 的 `startPresignApp`/`seedPresignedJob` 同構寫法建立一筆 job):
  ```ts
  it("列表投影 idempotency_key + 誠實欄位(對帳鍵可 join、無假 ready)", async () => {
    // 落一筆 job(沿用本檔既有進件 helper;header X-Idempotency-Key 決定 job.idempotency_key)
    const created = await postIfcReady({ idempotencyKey: "idem_proj_reconcile" }); // 本檔既有 helper
    expect(created.status).toBe(202);
    const res = await request(app.app).get("/api/external/ifc-ready");
    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.idempotency_key).toBe("idem_proj_reconcile");   // must_fix #4:list 端可 join
    expect(item).toHaveProperty("idempotent_replay");
    expect(item).toHaveProperty("conversion_lifecycle_status");
    expect(item).toHaveProperty("failure_reason", null);         // 未失敗 → null(誠實)
    expect(item).toHaveProperty("failure_stage", null);
    expect(item.usdc_role).toBe("pending");                      // converter 未落地 → 恆 pending
    expect(item.data_volatility).toBe("in_memory_volatile");
  });
  ```
  > 註:若 `external-ifc-ready.test.ts` 無現成進件 helper,直接在本 it 內用 `request(app.app).post("/api/external/ifc-ready").set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": "corr_reconcile", "X-Idempotency-Key": "idem_proj_reconcile" }).send(CONTRACT_EXAMPLE)`(CONTRACT_EXAMPLE 讀法見 `tests/presigned-ref.test.ts:56`)。
- [ ] 跑,確認**失敗**(欄位未投影):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts 2>&1 | tail -20
  ```
  預期:新 it 紅(`item.idempotency_key` undefined、`usdc_role` undefined)。
- [ ] 加 import(`app.ts`,緊接既有 `deriveLifecycleStatus` import,約 L32):
  ```ts
  import { deriveFailure } from "./services/failureReason.js";
  ```
- [ ] 改 `summarizeIfcReadyJob`(`app.ts:2607`):在函式頂端 hoist lifecycle,並在 return 物件 `conversion_lifecycle_status` 一行改為重用該常數,於 `updated_at` 之前插入投影欄位。把:
  ```ts
    conversion_lifecycle_status: deriveLifecycleStatus(job),
  ```
  改為(hoist + 重用):在 `const expectedStage = ...` 下一行加 `const lifecycle = deriveLifecycleStatus(job);`,並把上行改為 `conversion_lifecycle_status: lifecycle,`;接著在 `created_at: job.created_at,` 之前插入:
  ```ts
    // === ifc-ready-api-field-redesign:對帳鍵 + 誠實觀測投影(additive/nullable;既有 26 欄不動)===
    idempotency_key: job.idempotency_key,
    idempotent_replay: job.idempotent_replay,
    ...deriveFailure(job),
    // 誠實:converter 落地前恆 pending;ready 後(Phase 2)才 parsed_usdc。禁前端寫死假 parsed。
    usdc_role: lifecycle === "ready" ? "parsed_usdc" : "pending",
    // 誠實:job 端為 in-memory store(重啟即清);對帳真相以持久 ledger 為準。
    data_volatility: "in_memory_volatile" as const,
  ```
- [ ] 改 `:jobId` handler(`app.ts:1538`)使 detail 與 list 一致。把:
  ```ts
    response.json({ ...sanitizeJobForExternal(job), conversion_lifecycle_status: deriveLifecycleStatus(job) });
  ```
  改為:
  ```ts
    const lifecycle = deriveLifecycleStatus(job);
    response.json({
      ...sanitizeJobForExternal(job),
      conversion_lifecycle_status: lifecycle,
      ...deriveFailure(job),
      usdc_role: lifecycle === "ready" ? "parsed_usdc" : "pending",
      data_volatility: "in_memory_volatile" as const,
    });
  ```
- [ ] 跑,確認新 it **通過**且既有 `external-ifc-ready` / `presigned-ref` / `lifecycle-status` 全綠(遮蔽不回退):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts tests/presigned-ref.test.ts tests/lifecycle-status.test.ts 2>&1 | tail -20
  ```
  預期:三檔全 passed。
- [ ] tsc + 全測試(確認無型別破壞):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npm run build 2>&1 | tail -5 && npm test 2>&1 | tail -15
  ```
  預期:build 0 error;test 綠燈數 ≥ baseline + 6(Task1)+ 1(本 it)。
- [ ] commit 前跑 detect_changes(規範 MUST):
  ```
  mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })
  ```
  預期:僅 `summarizeIfcReadyJob` 與 `:jobId` handler 受影響,無 watcher/store 意外變更。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/external-ifc-ready.test.ts && git diff --cached --check && git commit -m "feat(coordinator): summarizeIfcReadyJob 投影 idempotency_key 對帳鍵 + failure/usdc_role/data_volatility 誠實欄位"
  ```

---

## Task 3: 前端 `IfcReadyListItem` 擴充 + `#/conv` jobs 表 render(user-facing)

擴充列表型別(全 additive/optional,不破壞既有 fixture),並在 `ConversionSchedulingPage` 的「Ifc-ready jobs」表新增 `idempotency_key`(join 鍵)欄、lifecycle chip、專案原名/種類、誠實 failure/usdc 標籤,使三視圖可視覺對齊。

**Files:**
- Modify `web-viewer-sample/src/console/coordinatorClient.ts`(`IfcReadyListItem` L156-179)
- Modify `web-viewer-sample/src/console/pages.tsx`(`ConversionSchedulingPage` jobs 表 L1205-1258)
- Modify `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`(新增 render 斷言)

**Symbols modified:** `IfcReadyListItem`、`ConversionSchedulingPage`

**Steps:**

- [ ] 擴充型別 `coordinatorClient.ts` `IfcReadyListItem`(在 `updated_at: string;` 之前插入;全 optional/nullable,既有 fixture 不需改):
  ```ts
    // ifc-ready-api-field-redesign:三視圖對帳主鍵(job↔ledger↔minio 皆以此 join;summarizeIfcReadyJob 投影)。
    idempotency_key?: string;
    idempotent_replay?: boolean;
    project_display_name?: string | null;
    category?: string | null;
    // 主讀 lifecycle chip(list 端投影,與 IfcReadyJobDetail 對齊)。
    conversion_lifecycle_status?: ConversionLifecycleStatus | null;
    // 誠實:無失敗恆 null;有值時 stage 定位六段的可觀測子集。
    failure_reason?: string | null;
    failure_stage?: "download" | "dispatch" | "conversion" | "callback" | "key_malformed" | null;
    // 誠實:converter 未落地恆 pending,不顯假 parsed USDC。
    usdc_role?: "source_ifc" | "parsed_usdc" | "pending" | null;
    // 誠實:job 端 in-memory(重啟即清);前端據以區分「真的沒 job」vs「剛重啟」。
    data_volatility?: "in_memory_volatile" | "persisted" | null;
  ```
- [ ] 寫失敗測試 `ConversionSchedulingPage.test.tsx`(沿用本檔既有 mount/flush 寫法——`beforeEach` 已建 `container` 且設 `IS_REACT_ACT_ENVIRONMENT`;參考本檔既有以 `coordinatorClient` spy + `createRoot`/`act` mount `<ConversionSchedulingPage />` 的 it):
  ```tsx
  it("Ifc-ready jobs 表投影 idempotency_key(對帳鍵)+ lifecycle chip + 誠實 usdc 標籤", async () => {
    const reconcileJob: IfcReadyListItem = {
      ...queuedJob, // 本檔既有 fixture(L402)
      ifc_ready_job_id: "ifcready_reconcile",
      idempotency_key: "mw_abc123def4567890",
      idempotent_replay: false,
      conversion_lifecycle_status: "queued",
      project_display_name: "松風庵",
      category: "機電",
      usdc_role: "pending",
      data_volatility: "in_memory_volatile",
      failure_reason: null,
      failure_stage: null,
    };
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [reconcileJob] });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getMinioWatchStatus").mockResolvedValue({ enabled: false, note: "未設定" });
    // 其餘 load* 依本檔既有慣例 mock 空(getMinioObjects 等),避免未 mock 造成 unhandled rejection。
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });
    const idemCell = container.querySelector('[data-testid="conv-job-idem-ifcready_reconcile"]');
    expect(idemCell?.textContent).toContain("mw_abc123def4567890");
    const chip = container.querySelector('[data-testid="conv-job-lifecycle-ifcready_reconcile"]');
    expect(chip?.textContent).toContain("排隊"); // queued 的中文 chip
    const usdc = container.querySelector('[data-testid="conv-job-usdc-ifcready_reconcile"]');
    expect(usdc?.textContent).toContain("待產生"); // pending 誠實標籤,禁顯 parsed
    await act(async () => { root.unmount(); });
  });
  ```
  > 若 `createRoot`/`act` 未在本檔 import,於檔頭補 `import { act } from "react";` 與 `import { createRoot } from "react-dom/client";`(對齊本檔既有其他 render it 的 import)。
- [ ] 跑,確認**失敗**(欄位/testid 未 render):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
  ```
  預期:新 it 紅(querySelector 回 null)。
- [ ] 改 `pages.tsx` jobs 表頭(L1205),在 `<th>job</th>` 後、`<th>project</th>` 前後補「key」與 lifecycle 語意欄。把表頭列改為(新增 `key`、`lifecycle`、`usdc` 三欄;其餘保留):
  ```tsx
          <table className="ec-table"><thead><tr><th>job</th><th>key</th><th>lifecycle</th><th>project</th><th>usdc</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage</th><th>coverage</th><th>{t("控制", "Control")}</th></tr></thead>
  ```
- [ ] 改 jobs 表 row(L1208-1211 區),在 `<td>{j.ifc_ready_job_id}</td>` 之後插入三格,並把既有 `<td>{j.project_id}</td>` 換成含原名/種類:
  ```tsx
                  <td>{j.ifc_ready_job_id}</td>
                  <td><code data-testid={`conv-job-idem-${j.ifc_ready_job_id}`}>{j.idempotency_key ?? "—"}</code></td>
                  <td>
                    <span
                      data-testid={`conv-job-lifecycle-${j.ifc_ready_job_id}`}
                      className={`ec-chip ec-chip-${j.conversion_lifecycle_status ?? "unknown"}`}
                    >{lifecycleLabel(j.conversion_lifecycle_status)}</span>
                  </td>
                  <td data-testid={`conv-job-project-${j.ifc_ready_job_id}`}>
                    {j.project_display_name || j.project_id}{j.category ? ` · ${j.category}` : ""}
                  </td>
                  <td>
                    <span data-testid={`conv-job-usdc-${j.ifc_ready_job_id}`} className="ec-note">
                      {j.usdc_role === "parsed_usdc" ? t("已產生 USDC", "USDC ready") : t("待產生", "pending")}
                    </span>
                  </td>
  ```
  並把原 dispatch 格改為優先顯示統一 failure(誠實;無則回退既有 dispatch_error 顯示)。把 L1213 的 `{j.dispatch_error ? (` 條件式所在 `<td>` 內容改為以 `j.failure_reason` 為主:
  ```tsx
                  <td>
                    {(j.failure_reason ?? j.dispatch_error) ? (
                      <span
                        className="ec-warn-note"
                        data-testid={`conv-job-failure-${j.ifc_ready_job_id}`}
                        title={`${j.failure_stage ? `[${j.failure_stage}] ` : ""}${j.failure_reason ?? j.dispatch_error}`}
                      >
                        {j.failure_stage ? `[${j.failure_stage}] ` : ""}
                        {((j.failure_reason ?? j.dispatch_error) as string).slice(0, 80)}
                      </span>
                    ) : "—"}
                  </td>
  ```
  並把最底 coverage 展開列的 `colSpan={8}`(L1251)改為 `colSpan={11}`(表頭欄數已由 8 增為 11)。
- [ ] 在 `ConversionSchedulingPage` 函式內(或本檔模組層,靠近既有 `lifecycleBadge`/chip helper)新增 `lifecycleLabel`(若本檔已有等義 helper 則重用、不重複宣告):
  ```tsx
  function lifecycleLabel(s: ConversionLifecycleStatus | null | undefined): string {
    switch (s) {
      case "detected": return "偵測";
      case "queued": return "排隊";
      case "converting": return "轉檔中";
      case "ready": return "完成";
      case "failed": return "失敗";
      default: return "—";
    }
  }
  ```
  > 動手前先 grep 本檔是否已有 lifecycle→中文 的映射(pages.tsx 內 `conversion_lifecycle_status` 已被讀,L476-494);若有,直接重用其字典,勿新增第二份(避免漂移)。
- [ ] 跑,確認新 it **通過**且本檔既有測試不回退:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx 2>&1 | tail -20
  ```
  預期:全 passed(含新 it)。
- [ ] tsc 全域(型別無破壞;vite build 不跑 tsc,須另跑):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npx tsc --noEmit 2>&1 | tail -15
  ```
  預期:0 error。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx && git diff --cached --check && git commit -m "feat(console): #/conv jobs 表投影 idempotency_key 對帳鍵 + lifecycle chip + 誠實 usdc/failure 標籤"
  ```

---

## Task 4: 文件衛生 — 修 minioWatcher docstring「兩層」殘留(must_fix #5 / OQ2)

`deriveIntakeFromKey` code 已 ≥3 段正確(`minioWatcher.ts:71`),但檔頭/舊 spec 仍寫「兩層 `{projectId}/{modelId}`」。降級為純文件清理,**不動任何 code 邏輯**。

**Files:**
- Modify `bim-review-coordinator/src/services/minioWatcher.ts`(檔頭 docstring,約 L12)
- Modify `docs/superpowers/specs/2026-06-22-minio-watch-key-structure.md`(若仍載舊「兩層」live 描述:加 archive 註記指向 ≥3 段 active 規約)

**Steps:**

- [ ] grep 定位殘留「兩層 / two-layer / `{projectId}/{modelId}`」字樣:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && grep -rn "兩層\|two-layer\|projectId}/{modelId\|{projectId}/{modelId}" bim-review-coordinator/src/services/minioWatcher.ts docs/superpowers/specs/2026-06-22-minio-watch-key-structure.md
  ```
- [ ] 修 `minioWatcher.ts` 檔頭 docstring:把描述 key 為「兩層 `{projectId}/{modelId}`」的句子改為與 code 一致的「≥3 段:`{專案原名}/…/{種類}/{版本}/model.ifc`;`category=倒數第二段`、`version=末段`、`project_raw=首段`,`segments.length<3` 判 malformed 略過」。**只改註解字串,不改函式簽章/邏輯**。
- [ ] 若 `2026-06-22-minio-watch-key-structure.md` 仍有 live「兩層」描述,於該段上方加一行 archive 註記:
  ```md
  > [ARCHIVE 2026-07-01] 舊「兩層 {projectId}/{modelId}」描述已停用;active 規約為 ≥3 段(見 minioWatcher.ts:71 deriveIntakeFromKey 與 2026-06-24 folderview spec R-TRIGGER-KEY-VALIDATION)。
  ```
- [ ] 跑 coordinator 測試確認純註解改動不影響行為:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts 2>&1 | tail -10
  ```
  預期:全 passed(行為未變)。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add bim-review-coordinator/src/services/minioWatcher.ts docs/superpowers/specs/2026-06-22-minio-watch-key-structure.md && git diff --cached --check && git commit -m "docs(coordinator): 修 minioWatcher docstring 兩層殘留 → ≥3 段(對齊 code 與 folderview spec)"
  ```

---

## Task 5: Browser E2E — `#/conv` 三視圖對帳 vertical slice(user-facing)

以 Playwright 佐證 vertical slice:UI route(`#/conv`)→ 真 backend(spawn coordinator + S3 stub + conv stub)→ Ifc-ready jobs 表 render 出 `idempotency_key`/lifecycle chip/誠實 usdc,且**同一把 `idempotency_key` 亦出現在 ledger records 表**(證明三視圖可 join)。無 backend 資料處明標(截圖 + `STUB` 註記)。

**Files:**
- Create `web-viewer-sample/e2e/ifc-ready-field-redesign.spec.ts`

**Steps:**

- [ ] 以 `web-viewer-sample/e2e/minio-closed-loop.spec.ts` 為藍本(spawn coordinator + S3 stub + conv stub、`conditional-skip` if `dist-ui` 未 build、`coordinatorBase`/`WEBHOOK_SECRET` 慣例、截圖落 `artifacts/e2e/`),新增 `e2e/ifc-ready-field-redesign.spec.ts`。核心斷言:
  ```ts
  test("#/conv:Ifc-ready jobs 表投影 idempotency_key 對帳鍵 + lifecycle chip + 誠實 usdc(STUB MINIO+CONV)", async ({ page }) => {
    // 前置:S3 stub 放一顆 松風庵/root/main/000001/model.ifc;watcher 首輪 auto-enroll → ledger queued。
    //       或改走手動:POST /api/conversion/trigger { key } 建立 job(server-side presign)。
    await page.goto(`${coordinatorBase}/ui#/conv`);
    // 1) ledger records 表出現該 idempotency_key(mw_<hash16>)。
    const ledgerRow = page.locator('[data-testid^="conv-ledger-trigger-"]').first();
    await expect(ledgerRow).toBeVisible();
    // 2) Ifc-ready jobs 表同一 job 的對帳鍵格出現(可與 ledger 對齊)。
    const idemCell = page.locator('[data-testid^="conv-job-idem-"]').first();
    await expect(idemCell).toContainText("mw_");
    // 3) lifecycle chip 顯中文狀態(排隊/轉檔中/偵測),且誠實:不得出現「完成」假 ready(Phase 2 才回填)。
    const chip = page.locator('[data-testid^="conv-job-lifecycle-"]').first();
    await expect(chip).toBeVisible();
    await expect(page.locator('[data-testid^="conv-job-lifecycle-"]')).not.toContainText("完成");
    // 4) usdc 誠實標籤 = 待產生(禁 parsed)。
    await expect(page.locator('[data-testid^="conv-job-usdc-"]').first()).toContainText("待產生");
    // 5) 對帳一致:jobs 表與 ledger 表出現同一把 idempotency_key 字串。
    const idemText = (await idemCell.textContent())?.trim() ?? "";
    expect(idemText).toMatch(/^mw_/);
    await page.screenshot({ path: `artifacts/e2e/ifc-ready-field-redesign-conv-${Date.now()}.png`, fullPage: true });
  });
  ```
  > STUB 誠實註記(照 minio-closed-loop 檔頭)寫進檔頭:S3 + conversion 皆 stub、ledger status=queued、禁假 ready。
- [ ] build dist-ui(E2E 讀 `dist-ui`;`build:ui` 不跑 tsc,已於 Task 3 另跑 tsc):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npm run build:ui 2>&1 | tail -8
  ```
  預期:`dist-ui/` 產出;否則 E2E 會 `test.skip`。
- [ ] 跑 E2E:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/web-viewer-sample && npx playwright test e2e/ifc-ready-field-redesign.spec.ts 2>&1 | tail -25
  ```
  預期:`1 passed`;`artifacts/e2e/ifc-ready-field-redesign-conv-*.png` 產出並肉眼確認 jobs 表與 ledger 表對帳鍵一致、無假 ready。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add web-viewer-sample/e2e/ifc-ready-field-redesign.spec.ts && git diff --cached --check && git commit -m "test(e2e): #/conv 三視圖對帳 vertical slice(idempotency_key join + lifecycle chip + 誠實 usdc)"
  ```

---

## 完成標準(Done)

- [ ] Task 1-5 全 commit;`bim-review-coordinator` `npm run verify` 綠、`web-viewer-sample` `npx tsc --noEmit` 綠、目標 vitest 綠。
- [ ] `summarizeIfcReadyJob` 列表出口投影 `idempotency_key`(must_fix #4:三視圖可 join),既有 26 欄逐字保留、presigned 遮蔽守衛測試不回退(must_fix #1)。
- [ ] `#/conv` Ifc-ready jobs 表 render 對帳鍵 + lifecycle chip + 誠實 usdc/failure;E2E 截圖佐證 jobs 表與 ledger 表對帳鍵一致、無假 ready(誠實鐵律)。
- [ ] 回報:改了哪些 tracked files、跑了哪些驗證、哪些沒跑及原因、已知風險(見「明確排除」的 OQ3/OQ4/OQ7 與 Group-B wiring 未做)。
