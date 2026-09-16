// SessionIdentity 三行元件（session-identity-display spec §2.2）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { fx } from "./__testdata__/contractFixtures";
import { SessionIdentity } from "./SessionIdentityCard";

const NOW = Date.parse("2026-09-16T10:00:00Z");
const session = fx.runtimeSessionSummary({
  session_id: "review_session_fd48be0a3fff", status: "created", project_id: "mv_6c51d572",
  model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", participant_count: 0, created_at: "2026-09-16T09:42:00Z",
  origin: { kind: "console_request", created_by: "coordinator-ready-review-request", intake_source: null, project_display_name: "IOTTEST", category: "建築-JJtest", bucket: null, source_object_key: null, source_ifc_filename: null, recreated_from_session_id: null, ledger_detected_at: null },
});

describe("SessionIdentity", () => {
  it("三行：主標／識別列（完整 id）／狀態列（來源、時間、狀態 created=尚未啟動、參與）", () => {
    const html = renderToString(<SessionIdentity session={session} now={NOW} />);
    const div = document.createElement("div"); div.innerHTML = html;
    expect(div.querySelector('[data-testid="session-identity-title"]')?.textContent).toBe("IOTTEST · 建築-JJtest · 版本 24e598ab");
    expect(div.querySelector('[data-testid="session-id"]')?.textContent).toContain("review_session_fd48be0a3fff");
    expect(div.querySelector('[data-testid="session-origin"]')?.textContent).toBe("Console 建立");
    expect(div.querySelector('[data-testid="session-created"]')?.textContent).toMatch(/18 分鐘前$/);
    expect(div.querySelector('[data-testid="session-status"]')?.textContent).toBe("尚未啟動");
    expect(div.textContent).toContain("參與 0");
  });
  it("compact：不出識別列", () => {
    const html = renderToString(<SessionIdentity session={session} compact now={NOW} />);
    const div = document.createElement("div"); div.innerHTML = html;
    expect(div.querySelector('[data-testid="session-identity-title"]')).not.toBeNull();
    expect(div.querySelector('[data-testid="session-id"]')).toBeNull();
  });
});
