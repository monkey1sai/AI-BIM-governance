import { decodeHighlightResult } from "./highlightResult";

export type IssueViewAction = "highlight" | "clear" | "focus" | "clear_selection";
export interface IssueViewPending {
  requestId: string;
  clientRequestId?: string;
  action: IssueViewAction;
  paths: string[];
  unmapped?: string[];
}

/** Parent replies are bounded, correlated runtime evidence; enqueueing is not success. */
export class IssueViewExchange {
  private pending = new Map<string, IssueViewPending & { snapshot: string; timer: ReturnType<typeof setTimeout> }>();
  constructor(private host: {
    snapshot(): string;
    reply(message: Record<string, unknown>): void;
    expired(requestId: string, outcome: "timed-out" | "superseded"): void;
  }) {}

  begin(input: IssueViewPending) {
    if (this.pending.size >= 32) {
      const oldest = this.pending.keys().next().value!;
      this.fail(oldest, "superseded");
      this.host.expired(oldest, "superseded");
    }
    this.pending.set(input.requestId, { ...input, snapshot: this.host.snapshot(),
      timer: setTimeout(() => {
        this.fail(input.requestId, "timed_out");
        this.host.expired(input.requestId, "timed-out");
      }, 15_000) });
  }

  fail(requestId: string, reason: string) {
    this.finish(requestId, { ok: false, reason });
  }

  dispose() {
    for (const requestId of this.pending.keys()) {
      this.fail(requestId, "superseded");
      this.host.expired(requestId, "superseded");
    }
  }

  result(requestId: string, eventType: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (pending.snapshot !== this.host.snapshot()) {
      this.fail(requestId, "superseded");
      this.host.expired(requestId, "superseded");
      return;
    }
    const expectedEvent = { highlight: "highlightPrimsResult", clear: "clearHighlightResult",
      focus: "focusPrimResult", clear_selection: "selectPrimsResult" }[pending.action];
    if (eventType !== expectedEvent) return;
    let ok = payload.result === "success";
    const evidence: Record<string, unknown> = {};
    if (pending.action === "highlight") {
      const decoded = decodeHighlightResult(payload);
      const paths = [...new Set(pending.paths)];
      ok = ok && decoded.complete && decoded.mode === "material_overlay"
        && decoded.paths.length === paths.length && paths.every(path => decoded.paths.includes(path))
        && !pending.unmapped?.length;
      Object.assign(evidence, { applied_mode: decoded.mode, applied_count: decoded.paths.length,
        applied_paths: decoded.paths, unsupported_paths: decoded.unsupported, missing_paths: decoded.missing,
        renderer_mode: typeof payload.renderer_mode === "string" ? payload.renderer_mode : "unknown" });
    } else if (pending.action === "clear") {
      ok = ok && payload.applied_mode === "material_overlay";
    } else if (pending.action === "focus") {
      ok = ok && payload.prim_path === pending.paths[0] && payload.framed === true && !payload.fallback_path;
    } else {
      ok = ok && Array.isArray(payload.selected_paths) && payload.selected_paths.length === 0;
    }
    this.finish(requestId, { ...evidence, ok, ...(ok ? {} : { reason: "runtime_unconfirmed" }) });
  }

  private finish(requestId: string, result: Record<string, unknown>) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    this.host.reply({ type: pending.action === "highlight" ? "highlight_result" : "issue_view_result",
      requestId, clientRequestId: pending.clientRequestId, action: pending.action,
      sent_count: new Set(pending.paths).size, unmapped_count: pending.unmapped?.length ?? 0,
      unmapped_guids: pending.unmapped ?? [], ...result });
  }
}
