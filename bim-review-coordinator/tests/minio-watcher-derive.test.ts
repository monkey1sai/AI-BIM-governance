import { describe, expect, it } from "vitest";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "../src/services/minioWatcher.js";

describe("minioWatcher 純函式導出", () => {
  it("恰兩層 key（去 prefix 後 projectId/modelId/model.ifc）導出正確 intake 欄位", () => {
    const r = deriveIntakeFromKey({
      key: "899/xxx/model.ifc",
      prefix: "",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.externalModelVersionId).toBe("xxx");
  });

  it("帶 prefix 時先去 prefix 再解析層級", () => {
    const r = deriveIntakeFromKey({
      key: "tenant_a/899/xxx/model.ifc",
      prefix: "tenant_a/",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.externalModelVersionId).toBe("xxx");
  });

  it("層級不符（去 prefix/suffix 後非恰兩層）→ ok=false 帶 reason", () => {
    const tooDeep = deriveIntakeFromKey({ key: "a/899/xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(tooDeep.ok).toBe(false);
    const tooShallow = deriveIntakeFromKey({ key: "xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(tooShallow.ok).toBe(false);
  });

  it("idempotency key 為 bucket|key|etag 的確定性 sha256 前 16 hex，帶 mw_ 前綴", () => {
    const a = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    const b = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    const c = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", '"DIFFERENT"');
    expect(a).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(a).toBe(b); // 確定性
    expect(a).not.toBe(c); // etag 變則 key 變
  });

  it("correlation id 為 minio-watch-<hash8>，hash 由 bucket|key|etag 導出", () => {
    const a = correlationIdFor("bim-control", "899/xxx/model.ifc", '"abc123"');
    expect(a).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(correlationIdFor("bim-control", "899/xxx/model.ifc", '"abc123"')).toBe(a);
  });

  it("etag 去外層引號後納入 source_ifc.etag（不重複加引號）", () => {
    const r = deriveIntakeFromKey({ key: "899/xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceEtagFrom('"abc123"')).toBe("abc123");
    expect(r.sourceEtagFrom("abc123")).toBe("abc123");
  });
});
