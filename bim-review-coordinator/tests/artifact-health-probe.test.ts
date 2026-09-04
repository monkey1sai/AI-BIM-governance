import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalArtifactProbeUrl,
  probeArtifactHealth,
} from "../src/services/artifactHealthProbe.js";

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

function alternateDrivePath(storageRoot: string): string {
  const currentDrive = path.win32.parse(storageRoot).root.slice(0, 2).toUpperCase();
  const alternate = currentDrive === "C:" ? "D:" : "C:";
  return `${alternate}\\artifact-health-probe\\storage\\source.ifc`;
}

describe("canonicalArtifactProbeUrl", () => {
  it.each([
    "http://localhost:49101/artifacts/alternate/model.usdc",
    "http://localhost.:49101/artifacts/alternate/model.usdc",
    "http://worker.localhost:49101/artifacts/alternate/model.usdc",
    "http://127.0.0.2:49101/artifacts/alternate/model.usdc",
    "http://[::1]:49101/artifacts/alternate/model.usdc",
    "http://[::ffff:127.0.0.1]:49101/artifacts/alternate/model.usdc",
  ])("rejects alternate loopback origin %s when direct-session probing requires the configured origin", (url) => {
    expect(canonicalArtifactProbeUrl(url, "http://127.0.0.1:49101", {
      allowAlternateLoopback: false,
    })).toBeNull();
  });

  it("keeps the exact configured loopback origin", () => {
    expect(canonicalArtifactProbeUrl(
      "http://127.0.0.1:49101/artifacts/exact/model.usdc",
      "http://127.0.0.1:49101",
      { allowAlternateLoopback: false },
    )?.href).toBe("http://127.0.0.1:49101/artifacts/exact/model.usdc");
  });

  it.each([
    "https://localhost/artifacts/alternate/model.usdc",
    "https://[::1]/artifacts/alternate/model.usdc",
  ])("rejects HTTPS alternate loopback origin %s when direct-session probing requires the configured origin", (url) => {
    expect(canonicalArtifactProbeUrl(url, "https://127.0.0.1", {
      allowAlternateLoopback: false,
    })).toBeNull();
  });

  it("remaps a DNS hostname beginning with 127 instead of treating it as loopback", () => {
    expect(canonicalArtifactProbeUrl(
      "http://127.evil.example:49101/artifacts/dns/model.usdc",
      "http://127.0.0.1:49101",
    )?.href).toBe("http://127.0.0.1:49101/artifacts/dns/model.usdc");
  });

  it.each([
    "http://127.0.0.2:1/admin",
    "http://[::1]:22/admin",
  ])("does not directly probe non-legacy loopback URL %s", (url) => {
    expect(canonicalArtifactProbeUrl(url, "http://127.0.0.1:49101")).toBeNull();
  });

  it("remaps a non-legacy loopback artifact URL through the configured origin", () => {
    expect(canonicalArtifactProbeUrl(
      "http://127.0.0.2:49101/artifacts/remapped/model.usdc",
      "http://127.0.0.1:49101",
    )?.href).toBe("http://127.0.0.1:49101/artifacts/remapped/model.usdc");
  });
});

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

  it("source_ifc_exists is false for UNC paths and alternate drives outside STORAGE_HOST_ROOT", async () => {
    const edgeRoot = "C:\\artifact-health-probe";
    const storageRoot = "C:\\artifact-health-probe\\storage";

    const uncSnapshot = await probeArtifactHealth({
      host_local_path: "\\\\server\\share\\artifact-health-probe\\storage\\source.ifc",
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      storage_root: storageRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });
    const alternateDriveSnapshot = await probeArtifactHealth({
      host_local_path: alternateDrivePath(storageRoot),
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      storage_root: storageRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(uncSnapshot.source_ifc_exists).toBe(false);
    expect(uncSnapshot.failure_details?.source_ifc).toBe("source_ifc_unc_path_rejected");
    expect(alternateDriveSnapshot.source_ifc_exists).toBe(false);
    expect(alternateDriveSnapshot.failure_details?.source_ifc).toBe("source_ifc_alternate_drive_rejected");
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

  it("source_ifc_exists is false when storage root itself resolves outside EDGE_RUNTIME_DATA_ROOT", async () => {
    const { edgeRoot, storageRoot } = makeEdgeRoot();
    fs.rmSync(storageRoot, { recursive: true, force: true });
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-health-storage-outside-"));
    roots.push(outsideRoot);
    const outsideFile = path.join(outsideRoot, "source.ifc");
    fs.writeFileSync(outsideFile, "outside", "utf-8");

    try {
      fs.symlinkSync(outsideRoot, storageRoot, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    const snapshot = await probeArtifactHealth({
      host_local_path: path.join(storageRoot, "source.ifc"),
      model_artifact_url: null,
      mapping_url: null,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: "http://127.0.0.1:49100",
    });

    expect(snapshot.source_ifc_exists).toBe(false);
    expect(snapshot.failure_details?.source_ifc).toBe("edge_storage_root_escape");
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

  it("public conversion artifact URLs are probed through the configured conversion origin", async () => {
    const { edgeRoot } = makeEdgeRoot();
    const seen: Array<{ host: string | undefined; method: string | undefined; url: string | undefined }> = [];
    const server = await startArtifactServer((req, res) => {
      seen.push({ host: req.headers.host, method: req.method, url: req.url });
      res.writeHead(200);
      res.end();
    });
    const address = new URL(server.origin);

    const snapshot = await probeArtifactHealth({
      host_local_path: null,
      model_artifact_url: `http://192.168.10.105:${address.port}/artifacts/stream_conv_demo_001/model.usdc`,
      mapping_url: `http://192.168.10.105:${address.port}/artifacts/stream_conv_demo_001/element_mapping.json`,
      edge_runtime_data_root: edgeRoot,
      configured_conversion_api_origin: server.origin,
    });

    expect(snapshot.model_usdc_reachable).toBe(true);
    expect(snapshot.mapping_reachable).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen.every((hit) => hit.host === address.host)).toBe(true);
    expect(seen.map((hit) => `${hit.method} ${hit.url}`).sort()).toEqual([
      "HEAD /artifacts/stream_conv_demo_001/element_mapping.json",
      "HEAD /artifacts/stream_conv_demo_001/model.usdc",
    ]);
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
