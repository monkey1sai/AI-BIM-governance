import { describe, expect, it, vi } from "vitest";
import { IssueViewExchange } from "./issueViewExchange";

function fixture() {
  let revision = "stage-1";
  const reply = vi.fn(); const expired = vi.fn();
  const exchange = new IssueViewExchange({ snapshot: () => revision, reply, expired });
  return { exchange, reply, expired, change: () => { revision = "stage-2"; } };
}
const material = { result: "success", applied_mode: "material_overlay", applied_paths: ["/A", "/B"],
  missing_paths: [], unsupported_paths: [], renderer_mode: "RaytracedLighting" };

describe("issue view correlated evidence", () => {
  it("waits for material coverage, ignores wrong events, and forwards one terminal only", () => {
    const { exchange, reply } = fixture();
    exchange.begin({ requestId: "r", clientRequestId: "c", action: "highlight", paths: ["/A", "/B", "/A"] });
    expect(reply).not.toHaveBeenCalled();
    exchange.result("r", "focusPrimResult", material);
    exchange.result("untracked", "highlightPrimsResult", material);
    expect(reply).not.toHaveBeenCalled();
    exchange.result("r", "highlightPrimsResult", material);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true, clientRequestId: "c", applied_count: 2, sent_count: 2, renderer_mode: "RaytracedLighting" }));
    exchange.result("r", "highlightPrimsResult", material);
    expect(reply).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...material, applied_mode: "selection", selected_paths: ["/A", "/B"] },
    { ...material, applied_paths: [] },
    { ...material, applied_paths: ["/A", "/Wrong"] },
    { ...material, unsupported_paths: ["/B"] },
    { ...material, missing_paths: null },
    { ...material, result: "error" },
  ])("does not elevate incomplete or legacy evidence", payload => {
    const { exchange, reply } = fixture();
    exchange.begin({ requestId: "r", action: "highlight", paths: ["/A", "/B"] });
    exchange.result("r", "highlightPrimsResult", payload);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });
  it("does not hide unmapped rows, drift, rejection or timeout", () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.exchange.begin({ requestId: "r", action: "highlight", paths: ["/A", "/B"], unmapped: ["missing"] });
      f.exchange.result("r", "highlightPrimsResult", material);
      expect(f.reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, unmapped_guids: ["missing"] }));
      f.exchange.begin({ requestId: "drift", action: "clear", paths: [] }); f.change();
      f.exchange.result("drift", "clearHighlightResult", material);
      expect(f.reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: "superseded" }));
      f.exchange.begin({ requestId: "denied", action: "clear", paths: [] }); f.exchange.fail("denied", "rejected");
      expect(f.reply).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "rejected" }));
      f.exchange.begin({ requestId: "late", action: "clear", paths: [] }); vi.advanceTimersByTime(15_000);
      expect(f.expired).toHaveBeenCalledWith("late", "timed-out");
      expect(f.reply).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "timed_out" }));
      f.exchange.result("late", "clearHighlightResult", material);
      expect(f.reply).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });
  it("requires explicit framing and exact empty selection for separate operations", () => {
    const { exchange, reply } = fixture();
    exchange.begin({ requestId: "focus", action: "focus", paths: ["/A"] });
    exchange.result("focus", "focusPrimResult", { result: "success", prim_path: "/A" });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
    exchange.begin({ requestId: "clear", action: "clear_selection", paths: [] });
    exchange.result("clear", "selectPrimsResult", { result: "success", selected_paths: ["/A"] });
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
  });
});
