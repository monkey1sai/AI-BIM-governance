/** Discrete solver samples, never an editable form or client animation clock. */
export interface CfdTemporal { mode: "urans_sampled"; sample_times_s: number[]; output_interval_s: number;
  requested_duration_s: number; complete_requested_duration: boolean }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function temporalOf(direction: unknown): CfdTemporal | null {
  if (!record(direction) || !record(direction.presentation)) return null;
  const { temporal: t, animation } = direction.presentation;
  if (!record(t) || !record(animation) || animation.mode !== "urans_sampled" || t.mode !== "urans_sampled"
    || t.fixed_geometry !== true || t.solver !== "pimpleFoam" || t.interpolation !== "sample_hold"
    || !Array.isArray(t.sample_times_s) || t.sample_times_s.length < 2 || t.sample_times_s.length > 64
    || !t.sample_times_s.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 3600)
    || typeof t.output_interval_s !== "number" || !Number.isFinite(t.output_interval_s) || t.output_interval_s <= 0
    || typeof t.requested_duration_s !== "number" || !Number.isFinite(t.requested_duration_s) || t.requested_duration_s <= 0
    || typeof t.complete_requested_duration !== "boolean"
    || t.sample_times_s.some((n, i, a) => i > 0 && Math.abs(n-a[i-1]-Number(t.output_interval_s)) > 1e-8)) return null;
  return t as unknown as CfdTemporal;
}

export function confirmedPhysicalSample(temporal: CfdTemporal, runId: string,
  reply: { status: string; runId?: string; sampleIndex?: number; physicalTimeSeconds?: number } | undefined) {
  const index = reply?.sampleIndex;
  return reply?.status === "applied" && reply.runId === runId && typeof index === "number" && Number.isInteger(index)
    && index >= 0 && index < temporal.sample_times_s.length && reply.physicalTimeSeconds === temporal.sample_times_s[index]
    ? { sampleIndex: index, physicalTimeSeconds: reply.physicalTimeSeconds } : null;
}
