import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, type StructLogger } from "../../src/lib/structLog.js";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import {
  RESULT_ALLOWLIST,
  RESULT_ATTEMPT_ID,
  RESULT_AUTHORITY,
  RESULT_BUCKET,
  RESULT_COMPLETED_AT,
  RESULT_EXTERNAL_MODEL_VERSION_ID,
  RESULT_RESULT_ID,
  RESULT_SOURCE_BUNDLE_ID,
  seedResultManifest,
  sha256Hex,
} from "../helpers/resultManifestFixtures.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.3 收尾刀 —— **app.ts 接線**（result registration service
 * ＋ result-manifest detail reader ＋ protected result-action routes 的 fail-closed 面）。
 *
 * 前一支測試檔（`pipeline-result-registration.test.ts`）證明的是 service 行為；
 * 這一支證明的是「那些行為真的被接上 `createCoordinatorApp`」——沒有這一層，一個把
 * `details` 接回 `null`、或忘了建 registration service 的接線仍然會讓 service 測試全綠。
 *
 * **誠實邊界（Q6 fail-closed authorization）**：`CreateCoordinatorAppOptions` 目前**沒有**
 * external-authorization 的注入孔，production wiring 也刻意是 `authorization: null`
 * （external decision wire/JWKS/principal adapter 尚無 owner contract）。因此
 * compare／intent／confirm 三條 HTTP 路由在 app 層**只可能**走到
 * `503 authorization_unavailable`；本檔不發明注入孔去偽造一條綠路徑，改為：
 *   * HTTP 層斷言三條路由確實 fail closed（且是「authorization 先擋」，不是 details 缺席）；
 *   * registration／detail 的綠路徑改在 `@internal` accessor 層驅動真 composition。
 * 這是刻意的邊界，不是覆蓋率缺口——等 authorization adapter 落地後，同一組斷言可直接升級。
 *
 * MinIO 一律經 `sourceBundleObjectStoreFactory` seam 注入 in-memory fake；沒有 self-POST、
 * 沒有固定 port，也不啟動 legacy watcher（預設關閉）。
 */

let active: CoordinatorApp | null = null;
const tmpRoots: string[] = [];

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-result-app-"));
  tmpRoots.push(root);
  return root;
}

/** 讀 logger 寫出的 jsonl（照 tests/conversion-control-routes.test.ts 的既有慣例）。 */
function readRecords(logger: StructLogger): Array<Record<string, unknown>> {
  const text = fs.readFileSync(logger.currentFile(), "utf-8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line.trim()) as Record<string, unknown>);
}

function makeApp(
  root: string,
  overrides: Partial<CoordinatorConfig> = {},
  port: FakeSourceBundleObjectPort | null = null,
  structLog?: StructLogger,
): CoordinatorApp {
  const storageRoot = path.join(root, "storage");
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
      edgeSiteId: "site_test_edge",
      edgeRuntimeDataRoot: root,
      storageRoot,
      storageHostRoot: storageRoot,
      sourceBundleStorePath: path.join(root, "source-bundles.json"),
      pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      ...overrides,
    },
    {
      ...(port ? { sourceBundleObjectStoreFactory: () => port } : {}),
      ...(structLog ? { structLog } : {}),
    },
  );
  return active;
}

/** 建一個 governed job，並把一份合約合格的 result manifest ＋ 四個 artifact 播進 fake port。 */
function seedJobAndManifest(app: CoordinatorApp, port: FakeSourceBundleObjectPort) {
  const { job } = app.pipelineJobStore.ensureJobForSourceBundle({
    sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
    externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
    eventId: "ready-event-result-app-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  const seeded = seedResultManifest(port, {
    body: { pipeline_job_id: job.pipeline_job_id },
  });
  return { job, seeded };
}

function registrationInputFor(pipelineJobId: string, manifestLocator: Parameters<
  NonNullable<CoordinatorApp["pipelineResultRegistration"]>["registerFromManifest"]
>[0]["manifest_locator"]) {
  return {
    manifest_locator: manifestLocator,
    expected_identity: {
      result_id: RESULT_RESULT_ID,
      attempt_id: RESULT_ATTEMPT_ID,
      pipeline_job_id: pipelineJobId,
      source_bundle_id: RESULT_SOURCE_BUNDLE_ID,
      external_model_version_id: RESULT_EXTERNAL_MODEL_VERSION_ID,
    },
    attempt: { attempt_number: 1, completed_at: RESULT_COMPLETED_AT },
    now: "2026-07-16T08:41:07.500Z",
    correlation_id: "corr-lineage-app-0007",
  };
}

describe("app 接線：protected result actions fail closed", () => {
  it("POST result-actions/intent 在 external verifier 未接時回 503 authorization_unavailable", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job } = seedJobAndManifest(app, port);

    const response = await request(app.app)
      .post(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/result-actions/intent`)
      .send({
        transition: "promote",
        target_result_id: RESULT_RESULT_ID,
        expected_active_result_id: "result-0006",
        reason: "app wiring fail-closed probe",
        correlation_id: "corr-lineage-app-0007",
      })
      .set("x-lineage-authorization-decision", "synthetic-decision");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "authorization_unavailable" });
    // fail-closed 發生在 principal 解析，**不是**因為 governed port 缺席：
    // 同一個 app 的 registration／details 都已接上（見下方 describe）。
    expect(app.pipelineResultRegistration).not.toBeNull();
    // 沒有任何 intent 被建立（403/503 之前不得留下狀態）。
    expect(app.pipelineResultStore.listActivationAudit(job.pipeline_job_id)).toHaveLength(0);
  });

  it("POST result-actions/confirm 同樣 fail closed，且不觸碰 intent 狀態", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job } = seedJobAndManifest(app, port);

    const response = await request(app.app)
      .post(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/result-actions/confirm`)
      .send({ intent_id: "intent_app_wiring_probe_0001" })
      .set("x-lineage-authorization-decision", "synthetic-decision");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "authorization_unavailable" });
    expect(app.pipelineResultStore.getActivationIntent("intent_app_wiring_probe_0001")).toBeNull();
  });

  it("形狀錯誤的請求在 authorization 之前就被 400 擋下（不洩漏 verifier 狀態）", async () => {
    const app = makeApp(tmpRoot());
    const { job } = app.pipelineJobStore.ensureJobForSourceBundle({
      sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
      externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
      eventId: "ready-event-result-app-0002",
      now: "2026-07-16T08:00:00.000Z",
    });

    const intent = await request(app.app)
      .post(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/result-actions/intent`)
      .send({ transition: "sideways", target_result_id: RESULT_RESULT_ID });
    expect(intent.status).toBe(400);
    expect(intent.body).toEqual({ error: "invalid_activation_intent_request" });

    const confirm = await request(app.app)
      .post(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/result-actions/confirm`)
      .send({});
    expect(confirm.status).toBe(400);
    expect(confirm.body).toEqual({ error: "invalid_activation_confirm_request" });
  });
});

describe("app 接線：result registration 全鏈", () => {
  it("經 composition root 的 registration service 把 MinIO manifest 收成 AVAILABLE result 並自動首次啟用", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job, seeded } = seedJobAndManifest(app, port);

    const outcome = await app.pipelineResultRegistration!.registerFromManifest(
      registrationInputFor(job.pipeline_job_id, seeded.locator),
    );

    expect(outcome.registration.replay).toBe(false);
    // 經 app 自己的 store accessor 讀（不是 service 回傳值）：接線真的共用同一個 store。
    const stored = app.pipelineResultStore.getResult(RESULT_RESULT_ID)!;
    expect(stored).toMatchObject({
      pipeline_job_id: job.pipeline_job_id,
      attempt_id: RESULT_ATTEMPT_ID,
      publication_state: "AVAILABLE",
      attempt_outcome: "succeeded",
      result_manifest_digest: sha256Hex(seeded.bytes),
      selection_state: "active",
    });
    const audit = app.pipelineResultStore.listActivationAudit(job.pipeline_job_id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      transition: "first_activation",
      from_result_id: null,
      to_result_id: RESULT_RESULT_ID,
      capability: null,
      authorization_decision_ref: null,
      actor: { actor_kind: "system" },
      append_only: true,
    });
    expect(app.pipelineResultStore.getActiveResultPointer(job.pipeline_job_id)).toMatchObject({
      result_id: RESULT_RESULT_ID,
      selection_state: "active",
    });
    // 3.3 sidecar 不回寫 3.2 的 stable job 文件（不製造第二真相）。
    expect(app.pipelineJobStore.get(job.pipeline_job_id)!.active_result_id).toBeNull();
  });

  it("註冊後 compare route 仍 fail closed：擋住它的是 authorization，不是 result 資料", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job, seeded } = seedJobAndManifest(app, port);
    await app.pipelineResultRegistration!.registerFromManifest(
      registrationInputFor(job.pipeline_job_id, seeded.locator),
    );

    const response = await request(app.app)
      .get(`/api/lineage/pipeline-jobs/${job.pipeline_job_id}/results/compare`)
      .query({ left_result_id: RESULT_RESULT_ID, right_result_id: "result-0008" })
      .set("x-lineage-authorization-decision", "synthetic-decision");

    // Q6 誠實邊界：即使 result 已 AVAILABLE 且 details 已接上，external verifier 未接
    // 之前 compare 一律 503；本檔刻意不發明 authorization 注入孔去偽造綠路徑。
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "authorization_unavailable" });
    expect(response.body.error).not.toBe("result_detail_unavailable");
    expect(app.pipelineResultStore.getResult(RESULT_RESULT_ID)!.publication_state).toBe(
      "AVAILABLE",
    );
  });

  it("registration 對 referenced artifact 缺席同樣 fail closed（design.md §5 經 app 層仍成立）", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job } = app.pipelineJobStore.ensureJobForSourceBundle({
      sourceBundleId: RESULT_SOURCE_BUNDLE_ID,
      externalModelVersionId: RESULT_EXTERNAL_MODEL_VERSION_ID,
      eventId: "ready-event-result-app-0003",
      now: "2026-07-16T08:00:00.000Z",
    });
    const seeded = seedResultManifest(port, {
      body: { pipeline_job_id: job.pipeline_job_id },
      artifacts: { usdc: { omit: true } },
    });

    const error = await app
      .pipelineResultRegistration!.registerFromManifest(
        registrationInputFor(job.pipeline_job_id, seeded.locator),
      )
      .then(
        () => new Error("expected rejection"),
        (rejected: unknown) => rejected,
      );

    expect((error as { code?: string }).code).toBe("result_manifest_artifact_not_found");
    expect(app.pipelineResultStore.listResults(job.pipeline_job_id)).toHaveLength(0);
  });
});

describe("app 接線：detail reader wiring", () => {
  it("governed object port 已注入時 details／registration 都非 null，且 detail reader 讀得到 fake manifest", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);
    const { job, seeded } = seedJobAndManifest(app, port);
    const registered = await app.pipelineResultRegistration!.registerFromManifest(
      registrationInputFor(job.pipeline_job_id, seeded.locator),
    );

    expect(app.pipelineResultDetails).not.toBeNull();
    // HTTP 面的 compare 綠路徑被 Q6 fail-closed authorization 擋住（見上方 describe），
    // 因此「details 真的接上且可用」只能在 accessor 層被 falsify——這是刻意設計。
    const side = await app.pipelineResultDetails!.readCompareSide(registered.registration.result);

    expect(side).toMatchObject({
      result_id: RESULT_RESULT_ID,
      pipeline_job_id: job.pipeline_job_id,
      publication_state: "AVAILABLE",
      attempt_outcome: "succeeded",
      result_manifest_digest: sha256Hex(seeded.bytes),
    });
    expect(side.result_manifest_ref.ref).toBe(seeded.locator.ref);
    expect(side.counts.full_lineage_matched_count).toBe(1000);
  });

  it("governed 端未設定時 details／registration 一律 null（誠實 503 而非半接線）", async () => {
    const app = makeApp(tmpRoot());

    expect(app.config.governedSourceMinioEndpoint).toBe("");
    expect(app.pipelineResultDetails).toBeNull();
    expect(app.pipelineResultRegistration).toBeNull();
  });

  it("僅靠 GOVERNED_SOURCE_* config（無測試 factory）也會組出 details／registration", () => {
    // 真 S3 adapter 的建構是純粹的 client 組裝（無網路 I/O）；這一案證明的是
    // env-driven 分支與 factory 分支接的是同一組 composition，不是只有測試路徑有接。
    const app = makeApp(tmpRoot(), {
      governedSourceMinioEndpoint: "http://127.0.0.1:1",
      governedSourceMinioAccessKey: "unused-test-access-key-id",
      governedSourceMinioSecretKey: "unused-test-secret-key",
      governedSourceAuthorityAllowlist: [RESULT_AUTHORITY],
      governedSourceBucketAllowlist: [RESULT_BUCKET],
    });

    expect(app.pipelineResultDetails).not.toBeNull();
    expect(app.pipelineResultRegistration).not.toBeNull();
  });

  it("allowlist 為空（fail-closed 未設定）時不得組出 details／registration", () => {
    const app = makeApp(tmpRoot(), {
      governedSourceMinioEndpoint: "http://127.0.0.1:1",
      governedSourceMinioAccessKey: "unused-test-access-key-id",
      governedSourceMinioSecretKey: "unused-test-secret-key",
      governedSourceAuthorityAllowlist: [],
      governedSourceBucketAllowlist: [],
    });

    expect(app.pipelineResultDetails).toBeNull();
    expect(app.pipelineResultRegistration).toBeNull();
  });
});

describe("app 接線：task 3.4 artifact / metadata 生產面", () => {
  const POLICY_JSON = JSON.stringify([
    {
      authority: RESULT_AUTHORITY,
      bucket: RESULT_BUCKET,
      public_origin: "https://lineage-download.example.test",
      object_path_prefix: `/${RESULT_BUCKET}/`,
    },
  ]);

  it("governed port 已注入時 reader／signer／projections 三者同生，且 policy env 被解析", () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), { lineageDownloadTargetPolicies: POLICY_JSON }, port);

    expect(app.lineageArtifactSurfaces.reader).not.toBeNull();
    expect(app.lineageArtifactSurfaces.signer).not.toBeNull();
    expect(app.lineageArtifactSurfaces.projections).not.toBeNull();
    expect(app.lineageArtifactSurfaces.target_policies).toEqual([
      {
        authority: RESULT_AUTHORITY,
        bucket: RESULT_BUCKET,
        public_origin: "https://lineage-download.example.test",
        object_path_prefix: `/${RESULT_BUCKET}/`,
      },
    ]);
  });

  it("governed 端未設定時三者同滅（null 傳染與 registration／details 同一條件）", () => {
    const app = makeApp(tmpRoot(), { lineageDownloadTargetPolicies: POLICY_JSON });

    expect(app.lineageArtifactSurfaces.reader).toBeNull();
    expect(app.lineageArtifactSurfaces.signer).toBeNull();
    expect(app.lineageArtifactSurfaces.projections).toBeNull();
    // policy 是獨立的 env：port 沒接不代表 policy 解析失敗，但下載面本來就打不開。
    expect(app.lineageArtifactSurfaces.target_policies).toHaveLength(1);
  });

  it("policy env 未設定＝空清單＝fail-closed（181 的誠實現狀：沒有 HTTPS public origin）", () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), {}, port);

    expect(app.config.lineageDownloadTargetPolicies).toBe("");
    expect(app.lineageArtifactSurfaces.target_policies).toEqual([]);
    // reader／signer 都在，唯獨沒有任何 public target 可解析 → download route 仍關閉。
    expect(app.lineageArtifactSurfaces.reader).not.toBeNull();
    expect(app.lineageArtifactSurfaces.signer).not.toBeNull();
  });

  it("policy env 設了但打壞時收斂成空清單，**並且一定吵**（startup warn）", () => {
    const root = tmpRoot();
    const logger = createLogger("coordinator", {
      logRoot: path.join(root, "logs"),
      runId: "run_20260716_084107_policy1",
      skipEnvSnapshot: true,
    });
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(
      root,
      { lineageDownloadTargetPolicies: POLICY_JSON.replace("https://", "http://") },
      port,
      logger,
    );

    expect(app.lineageArtifactSurfaces.target_policies).toEqual([]);
    // 空清單本身分不出「沒設定」與「設錯了」；沒有這筆 warn，運維會以為下載面
    // 只是還沒開通，而不是自己打錯字。
    const warns = readRecords(logger).filter(
      (record) => record.level === "warn" && record.component === "lineage-artifact-download",
    );
    expect(warns).toHaveLength(1);
    expect(warns[0].data).toMatchObject({ configured: true, policy_count: 0 });
  });

  it("policy env 未設定時**不吵**（沒設定不是錯誤，只是還沒開通）", () => {
    const root = tmpRoot();
    const logger = createLogger("coordinator", {
      logRoot: path.join(root, "logs"),
      runId: "run_20260716_084107_policy2",
      skipEnvSnapshot: true,
    });
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);

    makeApp(root, {}, port, logger);

    expect(
      readRecords(logger).filter(
        (record) => record.component === "lineage-artifact-download",
      ),
    ).toHaveLength(0);
  });

  it("download route 在 external verifier 未接時仍 fail closed（reader/signer 已接也一樣）", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), { lineageDownloadTargetPolicies: POLICY_JSON }, port);
    const { job } = seedJobAndManifest(app, port);

    const response = await request(app.app)
      .get(
        `/api/lineage/pipeline-jobs/${job.pipeline_job_id}/results/${RESULT_RESULT_ID}/artifacts/usdc/download`,
      )
      .set("x-lineage-authorization-decision", "synthetic-decision");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "authorization_unavailable" });
    // 擋住它的是 authorization，不是 reader/signer 缺席（兩者都已接上）。
    expect(app.lineageArtifactSurfaces.reader).not.toBeNull();
    expect(app.lineageArtifactSurfaces.signer).not.toBeNull();
  });

  it("accessor 層驗證 reader 真的可讀 fake manifest（HTTP 綠路徑被 Q6 authorization 擋住）", async () => {
    const port = createFakeSourceBundleObjectPort(RESULT_ALLOWLIST);
    const app = makeApp(tmpRoot(), { lineageDownloadTargetPolicies: POLICY_JSON }, port);
    const { job, seeded } = seedJobAndManifest(app, port);
    const registered = await app.pipelineResultRegistration!.registerFromManifest(
      registrationInputFor(job.pipeline_job_id, seeded.locator),
    );

    const descriptor = await app.lineageArtifactSurfaces.reader!.readArtifact(
      registered.registration.result,
      "usdc",
    );

    expect(descriptor).toMatchObject({
      pipeline_job_id: job.pipeline_job_id,
      result_id: RESULT_RESULT_ID,
      artifact_id: "usdc",
      role: "usdc",
    });
    // 同一個 reader 對缺席 role 回 null（route 據此 404，不是 503）。
    expect(
      await app.lineageArtifactSurfaces.reader!.readArtifact(
        registered.registration.result,
        "quality_report",
      ),
    ).toBeNull();
  });
});
