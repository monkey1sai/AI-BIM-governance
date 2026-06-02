import { describe, expect, it } from "vitest";
import { toInternalIfcReadyEvent } from "../src/services/streamingConversionClient.js";
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
});
