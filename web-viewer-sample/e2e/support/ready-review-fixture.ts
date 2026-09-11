import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCoordinatorApp } from "../../../bim-review-coordinator/src/app";
import { ConversionLedger } from "../../../bim-review-coordinator/src/services/conversionLedger";

// Synthetic conversion authority + real coordinator HTTP contract fixture.
// Does not claim isolated_branch_stack, actual IFC conversion, Kit or GPU evidence.
export const readyModelId = "mw_0123456789abcdef";
export async function startReadyReviewFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ready-review-intent-"));
  const job = "stream_conv_review_fixture";
  let origin = "";
  const authority = http.createServer((req, res) => {
    if (req.url === `/api/conversions/${job}/result`) {
      res.setHeader("Content-Type", "application/json");
      const model = `${origin}/artifacts/${job}/model.usdc`;
      const mapping = `${origin}/artifacts/${job}/element_mapping.json`;
      res.end(JSON.stringify({
        conversion_job_id: job, authority: "bim-streaming-server", status: "succeeded", ready: true,
        tenant_id: "tenant-test", project_id: "project-test", model_version_id: "v1",
        correlation_id: "review-fixture", trace_id: "ifcready_review_fixture",
        usdc_url: model, mapping_url: mapping, model: { status: "ready", format: "usdc", url: model },
        artifacts: { model_usdc: { url: model, checksum_sha256: "a".repeat(64) },
          element_mapping: { url: mapping, checksum_sha256: "b".repeat(64) } },
      }));
    } else if (req.url?.startsWith(`/artifacts/${job}/`)) {
      res.writeHead(200).end(req.method === "HEAD" ? undefined : "synthetic session contract fixture");
    } else res.writeHead(404).end();
  });
  await new Promise<void>(resolve => authority.listen(0, "127.0.0.1", resolve));
  const address = authority.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  const ledgerPath = path.join(root, "ledger.json");
  const ledger = new ConversionLedger(ledgerPath);
  ledger.upsert({ idempotency_key: readyModelId, correlation_id: "review-fixture",
    project_id: "project-test", project_display_name: "Session contract fixture",
    category: "architecture", external_model_version_id: "v1",
    conversion_job_id: job, status: "ready" }, new Date().toISOString());
  const viewerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const coordinator = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "outbox.json"), conversionLedgerStorePath: ledgerPath,
    pipelineJobStorePath: path.join(root, "pipeline-jobs.json"),
    logRoot: path.join(root, "logs"), kitManagerApiBase: origin, conversionApiBase: origin,
    artifactHealthLedgerStorePath: path.join(root, "artifact-health.json"),
    sourceBundleStorePath: path.join(root, "source-bundles.json"),
    edgeRuntimeDataRoot: path.join(root, "edge"), storageRoot: path.join(root, "storage"),
    minioWatchEnabled: false, minioWatchTenantId: "tenant-test", conversionPollEnabled: false,
    sourceBundleReconcileEnabled: false, streamingConversionApiBase: origin,
    streamingConversionPublicArtifactsUrl: `${origin}/artifacts`,
    externalIntakeIpAllowlist: ["127.0.0.1", "::1"], consoleDistDir: path.join(viewerDir, "dist-ui"),
    kitInstanceEndpoints: [],
  });
  await new Promise<void>(resolve => coordinator.server.listen(0, "127.0.0.1", resolve));
  const listener = coordinator.server.address();
  if (!listener || typeof listener === "string") throw new Error("Missing coordinator address");
  return {
    base: `http://127.0.0.1:${listener.port}`, root, coordinator,
    async stop() {
      await coordinator.dispose();
      coordinator.io.close();
      await new Promise<void>(resolve => coordinator.server.close(() => resolve()));
      await new Promise<void>(resolve => authority.close(() => resolve()));
      // Root is created and owned by this invocation; preserve evidence outside it.
      const resolved = path.resolve(root);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("ready-review-intent-")) {
        throw new Error("Unexpected fixture cleanup path");
      }
      fs.rmSync(resolved, { recursive: true });
    },
  };
}
