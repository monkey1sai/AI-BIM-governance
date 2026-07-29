import {
  HARNESS_SESSION_ID,
  HARNESS_TRACE_ID,
} from "../src/harness/fixtures/reviewAuthority";

export function harnessRoute(extra: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams({
    harness: "1",
    session: HARNESS_SESSION_ID,
    trace_id: HARNESS_TRACE_ID,
    ...extra,
  });
  return `/?${params.toString()}`;
}
