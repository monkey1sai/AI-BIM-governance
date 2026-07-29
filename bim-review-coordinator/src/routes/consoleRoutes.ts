import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { CoordinatorConfig } from "../config.js";

const VIEWER_REDIRECT_QUERY_PARAMS = [
  "projectId",
  "modelVersionId",
  "userId",
  "displayName",
  "streamRole",
  "kitInstanceId",
  "kit_instance_id",
  "a4_handoff",
] as const;

export function registerConsoleRoutes(
  app: express.Express,
  config: CoordinatorConfig,
  publicDir: string,
): void {
  app.use("/dev-console-assets", express.static(publicDir));

  // CH-E:設定 CONSOLE_DIST_DIR 且該目錄含 index.html → /ui 服務 React UnifiedConsole;
  // 否則(未設定 / 目錄不存在)回退既有 dev-console.html(zero-risk 預設,不影響既有部署)。
  const consoleDist =
    config.consoleDistDir && fs.existsSync(path.join(config.consoleDistDir, "index.html"))
      ? config.consoleDistDir
      : null;

  // CH-E/CH-G(RK6 CRITICAL):/ui/console(301→/ui)與 /ui/open(302 handoff)必須在任何 /ui static /
  // SPA fallback「之前」註冊為精確路徑;嚴禁讓 /ui/* 萬用吞掉凍結的 /ui/open handoff。
  app.get("/ui/console", (_request, response) => {
    response.redirect(301, "/ui");
  });

  // fast-ifc-link-demo-loop §3.4 + LAN handoff:server-side redirect to
  // browser-visible viewer URL。session id 驗證
  // `^(lwv_|review_session_)[A-Za-z0-9_]+$`(支援 lwv_ + review_session_ 兩種 prefix
  // 因為 fast MVP 簡化用 review session id 當 viewer attach key)。
  app.get("/ui/open", (request, response) => {
    const sessionRaw = request.query.session;
    const session = typeof sessionRaw === "string" ? sessionRaw : "";
    if (!/^(lwv_|review_session_)[A-Za-z0-9_]+$/.test(session)) {
      response.status(400).json({ detail: "invalid session id" });
      return;
    }
    response.redirect(302, buildViewerRedirectUrl(config, session, request.query));
  });

  if (consoleDist) {
    // /dev-console 仍保留 vanilla 後援面板(精確路徑,不影響 /ui)。
    app.get("/dev-console", (_request, response) => {
      response.sendFile(path.join(publicDir, "dev-console.html"));
    });
    // React console 靜態:assets 於 /ui/assets/*(vite base=/ui/)。index:false → 目錄請求不自動回 index,
    // 一律落到下方 SPA fallback(行為可預期);redirect:false → 不為缺斜線發 301。只服務真實檔案。
    app.use("/ui", express.static(consoleDist, { index: false, redirect: false }));
    // SPA fallback:/ui 與未命中靜態的 /ui/*(hash 路由 / 重新整理)皆回 index.html。
    // /ui/console、/ui/open 已於上方先行攔截,不落入此 fallback。
    app.get(["/ui", "/ui/*"], (_request, response) => {
      response.sendFile(path.join(consoleDist, "index.html"));
    });
  } else {
    // 未設定 CONSOLE_DIST_DIR:既有 zero-risk 行為,/ui 與 /dev-console 皆服務 vanilla dev-console.html。
    app.get(["/ui", "/dev-console"], (_request, response) => {
      response.sendFile(path.join(publicDir, "dev-console.html"));
    });
  }
}

function queryParamString(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed ? trimmed : null;
}

function buildViewerRedirectUrl(
  config: CoordinatorConfig,
  session: string,
  forwardedQuery: Record<string, unknown> = {},
): string {
  const url = new URL("", `${config.viewerPublicBaseUrl}/`);
  url.searchParams.set("session", session);
  url.searchParams.set("coordinatorApiBase", config.coordinatorPublicBaseUrl);
  url.searchParams.set("coordinatorSocketUrl", config.coordinatorPublicBaseUrl);
  for (const param of VIEWER_REDIRECT_QUERY_PARAMS) {
    const value = queryParamString(forwardedQuery[param]);
    if (value && (param !== "a4_handoff" || /^a4h_[A-Za-z0-9_-]{16,96}$/.test(value))) {
      url.searchParams.set(param, value);
    }
  }
  return url.toString();
}
