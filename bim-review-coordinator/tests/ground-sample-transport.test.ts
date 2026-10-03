import { afterEach, expect, it, vi } from "vitest";
import { StreamingConversionClient } from "../src/services/streamingConversionClient.js";
afterEach(() => vi.unstubAllGlobals());
const action = `selections/ground_${"a".repeat(64)}/sample-points`;
it("limits chunked reply before JSON parse and cancels the reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
  const client = new StreamingConversionClient("http://127.0.0.1:49101", 5000, "test-only-key");
  await expect(client.groundSurfaces("stream_conv_test", action, { bounds_m: [0, 0, 1, 1], spacing_m: 1 })).rejects.toThrow("ground response too large");
  expect(cancelled).toBe(true);
});
it("permits only the fixed sample suffix with bounded body and no redirects", async () => {
  const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response('{"ok":true}')); vi.stubGlobal("fetch", fetcher);
  const client = new StreamingConversionClient("http://127.0.0.1:49101", 5000, "test-only-key");
  await expect(client.groundSurfaces("stream_conv_test", action + "/evil", {})).rejects.toThrow("invalid ground surface");
  await expect(client.groundSurfaces("stream_conv_test", action, { junk: "x".repeat(8192) })).rejects.toThrow("invalid ground sample");
  expect(fetcher).not.toHaveBeenCalled();
  expect((await client.groundSurfaces("stream_conv_test", action, { bounds_m: [0, 0, 1, 1], spacing_m: 1 })).body).toEqual({ ok: true });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error" });
});
it("enforces the smaller assessment response budget before parsing", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const fetcher = vi.fn(async () => new Response(stream)); vi.stubGlobal("fetch", fetcher);
  const client = new StreamingConversionClient("http://127.0.0.1:49101", 5000, "test-only-key");
  const endpoint = action.replace("sample-points", "engineering-assessment");
  await expect(client.groundSurfaces("stream_conv_test", endpoint, { source_run_id: "cfd_test000001", wind_from_degrees: 0 })).rejects.toThrow("ground response too large");
  expect(cancelled).toBe(true); expect(fetcher.mock.calls).toHaveLength(1);
  await expect(client.groundSurfaces("stream_conv_test", endpoint, { junk: "x".repeat(8192) })).rejects.toThrow("invalid ground sample");
  expect(fetcher.mock.calls).toHaveLength(1);
});
