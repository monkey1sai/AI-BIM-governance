// session 身分顯示純函式（session-identity-display spec §2.1）：null 一律「未取得」，不用 id 拼湊假名稱。
import { describe, expect, it } from "vitest";
import { fx } from "./__testdata__/contractFixtures";
import type { RuntimeSessionSummary } from "./coordinatorClient";
import {
  formatCreated, modelOptionLabel, sessionOptionLabel, sessionOriginLabel, sessionStatusLabel, sessionTitle,
  shortSessionId, shortVersion, sortByCreatedDesc,
} from "./sessionIdentity";

const NOW = Date.parse("2026-09-16T10:00:00Z");
type Origin = RuntimeSessionSummary["origin"];
const origin = (over: Partial<Origin> = {}): Origin => ({
  kind: "auto_conversion_ready", created_by: "coordinator-auto-conversion-ready", intake_source: "minio_watch",
  project_display_name: "東勢區許良宇紀念圖書館", category: "建築", bucket: "bim-control",
  source_object_key: "lib/root/建築/24e598ab/model.ifc", source_ifc_filename: "model.ifc",
  recreated_from_session_id: null, ledger_detected_at: "2026-09-08T08:42:32.485Z", ...over,
});
const s = (over: Partial<RuntimeSessionSummary> = {}): RuntimeSessionSummary => fx.runtimeSessionSummary({
  session_id: "review_session_fd48be0a3fff", status: "active", project_id: "mv_6c51d572",
  model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", participant_count: 2,
  created_at: "2026-09-16T09:42:00Z", origin: origin(), ...over,
});

describe("sessionIdentity", () => {
  it("shortVersion：UUID 取前 8 碼，其餘原樣", () => {
    expect(shortVersion("24e598ab-be3d-4dbb-a1aa-60b0ba610618")).toBe("24e598ab");
    expect(shortVersion("v1")).toBe("v1");
  });
  it("shortSessionId：…＋後 6 碼", () => {
    expect(shortSessionId("review_session_fd48be0a3fff")).toBe("…0a3fff");
  });
  it("sessionTitle：專案顯示名 · 種類 · 版本；null 欄位誠實退回", () => {
    expect(sessionTitle(s())).toBe("東勢區許良宇紀念圖書館 · 建築 · 版本 24e598ab");
    expect(sessionTitle(s({ origin: origin({ project_display_name: null, category: null }) }))).toBe("mv_6c51d572 · 種類未取得 · 版本 24e598ab");
  });
  it("sessionOriginLabel：四種 kind＋intake_source", () => {
    expect(sessionOriginLabel(s())).toBe("MinIO 自動");
    expect(sessionOriginLabel(s({ origin: origin({ intake_source: "external" }) }))).toBe("外部進件自動");
    expect(sessionOriginLabel(s({ origin: origin({ intake_source: null }) }))).toBe("轉檔完成自動");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "console_request", created_by: "coordinator-ready-review-request" }) }))).toBe("Console 建立");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "recreated", recreated_from_session_id: "review_session_7a9e6fb3d50d" }) }))).toBe("重建自 …b3d50d");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "recreated", recreated_from_session_id: null }) }))).toBe("重建自 未取得");
    expect(sessionOriginLabel(s({ origin: origin({ kind: "api_explicit", created_by: "dev_user_001" }) }))).toBe("API 建立（dev_user_001）");
  });
  it("sessionStatusLabel：created 顯尚未啟動", () => {
    expect(sessionStatusLabel("created")).toBe("尚未啟動");
    expect(sessionStatusLabel("active")).toBe("進行中");
    expect(sessionStatusLabel("closing")).toBe("關閉中");
    expect(sessionStatusLabel("closed")).toBe("已關閉");
    expect(sessionStatusLabel("failed")).toBe("失敗");
  });
  it("formatCreated：本地 MM-DD HH:mm＋相對時間；空／非法 → 時間未取得", () => {
    const iso = "2026-09-16T09:42:00Z";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const abs = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(formatCreated(iso, NOW)).toBe(`${abs} · 18 分鐘前`);
    expect(formatCreated("2026-09-16T04:00:00Z", NOW)).toMatch(/· 6 小時前$/);
    expect(formatCreated("2026-09-08T10:00:00Z", NOW)).toMatch(/· 8 天前$/);
    expect(formatCreated("", NOW)).toBe("時間未取得");
    expect(formatCreated("nope", NOW)).toBe("時間未取得");
    // created_at 在未來（時鐘偏移）：只顯絕對時間＋時鐘不同步，不捏造「0 分鐘前」。
    expect(formatCreated("2026-09-16T10:05:00Z", NOW)).toMatch(/· 時鐘不同步$/);
  });
  it("sessionOptionLabel：單行 option 文字", () => {
    expect(sessionOptionLabel(s(), NOW)).toMatch(/^\d\d-\d\d \d\d:\d\d · 18 分鐘前 · MinIO 自動 · 參與 2 · 進行中 · …0a3fff$/);
  });
  it("modelOptionLabel：種類 · 版本 · 轉檔 MM-DD；有 object_key 前綴檔名；無 key 不出現「檔名未提供」", () => {
    const withKey = fx.conversionRecord({ idempotency_key: "mw_1", project_display_name: "ifc-test", category: "architecture", external_model_version_id: "v1", object_key: "ifc-test/architecture/v1/model.ifc", detected_at: "2026-09-16T05:08:23.923Z" });
    expect(modelOptionLabel(withKey)).toMatch(/^model\.ifc · architecture · 版本 v1 · 轉檔 09-16$/);
    const noKey = fx.conversionRecord({ idempotency_key: "mw_2", project_display_name: "洲際好宅", category: "", external_model_version_id: "77e4fbad-e0f7-4946-9a49-fa84d941ddeb", object_key: null, detected_at: "2026-08-19T06:23:00Z" });
    expect(modelOptionLabel(noKey)).toBe("種類未取得 · 版本 77e4fbad · 轉檔 08-19");
    expect(modelOptionLabel(noKey)).not.toContain("檔名未提供");
  });
  it("sortByCreatedDesc：新到舊，不改原陣列", () => {
    const a = { created_at: "2026-09-01T00:00:00Z" }, b = { created_at: "2026-09-10T00:00:00Z" }, c = { created_at: "" };
    const input = [a, b, c];
    expect(sortByCreatedDesc(input).map((x) => x.created_at)).toEqual([b.created_at, a.created_at, ""]);
    expect(input[0]).toBe(a);
  });
});
