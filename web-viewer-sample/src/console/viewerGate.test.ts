import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import {
  classifyViewerPhase,
  refusedViewerGate,
  resolveViewerGate,
  sameViewerGate,
  viewerGateText,
  type ViewerGateEvidence,
  type ViewerGateReason,
} from "./viewerGate";

const READY: ViewerGateEvidence = {
  validSession: true, sessionObserved: true, activePrimaryLease: true, firstFrame: true, dataChannelReady: true, stageMatched: true,
  mappingStale: false,
};

afterEach(() => setLang("zh"));

describe("resolveViewerGate", () => {
  it("passes both verdicts when every piece of viewer evidence is in place", () => {
    expect(resolveViewerGate(READY)).toEqual({ command: { ok: true }, batch: { ok: true } });
  });

  it.each([
    ["validSession", "no_session"],
    ["sessionObserved", "session_not_observed"],
    ["activePrimaryLease", "lease_not_active"],
    ["firstFrame", "waiting_first_frame"],
    ["dataChannelReady", "waiting_datachannel"],
    ["stageMatched", "stage_mismatch"],
  ] as const)("refuses both verdicts with the first missing evidence (%s → %s)", (field, reason) => {
    const gate = resolveViewerGate({ ...READY, [field]: false });
    expect(gate).toEqual({ command: { ok: false, reason }, batch: { ok: false, reason } });
  });

  it("reports the earliest missing evidence when several are missing", () => {
    expect(resolveViewerGate({ ...READY, activePrimaryLease: false, firstFrame: false, dataChannelReady: false }).command)
      .toEqual({ ok: false, reason: "lease_not_active" });
  });

  it("refuses only batch highlights on a stale mapping, ahead of every command refusal", () => {
    expect(resolveViewerGate({ ...READY, mappingStale: true, mappingStaleReason: "http_404" })).toEqual({
      command: { ok: true },
      batch: { ok: false, reason: "mapping_stale", detail: "http_404" },
    });
    expect(resolveViewerGate({ ...READY, validSession: false, mappingStale: true, mappingStaleReason: null })).toEqual({
      command: { ok: false, reason: "no_session" },
      batch: { ok: false, reason: "mapping_stale", detail: "derived_artifact_unreachable" },
    });
  });
});

describe("viewerGateText", () => {
  const TEXT: Record<ViewerGateReason, [string, string]> = {
    no_session: ["尚未輸入有效 review session", "enter a valid review session first"],
    session_not_observed: ["runtime/status 未列出此 session（可能 stale / 已關閉）", "runtime/status does not list this session (possibly stale / closed)"],
    lease_not_active: ["需先手動啟動 / attach Kit session", "manually start / attach the Kit session first"],
    waiting_first_frame: ["等待 3D 第一幀", "waiting for first frame"],
    waiting_datachannel: ["等待 viewer DataChannel", "waiting for viewer DataChannel"],
    stage_mismatch: ["stage 未對齊，禁止誤標", "stage mismatch; highlight is blocked"],
    mapping_stale: ["mapping_reachable=false: derived_artifact_unreachable", "mapping_reachable=false: derived_artifact_unreachable"],
    coordinator_offline: ["coordinator runtime/status 已離線", "coordinator runtime/status is offline"],
    model_mismatch: ["目前 3D Session 與這份檢核結果不同，請先選擇一致的 Session。", "目前 3D Session 與這份檢核結果不同，請先選擇一致的 Session。"],
  };

  it.each(Object.entries(TEXT) as [ViewerGateReason, [string, string]][])("shows %s in the wording the pane always used", (reason, [zh, en]) => {
    setLang("zh");
    expect(viewerGateText({ ok: false, reason })).toBe(zh);
    setLang("en");
    expect(viewerGateText({ ok: false, reason })).toBe(en);
  });

  it("shows nothing for a pass or a missing verdict, and the stale reason for a stale mapping", () => {
    expect(viewerGateText({ ok: true })).toBe("");
    expect(viewerGateText(null)).toBe("");
    expect(viewerGateText(undefined)).toBe("");
    expect(viewerGateText({ ok: false, reason: "mapping_stale", detail: "http_404" })).toBe("mapping_reachable=false: http_404");
  });
});

describe("refusedViewerGate and sameViewerGate", () => {
  it("refuses both verdicts for one reason", () => {
    expect(refusedViewerGate("coordinator_offline")).toEqual({
      command: { ok: false, reason: "coordinator_offline" },
      batch: { ok: false, reason: "coordinator_offline" },
    });
  });

  it("compares verdicts by outcome, reason and detail", () => {
    const stale = resolveViewerGate({ ...READY, mappingStale: true, mappingStaleReason: "http_404" });
    expect(sameViewerGate(stale, resolveViewerGate({ ...READY, mappingStale: true, mappingStaleReason: "http_404" }))).toBe(true);
    expect(sameViewerGate(stale, resolveViewerGate({ ...READY, mappingStale: true, mappingStaleReason: "http_500" }))).toBe(false);
    expect(sameViewerGate(stale, resolveViewerGate(READY))).toBe(false);
    expect(sameViewerGate(refusedViewerGate("no_session"), refusedViewerGate("lease_not_active"))).toBe(false);
    expect(sameViewerGate(resolveViewerGate(READY), { command: { ok: true }, batch: { ok: true } })).toBe(true);
  });
});

describe("classifyViewerPhase", () => {
  it("reads the command verdict's code in either language", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      expect(classifyViewerPhase("s", refusedViewerGate("lease_not_active"))).toBe("lease-pending");
      expect(classifyViewerPhase("s", refusedViewerGate("waiting_datachannel"))).toBe("waiting-datachannel");
    }
  });
});
