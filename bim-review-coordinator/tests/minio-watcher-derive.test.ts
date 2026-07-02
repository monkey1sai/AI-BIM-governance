import { describe, expect, it } from "vitest";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "../src/services/minioWatcher.js";

describe("minioWatcher 純函式導出（≥3 段：專案/種類/版本）", () => {
  it("真實 4 層（含中文專案名）→ 安全 project_id、種類=倒數二、版本=末、保留中文顯示名", () => {
    const r = deriveIntakeFromKey({
      key: "東勢區許良宇紀念圖書館/root/main/181b3686-2263-4c53-93d9-ba95a010fc85/model.ifc",
      prefix: "",
      keySuffix: "/model.ifc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 純中文 → sanitizeArtifactIdPart 全非安全 → mv_<sha256[:8]>
    expect(r.projectId).toMatch(/^mv_[0-9a-f]{8}$/);
    expect(r.projectDisplayName).toBe("東勢區許良宇紀念圖書館"); // 原名如實保留
    expect(r.category).toBe("main"); // 倒數第二層
    expect(r.externalModelVersionId).toBe("181b3686-2263-4c53-93d9-ba95a010fc85"); // 末層
  });

  it("中文專案名導出確定性：同名 → 同 project_id（同專案不同版本歸一起）", () => {
    const a = deriveIntakeFromKey({ key: "中文專案/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    const b = deriveIntakeFromKey({ key: "中文專案/other/v2/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.projectId).toBe(b.projectId);
    expect(a.projectId).toMatch(/^mv_[0-9a-f]{8}$/);
  });

  it("英數安全專案名（899）→ project_id 原樣不動", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.category).toBe("main");
    expect(r.externalModelVersionId).toBe("v1");
  });

  it("恰 3 層（無動態中間層）合法：專案/種類/版本", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.category).toBe("main");
    expect(r.externalModelVersionId).toBe("v1");
  });

  it("key 含 '|' → ok:false（q3-pipe-guard：與 idempotencyKeyFor 的 bucket|key|etag 分隔符衝突，watcher 路徑一致拒收）", () => {
    // 回歸鎖（CodeRabbit Major）：自動 watcher（triggerIntake）經 deriveIntakeFromKey 進 intake,
    // 原缺 '|' 守衛 → 含 '|' 的壞 key 可能撞 idempotency hash 破壞 ledger 契約。listMinioObjects
    // /手動觸發端各自已擋,此處於共用 derivation 補上使三路一致。
    const r = deriveIntakeFromKey({ key: "proj|inject/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("|");
  });

  it("帶 prefix 時先去 prefix 再以 ≥3 段解析", () => {
    const r = deriveIntakeFromKey({ key: "tenant_a/899/main/v1/model.ifc", prefix: "tenant_a/", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projectId).toBe("899");
    expect(r.category).toBe("main");
    expect(r.externalModelVersionId).toBe("v1");
  });

  it("少於三段（2 段 / 1 段）→ ok=false 帶 reason", () => {
    const two = deriveIntakeFromKey({ key: "899/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toContain("三段");
    expect(deriveIntakeFromKey({ key: "v1/model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
  });

  it("純點段（路徑穿越形狀 ../.）→ ok=false（防 .. 原樣成為 project_id）", () => {
    expect(deriveIntakeFromKey({ key: "../main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
    expect(deriveIntakeFromKey({ key: "proj/./v1/model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
    expect(deriveIntakeFromKey({ key: "proj/main/../model.ifc", prefix: "", keySuffix: "/model.ifc" }).ok).toBe(false);
  });

  it("prefix 非空且不以 '/' 結尾 → ok=false（避免靜默截斷 projectId）", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "89", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("有效 prefix 但 key 不在 prefix 下 → ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "tenant_b/899/main/v1/model.ifc", prefix: "tenant_a/", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("prefix");
  });

  it("key 不以 keySuffix 結尾 → ok=false 帶 reason", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.usdc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("suffix");
  });

  it("含空段（雙斜線 899//main/v1/model.ifc）→ ok=false（不可被靜默正規化）", () => {
    const r = deriveIntakeFromKey({ key: "899//main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
  });

  it("結尾空段（899/main/v1//model.ifc）→ ok=false", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1//model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(false);
  });

  it("etag 去外層引號後納入 source_ifc.etag（不重複加引號）", () => {
    const r = deriveIntakeFromKey({ key: "899/main/v1/model.ifc", prefix: "", keySuffix: "/model.ifc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sourceEtagFrom('"abc123"')).toBe("abc123");
    expect(r.sourceEtagFrom("abc123")).toBe("abc123");
  });

  it("idempotency key 為 bucket|key|etag 的確定性 sha256 前 16 hex，帶 mw_ 前綴", () => {
    const a = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    const b = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    const c = idempotencyKeyFor("bim-control", "899/main/v1/model.ifc", '"DIFFERENT"');
    expect(a).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("correlation id 為 minio-watch-<hash8>，hash 由 bucket|key|etag 導出", () => {
    const a = correlationIdFor("bim-control", "899/main/v1/model.ifc", '"abc123"');
    expect(a).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(correlationIdFor("bim-control", "899/main/v1/model.ifc", '"abc123"')).toBe(a);
  });
});
