import type { Express, Request, Response } from "express";
import type { ConversionLedger } from "../services/conversionLedger.js";
import { projectValidationReport, serializeValidationReportCsv } from "../services/conversionValidationReportProjection.js";
import { serializeValidationReportPdf } from "../services/conversionValidationReportPdf.js";
import { ReportAccessError, reportSourceAllowed, resolveValidationReportAccess,
  type ValidationReportAccess, type ValidationReportDecision } from "../services/validationReportAccess.js";

function pagination(request: Request): { offset: number; limit: number } | null {
  const offset = request.query.offset ?? "0", limit = request.query.limit ?? "50";
  const integer = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
  return integer(offset) && integer(limit) && Number.isSafeInteger(Number(offset)) &&
    Number(limit) >= 1 && Number(limit) <= 100 && Object.keys(request.query).every(k => k === "offset" || k === "limit")
    ? { offset: Number(offset), limit: Number(limit) } : null;
}
function page<T>(items: T[], query: {offset: number; limit: number}) {
  const selected = items.slice(query.offset, query.offset + query.limit);
  return { items: selected, total: items.length,
    nextOffset: query.offset + selected.length < items.length ? query.offset + selected.length : null };
}
function stillAuthorized(access: ValidationReportDecision) {
  if (Date.parse(access.expiresAt) <= Date.now()) throw new ReportAccessError(403);
}

export function registerConversionValidationReports(app: Express, dependencies: {
  ledger: Pick<ConversionLedger, "listValidationRecords">;
  access?: ValidationReportAccess;
  localSupervisorPreview?: boolean;
}): void {
  const get = (path: string, handler: (request: Request, response: Response) => Promise<void>) => {
    app.get(path, (request, response) => {
      response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      void handler(request, response).catch(error => {
        if (response.headersSent || response.destroyed) return;
        response.status(error instanceof ReportAccessError ? error.status : 503).json({
          detail: error instanceof ReportAccessError ? error.message : "Report temporarily unavailable.",
        });
      });
    });
  };
  // This source-scoped catalog does not use the legacy, unprotected conversion list.
  get("/api/conversion/validation-models", async (request, response) => {
    const query = pagination(request);
    if (!query) { response.status(400).json({ detail: "Invalid report request." }); return; }
    const access = await resolveValidationReportAccess(dependencies.access, request, { format: "models" }, dependencies.localSupervisorPreview);
    const items = [...new Set(access.sources.map(source => source.readyModelId))].flatMap(readyModelId => {
      const records = dependencies.ledger.listValidationRecords(readyModelId)
        .filter(record => reportSourceAllowed(access, record))
        .sort((a, b) => Date.parse(b.validatedAt) - Date.parse(a.validatedAt) || a.recordId.localeCompare(b.recordId));
      if (!records.length) return [];
      const dto = projectValidationReport(records[0]);
      return [{ readyModelId, sourceName: dto.source.name, modelVersionId: dto.modelVersionId }];
    }).sort((a, b) => a.readyModelId.localeCompare(b.readyModelId));
    stillAuthorized(access);
    response.json({ ...page(items, query), ...(access.actorKind === "local_supervisor_preview"
      ? { accessMode: "local-supervisor-preview" } : {}) });
  });
  get("/api/conversion/records/:readyModelId/validations", async (request, response) => {
    const query = pagination(request), readyModelId = request.params.readyModelId;
    if (!query || typeof readyModelId !== "string" || !readyModelId || readyModelId.length > 2048) {
      response.status(400).json({ detail: "Invalid report request." }); return;
    }
    const access = await resolveValidationReportAccess(dependencies.access, request, { readyModelId, format: "history" }, dependencies.localSupervisorPreview);
    // Authenticate first; avoid consulting any record outside the allowed ready identities.
    const records = access.sources.some(source => source.readyModelId === readyModelId)
      ? dependencies.ledger.listValidationRecords(readyModelId).filter(record => reportSourceAllowed(access, record)) : [];
    records.sort((a, b) => Date.parse(b.validatedAt) - Date.parse(a.validatedAt) || a.recordId.localeCompare(b.recordId));
    const items = records.map(record => {
      const dto = projectValidationReport(record);
      return { recordId: dto.recordId, readyModelId: dto.readyModelId, modelVersionId: dto.modelVersionId,
        sourceName: dto.source.name, validatedAt: dto.validatedAt };
    });
    stillAuthorized(access);
    response.json(page(items, query));
  });
  get("/api/conversion/records/:readyModelId/validations/:recordId", async (request, response) => {
    const { readyModelId, recordId } = request.params;
    const format = request.query.format ?? "json";
    if (typeof readyModelId !== "string" || !readyModelId || readyModelId.length > 2048 ||
        typeof recordId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(recordId) ||
        !["json", "csv", "pdf"].includes(String(format)) || typeof format !== "string" ||
        Object.keys(request.query).some(key => key !== "format")) {
      response.status(400).json({ detail: "Invalid report request." }); return;
    }
    const access = await resolveValidationReportAccess(dependencies.access, request,
      { readyModelId, recordId, format: format as "json" | "csv" | "pdf" }, dependencies.localSupervisorPreview);
    const record = access.sources.some(source => source.readyModelId === readyModelId)
      ? dependencies.ledger.listValidationRecords(readyModelId).find(item => item.recordId === recordId && reportSourceAllowed(access, item))
      : undefined;
    // Same response for an absent record and an existing record outside this source grant.
    if (!record) { response.status(404).json({ detail: "Report not found." }); return; }
    const dto = projectValidationReport(record);
    if (format === "pdf") {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      response.once("close", cancel);
      try {
        const bytes = await serializeValidationReportPdf(dto, controller.signal);
        stillAuthorized(access);
        if (!response.destroyed) response.set({ "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${recordId}.pdf"` }).send(bytes);
      } finally { response.off("close", cancel); }
    } else {
      stillAuthorized(access);
      if (format === "csv") response.set({ "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${recordId}.csv"` }).send(serializeValidationReportCsv(dto));
      else response.json(dto);
    }
  });
}
