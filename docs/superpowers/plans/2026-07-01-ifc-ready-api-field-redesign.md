# ifc-ready API 欄位重新設計 Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 讓 `summarizeIfcReadyJob`(GET /api/external/ifc-ready 列表)投影三視圖對帳主鍵 `idempotency_key` 與誠實觀測欄位(`failure_reason`/`failure_stage`/`usdc_role`/`data_volatility`/`idempotent_replay`/`conversion_lifecycle_status`/`project_display_name`/`category`),前端 `#/conv` 的「Ifc-ready jobs」表據以與 ledger / minio 視圖對齊,並以 browser E2E 佐證。

**Architecture:** coordinator(`bim-review-coordinator`,Express + TS,in-memory `ExternalIfcReadyStore` + 持久 `ConversionLedger`)在 `summarizeIfcReadyJob` 做 additive/nullable 投影;前端 `web-viewer-sample`(React + Vite,`EdgeConsole` `#/conv` → `ConversionSchedulingPage`)擴充 `IfcReadyListItem` 型別與 jobs 表 render。誠實鐵律:presigned 簽章由既有 `maskPresignedRef`/`sanitizeJobForExternal` 遮蔽瀏覽器可見出口,並由 Task 1B 補遮 callback outbox 出口(`app.ts:1831`,使用者 2026-07-01 已裁決遮蔽)→ P0 must_fix #1「全出口遮蔽」閉環(勿回退);converter 未落地前 `usdc_role` 恆 `pending`(job 端無 usdc_key)、無假 ready。

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

> **例外(唯一預期的既有測試轉紅,非 regression、禁 revert)**:Task 2 投影 `idempotency_key` 後,`tests/external-ifc-ready.test.ts:343` 既有斷言 `expect(listed.body.items[0]).not.toHaveProperty("idempotency_key")` 必然翻紅——該斷言正是 must_fix #4 要移除的「過時 guard」(它斷言列表**不得**出現 must_fix #4 要求投影的欄位)。Task 2 Steps 已含「翻轉此斷言」步驟;執行者遇此紅**必須依 Task 2 更新該斷言,不得當 regression 把功能 revert 掉**。除此唯一一行外,其餘既有測試轉紅仍一律 revert。

---

## 現況盤點:已落地,禁止重做(先量再改)

> spec 撰於 2026-06-24,其後 closed-loop Phase 1(#250/#254)、minio-trigger-lifecycle-backend、minio-folderview 等姊妹 spec 已把 spec 大半欄位落地。以下為**已驗證存在於 main(commit 0d41615)** 的實作,本 plan **不得重寫**:

| spec 要求 | 現況(檔案:行) | 結論 |
|---|---|---|
| P0 全出口遮蔽 presigned(must_fix #1) | 瀏覽器可見出口:`maskPresignedRef`(`src/services/presignedRef.ts`)+ `sanitizeJobForExternal`(`app.ts:2658`);守衛測試 `tests/presigned-ref.test.ts` 已覆蓋 list/`:jobId`/shadow/POST session/POST intake 202/200 replay 六出口斷言不含 `X-Amz-Signature`。callback outbox → 外部雲端 payload(`app.ts:1831`)由 **Task 1B 補遮**(使用者 2026-07-01 裁決遮蔽:conversion_result_ready 送出時雲端已取得 usdc 成品、不需 presigned 下載原 IFC → 遮蔽不影響功能;對照 `app.ts:2104`/`2619` 已遮蔽) | ✅ 瀏覽器出口已完成;callback outbox 出口由 Task 1B 遮蔽 → must_fix #1 全出口閉環 |
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
- ~~OQ3(既有 consumer):`app.ts:1831` callback outbox 出口遮蔽~~ **已裁決(2026-07-01)並移入 Task 1B**:使用者核准遮蔽此 callback outbox 出口(理由:conversion_result_ready 送出時轉檔已完成、外部雲端已取得 usdc 成品,不需 presigned 下載原 IFC,遮蔽不影響功能)。Task 1B 對 `app.ts:1831` 套 `maskPresignedRef` + 守衛測試 + 更新 `sanitizeJobForExternal` docstring 與 callback contract。must_fix #1 全出口遮蔽於本 plan 閉環,不再是待裁決開放問題。

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

## Task 1B: P0 收尾 — 遮蔽 callback outbox 出口(app.ts:1831,must_fix #1 全出口閉環)

`ingestConversionReport` 組 `conversion_result_ready` callback payload(送外部雲端 control-plane)時,`source_ifc.ref` 仍是原始 presigned URL(含 `X-Amz-*` 簽章),為 spec §0 / §8.3 明列的 P0 必遮出口。使用者 2026-07-01 裁決遮蔽(轉檔完成時雲端已取得 usdc 成品,不需 presigned 下載原 IFC → 遮蔽不影響功能)。對 `app.ts:1831` 套既有 `maskPresignedRef`(與 `app.ts:2104`/`2619` 一致),加守衛測試,更新 docstring 與 contract。**不動 conversion_failed 分支**(其 payload 不含 source_ifc)。

**Files:**
- Modify `bim-review-coordinator/src/app.ts`(`ingestConversionReport` 的 `conversion_result_ready` payload `source_ifc.ref` ~L1831;`sanitizeJobForExternal` docstring ~L2650-2656 更新 carve-out 敘述)
- Modify `bim-review-coordinator/tests/cloud-callback-outbox.test.ts`(新增遮蔽守衛斷言)
- Modify `docs/contracts/conversion-api.md`(callback 段註明 source_ifc.ref 已遮蔽簽章)

**Symbols modified:** `ingestConversionReport`(先跑 impact)

**Steps:**

- [ ] 改動前跑 GitNexus impact(規範 MUST):
  ```
  mcp__gitnexus__impact({ target: "ingestConversionReport", direction: "upstream", repo: "AI-BIM-governance" })
  ```
  預期:呼叫點為 POST /api/internal/conversion-result、auto-poll ingest 等;risk 非 HIGH/CRITICAL 才續(是則先回報)。
- [ ] 寫失敗守衛測試,加進 `bim-review-coordinator/tests/cloud-callback-outbox.test.ts`(用既有 `makeApp`/`authHeaders`/`internalHeaders`/`IFC_CONTRACT`;seed 一個 source_ifc.ref 帶簽章的 job,不依賴 fixture 預設值):
  ```ts
  it("誠實鐵律:conversion_result_ready callback payload 的 source_ifc.ref 遮蔽 presigned 簽章(P0 全出口)", async () => {
    const app = makeApp();
    // seed 一個 source_ifc.ref 帶 X-Amz 簽章的 job(覆寫 fixture,確定性驗遮蔽生效)
    const signedRef = "https://minio.example.com/bim-control/proj/cat/v1/model.ifc?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefcafe&X-Amz-Credential=AKIA%2F20260701&X-Amz-Expires=3600";
    const example = structuredClone(IFC_CONTRACT.example) as Record<string, unknown>;
    const seeded = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_mask_001", "X-Idempotency-Key": "idem_mask_001" }))
      .send({ ...example, source_ifc: { ...(example.source_ifc as Record<string, unknown>), ref: signedRef } });
    expect(seeded.status).toBe(202);
    const res = await request(app.app).post("/api/internal/conversion-result").set(internalHeaders()).send({
      correlation_id: "corr_mask_001",
      conversion_job_id: "cj_mask_001",
      status: "ready",
      artifacts: { usdc_ref: "edge-local://t/mv/cj/model.usdc" },
      artifact_summary: { usdc_openable: true },
    });
    expect(res.status).toBe(202);
    const payload = res.body.callback.payload;
    // source_ifc.ref 仍在(metadata 標示來源),但簽章已剝除
    expect(payload.source_ifc.ref).not.toMatch(/X-Amz-Signature|X-Amz-Credential|X-Amz-Expires/i);
    expect(payload.source_ifc.ref).toBe("https://minio.example.com/bim-control/proj/cat/v1/model.ifc");
    // 整包 payload 不含任何簽章殘留
    expect(JSON.stringify(payload)).not.toMatch(/X-Amz-Signature|X-Amz-Credential/i);
  });
  ```
  > 註:`request`/`makeApp`/`authHeaders`/`internalHeaders`/`IFC_CONTRACT` 皆本檔既有(L1-70);本 it 不需新增 import。若 `IFC_CONTRACT.example.source_ifc` 結構與上不符,以實際 fixture 欄位為準(核心是 override `ref` 為含 `X-Amz-*` 的 URL)。
- [ ] 跑,確認**失敗**(遮蔽未套,ref 仍含簽章):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/cloud-callback-outbox.test.ts 2>&1 | tail -15
  ```
  預期:新 it 紅(`payload.source_ifc.ref` 含 `X-Amz-Signature`)。
- [ ] 遮蔽 `app.ts:1831` — 把 conversion_result_ready payload 的:
  ```ts
        source_ifc: { ref: job.source_ifc_ref, etag: job.source_ifc_etag },
  ```
  改為(重用既有 `maskPresignedRef`,已 import 於 `app.ts:40`):
  ```ts
        source_ifc: { ref: maskPresignedRef(job.source_ifc_ref), etag: job.source_ifc_etag },
  ```
- [ ] 更新 `sanitizeJobForExternal` docstring(~L2650-2656):把「範圍外(刻意)…比照 callback outbox carve-out」段改為誠實反映現況——callback outbox 的 `conversion_result_ready` payload 已遮蔽 `source_ifc.ref`;僅 `POST /api/internal/conversion-result`、`/ingest` 等回原始 job 給 internal-token consumer 的路徑仍為 carve-out(defense-in-depth 待確認)。措辭與 code 一致,不留假 carve-out 敘述。
- [ ] 更新 `docs/contracts/conversion-api.md` callback 段:註明 `conversion_result_ready` 的 `source_ifc.ref` 對外一律遮蔽 presigned 簽章(只留 bucket/key 物件位址),完整 presigned 只活在 server-side dispatch。
- [ ] 跑,確認新 it **通過**且 `cloud-callback-outbox` 既有測試(metadata-only 鐵律等)+ `presigned-ref` 全綠(遮蔽不回退):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/cloud-callback-outbox.test.ts tests/presigned-ref.test.ts 2>&1 | tail -20
  ```
  預期:兩檔全 passed。
- [ ] commit 前跑 detect_changes(規範 MUST):
  ```
  mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })
  ```
  預期:僅 `ingestConversionReport`(+docstring)受影響,無 watcher/store/其他 callback 分支意外變更。
- [ ] commit:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add bim-review-coordinator/src/app.ts bim-review-coordinator/tests/cloud-callback-outbox.test.ts docs/contracts/conversion-api.md && git diff --cached --check && git commit -m "fix(coordinator): 遮蔽 callback outbox 出口 source_ifc.ref presigned 簽章(P0 must_fix #1 全出口閉環)"
  ```

---

## Task 2: `summarizeIfcReadyJob` 投影對帳鍵 + 誠實欄位

在列表與 `:jobId` 兩出口 additive 投影 `idempotency_key`/`idempotent_replay`/`failure_reason`/`failure_stage`/`usdc_role`/`data_volatility`(`conversion_lifecycle_status`/`project_display_name`/`category` 已在列表,補進 detail 一致性)。既有 26 欄逐字保留(closed-loop R11)。

**Files:**
- Modify `bim-review-coordinator/src/app.ts`(import 區 ~L32-40、`summarizeIfcReadyJob` L2607-2644、`:jobId` handler L1528-1539)
- Modify `bim-review-coordinator/tests/external-ifc-ready.test.ts`(新增投影斷言 **+ 翻轉既有 stale guard `L343`**:既有測試 "lists recent IFC-ready jobs with dashboard-safe progress fields" 於 L343 有 `expect(listed.body.items[0]).not.toHaveProperty("idempotency_key")`,本 Task 投影 `idempotency_key` 後此斷言必翻紅,MUST 一併翻轉為正向投影斷言,見下 Steps 專步。**只碰 L343,勿動 L344 `callback_url` 斷言**——本 Task 不投影 callback_url)

**Symbols modified:** `summarizeIfcReadyJob`(先跑 impact,見下)

**Steps:**

- [ ] 改動前跑 GitNexus impact(規範 MUST):
  ```
  mcp__gitnexus__impact({ target: "summarizeIfcReadyJob", direction: "upstream", repo: "AI-BIM-governance" })
  ```
  預期:呼叫點為 GET list(`app.ts:1368`)、runtime status(`app.ts:2565`);risk 非 HIGH/CRITICAL 才續(是則先回報)。
- [ ] 寫失敗測試,加進 `bim-review-coordinator/tests/external-ifc-ready.test.ts`。**該檔已有現成 helper(勿自造、勿引其他檔)**:`makeApp()`(L46,建 app、預設 `streamingConversionApiBase` 不可達 → dispatch graceful 仍回 202)、`payload()`(L60,`{ ...structuredClone(CONTRACT.example), ...overrides }`)、`authHeaders()`(L64,帶 `X-Webhook-Secret`/`X-Correlation-Id`/`X-Idempotency-Key`)。**每個 it 各自 `const app = makeApp()`**(見既有 L305-307、L881),`job.idempotency_key` 由 `X-Idempotency-Key` header 決定(見 L311)。直接照抄既有 OQ1 test(L877-901)的形狀:
  ```ts
  it("列表投影 idempotency_key + 誠實欄位(對帳鍵可 join、無假 ready)", async () => {
    const app = makeApp(); // 本檔既有 helper(L46);dispatch 不可達為 graceful,job 仍建、仍 202
    const created = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders({ "X-Correlation-Id": "corr_reconcile", "X-Idempotency-Key": "idem_proj_reconcile" })) // 既有 helper L64
      .send(payload()); // 既有 helper L60(= CONTRACT.example)
    expect(created.status).toBe(202);
    const jobId = created.body.ifc_ready_job_id as string;
    const res = await request(app.app).get("/api/external/ifc-ready");
    expect(res.status).toBe(200);
    // 用 jobId find(對齊既有 OQ1 test L896-898),不假設 items[0] 順序。
    const item = (res.body.items as Array<Record<string, unknown>>).find((j) => j.ifc_ready_job_id === jobId)!;
    expect(item.idempotency_key).toBe("idem_proj_reconcile");   // must_fix #4:list 端可 join
    expect(item).toHaveProperty("idempotent_replay");
    expect(item).toHaveProperty("conversion_lifecycle_status");
    expect(item).toHaveProperty("failure_reason", null);         // 未失敗 → null(誠實)
    expect(item).toHaveProperty("failure_stage", null);
    expect(item.usdc_role).toBe("pending");                      // converter 未落地 → 恆 pending
    expect(item.data_volatility).toBe("in_memory_volatile");
  });
  ```
  > 註:`request`/`makeApp`/`payload`/`authHeaders`/`CONTRACT` 皆本檔既有 import/宣告(L7-9、L46-70),本 it 不需新增任何 import。**勿**用 `postIfcReady`(此名不存在於本檔;唯一同名者在別 repo 的 `web-viewer-sample/e2e/conversion-artifact-id-sanitize.spec.ts:225`,簽章 `postIfcReady(api, {...})` 為 Playwright 風格、不相容)或 `CONTRACT_EXAMPLE`(本檔固定 fixture 名為 `CONTRACT.example`,由 `payload()` 消費,見 L18-21、L60-62);亦**勿**引用 `app.app` 而不先 `const app = makeApp()`。
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
    // 誠實(spec §4.6:usdc_role 以 usdc_key 為閂門):job 端不投影 usdc_key(IfcReadyIntakeJob 無此欄、見「明確排除」;
    // Phase 1 恆缺),Phase 2 由 callback outbox 回填 ledger 後前端由 ledger 讀 parsed → job_output 端恆 pending。
    // 禁用 lifecycle==="ready" 假報 parsed_usdc:真實轉檔完成時 conversion_status→ready 會令 lifecycle→ready,
    // 但 job 端仍無 usdc_key,依 spec §6.3/AC8「禁假 parsed USDC」必須維持 pending(這正是 must_fix 要防的假 ready、且與 ledger 端 r.usdc_key!=null 才顯 parsed 對齊)。
    usdc_role: "pending" as const,
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
      usdc_role: "pending" as const, // 同 summarizeIfcReadyJob:job 端無 usdc_key,依 spec §4.6/§6.3 恆 pending(禁 lifecycle 假報 parsed)
      data_volatility: "in_memory_volatile" as const,
    });
  ```
- [ ] **翻轉既有 stale guard(findings #2/#4:必然且正確的紅,非 regression)**:`tests/external-ifc-ready.test.ts` 測試 "lists recent IFC-ready jobs with dashboard-safe progress fields" 的 L343 現為 `expect(listed.body.items[0]).not.toHaveProperty("idempotency_key");`——上兩步投影後此欄必然出現、該斷言由綠翻紅。這正是 must_fix #4 要移除的過時 guard,MUST 翻轉為正向投影鎖(該測試 `items[0]` = 第二筆 job,其 header `X-Idempotency-Key: "idem_list_002"`,見 L315)。把該行改為:
  ```ts
    // ifc-ready-api-field-redesign:must_fix #4 對帳鍵已投影到列表出口,翻轉過時「不得有」guard 為正向鎖。
    expect(listed.body.items[0]).toHaveProperty("idempotency_key", "idem_list_002");
  ```
  > **只改 L343 這一行**;**保留** L344 `expect(listed.body.items[0]).not.toHaveProperty("callback_url");`(本 Task 不投影 callback_url,該 guard 仍有效,勿動)。
- [ ] 跑,確認新 it **通過**且既有 `external-ifc-ready`(**含上一步已翻轉的 L343 斷言**)/ `presigned-ref` / `lifecycle-status` 全綠(遮蔽不回退):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/external-ifc-ready.test.ts tests/presigned-ref.test.ts tests/lifecycle-status.test.ts 2>&1 | tail -20
  ```
  預期:三檔全 passed(L343 因上一步翻轉為正向斷言而綠;若忘了翻轉此檔會紅——那是預期的過時 guard,依上一步修正,**非 regression、勿 revert 功能**)。
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
- Modify `web-viewer-sample/src/console/pages.tsx`(`ConversionSchedulingPage` jobs 表 L1205-1258 **與 ledger records 表 L1149-1199**:ledger 表補對帳鍵 `idempotency_key` 可見格 + testid,供 E2E 跨表 join;`r.idempotency_key` 既有於 L1166 React key)
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
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false, note: "未設定" }); // 真實方法名 coordinatorClient.ts:360(無 get 前綴;本檔既有 it 皆用此名);寫 getMinioWatchStatus 會在 render 前丟 "does not exist"
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
    // idempotent_replay 綁定落地(delta 表第49行「#conv 誠實標記」;fixture false → 顯「新建」)。
    const replay = container.querySelector('[data-testid="conv-job-replay-ifcready_reconcile"]');
    expect(replay?.textContent).toContain("新建");
    // data_volatility 綁定落地(delta 表第54行「#conv 易失性標記」;fixture in_memory_volatile → 顯「易失」)。
    const volatility = container.querySelector('[data-testid="conv-job-volatility-ifcready_reconcile"]');
    expect(volatility?.textContent).toContain("易失");
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
                  <td>
                    <code data-testid={`conv-job-idem-${j.ifc_ready_job_id}`}>{j.idempotency_key ?? "—"}</code>
                    {/* idempotent_replay 誠實標記(delta 第49行綁定點):false=新建、true=命中既有去重 */}
                    <span data-testid={`conv-job-replay-${j.ifc_ready_job_id}`} className="ec-note">{j.idempotent_replay ? t("命中既有", "replay") : t("新建", "new")}</span>
                    {/* data_volatility 易失性標記(delta 第54行綁定點):job 端 in-memory,重啟即清 */}
                    <span data-testid={`conv-job-volatility-${j.ifc_ready_job_id}`} className="ec-note">{j.data_volatility === "persisted" ? t("持久", "persisted") : t("易失·重啟即清", "volatile")}</span>
                  </td>
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
- [ ] 【對帳鍵跨表可見(修 E2E ledger 錨點缺口)】在 ledger records 表(`pages.tsx` L1149-1199)補一格顯示 `idempotency_key`,讓 jobs 表與 ledger 表以同一把鍵可視覺 + 程式對齊(現況 ledger 只把 `r.idempotency_key` 用作 React key、不 render,`conv-ledger-trigger-*` 又僅在 `status==="failed" && object_key` 才出現,queued 場景無任何選擇器可定位 ledger 列)。表頭(L1150 `<th>{t("專案","Project")}</th>` 之前)新增第一欄 `<th>key</th>`;列 render(L1167 `<td>{r.project_display_name || r.project_id}</td>` 之前)新增第一格:
  ```tsx
                    <td><code data-testid={`conv-ledger-idem-${r.idempotency_key}`}>{r.idempotency_key}</code></td>
  ```
  > ledger 表無 colSpan 展開列,新增欄不需改 colSpan。此步僅使既有 `r.idempotency_key` 可見 + 可定位,不改 ledger 資料來源。
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
- Modify `bim-review-coordinator/src/services/minioWatcher.ts`(檔頭 docstring:L12-13「恰兩層(projectId / modelId)」、L27、L64 等把 key 規約描述為兩層的句子;**只改註解,不動 L71+ 函式邏輯**)
- 【只讀核對,不編輯】`docs/superpowers/specs/2026-06-22-minio-watch-key-structure-design.md`(正確檔名多一段 `-design`;其「兩層」命中 L9=P7 浮現的「兩個 layer 問題」非 key 結構、L83=描述「應改寫 openspec live spec」的敘述、L85=跨 spec 調和——**皆已是歷史/調和敘述,不需加 archive 註記**)
- 【只讀核對,不手改】`openspec/specs/minio-watch-auto-intake/spec.md`(**真正 stale 的兩層 live-spec 殘留在此**:L16 仍寫 `{projectId}/{modelId}/model.ifc`。但依 `openspec/CLAUDE.md` 與本 plan 來源 spec §L86「不直接手改 live `specs/`,否則 pr-review-agent 判 blocked」,**禁在本 plan 手改此檔**——處置見 Steps 的 governance 段)

**Steps:**

- [ ] grep 定位殘留「兩層 / two-layer / `{projectId}/{modelId}`」字樣(注意:design 檔名多 `-design`;真正 stale live-spec 在 openspec):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && grep -rn "兩層\|two-layer\|projectId}/{modelId\|{projectId}/{modelId}" bim-review-coordinator/src/services/minioWatcher.ts openspec/specs/minio-watch-auto-intake/spec.md docs/superpowers/specs/2026-06-22-minio-watch-key-structure-design.md
  ```
  預期:`minioWatcher.ts`(L12-13/L27/L64)與 `openspec/specs/minio-watch-auto-intake/spec.md`(L16)有命中;design 檔命中為歷史/調和敘述(不需改)。
- [ ] 修 `minioWatcher.ts` 檔頭 docstring:把描述 key 為「恰兩層 `{projectId}/{modelId}`」的句子(L12-13、L27、L64)改為與 code 一致的「≥3 段:`{專案原名}/…(動態中間層)…/{種類}/{版本}/model.ifc`;`project_raw=首段`、`category=倒數第二段`、`version=末段`,`segments.length<3` 或含空段/純點段判 malformed 略過」。**只改註解字串,不改函式簽章/L71+ 邏輯**(deriveIntakeFromKey code 已正確 ≥3 段,見「現況盤點」)。
- [ ] design 檔(`...-design.md`)只讀核對、**不編輯**:其 L9「兩層」指 P7 部署浮現的兩個 layer 問題(非 key 結構)、L83 是「應改寫 openspec live spec」的敘述、L85 是跨 spec 調和說明——皆已是正確歷史敘述,機械套 `[ARCHIVE]` 註記反而失真(reviewer 明確指出)。故本步不加任何註記。
- [ ] openspec live-spec 兩層殘留(`openspec/specs/minio-watch-auto-intake/spec.md:16`)的 governance 處置——**本 plan 不手改此檔**:
  - 該 ≥3 段更正**已存在**為 active change 的 `## MODIFIED Requirements` delta:`openspec/changes/minio-watch-key-structure/specs/minio-watch-auto-intake/spec.md`(L7 key 規約已寫「由『恰兩層』修訂為多層…≥3 段」、L13-20 scenario 已 ≥3 段)。live spec 之所以仍 stale,只是該 change 尚未 `archive`。
  - 依 `openspec/CLAUDE.md` 與本 plan 來源 spec §L86:含行為變更的 spec MUST 走 active change + `npx openspec archive`,**禁直接手改 live `specs/`**(否則 pr-review-agent 判 blocked)。故 must_fix #5 的「archive stale 兩層 live-spec」正解=透過 OpenSpec archive 生命週期落地,而非在本 plan 手動編輯 live spec。
  - 本 plan 動作:(a) 於本 Task commit message 與 P7 回報中記錄此殘留位置與其歸屬的 active change;(b) 因該 live-spec 亦被 `minio-folderview-and-baseline-disclosure`(見 openspec spec L8 supersede 註)pending-archive 覆寫,實際 `npx openspec archive` 由該 OpenSpec change 生命週期收斂——**執行前須向維護者確認由本 plan 或由 folderview change 負責**(standing reconfirm,勿機械執行;本機 openspec CLI 可能壞,以 CI validate 為準)。此非本欄位重設計的 code 範圍,誠實列為交接項。
- [ ] 跑 coordinator 測試確認純註解改動不影響行為:
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign/bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts 2>&1 | tail -10
  ```
  預期:全 passed(行為未變)。
- [ ] commit(只 stage 真正編輯的 `minioWatcher.ts`;**不 add 不存在或不手改的路徑**,避免 `git add` 對缺檔回 `fatal: pathspec ... did not match` + exit 128 而 `&&` 鏈整段中止、連 minioWatcher.ts 都提交不出去):
  ```bash
  cd C:/Repos/active/iot/AI-BIM-governance/.worktrees/ifc-ready-api-field-redesign && git add bim-review-coordinator/src/services/minioWatcher.ts && git diff --cached --check && git commit -m "docs(coordinator): 修 minioWatcher docstring 兩層殘留 → ≥3 段(對齊 code;openspec live-spec 殘留交 OpenSpec archive 生命週期,見 Task 4)"
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
    // 前置(用確定性手動觸發,不靠 watcher 首輪——minio-watch-auto-intake spec:首輪 SHALL 只登記 baseline 不觸發):
    //   S3 stub 放一顆 松風庵/root/main/000001/model.ifc → POST /api/conversion/trigger { key }
    //   coordinator server-side presign 建立 job + 落 ledger(status=queued,mw_<hash16>);jobs 表與 ledger 表遂共享同一把 idempotency_key。
    await page.goto(`${coordinatorBase}/ui#/conv`);
    // 1) ledger records 表出現該對帳鍵。用 Task 3 新增的 ledger 錨點(queued 亦可見);
    //    不可用 conv-ledger-trigger-*——它僅在 status==="failed" && object_key 才 render,queued 場景不進 DOM,.first() 會命中 0 元素而逾時。
    const ledgerIdem = page.locator('[data-testid^="conv-ledger-idem-"]').first();
    await expect(ledgerIdem).toBeVisible();
    await expect(ledgerIdem).toContainText("mw_");
    // 2) Ifc-ready jobs 表同一 job 的對帳鍵格出現(可與 ledger 對齊)。
    const idemCell = page.locator('[data-testid^="conv-job-idem-"]').first();
    await expect(idemCell).toContainText("mw_");
    // 3) lifecycle chip 顯中文狀態(排隊/轉檔中/偵測),且誠實:不得出現「完成」假 ready(Phase 2 才回填)。
    const chip = page.locator('[data-testid^="conv-job-lifecycle-"]').first();
    await expect(chip).toBeVisible();
    await expect(page.locator('[data-testid^="conv-job-lifecycle-"]')).not.toContainText("完成");
    // 4) usdc 誠實標籤 = 待產生(禁 parsed)。
    await expect(page.locator('[data-testid^="conv-job-usdc-"]').first()).toContainText("待產生");
    // 5) 真正跨表對帳一致:抓 ledger 錨點與 jobs 格兩個字串,斷言「相等」(非只驗 jobs 自身格式)。
    const jobKey = (await idemCell.textContent())?.trim() ?? "";
    const ledgerKey = (await ledgerIdem.textContent())?.trim() ?? "";
    expect(jobKey).toMatch(/^mw_/);
    expect(jobKey).toBe(ledgerKey); // 同一把 idempotency_key 同時出現在 jobs 表與 ledger 表 → 三視圖可 join(才是 Done 要的「對帳鍵一致」)
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
- [ ] `#/conv` Ifc-ready jobs 表 render 對帳鍵 + lifecycle chip + 誠實 usdc/failure,且 delta 表承諾的 `idempotent_replay`(誠實標記)與 `data_volatility`(易失性標記)皆有實際 render + 單元斷言(不得只擴型別/fixture 卻無 UI 消費——重演「吐了但前端看不到」)。
- [ ] ledger records 表補 `idempotency_key` 可見錨點(testid `conv-ledger-idem-*`);E2E 以此錨點(非 failed-only 的 `conv-ledger-trigger-*`)定位 ledger 列,並斷言 jobs 格與 ledger 格字串**相等**佐證跨表對帳一致、無假 ready(誠實鐵律)。
- [ ] **P0 must_fix #1 全出口遮蔽閉環(Task 1B)**:callback outbox → 外部雲端 `conversion_result_ready` payload(`app.ts:1831`)的 `source_ifc.ref` 已套 `maskPresignedRef`(使用者 2026-07-01 裁決遮蔽);守衛測試斷言該 callback payload 不含 `X-Amz-Signature`/`X-Amz-Credential`,且既有六個瀏覽器可見出口守衛不回退。spec §0 / §8.3 的「全出口遮蔽」於本 plan 完成,不再是待裁決開放問題。
- [ ] 回報:改了哪些 tracked files、跑了哪些驗證、哪些沒跑及原因、已知風險(見「明確排除」的 OQ4/OQ7 與 Group-B wiring 未做;openspec live-spec 兩層殘留交 OpenSpec archive 生命週期,見 Task 4 governance 段。P0 callback outbox 出口 app.ts:1831 已於 Task 1B 遮蔽,不再是未竟項)。
