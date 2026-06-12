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

  it("prefix 非空且不以 '/' 結尾 → ok=false（避免靜默截斷 projectId）", () => {
    // 防 IMPORTANT #2：prefix='89' 對上 key='899/xxx/model.ifc' 不可被當成命中後切出 projectId='9'
    const r = deriveIntakeFromKey({ key: "899/xxx/model.ifc", prefix: "89", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("有效 prefix 但 key 不在 prefix 下（startsWith 失敗）→ ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "tenant_b/899/xxx/model.ifc", prefix: "tenant_a/", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("key 不以 keySuffix 結尾（過濾無關 object）→ ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "899/xxx/model.usdc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("suffix");
  });

  it("雙斜線 key（899//xxx/model.ifc）不可被 filter(Boolean) 靜默正規化成合法兩層", () => {
    // 防 IMPORTANT #1：S3/MinIO 允許 '899//xxx/model.ifc' 為獨立 key（與 '899/xxx/model.ifc' 不同），
    // 空 segment 必須判定非恰兩層 → ok=false，不可被當成 projectId='899'/modelId='xxx' 重複觸發
    const r = deriveIntakeFromKey({ key: "899//xxx/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("兩層");
  });

  it("結尾雙斜線 key（899/xxx//model.ifc）含空 segment → ok=false", () => {
    const r = deriveIntakeFromKey({ key: "899/xxx//model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
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
