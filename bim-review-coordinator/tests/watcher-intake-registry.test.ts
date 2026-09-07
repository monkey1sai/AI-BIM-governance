import { describe, expect, it } from "vitest";
import { WatcherIntakeRegistry } from "../src/services/watcherIntakeRegistry.js";

describe("WatcherIntakeRegistry", () => {
  it("marks only a pre-registered (idempotency_key, correlation_id) pair as watcher-originated, once", () => {
    const registry = new WatcherIntakeRegistry();
    expect(registry.consume("mw_0123456789abcdef", "minio-watch-01234567")).toBe(false);
    registry.expect("mw_0123456789abcdef", "minio-watch-01234567");
    expect(registry.consume("mw_0123456789abcdef", "other")).toBe(false);
    expect(registry.consume("mw_0123456789abcdef", "minio-watch-01234567")).toBe(true);
    // one-shot: a later external replay with the same pair is not watcher provenance
    expect(registry.consume("mw_0123456789abcdef", "minio-watch-01234567")).toBe(false);
    expect(registry.size).toBe(0);
  });
  it("expires registrations whose self-POST never arrived", () => {
    let now = 1_000;
    const registry = new WatcherIntakeRegistry(500, () => now);
    registry.expect("mw_0123456789abcdef", "minio-watch-01234567");
    now = 1_600;
    expect(registry.consume("mw_0123456789abcdef", "minio-watch-01234567")).toBe(false);
    expect(registry.size).toBe(0);
  });
});
