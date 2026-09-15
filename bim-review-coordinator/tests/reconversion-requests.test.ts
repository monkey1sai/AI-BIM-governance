import { describe, expect, it, vi } from "vitest";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { ReconversionRequests } from "../src/services/reconversionRequests.js";
import type { ManualTriggerOutcome } from "../src/services/minioWatchSurface.js";

const intent = { key: "project/main/v1/model.ifc", requestId: "reconvert-request-0001", expectedEtag: "a".repeat(32) };
function fixture() {
  const ledger = new ConversionLedger();
  const trigger = vi.fn(async (): Promise<ManualTriggerOutcome> => ({ kind: "upstream", status: 202,
    body: { ifc_ready_job_id: "ifcready_test", status: "queued_for_conversion" } }));
  const service = new ReconversionRequests({ ledger, bucket: "models", prefix: "", keySuffix: "/model.ifc", trigger });
  return { ledger, trigger, service };
}
describe("explicit reconversion intent", () => {
  it("persists the source before dispatch and coalesces concurrent requests", async () => {
    const { ledger, trigger, service } = fixture();
    trigger.mockImplementationOnce(async () => {
      expect(ledger.list()[0]).toMatchObject({ object_key: intent.key, bucket: "models", source_etag: intent.expectedEtag });
      return { kind: "upstream", status: 202, body: { ifc_ready_job_id: "ifcready_test" } };
    });
    const replies = await Promise.all([service.submit(intent), service.submit(intent)]);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(replies[0].body.ready_model_id).toMatch(/^mw_[a-f0-9]{16}$/);
    expect(replies[0]).toEqual(replies[1]);
  });
  it("rejects changing the identity of an existing intent", async () => {
    const { trigger, service } = fixture();
    await service.submit(intent);
    expect((await service.submit({ ...intent, expectedEtag: "b".repeat(32) })).status).toBe(409);
    expect(trigger).toHaveBeenCalledTimes(1);
  });
  it("does not start a different intent while this source has an unresolved attempt", async () => {
    const { trigger, service } = fixture();
    await service.submit(intent);
    const next = await service.submit({ ...intent, requestId: "reconvert-request-0002" });
    expect(next.status).toBe(409);
    expect(next.body.error_code).toBe("conversion_in_progress");
    expect(trigger).toHaveBeenCalledTimes(1);
  });
  it("preserves old successful artifacts and replays without another dispatch", async () => {
    const { ledger, trigger, service } = fixture();
    const first = await service.submit(intent);
    const previous = ledger.get(String(first.body.ready_model_id))!;
    ledger.upsert({ ...previous, status: "ready", conversion_job_id: "conversion_old" }, "2026-09-15T01:00:00Z", { usdc_key: "old/model.usdc" });
    const replay = await service.submit(intent);
    expect(replay.body).toMatchObject({ intent_replay: true, conversion_job_id: "conversion_old" });
    expect(trigger).toHaveBeenCalledTimes(1);
    const next = await service.submit({ ...intent, requestId: "reconvert-request-0002" });
    expect(next.body.ready_model_id).not.toBe(first.body.ready_model_id);
    expect(ledger.get(previous.idempotency_key)?.usdc_key).toBe("old/model.usdc");
  });
  it("uses the same idempotency salt after a lost response", async () => {
    const { trigger, service } = fixture();
    trigger.mockResolvedValueOnce({ kind: "fetch_failed", message: "timeout" });
    expect((await service.submit(intent)).status).toBe(502);
    await service.submit(intent);
    expect(trigger.mock.calls[0]).toEqual(trigger.mock.calls[1]);
  });
  it("marks a known changed-source rejection as failed, retaining the old source identity", async () => {
    const { ledger, trigger, service } = fixture();
    trigger.mockResolvedValueOnce({ kind: "upstream", status: 409, body: { error_code: "source_changed" } });
    await service.submit(intent);
    expect(ledger.list()[0]).toMatchObject({ status: "failed", source_etag: intent.expectedEtag, failure_code: "source_changed" });
  });
});
