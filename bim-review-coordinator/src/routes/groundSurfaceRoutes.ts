import type { Express, Request, RequestHandler, Response } from "express";
import { groundCatalog, groundCatalogRequest, groundConfirmRequest, groundPreview, groundPreviewRequest,
  groundSelectionId } from "../contract/schemas/groundSurfaces.js";
import type { ArtifactBinding } from "../types.js";
import type { SessionStore } from "../services/sessionStore.js";
import type { ActiveStageBindingResult } from "../services/runtimeMutationAuthority/runtimeMutationAuthority.js";
import type { GroundSelectionLedger } from "../services/groundSelectionLedger.js";
import { groundSampleRequest, groundSamplePlan } from "../contract/schemas/groundSamples.js";
import { groundAssessmentRequest, groundAssessmentUpstream, groundAssessmentReport } from "../contract/schemas/groundAssessment.js";

export interface GroundAccess {
  principal: string; conversionJobId: string; primary: ArtifactBinding; binding: ActiveStageBindingResult;
}
export interface GroundSurfaceRoutesOptions {
  store: SessionStore;
  rejectIfUnauthorized(request: Request, response: Response): boolean;
  access(request: Request): GroundAccess | null;
  upstream(conversion: string, action: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  publicArtifactsUrl: string;
  ledger: GroundSelectionLedger;
  runConversion(runId: string): string | null;
}

export function registerGroundSurfaceRoutes(app: Express, options: GroundSurfaceRoutesOptions): void {
  const error = (response: Response, status: number, code: string) => { response.status(status).json({ error_code: code, detail: code }); };
  const route = (handler: (request: Request, response: Response, access: GroundAccess) => Promise<void>): RequestHandler =>
    (request, response, next) => {
      response.set("Cache-Control", "no-store");
      if (options.rejectIfUnauthorized(request, response)) return;
      Promise.resolve().then(async () => {
        const access = options.access(request);
        if (!access) { error(response, 409, "ground_active_primary_required"); return; }
        await handler(request, response, access);
      }).catch(next);
    };
  const stillCurrent = (request: Request, prior: GroundAccess): GroundAccess | null => {
    const fresh = options.access(request);
    return fresh && fresh.principal === prior.principal && fresh.conversionJobId === prior.conversionJobId
      && fresh.primary.artifact_id === prior.primary.artifact_id && fresh.primary.url === prior.primary.url
      && fresh.binding.leaseId === prior.binding.leaseId ? fresh : null;
  };
  const call = async (response: Response, access: GroundAccess, action: string, body?: unknown) => {
    try {
      const reply = await options.upstream(access.conversionJobId, action, body);
      if (reply.status !== 200) { error(response, [400, 404, 409, 413, 429, 503].includes(reply.status) ? reply.status : 502, "ground_upstream_rejected"); return null; }
      return reply.body;
    } catch { error(response, 502, "ground_upstream_unavailable"); return null; }
  };
  const path = "/api/review-sessions/:sessionId/ground-surfaces";
  app.post(`${path}/selections/:selectionId/engineering-assessment`, route(async (request, response, access) => {
    const id = groundSelectionId.safeParse(request.params.selectionId), input = groundAssessmentRequest.safeParse(request.body);
    if (!id.success || !input.success) { error(response, 400, "invalid_request"); return; }
    const saved = options.ledger.get(id.data);
    if (!saved) { error(response, 404, "ground_version_not_found"); return; }
    const runConversion = options.runConversion(input.data.source_run_id);
    if (!runConversion) { error(response, 404, "ground_run_not_found"); return; }
    if (saved.conversion_job_id !== access.conversionJobId || runConversion !== access.conversionJobId) {
      error(response, 409, "ground_version_source_mismatch"); return;
    }
    const authority = (value: GroundAccess) => JSON.stringify([value.principal, value.conversionJobId,
      value.primary.artifact_id, value.primary.url, value.binding.leaseId, value.binding.sourceClientId, value.binding.bindingRevisionId]);
    const before = authority(access), savedBefore = JSON.stringify(saved);
    const body = await call(response, access, `selections/${id.data}/engineering-assessment`, input.data);
    if (body === null) return;
    const result = groundAssessmentUpstream.safeParse(body);
    if (!result.success) { error(response, 502, "ground_invalid_upstream"); return; }
    const report = result.data;
    const faces = saved.faces.map(face => ({ face_id: face.face_id, geometry_sha256: face.geometry_sha256 })).sort((a, b) => a.face_id.localeCompare(b.face_id));
    const heights = saved.faces.flatMap(face => face.vertices_m.map(vertex => vertex[2]));
    const range = [Math.min(...heights), Math.max(...heights)];
    if (report.selection_id !== saved.selection_id || report.selection_sha256 !== saved.selection_sha256
        || report.conversion_job_id !== saved.conversion_job_id || report.model_usdc_sha256 !== saved.model_usdc_sha256
        || report.source_run_id !== input.data.source_run_id || report.wind_from_degrees !== input.data.wind_from_degrees
        || JSON.stringify(report.selected_source_faces) !== JSON.stringify(faces)
        || JSON.stringify(report.selected_surface_z_range_m) !== JSON.stringify(range)) {
      error(response, 409, "ground_version_source_mismatch"); return;
    }
    const fresh = options.access(request), version = options.ledger.get(id.data);
    if (!fresh || authority(fresh) !== before || JSON.stringify(version) !== savedBefore
        || options.runConversion(input.data.source_run_id) !== runConversion) { error(response, 409, "ground_source_changed"); return; }
    response.json(groundAssessmentReport.parse({ ...report,
      checks: { ...report.checks, selection_ledger_verified: true },
      reasons: report.reasons.filter(code => code !== "selection_ledger_not_checked") }));
  }));
  app.post(`${path}/selections/:selectionId/sample-points`, route(async (request, response, access) => {
    const id = groundSelectionId.safeParse(request.params.selectionId), input = groundSampleRequest.safeParse(request.body);
    if (!id.success || !input.success) { error(response, 400, "invalid_request"); return; }
    const saved = options.ledger.get(id.data);
    if (!saved) { error(response, 404, "ground_version_not_found"); return; }
    if (saved.conversion_job_id !== access.conversionJobId) { error(response, 409, "ground_version_source_mismatch"); return; }
    const authority = (value: GroundAccess) => JSON.stringify([value.principal, value.conversionJobId,
      value.primary.artifact_id, value.primary.url, value.binding.leaseId, value.binding.sourceClientId, value.binding.bindingRevisionId]);
    // Copy pure values before await, including potentially mutable primary objects.
    const before = authority(access), savedBefore = JSON.stringify(saved);
    const body = await call(response, access, `selections/${id.data}/sample-points`, input.data);
    if (body === null) return;
    const result = groundSamplePlan.safeParse(body);
    if (!result.success) { error(response, 502, "ground_invalid_upstream"); return; }
    const plan = result.data;
    const [xmin, ymin, xmax, ymax] = input.data.bounds_m, step = input.data.spacing_m;
    const expectedXY: number[][] = [];
    for (let j = 0; j <= Math.floor((ymax - ymin) / step); j++) {
      const y = ymin + j * step;
      for (let i = 0; i <= Math.floor((xmax - xmin) / step); i++) {
        const x = xmin + i * step;
        if (x <= xmax && y <= ymax) expectedXY.push([x, y]);
      }
    }
    if (expectedXY.length !== plan.points.length || plan.points.some((point, index) => point.xy_m[0] !== expectedXY[index][0] || point.xy_m[1] !== expectedXY[index][1])) {
      error(response, 502, "ground_invalid_upstream"); return;
    }
    const expectedFaces = saved.faces.map(face => ({ face_id: face.face_id, geometry_sha256: face.geometry_sha256 })).sort((a, b) => a.face_id.localeCompare(b.face_id));
    if (plan.selection_id !== saved.selection_id || plan.selection_sha256 !== saved.selection_sha256
        || plan.conversion_job_id !== saved.conversion_job_id || plan.model_usdc_sha256 !== saved.model_usdc_sha256
        || JSON.stringify(plan.source_faces) !== JSON.stringify(expectedFaces)
        || JSON.stringify(plan.bounds_m) !== JSON.stringify(input.data.bounds_m) || plan.spacing_m !== input.data.spacing_m) {
      error(response, 409, "ground_version_source_mismatch"); return;
    }
    const fresh = options.access(request), version = options.ledger.get(id.data);
    if (!fresh || authority(fresh) !== before || JSON.stringify(version) !== savedBefore) { error(response, 409, "ground_source_changed"); return; }
    response.json(plan);
  }));
  app.post(`${path}/catalog`, route(async (request, response, access) => {
    const parsed = groundCatalogRequest.safeParse(request.body);
    if (!parsed.success) { error(response, 400, "invalid_request"); return; }
    const body = await call(response, access, "catalog", parsed.data);
    if (body === null) return;
    const result = groundCatalog.safeParse(body);
    if (!result.success || result.data.conversion_job_id !== access.conversionJobId) { error(response, 502, "ground_invalid_upstream"); return; }
    if (!stillCurrent(request, access)) { error(response, 409, "ground_source_changed"); return; }
    response.json(result.data);
  }));
  app.post(`${path}/previews`, route(async (request, response, access) => {
    const parsed = groundPreviewRequest.safeParse(request.body);
    if (!parsed.success) { error(response, 400, "invalid_request"); return; }
    const body = await call(response, access, "previews", parsed.data);
    if (body === null) return;
    const result = groundPreview.safeParse(body);
    if (!result.success || result.data.conversion_job_id !== access.conversionJobId
      || result.data.model_usdc_sha256 !== parsed.data.model_usdc_sha256) { error(response, 502, "ground_invalid_upstream"); return; }
    const fresh = stillCurrent(request, access);
    if (!fresh) { error(response, 409, "ground_source_changed"); return; }
    const session = options.store.get(String(request.params.sessionId));
    if (!session) { error(response, 404, "session_not_found"); return; }
    const base = options.publicArtifactsUrl.replace(/\/+$/, "").replace(/\/artifacts$/, "");
    const preview = result.data;
    const binding: ArtifactBinding = { ...fresh.primary, binding_id: `binding_${preview.artifact_id}`,
      artifact_id: preview.artifact_id, artifact_role: "overlay", mapping_url: null, load_order: 1,
      display_name: `明選原面預覽：${preview.region_name}（非 CFD 結果）`,
      url: `${base}/ground-artifacts/${preview.selection_id}/preview.usda` };
    options.store.update(session.session_id, { artifact_bindings: [
      ...session.artifact_bindings.filter(item => !item.artifact_id.startsWith("artifact_ground_")), binding] });
    response.json({ session_id: session.session_id, primary_artifact_id: fresh.primary.artifact_id, preview });
  }));
  app.post(`${path}/selections/:selectionId`, route(async (request, response, access) => {
    const input = groundConfirmRequest.safeParse(request.body), id = groundSelectionId.safeParse(request.params.selectionId);
    if (!input.success || !id.success) { error(response, 400, "invalid_request"); return; }
    const artifactId = `artifact_${id.data}`;
    if (access.binding.bindingRevisionId !== input.data.binding_revision_id
      || !access.binding.composition.secondaryLayers.some(item => item.artifactId === artifactId)) {
      error(response, 409, "ground_preview_not_confirmed"); return;
    }
    const body = await call(response, access, `selections/${id.data}`);
    if (body === null) return;
    const fresh = stillCurrent(request, access);
    if (!fresh || fresh.binding.bindingRevisionId !== input.data.binding_revision_id) { error(response, 409, "ground_source_changed"); return; }
    const result = groundPreview.safeParse(body);
    if (!result.success || result.data.selection_id !== id.data || result.data.conversion_job_id !== access.conversionJobId) {
      error(response, 502, "ground_invalid_upstream"); return;
    }
    // No await between fresh authority check and immutable provenance commit.
    response.json(options.ledger.save({ ...result.data, schema: "ground-selection-version/v1", selection_confirmed_by_user: true,
      confirmation: { principal: fresh.principal, session_id: String(request.params.sessionId), binding_revision_id: input.data.binding_revision_id } }));
  }));
  app.get(`${path}/selections/:selectionId`, route(async (request, response, access) => {
    const id = groundSelectionId.safeParse(request.params.selectionId);
    if (!id.success) { error(response, 400, "invalid_request"); return; }
    const saved = options.ledger.get(id.data);
    if (!saved) { error(response, 404, "ground_version_not_found"); return; }
    const body = await call(response, access, `selections/${id.data}`);
    if (body === null) return;
    const result = groundPreview.safeParse(body);
    if (!result.success || result.data.selection_id !== id.data || result.data.conversion_job_id !== access.conversionJobId) {
      error(response, 502, "ground_invalid_upstream"); return;
    }
    if (!stillCurrent(request, access)) { error(response, 409, "ground_source_changed"); return; }
    if (result.data.selection_sha256 !== saved.selection_sha256 || result.data.model_usdc_sha256 !== saved.model_usdc_sha256
      || JSON.stringify(result.data.faces) !== JSON.stringify(saved.faces)) { error(response, 409, "ground_version_source_mismatch"); return; }
    response.json(saved);
  }));
}
