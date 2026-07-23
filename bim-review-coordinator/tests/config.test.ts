import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalConversionApiBase = process.env.CONVERSION_API_BASE;
const originalStreamingConversionApiBase = process.env.STREAMING_CONVERSION_API_BASE;
const originalKitStreamServer = process.env.KIT_STREAM_SERVER;
const originalKitMediaServer = process.env.KIT_MEDIA_SERVER;
const originalKitMediaPort = process.env.KIT_MEDIA_PORT;
const originalStorageRoot = process.env.STORAGE_ROOT;
const originalPublicHost = process.env.PUBLIC_HOST;
const originalViewerPublicBaseUrl = process.env.VIEWER_PUBLIC_BASE_URL;
const originalCoordinatorPublicBaseUrl = process.env.COORDINATOR_PUBLIC_BASE_URL;
const originalCorsOrigins = process.env.CORS_ORIGINS;
const originalKitInstanceEndpoints = process.env.KIT_INSTANCE_ENDPOINTS;
const originalKitSpectatorCount = process.env.KIT_SPECTATOR_COUNT;
const originalKitSpectatorSignalingPortStart = process.env.KIT_SPECTATOR_SIGNALING_PORT_START;
const originalKitSpectatorMediaPortStart = process.env.KIT_SPECTATOR_MEDIA_PORT_START;
const originalKitSpectatorStreamPortStart = process.env.KIT_SPECTATOR_STREAM_PORT_START;
const originalKitSpectatorPortStride = process.env.KIT_SPECTATOR_PORT_STRIDE;
const originalIfcDownloadStrict = process.env.IFC_DOWNLOAD_STRICT;
const originalEdgeSiteId = process.env.EDGE_SITE_ID;
const originalEdgeRuntimeDataRoot = process.env.EDGE_RUNTIME_DATA_ROOT;
const originalA4ConversionArtifactsRoot = process.env.A4_CONVERSION_ARTIFACTS_ROOT;
const originalA4ConversionArtifactsHostRoot = process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT;
const originalArtifactHealthLedgerStorePath = process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH;

const kitEndpointEnvNames = [
  "KIT_INSTANCE_ENDPOINTS",
  "KIT_SPECTATOR_COUNT",
  "KIT_SPECTATOR_SIGNALING_PORT_START",
  "KIT_SPECTATOR_MEDIA_PORT_START",
  "KIT_SPECTATOR_STREAM_PORT_START",
  "KIT_SPECTATOR_PORT_STRIDE",
] as const;

function clearKitEndpointEnv(): void {
  for (const name of kitEndpointEnvNames) {
    delete process.env[name];
  }
}

beforeEach(() => {
  clearKitEndpointEnv();
  delete process.env.IFC_DOWNLOAD_STRICT;
  delete process.env.EDGE_SITE_ID;
  delete process.env.EDGE_RUNTIME_DATA_ROOT;
  delete process.env.A4_CONVERSION_ARTIFACTS_ROOT;
  delete process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT;
  delete process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH;
});

afterEach(() => {
  if (originalConversionApiBase === undefined) {
    delete process.env.CONVERSION_API_BASE;
  } else {
    process.env.CONVERSION_API_BASE = originalConversionApiBase;
  }

  if (originalStreamingConversionApiBase === undefined) {
    delete process.env.STREAMING_CONVERSION_API_BASE;
  } else {
    process.env.STREAMING_CONVERSION_API_BASE = originalStreamingConversionApiBase;
  }

  if (originalKitStreamServer === undefined) {
    delete process.env.KIT_STREAM_SERVER;
  } else {
    process.env.KIT_STREAM_SERVER = originalKitStreamServer;
  }

  if (originalKitMediaServer === undefined) {
    delete process.env.KIT_MEDIA_SERVER;
  } else {
    process.env.KIT_MEDIA_SERVER = originalKitMediaServer;
  }

  if (originalKitMediaPort === undefined) {
    delete process.env.KIT_MEDIA_PORT;
  } else {
    process.env.KIT_MEDIA_PORT = originalKitMediaPort;
  }

  if (originalStorageRoot === undefined) {
    delete process.env.STORAGE_ROOT;
  } else {
    process.env.STORAGE_ROOT = originalStorageRoot;
  }

  if (originalPublicHost === undefined) {
    delete process.env.PUBLIC_HOST;
  } else {
    process.env.PUBLIC_HOST = originalPublicHost;
  }

  if (originalViewerPublicBaseUrl === undefined) {
    delete process.env.VIEWER_PUBLIC_BASE_URL;
  } else {
    process.env.VIEWER_PUBLIC_BASE_URL = originalViewerPublicBaseUrl;
  }

  if (originalCoordinatorPublicBaseUrl === undefined) {
    delete process.env.COORDINATOR_PUBLIC_BASE_URL;
  } else {
    process.env.COORDINATOR_PUBLIC_BASE_URL = originalCoordinatorPublicBaseUrl;
  }

  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins;
  }

  if (originalKitInstanceEndpoints === undefined) {
    delete process.env.KIT_INSTANCE_ENDPOINTS;
  } else {
    process.env.KIT_INSTANCE_ENDPOINTS = originalKitInstanceEndpoints;
  }

  if (originalKitSpectatorCount === undefined) {
    delete process.env.KIT_SPECTATOR_COUNT;
  } else {
    process.env.KIT_SPECTATOR_COUNT = originalKitSpectatorCount;
  }

  if (originalKitSpectatorSignalingPortStart === undefined) {
    delete process.env.KIT_SPECTATOR_SIGNALING_PORT_START;
  } else {
    process.env.KIT_SPECTATOR_SIGNALING_PORT_START = originalKitSpectatorSignalingPortStart;
  }

  if (originalKitSpectatorMediaPortStart === undefined) {
    delete process.env.KIT_SPECTATOR_MEDIA_PORT_START;
  } else {
    process.env.KIT_SPECTATOR_MEDIA_PORT_START = originalKitSpectatorMediaPortStart;
  }

  if (originalKitSpectatorStreamPortStart === undefined) {
    delete process.env.KIT_SPECTATOR_STREAM_PORT_START;
  } else {
    process.env.KIT_SPECTATOR_STREAM_PORT_START = originalKitSpectatorStreamPortStart;
  }

  if (originalKitSpectatorPortStride === undefined) {
    delete process.env.KIT_SPECTATOR_PORT_STRIDE;
  } else {
    process.env.KIT_SPECTATOR_PORT_STRIDE = originalKitSpectatorPortStride;
  }

  if (originalIfcDownloadStrict === undefined) {
    delete process.env.IFC_DOWNLOAD_STRICT;
  } else {
    process.env.IFC_DOWNLOAD_STRICT = originalIfcDownloadStrict;
  }

  if (originalEdgeSiteId === undefined) {
    delete process.env.EDGE_SITE_ID;
  } else {
    process.env.EDGE_SITE_ID = originalEdgeSiteId;
  }

  if (originalEdgeRuntimeDataRoot === undefined) {
    delete process.env.EDGE_RUNTIME_DATA_ROOT;
  } else {
    process.env.EDGE_RUNTIME_DATA_ROOT = originalEdgeRuntimeDataRoot;
  }

  if (originalA4ConversionArtifactsRoot === undefined) {
    delete process.env.A4_CONVERSION_ARTIFACTS_ROOT;
  } else {
    process.env.A4_CONVERSION_ARTIFACTS_ROOT = originalA4ConversionArtifactsRoot;
  }

  if (originalA4ConversionArtifactsHostRoot === undefined) {
    delete process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT;
  } else {
    process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT = originalA4ConversionArtifactsHostRoot;
  }

  if (originalArtifactHealthLedgerStorePath === undefined) {
    delete process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH;
  } else {
    process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH = originalArtifactHealthLedgerStorePath;
  }
});

describe("loadConfig public browser bases", () => {
  it("normalizes explicit public base URL env vars to origins", () => {
    process.env.VIEWER_PUBLIC_BASE_URL = "http://192.168.10.105:5173/";
    process.env.COORDINATOR_PUBLIC_BASE_URL = "https://review.example.test:8004/";

    const config = loadConfig();

    expect(config.viewerPublicBaseUrl).toBe("http://192.168.10.105:5173");
    expect(config.coordinatorPublicBaseUrl).toBe("https://review.example.test:8004");
  });

  it("rejects scheme-less public base URL env vars", () => {
    process.env.VIEWER_PUBLIC_BASE_URL = "192.168.10.105:5173";

    expect(() => loadConfig()).toThrow(/VIEWER_PUBLIC_BASE_URL must be an absolute http\(s\) URL/);
  });

  it("preserves public base URL path prefixes", () => {
    delete process.env.CORS_ORIGINS;
    process.env.VIEWER_PUBLIC_BASE_URL = "https://review.example.test/bim-viewer/";
    process.env.COORDINATOR_PUBLIC_BASE_URL = "https://review.example.test/coordinator/";

    const config = loadConfig();

    expect(config.viewerPublicBaseUrl).toBe("https://review.example.test/bim-viewer");
    expect(config.coordinatorPublicBaseUrl).toBe("https://review.example.test/coordinator");
    expect(config.corsOrigins).toContain("https://review.example.test");
    expect(config.corsOrigins).not.toContain("https://review.example.test/bim-viewer");
  });

  it("rejects public base URL env vars with query strings", () => {
    process.env.COORDINATOR_PUBLIC_BASE_URL = "http://192.168.10.105:8004/ui?x=1";

    expect(() => loadConfig()).toThrow(/COORDINATOR_PUBLIC_BASE_URL must not include query/);
  });
});

describe("loadConfig conversion API base", () => {
  it("ignores the retired 8003 local conversion default", () => {
    process.env.CONVERSION_API_BASE = "http://127.0.0.1:8003";
    delete process.env.STREAMING_CONVERSION_API_BASE;

    expect(loadConfig().conversionApiBase).toBe("http://127.0.0.1:49101");
  });

  it("uses STREAMING_CONVERSION_API_BASE before legacy CONVERSION_API_BASE", () => {
    process.env.CONVERSION_API_BASE = "http://127.0.0.1:8003";
    process.env.STREAMING_CONVERSION_API_BASE = "http://127.0.0.1:49109";

    expect(loadConfig().conversionApiBase).toBe("http://127.0.0.1:49109");
  });

  it("keeps an explicit non-retired CONVERSION_API_BASE override", () => {
    process.env.CONVERSION_API_BASE = "http://127.0.0.1:49222";
    delete process.env.STREAMING_CONVERSION_API_BASE;

    expect(loadConfig().conversionApiBase).toBe("http://127.0.0.1:49222");
  });
});

describe("loadConfig IFC download strictness", () => {
  it("enables strict IFC download when IFC_DOWNLOAD_STRICT is set truthy", () => {
    process.env.IFC_DOWNLOAD_STRICT = "true";

    expect(loadConfig().ifcDownloadStrict).toBe(true);
  });

  it("defaults ifcDownloadStrict to false when IFC_DOWNLOAD_STRICT is unset", () => {
    delete process.env.IFC_DOWNLOAD_STRICT;

    expect(loadConfig().ifcDownloadStrict).toBe(false);
  });
});

describe("loadConfig Kit endpoint", () => {
  it("uses the stream host as the media host default", () => {
    process.env.KIT_STREAM_SERVER = "192.0.2.10";
    delete process.env.KIT_MEDIA_SERVER;

    const config = loadConfig();

    expect(config.kitStreamServer).toBe("192.0.2.10");
    expect(config.kitMediaServer).toBe("192.0.2.10");
  });

  it("resolves auto Kit hosts before exposing config", () => {
    process.env.KIT_STREAM_SERVER = "auto";
    process.env.KIT_MEDIA_SERVER = "auto";

    const config = loadConfig();

    expect(config.kitStreamServer).not.toBe("auto");
    expect(config.kitMediaServer).not.toBe("auto");
    expect(config.kitStreamServer.length).toBeGreaterThan(0);
    expect(config.kitMediaServer.length).toBeGreaterThan(0);
  });

  it("generates configured spectator endpoints from a single primary endpoint", () => {
    process.env.KIT_STREAM_SERVER = "192.0.2.10";
    process.env.KIT_MEDIA_SERVER = "192.0.2.10";
    process.env.KIT_MEDIA_PORT = "47998";
    process.env.KIT_SPECTATOR_COUNT = "5";

    const config = loadConfig();

    expect(config.kitInstanceEndpoints).toHaveLength(6);
    expect(config.kitInstanceEndpoints[0]).toMatchObject({
      id: "kit_local_001",
      signalingPort: 49100,
      mediaPort: 47998,
    });
    expect(config.kitInstanceEndpoints.slice(1).map((endpoint) => endpoint.signalingPort))
      .toEqual([49110, 49120, 49130, 49140, 49150]);
    expect(config.kitInstanceEndpoints.slice(1).map((endpoint) => endpoint.mediaPort))
      .toEqual([48008, 48018, 48028, 48038, 48048]);
  });

  it("respects custom spectator count and port stride", () => {
    process.env.KIT_MEDIA_PORT = "47998";
    process.env.KIT_SPECTATOR_COUNT = "2";
    process.env.KIT_SPECTATOR_SIGNALING_PORT_START = "49210";
    process.env.KIT_SPECTATOR_MEDIA_PORT_START = "48210";
    process.env.KIT_SPECTATOR_PORT_STRIDE = "2";

    const config = loadConfig();

    expect(config.kitInstanceEndpoints.map((endpoint) => endpoint.signalingPort))
      .toEqual([49100, 49210, 49212]);
    expect(config.kitInstanceEndpoints.map((endpoint) => endpoint.mediaPort))
      .toEqual([47998, 48210, 48212]);
  });

  it("does not append generated spectators when KIT_INSTANCE_ENDPOINTS already defines multiple endpoints", () => {
    process.env.KIT_SPECTATOR_COUNT = "5";
    process.env.KIT_INSTANCE_ENDPOINTS = JSON.stringify([
      {
        id: "kit_primary",
        signalingServer: "192.0.2.10",
        signalingPort: 49100,
        mediaServer: "192.0.2.10",
        mediaPort: 47998,
      },
      {
        id: "kit_explicit_spectator",
        signalingServer: "192.0.2.10",
        signalingPort: 49300,
        mediaServer: "192.0.2.10",
        mediaPort: 48300,
      },
    ]);

    const config = loadConfig();

    expect(config.kitInstanceEndpoints).toHaveLength(2);
    expect(config.kitInstanceEndpoints[1].id).toBe("kit_explicit_spectator");
    expect(config.kitInstanceEndpoints[1].signalingPort).toBe(49300);
  });

  it("rejects malformed KIT_INSTANCE_ENDPOINTS values", () => {
    process.env.KIT_INSTANCE_ENDPOINTS = "{not-json";

    expect(() => loadConfig()).toThrow(/KIT_INSTANCE_ENDPOINTS must be a JSON array/);
  });

  it("rejects KIT_INSTANCE_ENDPOINTS that produce no valid endpoints", () => {
    process.env.KIT_INSTANCE_ENDPOINTS = JSON.stringify([{ id: "missing_port" }]);

    expect(() => loadConfig()).toThrow(/KIT_INSTANCE_ENDPOINTS produced no valid Kit endpoints/);
  });

  it("rejects invalid spectator count values", () => {
    process.env.KIT_SPECTATOR_COUNT = "many";

    expect(() => loadConfig()).toThrow(/KIT_SPECTATOR_COUNT must be an integer/);
  });

  it("rejects generated spectator ports that collide with primary ports", () => {
    process.env.KIT_MEDIA_PORT = "47998";
    process.env.KIT_SPECTATOR_COUNT = "1";
    process.env.KIT_SPECTATOR_SIGNALING_PORT_START = "49100";

    expect(() => loadConfig()).toThrow(/duplicate signaling port: 49100/);

    process.env.KIT_SPECTATOR_SIGNALING_PORT_START = "49110";
    process.env.KIT_SPECTATOR_MEDIA_PORT_START = "47998";

    expect(() => loadConfig()).toThrow(/duplicate media port: 47998/);
  });
});

describe("loadConfig storageRoot fallback", () => {
  it("falls back to <cwd>/storage when STORAGE_ROOT is not set (host-native default)", () => {
    delete process.env.STORAGE_ROOT;

    expect(loadConfig().storageRoot).toBe(path.join(process.cwd(), "storage"));
  });

  it("respects explicit STORAGE_ROOT env (docker compose still sets /workspace/storage)", () => {
    process.env.STORAGE_ROOT = "/workspace/storage";

    expect(loadConfig().storageRoot).toBe("/workspace/storage");
  });
});

describe("loadConfig edge artifact health", () => {
  it("defaults artifact health ledger under data when EDGE_RUNTIME_DATA_ROOT is unset", () => {
    const config = loadConfig();

    expect(config.edgeSiteId).toBe("site_local_dev");
    expect(config.edgeRuntimeDataRoot).toBe(process.cwd());
    expect(config.a4ConversionArtifactsRoot).toBe(path.join(process.cwd(), "artifacts"));
    expect(config.a4ConversionArtifactsHostRoot).toBe(path.join(process.cwd(), "artifacts"));
    expect(config.artifactHealthLedgerStorePath).toBe(path.join(process.cwd(), "data", "artifact-health-ledger.json"));
  });

  it("uses edge runtime env vars for deployed data-plane ledgers", () => {
    process.env.EDGE_SITE_ID = "site_local_deploy";
    process.env.EDGE_RUNTIME_DATA_ROOT = "D:\\Users\\deploy\\AI-bim-geo-data";

    const config = loadConfig();

    expect(config.edgeSiteId).toBe("site_local_deploy");
    expect(config.edgeRuntimeDataRoot).toBe("D:\\Users\\deploy\\AI-bim-geo-data");
    expect(config.a4ConversionArtifactsRoot).toBe(
      path.join("D:\\Users\\deploy\\AI-bim-geo-data", "artifacts"),
    );
    expect(config.a4ConversionArtifactsHostRoot).toBe(
      path.join("D:\\Users\\deploy\\AI-bim-geo-data", "artifacts"),
    );
    expect(config.artifactHealthLedgerStorePath).toBe(
      path.join("D:\\Users\\deploy\\AI-bim-geo-data", "ledgers", "artifact-health-ledger.json"),
    );
  });

  it("respects the dedicated read-only A4 conversion artifacts mount", () => {
    process.env.A4_CONVERSION_ARTIFACTS_ROOT = "/workspace/a4-conversion-artifacts";
    process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT = "D:\\edge-data\\artifacts";

    expect(loadConfig().a4ConversionArtifactsRoot).toBe("/workspace/a4-conversion-artifacts");
    expect(loadConfig().a4ConversionArtifactsHostRoot).toBe("D:\\edge-data\\artifacts");
  });

  it("derives artifact health ledger path from final override edge runtime root", () => {
    const config = loadConfig({
      edgeRuntimeDataRoot: "D:\\Users\\deploy\\AI-bim-geo-data",
    });

    expect(config.artifactHealthLedgerStorePath).toBe(
      path.join("D:\\Users\\deploy\\AI-bim-geo-data", "ledgers", "artifact-health-ledger.json"),
    );
  });

  it("derives both A4 artifact roots from the final edge runtime override", () => {
    const edgeRuntimeDataRoot = "D:\\Users\\deploy\\AI-bim-geo-data";
    const config = loadConfig({ edgeRuntimeDataRoot });

    expect(config.a4ConversionArtifactsRoot).toBe(path.join(edgeRuntimeDataRoot, "artifacts"));
    expect(config.a4ConversionArtifactsHostRoot).toBe(path.join(edgeRuntimeDataRoot, "artifacts"));
  });

  it("derives the host A4 artifacts root from the final visible-root override", () => {
    const config = loadConfig({
      a4ConversionArtifactsRoot: "/workspace/custom-a4-artifacts",
    });

    expect(config.a4ConversionArtifactsHostRoot).toBe("/workspace/custom-a4-artifacts");
  });

  it("keeps an explicit host A4 artifacts root override", () => {
    const config = loadConfig({
      a4ConversionArtifactsRoot: "/workspace/custom-a4-artifacts",
      a4ConversionArtifactsHostRoot: "D:\\edge-data\\custom-a4-artifacts",
    });

    expect(config.a4ConversionArtifactsRoot).toBe("/workspace/custom-a4-artifacts");
    expect(config.a4ConversionArtifactsHostRoot).toBe("D:\\edge-data\\custom-a4-artifacts");
  });

  it("respects explicit ARTIFACT_HEALTH_LEDGER_STORE_PATH", () => {
    process.env.EDGE_RUNTIME_DATA_ROOT = "D:\\Users\\deploy\\AI-bim-geo-data";
    process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH = "D:\\edge\\ledgers\\custom-artifact-health.json";

    expect(loadConfig().artifactHealthLedgerStorePath).toBe("D:\\edge\\ledgers\\custom-artifact-health.json");
  });
});
