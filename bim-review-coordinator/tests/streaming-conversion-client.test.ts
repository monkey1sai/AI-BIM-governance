import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  sanitizeArtifactIdPart,
  toInternalIfcReadyEvent,
} from "../src/services/streamingConversionClient.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

const EVENT: ExternalIfcReadyEvent = {
  event: "ifc_ready",
  event_id: "evt_identity_profile",
  tenant_id: "tenant_identity",
  project_id: "project_identity",
  external_model_version_id: "ext_mv_identity",
  source_ifc: {
    ref: "file:///shared/model.ifc",
    etag: "etag_identity",
    filename: "model.ifc",
    format: "ifc",
  },
};

describe("toInternalIfcReadyEvent", () => {
  it("omits conversion_profile unless the coordinator binding opts in", () => {
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_identity",
      externalModelVersionId: EVENT.external_model_version_id,
    });

    expect(payload).not.toHaveProperty("conversion_profile");
  });

  it("passes the internal identity conversion profile when explicitly bound", () => {
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_identity",
      externalModelVersionId: EVENT.external_model_version_id,
      conversionProfile: "ifcopenshell_openusd_identity",
    });

    expect(payload.conversion_profile).toBe("ifcopenshell_openusd_identity");
  });

  it("中文 external id → payload.ifc_artifact.artifact_id 走 sanitize 且通過 SAFE_ID_RE", () => {
    const payload = toInternalIfcReadyEvent(
      { ...EVENT, external_model_version_id: "271_pieple_管線" },
      { correlationId: "corr_cjk", externalModelVersionId: "271_pieple_管線" },
    );
    const artifact = payload.ifc_artifact as { artifact_id: string };
    expect(artifact.artifact_id).toMatch(/^ifc_[A-Za-z0-9_.-]+$/);
    expect(artifact.artifact_id).toContain("ifc_271_pieple_");
  });

  it("純英文 external id → payload.ifc_artifact.artifact_id 與舊版完全相同（回歸鎖）", () => {
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_identity",
      externalModelVersionId: EVENT.external_model_version_id,
    });
    const artifact = payload.ifc_artifact as { artifact_id: string };
    expect(artifact.artifact_id).toBe(`ifc_${EVENT.external_model_version_id}`);
  });

  // rl1（對抗複驗回歸鎖補強）：修後 model_version_id / correlation_id / tenant_id /
  // project_id / event_id 全過 sanitize。純 safe（全英文/數字）輸入時，sanitize 必須
  // 是 identity——逐欄 === 原始值，鎖住「英文路徑零行為變化」性質，防未來 sanitize
  // 規則改動（例如改成總是加 hash 後綴）悄悄回歸英文 id 的輸出。
  it("全 safe 輸入 → 內部 identity 欄位逐欄 === 原始值（鎖 sanitize identity 性質）", () => {
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: "corr_identity",
      externalModelVersionId: EVENT.external_model_version_id,
    });
    // 含 ifc_ 前綴的 artifact_id（前綴外的片段 === 原始 external id）。
    expect((payload.ifc_artifact as { artifact_id: string }).artifact_id).toBe(
      `ifc_${EVENT.external_model_version_id}`,
    );
    expect(payload.model_version_id).toBe(EVENT.external_model_version_id);
    expect(payload.correlation_id).toBe("corr_identity");
    expect(payload.tenant_id).toBe(EVENT.tenant_id);
    expect(payload.project_id).toBe(EVENT.project_id);
    // event_id 外部已帶（safe）→ 原樣（sanitize identity），非 fallback 形。
    expect(payload.event_id).toBe(EVENT.event_id);
  });

  // mv1（指揮官實證根治缺口）：conversion_authority.py:264 對 model_version_id 也跑
  // _safe_id（SAFE_ID_RE），中文 model_version_id 即使 artifact_id 已 sanitize 仍 400。
  it("中文 external id → payload.model_version_id 走 sanitize（通過 SAFE_ID_RE），external_model_version_id 保留原始", () => {
    const raw = "271_pieple_管線";
    const payload = toInternalIfcReadyEvent(
      { ...EVENT, external_model_version_id: raw },
      { correlationId: "corr_cjk", externalModelVersionId: raw },
    );
    const SAFE = /^[A-Za-z0-9_.-]+$/;
    // 內部欄位 sanitize 後通過 conversion 端 SAFE_ID_RE。
    expect(SAFE.test(payload.model_version_id as string)).toBe(true);
    const hash8 = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
    expect(payload.model_version_id).toBe(`271_pieple__${hash8}`);
    // 對帳用 external_model_version_id 欄位保留原始中文，不受 sanitize 影響。
    expect(payload.external_model_version_id).toBe(raw);
  });

  // mv2（指揮官審計）：conversion_authority.py:261 對 correlation_id 也跑 _safe_id；
  // worker 派生 correlation_id 含冒號（worker:project::version::task），不在 SAFE_ID_RE。
  it("含冒號的 worker 派生 correlation_id → payload.correlation_id 走 sanitize（通過 SAFE_ID_RE）", () => {
    const rawCorr = "worker:899::xxx::task_001";
    const payload = toInternalIfcReadyEvent(EVENT, {
      correlationId: rawCorr,
      externalModelVersionId: EVENT.external_model_version_id,
    });
    const SAFE = /^[A-Za-z0-9_.-]+$/;
    expect(SAFE.test(payload.correlation_id as string)).toBe(true);
  });
});

const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/; // = conversion_authority.py SAFE_ID_RE，逐字鎖規則

describe("sanitizeArtifactIdPart", () => {
  it("純 safe 字元的 id 原樣回傳（向後相容，零行為變化）", () => {
    expect(sanitizeArtifactIdPart("ext_mv_identity")).toBe("ext_mv_identity");
    expect(sanitizeArtifactIdPart("271_pieple-A.1")).toBe("271_pieple-A.1");
  });

  it("含中文的 id → safe 前綴 + sha256 前 8 碼，且整體（含 ifc_ 前綴）通過 SAFE_ID_RE", () => {
    const out = sanitizeArtifactIdPart("271_pieple_管線");
    const hash8 = crypto.createHash("sha256").update("271_pieple_管線").digest("hex").slice(0, 8);
    expect(out).toBe(`271_pieple__${hash8}`);
    expect(SAFE_ID_RE.test(`ifc_${out}`)).toBe(true);
  });

  it("確定性：同一 raw 兩次呼叫輸出相同", () => {
    expect(sanitizeArtifactIdPart("271_pieple_管線")).toBe(sanitizeArtifactIdPart("271_pieple_管線"));
  });

  it("不碰撞：兩個不同中文 id 輸出不同", () => {
    expect(sanitizeArtifactIdPart("271_pieple_管線")).not.toBe(sanitizeArtifactIdPart("271_pieple_水管"));
  });

  it("全非 safe 字元 id → mv_<hash8> 退化形", () => {
    const out = sanitizeArtifactIdPart("管線水電消防");
    const hash8 = crypto.createHash("sha256").update("管線水電消防").digest("hex").slice(0, 8);
    expect(out).toBe(`mv_${hash8}`);
    expect(SAFE_ID_RE.test(`ifc_${out}`)).toBe(true);
  });
});
