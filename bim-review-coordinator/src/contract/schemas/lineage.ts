// Coordinator Browser Contract — governed lineage read projections.
import { z } from "zod/v4";
import type { BundleState } from "../../services/lineage/sourceBundleValidator.js";
import type {
  SourceBundleLookupItem,
  SourceBundleLookupResponse,
} from "../../services/lineage/sourceBundleStore.js";
import type { Equal, Expect } from "../typecheck.js";
import { named } from "../primitives.js";

export const bundleState = named("BundleState", z.enum(["READY", "NON_READY", "LEGACY_UNMANAGED"]));
export type _BundleState = Expect<Equal<z.output<typeof bundleState>, BundleState>>;

export const sourceBundleLookupItem = named("SourceBundleLookupItem", z.strictObject({
  source_bundle_id: z.string(),
  bundle_state: bundleState,
  pipeline_job_id: z.string().nullable(),
}));
export type _SourceBundleLookupItem = Expect<Equal<z.output<typeof sourceBundleLookupItem>, SourceBundleLookupItem>>;

export const sourceBundleLookupResponse = named("SourceBundleLookupResponse", z.strictObject({
  items: z.array(sourceBundleLookupItem),
  unindexed_bundle_count: z.number().int().nonnegative(),
}));
export type _SourceBundleLookupResponse = Expect<Equal<z.output<typeof sourceBundleLookupResponse>, SourceBundleLookupResponse>>;
