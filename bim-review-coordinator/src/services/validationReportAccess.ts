import type { Request } from "express";
import { z } from "zod";

const opaque = z.string().min(1).max(2048);
const source = z.object({
  tenantId: opaque, projectId: opaque, modelVersionId: opaque,
  readyModelId: opaque, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const decision = z.object({
  subject: opaque, actorKind: z.enum(["operator", "local_supervisor_preview"]),
  expiresAt: z.string().datetime({ offset: true }),
  sources: z.array(source).max(1000),
}).strict();

export type ValidationReportSource = z.infer<typeof source>;
export type ValidationReportDecision = z.infer<typeof decision>;
export interface ValidationReportTarget {
  readyModelId?: string;
  recordId?: string;
  format: "models" | "history" | "json" | "csv" | "pdf";
}

/** Trusted deployment composition only. The adapter must authenticate the operator and
 * obtain current source-read grants from the external authority for this exact request.
 * This is an internal port, not a proposed SSO wire protocol. No local-dev, viewer lease,
 * internal service token, request roles or client-supplied source tuples imply a grant.
 * The explicitly enabled local preview is a separate actor kind, never an SSO identity.
 */
export type ValidationReportAccess = (
  request: Request, target: ValidationReportTarget, signal: AbortSignal,
) => Promise<ValidationReportDecision | null>;

export class ReportAccessError extends Error {
  constructor(readonly status: 403 | 503) {
    super(status === 403 ? "Report access denied." : "Report authorization unavailable.");
  }
}

export async function resolveValidationReportAccess(
  access: ValidationReportAccess | undefined, request: Request, target: ValidationReportTarget,
  allowLocalSupervisorPreview = false,
): Promise<ValidationReportDecision> {
  if (!access) throw new ReportAccessError(503);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new ReportAccessError(503)); }, 5000);
    });
    const value = await Promise.race([access(request, target, controller.signal), timeout]);
    if (value === null) throw new ReportAccessError(403);
    const parsed = decision.safeParse(value);
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) throw new ReportAccessError(403);
    if (parsed.data.actorKind === "local_supervisor_preview" && !allowLocalSupervisorPreview) throw new ReportAccessError(403);
    return parsed.data;
  } catch (error) {
    if (error instanceof ReportAccessError) throw error;
    throw new ReportAccessError(503);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function reportSourceAllowed(
  access: ValidationReportDecision,
  record: Omit<ValidationReportSource, "sourceSha256"> & { source: { sha256: string } },
): boolean {
  return access.sources.some(grant => grant.tenantId === record.tenantId &&
    grant.projectId === record.projectId && grant.modelVersionId === record.modelVersionId &&
    grant.readyModelId === record.readyModelId && grant.sourceSha256 === record.source.sha256);
}
