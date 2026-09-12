import { createHash, createHmac } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { RemediationAccessError, resolveRemediationAccess, type RemediationAccess,
  type RemediationOperation } from "../services/remediationAccess.js";

const id = z.string().min(1).max(512).refine(s => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s));
const reopen = z.object({ expected_revision: z.number().int().nonnegative(), note: z.string().max(4000).default("") }).strict();
const confirm = reopen.extend({ revised_model_version_id: id, revised_run_id: id,
  revised_result_id: id, idempotency_key: id }).strict();
const paths = { confirm: "confirm-remediation", history: "remediation-history", reopen: "reopen-remediation" } as const;

export function registerRemediationRoutes(app: Express, options: {
  access?: RemediationAccess; localValidation?: boolean; internalKey?: string;
}) {
  for (const operation of Object.keys(paths) as RemediationOperation[]) {
    app[operation === "history" ? "get" : "post"](`/api/governance/issues/:issueId/${paths[operation]}`, async (req, res) => {
      res.set("Cache-Control", "no-store");
      const prefix = operation === "history" ? "remediation_history" : "remediation_authorization";
      const targetId = id.safeParse(req.params.issueId);
      if (!targetId.success) { res.status(422).json({ detail: { code: "remediation_evidence_invalid" } }); return; }
      try {
        if (!options.internalKey || Buffer.byteLength(options.internalKey) < 32) throw new RemediationAccessError(503);
        let body: string | undefined;
        let query = "";
        if (operation !== "history") {
          if (!req.is("application/json") || req.get("x-a1-intent") !== operation) throw new RemediationAccessError(403);
          const parsed = (operation === "confirm" ? confirm : reopen).safeParse(req.body);
          if (!parsed.success) { res.status(422).json({ detail: { code: "remediation_evidence_invalid" } }); return; }
          body = JSON.stringify(parsed.data);
        } else {
          const raw = req.query;
          if (Object.keys(raw).some(k => !["limit", "offset"].includes(k)) ||
              Object.values(raw).some(v => typeof v !== "string" || !/^\d+$/.test(v))) {
            res.status(422).json({ detail: { code: "remediation_history_invalid_page" } }); return;
          }
          query = `?${new URLSearchParams(raw as Record<string, string>)}`;
        }
        const access = await resolveRemediationAccess(options.access, req,
          { issueId: targetId.data, operation }, options.localValidation);
        const claims = { version: 1, operation, issue_id: targetId.data,
          body_sha256: createHash("sha256").update(body ?? "").digest("hex"),
          ...access, expires_at_ms: Math.min(access.expires_at_ms, Date.now() + 20_000) };
        const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
        const grant = `${encoded}.${createHmac("sha256", options.internalKey).update(encoded).digest("hex")}`;
        if (grant.length > 16384) throw new RemediationAccessError(503);
        const base = process.env.GOVERNANCE_API_BASE ?? "http://127.0.0.1:49102";
        const upstream = await fetch(`${base}/api/issues/${encodeURIComponent(targetId.data)}/${paths[operation]}${query}`, {
          method: operation === "history" ? "GET" : "POST", body, redirect: "error",
          headers: { "Content-Type": "application/json", "X-A1-Remediation-Grant": grant },
          signal: AbortSignal.timeout(15_000),
        });
        const value = await upstream.json() as Record<string, unknown>;
        if (!upstream.ok) {
          const code = (value.detail as { code?: unknown } | undefined)?.code;
          res.status([403, 404, 409, 422, 503].includes(upstream.status) ? upstream.status : 502)
            .json({ detail: { code: typeof code === "string" && /^remediation_[a-z_]+$/.test(code) ? code : "remediation_upstream_error" } });
          return;
        }
        res.json({ ...value, access: { actor_kind: access.actor_kind } });
      } catch (error) {
        const status = error instanceof RemediationAccessError ? error.status : 503;
        const code = error instanceof RemediationAccessError ? `${prefix}_${status === 403 ? "denied" : "unavailable"}`
          : operation === "history" ? "remediation_history_unavailable" : "remediation_outcome_unknown";
        res.status(status).json({ detail: { code } });
      }
    });
  }
}
