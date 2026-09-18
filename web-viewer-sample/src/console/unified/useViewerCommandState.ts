import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandReason } from "../cameraViewBridge";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import { resolveViewerCommandGate } from "./viewportSlot";

type Reply = { status: "applied" | "unconfirmed" | "error"; reason?: CommandReason };
export type ViewerCommandState<R extends Reply> = { status: "idle" | "pending" } | R;

const failReply = <R extends Reply>(reason: CommandReason): R => ({ status: "error", reason } as unknown as R);

/** One-at-a-time viewer command with generation guards; mirrors the section-plane flow in ViewportSlotProvider. */
export function useViewerCommandState<I, R extends Reply>(
  gateRef: { readonly current: ReviewSessionViewerPaneBatchGate | null },
  validate: (input: I) => boolean,
  resolveSend: () => ((input: I) => Promise<R>) | undefined,
) {
  const [state, setState] = useState<ViewerCommandState<R>>({ status: "idle" });
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);
  const invalidate = useCallback(() => {
    ++generation.current; busy.current = false;
    setState(previous => (previous.status === "idle" || previous.status === "unconfirmed"
      ? previous : { status: "unconfirmed" } as unknown as R));
  }, []);
  const run = useCallback((input: I) => {
    if (busy.current) return;
    if (!validate(input)) { setState(failReply<R>("invalid")); return; }
    const send = resolveSend();
    if (!resolveViewerCommandGate(gateRef.current).canSend || !send) { setState(failReply<R>("unavailable")); return; }
    const current = ++generation.current;
    busy.current = true; setState({ status: "pending" });
    void Promise.resolve().then(() => {
      if (current !== generation.current || !resolveViewerCommandGate(gateRef.current).canSend) return null;
      return send(input);
    }).then(reply => {
      if (current !== generation.current || !reply) return;
      busy.current = false; setState(reply);
    }).catch(() => {
      if (current !== generation.current) return;
      busy.current = false; setState(failReply<R>("transport"));
    });
  }, [gateRef, validate, resolveSend]);
  return { state, run, invalidate };
}
