// web-viewer-sample/src/console/IntakeSelectPage.test.tsx
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeSelectPage, isSafeViewerUrl } from "./IntakeSelectPage";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

describe("IntakeSelectPage A1 進件（選現成模型，不手填路徑）", () => {
  it("呈現「選現成模型」UI 且不含手填模型路徑 input", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("選取現成模型"); // 選取式 UI
    expect(html).toContain("/api/external/ifc-ready"); // 真實端點來源（誠實）
    // 不得出現「手填路徑」式的可編輯模型路徑欄位（誠實鐵律：不手填）。
    expect(html).not.toMatch(/placeholder="[^"]*模型[^"]*路徑/);
    expect(html).not.toMatch(/placeholder="[^"]*\.ifc/);
  });

  it("標 provenance 且只打 coordinator :8004（不直連內部埠）", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("ec-prov");
    expect(html).not.toContain(":49102");
    expect(html).not.toContain(":49101");
    expect(html).not.toContain(":49100");
  });

  it("初始渲染含穩定選取子：intake-refresh + intake-empty（table/radio/error 屬非同步狀態，由 browser E2E 覆蓋）", () => {
    // renderToString 無法觸發 coordinator 非同步抓取，初始為空佇列（非錯誤）→ 只斷言恆在的選取子。
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain('data-testid="intake-refresh"');
    expect(html).toContain('data-testid="intake-empty"');
  });

  // W6：選取後可「開啟審查 viewer」。初始（無選取、無 viewer_url）→ 按鈕渲染且 disabled（不做假導航）。
  it("含 intake-open 按鈕；初始未選取 → disabled（不假導航）", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain('data-testid="intake-open"');
    const openBtn = html.match(/<button[^>]*data-testid="intake-open"[^>]*>/);
    expect(openBtn?.[0]).toContain("disabled"); // 初始未選取 / 無 viewer_url → disabled
  });
});

// ── R3（安全）：viewer_url 驗證 —— 拒 open-redirect / javascript: / data: ──
describe("isSafeViewerUrl（R3 安全驗證，純函式）", () => {
  it("只接受同源 / coordinator origin；拒跨來源 open-redirect + javascript:/data:/缺值", () => {
    expect(isSafeViewerUrl("http://127.0.0.1:8004/ui/open?session=lwv_1")).toBe(true); // coordinator origin（coordinatorClient.base）
    expect(isSafeViewerUrl("/ui/open?session=lwv_1")).toBe(true); // 同源相對路徑（base=origin）
    // R6：跨來源 https 即使是合法 scheme 也拒（open-redirect / phishing）。
    expect(isSafeViewerUrl("https://attacker.example/viewer")).toBe(false);
    expect(isSafeViewerUrl("https://example.test/viewer")).toBe(false);
    // 不安全 scheme 一律拒。
    expect(isSafeViewerUrl("javascript:alert(1)")).toBe(false);
    // eslint-disable-next-line no-script-url
    expect(isSafeViewerUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeViewerUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeViewerUrl("ftp://host/x")).toBe(false);
    expect(isSafeViewerUrl(null)).toBe(false);
    expect(isSafeViewerUrl(undefined)).toBe(false);
    expect(isSafeViewerUrl("")).toBe(false);
  });
});

// R3：mount + 選取「viewer_url 為 javascript:」的 job → 開啟鈕 disabled + intake-open-blocked 警示，
// 且即使呼叫 openViewer 也不導航（window.location.assign 不被呼叫）。
describe("IntakeSelectPage R3：不安全 viewer_url → 停用 + 拒導航", () => {
  const baseJob = {
    status: "ready",
    project_id: "p1",
    external_model_version_id: "mv_1",
    download_status: "done",
    conversion_status: "succeeded",
    conversion_authority: "host-native",
    review_session_id: "lwv_1",
    expected_stage_url: "omniverse://stage/x.usdc",
    expected_mapping_url: null,
    created_at: "2026-06-03T00:00:00Z",
  };
  const jobs: IfcReadyListItem[] = [
    { ...baseJob, ifc_ready_job_id: "job_unsafe", viewer_url: "javascript:alert(1)", dispatch_error: null },
  ];

  let container: HTMLDivElement;
  let assignSpy: ReturnType<typeof vi.fn>;
  let originalLocation: Location;
  // React 18 act 環境旗標（消除「testing environment is not configured to support act」警告）。
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: jobs.length, items: jobs });
    container = document.createElement("div");
    document.body.appendChild(container);
    // jsdom 鎖死 Location.assign（不可 redefine 子屬性），故整顆替換 window.location 以觀察 assign。
    // 保留 origin（isSafeViewerUrl 解析相對路徑時需要）。
    originalLocation = window.location;
    assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, origin: originalLocation.origin, assign: assignSpy },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("選取 javascript: viewer_url 的 job → intake-open disabled + intake-open-blocked 警示 + 不導航", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<IntakeSelectPage />);
    });
    // 等 listIfcReady microtask 完成、jobs 入 state。
    await act(async () => { await Promise.resolve(); });

    const radio = container.querySelector<HTMLInputElement>('[data-testid="intake-radio"]');
    expect(radio).not.toBeNull();
    await act(async () => {
      radio!.click();
    });

    const openBtn = container.querySelector<HTMLButtonElement>('[data-testid="intake-open"]');
    expect(openBtn).not.toBeNull();
    expect(openBtn!.disabled).toBe(true); // 不安全 URL → 按鈕停用

    const blocked = container.querySelector('[data-testid="intake-open-blocked"]');
    expect(blocked?.textContent).toContain("viewer_url 非安全 http(s)/同源路徑，拒絕導航");

    // 即使強制點擊（disabled 鈕一般不觸發，但防禦縱深：openViewer 內部也 gate）→ 仍不導航。
    await act(async () => {
      openBtn!.click();
    });
    expect(assignSpy).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });
});
