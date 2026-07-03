import { createContext, useContext } from "react";

// UI-facing summary view (deliberately named apart from coordinatorClient.RuntimeSessionSummary to avoid
// misreading participant_count as participants). See spec §5.2.
export interface SharedSessionEntry {
  session_id: string;
  status: string;                 // verbatim echo of RuntimeSessionSummary.status
  participants?: number;          // from RuntimeSessionSummary.participant_count
  conversion?: string | null;     // from RuntimeSessionSummary.conversion_status
  stage_matched?: boolean | null; // designed permanently null (§5.2)
}

export interface SharedStatusSnapshot {
  activeSessions: number;
  sessionsById: Record<string, SharedSessionEntry>;
  gpuNodesTotal: number | null;   // null → "未取得" (runtime/status has no GPU fields, OQ3)
  gpuNodesBusy: number | null;    // null → "未取得"
  health: "ok" | "degraded" | "unknown";
  conversionQueue: number | null; // count of records with status ∈ {detected,queued,converting}
  updatedAt: string;
  stale: boolean;
}

export const EMPTY_SHARED_STATUS: SharedStatusSnapshot = {
  activeSessions: 0,
  sessionsById: {},
  gpuNodesTotal: null,
  gpuNodesBusy: null,
  health: "unknown",
  conversionQueue: null,
  updatedAt: "",
  stale: true,
};

export const SharedStatusContext = createContext<SharedStatusSnapshot>(EMPTY_SHARED_STATUS);

export function useSharedStatus(): SharedStatusSnapshot {
  return useContext(SharedStatusContext);
}
