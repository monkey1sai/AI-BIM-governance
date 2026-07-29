import { beforeEach, describe, expect, it, vi } from "vitest";

const { bootstrapStructLog, render } = vi.hoisted(() => ({
  bootstrapStructLog: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: vi.fn(() => ({ render })),
  },
}));
vi.mock("./App.tsx", () => ({ default: () => null }));
vi.mock("./console/EdgeConsole", () => ({ default: () => null }));
vi.mock("./config/env", () => ({
  reviewEnv: { coordinatorApiBase: "http://127.0.0.1:8005" },
}));
vi.mock("./lib/structLogBootstrap", () => ({ bootstrapStructLog }));

async function loadMainAt(url: string): Promise<void> {
  window.history.replaceState({}, "", url);
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  await import("./main.tsx");
}

describe("application bootstrap routing", () => {
  beforeEach(() => {
    bootstrapStructLog.mockReset();
    render.mockReset();
    delete window.__INITIAL_SESSION_FROM_QUERY__;
  });

  it.each([
    "/ui",
    "/ui#home",
    "/#coordinator",
    "/",
    "/viewer",
  ])("renders a sessionless operator route without requiring a viewer trace: %s", async (url) => {
    await loadMainAt(url);

    expect(bootstrapStructLog).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledOnce();
  });

  it("still bootstraps structured logging for a viewer session route", async () => {
    await loadMainAt("/?session=review_session_demo&trace_id=ifcready_root_123");

    expect(bootstrapStructLog).toHaveBeenCalledOnce();
    expect(bootstrapStructLog).toHaveBeenCalledWith(expect.objectContaining({
      search: "?session=review_session_demo&trace_id=ifcready_root_123",
      coordinatorApiBase: "http://127.0.0.1:8005",
    }));
    expect(render).toHaveBeenCalledOnce();
  });

  it.each([
    "/?session=review_session_demo",
    "/?session=review_session_demo&trace_id=malformed",
    "/?session=review_session_demo&trace_id=ifcready_root_1&trace_id=ifcready_root_2",
  ])("fails closed before render when a viewer session has no unique valid trace: %s", async (url) => {
    bootstrapStructLog.mockImplementationOnce(() => {
      throw new Error("A valid structured-log trace carrier is required before browser bootstrap");
    });

    await expect(loadMainAt(url)).rejects.toThrow("valid structured-log trace carrier");

    expect(bootstrapStructLog).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });
});
