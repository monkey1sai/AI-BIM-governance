# MinIO Watcher Key 結構解析變更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 minio-watcher 的 `deriveIntakeFromKey` 解析真實多層 bucket 結構（專案/動態中間/種類/版本），中文專案名轉成安全 `project_id` 並保留原名供顯示，種類一併帶入進件 payload。

**Architecture:** 純函式 `deriveIntakeFromKey` 改「去 prefix/suffix 後 ≥3 段」規則：第一段=專案、倒數二=種類、末=版本、中間忽略。中文等非安全專案名以 `sanitizeArtifactIdPart`（單一安全定義）判定、不安全則導 `p_<sha256前12hex>` 穩定代號。watcher intake payload 新增 `model_category` 與 `project_display_name`（schema 已 `.passthrough()`，additive 安全）。

**Tech Stack:** TypeScript (Node ESM)、vitest、zod、`@aws-sdk`（既有）。設計 spec：[docs/superpowers/specs/2026-06-22-minio-watch-key-structure-design.md](../specs/2026-06-22-minio-watch-key-structure-design.md)。

## Global Constraints

- 不碰機密、不新增 production 依賴（`sanitizeArtifactIdPart`、`node:crypto` 皆既有）。
- flag-off（`MINIO_WATCH_ENABLED` 未設）行為零變更。
- 「安全」定義唯一真相＝`sanitizeArtifactIdPart`（`bim-review-coordinator/src/services/streamingConversionClient.ts`），不另寫一份規則。
- 規則：去 prefix/suffix 後 **≥3 段且皆非空**才合法；否則 malformed（沿用 `skip_permanent`）。
- 驗證入口：`cd bim-review-coordinator && npm run verify`（= build + test）。
- GitNexus：`deriveIntakeFromKey` impact 已跑＝LOW（僅 `minio-watcher-derive.test.ts` 直接相依）；最終 commit 前跑 `gitnexus_detect_changes`。
- 提交紀律：commit 前 `git diff --cached --check`；commit 訊息結尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## File Structure

- `bim-review-coordinator/src/services/minioWatcher.ts` — `DeriveOk` 介面擴充、`deriveSafeProjectId` 新增、`deriveIntakeFromKey` 改寫、intake payload 加兩欄。
- `bim-review-coordinator/src/services/streamingConversionClient.ts` — 僅讀（既有 `sanitizeArtifactIdPart` export，免改）。
- `bim-review-coordinator/src/app.ts` — `ifcReadyPayloadSchema` 加兩個 optional 欄位（typed）。
- `bim-review-coordinator/src/types.ts` — `ExternalIfcReadyEvent` 加兩個 optional 欄位。
- `bim-review-coordinator/tests/minio-watcher-derive.test.ts` — 單元測試改寫＋新增（核心）。
- `bim-review-coordinator/tests/minio-watcher-loop.test.ts`、`tests/minio-watch-intake-integration.test.ts` — fixture key 升級多層。
- `web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts` — fake S3 fixture key 升級多層。
- `openspec/specs/minio-watch-auto-intake/spec.md` — key 規約段改 ≥3 段。

---

### Task 1: 改寫 deriveIntakeFromKey（≥3 段 + 安全 project_id + category/displayName）

> ⚠️ **本 Task 的程式/測試範例為初稿，已被文末「審查修訂」段覆寫**（`deriveSafeProjectId` 移除→直接重用 `sanitizeArtifactIdPart`；中文測試斷言由 `/^p_[0-9a-f]{12}$/` 改為 `/^mv_[0-9a-f]{8}$/`；segment 驗證加拒收純點段 `.`/`..`）。**實作以「審查修訂」段 + 已合併之程式碼為準**（vitest 431/431 驗證），本段保留為初稿記錄。

**Files:**
- Modify: `bim-review-coordinator/src/services/minioWatcher.ts`（`DeriveOk` 介面、新增 `deriveSafeProjectId`、改 `deriveIntakeFromKey`）
- Test: `bim-review-coordinator/tests/minio-watcher-derive.test.ts`

**Interfaces:**
- Produces: `deriveIntakeFromKey(input) → DeriveOk | DeriveErr`，其中 `DeriveOk = { ok:true; projectId:string; projectDisplayName:string; category:string; externalModelVersionId:string; sourceEtagFrom:(etag:string)=>string }`。
- Consumes: `sanitizeArtifactIdPart(raw:string):string`（from `./streamingConversionClient.js`）、既有 `node:crypto`、既有 `stripEtagQuotes`。

- [ ] **Step 1: 改寫測試（紅）** — 將 `tests/minio-watcher-derive.test.ts` 內既有「兩層」案例改為多層並新增中文/安全代號案例。替換檔案前半（保留 idempotency/correlation/etag 三個既有 test 不動，但其 deriveIntakeFromKey 用例的 key 改多層）：

```ts
import { describe, expect, it } from "vitest";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "../src/services/minioWatcher.js";

describe("minioWatcher 純函式導出（≥3 段：專案/種類/版本）", () => {
  it("真實 4 層（含中文專案名）→ 安全 project_id、種類=倒數二、版本=末、保留中文顯示名", () => {
    const r = deriveIntakeFromKey({
      key: "東勢區許良宇紀念圖書館/root/main/181b3686-2263-4c53-93d9-ba95a010fc85/model.ifc",
      prefix: "",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toMatch(/^p_[0-9a-f]{12}$/);          // 中文→安全代號
    expect(r.projectDisplayName).toBe("東勢區許良宇紀念圖書館"); // 原名如實保留
    expect(r.category).toBe("main");                           // 倒數第二層
    expect(r.externalModelVersionId).toBe("181b3686-2263-4c53-93d9-ba95a010fc85"); // 末層
  });

  it("中文專案名導出確定性：同名 → 同 project_id", () => {
    const a = deriveIntakeFromKey({ key: "中文專案/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    const b = deriveIntakeFromKey({ key: "中文專案/other/v2/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.projectId).toBe(b.projectId); // 同中文專案名 → 同安全代號（版本歸於同一專案）
  });

  it("英數安全專案名（899）→ project_id 原樣不動", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.category).toBe("main");
    expect(r.externalModelVersionId).toBe("v1");
  });

  it("恰 3 層（無動態中間層）合法", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
  });

  it("帶 prefix 時先去 prefix 再以 ≥3 段解析", () => {
    const r = deriveIntakeFromKey({ key: "tenant_a/899/main/v1/model.ifc", prefix: "tenant_a/", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.category).toBe("main");
    expect(r.externalModelVersionId).toBe("v1");
  });

  it("少於三段（2 段 / 1 段）→ ok=false 帶 reason", () => {
    expect(deriveIntakeFromKey({ key: "899/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
    expect(deriveIntakeFromKey({ key: "v1/model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
  });

  it("prefix 非空且不以 '/' 結尾 → ok=false（避免靜默截斷 projectId）", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "89", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("有效 prefix 但 key 不在 prefix 下 → ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "tenant_b/899/main/v1/model.ifc", prefix: "tenant_a/", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("key 不以 keySuffix 結尾 → ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.usdc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("suffix");
  });

  it("含空段（雙斜線 899//main/v1/model.ifc）→ ok=false（不可被靜默正規化）", () => {
    const r = deriveIntakeFromKey({ key: "899//main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
  });

  it("結尾空段（899/main/v1//model.ifc）→ ok=false", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1//model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
  });

  it("etag 去外層引號後納入 source_ifc.etag（不重複加引號）", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceEtagFrom('"abc123"')).toBe("abc123");
    expect(r.sourceEtagFrom("abc123")).toBe("abc123");
  });

  it("idempotency key 為 bucket|key|etag 的確定性 sha256 前 16 hex，帶 mw_ 前綴", () => {
    const a = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    const b = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    const c = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"DIFFERENT"');
    expect(a).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("correlation id 為 minio-watch-<hash8>，hash 由 bucket|key|etag 導出", () => {
    const a = correlationIdFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    expect(a).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(correlationIdFor("bim-control", "899/main/v1/model.ifc", '"abc123"')).toBe(a);
  });
});
```

- [ ] **Step 2: 跑測試確認紅** — `cd bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts`。Expected: 多個 FAIL（`projectDisplayName`/`category` 未定義、舊 2 層案例斷言反轉）。

- [ ] **Step 3: 改 `DeriveOk` 介面**（minioWatcher.ts，約 L41-47）：

```ts
export interface DeriveOk {
  ok: true;
  projectId: string;            // 安全代號（中文→p_hash；英數原樣）
  projectDisplayName: string;   // 專案原名（如中文），如實保留供顯示/對帳
  category: string;             // 種類＝倒數第二層
  externalModelVersionId: string; // 版本＝最後一層
  /** etag → source_ifc.etag（去外層引號，不重複加引號）。 */
  sourceEtagFrom: (etag: string) => string;
}
```

- [ ] **Step 4: 新增 import 與 `deriveSafeProjectId`**（minioWatcher.ts 檔首 import 區加一行；helper 放在 `deriveIntakeFromKey` 上方）：

```ts
import { sanitizeArtifactIdPart } from "./streamingConversionClient.js";
```

```ts
/**
 * 安全 project_id 導出：sanitizeArtifactIdPart 為「安全」唯一真相。
 * 已是英數安全（如 899）原樣不動；含中文等非安全字元 → 穩定 p_<sha256 前12hex>
 * （同一原名永遠同代號 → 同專案不同版本歸於同一 project_id）。
 */
export function deriveSafeProjectId(raw: string): string {
  const sanitized = sanitizeArtifactIdPart(raw);
  if (sanitized.length > 0 && sanitized === raw) return raw;
  return `p_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}
```

> 註：`crypto` 已於 minioWatcher.ts 檔首 import（既有 `idempotencyKeyFor`/`correlationIdFor` 使用）。若該檔以 `import { createHash } from "node:crypto"` 形式 import，則此處改用 `createHash(...)`；以該檔現有用法為準（單一風格）。

- [ ] **Step 5: 改寫 `deriveIntakeFromKey` 主體**（minioWatcher.ts，約 L62-96 的 segments 檢查與回傳）：

```ts
  const segments = withoutSuffix.split("/");
  // ≥3 段且皆非空才合法：第一段=專案、倒數二=種類、末=版本，中間動態層忽略。
  // 保留空段檢查（防 S3 雙斜線 key 被靜默正規化）。
  if (segments.length < 3 || segments.some((s) => s === "")) {
    return {
      ok: false,
      reason: `去 prefix/suffix 後未湊齊三段（專案/種類/版本，不可含空段）：${withoutSuffix}`,
    };
  }
  const projectRaw = segments[0];
  const category = segments[segments.length - 2];
  const version = segments[segments.length - 1];
  return {
    ok: true,
    projectId: deriveSafeProjectId(projectRaw),
    projectDisplayName: projectRaw,
    category,
    externalModelVersionId: version,
    sourceEtagFrom: stripEtagQuotes,
  };
```

並更新函式 docstring 的「恰兩層」描述為「≥3 段：專案/…(動態)…/種類/版本」。

- [ ] **Step 6: 跑測試確認綠** — `cd bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts`。Expected: PASS（全部）。

- [ ] **Step 7: Commit**

```bash
git add -- bim-review-coordinator/src/services/minioWatcher.ts bim-review-coordinator/tests/minio-watcher-derive.test.ts
git diff --cached --check
git commit -m "feat(minio-watch): deriveIntakeFromKey 改 >=3 段解析 + 中文專案名安全代號

專案=第一段/種類=倒數二/版本=末、中間動態層忽略；中文等非安全專案名以
sanitizeArtifactIdPart 判定、不安全導 p_<sha256前12hex> 穩定代號並保留原名顯示。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: intake payload 帶 model_category + project_display_name（schema/type typed）

**Files:**
- Modify: `bim-review-coordinator/src/services/minioWatcher.ts`（payload 物件，約 L296-309）
- Modify: `bim-review-coordinator/src/app.ts`（`ifcReadyPayloadSchema`，約 L154-173）
- Modify: `bim-review-coordinator/src/types.ts`（`ExternalIfcReadyEvent`）
- Test: `bim-review-coordinator/tests/minio-watch-intake-integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DeriveOk.category` / `DeriveOk.projectDisplayName`。
- Produces: intake POST body 多 `model_category:string`、`project_display_name:string`；schema/type 接受並保留。

- [ ] **Step 1: 寫/補整合測試（紅）** — 於 `tests/minio-watch-intake-integration.test.ts` 既有「watcher 觸發後 POST body」斷言處（或新增一個 it），對多層 key 斷言 body 帶新欄位。範例斷言片段（依該檔既有 harness 變數名接入；harness 已攔截 loopback POST 取得 body）：

```ts
it("多層 key 觸發後 POST body 帶 model_category 與 project_display_name", async () => {
  // 安排：fake S3 注入 "中文專案/root/main/UUID-x/model.ifc"（baseline 後）
  // 動作：等 watcher 觸發、捕獲 loopback POST body（沿用本檔既有攔截機制）
  // 斷言：
  expect(body.project_id).toMatch(/^p_[0-9a-f]{12}$/);
  expect(body.project_display_name).toBe("中文專案");
  expect(body.model_category).toBe("main");
  expect(body.external_model_version_id).toBe("UUID-x");
});
```

> 若該檔現有攔截/等待 helper 命名不同，沿用之；本步驟只新增斷言、不改 harness 結構。

- [ ] **Step 2: 跑確認紅** — `cd bim-review-coordinator && npx vitest run tests/minio-watch-intake-integration.test.ts`。Expected: FAIL（body 無 `model_category`/`project_display_name`）。

- [ ] **Step 3: payload 加兩欄**（minioWatcher.ts，約 L296）：

```ts
    const body = {
      event: "ifc_ready",
      tenant_id: opts.tenantId,
      project_id: derived.projectId,
      project_display_name: derived.projectDisplayName,
      model_category: derived.category,
      external_model_version_id: derived.externalModelVersionId,
      external_conversion_task_id: `${derived.externalModelVersionId}_mw_${etagShort}`,
      source_ifc: {
        ref: presignedRef,
        etag: derived.sourceEtagFrom(etag),
        filename: "model.ifc",
        format: "ifc",
      },
      requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
    };
```

- [ ] **Step 4: schema 加兩個 optional 欄位**（app.ts `ifcReadyPayloadSchema`，在 `external_model_version_id` 後加；schema 已 `.passthrough()`，此為 typed 化）：

```ts
    external_model_version_id: z.string().min(1),
    project_display_name: z.string().min(1).nullish(),
    model_category: z.string().min(1).nullish(),
```

- [ ] **Step 5: type 加兩個 optional 欄位**（types.ts `ExternalIfcReadyEvent` interface 內）：

```ts
  project_display_name?: string | null;
  model_category?: string | null;
```

- [ ] **Step 6: 跑確認綠** — `cd bim-review-coordinator && npx vitest run tests/minio-watch-intake-integration.test.ts`。Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add -- bim-review-coordinator/src/services/minioWatcher.ts bim-review-coordinator/src/app.ts bim-review-coordinator/src/types.ts bim-review-coordinator/tests/minio-watch-intake-integration.test.ts
git diff --cached --check
git commit -m "feat(minio-watch): intake payload 帶 model_category 與 project_display_name

種類與專案原名隨進件帶入（schema/type typed、optional、passthrough 相容），
供下游/UI 取用；不破壞既有 consumer。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 升級 watcher loop / e2e fixture key 為多層

**Files:**
- Modify: `bim-review-coordinator/tests/minio-watcher-loop.test.ts`（若含 2 層 key）
- Modify: `web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`（fake S3 fixture key）

**Interfaces:**
- Consumes: Task 1 的 ≥3 段規則。

- [ ] **Step 1: 找出所有 2 層 fixture key** — `cd bim-review-coordinator && grep -rn "/model.ifc" tests/minio-watcher-loop.test.ts` 與 repo 根 `grep -n "model.ifc" web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`。標出形如 `<a>/<b>/model.ifc`（2 段）者。

- [ ] **Step 2: 升級 e2e fixture key（保持 project=988 斷言成立）** — `web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`：
  - L34 與 L146：`{ key: "899/baseline/model.ifc", etag: "base1" }` → `{ key: "899/main/baseline/model.ifc", etag: "base1" }`
  - L230：`s3State.objs.push({ key: "988/auto/model.ifc", etag: "auto9" });` → `{ key: "988/main/auto/model.ifc", etag: "auto9" }`
  - 其餘斷言（`project_id === "988"`、`/^988$/`）不變：新規則下 project=第一段=988（英數安全、原樣）。

- [ ] **Step 3: 升級 loop test fixture key**（若 Step 1 找到 2 層 key）— 將每個 `<a>/<b>/model.ifc` 改為 `<a>/main/<b>/model.ifc`（保持原 project=`<a>`、version=`<b>` 斷言成立，category 補 `main`）。若該檔對 derived 欄位有斷言，補上 `category`/`projectId` 對應預期。

- [ ] **Step 4: 跑 loop test 綠** — `cd bim-review-coordinator && npx vitest run tests/minio-watcher-loop.test.ts`。Expected: PASS。（e2e 需 dist-ui build，於 Task 5 全量驗證或 P7 部署驗證跑；本步驟先確保單元/整合層綠。）

- [ ] **Step 5: Commit**

```bash
git add -- bim-review-coordinator/tests/minio-watcher-loop.test.ts web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts
git diff --cached --check
git commit -m "test(minio-watch): fixture key 升級為 >=3 段以符合新解析規則

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 更新 openspec minio-watch-auto-intake key 規約段

**Files:**
- Modify: `openspec/specs/minio-watch-auto-intake/spec.md`

- [ ] **Step 1: 改 key 規約 wording** — 將 spec 內「`{projectId}/{modelId}/model.ifc`」「恰兩層」等描述改為：

```
key 規約：去 prefix 與 keySuffix 後 SHALL ≥3 段且皆非空——第一段為「專案」、
倒數第二段為「種類」、最後一段為「版本」，中間層（專案管理者動態管理）識別時忽略。
專案名含非安全字元（如中文）時 SHALL 導為穩定安全 project_id（sanitizeArtifactIdPart
判定、不安全則 p_<sha256前12hex>），並保留原名於 project_display_name 供顯示/對帳。
種類隨 intake 帶入 model_category。未湊齊三段或含空段 SHALL 判 malformed（skip_permanent）。
```

對應 Scenario 內若有 `{projectId}/{modelId}` 字樣一併調和為三段結構。

- [ ] **Step 2: 本機 openspec 驗證（best-effort）** — `npx openspec validate minio-watch-auto-intake --strict`（本機 CLI 可能壞，見 memory；若失敗以 CI pr-review-agent 真驗為準，記錄於 PR）。

- [ ] **Step 3: Commit**

```bash
git add -- openspec/specs/minio-watch-auto-intake/spec.md
git diff --cached --check
git commit -m "docs(openspec): minio-watch key 規約改 >=3 段（專案/種類/版本）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 全量驗證 + GitNexus detect_changes（收口閘）

**Files:** 無（驗證閘）

- [ ] **Step 1: 全量 verify** — `cd bim-review-coordinator && npm run verify`。Expected: build + 全測試 PASS。失敗則回對應 Task 修。

- [ ] **Step 2: GitNexus detect_changes** — 對 `AI-BIM-governance` 跑 `gitnexus_detect_changes`，確認改動範圍＝minioWatcher/app/types + 測試，無預期外 symbol 異動；HIGH/CRITICAL 先回報。

- [ ] **Step 3: 確認無殘留 placeholder/whitespace** — `git log --oneline -6` 檢視 5 個 commit；`git diff --cached --check` 應乾淨。

> 後續（不在本 plan 步驟，屬部署驗證 task #4/#5）：重建部署區 coordinator（含本 branch）→ 對真 MinIO 丟多層新 key 跑 P7 browser E2E 取證 → 更新 evidence README → 開 PR。

---

## Self-Review

**1. Spec coverage：**
- R1（三段規則）→ Task 1 Step 5。
- R2（malformed 跳過）→ Task 1 Step 5（`< 3 || 含空段`）+ 測試 Step 1。
- R3（中文顯示 + 安全 id）→ Task 1（`deriveSafeProjectId` + `projectDisplayName`）。
- R4（UI 完整顯示）→ 既有 `last_triggered[].key` 顯示完整 key（design §4.4）；本 plan 不需改 UI（key 已含全結構）。如需「拆三欄」加值顯示屬 design §4.4 follow-up，未納入（YAGNI）。
- R5（儲存精簡 + 三部分）→ Task 2（payload 帶三部分；不照抄中間層）。
- R6（flag-off 零變更）→ 純函式與 payload 改動僅在 watcher 啟用且觸發路徑；未啟用不執行。

**2. Placeholder scan：** Task 2 Step 1 與 Task 3 Step 3 對「既有 harness 變數名／是否含 2 層 key」留有實作時對齊空間，已標明沿用既有命名、非待填邏輯；其餘步驟均含完整程式碼與指令。

**3. Type consistency：** `DeriveOk`（Task 1）的 `projectId/projectDisplayName/category/externalModelVersionId` 與 Task 2 payload 欄位、app.ts schema、types.ts 欄位名一致（`project_display_name`/`model_category`）。

---

## 審查修訂（ultracode wf_6a8d956e-e07，2026-06-22）

5 視角對抗審查裁決 **issues**。以下修訂**覆寫上方對應任務**（衝突時以本節為準）。

**＋Task 0（OpenSpec change provenance，mustFix）**：本變更含 production code 行為變更，先建 active change `openspec/changes/minio-watch-key-structure/`（`proposal.md` + `tasks.md` + `specs/minio-watch-auto-intake/spec.md` 的 `## MODIFIED Requirements` delta）。理由：pr-review-agent 對「無 active change 的 code 行為變更」判 **blocked**（memory `pr-review-agent-needs-active-change-id` 已記）。PR merge 後 `npx openspec archive` 落地。

**Task 1 修正**：
- Step 1 為「**整檔覆寫** `minio-watcher-derive.test.ts`」（刪除原「保留三個既有 test 不動」誤導語；提供的 ts 即完整檔，新 reason「未湊齊三段」取代舊「兩層」斷言）。
- safe project_id **不自造 `p_<hash>`**：直接 `project_id = sanitizeArtifactIdPart(projectRaw)`（單一真相、跨路徑冪等一致）。純中文→`mv_<hash8>`、部分安全→`${safe}_<hash8>`、英數→原樣。**移除** `deriveSafeProjectId` helper。測試斷言：中文案例改斷言 `/^mv_[0-9a-f]{8}$/`（非 `p_…`）、`899`→`899`、同名確定性仍成立。
- **segment 驗證加拒收 `.`/`..`**（與空段並列判 malformed）：`segments.some((s) => s === "" || s === "." || s === "..")`。補測試 `key="../main/v1/model.ifc" → ok=false`。
- NFC/NFD：不正規化、列已知限制（design §4.2）；不改 code。

**Task 2 修正（落地深度 + 既有測試）**：
- 種類/專案原名**只隨 POST body 傳遞、不進 store**（R5 已改）。新欄位斷言**改放 `minio-watcher-loop.test.ts` 的 `startIntakeStub` received[].body**（真攔 raw body），**不放** integration（它讀 store-list、不含這兩欄→結構不可達）。
- 仍加 app.ts schema / types.ts 的兩個 optional 欄位（typed、passthrough 相容）。**不**改 `ExternalIfcReadyStore` / `summarizeIfcReadyJob`（維持 YAGNI）。

**Task 3 修正（測試遷移升為必改、窮舉）**：
- `minio-watcher-loop.test.ts`：**所有** 2 段 key 補中段——`899/xxx`→`899/main/xxx`、`900/yyy`→`900/main/yyy`、`988/zzz`→`988/main/zzz`、分頁 inline-XML `899/p1`→`899/main/p1`、`900/p2`→`900/main/p2`；同步更新所有 `last_triggered[].key` 斷言；project/version 維持（`988`/`zzz`），新增 `model_category==='main'`（在 received body 上）。
- **翻轉 malformed fixture**（現 L254-265 用 4 段當壞例，新規則下變合法）→ 改用真正 <3 段（如去 suffix 後僅 1 段的 `bad/model.ifc`）當 malformed，保留 `skipped_malformed_total>=1`、`received.length===0`。
- `minio-watch-intake-integration.test.ts` 既有 it（77-172）：baseline `899/xxx`→`899/main/xxx`、注入 `988/zzz`→`988/main/zzz`，ref/key 子字串斷言同步含 `988/main/zzz/model.ifc`。
- e2e spec：L34/146 baseline、L230 注入升級多層；順手更新 L266 註解舊 key。
- 收口閘 `npm run verify`（全測試）為窮舉正確性的**最終強制**（漏改必紅）。

**Task 4 修正**：改為在 Task 0 的 active change 內寫 `minio-watch-auto-intake` 的 `## MODIFIED Requirements` delta（含「≥3 段：專案/種類/版本」「中文→`sanitizeArtifactIdPart` 安全 id」「種類/原名只隨 payload 傳遞不入 store」「與 `minio-fileserver-source` 不同 surface 之調和句」），**不**直接改 live `specs/`。

**已知/可接受（不改 code）**：跨路徑 NFC/NFD 限制（design §4.2）；`sanitizeArtifactIdPart` 對純中文輸出 `mv_<hash8>`（不可讀但穩定，可讀性由 `project_display_name` + 完整 key 補足）。
