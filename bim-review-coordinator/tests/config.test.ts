import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalConversionApiBase = process.env.CONVERSION_API_BASE;
const originalStreamingConversionApiBase = process.env.STREAMING_CONVERSION_API_BASE;
const originalKitStreamServer = process.env.KIT_STREAM_SERVER;
const originalKitMediaServer = process.env.KIT_MEDIA_SERVER;
const originalStorageRoot = process.env.STORAGE_ROOT;
const originalPublicHost = process.env.PUBLIC_HOST;
const originalViewerPublicBaseUrl = process.env.VIEWER_PUBLIC_BASE_URL;
const originalCoordinatorPublicBaseUrl = process.env.COORDINATOR_PUBLIC_BASE_URL;
const originalCorsOrigins = process.env.CORS_ORIGINS;

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
