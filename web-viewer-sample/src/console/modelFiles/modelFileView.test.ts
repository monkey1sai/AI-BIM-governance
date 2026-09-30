// 契約 §5.1 顯示名稱（owner 2026-09-30）、§5.3 清理候選、§4.4 移除條件的純函式測試。
import { describe, expect, it } from "vitest";
import { fx } from "../__testdata__/contractFixtures";
import type { ClosedReviewSessionItem, ConversionRecord, RuntimeSessionSummary } from "../coordinatorClient";
import {
  activeSessions, cleanupCandidates, closedSessionCount, isMinioKey, keyShortCode, modelFileLabel,
  openableSessions, preferredOpenTarget, removalState, unregisteredSources,
} from "./modelFileView";

const MW = "mw_0123456789abcdef";
const session = (over: Partial<ConversionRecord["sessions"][number]>) => ({
  session_id: "review_session_a", status: "active" as const, created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z", link: "ready_model" as const, ...over,
});
const record = (over: Partial<ConversionRecord>) => fx.conversionRecord({
  idempotency_key: MW, project_id: "proj_a", project_display_name: "專案A", category: "建築",
  external_model_version_id: "v1", status: "ready", source_ifc_filename: "model.ifc", sessions: [], ...over,
});

describe("modelFileLabel", () => {
  it("minio records use project · category · version, filename and key short code second", () => {
    expect(modelFileLabel(record({}))).toEqual({ title: "專案A · 建築 · 版本 v1", subtitle: "model.ifc · …89abcdef" });
  });
  it("other records use the filename first, project · version · key short code second", () => {
    expect(modelFileLabel(record({ idempotency_key: "idem_devreg_1", source_ifc_filename: "villa.ifc" })))
      .toEqual({ title: "villa.ifc", subtitle: "專案A · 版本 v1 · …devreg_1" });
  });
  it("re-dispatched records with the same project · category · version stay distinguishable", () => {
    const first = modelFileLabel(record({}));
    const second = modelFileLabel(record({ idempotency_key: "mw_ffffffffffffffff" }));
    expect(second.title).toBe(first.title);
    expect(second.subtitle).not.toBe(first.subtitle);
  });
  it("never invents a filename", () => {
    const label = modelFileLabel(record({ idempotency_key: "idem_devreg_1", source_ifc_filename: null }));
    expect(label.title).toBe(`來源未知 ${keyShortCode("idem_devreg_1")}`);
    expect(modelFileLabel(record({ source_ifc_filename: null })).subtitle).toBe("來源未知 · …89abcdef");
    expect(isMinioKey("idem_devreg_1")).toBe(false);
    expect(isMinioKey(MW)).toBe(true);
  });
});

describe("sessions and removal", () => {
  it("splits active and closed sessions and prefers the first active one", () => {
    const r = record({ sessions: [session({ session_id: "s_new", created_at: "2026-09-03T00:00:00.000Z" }), session({ session_id: "s_closed", status: "closed" }), session({ session_id: "s_closing", status: "closing" })] });
    expect(activeSessions(r).map((s) => s.session_id)).toEqual(["s_new", "s_closing"]);
    expect(openableSessions(r).map((s) => s.session_id)).toEqual(["s_new"]);
    expect(closedSessionCount(r)).toBe(1);
    expect(preferredOpenTarget(r)?.session_id).toBe("s_new");
  });
  it("prefers an openable ready_model session, then any openable one, and never a closing one", () => {
    const binding = session({ session_id: "s_binding", link: "artifact_binding" });
    const ready = session({ session_id: "s_ready", status: "created" });
    const closing = session({ session_id: "s_closing", status: "closing" });
    expect(preferredOpenTarget(record({ sessions: [closing, binding, ready] }))?.session_id).toBe("s_ready");
    expect(preferredOpenTarget(record({ sessions: [closing, binding] }))?.session_id).toBe("s_binding");
    expect(preferredOpenTarget(record({ sessions: [closing] }))).toBeNull();
  });
  it("blocks removal while a session is active or the record is already removed", () => {
    expect(removalState(record({ sessions: [session({})] }))).toEqual({ allowed: false, reason: "被 1 筆進行中審查佔用：review_session_a" });
    expect(removalState(record({ status: "removed" }))).toEqual({ allowed: false, reason: "已移除" });
    expect(removalState(record({ sessions: [session({ status: "closed" })] }))).toEqual({ allowed: true });
  });
  it("lists only local sources whose filename no record knows", () => {
    const sources = [{ source_id: "a", filename: "villa.ifc" }, { source_id: "b", filename: "new.ifc" }];
    expect(unregisteredSources(sources, [record({ source_ifc_filename: "villa.ifc" })]).map((s) => s.source_id)).toEqual(["b"]);
  });
});

describe("cleanupCandidates", () => {
  const now = Date.parse("2026-09-30T00:00:00.000Z");
  const old = "2026-09-01T00:00:00.000Z";
  const fresh = "2026-09-29T00:00:00.000Z";
  const live = (over: Partial<RuntimeSessionSummary>) => fx.runtimeSessionSummary({ status: "active", updated_at: old, viewer_leases: [], primary_viewer_lease_id: null, ...over });
  const closed = (over: Partial<ClosedReviewSessionItem>): ClosedReviewSessionItem => ({
    session_id: "review_session_c", status: "closed", project_id: "p", model_version_id: "m", created_at: old, updated_at: old,
    recreated_from_session_id: null, source_ifc_filename: null, rebuildability: { state: "ready", reason: null, checked_at: old }, ...over,
  });
  it("groups closed, stale active and unused records older than the cutoff", () => {
    const out = cleanupCandidates({ now, days: 14,
      live: [live({ session_id: "stale" }), live({ session_id: "fresh", updated_at: fresh }), live({ session_id: "failed_old", status: "failed" })],
      closed: [closed({}), closed({ session_id: "recent", updated_at: fresh })],
      records: [record({ updated_at: old }), record({ idempotency_key: "mw_ffffffffffffffff", updated_at: old, sessions: [session({})] }), record({ idempotency_key: "idem_x", updated_at: fresh })] });
    expect(out.closedSessions.map((s) => s.session_id)).toEqual(["review_session_c", "failed_old"]);
    expect(out.staleActive.map((s) => s.session_id)).toEqual(["stale"]);
    expect(out.records.map((r) => r.idempotency_key)).toEqual([MW]);
    expect(out.cutoffIso).toBe("2026-09-16T00:00:00.000Z");
  });
  it("stale active excludes sessions with a lease", () => {
    const withLease = live({ session_id: "leased", primary_viewer_lease_id: "lease_1", viewer_leases: [fx.publicViewerLease({})] });
    expect(cleanupCandidates({ now, days: 14, live: [withLease], closed: [], records: [] }).staleActive).toEqual([]);
  });
});
