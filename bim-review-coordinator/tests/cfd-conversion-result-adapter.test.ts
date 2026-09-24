// StreamingConversionResultAdapter (docs/architecture/cfd-run-workflow-adr.md §3): the only place that knows how
// StreamingConversionClient reports an upstream refusal.
import { describe, expect, it } from "vitest";
import { StreamingConversionResultAdapter } from "../src/services/cfdRunWorkflow/index.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";

function client(answer: () => Promise<StreamingConversionResult>) {
  return { fetchConversionResult: answer };
}

describe("StreamingConversionResultAdapter", () => {
  it("returns the conversion result when the authority answers", async () => {
    const result: StreamingConversionResult = { conversion_job_id: "stream_conv_1", status: "succeeded", ready: true, raw: { artifacts: {} } };
    const adapter = new StreamingConversionResultAdapter(client(async () => result));
    expect(await adapter.fetch("stream_conv_1")).toEqual({ kind: "found", result });
  });

  it("classifies the client's 404 message as not_found and every other failure as unavailable with a fixed detail", async () => {
    const notFound = new StreamingConversionResultAdapter(client(async () => { throw new Error("streaming conversion result API 404: {\"detail\":\"Conversion job not found.\"}"); }));
    expect(await notFound.fetch("stream_conv_nope")).toEqual({ kind: "not_found" });
    const refused = new StreamingConversionResultAdapter(client(async () => { throw new Error("streaming conversion result API 500: boom"); }));
    expect(await refused.fetch("stream_conv_1")).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
    const unreadable = new StreamingConversionResultAdapter(client(async () => { throw new SyntaxError("Unexpected token < in JSON"); }));
    expect(await unreadable.fetch("stream_conv_1")).toEqual({ kind: "unavailable", detail: "streaming CFD job service error" });
  });
});
