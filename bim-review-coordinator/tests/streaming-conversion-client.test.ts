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
