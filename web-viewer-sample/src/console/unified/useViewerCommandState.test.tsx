import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refusedViewerGate, type ViewerGate } from "../viewerGate";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { useViewerCommandState } from "./useViewerCommandState";

type Reply = { status: "applied" | "unconfirmed" | "error"; reason?: "invalid" | "busy" | "unavailable" | "rejected" | "transport" | "timeout" | "readback"; value?: number };
let root: Root, box: HTMLDivElement;
let hook: ReturnType<typeof useViewerCommandState<number, Reply>>;
const gateRef: { current: ViewerGate | null } = { current: null };
let send: ((input: number) => Promise<Reply>) | undefined;
const validate = (input: number) => input > 0;
const resolveSend = () => send;
function Probe() { hook = useViewerCommandState<number, Reply>(gateRef, validate, resolveSend); return null; }
async function flush() { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); }

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  gateRef.current = OPEN_GATE;
  send = vi.fn(async (input: number) => ({ status: "applied" as const, value: input }));
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

it("sends one command and stores the reply", async () => {
  act(() => hook.run(2));
  expect(hook.state).toEqual({ status: "pending" });
  await flush();
  expect(hook.state).toEqual({ status: "applied", value: 2 });
  expect(send).toHaveBeenCalledTimes(1);
});
it("rejects invalid input and a closed gate without sending", () => {
  act(() => hook.run(0));
  expect(hook.state).toEqual({ status: "error", reason: "invalid" });
  gateRef.current = refusedViewerGate("waiting_datachannel");
  act(() => hook.run(2));
  expect(hook.state).toEqual({ status: "error", reason: "unavailable" });
  expect(send).not.toHaveBeenCalled();
});
it("ignores a second run while pending", async () => {
  act(() => { hook.run(2); hook.run(3); });
  await flush();
  expect(send).toHaveBeenCalledTimes(1);
});
it("invalidate drops a late reply and marks the state unconfirmed", async () => {
  let resolve!: (reply: Reply) => void;
  send = vi.fn(() => new Promise<Reply>(r => { resolve = r; }));
  act(() => hook.run(2));
  await flush();
  act(() => hook.invalidate());
  expect(hook.state).toEqual({ status: "unconfirmed" });
  await act(async () => { resolve({ status: "applied", value: 2 }); });
  await flush();
  expect(hook.state).toEqual({ status: "unconfirmed" });
});
it("maps a thrown send to a transport error", async () => {
  send = vi.fn(async () => { throw new Error("private"); });
  act(() => hook.run(2));
  await flush();
  expect(hook.state).toEqual({ status: "error", reason: "transport" });
});
