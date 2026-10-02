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
  const playbackQuery = useRef<{ generation: number; promise: Promise<ViewerCommandReplies["overlay_playback"]> } | null>(null);
  const waitingPlayback = useRef<object | null>(null);
  useEffect(() => () => {
    for (const family of FAMILIES) nextGeneration(generations.current, family);
    playbackQuery.current = null; waitingPlayback.current = null;
  }, []);
  const settle = useCallback((family: ViewerCommandFamily, state: AnyState) => {
    setStates(previous => ({ ...previous, [family]: state }));
  }, []);
  const invalidate = useCallback((family?: ViewerCommandFamily) => {
    const targets = family ? [family] : FAMILIES;
    for (const target of targets) {
      nextGeneration(generations.current, target);
      busy.current.delete(target);
      if (target === "overlay_playback") { playbackQuery.current = null; waitingPlayback.current = null; }
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
  const send = useCallback(function dispatch<C extends CorrelatedViewerCommand>(command: C, input: ViewerCommandInputs[C]): Promise<ViewerCommandReplies[C]> {
    const { family, validate } = VIEWER_COMMAND_REQUESTS[command];
    const playbackAction = command === "overlay_playback" && validate(input)
      ? (input as ViewerCommandInputs["overlay_playback"]).action : null;
    const isPlaybackQuery = playbackAction === "query";
    if (family === "overlay_playback" && waitingPlayback.current) return Promise.resolve(failReply<C>("busy"));
    // One explicit user action may wait for a read-only poll; never overlap requests or retry a failed poll.
    if (playbackAction && !isPlaybackQuery && playbackQuery.current) {
      const query = playbackQuery.current, token = {}, port = resolvePort();
      waitingPlayback.current = token; settle(family, { status: "pending" });
      return query.promise.then(reply => {
        if (waitingPlayback.current !== token || query.generation !== generations.current.get(family)) return unconfirmed<C>();
        waitingPlayback.current = null;
        if (gateRef.current?.command.ok !== true || !port || resolvePort() !== port) {
          const cancelled = unconfirmed<C>(); settle(family, cancelled); return cancelled;
        }
        if (reply.status !== "applied") return reply as ViewerCommandReplies[C];
        return dispatch(command, input);
      });
    }
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
    busy.current.add(family);
    // Polling keeps the last confirmed UI value usable; mutations still expose pending until Kit ACK.
    if (!isPlaybackQuery) settle(family, { status: "pending" });
    const request = Promise.resolve().then(() => {
      if (superseded() || gateRef.current?.command.ok !== true) return null;
      return port.send(command, input);
    }).then(reply => {
      if (superseded() || !reply) return unconfirmed<C>();
      busy.current.delete(family);
      if (isPlaybackQuery && playbackQuery.current?.generation === current) playbackQuery.current = null;
      if (!isPlaybackQuery || !waitingPlayback.current || reply.status !== "applied") settle(family, reply);
      return reply;
    }).catch(() => {
      if (superseded()) return unconfirmed<C>();
      const reply = failReply<C>("transport");
      busy.current.delete(family);
      if (isPlaybackQuery && playbackQuery.current?.generation === current) playbackQuery.current = null;
      settle(family, reply);
      return reply;
    });
    if (isPlaybackQuery) playbackQuery.current = { generation: current, promise: request as Promise<ViewerCommandReplies["overlay_playback"]> };
    return request;
  }, [gateRef, resolvePort, settle]);
  const commandState = useCallback(<C extends CorrelatedViewerCommand>(command: C) =>
    (states[VIEWER_COMMAND_REQUESTS[command].family] ?? IDLE) as ViewerCommandState<ViewerCommandReplies[C]>, [states]);
  return { commandState, send, invalidate };
}
