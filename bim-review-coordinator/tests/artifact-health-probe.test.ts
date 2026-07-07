import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeArtifactHealth } from "../src/services/artifactHealthProbe.js";

const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeEdgeRoot(): { edgeRoot: string; storageRoot: string } {
  const edgeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-health-probe-"));
  roots.push(edgeRoot);
  const storageRoot = path.join(edgeRoot, "storage");
  fs.mkdirSync(storageRoot, { recursive: true });
  return { edgeRoot, storageRoot };
}

async function startArtifactServer(
  handler: http.RequestListener,
): Promise<{ origin: string; url: (pathname: string) => string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    url: (pathname: string) => `${origin}${pathname}`,
  };
}

function alternateDrivePath(edgeRoot: string): string {
  const currentDrive = path.win32.parse(edgeRoot).root.slice(0, 2).toUpperCase();
  const alternate = currentDrive === "C:" ? "D:" : "C:";
  return `${alternate}\\artifact-health-probe\\storage\\source.ifc`;
}

describe("probeArtifactHealth", () => {
  it("source_ifc_exists is true when host_local_path is a file", async () => {
    const { edgeRoot, storageRoot } = makeEdgeRoot();
    const sourcePath = path.join(storageRoot, "ifc-cache", "job-1", "source.ifc");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "ISO-10303-21;", "utf-8");

    const snapshot = await probeArtifactHealth({
      host_local_path: sourcePath,
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
      checked_at: "2026-07-07T08:00:00.000Z",
    });

    expect(snapshot.source_ifc_exists).toBe(true);
    expect(snapshot.checked_at).toBe("2026-07-07T08:00:00.000Z");
  });

  it("source_ifc_exists is false when host_local_path is missing", async () => {
    const { edgeRoot, storageRoot } = makeEdgeRoot();

    const snapshot = await probeArtifactHealth({
      host_local_path: path.join(storageRoot, "ifc-cache", "missing", "source.ifc"),
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.source_ifc_exists).toBe(false);
  });

  it("source_ifc_exists is false when host_local_path escapes EDGE_RUNTIME_DATA_ROOT", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const outsidePath = path.join(edgeRoot, "..", "outside-source.ifc");
    fs.writeFileSync(outsidePath, "outside", "utf-8");
    roots.push(outsidePath);

    const snapshot = await probeArtifactHealth({
      host_local_path: outsidePath,
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.source_ifc_exists).toBe(false);
  });

  it("source_ifc_exists is false for UNC paths and alternate drives outside EDGE_RUNTIME_DATA_ROOT", async () => {
    const { edgeRoot } = makeEdgeRoot();

    const uncSnapshot = await probeArtifactHealth({
      host_local_path: "\\\\server\\share\\artifact-health-probe\\storage\\source.ifc",
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });
    const alternateDriveSnapshot = await probeArtifactHealth({
      host_local_path: alternateDrivePath(edgeRoot),
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(uncSnapshot.source_ifc_exists).toBe(false);
    expect(alternateDriveSnapshot.source_ifc_exists).toBe(false);
  });

  it("source_ifc_exists is false when a storage symlink resolves outside EDGE_RUNTIME_DATA_ROOT", async () => {
    const { edgeRoot, storageRoot } = makeEdgeRoot();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-health-outside-"));
    roots.push(outsideRoot);
    const outsideFile = path.join(outsideRoot, "source.ifc");
    fs.writeFileSync(outsideFile, "outside", "utf-8");

    const linkPath = path.join(storageRoot, "linked-outside");
    try {
      fs.symlinkSync(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    const snapshot = await probeArtifactHealth({
      host_local_path: path.join(linkPath, "source.ifc"),
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.source_ifc_exists).toBe(false);
    expect(snapshot.failure_details?.source_ifc).toBe("source_ifc_symlink_escape");
  });

  it("model_usdc_reachable is false when artifact URL returns 404", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const server = await startArtifactServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: server.url("/artifacts/job-1/model.usdc"),
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBe(false);
  });

  it("model_usdc_reachable is null for disallowed off-origin artifact URL", async () => {
    const { edgeRoot } = makeEdgeRoot();

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: "https://example.com/artifacts/job-1/model.usdc",
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.model_usdc_reachable).toBeNull();
  });

  it("model_usdc_reachable rejects credentialed artifact URLs without hitting the server", async () => {
    const { edgeRoot } = makeEdgeRoot();
    let hits = 0;
    const server = await startArtifactServer((_req, res) => {
      hits += 1;
      res.writeHead(200);
      res.end();
    });
    const address = new URL(server.origin);

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: `http://user:pass@${address.host}/artifacts/job-1/model.usdc`,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBeNull();
    expect(snapshot.failure_details?.model_usdc).toBe("url_not_allowed");
    expect(hits).toBe(0);
  });

  it("model_usdc_reachable does not follow redirects", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const seen: string[] = [];
    const server = await startArtifactServer((req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(302, { Location: "https://example.com/private/model.usdc" });
      res.end();
    });

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: server.url("/artifacts/job-1/model.usdc"),
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBe(false);
    expect(snapshot.failure_details?.model_usdc).toBe("http_302");
    expect(seen).toEqual(["/artifacts/job-1/model.usdc"]);
  });

  it("model_usdc_reachable is null for invalid artifact URLs", async () => {
    const { edgeRoot } = makeEdgeRoot();

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: "not a url",
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.model_usdc_reachable).toBeNull();
    expect(snapshot.failure_details?.model_usdc).toBe("url_invalid");
  });

  it("model_usdc_reachable is false when an allowed URL times out", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const server = await startArtifactServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 2_000);
    });

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: server.url("/artifacts/job-1/model.usdc"),
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBe(false);
    expect(snapshot.failure_details?.model_usdc).toBe("network_error");
  }, 5_000);

  it("model_usdc_reachable allows loopback origin even when configured origin differs", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const server = await startArtifactServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: server.url("/artifacts/job-1/model.usdc"),
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.model_usdc_reachable).toBe(true);
  });

  it("model_usdc_reachable follows HEAD 405 with GET range", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const seen: Array<{ method: string | undefined; range: string | undefined }> = [];
    const server = await startArtifactServer((req, res) => {
      seen.push({ method: req.method, range: req.headers.range });
      if (req.method === "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (req.method === "GET" && req.headers.range === "bytes=0-0") {
        res.writeHead(206, { "Content-Range": "bytes 0-0/10" });
        res.end("x");
        return;
      }
      res.writeHead(500);
      res.end();
    });

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: server.url("/artifacts/job-1/model.usdc"),
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBe(true);
    expect(seen).toEqual([
      { method: "HEAD", range: undefined },
      { method: "GET", range: "bytes=0-0" },
    ]);
  });

  it("mapping_reachable is null when no mapping URL is bound", async () => {
    const { edgeRoot } = makeEdgeRoot();

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.mapping_reachable).toBeNull();
  });
});
