import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalConversionApiBase = process.env.CONVERSION_API_BASE;
const originalStreamingConversionApiBase = process.env.STREAMING_CONVERSION_API_BASE;

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
