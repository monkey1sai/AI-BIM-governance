import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalConversionApiBase = process.env.CONVERSION_API_BASE;
const originalStreamingConversionApiBase = process.env.STREAMING_CONVERSION_API_BASE;
const originalKitStreamServer = process.env.KIT_STREAM_SERVER;
const originalKitMediaServer = process.env.KIT_MEDIA_SERVER;

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
