import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandReason } from "../../viewerCommandChannel/camera";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import {
  VIEWER_COMMAND_REQUESTS, type CorrelatedViewerCommand, type ViewerCommandFamily, type ViewerCommandInputs, type ViewerCommandReplies,
} from "../../viewerCommandChannel/registry";
import type { ViewerGate } from "../viewerGate";

type Reply = { status: "applied" | "off" | "unconfirmed" | "error"; reason?: CommandReason };
export type ViewerCommandState<R extends Reply> = { status: "idle" | "pending" } | R;

type AnyState = ViewerCommandState<ViewerCommandReplies[CorrelatedViewerCommand]>;

const IDLE: AnyState = { status: "idle" };
const FAMILIES = [...new Set(Object.values(VIEWER_COMMAND_REQUESTS).map(entry => entry.family))];
const failReply = <C extends CorrelatedViewerCommand>(reason: CommandReason) => ({ status: "error", reason }) as ViewerCommandReplies[C];
const unconfirmed = <C extends CorrelatedViewerCommand>() => ({ status: "unconfirmed" }) as ViewerCommandReplies[C];

function nextGeneration(generations: Map<ViewerCommandFamily, number>, family: ViewerCommandFamily): number {
  const next = (generations.get(family) ?? 0) + 1;
  generations.set(family, next);
  return next;
}

/**
 * Viewer command state derived from the registry (VIEWER_COMMAND_REQUESTS family and validate): one state and one
 * command at a time per family (camera view and camera state share the camera), with per-family generation guards.
 */
export function useViewerCommandState(
  gateRef: { readonly current: ViewerGate | null },
  resolvePort: () => ViewerCommandPort | undefined,
) {
  const [states, setStates] = useState<Partial<Record<ViewerCommandFamily, AnyState>>>({});
  const busy = useRef(new Set<ViewerCommandFamily>());
  const generations = useRef(new Map<ViewerCommandFamily, number>());
  useEffect(() => () => { for (const family of FAMILIES) nextGeneration(generations.current, family); }, []);
  const settle = useCallback((family: ViewerCommandFamily, state: AnyState) => {
    setStates(previous => ({ ...previous, [family]: state }));
  }, []);
  const invalidate = useCallback((family?: ViewerCommandFamily) => {
    const targets = family ? [family] : FAMILIES;
    for (const target of targets) {
      nextGeneration(generations.current, target);
      busy.current.delete(target);
    }
    setStates(previous => {
      let next = previous;
      for (const target of targets) {
        const status = previous[target]?.status;
        if (status === undefined || status === "idle" || status === "unconfirmed") continue;
        if (next === previous) next = { ...previous };
        next[target] = { status: "unconfirmed" };
      }
      return next;
    });
  }, []);
  const send = useCallback(<C extends CorrelatedViewerCommand>(command: C, input: ViewerCommandInputs[C]): Promise<ViewerCommandReplies[C]> => {
    const { family, validate } = VIEWER_COMMAND_REQUESTS[command];
    if (busy.current.has(family)) return Promise.resolve(failReply<C>("busy"));
    const refuse = (reason: CommandReason) => {
      const reply = failReply<C>(reason);
      settle(family, reply);
      return Promise.resolve(reply);
    };
    if (!validate(input)) return refuse("invalid");
    const port = resolvePort();
    if (gateRef.current?.command.ok !== true || !port) return refuse("unavailable");
    const current = nextGeneration(generations.current, family);
    const superseded = () => current !== generations.current.get(family);
    busy.current.add(family); settle(family, { status: "pending" });
    return Promise.resolve().then(() => {
      if (superseded() || gateRef.current?.command.ok !== true) return null;
      return port.send(command, input);
    }).then(reply => {
      if (superseded() || !reply) return unconfirmed<C>();
      busy.current.delete(family); settle(family, reply);
      return reply;
    }).catch(() => {
      if (superseded()) return unconfirmed<C>();
      const reply = failReply<C>("transport");
      busy.current.delete(family); settle(family, reply);
      return reply;
    });
  }, [gateRef, resolvePort, settle]);
  const commandState = useCallback(<C extends CorrelatedViewerCommand>(command: C) =>
    (states[VIEWER_COMMAND_REQUESTS[command].family] ?? IDLE) as ViewerCommandState<ViewerCommandReplies[C]>, [states]);
  return { commandState, send, invalidate };
}
