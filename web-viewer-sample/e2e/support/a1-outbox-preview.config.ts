import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

// Loopback-only design fixture. No real API is contacted or mutated.
export default mergeConfig(base, defineConfig({
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
  define: { "import.meta.env.VITE_COORDINATOR_API_BASE": JSON.stringify("http://127.0.0.1:5183") },
  plugins: [{
    name: "a1-outbox-design-fixture",
    configureServer(server) {
      const failedQueries = new Set<string>();
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const ref = new URL(req.headers.referer ?? "http://127.0.0.1:5183");
        const state = ref.searchParams.get("state");
        if (req.method !== "GET" || req.url !== "/api/callback-outbox/summary?limit=200") {
          res.statusCode = 405; res.end("design fixture only allows summary GET"); return;
        }
        // Independent frames request the same URL; release cache coalescing at headers.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Vary", "Referer");
        if (state === "loading") { res.flushHeaders(); return; } // Pending JSON until frame closes.
        if (state === "error" && !failedQueries.has(ref.href)) {
          failedQueries.add(ref.href); res.statusCode = 503; res.end("design query unavailable"); return;
        }
        const entry = {
          outbox_id: "cbk_design", event: "issue_snapshot", correlation_id: "review_session_design", conversion_job_id: null,
          status: state === "incomplete" ? "delivered" : state === "error" ? "pending" : state,
          attempts: state === "dead_letter" ? 5 : ["delivered", "incomplete"].includes(state ?? "") ? 2 : 0,
          max_attempts: 5, last_error: null, created_at: "2026-09-13T00:00:00Z",
          delivered_at: state === "delivered" ? "2026-09-13T01:00:00Z" : null,
        };
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ total: state === "missing" ? 201 : 1, limit: 200, entries: state === "missing" ? [] : [entry] }));
      });
    },
  }],
}));
