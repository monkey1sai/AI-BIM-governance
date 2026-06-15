# MinIO Watch Auto-Intake Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** coordinator 新增 env-opt-in `minioWatcher`，定時 `ListObjectsV2` 偵測 bucket 內新的 `*/model.ifc` 物件後自打 loopback `POST /api/external/ifc-ready`，讓既有下載/sanitize/dispatch/poll/callback 鏈全自動走完，並在 `#/conv` 顯示 watcher 真實狀態。

**Architecture:** watcher 是純增量的「本地自動化外部 IFC worker」——對既有 intake/去重/sanitize/dispatch 契約零改動（spec §3 非目標）。它扮演原本由外部 IFC worker 手動 `POST /api/external/ifc-ready` 的角色，靠確定性 `X-Idempotency-Key`（物件 bucket/key/etag 導出）讓重啟重掃命中既有 `idempotencyIndex` 去重。首掃只登 baseline 不觸發，防止對既有 bucket 爆量。前端 `#/conv` 的 `ConversionSchedulingPage` 新增唯讀狀態 Panel，呼叫新 `GET /api/external/minio-watch/status`。

**Tech Stack:** TypeScript / Node 22；coordinator＝Express + Socket.IO（`bim-review-coordinator/`，vitest + supertest）；新 production dependency `@aws-sdk/client-s3`（僅 `ListObjectsV2Command` + `GetObjectCommand` presigner，MinIO 官方 S3 相容）；前端＝React（`web-viewer-sample/`，vitest renderToString + Playwright E2E）。

---

## 既有程式碼導航（執行者零脈絡前先讀這些精確位置）

GitNexus FTS index 在本機為 degraded（query 回空、warning 提示 `gitnexus analyze --force`），故以下路徑為 Grep/Read 直接核實結果，非臆測：

**coordinator（`bim-review-coordinator/`）**

- `src/config.ts` — `CoordinatorConfig` interface（L21–L80）+ `loadConfig`（L304–L383）。既有 env helper：`parseBooleanEnv`（L89）、`numberFromEnv`（L82）、`integerFromEnv(names, fallback, {min,max})`（L162，**會 throw 於非整數/越界**）。`externalIntakeWebhookSecret`（L353 預設 `"dev-webhook-secret"`）、`conversionPollEnabled`（L375）、`port`（L307 預設 8004）。
- `src/app.ts` —
  - `createCoordinatorApp(overrides, options)`（L282）；內部 `const config = loadConfig(overrides)`（L286）、`const server = http.createServer(app)`（L288）。
  - intake 契約 schema：`ifcReadyPayloadSchema`（L140–L159，需 `event:"ifc_ready"` / `tenant_id` / `project_id` / `external_model_version_id` / `source_ifc{ref,etag}` / 選 `requested_outputs` / `callback_url`）。
  - intake route：`app.post("/api/external/ifc-ready", ...)`（L671）。
  - **loopback self-POST 既有先例**：`app.post("/api/dev/ifc-sources/:sourceId/register")`（L1477）內 `const selfBase = "http://127.0.0.1:${config.port}"`（L1492）、`fetch("${selfBase}/api/external/ifc-ready", { headers:{ "X-Webhook-Secret": config.externalIntakeWebhookSecret, "X-Correlation-Id":..., "X-Idempotency-Key":... }, body: JSON.stringify({ event:"ifc_ready", tenant_id, project_id, external_model_version_id, external_conversion_task_id, source_ifc:{ref,etag,filename} }) })`（L1495–L1511）。watcher 逐字比照此 header/payload 形狀。
  - status route 既有讀法先例：`app.get("/api/external/ifc-ready", ...)`（L774）。
  - `dispose`（L1688–L1698）：`for (const handle of pollerRegistry.values()) handle.cancel(); ...`。`return { app, server, io, config, store, eventLog, structLog, dispose }`（L1700）。watcher 的 cancel 掛這裡。
  - structured log 先例：`structLog.withTraceId(...).anomaly("autoPoll", "...", { anomaly_kind, reason, ... })`（L1029, L1043）。
- `src/index.ts` — 生產入口：`const { server, io, config, structLog, dispose } = createCoordinatorApp(); server.listen(config.port, config.host, ...)`（L4, L6）。watcher 在 `createCoordinatorApp` 內 gated by `config.minioWatchEnabled` 自啟（預設關），不動 `index.ts`。
- `tests/auto-poll-conversion.test.ts` — setTimeout 鏈 + 本機 `http` stub + `createCoordinatorApp` 整合測試的權威範本（fake streaming server L47–L91、`makeApp` overrides L129–L146、`waitFor` polling helper L160–L167）。watcher 整合測試比照。
- `tests/external-ifc-ready.test.ts` — `CONTRACT_PATH = path.resolve(TEST_DIR,"..","..","tests","contracts","ifc_ready_payload.json")`（L17，**repo-root** `tests/contracts/`，非 sub-repo）；`makeApp` + supertest 範本（L46–L58）。
- 契約 example：repo-root `tests/contracts/ifc_ready_payload.json`。`worker_compatibility_example.payload`（L67–L73）逐字示範 MinIO 形狀：`ifc_path:"http://192.168.20.234:9000/bim-control/899/xxx/model.ifc"`、`project_id:"899"`、`version:"xxx"`、`task_id:"task_img_001"`，且 `field_mapping`（L74–L82）載明 `version → external_model_version_id`。即 key `bim-control/{projectId}/{modelId}/model.ifc` → `project_id={projectId}`、`external_model_version_id={modelId}`。

**前端（`web-viewer-sample/`）**

- `src/console/coordinatorClient.ts` — `IfcReadyListItem` interface（L98–L112）；`coordinatorClient` object literal（L122–L131，`jsonGet` helper L26–L32）。新增 `MinioWatchStatus` interface + `minioWatchStatus` method。
- `src/console/pages.tsx` — `ConversionSchedulingPage`（L280–L329）；imports `useCallback/useEffect/useState`（L3）、`Btn, Field, Metric, Panel, ProvTag`（L4）、`coordinatorClient, IfcReadyListItem`（L7）。既有 Panel/LifecycleStrip/Field idiom 見 L295–L301。
- `src/console/components.tsx` — `Panel({title,sub,prov,actions,children})`（L31）、`Field({k,v,prov})`（L58）、`Btn({children,caption,prov,disabled,onClick,"data-testid"})`（L80）、`ProvTag`（L5）。
- `src/console/data.ts` — `type Prov = "asbuilt"|"artifact"|"demo"|"p1"|"p15"|"p3"|"p4"`（L6）。watcher status API 為真 → prov `"asbuilt"`。
- `src/console/EdgeConsole.tsx` — route `#/conv` → `<ConversionSchedulingPage />`（L67）。不需改 route，沿用既有頁。
- `src/console/IntakeSelectPage.test.tsx` — `renderToString(<Page/>)` + 斷言文案/`data-testid`/`ec-prov` 的 vitest 範本（L9–L41）。
- `e2e/conversion-artifact-id-sanitize.spec.ts` — Playwright 範本：spawn `tsx src/index.ts` coordinator + 本機 stub、`CONSOLE_DIST_DIR` 服務 dist-ui、`page.goto("${coordinatorBase}/ui#/conv")`、conditional-skip 誠實揭露（L27–L36）、screenshot 落 `../artifacts/e2e/`（L321）。watcher E2E 逐節比照。
- `playwright.config.ts` — `testDir:"./e2e"`、report 落 `../artifacts/e2e/report`、`webServer` 起 viewer :5180（與本 spec 無關，本 spec goto 自起 coordinator）。
- `package.json` scripts：coordinator `npm run verify`＝`build && test`（vitest run）；viewer `npm test`＝`vitest run`、`npm run test:e2e`＝`playwright test`、`npm run build:ui`＝`vite build --base=/ui/ --outDir dist-ui`。

---

## Task 1: config — minioWatcher env 欄位

新增 8 個 env 欄位（全 opt-in，預設關）+ `minioWatchSelfBaseUrl` 測試 seam，watcher 與 status API 讀此 config。

**Files:**
- Modify: `bim-review-coordinator/src/config.ts`
- Test: `bim-review-coordinator/tests/config-minio-watch.test.ts` (Create)

- [ ] 寫失敗測試 `bim-review-coordinator/tests/config-minio-watch.test.ts`：驗預設關 + env 覆寫 + interval 下限。

```ts
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const MINIO_KEYS = [
  "MINIO_WATCH_ENABLED",
  "MINIO_WATCH_ENDPOINT",
  "MINIO_WATCH_BUCKET",
  "MINIO_WATCH_PREFIX",
  "MINIO_WATCH_ACCESS_KEY",
  "MINIO_WATCH_SECRET_KEY",
  "MINIO_WATCH_INTERVAL_SECONDS",
  "MINIO_WATCH_KEY_SUFFIX",
];

afterEach(() => {
  for (const k of MINIO_KEYS) delete process.env[k];
});

describe("loadConfig MinIO watch fields", () => {
  it("預設關閉且欄位有安全預設（不需任何 env）", () => {
    const c = loadConfig();
    expect(c.minioWatchEnabled).toBe(false);
    expect(c.minioWatchEndpoint).toBe("");
    expect(c.minioWatchBucket).toBe("");
    expect(c.minioWatchPrefix).toBe("");
    expect(c.minioWatchAccessKey).toBe("");
    expect(c.minioWatchSecretKey).toBe("");
    expect(c.minioWatchIntervalSeconds).toBe(60);
    expect(c.minioWatchKeySuffix).toBe("/model.ifc");
  });

  it("env 覆寫被讀入；interval 低於 10 夾為 10", () => {
    process.env.MINIO_WATCH_ENABLED = "true";
    process.env.MINIO_WATCH_ENDPOINT = "http://192.168.20.234:9000";
    process.env.MINIO_WATCH_BUCKET = "bim-control";
    process.env.MINIO_WATCH_PREFIX = "tenant_a/";
    process.env.MINIO_WATCH_ACCESS_KEY = "ak";
    process.env.MINIO_WATCH_SECRET_KEY = "sk";
    process.env.MINIO_WATCH_INTERVAL_SECONDS = "3";
    process.env.MINIO_WATCH_KEY_SUFFIX = "/scene.ifc";
    const c = loadConfig();
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchEndpoint).toBe("http://192.168.20.234:9000");
    expect(c.minioWatchBucket).toBe("bim-control");
    expect(c.minioWatchPrefix).toBe("tenant_a/");
    expect(c.minioWatchAccessKey).toBe("ak");
    expect(c.minioWatchSecretKey).toBe("sk");
    expect(c.minioWatchIntervalSeconds).toBe(10); // 下限夾住
    expect(c.minioWatchKeySuffix).toBe("/scene.ifc");
  });

  it("overrides 直接設值優先於 env 預設", () => {
    const c = loadConfig({ minioWatchEnabled: true, minioWatchBucket: "ov-bucket" });
    expect(c.minioWatchEnabled).toBe(true);
    expect(c.minioWatchBucket).toBe("ov-bucket");
  });
});
```

- [ ] 跑確認失敗（欄位尚未存在，TS 編譯/執行紅）。

```bash
cd bim-review-coordinator && npx vitest run tests/config-minio-watch.test.ts
```

預期：fail（`minioWatchEnabled` 等不存在於 `CoordinatorConfig`，型別錯誤或 `undefined`）。

- [ ] 在 `CoordinatorConfig` interface（`src/config.ts`，緊接 `consoleDistDir: string;` 之後、`}` 之前 L79）加欄位：

```ts
  // minio-watch-auto-intake（O4 觸發機制 B 案，預設關）：env opt-in 的 MinIO
  // ListObjectsV2 輪詢自動 intake。watcher 扮演本地自動化外部 IFC worker，
  // 自打 loopback POST /api/external/ifc-ready；既有 intake/去重/dispatch 契約零變動。
  minioWatchEnabled: boolean;            // MINIO_WATCH_ENABLED，default false
  minioWatchEndpoint: string;            // MINIO_WATCH_ENDPOINT，如 http://192.168.20.234:9000
  minioWatchBucket: string;              // MINIO_WATCH_BUCKET，如 bim-control
  minioWatchPrefix: string;              // MINIO_WATCH_PREFIX，default 空
  minioWatchAccessKey: string;           // MINIO_WATCH_ACCESS_KEY（唯讀帳號；不落 tracked 檔）
  minioWatchSecretKey: string;           // MINIO_WATCH_SECRET_KEY（同上）
  minioWatchIntervalSeconds: number;     // MINIO_WATCH_INTERVAL_SECONDS，default 60，下限 10
  minioWatchKeySuffix: string;           // MINIO_WATCH_KEY_SUFFIX，default /model.ifc（規約檔名）
  // 測試 seam：watcher 自打 loopback 的 base url。default 空＝執行期用 http://127.0.0.1:${port}。
  // 整合測試以 listen(0) 取得實際 port 後注入完整 base，避免依賴固定 8004。
  minioWatchSelfBaseUrl: string;
```

- [ ] 在 `loadConfig` return literal（`src/config.ts`，緊接 `consoleDistDir: ...` 之後、`...overrides,` 之前 L380）加值：

```ts
    minioWatchEnabled: parseBooleanEnv("MINIO_WATCH_ENABLED", false),
    minioWatchEndpoint: process.env.MINIO_WATCH_ENDPOINT || "",
    minioWatchBucket: process.env.MINIO_WATCH_BUCKET || "",
    minioWatchPrefix: process.env.MINIO_WATCH_PREFIX || "",
    minioWatchAccessKey: process.env.MINIO_WATCH_ACCESS_KEY || "",
    minioWatchSecretKey: process.env.MINIO_WATCH_SECRET_KEY || "",
    minioWatchIntervalSeconds: Math.max(10, numberFromEnv("MINIO_WATCH_INTERVAL_SECONDS", 60)),
    minioWatchKeySuffix: process.env.MINIO_WATCH_KEY_SUFFIX || "/model.ifc",
    minioWatchSelfBaseUrl: process.env.MINIO_WATCH_SELF_BASE_URL || "",
```

- [ ] 跑確認通過。

```bash
cd bim-review-coordinator && npx vitest run tests/config-minio-watch.test.ts
```

預期：3 個 it 全 pass。

- [ ] commit。

```bash
cd bim-review-coordinator && git add src/config.ts tests/config-minio-watch.test.ts && git commit -m "feat(coordinator): minioWatch config 欄位（env opt-in，預設關）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: 新增 @aws-sdk/client-s3 production dependency

watcher 用 SDK 的 `ListObjectsV2Command`（唯讀 list）與 `GetObjectCommand` presigner（presigned GET URL），不自寫 SigV4。

**Files:**
- Modify: `bim-review-coordinator/package.json`
- Modify: `bim-review-coordinator/package-lock.json`（npm install 產出）
- Create: `bim-review-coordinator/tests/aws-sdk-credentials-guard.test.ts`（顯式 credentials 防護網，見下「依賴透明度與防護網」）

**依賴透明度與防護網（quality review 補強，IMPORTANT #1 / #2）：**

- **顯式 credentials 約束（IMPORTANT #1）**：`@aws-sdk/client-s3` 直接依賴鏈含
  `@aws-sdk/credential-provider-node` → `@smithy/credential-provider-imds`。Task 3/5 的
  `new S3Client({...})` **MUST** 顯式傳入 `credentials: { accessKeyId, secretAccessKey }`；
  否則 SDK 預設 `defaultProvider()` 在非 EC2 環境（本 repo＝LAN MinIO）會嘗試 IMDS 探測
  （`http://169.254.169.254/`）造成每次 watcher 初始化 ~5s timeout，或在有 `~/.aws`
  shared-config 的開發機上「靜默撈到無關 AWS 金鑰」（更危險，已於 guard 的 mutation
  驗證重現）。本 task 同步落地 dependency-layer guard
  `tests/aws-sdk-credentials-guard.test.ts`（與尚未建的 `minioWatcher.ts` 無耦合），以哨兵
  值等式 + <1s 解析時間驗證顯式 credentials 未落入 default chain；Task 3/5 的 PR checklist
  須確認此 guard 綠。
- **非預期傳遞依賴（IMPORTANT #2，透明度揭露）**：`@aws-sdk/core` 拉入
  `@aws-sdk/credential-provider-login` → `@aws-sdk/nested-clients`（含多個 AWS 服務 client
  stub）與 `@aws/lambda-invoke-store`（AWS 內部 Lambda 調用 store，`@aws` scope）。兩者均
  **不直接使用**，僅 SDK 傳遞依賴、npm 無法直接排除。揭露於此供依賴審計追蹤；未來若
  bundle size 成議題可評估 tree-shaking 或輕量替代。spec §4.1/§7 承諾的「唯讀兩 API 面」
  指本服務**主動呼叫**的 API（`ListObjectsV2Command` + `GetObjectCommand` presigner），
  不涵蓋第三方依賴設計引入的 stub。

- [ ] 安裝（鎖兩個套件；`@aws-sdk/s3-request-presigner` 是 presigner，與 client-s3 同 family）。

```bash
cd bim-review-coordinator && npm install @aws-sdk/client-s3@^3.700.0 @aws-sdk/s3-request-presigner@^3.700.0
```

預期：`package.json` `dependencies` 出現兩套件、`package-lock.json` 更新，無 peer error。

- [ ] 確認 import 可解析（建一行驗證後刪）。

```bash
cd bim-review-coordinator && node -e "const s3=require('@aws-sdk/client-s3'); const p=require('@aws-sdk/s3-request-presigner'); console.log(typeof s3.S3Client, typeof s3.ListObjectsV2Command, typeof s3.GetObjectCommand, typeof p.getSignedUrl)"
```

預期：`function function function function`。

- [ ] commit。

```bash
cd bim-review-coordinator && git add package.json package-lock.json && git commit -m "feat(coordinator): 新增 @aws-sdk/client-s3 + s3-request-presigner（MinIO list/presign，唯讀兩 API 面）

理由：自寫 AWS SigV4 簽章易錯難審，SDK 為 S3 互通事實標準；watcher 僅用
ListObjectsV2Command（唯讀 list）+ GetObjectCommand presigner（presigned GET）。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: minioWatcher 服務模組（純函式：key 解析 + idempotency 導出 + payload 組裝）

先做**不含 I/O 的純函式核心**（key→payload 導出、確定性 idempotency key、層級檢查），這層可獨立 vitest 驗，無需 stub MinIO。

**Files:**
- Create: `bim-review-coordinator/src/services/minioWatcher.ts`
- Test: `bim-review-coordinator/tests/minio-watcher-derive.test.ts` (Create)

- [ ] 寫失敗測試 `bim-review-coordinator/tests/minio-watcher-derive.test.ts`。

```ts
import { describe, expect, it } from "vitest";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "../src/services/minioWatcher.js";

describe("minioWatcher 純函式導出", () => {
  it("恰兩層 key（去 prefix 後 projectId/modelId/model.ifc）導出正確 intake 欄位", () => {
    const r = deriveIntakeFromKey({
      key: "899/xxx/model.ifc",
      prefix: "",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.externalModelVersionId).toBe("xxx");
  });

  it("帶 prefix 時先去 prefix 再解析層級", () => {
    const r = deriveIntakeFromKey({
      key: "tenant_a/899/xxx/model.ifc",
      prefix: "tenant_a/",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.externalModelVersionId).toBe("xxx");
  });

  it("層級不符（去 prefix/suffix 後非恰兩層）→ ok=false 帶 reason", () => {
    const tooDeep = deriveIntakeFromKey({ key: "a/899/xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(tooDeep.ok).toBe(false);
    const tooShallow = deriveIntakeFromKey({ key: "xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(tooShallow.ok).toBe(false);
  });

  it("idempotency key 為 bucket|key|etag 的確定性 sha256 前 16 hex，帶 mw_ 前綴", () => {
    const a = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    const b = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    const c = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"DIFFERENT"');
    expect(a).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(a).toBe(b); // 確定性
    expect(a).not.toBe(c); // etag 變則 key 變
  });

  it("correlation id 為 minio-watch-<hash8>，hash 由 bucket|key|etag 導出", () => {
    const a = correlationIdFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    expect(a).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(correlationIdFor("bim-control", "899/xxx/model.ifc", '"abc123"')).toBe(a);
  });

  it("etag 去外層引號後納入 source_ifc.etag（不重複加引號）", () => {
    const r = deriveIntakeFromKey({ key: "899/xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceEtagFrom('"abc123"')).toBe("abc123");
    expect(r.sourceEtagFrom("abc123")).toBe("abc123");
  });
});
```

- [ ] 跑確認失敗（模組不存在）。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts
```

預期：fail（`Cannot find module '../src/services/minioWatcher.js'`）。

- [ ] 建 `bim-review-coordinator/src/services/minioWatcher.ts`，先只放純函式（I/O 留 Task 4）。

```ts
import crypto from "node:crypto";

/**
 * minio-watch-auto-intake（O4 B 案）純函式核心：MinIO object key → intake 欄位導出、
 * 確定性 idempotency / correlation key、層級檢查。不含任何 I/O（list / presign / POST
 * 在 Task 4 的 watcher loop）。規約：key `{prefix}{projectId}/{modelId}/model.ifc`，
 * 去 prefix + 去 keySuffix 後須恰兩層（projectId / modelId）。
 */

function stripEtagQuotes(etag: string): string {
  return etag.replace(/^"+|"+$/g, "");
}

/** bucket|key|etag 的確定性 sha256；前綴 mw_ + 前 16 hex（重啟重掃命中既有 idempotencyIndex）。 */
export function idempotencyKeyFor(bucket: string, key: string, etag: string): string {
  const digest = crypto.createHash("sha256").update(`${bucket}|${key}|${stripEtagQuotes(etag)}`).digest("hex");
  return `mw_${digest.slice(0, 16)}`;
}

/** correlation：minio-watch-<hash8>（只記 key 不記 presigned URL，避免敏感簽章入 log）。 */
export function correlationIdFor(bucket: string, key: string, etag: string): string {
  const digest = crypto.createHash("sha256").update(`${bucket}|${key}|${stripEtagQuotes(etag)}`).digest("hex");
  return `minio-watch-${digest.slice(0, 8)}`;
}

export interface DeriveOk {
  ok: true;
  projectId: string;
  externalModelVersionId: string;
  /** etag → source_ifc.etag（去外層引號，不重複加引號）。 */
  sourceEtagFrom: (etag: string) => string;
}
export interface DeriveErr {
  ok: false;
  reason: string;
}

export function deriveIntakeFromKey(input: {
  key: string;
  prefix: string;
  keySuffix: string;
}): DeriveOk | DeriveErr {
  const { key, prefix, keySuffix } = input;
  if (prefix && !key.startsWith(prefix)) {
    return { ok: false, reason: `key 不在 prefix 下：${key}` };
  }
  const afterPrefix = prefix ? key.slice(prefix.length) : key;
  if (!afterPrefix.endsWith(keySuffix)) {
    return { ok: false, reason: `key 不以 suffix 結尾：${key}` };
  }
  const withoutSuffix = afterPrefix.slice(0, afterPrefix.length - keySuffix.length);
  const segments = withoutSuffix.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return { ok: false, reason: `去 prefix/suffix 後非恰兩層（projectId/modelId）：${withoutSuffix}` };
  }
  const [projectId, externalModelVersionId] = segments;
  return {
    ok: true,
    projectId,
    externalModelVersionId,
    sourceEtagFrom: stripEtagQuotes,
  };
}
```

- [ ] 跑確認通過。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watcher-derive.test.ts
```

預期：6 個 it 全 pass。

- [ ] commit。

```bash
cd bim-review-coordinator && git add src/services/minioWatcher.ts tests/minio-watcher-derive.test.ts && git commit -m "feat(coordinator): minioWatcher 純函式核心（key 解析 + 確定性 idempotency/correlation 導出）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: minioWatcher loop（list → 過濾 → baseline → 觸發 loopback POST → status）

在 Task 3 模組加 `startMinioWatcher(...)`：setTimeout 鏈（比照 `pollConversionResult`，不用 setInterval）、in-memory `seen: Map<key,etag>`、首輪 baseline 不觸發、後續輪新 key/新 etag 觸發 loopback POST、`getStatus()` 回完整狀態。以本機 fake S3 stub 驗。

**Files:**
- Modify: `bim-review-coordinator/src/services/minioWatcher.ts`
- Test: `bim-review-coordinator/tests/minio-watcher-loop.test.ts` (Create)

- [ ] 寫失敗測試 `bim-review-coordinator/tests/minio-watcher-loop.test.ts`。fake S3 stub 回 ListObjectsV2 XML（可程式化增物件）；fake intake server 收 loopback POST 並記錄收到的 payload/headers。

```ts
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startMinioWatcher } from "../src/services/minioWatcher.js";

let s3Stub: http.Server | null = null;
let intakeStub: http.Server | null = null;
let watcher: { dispose: () => void; getStatus: () => Record<string, unknown> } | null = null;

afterEach(async () => {
  if (watcher) { watcher.dispose(); watcher = null; }
  for (const s of [s3Stub, intakeStub]) {
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
  s3Stub = null; intakeStub = null;
});

interface S3Obj { key: string; etag: string; }

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(state: { objs: S3Obj[] }): Promise<string> {
  s3Stub = http.createServer((req, res) => {
    // ListObjectsV2: GET /{bucket}?list-type=2... → 回 XML。GetObject presign 不真打（presigner 只簽 URL）。
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(state.objs));
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function startIntakeStub(received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>): Promise<string> {
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body: JSON.parse(body || "{}"), headers: req.headers });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_ready_job_id: `ifcready_stub_${received.length}`, idempotent_replay: false }));
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

function makeWatcher(s3Base: string, selfBase: string, state: { objs: S3Obj[] }) {
  return startMinioWatcher({
    endpoint: s3Base,
    bucket: "bim-control",
    prefix: "",
    accessKey: "ak",
    secretKey: "sk",
    keySuffix: "/model.ifc",
    intervalSeconds: 0.05, // 50ms tick → test 快
    selfBaseUrl: selfBase,
    webhookSecret: "dev-webhook-secret",
    structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
  });
}

describe("minioWatcher loop", () => {
  it("首輪 baseline 不觸發（seen=N、triggered=0）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }, { key: "900/yyy/model.ifc", etag: "e2" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 2);
    // baseline 後再等幾輪，確認不觸發
    await new Promise((r) => setTimeout(r, 300));
    const st = watcher!.getStatus();
    expect(st.baseline_count).toBe(2);
    expect(st.seen_count).toBe(2);
    expect(st.triggered_total).toBe(0);
    expect(received.length).toBe(0);
  });

  it("第二輪新增物件 → 觸發一筆 intake，payload 與 header 正確", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    // 新增物件 → 下一輪應觸發
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);

    const { body, headers } = received[0];
    expect(body.event).toBe("ifc_ready");
    expect(body.project_id).toBe("988");
    expect(body.external_model_version_id).toBe("zzz");
    expect((body.source_ifc as Record<string, unknown>).ref).toContain("988/zzz/model.ifc"); // presigned GET URL
    expect((body.source_ifc as Record<string, unknown>).ref).toMatch(/X-Amz-Signature=/); // 含簽章參數
    expect((body.source_ifc as Record<string, unknown>).etag).toBe("e9");
    expect(headers["x-webhook-secret"]).toBe("dev-webhook-secret");
    expect(String(headers["x-idempotency-key"])).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(String(headers["x-correlation-id"])).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("同物件後續輪不再觸發（seen 命中，triggered 維持 1）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);
    await new Promise((r) => setTimeout(r, 300)); // 多跑幾輪
    expect(received.length).toBe(1);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("層級不符 key → skipped_malformed 計數，不觸發", async () => {
    const state = { objs: [{ key: "deep/899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    // 首輪即 baseline，但 malformed 不入 baseline 觸發域；改在新增 malformed 後驗 skip
    await waitFor(() => (watcher!.getStatus().last_poll_at as string | null) !== null);
    state.objs.push({ key: "also/deep/path/model.ifc", etag: "e2" });
    await waitFor(() => (watcher!.getStatus().skipped_malformed_total as number) >= 1);
    expect(received.length).toBe(0);
  });

  it("list 失敗 → 記 last_error，不 crash，下輪重試", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    // s3 指向不可達 port → list 失敗
    watcher = startMinioWatcher({
      endpoint: "http://127.0.0.1:1",
      bucket: "bim-control", prefix: "", accessKey: "ak", secretKey: "sk",
      keySuffix: "/model.ifc", intervalSeconds: 0.05, selfBaseUrl: selfBase,
      webhookSecret: "dev-webhook-secret",
      structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
    });
    await waitFor(() => (watcher!.getStatus().last_error as string | null) !== null);
    expect(String(watcher!.getStatus().last_error)).toBeTruthy();
    expect(received.length).toBe(0);
  });
});
```

- [ ] 跑確認失敗（`startMinioWatcher` 未匯出）。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watcher-loop.test.ts
```

預期：fail（`startMinioWatcher is not a function` / import 解析失敗）。

- [ ] 在 `src/services/minioWatcher.ts` 補 `startMinioWatcher`。S3Client `forcePathStyle:true`（MinIO 必要）、`region:"us-east-1"` placeholder；presign 用 `getSignedUrl(client, new GetObjectCommand(...), {expiresIn:3600})`。**MUST 顯式 `credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey }`（IMPORTANT #1：缺則落入 default chain → IMDS timeout / 靜默撈無關 AWS 金鑰）；完成後須跑 Task 2 落地的 `tests/aws-sdk-credentials-guard.test.ts` 確認綠。**

```ts
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 最小 structLog 介面（避免 import app 造成循環依賴；app 傳入真 logger）。
// withTraceId 為 optional：watcher 內部只呼叫 anomaly()，但真實 StructuredLogger 含
// withTraceId — 測試樁與真 logger 都能不靠 as never 直接滿足此介面。
interface WatcherLogger {
  anomaly: (op: string, msg: string, fields: Record<string, unknown>) => void;
  withTraceId?: (id: string) => { anomaly: WatcherLogger["anomaly"] };
}

export interface MinioWatcherOptions {
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  keySuffix: string;
  intervalSeconds: number;
  selfBaseUrl: string;       // loopback intake base，如 http://127.0.0.1:8004
  webhookSecret: string;
  structLog: WatcherLogger;
}

export interface MinioWatcherHandle {
  dispose: () => void;
  getStatus: () => MinioWatcherStatus;
}

export interface MinioWatcherStatus {
  enabled: true;
  bucket: string;
  prefix: string;
  interval_seconds: number;
  last_poll_at: string | null;
  last_error: string | null;
  baseline_count: number | null;
  seen_count: number;
  triggered_total: number;
  skipped_malformed_total: number;
  last_triggered: Array<{ key: string; job_id: string | null; error: string | null; at: string }>;
}

export function startMinioWatcher(opts: MinioWatcherOptions): MinioWatcherHandle {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true, // MinIO 必要（path-style addressing）
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });

  const seen = new Map<string, string>(); // key → etag
  const status: MinioWatcherStatus = {
    enabled: true,
    bucket: opts.bucket,
    prefix: opts.prefix,
    interval_seconds: opts.intervalSeconds,
    last_poll_at: null,
    last_error: null,
    baseline_count: null,
    seen_count: 0,
    triggered_total: 0,
    skipped_malformed_total: 0,
    last_triggered: [],
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let isFirstRound = true;

  function recordTriggered(key: string, jobId: string | null, error: string | null): void {
    status.last_triggered.unshift({ key, job_id: jobId, error, at: new Date().toISOString() });
    status.last_triggered = status.last_triggered.slice(0, 5);
  }

  async function listAllKeys(): Promise<Array<{ key: string; etag: string }>> {
    const out: Array<{ key: string; etag: string }> = [];
    let continuationToken: string | undefined;
    do {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: opts.bucket,
          Prefix: opts.prefix || undefined,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) out.push({ key: obj.Key, etag: obj.ETag ?? "" });
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  async function triggerIntake(key: string, etag: string): Promise<void> {
    const derived = deriveIntakeFromKey({ key, prefix: opts.prefix, keySuffix: opts.keySuffix });
    if (!derived.ok) {
      status.skipped_malformed_total += 1;
      return;
    }
    const presignedRef = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
      { expiresIn: 3600 },
    );
    const idemKey = idempotencyKeyFor(opts.bucket, key, etag);
    const corrId = correlationIdFor(opts.bucket, key, etag);
    const etagShort = derived.sourceEtagFrom(etag).slice(0, 8);
    const body = {
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: derived.projectId,
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
    try {
      const resp = await fetch(`${opts.selfBaseUrl}/api/external/ifc-ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": opts.webhookSecret,
          "X-Correlation-Id": corrId,
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (resp.status >= 400) {
        recordTriggered(key, null, `intake ${resp.status}: ${text.slice(0, 120)}`);
      } else {
        const parsed = JSON.parse(text || "{}") as { ifc_ready_job_id?: string };
        status.triggered_total += 1; // idempotent_replay 也計為觸發（誠實統計），不重複建 job 由 store 保證
        recordTriggered(key, parsed.ifc_ready_job_id ?? null, null);
      }
    } catch (err) {
      recordTriggered(key, null, err instanceof Error ? err.message : String(err));
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const objects = (await listAllKeys()).filter((o) => o.key.endsWith(opts.keySuffix));
      status.last_poll_at = new Date().toISOString();
      status.last_error = null;
      if (isFirstRound) {
        for (const o of objects) seen.set(o.key, o.etag);
        status.baseline_count = seen.size;
        isFirstRound = false;
      } else {
        for (const o of objects) {
          const prev = seen.get(o.key);
          if (prev === o.etag) continue; // 同 key 同 etag → 不觸發
          seen.set(o.key, o.etag);
          await triggerIntake(o.key, o.etag);
        }
      }
      status.seen_count = seen.size;
    } catch (err) {
      status.last_error = err instanceof Error ? err.message : String(err);
      opts.structLog.anomaly("minioWatch", "minio watch tick failed", {
        anomaly_kind: "retry",
        reason: status.last_error,
        bucket: opts.bucket,
      });
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), opts.intervalSeconds * 1000);
    }
  }

  // 首輪立即跑（不等一個 interval）。
  timer = setTimeout(() => void tick(), 0);

  return {
    dispose: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      client.destroy();
    },
    getStatus: () => ({ ...status, last_triggered: [...status.last_triggered] }),
  };
}
```

- [ ] 跑確認通過。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watcher-loop.test.ts
```

預期：5 個 it 全 pass。

- [ ] commit。

```bash
cd bim-review-coordinator && git add src/services/minioWatcher.ts tests/minio-watcher-loop.test.ts && git commit -m "feat(coordinator): minioWatcher loop（list/baseline/觸發 loopback intake/status，fake S3 stub 驗）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: app.ts 掛載 watcher + GET /api/external/minio-watch/status

`createCoordinatorApp` 內：`config.minioWatchEnabled` 時 `server.listen` 後啟 watcher（需先 listen 取得實際 port 作 selfBase；測試以 `minioWatchSelfBaseUrl` override 注入）、新增唯讀 status route、`dispose()` cancel watcher。

**Files:**
- Modify: `bim-review-coordinator/src/app.ts`
- Test: `bim-review-coordinator/tests/minio-watch-status-route.test.ts` (Create)

- [ ] 寫失敗測試 `bim-review-coordinator/tests/minio-watch-status-route.test.ts`。驗關閉時 enabled=false 誠實回應；route 永遠存在。

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
});

function makeApp(overrides = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-status-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

describe("GET /api/external/minio-watch/status", () => {
  it("watcher 關閉（預設）→ enabled=false，不洩漏 credentials", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    // 誠實：關閉時不偽稱在跑
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(JSON.stringify(res.body)).not.toContain("MINIO_WATCH_SECRET");
    expect(res.body.access_key).toBeUndefined();
    expect(res.body.secret_key).toBeUndefined();
  });

  it("watcher 啟用但 endpoint 不可達 → enabled=true 且 status 形狀完整（含 last_error 欄位）", async () => {
    const app = makeApp({
      minioWatchEnabled: true,
      minioWatchEndpoint: "http://127.0.0.1:1",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchIntervalSeconds: 10,
      // 測試 seam：避免 watcher 真打外網 intake
      minioWatchSelfBaseUrl: "http://127.0.0.1:1",
    });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.bucket).toBe("bim-control");
    expect(res.body).toHaveProperty("last_poll_at");
    expect(res.body).toHaveProperty("triggered_total");
    expect(res.body).toHaveProperty("skipped_malformed_total");
    // credentials 仍不得出現
    expect(res.body.secret_key).toBeUndefined();
    expect(res.body.access_key).toBeUndefined();
  });
});
```

- [ ] 跑確認失敗（route 不存在 → 404）。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watch-status-route.test.ts
```

預期：fail（status 404 而非 200）。

- [ ] 在 `src/app.ts` 頂部 import 區（既有 service import 群組附近）加：

```ts
import { startMinioWatcher, type MinioWatcherHandle, type MinioWatcherStatus } from "./services/minioWatcher.js";
```

- [ ] 在 `createCoordinatorApp` 內、`const startedAt = Date.now();`（L313）之後加 watcher handle 變數與啟動函式（需在 `server` 已宣告之後；`server` 在 L288）：

```ts
  // minio-watch-auto-intake（O4 B 案，env opt-in 預設關）。watcher 自打 loopback
  // POST /api/external/ifc-ready，既有 intake/去重/dispatch 鏈零變動。selfBase 預設
  // http://127.0.0.1:${實際 listen port}；測試以 config.minioWatchSelfBaseUrl 注入。
  let minioWatcher: MinioWatcherHandle | null = null;
  function startMinioWatcherIfEnabled(): void {
    if (!config.minioWatchEnabled || minioWatcher) return;
    const address = server.address();
    const boundPort =
      address && typeof address !== "string" ? address.port : config.port;
    const selfBaseUrl = config.minioWatchSelfBaseUrl || `http://127.0.0.1:${boundPort}`;
    minioWatcher = startMinioWatcher({
      endpoint: config.minioWatchEndpoint,
      bucket: config.minioWatchBucket,
      prefix: config.minioWatchPrefix,
      accessKey: config.minioWatchAccessKey,
      secretKey: config.minioWatchSecretKey,
      keySuffix: config.minioWatchKeySuffix,
      intervalSeconds: config.minioWatchIntervalSeconds,
      selfBaseUrl,
      webhookSecret: config.externalIntakeWebhookSecret,
      structLog,
    });
  }
  // 已在 listen 上的 server（生產 index.ts / E2E）：listening 後啟動以取得實際 port。
  server.on("listening", () => startMinioWatcherIfEnabled());
  // supertest 整合測試不呼叫 listen；用 selfBaseUrl override 時可立即啟動。
  if (config.minioWatchEnabled && config.minioWatchSelfBaseUrl) {
    startMinioWatcherIfEnabled();
  }
```

- [ ] 在既有 `app.get("/api/external/ifc-ready", ...)`（L774）附近新增 status route：

```ts
  // minio-watch-auto-intake：watcher 唯讀狀態（無 credentials 洩漏）。關閉時誠實
  // 回 enabled=false（env opt-in）。last_triggered 只含 key，不含 presigned URL。
  app.get("/api/external/minio-watch/status", (_request, response) => {
    if (!config.minioWatchEnabled) {
      response.json({
        enabled: false,
        bucket: config.minioWatchBucket || null,
        prefix: config.minioWatchPrefix || null,
        interval_seconds: config.minioWatchIntervalSeconds,
        note: "未啟用（env MINIO_WATCH_ENABLED opt-in）",
      });
      return;
    }
    const status: MinioWatcherStatus | { enabled: true; note: string } = minioWatcher
      ? minioWatcher.getStatus()
      : { enabled: true, note: "watcher enabled but not yet started (server not listening)" };
    response.json(status);
  });
```

- [ ] 在 `dispose`（L1688）內、`pollerRegistry` cancel 之後加 watcher cancel：

```ts
    if (minioWatcher) {
      minioWatcher.dispose();
      minioWatcher = null;
    }
```

- [ ] 跑確認通過。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watch-status-route.test.ts
```

預期：2 個 it 全 pass。

- [ ] 跑全 coordinator 套件確認零回歸（watcher 預設關 → 既有測試不受影響）。

```bash
cd bim-review-coordinator && npm run verify
```

預期：build 成功 + 全測試綠（含既有 `auto-poll-conversion` / `external-ifc-ready`）。

- [ ] commit。

```bash
cd bim-review-coordinator && git add src/app.ts tests/minio-watch-status-route.test.ts && git commit -m "feat(coordinator): 掛載 minioWatcher（opt-in）+ GET /api/external/minio-watch/status（唯讀，無 credentials 洩漏）+ dispose cancel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: 端到端整合測試（watcher → 真 coordinator intake → job 進 store）

驗 watcher 對「真 coordinator」（非 stub intake）自打 loopback，job 確實進 `externalIfcReadyStore`、重啟重掃同物件回 idempotent_replay 不建新 job。coordinator `listen(0)` 取得實際 port，watcher selfBase 指該 port；streaming 不可達（dispatch_failed 但 job 仍建立，足以驗 intake 鏈）。

**Files:**
- Test: `bim-review-coordinator/tests/minio-watch-intake-integration.test.ts` (Create)

- [ ] 寫測試 `bim-review-coordinator/tests/minio-watch-intake-integration.test.ts`（直接寫成通過版；依賴 Task 1/3/4/5 已綠）。

```ts
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;

afterEach(async () => {
  if (active) {
    active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (s3Stub) {
    await new Promise<void>((r) => s3Stub?.close(() => r()));
    s3Stub = null;
  }
});

interface S3Obj { key: string; etag: string; }

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(state: { objs: S3Obj[] }): Promise<string> {
  s3Stub = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(state.objs));
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 bind");
  return `http://127.0.0.1:${a.port}`;
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("server bind");
  return a.port;
}

async function waitFor(check: () => Promise<boolean> | boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

function makeApp(s3Base: string, selfBaseUrl: string, overrides = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-intake-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    // streaming 不可達 → dispatch_failed，但 intake job 仍建立（驗 intake 鏈足夠）
    streamingConversionApiBase: "http://127.0.0.1:1",
    // non-strict：watcher 的 presigned ref 指向 s3 stub（GET 會失敗，但本測試只驗 intake 進 store）
    ifcDownloadStrict: false,
    storageRoot: path.join(root, "storage"),
    storageHostRoot: path.join(root, "storage"),
    minioWatchEnabled: true,
    minioWatchEndpoint: s3Base,
    minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak",
    minioWatchSecretKey: "sk",
    minioWatchIntervalSeconds: 0.05,
    minioWatchSelfBaseUrl: selfBaseUrl,
    ...overrides,
  });
  return active;
}

describe("minioWatcher → 真 coordinator intake 整合", () => {
  it("baseline 後新增物件 → watcher 自動建立 ifc-ready job（store 可見）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);
    // 先建 app（watcher 尚未啟動，因 selfBaseUrl 已給 → 立即啟動需 port；改為 listen 後啟動）

    // 正式 app：listen(0) → 取得 port → selfBase 指自己
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-intake-self-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      streamingConversionApiBase: "http://127.0.0.1:1",
      ifcDownloadStrict: false,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      minioWatchEnabled: true,
      minioWatchEndpoint: s3Base,
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchIntervalSeconds: 0.05,
      // 不給 selfBaseUrl → 由 listening 事件用實際 port 啟動
    });
    const port = await listenOnRandomPort(active.server);
    // listening 事件已用實際 port 啟 watcher

    // 等 baseline 完成
    await waitFor(async () => {
      const r = await request(active!.app).get("/api/external/minio-watch/status");
      return r.body.baseline_count === 1;
    });

    // 新增物件 → watcher 觸發 intake
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });

    // job 進 store：GET /api/external/ifc-ready 出現 project_id=988
    await waitFor(async () => {
      const r = await request(active!.app).get("/api/external/ifc-ready?limit=50");
      return (r.body.items as Array<{ project_id: string }>).some((j) => j.project_id === "988");
    });

    const list = await request(active!.app).get("/api/external/ifc-ready?limit=50");
    const job = (list.body.items as Array<{ project_id: string; external_model_version_id: string }>).find(
      (j) => j.project_id === "988",
    );
    expect(job).toBeTruthy();
    expect(job!.external_model_version_id).toBe("zzz");
    expect(port).toBeGreaterThan(0);

    const status = await request(active!.app).get("/api/external/minio-watch/status");
    expect(status.body.triggered_total).toBe(1);
  });

  it("同物件再觸發（模擬重啟重掃）→ idempotent_replay，不建第二筆 job", async () => {
    // 直接對 intake POST 兩次同 idempotency key（等價 watcher 重啟後重掃同物件）
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-idem-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      streamingConversionApiBase: "http://127.0.0.1:1",
      ifcDownloadStrict: false,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      minioWatchEnabled: false, // 本 case 不用 watcher loop，直接驗 intake 去重
    });

    // 用與 watcher 相同的確定性 idempotency key（mw_<hash16>）POST 兩次
    const { idempotencyKeyFor, correlationIdFor } = await import("../src/services/minioWatcher.js");
    const idem = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", "e1");
    const corr = correlationIdFor("bim-control", "899/xxx/model.ifc", "e1");
    const body = {
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "899",
      external_model_version_id: "xxx",
      source_ifc: { ref: "http://127.0.0.1:1/x.ifc", etag: "e1", filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc"],
    };
    const headers = { "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": corr, "X-Idempotency-Key": idem };

    const first = await request(active.app).post("/api/external/ifc-ready").set(headers).send(body);
    expect(first.status).toBe(202);
    const firstJobId = first.body.ifc_ready_job_id as string;

    const second = await request(active.app).post("/api/external/ifc-ready").set(headers).send(body);
    expect([200, 202]).toContain(second.status);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.ifc_ready_job_id).toBe(firstJobId); // 同一 job，不新建
  });
});
```

- [ ] 跑確認通過。

```bash
cd bim-review-coordinator && npx vitest run tests/minio-watch-intake-integration.test.ts
```

預期：2 個 it 全 pass。

- [ ] commit。

```bash
cd bim-review-coordinator && git add tests/minio-watch-intake-integration.test.ts && git commit -m "test(coordinator): minioWatcher → 真 coordinator intake 整合（job 進 store + 重掃 idempotent_replay）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: 前端 coordinatorClient.minioWatchStatus + ConversionSchedulingPage Panel

`coordinatorClient` 加 `MinioWatchStatus` 型別與 `minioWatchStatus()` 方法；`ConversionSchedulingPage` 加「MinIO 自動偵測（O4）」Panel：關閉誠實顯示「未啟用」，啟用顯示 bucket/last_poll/計數/最近觸發。

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Test: `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx` (Create)

- [ ] 寫失敗測試 `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`。

```tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversionSchedulingPage } from "./pages";

describe("ConversionSchedulingPage MinIO 自動偵測 Panel（O4）", () => {
  it("初始渲染含 MinIO 自動偵測 Panel 與穩定選取子", () => {
    const html = renderToString(<ConversionSchedulingPage />);
    expect(html).toContain("MinIO 自動偵測");
    // 真實狀態端點來源（誠實）
    expect(html).toContain("/api/external/minio-watch/status");
    // 穩定選取子供 E2E
    expect(html).toContain('data-testid="minio-watch-panel"');
  });

  it("只打 coordinator，不直連內部埠", () => {
    const html = renderToString(<ConversionSchedulingPage />);
    expect(html).not.toContain(":49101");
    expect(html).not.toContain(":9000"); // 前端不直連 MinIO；走 coordinator status
  });
});
```

- [ ] 跑確認失敗。

```bash
cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx
```

預期：fail（無 "MinIO 自動偵測" / 無 `minio-watch-panel`）。

- [ ] 在 `src/console/coordinatorClient.ts`，`IfcReadyListItem` interface（L112 後）之後加型別：

```ts
// minio-watch-auto-intake：GET /api/external/minio-watch/status 真實回應形狀。
// 關閉時只有 enabled=false + note；啟用時帶完整計數。credentials 永不在此回應。
export interface MinioWatchStatus {
  enabled: boolean;
  bucket?: string | null;
  prefix?: string | null;
  interval_seconds?: number;
  note?: string;
  last_poll_at?: string | null;
  last_error?: string | null;
  baseline_count?: number | null;
  seen_count?: number;
  triggered_total?: number;
  skipped_malformed_total?: number;
  last_triggered?: Array<{ key: string; job_id: string | null; error: string | null; at: string }>;
}
```

- [ ] 在 `coordinatorClient` object literal（L126 `listIfcReady` 之後）加方法：

```ts
  minioWatchStatus: () => jsonGet<MinioWatchStatus>("/api/external/minio-watch/status"),
```

- [ ] 在 `src/console/pages.tsx`，更新 import（L7）把 `MinioWatchStatus` 帶進來：

```ts
import { coordinatorClient, IfcReadyListItem, MinioWatchStatus, RuntimeStatus } from "./coordinatorClient";
```

- [ ] 在 `ConversionSchedulingPage`（L280）擴充：state 加 `mw`、load 內並抓 status、render 加 Panel。把整個 function 換成：

```tsx
export function ConversionSchedulingPage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [mw, setMw] = useState<MinioWatchStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      setJobs((await coordinatorClient.listIfcReady(50)).items);
      setMw(await coordinatorClient.minioWatchStatus());
    }
    catch (e) { setErr(`未連線 coordinator /api/external/ifc-ready：${String(e)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <h1>IFC→USD 轉檔排程</h1>
      <p className="ec-lead">從 MinIO / storage 發現 source IFC，排進 conversion authority，由 `bim-streaming-server` 產出 `model.usdc`、mapping summary，再通知 Kit / Review Session。</p>
      <Panel title="Pipeline" sub="MinIO source → queue → IFC→USD → writeback → notify Kit" prov="asbuilt" actions={<Btn caption="GET /api/external/ifc-ready" disabled={busy} onClick={load}>{busy ? "讀取中…" : "Refresh queue"}</Btn>}>
        <LifecycleStrip steps={["讀 MinIO / storage", "排隊", "IFC→USD", "寫回 model.usdc", "通知 Kit"]} />
        {err && <p className="ec-warn-note">{err}</p>}
        <Field k="conversion authority" v="bim-streaming-server owns heavy conversion" prov="asbuilt" />
        <Field k="mapping coverage" v="property / relationship / attribute coverage 必須顯示；不得承諾 100% lossless" prov="p1" />
        <Field k="插隊 / 重試 / concurrency" v="UI rule 已定義，controlled action endpoint 待建" prov="p1" />
      </Panel>
      <Panel
        title="MinIO 自動偵測（O4）"
        sub="watcher 輪詢 ListObjectsV2 → 新 */model.ifc → 自動 intake；來源 /api/external/minio-watch/status"
        prov="asbuilt"
      >
        <div data-testid="minio-watch-panel">
          {mw == null ? (
            <p className="ec-note">尚未取得 watcher 狀態；按上方 Refresh queue 後顯示。</p>
          ) : mw.enabled === false ? (
            <>
              <Field k="狀態" v="未啟用 — 需設定 env MINIO_WATCH_ENABLED opt-in" prov="asbuilt" />
              <p className="ec-note">{mw.note ?? "watcher 預設關閉；狀態 API 為真，未偽稱功能在跑。"}</p>
            </>
          ) : (
            <>
              <Field k="狀態" v="啟用中（env opt-in）" prov="asbuilt" />
              <Field k="bucket" v={mw.bucket ?? "—"} prov="asbuilt" />
              <Field k="prefix" v={mw.prefix || "（無）"} prov="asbuilt" />
              <Field k="最近一輪" v={mw.last_poll_at ?? "尚未完成首輪"} prov="asbuilt" />
              <Field k="baseline / seen / 觸發 / 跳過" v={`${mw.baseline_count ?? "—"} / ${mw.seen_count ?? 0} / ${mw.triggered_total ?? 0} / ${mw.skipped_malformed_total ?? 0}`} prov="asbuilt" />
              {mw.last_error && <Field k="最近錯誤" v={mw.last_error} prov="asbuilt" />}
              {mw.last_triggered && mw.last_triggered.length > 0 && (
                <table className="ec-table" data-testid="minio-watch-triggered">
                  <thead><tr><th>key</th><th>job</th><th>error</th><th>at</th></tr></thead>
                  <tbody>{mw.last_triggered.map((t, i) => (
                    <tr key={`${t.key}-${i}`}>
                      <td>{t.key}</td>
                      <td>{t.job_id ?? "—"}</td>
                      <td>{t.error ?? "—"}</td>
                      <td>{t.at}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </>
          )}
        </div>
      </Panel>
      <Panel title="Ifc-ready jobs" sub="/api/external/ifc-ready truth；沒有資料時顯示空，不補假 job" prov="asbuilt">
        {jobs.length ? (
          <table className="ec-table"><thead><tr><th>job</th><th>project</th><th>conversion</th><th>dispatch</th><th>session</th><th>stage</th></tr></thead>
            <tbody>{jobs.slice(0, 20).map((j) => (
              <tr key={j.ifc_ready_job_id}>
                <td>{j.ifc_ready_job_id}</td>
                <td>{j.project_id}</td>
                <td>{j.conversion_status ?? "—"}</td>
                <td>
                  {j.dispatch_error ? (
                    <span
                      className="ec-warn-note"
                      data-testid={`conv-dispatch-error-${j.ifc_ready_job_id}`}
                      title={j.dispatch_error}
                    >
                      {j.dispatch_error.length > 80 ? `${j.dispatch_error.slice(0, 80)}…` : j.dispatch_error}
                    </span>
                  ) : "—"}
                </td>
                <td>{j.review_session_id ?? "—"}</td>
                <td>{j.expected_stage_url ?? "—"}</td>
              </tr>
            ))}</tbody></table>
        ) : <p className="ec-note">尚未取得 ifc-ready job；可由真實 IFC 進件頁註冊 fixture 後再回來看排程。</p>}
      </Panel>
    </>
  );
}
```

- [ ] 跑確認通過。

```bash
cd web-viewer-sample && npx vitest run src/console/ConversionSchedulingPage.test.tsx
```

預期：2 個 it 全 pass。

- [ ] 跑前端全 vitest + lint 確認零回歸。

```bash
cd web-viewer-sample && npm test && npm run lint
```

預期：全綠（既有 console.test / IntakeSelectPage.test 不受影響）。

- [ ] commit。

```bash
cd web-viewer-sample && git add src/console/coordinatorClient.ts src/console/pages.tsx src/console/ConversionSchedulingPage.test.tsx && git commit -m "feat(web-viewer): #/conv MinIO 自動偵測 Panel + coordinatorClient.minioWatchStatus（關閉誠實顯示未啟用）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Browser E2E（Playwright）— watcher 自動 intake vertical slice，全程不碰按鈕

隔離 stack：spawn 真 coordinator（`tsx src/index.ts`，`MINIO_WATCH_ENABLED=true`、interval 調短）+ 本機 fake S3 stub + stub conversion；stub 注入新物件 → watcher 自動 intake → `#/conv`「Ifc-ready jobs」出現該 job（dispatched/queued 級）+「MinIO 自動偵測」Panel triggered ≥ 1。逐節比照 `conversion-artifact-id-sanitize.spec.ts`（含 conditional-skip 誠實揭露）。

**Files:**
- Create: `web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`
- Create: `docs/evidence/minio-watch-auto-intake/README.md`

- [ ] 建 `web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`。

```ts
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest } from "@playwright/test";

// minio-watch-auto-intake（spec 2026-06-12，O4 觸發機制 B 案）：user-facing vertical slice。
// MINIO_WATCH_ENABLED=true 的真 coordinator + 本機 fake S3 stub（ListObjectsV2 XML）+ stub conversion。
// stub 注入新物件 → watcher 自動 intake（不碰任何按鈕）→ #/conv 出現 job + watcher Panel triggered≥1。
//
// *** 誠實標記：STUB MINIO + STUB CONVERSION API ***
//   真 MinIO（192.168.20.234:9000）需唯讀 credentials（使用者提供入 env，屬 P7 部署區驗證）；
//   真 conversion 需 host-native GPU runtime。本機 E2E 起本機 stub：
//   - fake S3 stub：http server 回 ListObjectsV2 XML，可程式化注入物件；presigned GET 由 SDK 簽 URL
//     （指向 stub）。watcher 對 stub list → derive → loopback intake。
//   - stub conversion：回 202 queued（job 進 dispatched/queued 級即達 vertical slice 目標）。
//   截圖落 artifacts/e2e/minio-watch-auto-intake-*；evidence summary 標 STUB MINIO + STUB CONVERSION。
//
// *** conditional-skip 限制明文（比照 conversion-artifact-id-sanitize.spec.ts:27-36 先例）***
//   beforeAll 守門（dist-ui 未 build → test.skip）是 conditional skip：Playwright 語意裡 skip != fail。
//   若丟進不保證前置（不 build:ui / 不起 coordinator）的環境會靜默全 skip 仍綠 → 假信心。
//   本 repo .github/workflows 僅 pr-review-agent.yml，無任何 Playwright job，故此 skip 設計不 false-green
//   任何既有自動化 gate。本 spec 屬本機 / 指揮官手動 gate。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_REPO_DIR = path.resolve(TEST_DIR, "..");
const COORDINATOR_REPO_DIR = path.resolve(VIEWER_REPO_DIR, "..", "bim-review-coordinator");
const CONSOLE_DIST_DIR = path.resolve(VIEWER_REPO_DIR, "dist-ui");
const WEBHOOK_SECRET = "dev-webhook-secret";

interface S3Obj { key: string; etag: string; }
const s3State: { objs: S3Obj[] } = { objs: [{ key: "899/baseline/model.ifc", etag: "base1" }] };

let coordinatorBase = "";
let coordinatorProc: ChildProcess | null = null;
let s3Stub: http.Server | null = null;
let convStub: http.Server | null = null;
let tmpRoot = "";

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("stub bind");
  return a.port;
}

async function startS3Stub(): Promise<number> {
  s3Stub = http.createServer((req, res) => {
    if (req.url?.includes("list-type=2") || req.method === "GET") {
      // ListObjectsV2 或 presigned GET（GET object）皆回 200；object body 給最小 IFC 讓下載不致硬卡。
      if (req.url && /\/bim-control\/.+\/model\.ifc/.test(req.url)) {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(listObjectsXml(s3State.objs));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(s3State.objs));
  });
  return listenOnRandomPort(s3Stub);
}

async function startConvStub(): Promise<number> {
  convStub = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_mw_e2e", status: "queued", authority: "bim-streaming-server" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  return listenOnRandomPort(convStub);
}

async function waitForHealth(base: string, timeoutMs = 60_000): Promise<void> {
  const api = await pwRequest.newContext();
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      try { const res = await api.get(`${base}/health`, { timeout: 2000 }); if (res.ok()) return; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`coordinator /health not ready within ${timeoutMs}ms at ${base}`);
  } finally { await api.dispose(); }
}

test.describe("MinIO watcher 自動 intake（STUB MINIO + STUB CONVERSION）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );
    const s3Port = await startS3Stub();
    const convPort = await startConvStub();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-e2e-"));

    const freePort = await new Promise<number>((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") { reject(new Error("no free port")); return; }
        const p = addr.port; srv.close(() => resolve(p));
      });
    });
    coordinatorBase = `http://127.0.0.1:${freePort}`;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(freePort),
      PUBLIC_HOST: "127.0.0.1",
      STREAMING_CONVERSION_API_BASE: `http://127.0.0.1:${convPort}`,
      CONSOLE_DIST_DIR,
      CONVERSION_POLL_ENABLED: "false",
      IFC_DOWNLOAD_STRICT: "false",
      EXTERNAL_INTAKE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      SESSION_STORE_DIR: path.join(tmpRoot, "sessions"),
      EVENT_LOG_DIR: path.join(tmpRoot, "events"),
      CALLBACK_OUTBOX_STORE_PATH: path.join(tmpRoot, "callback-outbox.json"),
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
      // watcher opt-in：指向本機 fake S3 stub、interval 調短。
      MINIO_WATCH_ENABLED: "true",
      MINIO_WATCH_ENDPOINT: `http://127.0.0.1:${s3Port}`,
      MINIO_WATCH_BUCKET: "bim-control",
      MINIO_WATCH_ACCESS_KEY: "ak",
      MINIO_WATCH_SECRET_KEY: "sk",
      MINIO_WATCH_INTERVAL_SECONDS: "1",
    };

    const tsxBin = path.join(COORDINATOR_REPO_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: COORDINATOR_REPO_DIR, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    });
    coordinatorProc.stdout?.on("data", (d) => process.stdout.write(`[coordinator] ${d}`));
    coordinatorProc.stderr?.on("data", (d) => process.stderr.write(`[coordinator:err] ${d}`));
    await waitForHealth(coordinatorBase);
  });

  test.afterAll(async () => {
    if (coordinatorProc) { coordinatorProc.kill("SIGTERM"); coordinatorProc = null; }
    for (const s of [s3Stub, convStub]) { if (s) await new Promise<void>((r) => s.close(() => r())); }
    s3Stub = null; convStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("stub 注入新物件 → watcher 自動 intake → #/conv 出現 job + Panel triggered≥1（不碰按鈕）", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 1) 等 watcher baseline 完成（baseline_count=1，base 物件登 seen 不觸發）。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json()).baseline_count;
      }, { timeout: 30_000 }).toBe(1);

      // 2) 注入新物件（baseline 之後）→ 下一輪 watcher 自動觸發 intake。全程不碰任何按鈕。
      s3State.objs.push({ key: "988/auto/model.ifc", etag: "auto9" });

      // 3) backend 真實狀態先確認（user-facing 之前）：job 進 store + watcher triggered≥1。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/ifc-ready?limit=50`);
        const items = (await r.json()).items as Array<{ project_id: string }>;
        return items.some((j) => j.project_id === "988");
      }, { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json()).triggered_total;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

      // 4) 前端：開 #/conv（coordinator 同源 /ui）。仍不碰按鈕——但 ConversionSchedulingPage useEffect
      //    首掛載即自動 load（listIfcReady + minioWatchStatus），故 reload 後資料自動出現。
      await page.goto(`${coordinatorBase}/ui#/conv`);

      // 5) MinIO 自動偵測 Panel：啟用中 + triggered≥1。
      const panel = page.getByTestId("minio-watch-panel");
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await expect(panel).toContainText("啟用中", { timeout: 20_000 });

      // 6) Ifc-ready jobs 表：988 的 job 自動出現（watcher 建立，非手動註冊）。
      const row988 = page.locator("table.ec-table tbody tr").filter({ has: page.locator("td", { hasText: "988" }) });
      await expect(row988.first()).toBeVisible({ timeout: 20_000 });

      await page.screenshot({ path: "../artifacts/e2e/minio-watch-auto-intake-conv.png", fullPage: true });
    } finally {
      await api.dispose();
    }
  });
});
```

- [ ] 先 build dist-ui（E2E 前置；缺則 spec conditional-skip）。

```bash
cd web-viewer-sample && npm run build:ui
```

預期：`dist-ui/index.html` 產生。

- [ ] 跑 E2E（單一 spec）。

```bash
cd web-viewer-sample && npx playwright test e2e/minio-watch-auto-intake.spec.ts
```

預期：1 passed；`artifacts/e2e/minio-watch-auto-intake-conv.png` 產生且顯示 Panel「啟用中」與 988 job row。

- [ ] 建 `docs/evidence/minio-watch-auto-intake/README.md`（tracked evidence；揭露 STUB 限制與 P7 真 MinIO not-observed）。

```markdown
# minio-watch-auto-intake — E2E Evidence

- spec：`docs/superpowers/specs/2026-06-12-minio-watch-auto-intake-design.md`（O4 觸發機制 B 案：輪詢 ListObjectsV2）
- plan：`docs/superpowers/plans/2026-06-12-minio-watch-auto-intake.md`
- E2E spec：`web-viewer-sample/e2e/minio-watch-auto-intake.spec.ts`

## 驗收標記（誠實鐵律）

- **STUB MINIO**：本機 fake S3 stub（http server 回 ListObjectsV2 XML），非真 192.168.20.234:9000。
  presigned GET URL 由 AWS SDK 簽出（指向 stub）。
- **STUB CONVERSION API**：stub 回 202 queued；job 進 dispatched/queued 級即達 vertical slice 目標
  （真 IFC→USDC 需 host-native GPU runtime，不在本機 E2E）。
- **vertical slice**：UI route `#/conv` → useEffect 自動 load → 真 coordinator
  `GET /api/external/ifc-ready` + `GET /api/external/minio-watch/status` → watcher 自動建立的 988 job
  + Panel triggered≥1。**全程不碰任何按鈕**（M2 DoD 前半「自動觸發」語意）。
- **conditional-skip 限制**：dist-ui 未 build → test.skip（Playwright skip != fail）。本 repo 無 Playwright
  CI job，故不 false-green 任何 gate；屬本機 / 指揮官手動 gate。

## P7 部署區驗證（real MinIO）

- 對真 MinIO（192.168.20.234:9000，唯讀 credentials 由使用者提供入 env）開 `MINIO_WATCH_ENABLED=true`
  觀察 baseline 正常、`#/conv` Panel 顯示真 bucket/last_poll；真新檔觸發視使用者丟檔配合。
- **狀態：not observed**（待 P7 由指揮官提供 credentials + 丟檔配合後補實測截圖）。

## 截圖

- `artifacts/e2e/minio-watch-auto-intake-conv.png`（gitignored artifacts 區；本檔記錄產生路徑與內容）。
```

- [ ] commit。

```bash
cd web-viewer-sample && git add e2e/minio-watch-auto-intake.spec.ts && git -C .. add docs/evidence/minio-watch-auto-intake/README.md && git commit -m "test(e2e): minio-watch 自動 intake vertical slice（STUB MINIO + STUB CONVERSION，不碰按鈕）+ evidence README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: .env.example 欄位名 + 全套件回歸驗證

把 8 個 MinIO env 欄位名（空值）加進 `.env.example`（不落實值），跑兩 sub-repo 全套件最終確認零回歸。

**Files:**
- Modify: `bim-review-coordinator/.env.example`（若不存在則 Create）

- [ ] 確認 `.env.example` 是否存在並讀現況。

```bash
cd bim-review-coordinator && ls -la .env.example 2>/dev/null && cat .env.example 2>/dev/null | tail -20 || echo "ENV_EXAMPLE_ABSENT"
```

預期：印出現有內容或 `ENV_EXAMPLE_ABSENT`。

- [ ] 把以下區塊**附加**到 `.env.example` 末（若檔不存在則新建只含此區塊；只放欄位名與空值/預設，credentials 留空，不寫實值）：

```bash
# minio-watch-auto-intake（O4 觸發機制 B 案）：MinIO ListObjectsV2 輪詢自動 intake。
# 預設關；唯讀 credentials 不得 commit 實值（deny 規則禁讀 .env 實值）。
MINIO_WATCH_ENABLED=false
MINIO_WATCH_ENDPOINT=
MINIO_WATCH_BUCKET=
MINIO_WATCH_PREFIX=
MINIO_WATCH_ACCESS_KEY=
MINIO_WATCH_SECRET_KEY=
MINIO_WATCH_INTERVAL_SECONDS=60
MINIO_WATCH_KEY_SUFFIX=/model.ifc
```

- [ ] 跑 coordinator 全套件（build + 全 vitest）。

```bash
cd bim-review-coordinator && npm run verify
```

預期：build 成功 + 全測試綠（含新增 5 個 minio-watch 測試檔 + 既有全部）。

- [ ] 跑前端全 vitest + lint。

```bash
cd web-viewer-sample && npm test && npm run lint
```

預期：全綠。

- [ ] commit。

```bash
cd bim-review-coordinator && git add .env.example && git commit -m "chore(coordinator): .env.example 加 MINIO_WATCH_* 欄位名（空值，不落實 credentials）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 完成後回報（CLAUDE.md §1 四項）

1. **改了哪些 tracked files**：`bim-review-coordinator/`（`src/config.ts`、`src/services/minioWatcher.ts`(新)、`src/app.ts`、`package.json`、`package-lock.json`、`.env.example`、`tests/` 5 個新測試檔）；`web-viewer-sample/`（`src/console/coordinatorClient.ts`、`src/console/pages.tsx`、`src/console/ConversionSchedulingPage.test.tsx`(新)、`e2e/minio-watch-auto-intake.spec.ts`(新)）；`docs/evidence/minio-watch-auto-intake/README.md`(新)。
2. **最小驗證**：每 task 紅→綠 vitest；coordinator `npm run verify`；前端 `npm test` + `npm run lint`；E2E `npx playwright test e2e/minio-watch-auto-intake.spec.ts`（需先 `npm run build:ui`）。
3. **哪些沒跑及原因**：真 MinIO（192.168.20.234:9000）P7 部署區驗證 = not observed（需使用者提供唯讀 credentials + 丟檔配合）；真 IFC→USDC conversion 未在本機 E2E 起（host-native GPU runtime）→ 以 stub conversion 202 queued 達 vertical slice。
4. **已知風險**：新 production dependency `@aws-sdk/client-s3`（PR body 揭露，鎖唯讀兩 API 面）；in-memory `seen` 不持久化（重啟正確性靠 idempotency 鏈，spec §7 已論證）；presigned URL 含簽章不入 status/log（last_triggered 只記 key）；與外部 IFC worker 並存可能雙 job（部署拓樸決策，spec §7 揭露，不在 code 層擋）。

## GitNexus 紀律提醒（執行時）

- 修改既有 symbol（`loadConfig`、`createCoordinatorApp`、`ConversionSchedulingPage`、`coordinatorClient` literal）前 MUST 跑 `gitnexus_impact`；本機 FTS index degraded 時改以 Grep 反查 caller（如本 plan 導航段），HIGH/CRITICAL 先回報。
- commit 前 MUST 跑 `gitnexus_detect_changes`。
