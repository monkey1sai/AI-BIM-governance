// ConversionResultPort over StreamingConversionClient.fetchConversionResult (docs/architecture/cfd-run-workflow-adr.md §3).
// The client reports an upstream refusal only as the message `streaming conversion result API <status>: ...`; this
// adapter is the one place that knows that format and turns it into a typed result.
import type { StreamingConversionClient } from "../streamingConversionClient.js";
import type { ConversionResultPort } from "./workflow.js";

export class StreamingConversionResultAdapter implements ConversionResultPort {
  constructor(private readonly client: Pick<StreamingConversionClient, "fetchConversionResult">) {}

  async fetch(conversionJobId: string): ReturnType<ConversionResultPort["fetch"]> {
    try {
      return { kind: "found", result: await this.client.fetchConversionResult(conversionJobId) };
    } catch (error) {
      if (/ 404:/.test(error instanceof Error ? error.message : "")) return { kind: "not_found" };
      // Same fixed detail the create route has always reported for a conversion lookup that failed otherwise.
      return { kind: "unavailable", detail: "streaming CFD job service error" };
    }
  }
}
