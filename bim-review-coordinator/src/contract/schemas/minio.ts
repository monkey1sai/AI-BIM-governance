// Coordinator Browser Contract — MinIO Watch Surface read projections.
import { z } from "zod/v4";
import type { MinioWatcherStatus } from "../../services/minioWatcher.js";
import type {
  MinioFolderBrowsePayload,
  MinioFolderNode,
  MinioObjectView,
  MinioWatchDisabledStatus,
} from "../../services/minioWatchSurface.js";
import type { Equal, Expect } from "../typecheck.js";
import { isoTimestamp, named } from "../primitives.js";

export const minioWatcherStatus = named("MinioWatcherStatus", z.strictObject({
  enabled: z.literal(true),
  bucket: z.string(),
  prefix: z.string(),
  interval_seconds: z.number(),
  last_poll_at: isoTimestamp.nullable(),
  poll_count: z.number(),
  last_error: z.string().nullable(),
  baseline_count: z.number().nullable(),
  seen_count: z.number(),
  triggered_total: z.number(),
  skipped_malformed_total: z.number(),
  last_triggered: z.array(z.strictObject({
    key: z.string(),
    job_id: z.string().nullable(),
    error: z.string().nullable(),
    at: isoTimestamp,
  })),
}));
export type _MinioWatcherStatus = Expect<Equal<z.output<typeof minioWatcherStatus>, MinioWatcherStatus>>;

export const minioWatchDisabledStatus = named("MinioWatchDisabledStatus", z.strictObject({
  enabled: z.boolean(),
  bucket: z.string().nullable().optional(),
  prefix: z.string().nullable().optional(),
  interval_seconds: z.number().optional(),
  note: z.string(),
}));
export type _MinioWatchDisabledStatus = Expect<Equal<z.output<typeof minioWatchDisabledStatus>, MinioWatchDisabledStatus>>;

export const minioWatchStatusView = named("MinioWatchStatusView", z.union([minioWatcherStatus, minioWatchDisabledStatus]));

export const minioObjectRole = named("MinioObjectRole", z.enum(["source_ifc", "parsed_usdc", "other"]));

export const minioObjectView = named("MinioObjectView", z.strictObject({
  key: z.string(),
  etag: z.string(),
  role: minioObjectRole,
  project_id: z.string().nullable(),
  project_display_name: z.string().nullable(),
  category: z.string().nullable(),
  version: z.string().nullable(),
  idempotency_key: z.string(),
}));
export type _MinioObjectView = Expect<Equal<z.output<typeof minioObjectView>, MinioObjectView>>;

export const minioFolderNode = named("MinioFolderNode", z.strictObject({
  prefix: z.string(),
  has_source_ifc: z.boolean(),
}));
export type _MinioFolderNode = Expect<Equal<z.output<typeof minioFolderNode>, MinioFolderNode>>;

export const minioFolderBrowsePayload = named("MinioFolderBrowsePayload", z.strictObject({
  bucket: z.string(),
  prefix: z.string(),
  folders: z.array(minioFolderNode),
  objects: z.array(minioObjectView),
  count: z.number(),
  cache: z.strictObject({ hit: z.boolean(), stale: z.boolean(), fetched_at: isoTimestamp }),
}));
export type _MinioFolderBrowsePayload = Expect<Equal<z.output<typeof minioFolderBrowsePayload>, MinioFolderBrowsePayload>>;

export const minioFlatBrowsePayload = named("MinioFlatBrowsePayload", z.strictObject({
  bucket: z.string(),
  prefix: z.string(),
  count: z.number(),
  objects: z.array(minioObjectView),
}));

export const minioNotConfiguredListing = named("MinioNotConfiguredListing", z.strictObject({
  bucket: z.string().nullable(),
  prefix: z.literal(""),
  folders: z.array(z.never()),
  count: z.literal(0),
  objects: z.array(z.never()),
  note: z.string(),
}));

export const minioObjectsResponse = named("MinioObjectsResponse", z.union([
  minioFolderBrowsePayload,
  minioFlatBrowsePayload,
  minioNotConfiguredListing,
]));

export const minioWatchToggleRequest = named("MinioWatchToggleRequest", z.strictObject({
  enabled: z.boolean(),
}));
