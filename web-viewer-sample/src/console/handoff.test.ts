// web-viewer-sample/src/console/handoff.test.ts
import { describe, expect, it } from "vitest";
import { buildHandoff, parseHandoff, isAxisKey } from "./handoff";

describe("cross-axis handoff util", () => {
  it("builds a #target?source=... hash carrying only provided ids", () => {
    const hash = buildHandoff("review", { source: "a1", rule_run_id: "rr_1", session: "review_session_x", ifc_guid: "g1" });
    expect(hash.startsWith("#review?")).toBe(true);
    const p = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    expect(p.get("source")).toBe("a1");
    expect(p.get("rule_run_id")).toBe("rr_1");
    expect(p.get("session")).toBe("review_session_x");
    expect(p.get("ifc_guid")).toBe("g1");
    expect(p.get("usd_prim_path")).toBeNull(); // omitted keys are absent, not empty
  });

  it("round-trips a real Chinese minio_key (OQ4 deterministic spike)", () => {
    const key = "270專案/建築/v07/模型.ifc";
    const hash = buildHandoff("conv", { source: "minio", minio_key: key });
    expect(hash).toContain("source=minio");
    const parsed = parseHandoff(hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(key); // decode must reproduce the exact key
  });

  it("parseHandoff returns null when there is no source", () => {
    expect(parseHandoff("#minio")).toBeNull();
    expect(parseHandoff("#minio?foo=bar")).toBeNull();
    expect(parseHandoff("")).toBeNull();
  });

  it("parseHandoff rejects an unknown source axis", () => {
    expect(parseHandoff("#a1?source=bogus&minio_key=x")).toBeNull();
    expect(isAxisKey("bogus")).toBe(false);
    expect(isAxisKey("sessions")).toBe(true);
  });

  // A3-G1：federation→session 一鍵鏈的發射端身分 "a3" 為合法 source（#federation 建立 session 後
  // 發 #sessions chip；SS 接收端向 runtime/status 重驗 session id）。
  it("accepts 'a3' as a source axis and round-trips a #sessions chip", () => {
    expect(isAxisKey("a3")).toBe(true);
    const hash = buildHandoff("sessions", { source: "a3", session: "review_session_fed" });
    expect(hash.startsWith("#sessions?")).toBe(true);
    const parsed = parseHandoff(hash);
    expect(parsed?.source).toBe("a3");
    expect(parsed?.session).toBe("review_session_fed");
  });
});
