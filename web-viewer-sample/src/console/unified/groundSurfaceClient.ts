import type { components } from "../../generated/coordinator-api";
import { coordinatorUrl } from "../coordinatorClient";

export type GroundCatalog = components["schemas"]["GroundFaceCatalog"];
export type GroundFace = GroundCatalog["faces"][number];
export type GroundPreview = components["schemas"]["GroundPreviewRegistration"];
export type GroundVersion = components["schemas"]["GroundSelectionVersion"];
export interface GroundSurfaceClient {
  catalog(session: string, component: string, cursor?: string | null): Promise<GroundCatalog>;
  preview(session: string, region: string, sourceSha: string, faces: GroundFace[]): Promise<GroundPreview>;
  confirm(session: string, selection: string, revision: string): Promise<GroundVersion>;
  saved(session: string, selection: string): Promise<GroundVersion>;
}

interface GroundLeaseAuthority { sessionId: string; sourceClientId: string; leaseToken: string; userToken: string }

/** The owning pane supplies a private closure; no credential getter reaches the panel. */
export function createGroundSurfaceClient(authority: () => GroundLeaseAuthority | null): GroundSurfaceClient {
async function call<T>(session: string, action: string, body?: unknown): Promise<T> {
  const current = authority();
  if (!current || current.sessionId !== session) throw new Error("ground_primary_lease_required");
  const response = await fetch(coordinatorUrl(`/api/review-sessions/${encodeURIComponent(session)}/ground-surfaces/${action}`), {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json", "X-User-Token": current.userToken,
      "X-Viewer-Lease-Token": current.leaseToken, "X-Viewer-Source-Client-Id": current.sourceClientId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error_code === "string" ? result.error_code : `ground_http_${response.status}`);
  return result as T;
}

return {
  catalog: (session, component, cursor) => call(session, "catalog", { component_path: component, cursor: cursor ?? null }),
  preview: (session, region, sourceSha, faces) => call(session, "previews", { region_name: region, model_usdc_sha256: sourceSha,
    faces: faces.map(face => ({ ifc_guid: face.ifc_guid, mesh_prim_path: face.mesh_prim_path,
      polygon_face_index: face.polygon_face_index, face_id: face.face_id })) }),
  confirm: (session, selection, revision) => call(session, `selections/${encodeURIComponent(selection)}`, { binding_revision_id: revision }),
  saved: (session, selection) => call(session, `selections/${encodeURIComponent(selection)}`),
};
}
