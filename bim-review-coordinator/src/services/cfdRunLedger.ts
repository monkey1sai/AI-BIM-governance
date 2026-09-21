// Coordinator-side CFD run ledger (cfd-run-ledger-record/v1).
//
// The streaming job store is the authority for a run; this ledger keeps the
// pointer + status projection the UI lists, persisted as one JSON file next to
// the other coordinator ledgers (tmp + rename, same as conversionLedger.ts).
import fs from "node:fs";
import path from "node:path";

export interface CfdRunLedgerRecord {
  schema: "cfd-run-ledger-record/v1";
  run_id: string;
  conversion_job_id: string;
  status: string;
  directions_total: number;
  directions_done: number;
  converged_count: number;
  sealing_suspect: boolean | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  requested_by_principal: string;
}

interface StatusLike {
  run_id?: unknown;
  status?: unknown;
  failure_code?: unknown;
  progress?: unknown;
  converged_count?: unknown;
  sealing_suspect?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  source?: unknown;
  requested_by?: unknown;
}

export class CfdRunLedger {
  private readonly records = new Map<string, CfdRunLedgerRecord>();

  constructor(private readonly persistencePath: string) {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8")) as { records?: CfdRunLedgerRecord[] };
      for (const record of parsed.records ?? []) {
        if (record && typeof record.run_id === "string") this.records.set(record.run_id, record);
      }
    } catch {
      // A corrupt ledger must not take the coordinator down; the streaming job
      // store remains the authority and the next upsert rewrites the file.
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ schema: "cfd-run-ledger/v1", records: this.list() }, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.persistencePath);
  }

  get(runId: string): CfdRunLedgerRecord | null {
    return this.records.get(runId) ?? null;
  }

  list(filter: { conversion_job_id?: string; status?: string; limit?: number } = {}): CfdRunLedgerRecord[] {
    const sorted = Array.from(this.records.values())
      .filter((record) => !filter.conversion_job_id || record.conversion_job_id === filter.conversion_job_id)
      .filter((record) => !filter.status || record.status === filter.status)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return filter.limit !== undefined && filter.limit > 0 ? sorted.slice(0, filter.limit) : sorted;
  }

  /** Project several status documents (one list refresh) and persist once. */
  upsertAllFromStatus(statuses: StatusLike[]): void {
    let changed = false;
    for (const status of statuses) {
      if (this.upsertFromStatus(status, {}, { persist: false })) changed = true;
    }
    if (changed) this.persist();
  }

  /** Project a streaming `cfd-run-status/v1` document into the ledger; returns the record. */
  upsertFromStatus(
    status: StatusLike,
    fallback: { principal?: string; conversion_job_id?: string } = {},
    options: { persist?: boolean } = {},
  ): CfdRunLedgerRecord | null {
    if (typeof status.run_id !== "string") return null;
    const existing = this.records.get(status.run_id);
    const progress = (status.progress ?? {}) as { directions_total?: unknown; directions_done?: unknown };
    const source = (status.source ?? {}) as { conversion_job_id?: unknown };
    const requestedBy = (status.requested_by ?? {}) as { principal?: unknown };
    const record: CfdRunLedgerRecord = {
      schema: "cfd-run-ledger-record/v1",
      run_id: status.run_id,
      conversion_job_id:
        typeof source.conversion_job_id === "string" ? source.conversion_job_id
          : existing?.conversion_job_id ?? fallback.conversion_job_id ?? "unknown",
      status: typeof status.status === "string" ? status.status : existing?.status ?? "queued",
      directions_total: asInt(progress.directions_total, existing?.directions_total ?? 1),
      directions_done: asInt(progress.directions_done, existing?.directions_done ?? 0),
      converged_count: asInt(status.converged_count, existing?.converged_count ?? 0),
      sealing_suspect: typeof status.sealing_suspect === "boolean" ? status.sealing_suspect : existing?.sealing_suspect ?? null,
      failure_code: typeof status.failure_code === "string" ? status.failure_code : null,
      created_at: typeof status.created_at === "string" ? status.created_at : existing?.created_at ?? new Date().toISOString(),
      updated_at: typeof status.updated_at === "string" ? status.updated_at : new Date().toISOString(),
      requested_by_principal:
        typeof requestedBy.principal === "string" ? requestedBy.principal
          : existing?.requested_by_principal ?? fallback.principal ?? "unknown",
    };
    this.records.set(record.run_id, record);
    if (options.persist !== false) this.persist();
    return record;
  }
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}
