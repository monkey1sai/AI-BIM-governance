export const HARNESS_SESSION_ID = "review_session_harness0001";
export const HARNESS_TRACE_ID = "rev_review_session_harness0001";

export const HARNESS_REVIEW_AUTHORITY = Object.freeze({
  sessionId: HARNESS_SESSION_ID,
  traceId: HARNESS_TRACE_ID,
});

export type HarnessReviewAuthority = Readonly<typeof HARNESS_REVIEW_AUTHORITY>;
