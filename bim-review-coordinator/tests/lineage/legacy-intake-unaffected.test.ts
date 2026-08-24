import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";
import { ConversionLedger } from "../../src/services/conversionLedger.js";
import { idempotencyKeyFor } from "../../src/services/minioWatcher.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.1 —— **legacy 面回歸鎖**（裁決 D-7 / design.md §11.2 規則 5）。
 *
 * 本檔只證明「新增 governed intake 之後，legacy 路徑逐字不受影響」這一件事：
 *   1. `POST /api/external/ifc-ready` 不產生 governed `source_bundle_id` / `pipeline_job_id`，
 *      回應也不得混入 governed 欄位；
 *   2. legacy shadow 仍恰為凍結的 12 欄（governed shadow 是獨立型別／獨立 route，D-6）；
 *   3. **watcher 不得被 governed manifest 抑制**：同一 version prefix 同時存在 governed
 *      `manifest.json` 與 `/model.ifc` 時，watcher 照常觸發 legacy intake；
 *   4. `POST /api/conversion/trigger` 仍只建立 legacy job，不推導 governed identity；
 *   5. app.ts 接線：governed route 確實掛上且在 governed MinIO 未設定時 fail-closed 503。
 *
 * legacy 行為本身「逐字不變」的證據不在本檔重寫，而是既有測試維持全綠：
 * `tests/external-ifc-ready.test.ts`（33）、`tests/external-ifc-ready-persistence.test.ts`、
 * `tests/shadow-metadata.test.ts`（5）、`tests/minio-watch-*.test.ts`、
 * `tests/conversion-ledger*.test.ts`、`tests/conversion-trigger.test.ts`、
 * `tests/lifecycle-status.test.ts`。重抄一份凍結欄位斷言只會製造第二份會漂移的契約。
 */

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(TEST_DIR, "..", "..", "..", "tests", "contracts", "ifc_ready_payload.json"),
    "utf-8",
  ),
) as { example: Record<string, unknown> };

const WEBHOOK_SECRET = "dev-webhook-secret";

/** governed 欄位一旦出現在 legacy 出口，代表兩個 contract 開始互相冒充。 */
const GOVERNED_LEAK_KEYS = [
  "source_bundle_id",
  "pipeline_job_id",
  "bundle_state",
  "manifest_sha256",
  "integrity_diagnostics",
];

/** `ShadowMetadata`（types.ts）凍結的 12 欄；delta 明文要求逐字保留。 */
const FROZEN_LEGACY_SHADOW_KEYS = [
  "artifact_manifest_ref",
  "callback_status",
  "callback_url",
  "conversion_job_id",
  "correlation_id",
  "external_conversion_task_id",
  "external_model_version_id",
  "last_callback_attempt_at",
  "project_id",
  "source_ifc_etag",
  "source_ifc_ref",
  "tenant_id",
];

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (s3Stub) {
    s3Stub.closeAllConnections?.();
    await new Promise<void>((resolve) => s3Stub?.close(() => resolve()));
    s3Stub = null;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coordinator-lineage-regression-"));
  const storageRoot = path.join(root, "storage");
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    sourceBundleStorePath: path.join(root, "source-bundles.json"),
    pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
    edgeSiteId: "site_test_edge",
    edgeRuntimeDataRoot: root,
    storageRoot,
    storageHostRoot: storageRoot,
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

function legacyAuthHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr_regression_001",
    "X-Idempotency-Key": "idem_regression_001",
    ...overrides,
  };
}

interface S3Obj {
  key: string;
  etag: string;
}

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map(
      (o) =>
        `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(objs: S3Obj[]): Promise<string> {
  s3Stub = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/xml" });
    response.end(listObjectsXml(objs));
  });
  await new Promise<void>((resolve) => s3Stub?.listen(0, "127.0.0.1", () => resolve()));
  const address = s3Stub?.address();
  if (!address || typeof address === "string") throw new Error("s3 stub bind failed");
  return `http://127.0.0.1:${address.port}`;
}

async function listenOnLoopback(app: CoordinatorApp): Promise<number> {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("coordinator bind failed");
  return address.port;
}

describe("legacy POST /api/external/ifc-ready 不因 governed intake 而改變", () => {
  it("legacy intake 只建立 legacy job：回應無 governed 欄位，governed store 保持空", async () => {
    const app = makeApp();
    const response = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(legacyAuthHeaders())
      .send(structuredClone(LEGACY_CONTRACT.example));

    expect(response.status).toBe(202);
    expect(typeof response.body.ifc_ready_job_id).toBe("string");
    for (const key of GOVERNED_LEAK_KEYS) {
      expect(response.body).not.toHaveProperty(key);
    }
    // MUST NOT 由 legacy intake 推導 governed READY / source_bundle_id / pipeline_job_id。
    expect(app.sourceBundleStore.list()).toEqual([]);

    const listed = await request(app.app).get("/api/external/ifc-ready");
    expect(listed.status).toBe(200);
    const item = listed.body.items[0] as Record<string, unknown>;
    for (const key of GOVERNED_LEAK_KEYS) {
      expect(item).not.toHaveProperty(key);
    }
    // 凍結的單一權威生命週期欄位仍在，且值仍落在既有五值域。
    expect(["detected", "queued", "converting", "ready", "failed"]).toContain(
      item.conversion_lifecycle_status,
    );
  });

  it("legacy shadow 仍恰為凍結的 12 欄（governed shadow 是獨立 route，不污染 legacy）", async () => {
    const app = makeApp();
    const created = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(legacyAuthHeaders())
      .send(structuredClone(LEGACY_CONTRACT.example));
    const jobId = created.body.ifc_ready_job_id as string;

    const shadow = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(shadow.status).toBe(200);
    expect(Object.keys(shadow.body.shadow_metadata).sort()).toEqual(FROZEN_LEGACY_SHADOW_KEYS);
    // governed shadow 端點是另一條 route，且此 job 不存在於 governed store。
    const governedShadow = await request(app.app).get(
      `/api/external/source-bundles/${jobId}/shadow`,
    );
    expect(governedShadow.status).toBe(404);
  });
});

describe("watcher／手動 trigger 不被 governed manifest 抑制（D-7、§11.2 規則 5）", () => {
  it("同一 version prefix 同時有 governed manifest.json 與 /model.ifc → watcher 照常觸發 legacy intake", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coordinator-lineage-watcher-"));
    const ledgerStorePath = path.join(root, "conversion-ledger.json");
    // 關鍵佈局：同一 prefix 下 governed manifest 與 legacy model.ifc 並存。
    const s3Base = await startS3Stub([
      { key: "899/main/xxx/manifest.json", etag: "em1" },
      { key: "899/main/xxx/model.ifc", etag: "e1" },
    ]);

    const app = makeApp({
      conversionLedgerStorePath: ledgerStorePath,
      sourceBundleStorePath: path.join(root, "source-bundles.json"),
    pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
      minioWatchEnabled: true,
      minioWatchEndpoint: s3Base,
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchKeySuffix: "/model.ifc",
      minioWatchSelfBaseUrl: "",
      externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
      externalIntakeWebhookSecret: WEBHOOK_SECRET,
      ifcDownloadStrict: false,
    });
    await listenOnLoopback(app);
    await app.minioWatchSurface.pollNow();

    // watcher 端零 governed 判斷：manifest 存在不得讓 legacy 觸發被 skip。
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.triggered_total).toBeGreaterThanOrEqual(1);
    const idkey = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    expect(new ConversionLedger(ledgerStorePath).get(idkey)).not.toBeNull();
    // 反向：watcher 觸發的 legacy job 不得憑空生出 governed bundle
    //（`mw_<hash16>` 與 `source_bundle_id` 是兩個獨立去重空間）。
    expect(app.sourceBundleStore.list()).toEqual([]);
  });

  it("POST /api/conversion/trigger 仍只建立 legacy job，不推導 governed identity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coordinator-lineage-trigger-"));
    const s3Base = await startS3Stub([
      { key: "899/main/xxx/manifest.json", etag: "em1" },
      { key: "899/main/xxx/model.ifc", etag: "e1" },
    ]);
    const app = makeApp({
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      sourceBundleStorePath: path.join(root, "source-bundles.json"),
    pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
      // watcher loop 關閉，只用手動 trigger 路徑（MinIO 連線參數仍需齊全）。
      minioWatchEnabled: false,
      minioWatchEndpoint: s3Base,
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchSelfBaseUrl: "",
      externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
      externalIntakeWebhookSecret: WEBHOOK_SECRET,
      ifcDownloadStrict: false,
    });
    const port = await listenOnLoopback(app);
    // 比照 conversion-trigger.test.ts：self-POST loopback 必須指向本測試的 port，
    // 否則空值 fallback 會打到機器上恰好在跑的部署區 coordinator（本機假綠、CI 502）。
    app.config.minioWatchSelfBaseUrl = `http://127.0.0.1:${port}`;

    const triggered = await request(app.app)
      .post("/api/conversion/trigger")
      .send({ key: "899/main/xxx/model.ifc" });
    expect([200, 202]).toContain(triggered.status);
    expect(JSON.stringify(triggered.body)).not.toMatch(/X-Amz-Signature/i);
    expect(app.sourceBundleStore.list()).toEqual([]);
  });
});

describe("app.ts 接線：governed route 掛上且 fail-closed", () => {
  it("governed MinIO 未設定 → ready claim 503；讀取面誠實回空；confirm 也 503", async () => {
    const app = makeApp();
    const ready = await request(app.app)
      .post("/api/external/source-bundles/ready")
      .set({
        "X-Webhook-Secret": WEBHOOK_SECRET,
        "X-Correlation-Id": "corr-wiring-0001",
        "X-Idempotency-Key": "idem-wiring-0001",
      })
      .send({
        event: "source_bundle_ready",
        contract_version: "source-bundle-ready/v1",
        correlation_id: "corr-wiring-0001",
        idempotency_key: "idem-wiring-0001",
        source_bundle_id: "source-bundle-wiring-0001",
        external_model_version_id: "model-version-20260715-001",
        tenant_id: "tenant-a",
        project_id: "project-library",
        manifest_ref: {
          ref: "minio://edge-tpe-01/source-bundles/tenant-a/project-library/model-version-20260715-001/manifest.json?versionId=v-src-manifest-0001",
          object_version_id: "v-src-manifest-0001",
          etag: "etag-src-manifest-0001",
          sha256: "d".repeat(64),
          size_bytes: 2048,
        },
        manifest_sha256: "d".repeat(64),
        claimed_at: "2026-07-16T07:58:20.000Z",
        producer: { producer_id: "ifc-worker-edge-01", producer_kind: "external_ifc_worker" },
      });
    expect(ready.status).toBe(503);
    expect(ready.body.error).toBe("governed_source_store_unconfigured");

    const listed = await request(app.app).get("/api/external/source-bundles");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ count: 0, items: [] });

    const confirm = await request(app.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send({ grouping_key: "tenant-a/legacy" });
    // Production external verifier 尚未接線：protected mutation 必須在任何 governed MinIO
    // 探查前 fail closed，而不是信任 caller 自述 capability/decision ref。
    expect(confirm.status).toBe(503);
    expect(confirm.body.error).toBe("authorization_unavailable");
    // legacy 面照樣零污染：升格路徑不得憑空生出 governed bundle。
    expect(app.sourceBundleStore.list()).toEqual([]);
  });
});
