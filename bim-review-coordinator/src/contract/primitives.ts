// Coordinator Browser Contract — shared primitives.
//
// Everything a browser client must know about the coordinator's REST surface is
// authored here as zod (v4) and emitted as one OpenAPI 3.1 document under
// tests/contracts/. See CONTEXT.md "Coordinator Browser Contract".
import { z } from "zod/v4";

/**
 * One registry for every schema that must appear as a named entry under
 * `components.schemas`. `named()` is the only writer; openapi.ts reads it.
 */
export const contractRegistry = z.registry<{ id: string; description?: string }>();

export function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  if (contractRegistry.has(schema)) {
    const existing = contractRegistry.get(schema);
    if (existing && existing.id !== id) {
      throw new Error(`contract schema already registered as ${existing.id}; cannot re-register as ${id}`);
    }
    return schema;
  }
  contractRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}

/** Server-emitted ISO 8601 timestamp. Kept as a plain string on the wire. */
export const isoTimestamp = z.string().describe("ISO 8601 timestamp");

/** `review_session_*` / `lwv_*` identifiers as accepted by isSafeSessionId. */
export const sessionIdParam = z.string().min(1).max(200);
/** Conversion / ifc-ready job identifiers (see isSafeConversionJobId). */
export const safeJobIdParam = z.string().regex(/^[A-Za-z0-9_.-]+$/);
/** `mw_<hash16>` ready-model identifiers. */
export const readyModelIdParam = z.string().regex(/^mw_[a-f0-9]{16}$/);

export const sessionStatus = named(
  "SessionStatus",
  z.enum(["created", "active", "closing", "closed", "failed"]),
);
export const routingPolicy = named(
  "RoutingPolicy",
  z.enum(["same_instance", "dedicated_instance", "shared_state"]),
);

// ── Error bodies ─────────────────────────────────────────────────────────────
// The coordinator currently speaks three error genres. The contract records all
// three as they are; PR2 adds a structured `error_code` additively.

/** `{ detail: string }` — the dominant genre (168 sites). */
export const detailError = named(
  "DetailError",
  z.strictObject({ detail: z.string() }),
  "Human-readable failure detail.",
);

/** Body produced by the global handler when a zod request schema rejects. */
export const validationError = named(
  "ValidationError",
  z.strictObject({
    detail: z.strictObject({
      formErrors: z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }),
  }),
  "zod ZodError.flatten() as emitted by the coordinator's 400 handler.",
);

/** `{ error_code, detail? }` — structured genre used by A4, ready-model and reconversion routes. */
export const errorCodeError = named(
  "ErrorCodeError",
  z.looseObject({
    error_code: z.string().regex(/^[a-z0-9_]{1,64}$/),
    detail: z.string().optional(),
  }),
);

/** `{ error, detail? }` — legacy named-error genre. */
export const namedError = named(
  "NamedError",
  z.strictObject({ error: z.string(), detail: z.string().optional() }),
);

/** Any of the three error genres. Used where one status code carries mixed shapes. */
export const anyError = named("AnyError", z.union([detailError, errorCodeError, namedError]));
