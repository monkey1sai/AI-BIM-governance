import { coordinatorUrl } from "../coordinatorClient";
export type Purpose = "view_3d" | "locate_highlight" | "distance_measurement" | "ifc_rules";
export interface Evaluation { purpose: Purpose; outcome: "usable" | "usable_with_limits" | "not_usable" | "not_validated"; policyId: string|null; policyVersion: string|null; reasonCodes:string[]; limitations:string[] }
export interface ValidationReport {
 schemaVersion:string;recordId:string;readyModelId:string;conversionJobId:string;tenantId:string;projectId:string;modelVersionId:string;
 source:{name:string;sha256:string};artifacts:{usdcSha256:string|null;mappingSha256:string|null};
 converterVersion:string|null;validatorVersion:string;validatedAt:string;
 inventory:{observation?:"not_run"|"observed";expectedRenderable:number|null;convertedRenderable:number|null;missing:{guid:string;reasonCodes:string[]}[];excluded:{guid:string;reason:string}[]};
 correspondence:{guid:string;primPaths:string[]}[]|null;
 purposes:{purpose:Purpose;policy:{id:string;version:string;requiredCheckIds:string[]}|null;checks:{id:string;state:string;reasonCodes:string[];limitations?:string[]}[]}[];
 evaluations:Evaluation[];
 sourceValidation?:{
   byClass:{ifcType:string;expected:number;converted:number|null}[];
   units:{ifcLengthScaleM:number|null;usdMetersPerUnit:number|null;upAxis:"Y"|"Z"|null};
   coordinateEvidence:{method:string;toleranceM:number;mappedCount:number;checkedCount:number;maxDeltaM:number|null;mismatchedGuids:string[];unavailableGuids:string[]}|null;
   scopes:{id:string;version:string;purpose:string;requiredGuidCount:number}[];
 };
}
export interface HistoryItem {recordId:string;readyModelId:string;modelVersionId:string;sourceName:string;validatedAt:string}
export interface ValidationHistory {items:HistoryItem[];total:number;nextOffset:number|null}
export interface ReportModel {readyModelId:string;sourceName:string;modelVersionId:string}
export interface ReportModels {items:ReportModel[];total:number;nextOffset:number|null;accessMode?:"local-supervisor-preview"}
export class ReportHttpError extends Error { constructor(readonly status:number) { super("Report request failed"); } }
async function read<T>(path: string, signal: AbortSignal | undefined, consume: (response: Response) => Promise<T>, accept: string): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), accept === "application/pdf" ? 65000 : 15000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(coordinatorUrl(path), {
      credentials: "same-origin", headers: { Accept: accept }, signal: controller.signal,
    });
    if (!response.ok) throw new ReportHttpError(response.status);
    const value = await consume(response);
    controller.signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
const base = (id: string) => "/api/conversion/records/" + encodeURIComponent(id) + "/validations";
export const validationReportClient = {
  getModels: (offset = 0, signal?: AbortSignal): Promise<ReportModels> =>
    read("/api/conversion/validation-models?offset=" + offset + "&limit=100", signal, r => r.json(), "application/json"),
  getHistory: (id: string, offset = 0, signal?: AbortSignal): Promise<ValidationHistory> =>
    read(base(id) + "?offset=" + offset + "&limit=50", signal, r => r.json(), "application/json"),
  getReport: (id: string, record: string, signal?: AbortSignal): Promise<ValidationReport> =>
    read(base(id) + "/" + encodeURIComponent(record), signal, r => r.json(), "application/json"),
  downloadCsv: (id: string, record: string, signal?: AbortSignal): Promise<Blob> =>
    read(base(id) + "/" + encodeURIComponent(record) + "?format=csv", signal, response => {
      if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "text/csv") throw new Error("Invalid CSV response");
      return response.blob();
    }, "text/csv"),
  downloadPdf: (id: string, record: string, signal?: AbortSignal): Promise<Blob> =>
    read(base(id) + "/" + encodeURIComponent(record) + "?format=pdf", signal, async response => {
      if (response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/pdf") {
        throw new Error("Invalid PDF response");
      }
      const blob = await response.blob();
      if (blob.size > 16 * 1024 * 1024 || await blob.slice(0, 5).text() !== "%PDF-") {
        throw new Error("Invalid PDF response");
      }
      return blob;
    }, "application/pdf"),
};
